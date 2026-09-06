import { ONE_CLICK_POST_VALUE } from "@server/mail/unsubscribe/parse";

// RFC 8058's one request: POST the List-Unsubscribe URL with the fixed body, from the server. Pure over
// the injected fetch — the tests never reach the network, and nothing here reads or writes a row.

export type OneClickOutcome = {
  status: "sent" | "failed";
  response_code: number | null;
  error: string | null;
};

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export const ONE_CLICK_TIMEOUT_MS = 10_000;

// Never throws: a network error, a timeout and a non-2xx are all one outcome, `failed`, with the
// evidence carried on it — the caller records the row either way and a throw would skip the record.
export async function performOneClick(input: { url: string; fetch_impl?: FetchLike; timeout_ms?: number }): Promise<OneClickOutcome> {
  const fetch_impl = input.fetch_impl ?? fetch;
  const timeout_ms = input.timeout_ms ?? ONE_CLICK_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout_ms);

  try {
    const response = await fetch_impl(input.url, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: ONE_CLICK_POST_VALUE,
      redirect: "follow",
      signal: controller.signal,
    });
    if (response.status >= 200 && response.status < 300) {
      return { status: "sent", response_code: response.status, error: null };
    }
    return { status: "failed", response_code: response.status, error: `HTTP ${response.status}` };
  } catch (error) {
    if (controller.signal.aborted) {
      return { status: "failed", response_code: null, error: `timed out after ${timeout_ms} ms` };
    }
    return { status: "failed", response_code: null, error: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timer);
  }
}
