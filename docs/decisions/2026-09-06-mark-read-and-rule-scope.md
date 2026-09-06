**2026-09-06** — `mark_read` is offered on file and archive rules only. Rules stay global across the four mailboxes. github.com is one domain rule to Notifications, marked read, mentions and review requests included.

**Lost:** mark-read on keep-in-inbox rules; a per-mailbox scope on rules; an exception for GitHub mentions via the X-GitHub-Reason header.

**Why:** the unread badge is the point of keeping mail in the inbox. One rule per sender is the model the existing rules follow, and a scope column would be a migration and a selector for no rule that needs it. GitHub itself shows mentions.
