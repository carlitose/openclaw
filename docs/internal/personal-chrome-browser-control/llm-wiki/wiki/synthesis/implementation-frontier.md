---
type: synthesis
title: Implementation frontier
created: 2026-08-28
updated: 2026-08-28
sources: [artifact-wayfinder-personal-chrome-browser-control, artifact-ticket-personal-chrome-browser-control-01, artifact-ticket-personal-chrome-browser-control-02, artifact-ticket-personal-chrome-browser-control-03, artifact-ticket-personal-chrome-browser-control-04, artifact-ticket-personal-chrome-browser-control-05, artifact-ticket-personal-chrome-browser-control-06, artifact-ticket-personal-chrome-browser-control-07, artifact-ticket-personal-chrome-browser-control-08]
tags: [status, browser-control, tickets]
related: [evidence-lanes, task-owned-browser-authority]
---

# Implementation frontier

Four of eight tickets are integrated in the fork. The project is halfway through its ticket
graph, but later tickets carry broader behavioral and human-gated evidence.

## Integrated foundation

Ticket 01 provides isolated state, fixtures, direct Docker package-relay proof, native
disposable Windows Chrome, controller exclusivity, and exact cleanup guards. Ticket 02 accepts
the profile-scoped navigation hostname policy and distinguishes it from SSRF exceptions.
Ticket 03 implements exact extension-profile launch and bounded readiness. Ticket 04 implements
creation-time descendant containment and verifies normal and popup children in real disposable
Chromium.

These pieces are independently useful but do not yet form the final transactional product
flow. In particular, completed popup containment does not imply complete domain-policy
delivery, and completed profile launch does not imply task-owned root cleanup.

## Next AFK work

Ticket 05 is the current unblocked frontier. It must integrate launcher, root creation,
descendant containment, hostname policy, SSRF, relay entry points, stable tab ownership,
revocation, and exact descendant-before-root cleanup into one canonical lifecycle. This is the
architectural convergence point described by [[concepts/task-owned-browser-authority]].

Ticket 06 follows only after Ticket 05. It freezes a package candidate and runs the full
isolation matrix. Direct Docker and native Windows have distinct claims; see
[[concepts/evidence-lanes]]. A passing Ticket 06 still cannot claim restart or personal-profile
behavior.

## Human-gated finish

Ticket 07 requires action-time approval to provision a disposable Windows VM and exercise
interactive logon, restart, RDP, and reboot boundaries. Ticket 08 requires a second immediate
approval for the exact live package, config, profile, harmless test actions, backup, and
rollback. It is the only ticket allowed to touch personal Chrome.

## Current conclusion

The fork has the isolation, policy design, launcher, and popup foundations. The complete
capability is not finished until Tickets 05 through 08 land with their own evidence ceilings.
No upstream PR or publication is implied by the fork-only wiki or by the first four merges.

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
