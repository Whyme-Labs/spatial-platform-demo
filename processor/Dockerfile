FROM rust:1-bookworm AS spark-builder

ARG SPARK_COMMIT=f22236f95fdd8078f0c12e3aab479523d401daf6
RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/*
RUN git init /spark \
  && git -C /spark remote add origin https://github.com/sparkjsdev/spark.git \
  && git -C /spark fetch --depth 1 origin "${SPARK_COMMIT}" \
  && git -C /spark checkout --detach FETCH_HEAD \
  && test "$(git -C /spark rev-parse HEAD)" = "${SPARK_COMMIT}"
RUN cargo build \
  --manifest-path /spark/rust/build-lod/Cargo.toml \
  --release \
  --no-default-features

FROM mambaorg/micromamba:2.3.2@sha256:ce2026639d612fbe837a35ca9d513292a8d776a24a5e6c82cccf9dddf45ad3d2 AS pdal-runtime
RUN micromamba install --yes --name base --channel conda-forge "pdal=2.9.2" \
  && micromamba clean --all --yes

FROM node:22-bookworm-slim
LABEL org.opencontainers.image.version="0.12.1"

ENV NODE_ENV=production \
  NODE_OPTIONS="--max-old-space-size=6144" \
  PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
  PROCESSOR_CHROME_PATH=/usr/bin/chromium \
  SPARK_BUILD_LOD_BIN=/usr/local/bin/spark-build-lod \
  PDAL_BIN=/opt/conda/bin/pdal \
  PATH=/opt/conda/bin:${PATH} \
  LD_LIBRARY_PATH=/opt/conda/lib
RUN apt-get update \
  && apt-get install -y --no-install-recommends chromium ca-certificates fonts-liberation \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY processor/package.json processor/package-lock.json ./
RUN npm ci --omit=optional --ignore-scripts
COPY --from=spark-builder /spark/rust/target/release/build-lod /usr/local/bin/spark-build-lod
COPY --from=pdal-runtime /opt/conda /opt/conda
COPY scripts/processing-agent.mjs scripts/processing-agent-core.mjs scripts/poster-quality.mjs scripts/navigation-build-core.mjs scripts/physical-navigation-validation.mjs scripts/authored-collision.mjs scripts/automatic-spatial-pipeline.mjs scripts/horizontal-surface.mjs scripts/e57-structure-core.mjs ./scripts/
RUN pdal --version \
  && pdal --drivers | grep -q "readers.e57" \
  && pdal --drivers | grep -q "readers.las" \
  && pdal --drivers | grep -q "readers.pts" \
  && pdal --drivers | grep -q "writers.ply"

USER node
ENTRYPOINT ["node", "scripts/processing-agent.mjs", "--once"]
