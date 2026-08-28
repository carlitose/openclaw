---
ticket_schema: 1
ticket_id: "07"
execution_mode: HITL
blocked_by:
  - "06"
---

# Provision the Windows restart lane

## Artifact Graph

- Artifact ID: `artifact:ticket-personal-chrome-browser-control-07`
- Role: `ticket`
- Parent: [Personal Chrome browser control](../WAYFINDER.md)

## Parent Spec

[Personal Chrome browser control](../WAYFINDER.md)

## What to Build

With action-time human approval, provision a disposable Windows VM lane for the frozen ticket
`06` candidate. Select an available supported hypervisor or sandbox after checking host
edition/licensing and resource impact. Install only the candidate OpenClaw package, Chrome,
and candidate extension; create synthetic OpenClaw state, a test Chrome profile/account, and
snapshot rollback.

Prove interactive logon startup, Gateway restart, Chrome restart, extension-worker restart,
RDP disconnect/reconnect where supported, and Windows reboot. The VM must never receive the
operator's personal Chrome profile, OpenClaw home, credentials, or pairing data.

## Acceptance Criteria

- [ ] The user approves the exact virtualization product, installation/change, disk footprint, and rollback before host mutation.
- [ ] The VM has an explicit snapshot/restore or disposable-image recovery path.
- [ ] Only synthetic config, state, pairing, browser profile, and test credentials enter the VM.
- [ ] The frozen package starts Gateway and the configured Chrome extension profile after interactive logon.
- [ ] Gateway, Chrome, extension-worker, and full Windows restart scenarios regain the correct relay and preserve only test-profile session state.
- [ ] RDP disconnect/reconnect behavior is recorded without assuming a service can own desktop Chrome.
- [ ] Root, popup, policy, challenge, revoke, and exact cleanup smoke remains green after each supported restart boundary.
- [ ] Competing browser controllers are absent from the VM test profile.
- [ ] The final report states the exact unsupported scenarios and does not overclaim equivalence to the personal host.

## Step-by-Step Implementation Plan

1. Inspect Windows edition, virtualization features, available hypervisors, disk/RAM budget, and licensing without changing host state.
2. Present the exact proposed product and host changes for human approval.
3. Provision the smallest VM, snapshot the clean state, and install the frozen candidate from a verified artifact.
4. Configure synthetic OpenClaw and Chrome extension-profile state without importing personal data.
5. Run startup/restart/RDP/reboot scenarios with redacted evidence and exact cleanup checks.
6. Restore the clean snapshot and prove the test is reproducible.
7. Update the parent map with the verified restart claim ceiling.

## Testing Plan

Run non-disruptive VM smokes first, then request immediate approval for each disruptive
restart/logon boundary. Verify candidate hashes, service/process readiness, relay identity,
controlled inventory, fixture flow, and cleanup after every boundary.

## Out of Scope

- Copying personal config, browser profiles, secrets, or accounts into the VM.
- Rebooting or logging off the physical host.
- Personal-profile acceptance or production automation enablement.
