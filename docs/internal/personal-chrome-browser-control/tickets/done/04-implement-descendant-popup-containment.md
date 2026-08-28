---
ticket_schema: 1
ticket_id: "04"
execution_mode: AFK
blocked_by:
  - "01"
  - "02"
---

# Implement descendant popup containment

## Artifact Graph

- Artifact ID: `artifact:ticket-personal-chrome-browser-control-04`
- Role: `ticket`
- Parent: [Personal Chrome browser control](../WAYFINDER.md)

## Parent Spec

[Personal Chrome browser control](../WAYFINDER.md)

## What to Build

Add first-class descendant containment to the current upstream Chrome extension. A new tab is
a candidate only at `chrome.tabs.onCreated`, only when it has distinct integer child/opener
IDs, and only when the opener is already in an exact OpenClaw tab group. Capture the opener's
group ID before Chrome can clear `openerTabId`. Apply the domain-policy decision from ticket
`02`, reuse that exact group ID, synchronize inventory only after success, and fail closed.

Implement the feature as a normal extension module and dependency-injected event handler.
Do not carry forward the old generated background-source patcher. Preserve selected-mode
manual revoke, agent-created root behavior, MV3 reconnect, pairing, all-tabs behavior for
unrelated existing tabs, and extension-page exclusion.

## Acceptance Criteria

- [ ] A normal child and a popup-window child of a grouped opener inherit the opener's exact group after policy approval.
- [ ] Missing, null, same-as-child, ungrouped, wrong-title, denied, or inaccessible openers/children remain unpublished and unattached.
- [ ] A child with no meaningful URL retains only bounded pending ancestry state and is not exposed before approval.
- [ ] Grouping failure, tab closure, timeout, or policy failure clears pending state and reports no successful inheritance.
- [ ] Manual ungrouping immediately revokes access and creation-only inheritance never re-adds the child.
- [ ] A later denied navigation retires authority before subsequent CDP events can reach the relay.
- [ ] Unrelated existing tabs and descendants of non-grouped tabs remain private in selected mode.
- [ ] MV3 worker restart and relay reconnect do not duplicate listeners, re-inherit revoked tabs, or lose an authorized grouped child.
- [ ] Unit and native disposable-Chrome tests cover the historical Chrome popup move behavior without a real provider.

## Step-by-Step Implementation Plan

1. Read complete tab-access, group, relay command, background wiring, eligibility, and package contract modules/tests.
2. Define a small descendant-pending state machine and inject the ticket `02` policy evaluator.
3. Generalize group placement to accept an exact existing group ID without duplicating root-group creation.
4. Register one creation listener through `registerTabAccessEvents` or the nearest owning lifecycle module.
5. Invalidate and detach on denied later navigation using the existing access epoch owner.
6. Add unit coverage for positive, negative, race, revoke, worker restart, and cleanup paths.
7. Run the normal/popup/unrelated fixture through the ticket `01` native harness.

## Testing Plan

Use fake Chrome APIs for deterministic ordering and the native harness for actual Chrome
group/window behavior. Assert group IDs, relay inventory, debugger attach/detach, pending-state
cleanup, and absence of unrelated tab access. Run existing extension package and access-policy
tests to protect pairing and revoke behavior.

## Out of Scope

- Live Google or Hattrick login.
- Profile launcher implementation.
- Broad automatic sharing based on URL, window, or active tab.
- Embedding OAuth UI in extension pages.

## Replacement-candidate correction

The second candidate passed the real hosted Linux browser-extension shard, including the
managed Chromium launch repair, but exact-head CI found that the root package-script contract
still expected only the bootstrap test. Update that canonical assertion to include the
descendant-containment Chromium test now owned by `test:e2e:browser-extension`, reproduce the
failure before editing, and re-run the focused contract test plus the full candidate gates.
Do not weaken the exact command assertion or remove either real-Chromium test target.
