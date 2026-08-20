export const TRAJECTORY_EVIDENCE_SCHEMA_VERSION: "trajectory-evidence-v1";
export const TRAJECTORY_AUTO_OPEN_SOURCE: "trajectory-evidence";
export const DEFAULT_MINIMUM_VISITED_SAMPLES: number;
export const DEFAULT_CARRY_HEIGHT_BAND_M: { minimum: number; maximum: number };
export const OPENING_ROOM_MAXIMUM_GAP_M: number;

export type TrajectoryPlanLike = {
  levels?: ReadonlyArray<{
    id?: unknown;
    levelKey?: unknown;
    elevationM?: unknown;
    rooms?: ReadonlyArray<{
      id?: unknown;
      roomKey?: unknown;
      points?: ReadonlyArray<ReadonlyArray<number>>;
    }>;
    openings?: ReadonlyArray<{
      id?: unknown;
      openingKey?: unknown;
      type?: unknown;
      start?: ReadonlyArray<number>;
      end?: ReadonlyArray<number>;
    }>;
  }>;
};

export function parseTrajectoryPositions(
  input: Uint8Array | ArrayBuffer,
  options?: { maximumSamplePoints?: number },
): {
  format: string;
  vertexCount: number;
  sampledPointCount: number;
  samplingStride: number;
  bounds: { min: number[]; max: number[] };
  positions: Array<[number, number, number]>;
};

export function trajectoryWithinCaptureBounds(
  trajectoryBounds: { min: number[]; max: number[] },
  captureBounds: { min: number[]; max: number[] },
  options?: { toleranceM?: number },
): boolean;

export function trajectoryPlanEvidence(input: {
  positions: ReadonlyArray<ReadonlyArray<number>>;
  plan: TrajectoryPlanLike;
  minimumVisitedSamples?: number;
  carryHeightBandM?: { minimum: number; maximum: number };
}): {
  schemaVersion: "trajectory-evidence-v1";
  parameters: {
    minimumVisitedSamples: number;
    carryHeightBandM: { minimum: number; maximum: number };
  };
  sampleCount: number;
  unassignedSampleCount: number;
  levels: Array<{
    levelId: string;
    elevationM: number;
    sampleCount: number;
    rooms: Array<{ roomId: string; sampleCount: number; visited: boolean }>;
  }>;
  visitedRoomIds: string[];
};

export function trajectoryWallCrossingCount(input: {
  positions: ReadonlyArray<ReadonlyArray<number>>;
  span: { start?: ReadonlyArray<number>; end?: ReadonlyArray<number>; from?: ReadonlyArray<number>; to?: ReadonlyArray<number> };
  elevationM: number;
  carryHeightBandM?: { minimum: number; maximum: number };
}): number;

export function openingAdjacentRoomIds(input: {
  level: NonNullable<TrajectoryPlanLike["levels"]>[number];
  opening: { start?: ReadonlyArray<number>; end?: ReadonlyArray<number>; from?: ReadonlyArray<number>; to?: ReadonlyArray<number> };
  maximumGapM?: number;
}): string[];

export function proposalReportPlanLevels(report: unknown): NonNullable<TrajectoryPlanLike["levels"]>;

export function spanTrajectoryQualification(input: {
  level: NonNullable<TrajectoryPlanLike["levels"]>[number];
  levelId: string;
  span: { start?: ReadonlyArray<number>; end?: ReadonlyArray<number>; from?: ReadonlyArray<number>; to?: ReadonlyArray<number> };
  visitedRoomIds: ReadonlyArray<string>;
  maximumGapM?: number;
}): {
  qualified: boolean;
  reason: "both_adjacent_rooms_visited" | "adjacent_room_unvisited" | "envelope_or_unmodelled";
  roomIds: string[];
};

export function trajectoryQualifiedUnknownOpenings(input: {
  plan: TrajectoryPlanLike;
  trajectoryEvidence: unknown;
  maximumGapM?: number;
}): Array<{ levelId: string; openingId: string; roomIds: string[] }>;
