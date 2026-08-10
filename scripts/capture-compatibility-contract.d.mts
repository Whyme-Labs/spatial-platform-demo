export const AUTOMATIC_PLY_COORDINATE_EVIDENCE_METHOD:
  "automatic-ply-coordinate-evidence-v1";
export const PLY_COORDINATE_HEADER_BUDGET_BYTES: number;
export const PLY_COORDINATE_HEADER_BUDGET_NAME: "ply_coordinate_header_bytes";

export type CoordinateBounds = {
  min: [number, number, number];
  max: [number, number, number];
};

export type PlyCoordinateProperty = {
  name: string;
  offset: number;
  bytes: number;
  read: (view: DataView, offset: number) => number;
};

export type PlyCoordinateDescriptor = {
  schemaVersion: "ply-coordinate-descriptor-v1";
  format: "binary_little_endian";
  vertexCount: number;
  recordBytes: number;
  dataOffset: number;
  coordinateFrameId: string;
  sourceUpAxis: string;
  worldUnit: string;
  properties: PlyCoordinateProperty[];
  propertyByName: Map<string, PlyCoordinateProperty>;
};

export type PlyCoordinateEvidence = {
  schemaVersion: "ply-coordinate-evidence-v1";
  method: typeof AUTOMATIC_PLY_COORDINATE_EVIDENCE_METHOD;
  coordinateFrameId: string;
  sourceUpAxis: string;
  worldUnit: string;
  vertexCount: number;
  finitePointCount: number;
  bounds: CoordinateBounds;
};

export type PairedPlyCoordinatePreflight =
  | { status: "qualified" }
  | { status: "contradicted"; reason: string };

export type PairedPlyCoordinateQualification =
  | {
      qualified: true;
      method: typeof AUTOMATIC_PLY_COORDINATE_EVIDENCE_METHOD;
      coordinateFrameId: string;
      sourceUpAxis: "Y";
      worldUnit: "metres";
      overlapBounds: CoordinateBounds;
      visual: PlyCoordinateEvidence;
      geometry: PlyCoordinateEvidence;
    }
  | { qualified: false; reason: string };
