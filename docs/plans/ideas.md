# Ideas

Unsorted backlog. One bullet per idea; date + one-line summary. Promote to a spec/plan in `docs/plans/` when picked up.

- 2026-07-24 — `src/routes/posts/redesign.tsx` is an unfinished draft shipped live: `BlogHeader` renders `<div>asd</div>`, an `href` contains the literal placeholder text "link to 2.0 themes", two anchors have no destination (biome-ignored as draft), and lists are nested inside `<p>` (invalid HTML). Finish or unpublish.
- 2026-07-24 — Dead CTA: "Lets work" button in `header.mobile-nav.tsx` has no onClick handler.
- 2026-07-24 — Latent OAuth bugs in `server/auth/oauth.ts` (no consumers yet): GitHub users with private emails return `email: null` (needs a `/user/emails` fetch; currently coerced to `""`, breaking account-matching by email); Twitter config points at OAuth 1.0a endpoints while `fetchUserProfile` sends a Bearer header; `exchangeCodeForToken` doesn't check `response.ok` (GitHub returns 200 + error body — now surfaced as a thrown error).
- 2026-07-24 — Small pre-existing runtime bugs found during the strict-mode audit (all behavior-preserving-skipped): malformed transition duration `0.0.2s` in `header.desktop-nav.hover-effect.tsx:51/75` (browser drops the declaration), `removeToast(toast?.id)` callable with `undefined` in `toast.tsx:97`, delete-loop off-by-one in `typewriter.tsx:71`.
- 2026-07-24 — Migrate react-tooltip v4 → v6 (held at ^4.5.1 in upgrade-packages): v6 replaces `getContent`/`data-tip` with anchored `<Tooltip>` + data attributes; touches the tooltip store + 9 components.
- 2026-07-24 — Replace the dead PlanetScale free tier: options analysis lives in `specs/active/2026-07-24-database-replacement-design.md` (Turso / Neon / PlanetScale Scaler Pro / local MySQL). Decision still open.
