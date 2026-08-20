export const stagingLifecycleCoordinateFrameId =
  "staging-lifecycle-room-y-up-metres";

export function metricRoomPoints({ candidateChange = false } = {}) {
  const points = [];
  for (let xIndex = 0; xIndex <= 16; xIndex += 1) {
    for (let zIndex = 0; zIndex <= 12; zIndex += 1) {
      const x = xIndex * 0.25;
      const z = zIndex * 0.25;
      points.push([x, 0, z], [x, 2.5, z]);
    }
  }
  for (let heightIndex = 0; heightIndex <= 25; heightIndex += 1) {
    const y = heightIndex * 0.1;
    for (let xIndex = 0; xIndex <= 16; xIndex += 1) {
      const x = xIndex * 0.25;
      points.push([x, y, 0], [x, y, 3]);
    }
    for (let zIndex = 1; zIndex < 12; zIndex += 1) {
      const z = zIndex * 0.25;
      points.push([0, y, z], [4, y, z]);
    }
  }
  // Break the room shell's 180-degree rotational symmetry so the automatic
  // registration can prove one solution. The candidate's small second marker
  // creates an immutable, measurable raw change without overwhelming the
  // registration RMSE gate.
  for (let heightIndex = 0; heightIndex <= 20; heightIndex += 1) {
    const y = 0.25 + heightIndex * 0.1;
    for (let zIndex = 0; zIndex <= 8; zIndex += 1) {
      points.push([0.65, y, 0.55 + zIndex * 0.1]);
    }
    for (let xIndex = 1; xIndex <= 7; xIndex += 1) {
      points.push([0.65 + xIndex * 0.1, y, 0.55]);
    }
  }
  if (candidateChange) {
    for (let heightIndex = 0; heightIndex <= 15; heightIndex += 1) {
      const y = 0.25 + heightIndex * 0.1;
      for (let xIndex = 0; xIndex <= 1; xIndex += 1) {
        points.push([3.1 + xIndex * 0.1, y, 0.7]);
      }
    }
  }
  return points;
}

export function metricPointCloudPly(points) {
  const header = new TextEncoder().encode([
    "ply",
    "format binary_little_endian 1.0",
    "comment deterministic staging lifecycle registered metric room fixture",
    `comment spatial_studio_coordinate_frame ${stagingLifecycleCoordinateFrameId}`,
    "comment spatial_studio_up_axis Y",
    "comment spatial_studio_units metres",
    `element vertex ${points.length}`,
    "property float x",
    "property float y",
    "property float z",
    "end_header",
    "",
  ].join("\n"));
  const bytes = new Uint8Array(header.byteLength + points.length * 12);
  bytes.set(header);
  const view = new DataView(bytes.buffer);
  points.forEach((point, pointIndex) => point.forEach((value, axis) => {
    view.setFloat32(header.byteLength + pointIndex * 12 + axis * 4, value, true);
  }));
  return bytes;
}
