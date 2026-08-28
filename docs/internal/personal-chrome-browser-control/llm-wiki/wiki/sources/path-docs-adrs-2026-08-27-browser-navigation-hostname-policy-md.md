---
type: source
title: "Browser navigation hostname policy"
identity_key: path:docs/adrs/2026-08-27-browser-navigation-hostname-policy.md
identity_strength: weak
source_path: docs/adrs/2026-08-27-browser-navigation-hostname-policy.md
source_digest: sha256:b31b23530a9ee74bcce5b51af6901bb0e6bc0fae94bd81d1dc9c664e9a4eddcb
source_status: present
artefact_kind: other
disposition: not-applicable
created: 2026-08-28
updated: 2026-08-28
created_provenance: git-commit
disposition_changed:
disposition_changed_provenance: unknown
---

# Browser navigation hostname policy

Compiled from `docs/adrs/2026-08-27-browser-navigation-hostname-policy.md`. Identity is `path:docs/adrs/2026-08-27-browser-navigation-hostname-policy.md`, which is why moving the artefact between dispositions updates this page instead of creating a second one.

**This artefact has no stable identifier.** It carries neither a ticket envelope nor an `## Artifact Graph`, so its identity is its path at first ingest. Moving it will read as a deletion plus a creation, and the repair is to give the source an `## Artifact Graph`.

## Key takeaways

- `browser.profiles.<name>.navigationPolicy` owns optional `allowHostnames` and
  `denyHostnames`; missing or empty allow preserves otherwise-safe public browsing, while deny
  always wins.
- Hostnames are normalized deterministically, wildcard entries match proper subdomains only,
  URL ports do not participate, and unsupported or credential-bearing URLs fail closed.
- Navigation policy and SSRF are cumulative controls. Neither list can bypass the other.
- One pure matcher source is shared by Node and MV3. A connection-bound authenticated relay
  installation keeps the extension policy volatile and prevents reconnect drift.
- Enforcement belongs at root and direct-CDP preflight, redirect and final URL inspection,
  child admission, later URL revocation, inventory, attachment, and command forwarding.

The decision is accepted for Tickets 04 and 05. Its runtime semantics are summarized in
[[concepts/navigation-hostname-policy]].

## Dates

- Created: **2026-08-28** via `git-commit`
- Disposition changed: **unknown** — no rung produced a date
