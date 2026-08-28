# Index - Personal Chrome Browser Control

> Fork-only knowledge base for safe task-owned control of one authorized Chrome profile.

## Navigation

[[#Concepts]] · [[#Entities]] · [[#Sources]] · [[#Synthesis]] · [[#Timeline]]

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
- [[sources/artifact-ticket-personal-chrome-browser-control-05]] - open lifecycle and policy integration.
- [[sources/artifact-ticket-personal-chrome-browser-control-06]] - open packaged isolation proof.
- [[sources/artifact-ticket-personal-chrome-browser-control-07]] - human-gated Windows restart lane.
- [[sources/artifact-ticket-personal-chrome-browser-control-08]] - human-gated personal Chrome acceptance.
- [[sources/path-docs-adrs-2026-08-27-browser-navigation-hostname-policy-md]] - accepted hostname-policy ADR.

## Queries

No durable queries yet.

## Comparisons

No comparison pages yet.

## Synthesis

- [[synthesis/implementation-frontier]] - integrated foundation, remaining AFK work, and human gates.

## Timeline

- [[timeline/index]] - dated artefacts and ticket lifecycle records with provenance.

## Open Questions

- Which owner refactor will let Ticket 05 absorb policy and cleanup without parallel runtime paths?
- Which exact package candidate will Ticket 06 freeze after Ticket 05?
- Which Windows virtualization product, if any, will be approved for Ticket 07?
- Which harmless destinations and live mutation boundary will be approved for Ticket 08?
