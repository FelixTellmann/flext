**2026-09-06** — flext.dev deploys `main`, and work happens on `main` directly from here on.

**Lost:** keeping `personal-os-architecture` as a long-lived integration branch reached by PR.

**Why:** one developer, and the branch gap let the email engine sit undeployed for two weeks while every decision on record came from laptop runs against the live database. The cron curls flext.dev, so only what `main` serves ever runs.
