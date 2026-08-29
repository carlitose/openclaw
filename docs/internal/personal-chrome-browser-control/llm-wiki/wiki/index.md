# Index - Personal Chrome Browser Control

> Fork-only knowledge base for safe task-owned control of one authorized Chrome profile.

## Navigation

[[#Concepts]] · [[#Entities]] · [[#Sources]] · [[#Queries]] · [[#Synthesis]] · [[#Timeline]]

## Concepts

- [[concepts/task-owned-browser-authority]] - exact, revocable tab ownership and cleanup.
- [[concepts/navigation-hostname-policy]] - profile-scoped destination admission composed with SSRF.
- [[concepts/extension-profile-readiness]] - exact Chrome profile launch and relay readiness.
- [[concepts/descendant-popup-containment]] - creation-time child authority and pending URL state.
- [[concepts/evidence-lanes]] - claim boundaries from unit tests through personal acceptance.

## Entities

- [[entities/openclaw-chrome-extension]] - the selected-mode MV3 authority and relay component.

## Sources

- [[sources/artifact-wayfinder-personal-chrome-browser-control]] - canonical project architecture and ticket graph.
- [[sources/artifact-ticket-personal-chrome-browser-control-01]] - completed isolation harness.
- [[sources/artifact-ticket-personal-chrome-browser-control-02]] - completed navigation-policy decision.
- [[sources/artifact-ticket-personal-chrome-browser-control-03]] - completed extension-profile launcher and readiness.
- [[sources/artifact-ticket-personal-chrome-browser-control-04]] - completed descendant containment.
- [[sources/artifact-ticket-personal-chrome-browser-control-05]] - integrated lifecycle and policy owner.
- [[sources/artifact-ticket-personal-chrome-browser-control-06]] - active packaged isolation proof.
- [[sources/artifact-ticket-personal-chrome-browser-control-07]] - human-gated restart lane.
- [[sources/artifact-ticket-personal-chrome-browser-control-08]] - human-gated personal Chrome acceptance.
- [[sources/path-docs-adrs-2026-08-27-browser-navigation-hostname-policy-md]] - accepted hostname-policy ADR.
- [[sources/ticket-autopilot-personal-chrome-afk-05-06-main-v1-status]] - provider, budget, and verification status after PR 11.

## Queries

- [[queries/2026-08-28-where-ticket-work-stands]] - current integrated frontier, evidence, and gates.

## Synthesis

- [[synthesis/implementation-frontier]] - five integrated tickets, Ticket 06 limits, and remaining human gates.

## Timeline

- [[timeline/index]] - dated artefacts and ticket lifecycle records with provenance.

## Open Questions

- Which lifecycle boundary still permits Chrome debugger detach after several successful packaged cycles?
- What explicit budget or diagnostic authority will unblock Ticket 06?
- Which restart environment, if any, will be approved for Ticket 07?
- Which harmless destinations and live mutation boundary will be approved for Ticket 08?
