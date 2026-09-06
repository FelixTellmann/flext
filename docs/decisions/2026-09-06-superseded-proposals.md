**2026-09-06** — when a move is recorded as applied for a message, every other proposal (shadow row) for that message is marked `superseded` in the same step. The tick never promotes a superseded row, the shadow page does not count it, the journal still shows it with its reason. Proposals already stale on the server (their message was moved by another path) are stamped once by an operator script.

**Lost:** skipping such rows at promotion time and hiding them on the shadow page; deleting the older proposal.

**Why:** with the 7-day rule live on every mailbox and the unsubscribe button archiving whole senders, a message routinely carries a proposal from two rules; the loser's row would otherwise be promoted against a message that has moved, fail, and eat the tick's budget. A status keeps the counts honest without a delete and without every count remembering an exception.
