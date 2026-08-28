---
type: source
title: "Accept the candidate on personal Chrome"
identity_key: artifact:ticket-personal-chrome-browser-control-08
identity_strength: stable
source_path: docs/internal/personal-chrome-browser-control/tickets/08-accept-candidate-on-personal-chrome.md
source_digest: sha256:fc4caa6f223ef4d38119a3bf8f4acd5b2f94dc88b96d4929c386b449fecb1f9b
source_status: present
artefact_kind: ticket
disposition: open
created: 2026-08-26
updated: 2026-08-28
created_provenance: mtime
disposition_changed:
disposition_changed_provenance: unknown
---

# Accept the candidate on personal Chrome

Compiled from `docs/internal/personal-chrome-browser-control/tickets/08-accept-candidate-on-personal-chrome.md`. Identity is `artifact:ticket-personal-chrome-browser-control-08`, which is why moving the artefact between dispositions updates this page instead of creating a second one.

## Key takeaways

- Ticket 08 is the only ticket allowed to touch the authorized personal Chrome profile and live
  OpenClaw installation.
- Immediate approval must bind the exact package, extension, config fields, processes, sites,
  test actions, backup, and rollback before mutation.
- The check creates only uniquely tagged harmless tabs, excludes competing controllers, stops
  at every authentication challenge, and never reads unrelated tab contents.
- Acceptance requires exact cleanup plus proof that protected OpenClaw state, Chrome data,
  unrelated tabs, jobs, and settings were unchanged outside the approved surface.

This is the final human gate after Ticket 07. It is intentionally separate from the AFK work
summarized in [[synthesis/implementation-frontier]].

## Dates

- Created: **2026-08-26** via `mtime` (low confidence)
- Disposition changed: **unknown** — no rung produced a date

## Graph

- Parent source: [[sources/artifact-wayfinder-personal-chrome-browser-control]]
