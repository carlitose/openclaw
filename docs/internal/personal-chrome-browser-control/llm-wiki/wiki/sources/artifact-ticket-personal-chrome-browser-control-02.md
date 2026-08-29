---
type: source
title: "Decide the browser domain-policy seam"
identity_key: artifact:ticket-personal-chrome-browser-control-02
identity_strength: stable
source_path: docs/internal/personal-chrome-browser-control/tickets/done/02-decide-browser-domain-policy-seam.md
source_digest: sha256:1ef548ac90c40851dfce6587b5986b3c410127ef0151aa880d4c30f846329b3a
source_status: present
artefact_kind: ticket
disposition: completed
created: 2026-08-28
updated: 2026-08-29
created_provenance: git-commit
disposition_changed:
disposition_changed_provenance: unknown
run_id: personal-chrome-ticket02-main-v3
---

# Decide the browser domain-policy seam

Compiled from `docs/internal/personal-chrome-browser-control/tickets/done/02-decide-browser-domain-policy-seam.md`. Identity is `artifact:ticket-personal-chrome-browser-control-02`, which is why moving the artefact between dispositions updates this page instead of creating a second one.

## Key takeaways

- A browser allowlist is exclusive admission policy; `ssrfPolicy.allowedHostnames` remains a
  private-network exception and must not be reinterpreted.
- One profile-scoped compiled matcher owns exact and wildcard hostname normalization, deny
  precedence, unsupported URLs, and the bounded `about:blank` bootstrap state.
- Gateway and MV3 must consume the same deterministic policy. The authenticated relay installs
  it per connection; the extension never persists a second copy.
- Enforcement spans root create, direct relay CDP, redirects and final URLs, popup admission,
  later navigation, inventory, and debugger attachment.

The accepted outcome is expanded in
[[sources/path-docs-adrs-2026-08-27-browser-navigation-hostname-policy-md]] and summarized by
[[concepts/navigation-hostname-policy]].

## Dates

- Created: **2026-08-28** via `mtime` (low confidence)
- Disposition changed: **unknown** — no rung produced a date

## Graph

- Parent source: [[sources/artifact-wayfinder-personal-chrome-browser-control]]

## Run

Completed under autopilot run `personal-chrome-ticket02-main-v3`, taken from the `completion.json` beside the source. That sidecar carries no date, so nothing here is dated from it.
