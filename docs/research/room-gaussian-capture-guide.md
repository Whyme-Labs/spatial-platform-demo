# Capturing one room for Gaussian-splat reconstruction

Research date: 2026-07-30
Target pipeline: phone stills → COLMAP via `ns-process-data images` →
Nerfstudio Splatfacto on Modal → Gaussian PLY → RAD → web platform

## Short recommendation

For an ordinary bedroom or office, plan to keep **180–300 sharp still images**
after culling. Capture about 10–20% extra. Use the phone's rear **1× main
camera**, keep the same lens and zoom throughout, and make three connected
passes:

1. an inward-looking perimeter pass;
2. a small center loop looking outward;
3. high, low, and close-detail coverage, with transitional images connecting
   every detail sequence back to a wide room view.

Aim for **70–80% overlap between consecutive images**. Move the camera
physically between shots; do not stand in one spot and only rotate it.

These counts are planning targets for this pipeline, not limits published by
COLMAP or Nerfstudio:

| Single-room size | Sharp images to keep | Practical interpretation |
|---|---:|---|
| Small, under roughly 10 m² | 120–180 | Bathroom, box room, compact office |
| Typical, roughly 10–25 m² | 180–300 | Bedroom, home office, living room |
| Large, roughly 25–50 m² | 300–500 | Open living/dining room or cluttered studio |

Add roughly 25–50% for heavy occlusion, shelves, plants, glossy objects, or
large blank walls. Image count alone is not the success criterion: good
parallax, overlap, sharpness, and complete coverage matter more than near-
duplicate frames. Jawset's first-party Postshot guidance says typical useful
sets are around 100–300 images, while some scenes need several hundred or more;
COLMAP says more images are not automatically better.

## Why this capture pattern fits our pipeline

- Nerfstudio's custom-data path obtains camera poses with COLMAP and explicitly
  asks for overlapping, non-blurry images.
- COLMAP asks for textured scenes, similar illumination, high overlap, multiple
  viewpoints, and each object appearing in at least three images. It explicitly
  warns against taking images from one fixed position by rotation alone.
- Polycam's first-party interior guide recommends at least 75% overlap, a
  perimeter pass, a 1–2 m center ring, extra corner views, and “glue” frames
  when returning from close-up details.
- Jawset's Gaussian-splat capture guide recommends 2–5 paths at different
  heights and tilts, shooting upward from low positions and downward from high
  positions, while including both floor and ceiling.

## Capture procedure

### 1. Prepare the room

- Make the scene static. Remove people and pets; turn off fans, moving curtains,
  TVs, and animated monitors. Do not move chairs, cushions, doors, or furnishings
  after capture begins.
- Use stable, diffuse, continuous lighting. Turn lights on before starting and
  leave them unchanged. Do not use flash.
- Close curtains or blinds if a bright window produces clipped highlights or
  strong moving sunlight. COLMAP specifically warns against high-dynamic-range
  views through doors and windows.
- Cover large mirrors where practical. Gaussian splats can reproduce some
  view-dependent appearance, but moving reflections, glare, and lens flare
  still violate the static-scene assumption and can weaken COLMAP registration.
- Give blank walls some temporary, non-repeating texture—removable posters,
  painter's-tape markers, or patterned paper—then leave it fixed for the entire
  capture. COLMAP specifically recommends adding background objects when the
  scene lacks texture.
- Decide what must not be published. Remove personal papers, screens, faces,
  photographs, addresses, and other private content before capture; automatic
  privacy scanning should be a second line of defence.

### 2. Set up the phone

- Clean the lens and use the rear **1× main camera**. Jawset recommends a
  context-rich lens around 24 mm full-frame equivalent as a starting point.
- Keep one lens, focal length, resolution, and orientation for the whole set.
  Avoid digital zoom, lens switching, Portrait mode, panorama, and other modes
  that create inconsistent optics or synthetic blur.
- Prefer still photographs over video for this run. Hold the phone with two
  hands, pause briefly at each position, and inspect sample images at full size.
- Use bright enough illumination for short exposures. Sharp noisy images are
  generally safer than motion-blurred images; Jawset explicitly says radiance
  fields tolerate noise better than blur.
- If the camera app permits it, lock white balance and exposure after choosing
  a setting that protects bright windows. Lock focus at a useful mid-room
  distance, or verify that autofocus is not jumping. If manual controls are not
  available, move slowly and keep lighting even so automatic settings change as
  little as possible.
- Disable flash. Avoid Night mode if it produces multi-frame motion artefacts.

### 3. Capture connected paths

**Pass A — perimeter foundation**

- Start in a textured corner. With your back near the wall, walk the room
  perimeter and shoot inward along long sight lines.
