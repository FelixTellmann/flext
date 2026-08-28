# Personal OS — heartbeat ingest schedule

`POST /api/os-ingest` pulls heartbeats from Wakapi, upserts them into
`WakaHeartbeat`, and rebuilds `ActivityBucket` for the days it touched. The allocation
ledger reads only the buckets, so nothing appears on that screen until this has run.

> Named `os-ingest` rather than `personal-os-ingest`: the pre-push guard
> (`scripts/guard-private-paths.sh`) refuses any tracked path matching `personal-os`, a
> pattern meant for personal content that also catches a public route file. Renaming the
> file was the fix; weakening the guard was not.

## Prerequisites

1. Migration `0014_ordinary_angel.sql` applied (`bun run db:migrate`). Without it the job
   fails on the first insert.
2. Three environment variables on the **flext.dev application** in Coolify:

   | Variable | Value |
   | --- | --- |
   | `WAKAPI_API_URL` | `https://wakapi.flext.dev/api/compat/wakatime/v1` |
   | `WAKAPI_API_KEY` | Wakapi → Settings → the API key |
   | `SCRIPT_SECRET` | already set — the same secret the mail sync uses |

   `WAKAPI_API_URL` is the **full API root, not the host**. Wakapi serves the
   WakaTime-compatible surface under `/api/compat/wakatime/v1`; WakaTime itself serves it
   at `/api/v1`. Keeping the whole prefix in configuration is what lets one client run
   against either. Verified: both compat paths answer `401` unauthenticated, while
   `/api/v1/...` on Wakapi answers `405` — that is the write path the editor plugin posts to.

   Both Wakapi variables are optional in `server/env.ts` on purpose. Only this endpoint
   reads them, and a deploy that forgot one must not take down sign-in and every other
   `serverEnv()` caller. Missing configuration answers `503`, which fails this task loudly
   and leaves the rest of the application alone.

## The scheduled task

Coolify → project **flext.dev** → the application → **Configuration → Scheduled Tasks**.

| Field | Value |
| --- | --- |
| Name | `os-ingest` |
| Frequency | `0 * * * *` |
| Container name | **leave empty** |

Command — one line:

```
bun -e 'const r = await fetch("http://127.0.0.1:3000/api/os-ingest?days=3", {method:"POST",headers:{authorization:"Bearer "+process.env.SCRIPT_SECRET}}); console.log(r.status, await r.text()); process.exit(r.ok?0:1)'
```

Three details that are not stylistic:

- **`bun -e`, not `curl`.** curl is not in the image; the Dockerfile omits it deliberately.
- **`127.0.0.1:3000`**, not the public hostname — it skips DNS, TLS and the proxy, so the
  task cannot fail for reasons that have nothing to do with the job.
- **`process.exit(r.ok?0:1)`** is what turns a `503` into a red task. Without it Coolify
  reports success no matter what the endpoint answered.
- Single quotes outside, double quotes inside, no backticks or `${}` — this survives
  Coolify's own quoting.
- **Leave "Container name" empty.** The per-deploy suffix changes on every redeploy and a
  pinned name silently stops matching.

## Why hourly, and why three days

The window overlaps itself on purpose. A heartbeat can reach Wakapi late — a laptop that
was offline, a dual-write that retried — and re-reading the last three days is the only way
an hourly job ever notices. The unique index on `WakaHeartbeat.sourceId` makes that free:
re-reading a heartbeat is an update, never a duplicate.

Buckets are rebuilt rather than patched for the same window. They are derived data and safe
to recompute; patching would leave a bucket whose shares no longer sum to one the moment a
project-normalisation rule changes — and the alias map in
`server/wakatime/bucket-heartbeats.ts` is expected to change, because it is the part a human
corrects.

## Reading the response

```json
{ "days": ["2026-08-26", "2026-08-27", "2026-08-28"], "heartbeats_seen": 4211, "buckets_written": 137 }
```

- `heartbeats_seen` counts what Wakapi returned, not what changed. On a steady hourly
  schedule it stays roughly flat; a sudden zero across all three days means the API key or
  the URL is wrong, not that no work happened.
- `buckets_written` is the number of `(bucket_start, project)` rows the window now holds.

| Status | Meaning | Action |
| --- | --- | --- |
| `200` | Ran. See the body. | none |
| `400` | `days` outside 1–14. | fix the command |
| `401` | `SCRIPT_SECRET` mismatch. | check the variable on both sides |
| `503` | `SCRIPT_SECRET` or the Wakapi variables are unset. | set them and redeploy |

## Backfilling history

Phase 1 imported the full WakaTime history into Wakapi (2017-10-31 onward, ~10,353 hours),
but this endpoint only ever reads a recent window. To pull older days into `WakaHeartbeat`,
raise `days` on a one-off manual run rather than on the schedule:

```
?days=14
```

The cap is 14 deliberately. A larger window is a long-running request that would hold a
connection open and time out behind the proxy; a real backfill wants its own script that
pages day by day, which Phase 3 does not need and therefore does not have.

## A number never to mix with these

Wakapi's own summaries are conservative by construction — `heartbeatPadding = 0` in its
`services/duration.go` credits nothing to a session's final heartbeat, measured at roughly
78–81% of WakaTime's hours on dense days and worse on fragmented ones. The ledger computes
its own totals from raw heartbeats and inherits none of that bias. The two figures will not
agree, and are not meant to: never show them in the same view.
