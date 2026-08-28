---
type: source
title: "Personal Chrome browser control"
identity_key: artifact:wayfinder-personal-chrome-browser-control
identity_strength: stable
source_path: docs/internal/personal-chrome-browser-control/WAYFINDER.md
source_digest: sha256:a5b2cc735ee2d41c86c48e101d1cab83926983ad1eacb22c5b0571c09ce93b8b
source_status: present
artefact_kind: spec
disposition: not-applicable
created: 2026-08-28
updated: 2026-08-28
created_provenance: mtime
disposition_changed:
disposition_changed_provenance: unknown
---

# Personal Chrome browser control

Compiled from `docs/internal/personal-chrome-browser-control/WAYFINDER.md`. Identity is `artifact:wayfinder-personal-chrome-browser-control`, which is why moving the artefact between dispositions updates this page instead of creating a second one.

## Key takeaways

- The initiative controls one explicitly configured Chrome profile through the OpenClaw
  extension while keeping unrelated tabs and personal browser state private.
- The OpenClaw tab group is the visible consent boundary. Task authority additionally depends
  on exact physical tab provenance, lifecycle generation, current policy, and revocation state.
- Authentication automation stops at passwords, OTP, CAPTCHA, passkeys, recovery, new consent,
  and account ambiguity with a visible outcome.
- Evidence is layered: unit/protocol, direct Docker package-relay, native disposable Windows
  Chrome, a human-approved disposable Windows VM, and final personal-profile acceptance.
- Tickets 01 through 04 are integrated in the fork. Tickets 05 and 06 remain AFK; Tickets 07
  and 08 require human action-time approval.

The cross-cutting model is split across [[concepts/task-owned-browser-authority]],
[[concepts/navigation-hostname-policy]], [[concepts/evidence-lanes]], and
[[synthesis/implementation-frontier]].

## Dates

- Created: **2026-08-28** via `mtime` (low confidence)
- Disposition changed: **unknown** — no rung produced a date
