---
kind: source
captured_at: 2026-08-29T17:43:00+02:00
run_id: personal-chrome-afk-05-06-main-v1
integrated_source_head: 90d3077f94490541eb67a96a1d01cb25d45e9a40
---

# Ticket-autopilot and provider status receipt

This receipt records the normalized state observed after merging PR 11. It contains no
credentials, browser-profile contents, or personal browsing data.

## Provider integration

- PR: [carlitose/openclaw#11](https://github.com/carlitose/openclaw/pull/11)
- Authorized PR head: `4f299f42108b728690e4f43088b08be14c9f66ea`
- Provider state: `MERGED`
- Merge commit: `90d3077f94490541eb67a96a1d01cb25d45e9a40`
- Merged at: `2026-08-29T15:25:05Z`
- The ticket-autopilot ledger still records the earlier PR head
  `8a7fe92c3a6fac2b0cc63cee73d3ecba3908f87b`; exact-head external reconciliation rejected
  the newer head as stale. Provider integration is therefore durable while ledger
  reconciliation remains outstanding.

## Ticket frontier

| Ticket | Observed state                                   | Evidence                                                                                                                |
| ------ | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| 05     | Provider-integrated; ledger still says `pr-open` | PR 11 and exact merge readback                                                                                          |
| 06     | `active`, stage `review`, not schedulable        | Generation 8; 8/10 interactions consumed; the two remaining interactions are reserved for QA execution and verification |
| 07     | Human-gated                                      | Open gate `gate:07:start:1`                                                                                             |
| 08     | Human-gated                                      | Open gate `gate:08:start:2`                                                                                             |

Ticket 06 has no PR. Its current branch head is
`85e4964b7c58a479a4afa899a50a89d3a03a9805`.

## Isolation evidence

- Apple Silicon package proof passed with native Apple `container`, Linux ARM64, 16 GB RAM,
  8 CPUs, and no network. No Docker command was used for this proof.
- Focused extension tests passed 40/40, native Chromium scenarios passed 2/2, and
  `pnpm check:changed` passed at the current Ticket 06 branch head.
- [GitHub Actions run 33258756278](https://github.com/carlitose/openclaw/actions/runs/33258756278) froze the
  package successfully, then the Windows probe failed with an intermittent
  `Page.enable: Debugger is not attached` error after several successful browser cycles.
- The failure is not evidence of insufficient Mac container memory: the 16 GB Apple
  `container` lane passed.

## Claim boundary

The durable integrated source proves Ticket 05. Ticket 06 remains incomplete. No current
evidence proves Windows restart/RDP/reboot behavior or personal-profile acceptance; those
remain behind Tickets 07 and 08.
