---
type: synthesis
title: Implementation frontier
created: 2026-08-28
updated: 2026-08-29
sources:
  [
    artifact-wayfinder-personal-chrome-browser-control,
    artifact-ticket-personal-chrome-browser-control-01,
    artifact-ticket-personal-chrome-browser-control-02,
    artifact-ticket-personal-chrome-browser-control-03,
    artifact-ticket-personal-chrome-browser-control-04,
    artifact-ticket-personal-chrome-browser-control-05,
    artifact-ticket-personal-chrome-browser-control-06,
    artifact-ticket-personal-chrome-browser-control-07,
    artifact-ticket-personal-chrome-browser-control-08,
  ]
tags: [status, browser-control, tickets]
related: [evidence-lanes, task-owned-browser-authority]
---

# Implementation frontier

Five of eight tickets are integrated in the fork. Ticket 05 is durably merged at the provider,
Ticket 06 is the active but currently unschedulable verification frontier, and Tickets 07 and
08 remain human-gated.

## Integrated foundation

Ticket 01 provides isolated state, fixtures, direct Docker package-relay proof, native
disposable Windows Chrome, controller exclusivity, and exact cleanup guards. Ticket 02 accepts
the profile-scoped navigation hostname policy and distinguishes it from SSRF exceptions.
Ticket 03 implements exact extension-profile launch and bounded readiness. Ticket 04 implements
creation-time descendant containment and verifies normal and popup children in real disposable
Chromium. Ticket 05 integrates those pieces with hostname policy, direct relay enforcement,
stable task ownership, revocation, and exact cleanup in one canonical lifecycle
[[sources/artifact-ticket-personal-chrome-browser-control-05]].

PR 11 merged the exact authorized Ticket 05 head. The ticket-autopilot ledger still records
the earlier PR head, so its `pr-open` projection is stale bookkeeping rather than provider
truth [[sources/ticket-autopilot-personal-chrome-afk-05-06-main-v1-status]].

## Next AFK work

Ticket 06 now owns the remaining AFK work. Its Apple Silicon package proof passed with native
Apple `container` at 16 GB and no network, and focused extension, native Chromium, and changed
scope checks passed. The packaged Windows probe froze the package successfully but later hit
an intermittent Chrome debugger-detach failure.

The run has consumed all eight unreserved interactions; its two remaining interactions are
reserved for QA execution and verification. It therefore has no schedulable diagnostic step
or PR at present [[sources/ticket-autopilot-personal-chrome-afk-05-06-main-v1-status]].

## Human-gated finish

Ticket 07 requires action-time approval to provision a disposable Windows VM and exercise
interactive logon, restart, RDP, and reboot boundaries. Ticket 08 requires a second immediate
approval for the exact live package, config, profile, harmless test actions, backup, and
rollback. It is the only ticket allowed to touch personal Chrome.

## Current conclusion

The fork has the isolation, policy, launcher, popup, and integrated task-lifecycle foundation.
The complete capability is not finished until Ticket 06 earns its bounded package claim and
the two human-gated acceptance tickets complete. No current evidence establishes restart,
RDP, reboot, or personal-profile behavior.

The durable status answer is [[queries/2026-08-28-where-ticket-work-stands]].

## Sources

- [[sources/artifact-wayfinder-personal-chrome-browser-control]]
- [[sources/artifact-ticket-personal-chrome-browser-control-01]]
- [[sources/artifact-ticket-personal-chrome-browser-control-02]]
- [[sources/artifact-ticket-personal-chrome-browser-control-03]]
- [[sources/artifact-ticket-personal-chrome-browser-control-04]]
- [[sources/artifact-ticket-personal-chrome-browser-control-05]]
- [[sources/artifact-ticket-personal-chrome-browser-control-06]]
- [[sources/artifact-ticket-personal-chrome-browser-control-07]]
- [[sources/artifact-ticket-personal-chrome-browser-control-08]]
- [[sources/ticket-autopilot-personal-chrome-afk-05-06-main-v1-status]]
