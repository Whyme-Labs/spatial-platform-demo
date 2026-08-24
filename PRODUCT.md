# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

The primary users are production operators and teams working after capture. Their job is to turn portable visual-scene exports and registered metric geometry into trustworthy, walkable browser releases that can be reviewed and published without exposing raw capture files.

Customer reviewers are secondary users. They inspect exact scene versions, leave version-bound feedback, make review decisions, and view approved releases. Read-only recipients consume published work, while platform administrators manage tenant access and operational controls.

## Product Purpose

Spatial Studio exists to carry a spatial capture from ingest through processing, structural correction, navigation proof, review, and controlled browser publication. Success means shortening the path from capture to an approved release while preserving provenance, explicit human judgment, and safe publication throughout the process.

## Positioning

Spatial Studio is not merely a Gaussian-splat viewer. It is an evidence-bound post-capture system that joins the visual scene, registered metric structure, navigation proof, immutable versioning, human review, and controlled publication across capture vendors. A viewer can display an artifact; Spatial Studio proves which inputs, processing decisions, review state, and release produced what the customer sees.

## Operating Context

The product is used after field capture. Operators bring a portable Gaussian representation and its registered metric point cloud into a project, process them into browser and spatial derivatives, correct ambiguous structure when necessary, preview and review the exact version, and deliberately publish an approved release.

Work is organized around projects, immutable scene versions, processing jobs, review evidence, and numbered release revisions. Reviewers work against exact versions rather than mutable project state. Published releases are consumed in a browser and may be access-controlled or deliberately public.

## Capabilities and Constraints

- The capture boundary is device-neutral. FJD and other vendor workflows may be supported, but the product contract must not depend on one scanner or proprietary project format.
- Raw captures, vendor projects, imagery, video, poses, calibration, and other sensitive source material remain private. Public delivery uses deliberately published derivatives.
- Scene versions, processing inputs, review evidence, and release revisions retain exact provenance. A retry must not silently create a different result under the same operation.
- Publication is an explicit operator action. Missing, mismatched, unverified, or stale evidence must block the dependent operation with an actionable explanation.
- Human review is part of the production contract for ambiguous structure, customer decisions, and release approval; automation must not invent certainty.
- Browser releases must remain usable without vendor-specific desktop software.
- Claims about accuracy, performance, compatibility, customer outcomes, or certification require reproducible evidence. Unverified claims must remain clearly qualified.

## Brand Commitments

The product name is **Spatial Studio**. Its product language is direct, operational, and evidence-led. It should distinguish verified facts, pending work, operator judgment, and blocked states instead of hiding uncertainty behind generic success or failure messages.

Existing product imagery and identity assets are present in `public/images/spatial-hero.avif`, `public/images/spatial-hero.webp`, `public/images/spatial-venue.webp`, and `public/images/spatial-capture.webp`. Their presence is evidence of the incumbent interface, not permission to replace or extend its visual system during initialization.

## Evidence on Hand

- The repository contains the implemented Studio, browser viewer, project workflows, processing pipelines, review controls, and release lifecycle described in `README.md` and `PRODUCT_ROADMAP.md`.
- Incumbent interface screenshots are available at `docs/previews/operations-studio.png` and `docs/previews/client-viewer.png`.
- Reproducible capacity measurements and their commands are recorded in `docs/CAPACITY_RECEIPTS.md`.
- Workflow state and failure behavior are inventoried in `docs/ACTION_STATE_AUDIT.md`.
- Navigation, floor-plan, security, and release evidence are recorded in the corresponding repository documents and verification artifacts.
- No customer testimonial, market benchmark, pricing claim, or certified measurement claim is established by this product record. Future work must not fabricate them.

## Product Principles

1. Preserve the chain of evidence from source capture to published release.
2. Keep the capture boundary portable and vendor-neutral.
3. Make consequential publication and ambiguous spatial decisions explicit human acts.
4. Fail closed with actionable evidence when a prerequisite is missing or invalid.
5. Prefer a smaller end-to-end workflow that is trustworthy over broader unfinished capability.

## Accessibility & Inclusion

Spatial Studio is an operational web product and must remain usable with keyboard and assistive technologies. Product flows need clear focus, labels, status announcements, error recovery, and sufficient touch targets. Forced-colors and reduced-motion preferences must remain supported where the interface uses color or motion to communicate state.
