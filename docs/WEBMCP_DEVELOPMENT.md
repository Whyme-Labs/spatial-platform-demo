# Spatial Browser WebMCP development guide

This document covers only the WebMCP Challenge addition. The existing Spatial Studio README remains the source of truth for the full Cloudflare, D1, R2, renderer, and processing stack.

## Challenge page

The new browser entry point is:

```text
/webmcp.html
```

It defaults to the public release:

```text
home-scan-spark-multi-room-demo
```

A different public release can be selected without rebuilding:

```text
/webmcp.html?scene=<public-release-slug>
```

The page loads the release manifest from the same origin, embeds the existing Spark renderer, sends the existing collision and navigation runtime, builds a semantic index, and registers top-level WebMCP tools.

## Prerequisites

- Node.js 22 or later
- npm
- the existing Spatial Studio Cloudflare configuration for Worker-backed local or deployed testing
- Chrome 149 or later with WebMCP testing enabled, or ChatGPT's in-app browser with site tools available

## Install and validate

```bash
npm ci
npm run typecheck
npm run test -- test/webmcp-semantic-scene.spec.ts
npm run build
```

The repository's full validation remains:

```bash
npm run check
```

## Run

For the complete same-origin Worker and asset flow:

```bash
npm run dev
```

Then open the URL printed by Wrangler with `/webmcp.html` appended. The chosen release must exist in the environment's D1 and R2 state. The public challenge deployment will use the production Home Scan release so judges do not need credentials.

## Enable WebMCP in Chrome

1. Use Chrome 149 or later.
2. Open `chrome://flags/#enable-webmcp-testing`.
3. Enable the flag and restart Chrome.
4. Open `/webmcp.html`.
5. Verify that the page status reports five registered site tools.
6. Run Lighthouse and inspect the registered WebMCP tools audit.

WebMCP remains experimental. The implementation uses `document.modelContext`, not the deprecated `navigator.modelContext` form.

## Registered tools in slice 1

| Tool | Page effect | State class |
|---|---|---|
| `get_scene_context` | Reads camera, region, selection, nearby entities, and evidence boundary | Read-only |
| `search_scene_entities` | Searches persistent entities and renders the result list | Read-only |
| `get_scene_entity` | Selects an entity and exposes relations, affordances, provenance, and evidence | Read-only data, visible selection |
| `get_entity_quality` | Selects an entity and reports visual, semantic, geometry, and freshness confidence | Read-only data, visible selection |
| `navigate_to_entity` | Requests an authored best view through the renderer's reviewed navigation and collision acceptance path | Reversible page-state change |

Scene-derived labels and descriptions are marked with `untrustedContentHint`. Read-only tools use `readOnlyHint`. Tool output is bounded and unknown entities fail explicitly.

## Manual acceptance script

Use these prompts in ChatGPT's browser:

```text
What room or zone am I currently viewing? List the nearest persistent entities.
```

```text
Find the sofa, inspect its evidence and known capture gaps, then take me to its best verified viewpoint.
```

```text
Search for an escalator. Do not infer one if it is not present in the semantic index.
```

Expected behavior:

- the tool activity appears visibly in the right panel;
- search results use stable entity IDs;
- unsupported entities return not found rather than a visual guess;
- camera movement is accepted or rejected by the renderer;
- provisional scene units and measurement disclaimers remain visible;
- capture gaps remain attached to the selected entity.

## Deterministic tests

The first test file covers:

- tuple position parsing from published manifests;
- box geometry and region bounds;
- label, alias, and affordance search;
- explicit not-found behavior;
- current-room grounding from the live camera;
- reverse containment relationships;
- provisional Home Scan sidecar semantics and capture gaps.

Further challenge work should add browser tests for tool registration, renderer camera acceptance, visible tool activity, dynamic scene state, and undo.

## Security and trust boundary

- Tools register only in the top-level same-origin page.
- The renderer remains a same-origin iframe but does not expose its own tools.
- Cross-origin tool exposure is not enabled.
- External and scene-derived content is labelled untrusted.
- The page never derives safety-critical measurements from Gaussian primitives.
- Navigation uses the existing reviewed collision and navigation runtime.
- The semantic sidecar exposes provenance, confidence, review status, and known gaps.
- The initial challenge page uses a public release and requires no account credentials.
