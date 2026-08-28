---
ticket_schema: 1
ticket_id: "03"
execution_mode: AFK
blocked_by:
  - "01"
---

# Implement extension-profile launch and readiness

## Artifact Graph

- Artifact ID: `artifact:ticket-personal-chrome-browser-control-03`
- Role: `ticket`
- Parent: [Personal Chrome browser control](../../WAYFINDER.md)

## Parent Spec

[Personal Chrome browser control](../../WAYFINDER.md)

## What to Build

Implement a browser-plugin-owned, explicitly configured launcher for `driver: "extension"`
profiles. When the correct paired relay is already ready, the path is a no-op. When the
relay is unavailable and launch is configured, OpenClaw starts the exact Chrome executable,
user-data directory, and Chrome profile directory, then waits within one bounded deadline for
the expected extension relay identity.

The implementation must reuse existing browser profile fields and discovery where coherent,
add only the minimum new profile-selection surface, and provide validation/doctor behavior
for invalid or legacy config. It must not turn the extension profile into a managed-CDP
profile, use Chrome MCP, copy a profile, kill Chrome, or fall back to another browser profile.

## Acceptance Criteria

- [ ] A configured extension profile identifies one executable, user-data root, and Chrome profile directory without an account address or credential.
- [ ] `ensureBrowserAvailable` returns without launching when the correct paired extension relay is healthy.
- [ ] A missing relay triggers at most one exact-profile launch and a bounded readiness wait.
- [ ] Wrong, absent, ambiguous, or unpaired profiles return distinct typed/redacted diagnostics with a safe next step.
- [ ] Chrome command arguments contain no account address, pairing key, password, token, or live OpenClaw secret.
- [ ] The path never invokes managed profile `openclaw` or existing-session profile `user` as a fallback.
- [ ] Repeated concurrent opens coalesce around one launch/readiness operation rather than starting multiple Chrome processes.
- [ ] Tests use the ticket `01` disposable profile and prove no process or file under personal Chrome is touched.
- [ ] User-facing docs and doctor output explain the interactive-Windows-session requirement and manual extension installation boundary.

## Step-by-Step Implementation Plan

1. Trace extension-profile resolution, availability, install/status discovery, control-service startup, and Windows Chrome layout owners.
2. Define the smallest config change and add validation plus any required doctor migration.
3. Implement a profile-scoped launch/readiness coordinator with one deadline and concurrent-call coalescing.
4. Reuse installed extension/profile discovery to verify that the connected relay is the configured profile.
5. Add typed failure mapping and agent-facing next-step text.
6. Test no-op ready, successful cold launch, concurrent open, wrong profile, missing extension, launch failure, timeout, and cancellation.
7. Verify the native disposable-Chrome path end to end without loading any personal state.

## Testing Plan

Run focused config, profile, availability, doctor, process-lifecycle, and native harness tests.
Capture exact spawned arguments with synthetic paths and prove a second request does not spawn
a second process. Confirm cleanup stops only the harness-owned Chrome process.

## Out of Scope

- Automatic installation of an unpacked extension into personal Chrome.
- Windows automatic logon, service-session browser launch, reboot, or RDP recovery.
- Popup inheritance and domain-policy implementation.

## Replacement-candidate correction

The first frozen candidate reached hosted fork CI, where `lint:docker-e2e` correctly rejected
the isolation harness's direct import from `src/test-utils/ports.js`. This replacement ticket
must preserve the complete Ticket 03 implementation while routing the deterministic port
allocator through the existing packaged `openclaw/plugin-sdk/test-state` seam, adding the
narrow re-export contract test, and passing the Docker E2E package-boundary guard. It must not
duplicate the allocator in the harness or exempt the harness from the boundary rule.
