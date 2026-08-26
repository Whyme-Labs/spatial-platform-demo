# Spatial Browser product story

## Working name

**Spatial Browser**, a WebMCP-powered semantic exploration layer for Spatial Studio.

The name describes the user value rather than the rendering format. Gaussian splats remain the visual layer, but the product is built around understanding and operating a place.

## One-sentence product

Spatial Browser turns a photorealistic spatial capture into a place that people and agents can search, understand, verify, and change together.

## The problem

A conventional 3DGS scene is visually rich but semantically opaque. A person can move a camera through it, yet software usually cannot answer basic persistent questions:

- What objects and spaces exist here?
- Is this the same chair seen from another viewpoint?
- Which room contains the object?
- What is beside, above, connected to, or blocking it?
- What view best supports the answer?
- Which regions were poorly captured?
- What can be hidden, moved, disabled, or compared safely?

The common fallback is to send the agent a screenshot. A screenshot gives temporary perception, not spatial memory. It loses object identity, global coordinates, room membership, hidden entities, topology, provenance, and uncertainty.

The web has pixels for people and the DOM for software. Spatial captures currently have the equivalent of pixels. Spatial Browser adds the missing spatial DOM.

## Product thesis

> 3DGS makes a place visible. Spatial Browser makes it understandable, trustworthy, and operable.

Scene usefulness is constrained by three factors:

\[
\text{scene usefulness}
=
\text{understandability}
\times
\text{trust}
\times
\text{actionability}
\]

The product therefore has one core experience and two supporting capabilities.

### Core experience: semantic explorability

The scene exposes stable, addressable entities:

- sites, buildings, floors, rooms, and zones;
- object instances such as sofas, chairs, fans, signs, lifts, valves, and equipment;
- continuous surfaces such as floors, walls, ceilings, and platforms;
- portals and connectivity such as doors, corridors, stairs, and lifts;
- relationships such as inside, beside, above, attached to, connected to, and blocks;
- evidence, confidence, and source viewpoints for every inferred entity.

A user or agent can then ask:

- "Take me to the living room."
- "Show every chair beside a table."
- "Which rooms contain ceiling fans?"
- "Find the accessible gate nearest Entrance A."
- "What is behind this sofa?"
- "Show the evidence supporting this object label."

### Supporting capability: capture assurance

Capture quality is assessed against the intended use, not reduced to one generic score.

The system can report:

- missing viewpoints and unseen object sides;
- weak overlap, blur, exposure, or geometric support;
- unreadable labels;
- semantically uncertain objects;
- regions that are adequate for visual exploration but inadequate for measurement or inspection;
- recommended recapture positions.

The key question is:

> Is this scene sufficiently captured for the question or action the user is asking now?

### Supporting capability: semantic manipulation

Users operate named entities and states rather than individual Gaussians:

- hide or isolate an object;
- mark an entity open, closed, active, blocked, temporary, or unavailable;
- move a cleanly segmented object group;
- insert a geometry proxy;
- compare scenarios;
- undo and review changes;
- recalculate routes after a state change.

The semantic layer makes manipulation addressable. Trusted geometry, rather than the rendered splats, provides collision and measurement authority.

## The shared spatial model

All three capabilities use one versioned representation.

```text
Raw capture
images, video, camera poses, LiDAR, depth
        ↓
Reconstruction
3DGS, point cloud, mesh
        ↓
Spatial DOM
regions, entities, surfaces, relations, evidence, confidence
        ↓
Semantic runtime
search, inspect, navigate, assess, manipulate, compare
        ↓
Human-approved action
share, annotate, route, work order, scenario, export
```

Each representation has one job:

| Layer | Authority |
|---|---|
| 3DGS | Photorealistic appearance and visual context |
| Registered geometry | Measurement, collision, extent, and metric position |
| Semantic graph | Identity, hierarchy, relationships, aliases, and affordances |
| Navigation graph | Reachability, portals, accessible routes, and dynamic barriers |
| Evidence index | Best source views, provenance, confidence, and capture gaps |
| Workflow state | Corrections, review, approval, scenario changes, and history |
| WebMCP | Typed agent access to the live page and current human context |

## Why WebMCP is essential

A backend MCP server can query stored scene data, but it does not automatically know what the person is viewing, which object is selected, which scenario is active, or what temporary overlays are visible.

WebMCP lets the agent operate the same live spatial workspace as the person. Tools can read and change:

- the active scene and release;
- current camera pose and room;
- visible and selected entities;
- search and filter state;
- route overlays;
- temporary entity states;
- evidence and quality overlays;
- staged, reversible changes.

This creates a cooperative loop:

```text
Human intent
    ↓
Agent queries the spatial DOM
    ↓
Viewer shows the result in context
    ↓
Human inspects evidence or corrects it
    ↓
Scene memory and workflow state improve
```

## Initial audiences

The horizontal product is a semantic browser. The first high-value applications are where spatial context affects a costly decision.

