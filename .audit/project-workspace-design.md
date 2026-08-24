# Project workspace design

## Problem

The `process` route previously rendered the same Overview document. The shared
outer section also added a third bordered ancestor around controls inside
technical disclosures. The fix needs one project-specific Process workspace
and one source for the current lifecycle stage, blocker, and next action.

## User flow

Opening a project still routes to the first incomplete task. Every project route
shows the project identity, the canonical lifecycle stage, one blocker or "No
blocker", and one next action. Overview, Process, Structure, Compare, Publish,
Measurement evidence, and Expert remain hash-addressable sibling workspaces.

Process now owns only project processing state, progress, failure, recovery,
and its history disclosure. Overview owns sharing, the project record, closed
technical history, and closed optional tools.

## Shape

The projection stays in `studio.ts` for this bounded migration because its
`ProjectDetail`, `Job`, and `Version` types are private there. Exporting those
large API shapes would create a wider boundary than the change needs.

```ts
type ProjectWorkspaceModel = {
  journey: ProjectJourneyState;
  canonicalSection: "overview" | "process" | "structure" | "publish";
  stageLabel: "Archived" | "Capture" | "Process" | "Structure" | "Publish" | "Complete";
  blocker: ProjectBlocker;
  nextAction: ProjectNextAction;
  process: ProcessWorkspaceModel;
};
```

`ProjectBlocker`, `ProjectWorkspaceCommand`, and `ProcessWorkspaceModel` are
discriminated unions. Commands carry IDs rather than DOM nodes or API objects.
`executeProjectWorkspaceCommand()` resolves each ID at the existing Studio
orchestration boundary with an exhaustive switch.

Archived is an explicit state-model branch. It keeps Overview addressable,
names the archive blocker, and makes Restore project the only current action;
the context never presents a disabled capture action as the way forward.

The existing hash router remains the only route owner. Legacy Privacy links
still resolve to Publish, Walk links still resolve to Structure, and Team access
remains a primary administrator destination.

## Surface contract

Static and generated containers declare `data-surface-role` as `section`,
`task`, `record`, or `notice`. `.output-section` is an unbordered section. A
normal action may have no more than two bordered ancestors. Technical history
and optional tools remain closed after the active task.

The design does not add a side inspector. No measurement establishes a safe
width or relocation breakpoint, and such an inspector could recreate the shell
squeeze fixed under issue #60.

## Synthesis decision

Candidate A is the base. Candidate B contributed the requirement to keep route
ownership in `activateProjectSection()` and to preserve legacy Overview links.
The implementation rejects Candidate B's `HTMLElement`-bearing model and
callback actions because they mix data projection with rendering.

## Verification contract

- `#project/<id>/process` renders a dedicated Process workspace and survives a
  reload.
- The project context stays visible on every project section.
- Overview-only history and tools are absent from Process.
- Normal actions never cross two bordered content ancestors.
- Generated card-like containers have an explicit semantic surface role.
- Mobile DOM order stays context, navigation, selected task, then secondary
  content.
