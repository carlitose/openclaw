---
type: source
title: "Implement descendant popup containment"
identity_key: artifact:ticket-personal-chrome-browser-control-04
identity_strength: stable
source_path: docs/internal/personal-chrome-browser-control/tickets/done/04-implement-descendant-popup-containment.md
source_digest: sha256:29f44ccf09977f7fa9a43956cfccfef336c4f7d43a70527505eba241aef307e2
source_status: present
artefact_kind: ticket
disposition: completed
created: 2026-08-28
updated: 2026-08-28
created_provenance: mtime
disposition_changed:
disposition_changed_provenance: unknown
run_id: personal-chrome-ticket04-main-v3
---

# Implement descendant popup containment

Compiled from `docs/internal/personal-chrome-browser-control/tickets/done/04-implement-descendant-popup-containment.md`. Identity is `artifact:ticket-personal-chrome-browser-control-04`, which is why moving the artefact between dispositions updates this page instead of creating a second one.

## Key takeaways

- Descendant candidacy exists only at tab creation and requires distinct integer child and
  opener IDs plus an opener already inside an exact OpenClaw tab group.
- The handler captures the opener's group before Chrome grouping can erase `openerTabId`.
  Pending children remain unpublished until a meaningful URL is admitted.
- Successful children inherit the exact opener group. Denied, inaccessible, malformed,
  timed-out, closed, or grouping-failed children lose pending state and never become authority.
- Manual ungrouping remains immediate revocation; creation-only inheritance never re-adds a
  revoked child.

The candidate passed unit coverage and real disposable-Chromium behavior for normal and popup
children. See [[concepts/descendant-popup-containment]] for the state model and remaining
Ticket 05 integration boundary.

## Dates

- Created: **2026-08-28** via `mtime` (low confidence)
- Disposition changed: **unknown** — no rung produced a date

## Graph

- Parent source: [[sources/artifact-wayfinder-personal-chrome-browser-control]]

## Run

Completed under autopilot run `personal-chrome-ticket04-main-v3`, taken from the `completion.json` beside the source. That sidecar carries no date, so nothing here is dated from it.
