---
type: source
title: "Provision the Windows restart lane"
identity_key: artifact:ticket-personal-chrome-browser-control-07
identity_strength: stable
source_path: docs/internal/personal-chrome-browser-control/tickets/07-provision-windows-restart-lane.md
source_digest: sha256:f7f85f6be31270ffff5acc3a702ef28ca4d85b0f28eb58ca3768b1e770d4e04d
source_status: present
artefact_kind: ticket
disposition: open
created: 2026-08-26
updated: 2026-08-28
created_provenance: mtime
disposition_changed:
disposition_changed_provenance: unknown
---

# Provision the Windows restart lane

Compiled from `docs/internal/personal-chrome-browser-control/tickets/07-provision-windows-restart-lane.md`. Identity is `artifact:ticket-personal-chrome-browser-control-07`, which is why moving the artefact between dispositions updates this page instead of creating a second one.

## Key takeaways

- Ticket 07 is human-in-the-loop and cannot begin until Ticket 06 freezes and verifies the
  package candidate.
- Provisioning a Windows VM requires immediate approval of the virtualization product, host
  changes, resource footprint, and rollback path.
- Only synthetic OpenClaw state, pairing, Chrome profile, and credentials may enter the VM.
- The lane owns interactive logon, Gateway and Chrome restart, extension-worker restart, RDP
  disconnect or reconnect where supported, and Windows reboot evidence.

The VM is not a substitute for personal-profile acceptance. It establishes the restart claim
ceiling described in [[concepts/evidence-lanes]] while keeping the operator's real profile and
host outside the test boundary.

## Dates

- Created: **2026-08-26** via `mtime` (low confidence)
- Disposition changed: **unknown** — no rung produced a date

## Graph

- Parent source: [[sources/artifact-wayfinder-personal-chrome-browser-control]]