- Use chest-to-eye height, approximately 1.2–1.6 m, and aim slightly downward
  often enough to include furniture-to-floor boundaries.
- Maintain 70–80% overlap. As a rough field cue, move only about 15–40 cm
  between nearby views in a small room, then re-aim while retaining most of the
  preceding frame.
- At each corner, capture the adjacent walls straight-on and at intermediate
  angles; Polycam specifically recommends straight-on, 45°, and 90° coverage.
- Close the loop by re-photographing the starting area from the final approach.

**Pass B — center loop**

- Walk a roughly 1–2 m diameter loop near the center, looking outward at the
  walls and furniture.
- Keep the loop connected to Pass A with several overlapping transition views.
  This second baseline supplies parallax from another part of the room.

**Pass C — height, floor, ceiling, and details**

- Repeat useful portions lower, roughly 0.6–1.0 m, tilted upward, and higher,
  roughly 1.7–2.0 m where safely reachable, tilted downward.
- Explicitly cover the floor, ceiling, wall/ceiling boundaries, door recesses,
  spaces beside furniture, and occluded sides of important objects.
- For shelves or fine detail, move gradually from a wide view to medium and
  close views, then step back through medium and wide views again. Those
  transitional “glue” frames keep the close-up sequence connected to the room.
- Do not spend the entire pass taking detail close-ups. Wide context is
  necessary for stable camera registration.

### 4. Cull and hand off

- Delete frames that are blurred, out of focus, blocked by a hand or person,
  severely over/underexposed, or captured while the scene was moving.
- Remove exact duplicates, but do not cull so aggressively that overlap is
  broken. Every surface should be visible in at least three images and preferably
  from several translated viewpoints.
- Check that the sequence forms a connected chain from beginning to end and
  that each detail excursion reconnects to a wide view.
- Keep original-resolution files and EXIF metadata. Export as consistently
  encoded JPEGs before `ns-process-data images` if the phone produced a format
  unsupported by the processing environment.
- Keep a copy of the untouched originals. Process a duplicate directory.

## Fast on-site checklist

- [ ] Lens cleaned; battery and storage sufficient
- [ ] Rear 1× camera; one lens/zoom/orientation throughout
- [ ] Flash off; stable continuous lighting; curtains/blinds set
- [ ] People, pets, fans, screens, and private material removed
- [ ] Furniture, doors, cushions, curtains, and lights will not move
- [ ] Mirrors or severe glare controlled; temporary texture added to blank walls
- [ ] Perimeter loop captured with 70–80% overlap
- [ ] Camera translated between shots rather than only rotated
- [ ] Corners captured from straight, oblique, and side views
- [ ] Center loop captured and connected to perimeter
- [ ] Low/upward and high/downward views captured safely
- [ ] Floor, ceiling, recesses, and occluded furniture sides covered
- [ ] Detail runs include wide-to-close and close-to-wide glue frames
- [ ] Sample photos checked at full size for focus and motion blur
- [ ] Capture ends by closing the loop near the starting view

## Primary sources

- [Nerfstudio: Using custom data](https://docs.nerf.studio/quickstart/custom_dataset.html)
  — `ns-process-data`, COLMAP dependency, and the overlapping/non-blurry-image
  requirement.
- [COLMAP tutorial](https://colmap.github.io/tutorial.html)
  — texture, stable illumination, overlap, three-view minimum, viewpoint
  diversity, and the warning against fixed-position rotation.
- [Jawset Postshot: Capturing Guidelines](https://www.jawset.com/docs/d/Postshot%2BUser%2BGuide/Capturing%2BGuidelines)
  — first-party Gaussian/radiance-field guidance for scene motion, lighting,
  blur, focal length, camera paths, heights, floor/ceiling, and image counts.
- [Jawset Postshot: Training Configuration](https://www.jawset.com/docs/d/Postshot%2BUser%2BGuide/Interface/Training%2BConfiguration)
  — typical 100–300 selected images, sharp/well-distributed image selection,
  single-lens handling, and exposure/white-balance compensation.
- [Polycam: High-fidelity interior scans](https://learn.poly.cam/hc/en-us/articles/48339214285844-How-to-Capture-High-Fidelity-Interior-Scans-in-Object-Mode)
  — first-party room-specific perimeter, center-ring, detail, overlap, corner,
  static-scene, and glue-frame guidance.
- [Polycam: Object Mode](https://learn.poly.cam/hc/en-us/articles/27425185907348-How-to-Use-Object-Mode)
  — first-party Gaussian-splat capture guidance on 70–75% overlap, featureless
  and moving subjects, sharpness, lighting, and pre-processing image review.
