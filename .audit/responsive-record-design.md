# Responsive record and section-navigation contract

## Navigation

Project sections keep the full button set when the workspace can show every
destination without discovery-by-scroll. At narrower widths the same button
descriptor list populates a labelled native select. Both controls call
`activateProjectSection()`, so hash routing, heading focus, reload, and browser
history have one owner. Compare stays absent until the project has a
comparison-ready pair. Removed Privacy and Walk destinations are not restored.

## Record priorities

Repeated operational views use lightweight slots rather than a universal
record component:

| Family | Identity | State | Essential narrow data | Secondary narrow data | Actions |
| --- | --- | --- | --- | --- | --- |
| Projects | name and customer | lifecycle stage | open project | capture source and updated time are omitted | selection remains first |
| Jobs | job and project | state is repeated in the identity block | progress and current action | attempt and I/O evidence wrap inside identity | retry or cancel follows identity |
| Releases | project and immutable version | active, historical, or revoked | channel | policy and publication time are omitted | Manage stays visible; export and lifecycle actions live under More release actions |
| Team and access | person, provider, or credential | membership/provider state | email and role | activity evidence wraps below identity | role/scope actions retain source order |
| Hosting and review | project, invoice, checkout, or reviewer | included in the primary copy | current recovery action | long evidence wraps in the primary block | actions form a separate row |
| Domains | hostname | activation state | DNS/TLS evidence | provider detail wraps below | provision/remove actions retain source order |

The mobile representation hides only the project and release columns marked
`record-secondary`. Their identity, state, canonical route, and primary action
remain visible. Domain, billing, error, and evidence text is never discarded.

## Verification contract

- At 1024 px the project tabs remain visible. At 768, 390, and 320 px the
  labelled section picker is visible and the tab strip is not.
- Project picker changes use the same hash route, focus the selected workspace,
  and survive Back/Forward.
- Long project names, release channels, emails, domains, and multi-line failures
  remain inside their record and viewport.
- A mobile release exposes identity, state, channel, Manage, and a keyboard
  reachable disclosure for export and lifecycle actions.
- Repeated rows declare `record-primary`, `record-status`, `record-secondary`,
  `record-essential`, or `record-actions` according to the table above.
- Empty and large collections keep their existing bounded pagination; this
  change does not create a second client-side collection owner.
