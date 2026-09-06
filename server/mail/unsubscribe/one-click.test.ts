import { expect, test } from "bun:test";
import type { FetchLike } from "@server/mail/unsubscribe/one-click";
import { performOneClick } from "@server/mail/unsubscribe/one-click";

function respondingWith(status: number): FetchLike {
  return async () => new Response("", { status });
}

test("a 2xx is sent, with the code recorded", async () => {
  const outcome = await performOneClick({ url: "https://example.com/out", fetch_impl: respondingWith(202) });

  expect(outcome).toEqual({ status: "sent", response_code: 202, error: null });
});

test("sends the RFC 8058 body as a form POST", async () => {
  let seen: { url: string; init: RequestInit } | null = null;
  const fetch_impl: FetchLike = async (url, init) => {
    seen = { url, init };
    return new Response("", { status: 200 });
  };

  await performOneClick({ url: "https://example.com/out", fetch_impl });

  expect(seen).not.toBeNull();
  const request = seen as unknown as { url: string; init: RequestInit };
  expect(request.url).toBe("https://example.com/out");
  expect(request.init.method).toBe("POST");
  expect(request.init.body).toBe("List-Unsubscribe=One-Click");
  expect(new Headers(request.init.headers).get("content-type")).toBe("application/x-www-form-urlencoded");
});

test("a 4xx is failed, with the code recorded and nothing thrown", async () => {
  const outcome = await performOneClick({ url: "https://example.com/out", fetch_impl: respondingWith(404) });

  expect(outcome).toEqual({ status: "failed", response_code: 404, error: "HTTP 404" });
});

test("a network error is failed with the message, never a throw", async () => {
  const fetch_impl: FetchLike = async () => {
    throw new Error("ECONNREFUSED");
  };

  const outcome = await performOneClick({ url: "https://example.com/out", fetch_impl });

  expect(outcome).toEqual({ status: "failed", response_code: null, error: "ECONNREFUSED" });
});

test("a request that outlives the timeout is aborted and reported as such", async () => {
  const fetch_impl: FetchLike = (_url, init) =>
    new Promise((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    });

  const outcome = await performOneClick({ url: "https://example.com/out", fetch_impl, timeout_ms: 10 });

  expect(outcome.status).toBe("failed");
  expect(outcome.response_code).toBeNull();
  expect(outcome.error).toBe("timed out after 10 ms");
});
