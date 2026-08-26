# WebMCP Challenge submission plan

## Competition snapshot

The WebMCP Challenge asks entrants to build a web application that becomes meaningfully better when people and agents use it together. Existing applications are allowed, but only work added during the submission period is judged. A pre-existing project must clearly distinguish the new WebMCP extension through dated commits or equivalent evidence.

Spatial Studio's challenge baseline is:

- repository: `Whyme-Labs/spatial-platform-demo`
- baseline branch: `main`
- baseline commit: `134aa8da5acb349f6eafb8751aaca094f8f5d9bd`
- baseline commit time: 2026-08-26 09:48:30 UTC
- challenge branch: `webmcp-challenge`

`CHALLENGE_DELTA.md` is the authoritative inventory of work added after this baseline.

## Deadline

Two official pages currently disagree:

- OpenAI's challenge landing page shows September 3, 2026 at 5:00 p.m. PT.
- Devpost's submission FAQ shows September 3, 2026 at 1:00 p.m. PT.

Use the earlier deadline until the organizers clarify it:

- hard internal deadline: **September 3, 2026 at 1:00 p.m. PT**
- Malaysia time: **September 4, 2026 at 4:00 a.m. MYT**
- internal submission target: at least twelve hours earlier

Do not change the submitted Devpost entry, repository, or live deployment during judging unless the organizers explicitly permit it. Continue development in a separate fork or branch after the submission freeze.

## Required deliverables

### Working application

- [ ] A live, judge-accessible URL.
- [ ] Works in ChatGPT's in-app browser.
- [ ] Works in Chrome 149 or later with WebMCP testing enabled.
- [ ] No paid account required for the core judging flow.
- [ ] Clear testing instructions and credentials if any authenticated flow remains.
- [ ] The live behavior matches the video and written description.

### Public repository

- [x] Public GitHub repository.
- [x] Challenge branch created from a recorded baseline commit.
- [ ] All required source code and build instructions included.
- [ ] An OSI-approved open-source license detected by GitHub at repository level.
- [ ] Third-party assets and their licenses clearly separated from the code license.
- [ ] `CHALLENGE_DELTA.md` distinguishes pre-existing work from challenge work.
- [ ] A tagged or frozen submission commit recorded before the deadline.

### English project description

The submission description must explain:

- [ ] Why semantic spatial exploration is a strong fit for WebMCP.
- [ ] How the human experience improves.
- [ ] What people and agents can do together that was previously difficult or impossible.
- [ ] How WebMCP was implemented.
- [ ] The intended audience and concrete problem.
- [ ] What is real, what is provisional, and what remains future work.

### Demo video

- [ ] Public YouTube URL.
- [ ] Less than three minutes.
- [ ] Includes audio.
- [ ] Shows the product functioning, not only slides or mockups.
- [ ] Shows WebMCP tool use visibly affecting the live page.
- [ ] Avoids unlicensed music, trademarks, and third-party material.
- [ ] Includes captions or an English translation if any spoken content is not English.

### Submission form and testing material

- [ ] Project title and short tagline.
- [ ] Live URL.
- [ ] Repository URL.
- [ ] Public YouTube URL.
- [ ] English description.
- [ ] Screenshots or still images that explain the product without the live app.
- [ ] Testing instructions.
- [ ] Authorized individual representative if submitted for a team or organization.
- [ ] Ownership and third-party-license review completed.

## Judging criteria

The official rules weight four criteria equally.

| Criterion | What Spatial Browser must prove |
|---|---|
| WebMCP leverage | Several narrow, typed tools use live page state and visibly change the shared scene. WebMCP is essential, not decorative. |
| Execution | One polished end-to-end flow works reliably and explains failures. The project is more than a tool-registration proof. |
| Potential impact | The demo connects semantic scene understanding to a real audience and costly workflow. |
| Creativity and ambition | The project gives captured physical places a spatial DOM rather than adding another chat box to a viewer. |

WebMCP leverage is the first tie-break criterion. The implementation must therefore expose genuine scene state and agent actions rather than one broad wrapper tool.

## Product scope for submission

### Must work

