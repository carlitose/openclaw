---
ticket_schema: 1
ticket_id: "06"
execution_mode: AFK
blocked_by:
  - "05"
---

# Prove the packaged flow in isolation

## Artifact Graph

- Artifact ID: `artifact:ticket-personal-chrome-browser-control-06`
- Role: `ticket`
- Parent: [Personal Chrome browser control](../WAYFINDER.md)

## Parent Spec

[Personal Chrome browser control](../WAYFINDER.md)

## What to Build

Freeze one fork candidate, package it through the repository's supported package path, and
run the complete user-visible browser flow without personal state. Use Docker for package,
Gateway, protocol, and synthetic fixture gates, then use native disposable Windows Chrome for
extension install/pair, profile launch, root creation, popup containment, policy, challenge,
reconnect, renderer replacement, revoke, and exact cleanup.

The OpenClaw CLI must be the only browser controller. Produce a redacted verification bundle
that records candidate identity, config shape, process/profile isolation, commands, outcomes,
and the precise claim ceiling.

## Acceptance Criteria

- [ ] The package contains the intended browser plugin, extension, docs, config schema, doctor behavior, and no local installed-runtime patch artifact.
- [ ] Docker starts a packaged Gateway with synthetic config/state and proves relay policy plus typed failure/cleanup contracts.
- [ ] Native Windows starts the configured disposable Chrome profile from zero test Chrome processes and reaches the paired extension relay.
- [ ] From empty controlled inventory, one permitted root opens, is grouped, becomes controllable, and keeps stable task ownership through renderer replacement and relay reconnect.
- [ ] An allowed normal child and OAuth-style popup inherit the exact group; an unrelated and denied child remain private.
- [ ] Allowlist, denylist precedence, SSRF, redirect/final URL, later navigation, direct relay CDP, and manual revoke cases pass.
- [ ] Simulated password/2FA/CAPTCHA/passkey/new-consent/ambiguity states stop with a visible human-boundary result.
- [ ] Success and every injected failure leave zero exact test-owned physical tabs, zero managed targets, no test processes, and no listener/temp residue.
- [ ] Hash/timestamp checks show no personal OpenClaw or Chrome path changed.
- [ ] The evidence explicitly does not claim real provider login, Windows reboot/RDP persistence, or personal-profile acceptance.

## Step-by-Step Implementation Plan

1. Freeze the candidate SHA and build/package inputs.
2. Run changed-scope and browser plugin gates using repository-approved commands.
3. Execute the Docker package/relay matrix with isolated state and local fixtures.
4. Execute the native disposable-Chrome matrix with controller exclusivity enforced.
5. Inject lifecycle and cleanup failures and verify exact residue absence.
6. Compare pre/post protected host paths by safe metadata only.
7. Produce and validate a redacted verification record tied to the frozen candidate.

## Testing Plan

Run every layer 0-2 scenario from the parent map. Repeat the healthy root/popup/cleanup cycle
at least five times and restart the disposable Gateway, extension worker, and Chrome process
within the test boundary. Retain logs and fixture results only; remove profile/state contents.

## Out of Scope

- Windows VM installation, host reboot/RDP, or personal Chrome.
- Real Google/Hattrick account interaction.
- Release, publish, or upstream PR work.
