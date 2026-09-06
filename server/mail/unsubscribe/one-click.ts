import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { ONE_CLICK_POST_VALUE } from "@server/mail/unsubscribe/parse";

// RFC 8058's one request: POST the List-Unsubscribe URL with the fixed body, from the server. Pure over
// the injected fetch and lookup — the tests never reach the network, and nothing here reads or writes a
// row.
//
// The URL is written by the sender, and the server shares a box with Coolify (127.0.0.1:8000), MySQL and
// its own /api routes, so a header is also a request forgery vector: https only, every hostname resolved
// and refused if any address is non-public, redirects followed by hand so each hop is checked the same
// way. A refusal before any request is `skipped`; a refusal after one is `failed`.

export type OneClickOutcome = {
  status: "sent" | "failed" | "skipped";
  response_code: number | null;
  error: string | null;
};

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export type LookupLike = (hostname: string) => Promise<{ address: string; family: number }[]>;

export const ONE_CLICK_TIMEOUT_MS = 10_000;

// Three hops is what a tracker-then-list-manager chain needs; a longer chain is a loop or a bounce.
export const ONE_CLICK_MAX_REDIRECTS = 3;

function parseIpv4(text: string): number[] | null {
  const octets = text.split(".");
  if (octets.length !== 4) {
    return null;
  }
  const parsed = octets.map((octet) => (/^\d{1,3}$/.test(octet) ? Number(octet) : Number.NaN));
  return parsed.every((octet) => Number.isInteger(octet) && octet >= 0 && octet <= 255) ? parsed : null;
}

// Refused: this host (0/8), private (10/8, 172.16/12, 192.168/16), loopback (127/8), carrier-grade NAT
// (100.64/10), link-local (169.254/16), IETF protocol assignments (192.0.0/24), benchmarking (198.18/15),
// multicast (224/4) and reserved (240/4, broadcast included).
function isPublicIpv4(octets: number[]): boolean {
  const [a, b, c] = octets;
  if (a === undefined || b === undefined || c === undefined) {
    return false;
  }
  if (a === 0 || a === 10 || a === 127 || a >= 224) {
    return false;
  }
  if (a === 100 && b >= 64 && b <= 127) {
    return false;
  }
  if (a === 169 && b === 254) {
    return false;
  }
  if (a === 172 && b >= 16 && b <= 31) {
    return false;
  }
  if (a === 192 && (b === 168 || (b === 0 && c === 0))) {
    return false;
  }
  if (a === 198 && (b === 18 || b === 19)) {
    return false;
  }
  return true;
}

// Eight 16-bit groups, or null when the text is not an IPv6 address. isIP has already validated the
// shape, so this only has to expand `::` and an embedded dotted IPv4 tail.
function parseIpv6(text: string): number[] | null {
  let address = text.split("%")[0] ?? "";
  const last_colon = address.lastIndexOf(":");
  const tail = address.slice(last_colon + 1);
  if (tail.includes(".")) {
    const octets = parseIpv4(tail);
    if (octets === null) {
      return null;
    }
    const [o0, o1, o2, o3] = octets as [number, number, number, number];
    address = `${address.slice(0, last_colon + 1)}${((o0 << 8) | o1).toString(16)}:${((o2 << 8) | o3).toString(16)}`;
  }

  const halves = address.split("::");
  if (halves.length > 2) {
    return null;
  }
  const head = halves[0] === "" || halves[0] === undefined ? [] : halves[0].split(":");
  const rest = halves.length === 2 && halves[1] !== "" && halves[1] !== undefined ? halves[1].split(":") : [];
  const missing = 8 - head.length - rest.length;
  if (halves.length === 2 ? missing < 1 : missing !== 0) {
    return null;
  }
  const groups = [...head, ...new Array<string>(halves.length === 2 ? missing : 0).fill("0"), ...rest].map((group) =>
    Number.parseInt(group, 16),
  );
  return groups.length === 8 && groups.every((group) => Number.isInteger(group) && group >= 0 && group <= 0xffff) ? groups : null;
}

// True only for an address a request may be sent to. Anything that is not an IP literal is false: the
// caller resolves hostnames first and asks about what came back.
export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    const octets = parseIpv4(address);
    return octets !== null && isPublicIpv4(octets);
  }
  if (family !== 6) {
    return false;
  }
  const groups = parseIpv6(address);
  if (groups === null) {
    return false;
  }
  const [g0, g1, g2, g3, g4, g5, g6, g7] = groups as [number, number, number, number, number, number, number, number];
  const leading_zero = g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0;
  // ::ffff:a.b.c.d (IPv4-mapped) and the deprecated ::a.b.c.d (IPv4-compatible) both answer for the
  // embedded IPv4, so a mapped loopback is refused as loopback.
  if (leading_zero && (g5 === 0xffff || g5 === 0)) {
    const is_unspecified_or_loopback = g5 === 0 && g6 === 0 && (g7 === 0 || g7 === 1);
    if (is_unspecified_or_loopback) {
      return false;
    }
    return isPublicIpv4([g6 >> 8, g6 & 0xff, g7 >> 8, g7 & 0xff]);
  }
  if ((g0 & 0xffc0) === 0xfe80) {
    return false;
  }
  if ((g0 & 0xfe00) === 0xfc00) {
    return false;
  }
  return true;
}

