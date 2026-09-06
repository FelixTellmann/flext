import { describe, expect, test } from "bun:test";
import type { FetchLike, LookupLike } from "@server/mail/unsubscribe/one-click";
import { isPublicAddress, performOneClick, refusalFor } from "@server/mail/unsubscribe/one-click";

const public_lookup: LookupLike = async () => [{ address: "93.184.216.34", family: 4 }];

function respondingWith(status: number, headers?: Record<string, string>): FetchLike {
  return async () => new Response("", { status, headers });
}

describe("isPublicAddress", () => {
  test("public addresses of both families", () => {
    expect(isPublicAddress("93.184.216.34")).toBe(true);
    expect(isPublicAddress("2606:2800:220:1:248:1893:25c8:1946")).toBe(true);
  });

  test("IPv4: loopback, private, link-local, unspecified", () => {
    for (const address of [
      "127.0.0.1",
      "127.255.255.255",
      "10.0.0.1",
      "172.16.0.1",
      "172.31.255.254",
      "192.168.1.1",
      "169.254.169.254",
      "0.0.0.0",
    ]) {
      expect(isPublicAddress(address)).toBe(false);
    }
    expect(isPublicAddress("172.15.0.1")).toBe(true);
    expect(isPublicAddress("172.32.0.1")).toBe(true);
  });

  test("IPv6: loopback, unspecified, link-local, unique-local", () => {
    for (const address of ["::1", "::", "fe80::1", "febf::1", "fc00::1", "fd12:3456::1"]) {
      expect(isPublicAddress(address)).toBe(false);
    }
    expect(isPublicAddress("fec0::1")).toBe(true);
  });

  test("IPv4-mapped and IPv4-compatible IPv6 answer for the embedded address", () => {
    expect(isPublicAddress("::ffff:127.0.0.1")).toBe(false);
    expect(isPublicAddress("::ffff:7f00:1")).toBe(false);
    expect(isPublicAddress("::ffff:10.0.0.1")).toBe(false);
    expect(isPublicAddress("::ffff:169.254.1.1")).toBe(false);
    expect(isPublicAddress("::ffff:93.184.216.34")).toBe(true);
    expect(isPublicAddress("::10.0.0.1")).toBe(false);
  });

  test("not an IP literal is never public — hostnames are resolved first", () => {
    expect(isPublicAddress("localhost")).toBe(false);
    expect(isPublicAddress("example.com")).toBe(false);
    expect(isPublicAddress("")).toBe(false);
  });
});

describe("refusalFor", () => {
  test("https to a public hostname passes", async () => {
    expect(await refusalFor("https://example.com/out", public_lookup)).toBeNull();
  });

  test("http is refused without a lookup", async () => {
    let looked_up = false;
    const lookup: LookupLike = async () => {
      looked_up = true;
      return [];
    };

    expect(await refusalFor("http://example.com/out", lookup)).toBe("not https");
    expect(looked_up).toBe(false);
  });

  test("a literal private or loopback host is refused without a lookup", async () => {
    let looked_up = false;
    const lookup: LookupLike = async () => {
      looked_up = true;
      return [];
    };

    expect(await refusalFor("https://127.0.0.1:8000/", lookup)).toBe("127.0.0.1 is not a public address");
    expect(await refusalFor("https://[::1]:3000/api", lookup)).toBe("::1 is not a public address");
    // The URL parser canonicalises the mapped literal to hex groups; the check answers for the canonical form.
    expect(await refusalFor("https://[::ffff:10.0.0.1]/", lookup)).toBe("::ffff:a00:1 is not a public address");
    expect(looked_up).toBe(false);
  });

  test("a hostname is refused when ANY resolved address is non-public", async () => {
    const lookup: LookupLike = async () => [
      { address: "93.184.216.34", family: 4 },
      { address: "10.0.0.5", family: 4 },
    ];

    expect(await refusalFor("https://rebinder.example/out", lookup)).toBe(
      "rebinder.example resolves to 10.0.0.5, which is not a public address",
    );
  });

  test("a hostname that does not resolve, or whose lookup throws, is refused", async () => {
    expect(await refusalFor("https://nowhere.example/", async () => [])).toBe("nowhere.example did not resolve");
    const throwing: LookupLike = async () => {
      throw new Error("ENOTFOUND");
    };
    expect(await refusalFor("https://nowhere.example/", throwing)).toBe("nowhere.example did not resolve: ENOTFOUND");
  });
});

