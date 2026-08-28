---
ticket_schema: 1
ticket_id: "05"
execution_mode: AFK
blocked_by:
  - "02"
  - "03"
  - "04"
---

# Enforce task-owned lifecycle and domain policy

## Artifact Graph

- Artifact ID: `artifact:ticket-personal-chrome-browser-control-05`
- Role: `ticket`
- Parent: [Personal Chrome browser control](../WAYFINDER.md)

## Parent Spec

[Personal Chrome browser control](../WAYFINDER.md)

## What to Build

Integrate the launcher, root creation, popup containment, and ticket `02` domain policy into
one transactional task-owned browser lifecycle. Root create/group/publish/attach must either
return a stable logical tab or remove the exact partial physical tab with a typed cleanup
result. Direct authenticated relay CDP clients, normal OpenClaw navigation, redirects/final
URLs, popup admission, later URL changes, inventory, and attach eligibility must enforce the
same allow/deny and SSRF decisions.

Track provenance independently of managed inventory so timeouts cannot leave physical orphan
tabs. Preserve current upstream relay reconnect and operation-identity owners instead of
reintroducing installed `dist` patches or a standalone alias-manager module.

## Acceptance Criteria

- [ ] Root URLs are policy-checked before `Target.createTarget`; deny overrides allow and SSRF remains cumulative.
- [ ] `createTab` closes its exact new physical tab if group authorization fails before publication.
- [ ] Attach, discovery, policy, timeout, or cancellation failure attempts exact-provenance cleanup and returns both primary and cleanup outcomes.
- [ ] Direct authenticated relay create/navigate commands cannot bypass the canonical domain policy.
- [ ] Redirect/final URLs and later root/child URL changes retire authority on denial before more CDP events are forwarded.
- [ ] Stable logical operation ownership survives only renderer replacement and reconnect for the same authorized tab generation.
- [ ] Manual revoke, different-extension reconnect, tab removal, or access loss invalidates captured task ownership.
- [ ] Cleanup closes task-owned descendants before roots, verifies physical absence by exact IDs, and never closes by URL-wide matching.
- [ ] A healthy readiness/health cycle creates zero technical tabs; any wake/repair page self-removes in `finally`.
- [ ] Agent/tool results distinguish success, human authentication boundary, policy denial, relay/profile failure, and incomplete cleanup with the next safe step.

## Step-by-Step Implementation Plan

1. Trace root creation and cleanup across server context, CDP helper, relay bridge, extension handler, session tab registry, and tool result projection.
2. Implement the ticket `02` config, normalized matcher, protocol delivery, and enforcement owners with any required doctor migration.
3. Make extension root creation compensating and ensure the relay/core retains physical provenance until adoption or cleanup completes.
4. Compose current generation-aware relay identity with a task-owned lifecycle record; do not create a parallel alias system.
5. Add redirect/final/later-navigation policy enforcement and access retirement for roots and descendants.
6. Implement exact descendant-before-root cleanup plus an explicit incomplete-cleanup result.
7. Remove or absorb any duplicate recovery/policy paths uncovered in the owning modules.
8. Add boundary regression tests for every producer failure and the historical orphan/technical-tab cases.

## Testing Plan

Run focused browser plugin tests plus ticket `01` harness scenarios for group failure, attach
failure, relay loss, renderer replacement, denied redirect, denied child, manual revoke,
timeout, cancellation, cleanup failure, and five healthy cycles. Each regression must fail
for the intended reason on the pre-change owner where practical.

## Out of Scope

- Personal-profile acceptance, real provider credentials, Windows VM provisioning, or reboot.
- Site-specific Hattrick recovery logic.
- Publishing an upstream PR or package.
