import { Earcut } from "three/src/extras/Earcut.js";

const GEOMETRY_EPSILON = 1e-6;

export function horizontalSurfaceIssue(surface) {
  if (!surface || typeof surface.id !== "string" || !surface.id.trim()) {
    return "surface id is missing";
  }
  const points = surface.points;
  const holes = Array.isArray(surface.holes) ? surface.holes : [];
  const outerIssue = horizontalRingIssue(points);
  if (outerIssue) return `outer ring ${outerIssue}`;
  const elevation = points[0][1];
  for (let index = 0; index < holes.length; index += 1) {
    const issue = horizontalRingIssue(holes[index]);
    if (issue) return `hole ${index + 1} ${issue}`;
  }
  if ([points, ...holes].flat().some((point) =>
    Math.abs(point[1] - elevation) > GEOMETRY_EPSILON)) {
    return "rings are not coplanar and horizontal";
  }
  const outer2 = ring2(points);
  const holes2 = holes.map(ring2);
  for (let index = 0; index < holes2.length; index += 1) {
    const hole = holes2[index];
    if (
      ringsIntersect(outer2, hole) ||
      hole.some((point) => !pointInPolygon2(point, outer2) || pointOnRing2(point, outer2))
    ) {
      return `hole ${index + 1} is not strictly contained by the outer ring`;
    }
    for (let prior = 0; prior < index; prior += 1) {
      if (
        ringsIntersect(holes2[prior], hole) ||
        pointInPolygon2(hole[0], holes2[prior]) ||
        pointInPolygon2(holes2[prior][0], hole)
      ) {
        return `holes ${prior + 1} and ${index + 1} overlap or touch`;
      }
    }
  }
  const expectedArea = Math.abs(signedArea2(outer2)) -
    holes2.reduce((total, hole) => total + Math.abs(signedArea2(hole)), 0);
  if (expectedArea <= GEOMETRY_EPSILON) return "usable area is zero";
  const triangulation = triangulateHorizontalSurfaceUnchecked(surface);
  if (triangulation.indices.length < 3) return "could not be triangulated";
  const triangulatedArea = triangleAreaSum(triangulation.points2, triangulation.indices);
  const tolerance = Math.max(GEOMETRY_EPSILON, expectedArea * GEOMETRY_EPSILON);
  if (Math.abs(triangulatedArea - expectedArea) > tolerance) {
    return `triangulated area ${triangulatedArea} does not match ring area ${expectedArea}`;
  }
  return null;
}

export function triangulateHorizontalSurface(surface) {
  const issue = horizontalSurfaceIssue(surface);
  if (issue) throw new Error(`Horizontal surface ${surface?.id ?? "unknown"} ${issue}`);
  return triangulateHorizontalSurfaceUnchecked(surface);
}

export function pointInHorizontalSurface2(point, surface, includeBoundary = true) {
  const outer = ring2(surface.points);
  const onOuterBoundary = pointOnRing2(point, outer);
  if (onOuterBoundary ? !includeBoundary : !pointInPolygon2(point, outer)) return false;
  return !(surface.holes ?? []).some((hole) => {
    const ring = ring2(hole);
    const onBoundary = pointOnRing2(point, ring);
    if (onBoundary) return !includeBoundary;
    return pointInPolygon2(point, ring);
  });
}

export function pointInPolygon2(point, polygon) {
  let inside = false;
  for (let current = 0, previous = polygon.length - 1; current < polygon.length;
    previous = current, current += 1) {
    const a = polygon[current];
    const b = polygon[previous];
    const crosses = (a[1] > point[1]) !== (b[1] > point[1]) &&
      point[0] < ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1]) + a[0];
    if (crosses) inside = !inside;
  }
  return inside;
}

export function pointOnRing2(point, ring) {
  return ring.some((start, index) =>
    pointOnSegment2(point, start, ring[(index + 1) % ring.length]));
}

export function segmentsIntersect2(a, b, c, d) {
  const orientations = [orientation(a, b, c), orientation(a, b, d),
    orientation(c, d, a), orientation(c, d, b)];
  if (orientations.some((value) => Math.abs(value) <= GEOMETRY_EPSILON)) {
    return pointOnSegment2(a, c, d) || pointOnSegment2(b, c, d) ||
      pointOnSegment2(c, a, b) || pointOnSegment2(d, a, b);
  }
  return (orientations[0] > 0) !== (orientations[1] > 0) &&
    (orientations[2] > 0) !== (orientations[3] > 0);
}

export function ring2(points) {
  return points.map(([x, _y, z]) => [x, z]);
}

function horizontalRingIssue(points) {
  if (!Array.isArray(points) || points.length < 3 || points.some((point) =>
    !Array.isArray(point) || point.length !== 3 || point.some((value) => !Number.isFinite(value)))) {
    return "requires at least three finite x, y, z points";
  }
  if (points.some((point, index) => samePoint3(point, points[(index + 1) % points.length]))) {
    return "contains a zero-length edge";
  }
  const projected = ring2(points);
  if (Math.abs(signedArea2(projected)) <= GEOMETRY_EPSILON) return "has zero area";
  for (let first = 0; first < projected.length; first += 1) {
    const firstEnd = (first + 1) % projected.length;
    for (let second = first + 1; second < projected.length; second += 1) {
      const secondEnd = (second + 1) % projected.length;
      if (first === second || firstEnd === second || secondEnd === first) continue;
      if (segmentsIntersect2(
        projected[first], projected[firstEnd], projected[second], projected[secondEnd],
      )) return "self-intersects or touches a non-adjacent edge";
    }
  }
  return null;
}

function triangulateHorizontalSurfaceUnchecked(surface) {
  const rings = [surface.points, ...(surface.holes ?? [])];
  const points3 = rings.flat().map((point) => point.map(Number));
  const points2 = ring2(points3);
  const holeIndices = [];
  let offset = surface.points.length;
  for (const hole of surface.holes ?? []) {
    holeIndices.push(offset);
    offset += hole.length;
  }
  return {
    points3,
    points2,
    indices: Earcut.triangulate(points2.flat(), holeIndices, 2),
  };
}

function ringsIntersect(first, second) {
  return first.some((start, index) => {
    const end = first[(index + 1) % first.length];
    return second.some((otherStart, otherIndex) =>
      segmentsIntersect2(start, end, otherStart, second[(otherIndex + 1) % second.length]));
  });
}

function pointOnSegment2(point, start, end) {
  if (Math.abs(orientation(start, end, point)) > GEOMETRY_EPSILON) return false;
  return point[0] >= Math.min(start[0], end[0]) - GEOMETRY_EPSILON &&
    point[0] <= Math.max(start[0], end[0]) + GEOMETRY_EPSILON &&
    point[1] >= Math.min(start[1], end[1]) - GEOMETRY_EPSILON &&
    point[1] <= Math.max(start[1], end[1]) + GEOMETRY_EPSILON;
}

function orientation(a, b, c) {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function signedArea2(points) {
  return points.reduce((area, point, index) => {
    const next = points[(index + 1) % points.length];
    return area + point[0] * next[1] - next[0] * point[1];
  }, 0) / 2;
}

function triangleAreaSum(points, indices) {
  let area = 0;
  for (let index = 0; index < indices.length; index += 3) {
    area += Math.abs(signedArea2([
      points[indices[index]], points[indices[index + 1]], points[indices[index + 2]],
    ]));
  }
  return area;
}

function samePoint3(first, second) {
  return first.every((value, index) => Math.abs(value - second[index]) <= GEOMETRY_EPSILON);
}
