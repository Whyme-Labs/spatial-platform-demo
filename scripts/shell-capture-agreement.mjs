/**
 * Compares a reviewed structural shell against the capture it claims to model.
 *
 * Every other acceptance check reads the shell against itself — enclosure,
 * barrier sweeps, corner slides, route replays — so a wall authored straight
 * across an opening the capture plainly shows satisfies all of them and only
 * surfaces when a visitor walks into it. This reads the capture back: it walks
 * each reviewed barrier in short spans and reports the ones standing in empty
 * space, and reports occupied spans on the same wall line that no barrier
 * covers.
 *
 * It reports disagreement for a human to judge. Sparse capture, glass, mirrors,
 * and occlusion all produce empty spans behind real walls, so a finding is a
 * question about the shell, never proof that the shell is wrong.
 */

const DEFAULT_OPTIONS = {
  // Wall-height band. Skirting and ceiling returns are unreliable, and a band
  // that reaches the floor would read floor points as wall evidence.
  minHeight: 1.0,
  maxHeight: 2.0,
  // Span length along a barrier. A domestic doorway is ~0.8-1.2 m, so spans
  // must be shorter than the narrowest opening worth catching.
  spanMetres: 0.3,
  // Lateral tolerance around the barrier line, covering authoring slack and
  // capture noise.
  radiusMetres: 0.25,
  // A span holding fewer points than this is treated as unsupported.
  minimumSpanPoints: 4,
  // Consecutive unsupported spans needed before reporting, so a single noisy
  // span cannot raise a finding.
  minimumRunSpans: 3,
  // A barrier this short is a jamb or reveal and is skipped: it is too small to
  // carry its own capture evidence.
  minimumBarrierMetres: 0.6,
};

function bucketKey(x, y, z, cell) {
  return `${Math.floor(x / cell)},${Math.floor(y / cell)},${Math.floor(z / cell)}`;
}

/**
 * Indexes capture points once so each barrier span is a small bucket lookup
 * rather than a scan of the whole capture.
 */
export function indexCaptureSamples(points, options = {}) {
  const { minHeight, maxHeight, radiusMetres } = { ...DEFAULT_OPTIONS, ...options };
  const cell = Math.max(0.1, radiusMetres);
  const buckets = new Map();
  let kept = 0;
  for (const point of points) {
    const [x, y, z] = point;
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
    if (y < minHeight || y > maxHeight) continue;
    kept += 1;
    const key = bucketKey(x, y, z, cell);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(point);
    else buckets.set(key, [point]);
  }
  return { buckets, cell, keptPointCount: kept };
}

function pointsNear(index, x, z, radius, minHeight, maxHeight) {
  const { buckets, cell } = index;
  const reach = Math.ceil(radius / cell);
  const squared = radius * radius;
  let count = 0;
  const minBucketY = Math.floor(minHeight / cell);
  const maxBucketY = Math.floor(maxHeight / cell);
  for (let bx = Math.floor((x - radius) / cell); bx <= Math.floor((x + radius) / cell); bx += 1) {
    for (let bz = Math.floor((z - radius) / cell); bz <= Math.floor((z + radius) / cell); bz += 1) {
      for (let by = minBucketY; by <= maxBucketY; by += 1) {
        const bucket = buckets.get(`${bx},${by},${bz}`);
        if (!bucket) continue;
        for (const [px, , pz] of bucket) {
          const dx = px - x;
          const dz = pz - z;
          if (dx * dx + dz * dz <= squared) count += 1;
        }
      }
    }
  }
  void reach;
  return count;
}

function barrierLength(barrier) {
  return Math.hypot(barrier.end[0] - barrier.start[0], barrier.end[1] - barrier.start[1]);
}

/**
 * Walks one barrier in spans and returns the runs of consecutive spans whose
 * capture support falls below the threshold.
 */
