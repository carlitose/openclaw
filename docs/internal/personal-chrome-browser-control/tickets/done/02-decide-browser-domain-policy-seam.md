---
ticket_schema: 1
ticket_id: "02"
execution_mode: AFK
blocked_by:
  - "01"
---

# Decide the browser domain-policy seam

## Artifact Graph

- Artifact ID: `artifact:ticket-personal-chrome-browser-control-02`
- Role: `ticket`
- Parent: [Personal Chrome browser control](../WAYFINDER.md)

## Parent Spec

[Personal Chrome browser control](../WAYFINDER.md)

## What to Build

Produce an evidence-backed architecture decision for optional browsing allow and deny lists.
The decision must distinguish a true exclusive hostname allowlist from
`ssrfPolicy.allowedHostnames`, which currently authorizes otherwise restricted network
destinations. It must identify one policy owner and one normalized matcher that can protect
root creation, direct authenticated relay CDP commands, redirects/final URLs, extension popup
admission, later tab URL changes, inventory publication, and debugger attachment.

Prototype the difficult creation-time states in the ticket `01` harness: missing URL,
`about:blank` bootstrap, first meaningful `pendingUrl`, allowed redirect, denied redirect,
deny-over-allow precedence, wildcard matching, and a child that changes to a denied hostname
after grouping.

## Acceptance Criteria

- [ ] The decision documents the current semantics and call sites of `allowedHostnames`, internal `hostnameAllowlist`, and browser navigation guards.
- [ ] One canonical config shape is selected with empty/unset allow behavior, wildcard semantics, deny precedence, IDNA/case normalization, and compatibility consequences.
- [ ] One runtime policy representation and matcher owner are selected; Gateway and extension do not maintain independent drifting configs.
- [ ] The design explains authenticated relay policy delivery and reconnect behavior without persisting secrets or policy copies in extension storage.
- [ ] Root, redirect/final, direct-CDP, popup pending-URL, subsequent navigation, inventory, and attach enforcement points are all assigned to an owner.
- [ ] A fail-closed rule is defined for URLs that are missing, malformed, unsupported, or denied.
- [ ] The prototype demonstrates that an allowed OAuth-style `about:blank` child can wait without being published and that a denied child is never controllable.
- [ ] The decision states whether a config migration/doctor rule is required and why the new config surface passes the repository's high bar.

## Step-by-Step Implementation Plan

1. Read the complete navigation guard, SSRF matcher, browser config resolver/schema, relay protocol, extension access policy, and all owning tests.
2. Trace every production path that creates or navigates a target, including external authenticated relay CDP clients.
3. Compare extending the shared `hostnameAllowlist`, adding browser-specific navigation policy, and profile-scoped policy while preserving SSRF semantics.
4. Prototype pending-child and deny-after-allow sequences in the isolated harness.
5. Record the chosen owner, config, protocol, state transitions, migration, and error contract in a focused decision artifact.
6. Update the parent map with any changed blocking edges before implementation starts.

## Testing Plan

Use table-driven matcher tests and harness scenarios for exact hosts, wildcard subdomains,
bare suffix rejection, mixed case, IDNA, explicit port, deny-over-allow, redirect to denied,
and `about:blank` to allowed/denied. Prove `ssrfPolicy.allowedHostnames` keeps its current
network-exception semantics.

## Out of Scope

- Implementing the final config/runtime/extension change.
- Personal host configuration or real OAuth providers.
- A general web-content filtering product beyond hostname admission.

## Replacement-candidate correction

The original candidate passed ticket-local verification but the hosted `check-dependencies`
lane found the prototype unreferenced by Knip. Register
`scripts/e2e/personal-chrome-domain-policy-prototype.mts` as a named root `package.json`
script and verify both that script and the full dependency check. Do not add a Knip exemption,
rename the prototype, or add production behavior.
