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

FROM node:22-bookworm-slim

ENV NODE_ENV=production \
  PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
  PROCESSOR_CHROME_PATH=/usr/bin/chromium \
  SPARK_BUILD_LOD_BIN=/usr/local/bin/spark-build-lod
RUN apt-get update \
  && apt-get install -y --no-install-recommends chromium ca-certificates fonts-liberation \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY processor/package.json processor/package-lock.json ./
RUN npm ci --omit=optional --ignore-scripts
COPY --from=spark-builder /spark/rust/target/release/build-lod /usr/local/bin/spark-build-lod
COPY scripts/processing-agent.mjs scripts/processing-agent-core.mjs scripts/poster-quality.mjs ./scripts/

USER node
ENTRYPOINT ["node", "scripts/processing-agent.mjs", "--once"]
