**2026-09-06** — xneelo's spam filter stays on. Whatever it diverts into Junk or spambucket is moved to our Quarantine folder and marked read. Nothing spam-shaped is ever deleted automatically.

**Lost:** fetching `X-Spam-*` headers and scoring in our own ladder; disabling the filter and relying on first-contact rules alone.

**Why:** the generic sync already walks every selectable folder on that server every 15 minutes, so the folder is the verdict and no header is needed. Quarantine is ours and never purged; xneelo does not document how long Junk is kept. The filter was originally switched off because it lost mail, and a move-not-delete rule removes that failure mode.
