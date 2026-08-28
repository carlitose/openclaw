---
ticket_schema: 1
ticket_id: "01"
execution_mode: AFK
blocked_by: []
---

# Build the conflict-free isolation harness

## Artifact Graph

- Artifact ID: `artifact:ticket-personal-chrome-browser-control-01`
- Role: `ticket`
- Parent: [Personal Chrome browser control](../WAYFINDER.md)

## Parent Spec

[Personal Chrome browser control](../WAYFINDER.md)

## What to Build

Create the canonical development and test harness for browser-extension work in this fork.
The harness must run OpenClaw with a temporary state/config/workspace and a free Gateway port,
launch a pinned Chrome for Testing with a unique temporary user-data directory and only the
candidate OpenClaw extension, and serve loopback fixtures for a root page, normal child,
popup child, redirects, denied destinations, unsupported authentication challenges, and an
unrelated tab.

The browser must be driven only through the OpenClaw CLI and extension under test. Test
observation must use CLI JSON, fixture HTTP results, logs, and files; it must not attach a
second CDP, MCP, Playwright, Puppeteer, Codex Browser, or Codex Chrome controller.

Reuse the repository's temporary OpenClaw state and process helpers. Add a Docker-backed
package/relay lane for behavior that does not require a Windows extension process, and a
native Windows lane for the MV3/Chrome behavior that Docker cannot establish.

## Acceptance Criteria

- [ ] Every run creates isolated `OPENCLAW_STATE_DIR`, config, workspace, pairing state, and a free non-`18789` Gateway port.
- [ ] The native lane uses a verified task-owned Chrome for Testing profile and loads no extension except the candidate OpenClaw extension.
- [ ] Root, popup, redirect, challenge, denied-domain, and unrelated-tab fixtures run entirely on task-owned loopback servers.
- [ ] The harness refuses to start when any resolved state/profile path equals or contains the operator's live OpenClaw or personal Chrome paths.
- [ ] No test process invokes another browser controller against the disposable Chrome process.
- [ ] Teardown targets only PIDs whose command line contains the resolved temporary profile path and removes only the verified temporary root.
- [ ] A forced failure proves Gateway, Chrome, fixtures, ports, and temporary files are still cleaned up.
- [ ] Focused documentation states exactly which claims belong to Docker, native disposable Chrome, a Windows VM, and final personal-profile acceptance.

## Step-by-Step Implementation Plan

1. Inventory the existing repository state/process, package E2E, browser fixture, and Chrome for Testing helpers and choose the smallest reusable set.
2. Implement one task-root allocator with canonical paths, a free-port allocator, and explicit path-containment assertions.
3. Add the synthetic browser profile, extension install/pair flow, and local fixture server.
4. Add controller-exclusivity checks and observable failure messages for debugger contention.
5. Implement idempotent cleanup for success, assertion failure, timeout, and process crash.
6. Add a narrow Docker package/relay smoke and a native Windows extension smoke.
7. Record exact invocation commands without referring to personal paths, accounts, or secrets.

## Testing Plan

Run harness unit tests, one intentional mid-run failure, one Docker relay smoke, and one
native disposable-Chrome smoke. Verify no listener remains on the selected ports, no process
retains the temporary profile path, and no file under the live OpenClaw or personal Chrome
roots has a changed timestamp attributable to the run.

## Out of Scope

- Personal Chrome, personal OpenClaw config/state, live provider login, Windows reboot, or RDP testing.
- Production launcher, popup, or domain-policy implementation.
- Installing a VM hypervisor.

## Replacement-candidate correction

The first frozen candidate reached hosted fork CI, where OpenGrep correctly rejected the
Windows Chrome-for-Testing downloader because it used raw `fetch`. This replacement ticket
also requires the download to pass through the repository-owned SSRF-guarded fetch path,
retain HTTPS and redirect controls, release the guarded dispatcher after consuming or
rejecting the response, and preserve the pinned archive checksum check. The replacement
candidate must include and revalidate the full harness change; it must not suppress, rename
around, or waive the security rule.
