# WebMCP Challenge delta

This file distinguishes the pre-existing Spatial Studio platform from work added for the 2026 WebMCP Challenge.

## Baseline

- Repository: `Whyme-Labs/spatial-platform-demo`
- Baseline branch: `main`
- Baseline commit: `134aa8da5acb349f6eafb8751aaca094f8f5d9bd`
- Baseline commit timestamp: 2026-08-26 09:48:30 UTC
- Challenge branch: `webmcp-challenge`

The baseline already contained the production Spatial Studio application, Spark-based 3DGS viewer, registered geometry, reviewed collision and navigation, floor plans, release manifests, capture-completeness evidence, and semantic-extraction workflows.

## Challenge additions

The following work is new after the baseline and is the only work claimed for challenge judging.

### Product definition

- `docs/WEBMCP_PRODUCT_STORY.md`
- `docs/WEBMCP_CHALLENGE_PLAN.md`
- `docs/WEBMCP_DEVELOPMENT.md`

### Semantic browser runtime

- A standalone WebMCP challenge page in the Vite application.
- A semantic scene index compiled from published spatial entities and reviewed sidecars.
- Live scene context based on renderer camera state.
- Five narrow tools for context, search, entity details, capture quality, and verified camera navigation.
- Tool registration through `document.modelContext.registerTool` with read-only and untrusted-content annotations.
- Visible tool activity and semantic results in the shared page.

### Evaluation and safety

- Search and context unit tests.
- Explicit unknown and low-confidence behavior.
- Reuse of the renderer's verified camera acceptance path.
- Documentation of provenance and provisional scene units.

## Material commit log

| Commit | Date | Change |
|---|---|---|
| `83e05a1218fa021842d55d528165b72fd821db8b` | 2026-08-26 | Establish the challenge payload and branch-local expansion workflow |
| `4c8b61bf61d9b57af7b98971c81bc05f41cc3923` | 2026-08-26 | Add the product story, rules checklist, semantic browser, five WebMCP tools, and tests |
| `4642a475e671555981d17a341e36846caf66a8ab` | 2026-08-26 | Remove the one-use bootstrap workflow after exact payload expansion |

Git history after the baseline is authoritative for smaller documentation and review changes made before submission.

## Submission freeze

Before submission, record the deployed URL and deployment identifier here. After submission, do not mutate the submitted branch or live deployment during judging. Continue development from a fork or a new post-submission branch.
