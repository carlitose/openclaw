---
type: source
title: "Build the conflict-free isolation harness"
identity_key: artifact:ticket-personal-chrome-browser-control-01
identity_strength: stable
source_path: docs/internal/personal-chrome-browser-control/tickets/done/01-build-conflict-free-isolation-harness.md
source_digest: sha256:8349da20dfcc6352cc7a82a60a5feaad66c288c88905627676e21067bae0b454
source_status: present
artefact_kind: ticket
disposition: completed
created: 2026-08-28
updated: 2026-08-29
created_provenance: git-commit
disposition_changed:
disposition_changed_provenance: unknown
run_id: 54062c213ca9498f-fork-v2
---

# Build the conflict-free isolation harness

Compiled from `docs/internal/personal-chrome-browser-control/tickets/done/01-build-conflict-free-isolation-harness.md`. Identity is `artifact:ticket-personal-chrome-browser-control-01`, which is why moving the artefact between dispositions updates this page instead of creating a second one.

## Key takeaways

- The harness isolates OpenClaw state, configuration, pairing, ports, fixtures, and the Chrome
  profile from the operator's live environment.
- The OpenClaw CLI and candidate extension are the only browser controller. Test observation
  comes from CLI output, fixture traffic, logs, and task-owned files.
- Docker proves the fresh package and relay contract. Native disposable Windows Chrome proves
  MV3 extension behavior that a Linux container cannot establish.
- Cleanup is identity-bound: only processes carrying the verified temporary profile path and
  files under the task root may be removed.

This completed ticket created the evidence foundation described in [[concepts/evidence-lanes]]
and the ownership constraints in [[concepts/task-owned-browser-authority]]. Its replacement
candidate also moved Chrome-for-Testing downloads onto the repository's SSRF-guarded fetch
path instead of weakening the security lint rule.

## Dates

- Created: **2026-08-28** via `mtime` (low confidence)
- Disposition changed: **unknown** — no rung produced a date

## Graph

- Parent source: [[sources/artifact-wayfinder-personal-chrome-browser-control]]

## Run

Completed under autopilot run `54062c213ca9498f-fork-v2`, taken from the `completion.json` beside the source. That sidecar carries no date, so nothing here is dated from it.
