# Demonstration scene policy

## Principle

Open-source renderer code and open file formats do not automatically grant permission to use a captured scene in public commercial marketing. Track the licence and provenance of every scene separately from the software used to render it.

## Approved source classes

### A. Company-owned procedural or synthetic scenes

Use these immediately for UI, performance and interaction demonstrations. They are the safest option because the company controls the entire asset.

### B. Company-owned physical captures

These should become the main commercial demonstrations after hardware arrives. Obtain a signed location release covering capture, reconstruction, public hosting, marketing reuse and derivative outputs.

### C. Third-party scenes with explicit commercial permission

Accept CC0, CC BY, or a written commercial licence. Store the licence text, author, source URL, attribution wording and permitted uses in the project manifest.

### D. Hot-linked technical examples

A remote vendor example may be used temporarily for internal technical validation when it is loaded from the publisher's own URL and not redistributed. Do not treat this as commercial reuse permission. Replace it before a public campaign unless the scene licence is confirmed.

## Avoid

- Research datasets restricted to academic or non-commercial use.
- User-generated scenes without a clear licence.
- Assets copied from an open-source viewer repository when their provenance is unclear.
- Public interiors without owner permission, even when the capture is technically easy.
- Scenes containing recognisable people, documents, number plates, security systems or private belongings without review.

## Required metadata

Every demonstration scene should record:

```json
{
  "assetOwner": "Whyme Spatial Lab",
  "sourceType": "procedural | own-capture | third-party",
  "sourceUrl": null,
  "licence": "Company-owned",
  "attribution": null,
  "commercialUseApproved": true,
  "publicHostingApproved": true,
  "expiryOrReviewDate": null,
  "privacyReview": "approved"
}
```

## Initial catalogue

1. **Spatial Gallery Concept** — browser-generated procedural Gaussian scene; safe for product demonstrations.
2. **Open 3DGS Study** — hot-linked SparkJS documentation asset; technical preview only until scene-level permission is confirmed.
3. **K1 vs P2 benchmark** — replace the hot-linked sample with same-scene vendor captures as soon as they are obtained.
4. **First owned property/venue pilot** — become the primary client-facing case study after signed location permission and privacy review.

## Current public technical demonstration

**Home Scan — Walk + Fly Multi-room Demo** uses Isaiah Sweeney's Home Scan
scene from SuperSplat under CC BY 4.0. The source, attribution, conversion
evidence, and scene-level limitations are recorded in
[`docs/research/spark-multi-room-demo-asset-2026-07-31.md`](./docs/research/spark-multi-room-demo-asset-2026-07-31.md).
The release is suitable for a clearly attributed product-capability demo. It is
not a company-owned case study and must be replaced by signed owned/client
capture evidence before marketing customer outcomes as field-proven.
