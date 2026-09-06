import { serverEnv } from "@server/env";

// WAKAPI_API_URL is the full API root, not the host: Wakapi serves the WakaTime-compatible surface under
// `/api/compat/wakatime/v1` while WakaTime itself serves it at `/api/v1`. Putting that whole prefix in
// configuration is exactly what lets the paths below run unchanged against either backend.
//
//   Wakapi    https://wakapi.flext.dev/api/compat/wakatime/v1
//   WakaTime  https://api.wakatime.com/api/v1
export type WakaHeartbeatPayload = {
  id: string;
  entity: string | null;
  language: string | null;
  project: string | null;
  is_write: boolean | null;
  time: number;
};

export type WakaSummaryProject = { name: string; total_seconds: number };

export type WakaSummaryDay = { date: string; projects: WakaSummaryProject[]; total_seconds: number };

export class WakaConfigError extends Error {}

// Both variables are optional in server_env_schema for the reason SCRIPT_SECRET is: a deploy that forgets
// one must not take down sign-in and every other serverEnv() caller. The ingest route answers 503 on this
// error instead, which fails the scheduled job loudly and leaves the rest of the app alone.
const wakaConfig = (): { api_key: string; base_url: string } => {
  const { WAKAPI_API_KEY, WAKAPI_API_URL } = serverEnv();

  if (WAKAPI_API_KEY === undefined || WAKAPI_API_URL === undefined) {
    throw new WakaConfigError("WAKAPI_API_URL and WAKAPI_API_KEY are not configured on this deployment");
  }

  return { api_key: WAKAPI_API_KEY, base_url: WAKAPI_API_URL.replace(/\/+$/, "") };
};

// The raw key is base64-encoded on its own — no "user:" prefix and no trailing colon. That is what the
// verified call in deploy/wakapi/README.md does, and Wakapi rejects the usual user:password framing.
const request = async <T>(path: string): Promise<T> => {
  const { api_key, base_url } = wakaConfig();

  const response = await fetch(`${base_url}${path}`, {
    headers: { Accept: "application/json", Authorization: `Basic ${Buffer.from(api_key, "utf8").toString("base64")}` },
  });

  if (!response.ok) {
    throw new Error(`Wakapi ${path} answered ${response.status} ${response.statusText}`);
  }

  return (await response.json()) as T;
};

// One calendar day, in the tracker's own timezone. Heartbeats are the raw signal and the only thing this
// system stores: Wakapi's computed durations are conservative by construction (heartbeatPadding = 0 in its
// services/duration.go), so the bucketing here derives its own totals rather than inheriting that bias.
export const fetchHeartbeats = async (date: string): Promise<WakaHeartbeatPayload[]> => {
  const body = await request<{ data: WakaHeartbeatPayload[] }>(`/users/current/heartbeats?date=${encodeURIComponent(date)}`);

  return body.data ?? [];
};

// Wakapi's own aggregate, kept for cross-checking the bucketing against the tracker's numbers. The two
// will not agree, and are not meant to — never mix them in one view.
export const fetchSummary = async (input: { from: string; project?: string; to: string }): Promise<WakaSummaryDay[]> => {
  const params = new URLSearchParams({ end: input.to, start: input.from });

  if (input.project !== undefined) {
    params.set("project", input.project);
  }

  const body = await request<{ data: WakaSummaryDay[] }>(`/users/current/summaries?${params.toString()}`);

  return body.data ?? [];
};
