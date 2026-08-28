---
type: source
title: "Enforce task-owned lifecycle and domain policy"
identity_key: artifact:ticket-personal-chrome-browser-control-05
identity_strength: stable
source_path: docs/internal/personal-chrome-browser-control/tickets/05-enforce-task-owned-lifecycle-and-domain-policy.md
source_digest: sha256:70d0ee932185da16a6cadb1b673715d00b30c4507dda645c40613ca2e79b34c2
source_status: present
artefact_kind: ticket
disposition: open
created: 2026-08-26
updated: 2026-08-28
created_provenance: mtime
disposition_changed:
disposition_changed_provenance: unknown
---

# Enforce task-owned lifecycle and domain policy

Compiled from `docs/internal/personal-chrome-browser-control/tickets/05-enforce-task-owned-lifecycle-and-domain-policy.md`. Identity is `artifact:ticket-personal-chrome-browser-control-05`, which is why moving the artefact between dispositions updates this page instead of creating a second one.

## Key takeaways

- Ticket 05 is the current AFK frontier and integrates the completed launcher, popup mechanism,
  and policy decision into one transactional browser lifecycle.
- Root create, group, publish, attach, and adoption must either return one stable logical tab or
  attempt exact physical cleanup and expose both primary and cleanup outcomes.
- Policy must be enforced at every ingress and continuation boundary, including direct relay
  CDP commands, redirects, later URL changes, inventory, and attachment.
- Physical provenance remains independent of managed inventory so timeout or relay loss cannot
  hide an orphan tab.

The required owner model is described by [[concepts/task-owned-browser-authority]]. This work is
not started merely because its dependencies are integrated; its completion gates Ticket 06.

## Dates

- Created: **2026-08-26** via `mtime` (low confidence)
- Disposition changed: **unknown** — no rung produced a date

## Graph

- Parent source: [[sources/artifact-wayfinder-personal-chrome-browser-control]]
