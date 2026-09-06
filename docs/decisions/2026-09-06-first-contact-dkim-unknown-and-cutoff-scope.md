**2026-09-06** — two corrections from live counts, made before phase 4 was built. A first contact with no DKIM verdict is not disqualified from human-shaped; only a failed signature is. The "arrived after the switch" cutoff applies to first-contact quarantine only; the settled and declined sweeps drain their existing proposals when switched on, the way a policy does.

**Lost:** requiring `dkim_aligned === true` (the 2026-09-06 first-contact decision); the cutoff on all three scheduled sources (the 2026-09-06 autonomy decision).

**Why:** xneelo stamps no Authentication-Results on 9,971 of 10,697 tellmann messages, so a passing-signature requirement would quarantine nearly every real person on the one mailbox going live. The sweeps' old proposals were made by the same rule being switched on, so there is nothing for a cutoff to protect; the 245 waiting rows drain in two ticks.