export function unsupportedBarrierRuns(barrier, index, options = {}) {
  const settings = { ...DEFAULT_OPTIONS, ...options };
  const length = barrierLength(barrier);
  if (length < settings.minimumBarrierMetres) return [];
  const spanCount = Math.max(1, Math.round(length / settings.spanMetres));
  const [x1, z1] = barrier.start;
  const [x2, z2] = barrier.end;
  const spans = [];
  for (let step = 0; step < spanCount; step += 1) {
    const t = (step + 0.5) / spanCount;
    const x = x1 + (x2 - x1) * t;
    const z = z1 + (z2 - z1) * t;
    const points = pointsNear(
      index,
      x,
      z,
      settings.radiusMetres,
      settings.minHeight,
      settings.maxHeight,
    );
    spans.push({ t, x, z, points, supported: points >= settings.minimumSpanPoints });
  }
  const runs = [];
  let run = null;
  for (const [position, span] of spans.entries()) {
    if (span.supported) {
      if (run && run.spans.length >= settings.minimumRunSpans) runs.push(run);
      run = null;
      continue;
    }
    run ??= { spans: [], startIndex: position };
    run.spans.push(span);
    run.endIndex = position;
  }
  if (run && run.spans.length >= settings.minimumRunSpans) runs.push(run);
  const supportedSpanCount = spans.filter((span) => span.supported).length;
  return runs.map((entry) => {
    const supportedBefore = spans.slice(0, entry.startIndex).some((span) => span.supported);
    const supportedAfter = spans.slice(entry.endIndex + 1).some((span) => span.supported);
    // Capture on both sides of an empty run means the barrier crosses something
    // the capture shows as open — the case that traps a walker. A barrier with
    // no support anywhere is more likely the edge of the authored region, where
    // the capture simply continues past what anyone reviewed.
    const kind = supportedBefore && supportedAfter
      ? "barrier_crosses_open_capture"
      : supportedSpanCount === 0
        ? "barrier_without_any_capture"
        : "barrier_end_without_capture";
    return {
      kind,
      barrierId: barrier.id,
      spanCount: entry.spans.length,
      metres: Number((entry.spans.length * (length / spanCount)).toFixed(2)),
      from: [Number(entry.spans[0].x.toFixed(2)), Number(entry.spans[0].z.toFixed(2))],
      to: [
        Number(entry.spans.at(-1).x.toFixed(2)),
        Number(entry.spans.at(-1).z.toFixed(2)),
      ],
      maximumSpanPoints: Math.max(...entry.spans.map((span) => span.points)),
    };
  });
}

/**
 * Reports where a reviewed shell and its capture disagree.
 *
 * `points` is any iterable of [x, y, z] in the shell's own frame; callers are
 * expected to subsample a large capture before calling.
 */
export function compareShellToCapture({ authoring, points, options = {} }) {
  const settings = { ...DEFAULT_OPTIONS, ...options };
  const barriers = Array.isArray(authoring?.barrierSegments) ? authoring.barrierSegments : [];
  const index = indexCaptureSamples(points, settings);
  const findings = [];
  let inspected = 0;
  for (const barrier of barriers) {
    if (barrierLength(barrier) < settings.minimumBarrierMetres) continue;
    inspected += 1;
    findings.push(...unsupportedBarrierRuns(barrier, index, settings));
  }
  // Barriers crossing open capture come first: they are the ones that stop a
  // walker where the capture shows a way through.
  const rank = {
    barrier_crosses_open_capture: 0,
    barrier_end_without_capture: 1,
    barrier_without_any_capture: 2,
  };
  findings.sort((left, right) =>
    rank[left.kind] - rank[right.kind] || right.metres - left.metres
  );
  return {
    schemaVersion: "shell-capture-agreement-v1",
    settings: {
      minHeight: settings.minHeight,
      maxHeight: settings.maxHeight,
      spanMetres: settings.spanMetres,
      radiusMetres: settings.radiusMetres,
      minimumSpanPoints: settings.minimumSpanPoints,
      minimumRunSpans: settings.minimumRunSpans,
    },
    capturePointsInBand: index.keptPointCount,
    barrierCount: barriers.length,
    inspectedBarrierCount: inspected,
    findings,
    limitations: [
      "Sparse capture, glass, mirrors, and occlusion leave real walls unsupported.",
      "A finding asks whether a reviewed barrier belongs; it does not prove it does not.",
      "Barriers shorter than the minimum length are skipped as jambs and reveals.",
    ],
  };
}
