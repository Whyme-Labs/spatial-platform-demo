# Reusable indoor Gaussian-splat scenes for Spark 2.1

Research date: 2026-07-26

## Recommendation

Use AWS's **Laundry room** scene for the first hosted indoor example.

It is the best fit because it is:

- a complete indoor-room example rather than an isolated object;
- already encoded as a single `.sog` file that Spark 2.1 loads natively;
- small enough for a fast browser and R2 delivery test;
- committed inside an official AWS Solutions Library sample repository;
- covered by that repository's MIT No Attribution (`MIT-0`) license, with no separate asset exclusion found.

Pinned download:

<https://raw.githubusercontent.com/aws-solutions-library-samples/guidance-for-open-source-3d-reconstruction-toolbox-for-gaussian-splats-on-aws/73133959c04fb0f9f002e95b4d2a722de2d18722/source/Gradio/favorites/laundry%20room.sog>

Verified properties:

| Property | Value |
|---|---:|
| Format | SOG v2 ZIP container |
| Download size | 4,665,840 bytes (4.45 MiB) |
| Gaussian count | 192,191 |
| Generator recorded in `meta.json` | `splat-transform v3.1.0` |
| SHA-256 | `6bf14664068a3f59a651effb6055db36d8d4439423cde8ddf7c6ce0a2510e0b3` |