function hostnameOf(url: URL): string {
  return url.hostname.startsWith("[") && url.hostname.endsWith("]") ? url.hostname.slice(1, -1) : url.hostname;
}

// Null when the URL may be requested; otherwise the reason it may not, worded for the attempt row.
export async function refusalFor(url_text: string, lookup_impl: LookupLike): Promise<string | null> {
  let url: URL;
  try {
    url = new URL(url_text);
  } catch {
    return "not a valid URL";
  }
  if (url.protocol !== "https:") {
    return "not https";
  }

  const hostname = hostnameOf(url);
  if (isIP(hostname) !== 0) {
    return isPublicAddress(hostname) ? null : `${hostname} is not a public address`;
  }

  let resolved: { address: string; family: number }[];
  try {
    resolved = await lookup_impl(hostname);
  } catch (error) {
    return `${hostname} did not resolve: ${error instanceof Error ? error.message : String(error)}`;
  }
  if (resolved.length === 0) {
    return `${hostname} did not resolve`;
  }
  const non_public = resolved.find((entry) => !isPublicAddress(entry.address));
  return non_public === undefined ? null : `${hostname} resolves to ${non_public.address}, which is not a public address`;
}

// node's dns.promises.lookup cannot be aborted, so the lookup is raced against the deadline instead: the
// abort rejects this promise and the answer that arrives later is dropped unread. The listener is removed
// on settle because this runs in a long-lived server and the controller outlives the lookup.
function untilAborted<Value>(promise: Promise<Value>, signal: AbortSignal): Promise<Value> {
  return new Promise<Value>((resolve, reject) => {
    const onAbort = () => reject(new Error("aborted"));
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

// Never throws: a network error, a timeout, a refused target and a non-2xx are all one outcome with
// the evidence carried on it — the caller records the row either way and a throw would skip the record.
// The timeout budget covers the DNS lookups as well as the requests: a resolver that hangs is refused
// at the deadline like a server that hangs.
export async function performOneClick(input: {
  url: string;
  fetch_impl?: FetchLike;
  lookup_impl?: LookupLike;
  timeout_ms?: number;
}): Promise<OneClickOutcome> {
  const fetch_impl = input.fetch_impl ?? fetch;
  const lookup_impl = input.lookup_impl ?? ((hostname) => lookup(hostname, { all: true }));
  const timeout_ms = input.timeout_ms ?? ONE_CLICK_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout_ms);
  const timed_out: OneClickOutcome = { status: "failed", response_code: null, error: `timed out after ${timeout_ms} ms` };
  const deadline_lookup: LookupLike = (hostname) => untilAborted(lookup_impl(hostname), controller.signal);

  try {
    let url = input.url;
    for (let hop = 0; hop <= ONE_CLICK_MAX_REDIRECTS; hop += 1) {
      const refusal = await refusalFor(url, deadline_lookup);
      if (controller.signal.aborted) {
        return timed_out;
      }
      if (refusal !== null) {
        return hop === 0
          ? { status: "skipped", response_code: null, error: refusal }
          : { status: "failed", response_code: null, error: `redirect refused: ${refusal}` };
      }

      // Every hop re-POSTs the same body: a 303's "switch to GET" would turn the one-click request into
      // a visit to the unsubscribe page, which is not what the sender promised to honour.
      const response = await fetch_impl(url, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: ONE_CLICK_POST_VALUE,
        redirect: "manual",
        signal: controller.signal,
      });
      if (response.status >= 200 && response.status < 300) {
        return { status: "sent", response_code: response.status, error: null };
      }
      if (response.status < 300 || response.status >= 400) {
        return { status: "failed", response_code: response.status, error: `HTTP ${response.status}` };
      }

      const location = response.headers.get("location");
      if (location === null) {
        return { status: "failed", response_code: response.status, error: `HTTP ${response.status} without a Location` };
      }
      if (hop === ONE_CLICK_MAX_REDIRECTS) {
        return { status: "failed", response_code: response.status, error: `more than ${ONE_CLICK_MAX_REDIRECTS} redirects` };
      }
      try {
        url = new URL(location, url).toString();
      } catch {
        return { status: "failed", response_code: response.status, error: `redirect to an invalid URL: ${location}` };
      }
    }
    return { status: "failed", response_code: null, error: `more than ${ONE_CLICK_MAX_REDIRECTS} redirects` };
  } catch (error) {
    if (controller.signal.aborted) {
      return timed_out;
    }
    return { status: "failed", response_code: null, error: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timer);
  }
}
