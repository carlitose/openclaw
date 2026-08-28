---
ticket_schema: 1
ticket_id: "08"
execution_mode: HITL
blocked_by:
  - "07"
---

# Accept the candidate on personal Chrome

## Artifact Graph

- Artifact ID: `artifact:ticket-personal-chrome-browser-control-08`
- Role: `ticket`
- Parent: [Personal Chrome browser control](../WAYFINDER.md)

## Parent Spec

[Personal Chrome browser control](../WAYFINDER.md)

## What to Build

Run the final human-authorized acceptance check on the existing authorized personal Chrome
profile and live OpenClaw installation. Freeze the exact package/extension/config candidate,
disable or exclude every competing browser controller, record protected state, create only
uniquely tagged harmless task tabs, and verify launcher/readiness, root grouping, allowed OAuth
popup containment when available, domain policy, unsupported-challenge boundaries, reconnect,
revoke, and exact cleanup.

No broad live-state migration, cron enablement, Windows reboot, account-security change, or
site mutation is implied. Any required config/package deployment must have an exact backup and
rollback and be approved immediately before application.

## Acceptance Criteria

- [ ] The user approves the exact candidate, files/config fields, processes/tasks, test sites, and rollback immediately before live mutation.
- [ ] Preflight records candidate hashes, Gateway/extension/profile identity, access mode `selected`, scheduled-task state, and exact pre-existing tab IDs without reading unrelated tab contents.
- [ ] No Codex Browser/Chrome control, Chrome MCP, second debugger extension, or other automation client is attached to personal Chrome during the test.
- [ ] From no task-owned root, OpenClaw starts or reaches the configured personal profile and opens one permitted grouped root without manual sharing.
- [ ] An allowed provider child inherits the exact group and returns to visibly authenticated destination UI when no new security challenge appears.
- [ ] A denied/unrelated child remains private, and manual ungroup revokes access immediately.
- [ ] Password, 2FA/OTP, CAPTCHA, passkey, recovery, new consent, and account ambiguity stop without bypass or credential capture.
- [ ] Gateway/extension reconnect preserves same-tab ownership and never adopts an unrelated tab.
- [ ] Cleanup closes only the exact tagged root/children and verifies their physical and managed absence.
- [ ] Protected OpenClaw state, Chrome data, unrelated tabs, jobs, tasks, and settings are unchanged outside the approved candidate/config surface.
- [ ] Any failure rolls back the exact deployed candidate/config and leaves Chrome and Gateway in the recorded safe baseline.

## Step-by-Step Implementation Plan

1. Freeze ticket `07`-verified artifacts and prepare exact deployment, backup, rollback, and test manifests.
2. Perform a read-only live preflight and present the mutation/test boundary for approval.
3. Deploy only the approved package/extension/config changes and restart only the explicitly approved component.
4. Stop or exclude competing browser controllers and prove selected-tab access mode.
5. Run harmless root, popup/authentication, policy, revoke, reconnect, and cleanup checks through the OpenClaw CLI.
6. Stop at any human authentication boundary and record it without capturing sensitive content.
7. Verify exact cleanup and protected-state invariants; rollback on any critical failure.
8. Reduce the final verification record and update the Wayfinder definition of done.

## Testing Plan

Use neutral and read-only destinations plus an operator-approved account chooser if it appears
naturally. Never submit Hattrick bids, purchases, calendar writes, account settings, consent,
or security changes. Capture redacted outcomes and exact test-owned identifiers only.

## Out of Scope

- Bypassing authentication challenges or storing credentials.
- Reading unrelated tabs or copying the personal Chrome profile.
- Enabling unrelated automations, watchdogs, health tasks, or cron jobs.
- Physical-host Windows reboot/RDP claims unless separately authorized in a new ticket.
- Upstream PR, package release, or publication.
