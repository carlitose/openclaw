---
type: source
title: "Implement extension-profile launch and readiness"
identity_key: artifact:ticket-personal-chrome-browser-control-03
identity_strength: stable
source_path: docs/internal/personal-chrome-browser-control/tickets/done/03-implement-extension-profile-launch-and-readiness.md
source_digest: sha256:e81a08030705ae618ba31a81261d166e6c8936a7f3b17f9caa563ae2224b8c9e
source_status: present
artefact_kind: ticket
disposition: completed
created: 2026-08-28
updated: 2026-08-28
created_provenance: mtime
disposition_changed:
disposition_changed_provenance: unknown
run_id: personal-chrome-ticket03-main-v2
---

# Implement extension-profile launch and readiness

Compiled from `docs/internal/personal-chrome-browser-control/tickets/done/03-implement-extension-profile-launch-and-readiness.md`. Identity is `artifact:ticket-personal-chrome-browser-control-03`, which is why moving the artefact between dispositions updates this page instead of creating a second one.

## Key takeaways

- Extension-driver profiles can name one executable, user-data root, and Chrome profile
  directory without storing account identity or credentials.
- A healthy expected relay is a no-op. An unavailable relay may trigger at most one exact
  profile launch and one bounded readiness wait shared by concurrent callers.
- Wrong, absent, ambiguous, unpaired, failed, and timed-out profiles remain distinct typed
  outcomes with a safe operator next step.
- The path never falls back to managed Chrome, existing-session profiles, Chrome MCP, profile
  copying, or broad process termination.

This completed ticket owns launch and readiness only. Transactional tab authority remains in
Ticket 05; see [[concepts/extension-profile-readiness]] and
[[synthesis/implementation-frontier]].

## Dates

- Created: **2026-08-28** via `mtime` (low confidence)
- Disposition changed: **unknown** — no rung produced a date

## Graph

- Parent source: [[sources/artifact-wayfinder-personal-chrome-browser-control]]

## Run

Completed under autopilot run `personal-chrome-ticket03-main-v2`, taken from the `completion.json` beside the source. That sidecar carries no date, so nothing here is dated from it.