| Audience | Primary value |
|---|---|
| Facility and maintenance teams | Find assets, prepare access, inspect evidence, and plan interventions remotely |
| Construction and commissioning teams | Navigate spaces, review installed assets, find missing evidence, and assemble closeout decisions |
| Public-space operators | Accessible wayfinding, disruption scenarios, asset discovery, and staff training |
| Insurance and restoration teams | Room-based inventory, damage evidence, and repeatable remote review |
| Property and hospitality teams | Searchable remote visits, feature discovery, and layout scenarios |
| Museums and heritage teams | Object-level exploration, evidence-linked stories, and condition history |
| Robotics teams | Semantic world memory, active perception targets, and real-to-sim scene variants |

## Challenge demonstration

### Scene

The first working slice uses Spatial Studio's public Home Scan release because it already has a photorealistic scene, reviewed structure, room anchors, collision, and navigation.

The challenge demo will then move to a two-level transit-station scene once its semantic sidecar is ready.

### Primary interaction

The person asks:

> "Show me the connected spaces, find the main living area, and take me to the best viewpoint."

The agent:

1. reads the current camera and semantic context;
2. searches the entity graph;
3. returns matching rooms and objects with confidence;
4. navigates the live viewer to the selected entity;
5. explains what evidence and geometry support the result.

### Trust interaction

The person asks:

> "Which parts of this scene are least reliable?"

The agent exposes entities and regions with incomplete coverage, provisional geometry, low semantic confidence, or stale evidence. The viewer highlights them and explains what additional capture would resolve the uncertainty.

### Manipulation interaction

The person asks:

> "Assume this corridor is blocked. Which spaces remain reachable?"

The agent stages a dynamic state change, recalculates the navigation graph, shows the consequence, and leaves the change reversible for human review.

## WebMCP tool surface

### Semantic exploration

- `get_scene_context`
- `list_scene_regions`
- `search_scene_entities`
- `get_scene_entity`
- `get_entity_relations`
- `navigate_to_entity`
- `show_entity_group`
- `get_best_evidence_views`

### Capture assurance

- `get_entity_quality`
- `get_region_quality`
- `list_uncertain_entities`
- `explain_capture_gap`
- `recommend_recapture_views`
- `show_quality_overlay`

### Semantic manipulation

- `set_entity_state`
- `isolate_entity`
- `stage_entity_transform`
- `insert_object_proxy`
- `compare_scene_scenarios`
- `undo_scene_change`
- `commit_scene_version`

The first slice implements read-only context, search, quality, and camera navigation. Write tools will remain staged and reversible when added.

## First implementation slice

The first end-to-end slice is deliberately narrow:

1. Load one existing public Spatial Studio release.
2. Compile its published rooms and points of interest into a semantic scene index.
3. Track the live renderer camera pose.
4. Register WebMCP tools for context, search, entity details, quality, and navigation.
5. Provide a visible semantic browser beside the scene so judges can understand what the agent is doing.
6. Retain confidence, provenance, and provisional-unit warnings in every relevant result.

This slice proves the central claim without pretending that general-purpose 3D scene understanding is already solved.

## Non-goals for the first slice

- General automatic object segmentation for arbitrary scans.
- Safety-critical measurement from Gaussian primitives.
- Arbitrary mesh editing or deformation.
- Autonomous approval of engineering or accessibility decisions.
- Hidden agent changes with no visible scene feedback.
- A generic chat box that wraps one broad `analyze_scene` function.

## Success measures

### Product measures

- A user can find an entity without manually traversing the whole scene.
- The same entity keeps one stable identity across viewpoints.
- Navigation lands on a useful, unobstructed evidence view.
- Unsupported queries return "not found" or explicit uncertainty rather than a fabricated object.
- The product shows whether an answer came from semantics, geometry, source imagery, or operator review.
- Human corrections persist and improve later queries.

### Evaluation measures

- entity retrieval Recall@1 and Recall@5;
- room and zone classification accuracy;
- relationship precision and recall;
- camera-navigation success rate;
- unsupported-answer rate;
- confidence calibration;
- median tool latency;
- end-to-end task completion rate;
- task performance versus screenshot-only scene access.

## Long-term product direction

Spatial Browser becomes the semantic operating layer across Spatial Studio's pipeline:

1. **Capture** learns what evidence is missing for the intended task.
2. **Compile** binds appearance, geometry, entities, relations, and provenance.
3. **Explore** lets humans and agents search and navigate a place together.
4. **Assess** exposes uncertainty instead of hiding it.
5. **Compose** supports reversible object and scenario changes.
6. **Version** records how the physical place and its interpretation change over time.

The durable advantage is not a renderer. It is the accumulated structure and feedback around capture failures, stable identities, cross-view evidence, human corrections, scene versions, and operational outcomes.

## Submission-ready product statement

> Spatial Browser gives physical places a semantic DOM. It turns photorealistic 3D captures into environments that people and agents can search, understand, verify, and change together. WebMCP lets the agent work inside the same live scene, camera, selection, evidence, and scenario state as the person, while registered geometry and explicit uncertainty keep the experience honest.