The repository README explicitly identifies the files in `source/Gradio/favorites` as compressed `.spz` and `.sog` example outputs, says they are editable, and says the collection demonstrates both exterior and interior spaces. Sources: [AWS repository README, Sample Gaussian Splat Outputs](https://github.com/aws-solutions-library-samples/guidance-for-open-source-3d-reconstruction-toolbox-for-gaussian-splats-on-aws#sample-gaussian-splat-outputs), [pinned repository directory](https://github.com/aws-solutions-library-samples/guidance-for-open-source-3d-reconstruction-toolbox-for-gaussian-splats-on-aws/tree/73133959c04fb0f9f002e95b4d2a722de2d18722/source/Gradio/favorites).

Spark 2.1 officially auto-detects and loads `.sog`/`.zip` assets. Source: [Spark loading documentation](https://sparkjs.dev/docs/loading-splats/).

Reproducible download:

```bash
curl --fail --location \
  --output laundry-room.sog \
  'https://raw.githubusercontent.com/aws-solutions-library-samples/guidance-for-open-source-3d-reconstruction-toolbox-for-gaussian-splats-on-aws/73133959c04fb0f9f002e95b4d2a722de2d18722/source/Gradio/favorites/laundry%20room.sog'

shasum -a 256 laundry-room.sog
```

## Other clear-license AWS candidates

These are in the same MIT-0 repository and are also ready for Spark 2.1 without conversion.

| Scene | Scope | Format | Exact size | Pinned download |
|---|---|---:|---:|---|
| Venetian hall panoramas | Hall-scale indoor environment reconstructed from panoramic input | SOG | 8,339,325 bytes (7.95 MiB) | [Download](https://raw.githubusercontent.com/aws-solutions-library-samples/guidance-for-open-source-3d-reconstruction-toolbox-for-gaussian-splats-on-aws/73133959c04fb0f9f002e95b4d2a722de2d18722/source/Gradio/favorites/venetian-hall-panos.sog) |
| Kitchen island | Indoor kitchen subject, but probably partial rather than a complete room | SOG | 7,506,155 bytes (7.16 MiB) | [Download](https://raw.githubusercontent.com/aws-solutions-library-samples/guidance-for-open-source-3d-reconstruction-toolbox-for-gaussian-splats-on-aws/73133959c04fb0f9f002e95b4d2a722de2d18722/source/Gradio/favorites/kitchen_island.sog) |

The byte sizes were verified against the pinned GitHub raw responses. The scene scope is identified by AWS's committed filenames; the repository does not provide longer per-scene descriptions.

## License and attribution

The AWS repository is licensed under **MIT No Attribution**. Its license grants unrestricted rights to use, copy, modify, merge, publish, distribute, sublicense, and sell copies. It does not require attribution. Source: [AWS repository LICENSE](https://github.com/aws-solutions-library-samples/guidance-for-open-source-3d-reconstruction-toolbox-for-gaussian-splats-on-aws/blob/73133959c04fb0f9f002e95b4d2a722de2d18722/LICENSE).

Although attribution is not legally required by MIT-0, a production credits entry is still advisable:

> Sample scene: “Laundry room,” from AWS Guidance for Open Source 3D Reconstruction Toolbox for Gaussian Splats on AWS.

This is a provenance assessment, not legal advice. The conclusion is based on the binary assets being committed as named sample outputs inside the licensed repository and the absence of any separate asset-license exception.

## High-quality official Spark and World Labs fixtures with unclear redistribution rights

These assets are technically excellent and directly compatible with Spark, but they should be treated as evaluation fixtures rather than copied into a commercial production deployment unless World Labs confirms broader rights in writing.

| Scene | Format | Exact size | Official source | Licensing assessment |
|---|---:|---:|---|---|
| Painted bedroom | SPZ v2, 500k splats | 7,841,329 bytes | [Download](https://storage.googleapis.com/forge-dev-public/painted_bedroom.spz), [Spark asset manifest](https://github.com/sparkjsdev/spark/blob/main/examples/assets.json#L98-L101) | External binary has no published per-asset license |
| Greyscale bedroom | SPZ v2, 2M splats | 30,672,159 bytes | [Download](https://storage.googleapis.com/forge-dev-public/marble-scenes/greyscale-room.spz), [Spark asset manifest](https://github.com/sparkjsdev/spark/blob/main/examples/assets.json#L74-L77) | External binary has no published per-asset license |
| Cozy Spaceship | RAD v1 streaming LoD; official demo describes 6M splats | 131,752,776 bytes | [Download](https://storage.googleapis.com/forge-dev-public/asundqui/rad/260217/cozy-spaceship_2-lod.rad), [Spark streaming example and creator credit](https://github.com/sparkjsdev/spark/blob/main/examples/streaming-lod/index.html#L58-L63) | External binary has no published per-asset license |
| Rustic kitchen with natural light | SPZ, 500k / 2M | 7,582,907 / 30,268,621 bytes | [500k](https://wlt-ai-cdn.art/example_exports/rustic_kitchen_with_natural_light/rustic_kitchen_with_natural_light_500k.spz), [2M](https://wlt-ai-cdn.art/example_exports/rustic_kitchen_with_natural_light/rustic_kitchen_with_natural_light_2m.spz), [World Labs export spec](https://docs.worldlabs.ai/marble/export/specs) | Published for testing, not under a permissive asset license |
| Elegant library with fireplace | SPZ, 500k / 2M | 7,707,659 / 30,729,020 bytes | [500k](https://wlt-ai-cdn.art/example_exports/elegant_library_with_fireplace/elegant_library_with_fireplace_500k.spz), [2M](https://wlt-ai-cdn.art/example_exports/elegant_library_with_fireplace/elegant_library_with_fireplace_2m.spz), [World Labs export spec](https://docs.worldlabs.ai/marble/export/specs) | Published for testing, not under a permissive asset license |
| Warm traditional kitchen | SPZ, 500k / 2M | 7,642,113 / 30,374,234 bytes | [500k](https://wlt-ai-cdn.art/example_exports/warm_traditional_kitchen_interior/warm_traditional_kitchen_interior_500k.spz), [2M](https://wlt-ai-cdn.art/example_exports/warm_traditional_kitchen_interior/warm_traditional_kitchen_interior_2m.spz), [World Labs export spec](https://docs.worldlabs.ai/marble/export/specs) | Published for testing, not under a permissive asset license |

Why the Spark repository's MIT license is insufficient for these files:

1. The bedroom and spaceship binaries are hosted outside the Git repository.
2. `examples/assets.json` lists URLs but no asset-specific license or redistribution grant.
3. The Spark README allows its example assets to be downloaded and cached to run the examples locally, but it does not expressly grant commercial redistribution rights for the remote scene content.
4. World Labs' current terms retain World Labs' rights in service content and grant output rights according to the account that generated the output; they do not grant unrelated third parties general rights to rehost public sample outputs. Source: [World Labs Terms of Service, sections 3.1–3.3](https://docs.worldlabs.ai/terms-of-service#3-intellectual-property).

Accordingly, the already-tested `painted_bedroom.spz` is suitable as a temporary upstream compatibility check, but AWS's `laundry room.sog` is the safer asset to retain in our own R2-backed demonstration.

## PLY alternative if a denser real-world room is needed

Voxel51 publishes a real-world **Playroom** Gaussian reconstruction under dataset metadata declaring Apache-2.0:

- [7,000-iteration PLY download](https://huggingface.co/datasets/Voxel51/gaussian_splatting/resolve/main/FO_dataset/playroom/point_cloud/iteration_7000/point_cloud.ply?download=true)
- Size: 370,875,860 bytes
- Header: binary little-endian PLY with 1,495,461 vertices and the expected Gaussian position, spherical-harmonic, opacity, scale, and rotation fields
- [Dataset card and license metadata](https://huggingface.co/datasets/Voxel51/gaussian_splatting)
- [Reference image](https://huggingface.co/datasets/Voxel51/gaussian_splatting/resolve/main/FO_dataset/playroom/DSC05572.jpg?download=true)

Spark 2.1 can load PLY directly, and its official `build-lod` tool can convert PLY to paged RAD for production streaming. Source: [Spark LoD documentation](https://sparkjs.dev/docs/lod-getting-started/).

This option is substantially heavier and carries more provenance uncertainty than the AWS samples: the Hugging Face metadata declares Apache-2.0, but there is no separate license file or detailed capture-rights statement in the dataset repository. Prefer the AWS SOG for the public demonstration.

## Rejected dataset

InteriorGS has attractive complete indoor scenes, semantics, floorplans, and navigability data, but its license permits only non-commercial research and educational use and explicitly prohibits redistribution. It is unsuitable for this production application. Sources: [InteriorGS repository](https://github.com/manycore-research/InteriorGS), [InteriorGS Terms of Use](https://kloudsim-usa-cos.kujiale.com/InteriorGS/InteriorGS_Terms_of_Use.pdf).