describe("performOneClick", () => {
  test("a 2xx is sent, with the code recorded", async () => {
    const outcome = await performOneClick({ url: "https://example.com/out", fetch_impl: respondingWith(202), lookup_impl: public_lookup });

    expect(outcome).toEqual({ status: "sent", response_code: 202, error: null });
  });

  test("sends the RFC 8058 body as a form POST with redirects handled by hand", async () => {
    let seen: { url: string; init: RequestInit } | null = null;
    const fetch_impl: FetchLike = async (url, init) => {
      seen = { url, init };
      return new Response("", { status: 200 });
    };

    await performOneClick({ url: "https://example.com/out", fetch_impl, lookup_impl: public_lookup });

    expect(seen).not.toBeNull();
    const request = seen as unknown as { url: string; init: RequestInit };
    expect(request.url).toBe("https://example.com/out");
    expect(request.init.method).toBe("POST");
    expect(request.init.body).toBe("List-Unsubscribe=One-Click");
    expect(request.init.redirect).toBe("manual");
    expect(new Headers(request.init.headers).get("content-type")).toBe("application/x-www-form-urlencoded");
  });

  test("an http target is skipped before any request", async () => {
    let requested = false;
    const fetch_impl: FetchLike = async () => {
      requested = true;
      return new Response("", { status: 200 });
    };

    const outcome = await performOneClick({ url: "http://example.com/out", fetch_impl, lookup_impl: public_lookup });

    expect(outcome).toEqual({ status: "skipped", response_code: null, error: "not https" });
    expect(requested).toBe(false);
  });

  test("a target resolving to the box itself is skipped before any request", async () => {
    let requested = false;
    const fetch_impl: FetchLike = async () => {
      requested = true;
      return new Response("", { status: 200 });
    };
    const lookup: LookupLike = async () => [{ address: "127.0.0.1", family: 4 }];

    const outcome = await performOneClick({ url: "https://coolify.internal/", fetch_impl, lookup_impl: lookup });

    expect(outcome.status).toBe("skipped");
    expect(outcome.error).toBe("coolify.internal resolves to 127.0.0.1, which is not a public address");
    expect(requested).toBe(false);
  });

  test("a 4xx is failed, with the code recorded and nothing thrown", async () => {
    const outcome = await performOneClick({ url: "https://example.com/out", fetch_impl: respondingWith(404), lookup_impl: public_lookup });

    expect(outcome).toEqual({ status: "failed", response_code: 404, error: "HTTP 404" });
  });

  test("a redirect to a public https target is followed, re-POSTing the body", async () => {
    const urls: string[] = [];
    const fetch_impl: FetchLike = async (url, init) => {
      urls.push(url);
      expect(init.method).toBe("POST");
      if (urls.length === 1) {
        return new Response("", { status: 302, headers: { location: "/confirm?x=1" } });
      }
      return new Response("", { status: 200 });
    };

    const outcome = await performOneClick({ url: "https://example.com/out", fetch_impl, lookup_impl: public_lookup });

    expect(outcome).toEqual({ status: "sent", response_code: 200, error: null });
    expect(urls).toEqual(["https://example.com/out", "https://example.com/confirm?x=1"]);
  });

  test("a redirect into the private range is refused after the first request and reported failed", async () => {
    const lookups: string[] = [];
    const lookup: LookupLike = async (hostname) => {
      lookups.push(hostname);
      return [{ address: hostname === "example.com" ? "93.184.216.34" : "10.0.0.1", family: 4 }];
    };
    const fetch_impl: FetchLike = async () => new Response("", { status: 302, headers: { location: "https://internal.example/" } });

    const outcome = await performOneClick({ url: "https://example.com/out", fetch_impl, lookup_impl: lookup });

    expect(outcome.status).toBe("failed");
    expect(outcome.error).toBe("redirect refused: internal.example resolves to 10.0.0.1, which is not a public address");
    expect(lookups).toEqual(["example.com", "internal.example"]);
  });

  test("a redirect to http is refused", async () => {
    const fetch_impl: FetchLike = async () => new Response("", { status: 301, headers: { location: "http://example.com/out" } });

    const outcome = await performOneClick({ url: "https://example.com/out", fetch_impl, lookup_impl: public_lookup });

    expect(outcome).toEqual({ status: "failed", response_code: null, error: "redirect refused: not https" });
  });

  test("more than three redirects is failed", async () => {
    let hops = 0;
    const fetch_impl: FetchLike = async () => {
      hops += 1;
      return new Response("", { status: 302, headers: { location: `https://example.com/hop${hops}` } });
    };

    const outcome = await performOneClick({ url: "https://example.com/out", fetch_impl, lookup_impl: public_lookup });

    expect(outcome).toEqual({ status: "failed", response_code: 302, error: "more than 3 redirects" });
    expect(hops).toBe(4);
  });

  test("a network error is failed with the message, never a throw", async () => {
    const fetch_impl: FetchLike = async () => {
      throw new Error("ECONNREFUSED");
    };

    const outcome = await performOneClick({ url: "https://example.com/out", fetch_impl, lookup_impl: public_lookup });

    expect(outcome).toEqual({ status: "failed", response_code: null, error: "ECONNREFUSED" });
  });

  test("a request that outlives the timeout is aborted and reported as such", async () => {
    const fetch_impl: FetchLike = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      });

    const outcome = await performOneClick({ url: "https://example.com/out", fetch_impl, lookup_impl: public_lookup, timeout_ms: 10 });

    expect(outcome).toEqual({ status: "failed", response_code: null, error: "timed out after 10 ms" });
  });
});
