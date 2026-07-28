# Floor-plan generation and scene editing

Last verified: 2026-07-28

This note separates capabilities that exist in Spatial Studio today from vendor
features and feasible product work. Neither a smooth viewer nor a Gaussian file
is evidence of survey accuracy.

## Decision summary

| Capability | Available now | Can be productized | Boundary |
|---|---|---|---|
| Authored interactive floor map | Yes | Already in production | It reflects reviewed room geometry, not automatic capture interpretation |
| Evidence-gated draft DXF | Yes | Already in production | It is bound to a measurement brief, current geometry hash, check points, and residual QA |
| Automatic floor plan from FJD capture | Available in FJD Model Web | Yes, as a vendor adapter | Vendor cloud, credits, export terms, quality, and data-residency acceptance remain external |
| Vendor-neutral automatic floor plan | No complete production journey yet | Yes | Requires point-cloud interpretation, vectorization, operator QA, and accuracy classification |
| Add a furniture model | Not yet authored in Studio | Yes | Spark already mixes splats and ordinary Three.js meshes; we need an asset/placement workflow |
| Hide/delete captured furniture splats | Privacy-region editing exists; arbitrary edit masks do not | Yes | Removal can leave a visual hole where the furniture occluded the room |
| Reconstruct the unseen room behind removed furniture | No | R&D only | Requires an empty rescan, additional views, or generative inpainting and must never be measurement evidence |

## 1. Floor plans from a capture

### What already works in Spatial Studio

The production viewer renders an authored box/polygon floor map, live camera
position, room controls, and acknowledged navigation. The processing lane can
inspect a registered, metric, Y-up Gaussian PLY and propose horizontal walkable
regions. A human must accept selected candidates before they become editable
room seeds.

The measurement branch can produce a private draft DXF only when:

- the project declares a measurement purpose and tolerance;
- the coordinate assurance is explicit;
- independent check-point residuals pass the selected gate;
- the authored geometry hash still matches the accepted QA evidence; and
- professional-sign-off limitations remain attached.

This is intentionally narrower than automatic Scan-to-CAD, a measured building
survey, or a certified floor plan.

### FJD path

FJD advertises Model Web floor-plan generation from uploaded scan data, with
DXF and PDF floor plans plus an OBJ model. Its current product page calls the
service beta and says the open-access period runs through 31 December 2026.
The current user guide prices floor-plan DXF/PDF plus OBJ generation at 50
credits in the Interior Design module.

Sources:

- <https://www.fjdtrion.com/products/fjd-trion-model-web>
- <https://store.fjdtrion.com/pages/fjd-trion-model-web-user-guide>
- <https://www.fjdtrion.com/es/blog/product-updates-2/fjd-trion-model-web-v1-4-2-267>

This is usable as an optional `FjdFloorplanAdapter`, not as the platform's only
floor-plan implementation. Before selling it, validate one compact apartment,
one multi-level house, and one large/repetitive venue against independent
measurements; record processing cost, manual correction time, failure classes,
and export/licensing rights.

### Vendor-neutral product path

```text
registered metric E57 / LAZ / PLY
  -> denoise, downsample, orient, and register
  -> floor and wall support extraction
  -> top-down occupancy / density / normal maps
  -> room, wall, opening, and circulation candidates
  -> topology repair and vectorization
  -> operator review against point cloud and source imagery
  -> SVG/PDF for marketing or DXF for measured work
  -> immutable evidence, accuracy class, and version
```

Open3D already supplies deterministic point-cloud filtering and plane
segmentation primitives. Learned systems such as NadirFloorNet can help when
registered panoramas are available, but they are research components, not a
replacement for topology repair or measurement QA.

Sources:

- <https://www.open3d.org/docs/latest/tutorial/t_geometry/pointcloud.html>
- <https://github.com/crs4/Indoor-floor-plans-prediction>
- <https://github.com/woodfrog/floor-sp>

Recommended product grades:

1. **Marketing floor plan** — automated candidates plus operator QA; clearly
   indicative; SVG/PDF.
2. **Measured floor plan** — independent checks, declared tolerance and
   residual report; DXF/PDF.
3. **CAD/BIM base** — explicit modelling scope/LOD, manual technical QA, and
   qualified professional involvement where regulated or relied upon.

## 2. Adding furniture

Spark 2.1 is a suitable runtime. `SplatMesh` is a Three.js `Object3D`, and Spark
renders Gaussian objects alongside normal triangle meshes in the same scene.
Therefore a GLB/GLTF furniture model can be loaded, transformed, raycast,
collided, and rendered over the captured splat without converting it to
Gaussians.

Sources:

- <https://sparkjs.dev/docs/overview/>
- <https://sparkjs.dev/docs/splat-mesh/>

The product work is an authoring and lifecycle feature:

- R2-backed furniture library with source, licence, dimensions, thumbnails, and
  integrity hashes;
- tenant/project-scoped placed-object records in D1;
- translate/rotate/scale gizmos with numeric entry and snapping;
- collision and floor placement checks;
- material/lighting controls and mobile asset budgets;
- undo/redo, drafts, approval, versioning, and immutable release snapshots;
- explicit distinction between captured truth and designed/virtual objects.

Furniture placements should live in the Spatial Studio scene manifest and D1,
not be baked into the immutable master splat. Each release may bind an exact
placement-set version.

## 3. Removing furniture

There are two different promises:

### A. Remove the visible Gaussians

This is production-feasible. SuperSplat's open browser editor demonstrates
picker, lasso, polygon, brush, sphere, box, and flood selection, plus
non-destructive delete/restore and cropping. Spark also exposes editable
splats/modifiers.

Sources:

- <https://developer.playcanvas.com/user-manual/supersplat/editor/editing-splats/>
- <https://developer.playcanvas.com/user-manual/supersplat/editor/>
- <https://sparkjs.dev/docs/splat-mesh/>

Spatial Studio should preserve the immutable master and store a versioned edit
mask/operation log. The edited derivative is generated only after operator
review and can always be reverted or compared with the source.

### B. Reveal a realistic empty room behind the furniture

Deleting Gaussians does not reveal surfaces the scanner never observed.
Occluded wall and floor data may be missing. The reliable options are:

1. capture the room before furniture is installed;
2. capture extra views or a second empty-room version; or
3. use generative 2D/3D inpainting as a visibly labelled visualization.

Generative fill may be useful for interior-design previews, but it must not be
used for measurements, as-built records, inspections, defect evidence, or any
claim that the generated surface was captured.

## Recommended implementation sequence

1. Add GLB furniture placement and a captured-versus-virtual display mode.
2. Add reversible splat selection masks for cleanup/removal.
3. Integrate FJD floor-plan output behind the vendor-neutral adapter contract
   while building the evidence/QA harness.
4. Build the vendor-neutral marketing-floor-plan pipeline.
5. Promote measured/CAD grades only after real scanner pairs and paid briefs
   establish residual and correction-time evidence.
6. Treat generative furniture removal/inpainting as a separate design-preview
   experiment, never as the canonical or measured scene.
