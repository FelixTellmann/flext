# Evening digest — iOS Shortcut automation

`GET /api/os-digest` returns one or two lines of **plain text** describing the day: what was
done, what is still open, how much was tracked, and on a Sunday that the week's review is open.

It is the only push this system sends, and it is deliberately one-way. Nothing in it asks for a
decision and there are no actions to take — a notification that wanted something back would be an
obligation, which is the one thing it must never be.

## Why a Shortcut and not a real push

Decided 2026-08-28. APNs would deliver whether or not the phone is touched, but it needs an Apple
developer account, a device token, certificate handling and a push subscription — materially more
infrastructure than anything else here, for one message a day.

The Shortcut route reuses the `SCRIPT_SECRET` bearer pattern capture already uses and needs none
of that. **Its limitation is accepted:** a personal automation fires reliably only when the phone
is unlocked, so the digest can arrive late. That is fine precisely because it is informational and
never an obligation. A late one-way message costs nothing; a missed obligation would cost trust.

## Building the automation

On the phone: **Shortcuts → Automation → New → Time of Day**.

1. **Time of Day**, around 21:00, **Daily**, and turn **Run Immediately** on (otherwise iOS asks
   permission each evening, which makes it an obligation).
2. Add **Get Contents of URL**:
   - **URL** `https://flext.dev/api/os-digest`
   - **Method** `GET`
   - **Headers** → add `Authorization` with value `Bearer <SCRIPT_SECRET>`
3. Add **Show Notification** with the body set to the **Contents of URL** variable from step 2.

That is the whole automation. The endpoint answers `text/plain`, so nothing needs parsing and the
notification body is the response verbatim.

## The secret

The same `SCRIPT_SECRET` the mail sync and the heartbeat ingest use, read from Coolify on the
flext.dev application. Storing it in a Shortcut means it lives in iCloud — acceptable for a
read-only endpoint that exposes counts and nothing else, and the reason this endpoint deliberately
returns no task titles.

## Responses

| Status | Meaning | Action |
| --- | --- | --- |
| `200` | The digest, as plain text. | none |
| `401` | `SCRIPT_SECRET` mismatch. | check the header in the Shortcut |
| `503` | `SCRIPT_SECRET` is unset on the deployment. | set it in Coolify and redeploy |

A `401` or `503` shows as the error text in the notification rather than failing silently, which
is deliberate: a digest that quietly stopped arriving would be indistinguishable from a quiet day.

## What it deliberately does not say

- **No task titles.** The secret lives in iCloud, so the response stays to counts.
- **Never "overdue" or "due".** The weekly review is offered on Sunday and stays offered; it is not
  late on Monday. The line reads *"open when you want it"* and disappears the rest of the week.
- **No streak, no score.** §16 rule 5 — no streak is ever the primary metric.