- semantic scene hierarchy;
- stable entity IDs;
- current camera and region context;
- entity search with aliases and confidence;
- evidence and capture-quality reporting;
- navigation to a verified entity viewpoint;
- visible WebMCP status and tool activity;
- graceful behavior when WebMCP is unavailable;
- explicit provisional-unit and provenance warnings.

### Strong additions

- relationship traversal;
- grouped highlighting;
- low-confidence overlay;
- human label correction;
- a reversible entity-state change such as blocked or unavailable;
- route recalculation after a state change.

### Excluded from critical path

- general automatic segmentation for arbitrary uploads;
- arbitrary 3D editing;
- WebGPU renderer replacement;
- safety or regulatory certification;
- a second unrelated scene workflow;
- a full backend MCP server.

## Build sequence

### Slice 1: semantic browser foundation

- [x] Record the pre-challenge baseline.
- [x] Create `webmcp-challenge` branch.
- [ ] Add product and submission documentation.
- [ ] Add a standalone challenge page to the Vite build.
- [ ] Load the existing public Home Scan release and its spatial manifest.
- [ ] Track the renderer's live camera state.
- [ ] Compile rooms and points of interest into a semantic index.
- [ ] Register read-only WebMCP tools.
- [ ] Add unit tests for search, context, and uncertainty behavior.

### Slice 2: object-level semantics and evidence

- [ ] Add a reviewed semantic sidecar for objects and surfaces.
- [ ] Bind entities to best camera poses and source evidence.
- [ ] Add relationships and multi-hop queries.
- [ ] Add confidence and capture-gap overlays.
- [ ] Compare graph-backed answers with screenshot-only answers.

### Slice 3: reversible scene operations

- [ ] Add one dynamic entity-state change.
- [ ] Update reachability or visibility after the change.
- [ ] Add undo and scenario reset.
- [ ] Keep the action visible and human-reviewable.

### Slice 4: submission hardening

- [ ] Test in ChatGPT's in-app browser.
- [ ] Test in Chrome 149 with WebMCP enabled.
- [ ] Run typecheck, unit, integration, build, and focused browser tests.
- [ ] Verify Lighthouse lists the registered WebMCP tools.
- [ ] Produce screenshots.
- [ ] Record the video.
- [ ] Freeze the release commit and deployment.
- [ ] Submit before the earlier deadline.

## Proposed video structure

### 0:00 to 0:20

Show the problem. A photorealistic scan is easy to look at but does not expose persistent object or room context to an agent.

### 0:20 to 1:20

Ask the agent to inspect the current scene, search for a room or object, and navigate to it. Show the WebMCP tool calls and the live camera movement.

### 1:20 to 2:05

Ask what evidence supports the result and which scene regions are uncertain. Show confidence, provenance, and a capture gap rather than an invented answer.

### 2:05 to 2:40

Change one entity state, such as blocking a corridor or disabling a lift. Show the route or reachable-space result update and then undo it.

### 2:40 to 2:58

Close with the product claim: physical places now have a semantic DOM that humans and agents share.

## Risks and controls

| Risk | Control |
|---|---|
| Existing project work is confused with challenge work | Recorded baseline SHA, isolated branch, dated commits, and `CHALLENGE_DELTA.md` |
| Deadline discrepancy | Treat Devpost's earlier time as binding |
| WebMCP API changes | Feature detection, a small adapter, and Chrome/ChatGPT tests |
| Semantic hallucination | Stable reviewed entities, confidence, evidence links, and explicit not-found behavior |
| Camera lands outside trusted space | Reuse the renderer's verified `set-camera` acceptance path |
| 3DGS is treated as measurement geometry | Keep metric authority in registered geometry and preserve the existing disclaimer |
| Demo depends on private data | Use a public, licensed scene with a documented asset policy |
| Repository lacks a detectable license | Add an owner-approved OSI license before submission and retain third-party notices |
| Judges do not run the live app | Make the first 90 seconds of the video prove the complete interaction |

## Sources to recheck before submission

- OpenAI WebMCP Challenge landing page.
- Devpost official rules.
- Devpost Resources and FAQ.
- Chrome WebMCP imperative API documentation.
- Chrome WebMCP security guidance.

Rules and API behavior can change during an experimental challenge. Re-verify them before freezing the submission.
