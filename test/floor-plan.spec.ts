import { describe, expect, it } from "vitest";
import {
  buildFloorPlans,
  cameraPoseForPlanRoom,
  floorPlanDisplayLabel,
  locatePlanRoom,
  projectFloorPlan,
} from "../src/client/floor-plan";

const entities = [
  {
    id: "floor-ground",
    parent_id: null,
    kind: "floor" as const,
    label: "Ground floor",
    position_json: "[0,0,0]",
    geometry_json: null,
    sort_order: 0,
  },
  {
    id: "room-lobby",
    parent_id: "floor-ground",
    kind: "room" as const,
    label: "Lobby",
    position_json: null,
    geometry_json: JSON.stringify({
      type: "box",
      points: [[-3, 0, -2], [1, 3, 2]],
    }),
    sort_order: 10,
  },
  {
    id: "room-gallery",
    parent_id: "floor-ground",
    kind: "room" as const,
    label: "Gallery",
    position_json: "[3,1.5,0]",
    geometry_json: JSON.stringify({
      type: "polygon",
      points: [[1, 0, -2], [5, 0, -2], [5, 0, 2], [1, 0, 2]],
    }),
    sort_order: 20,
  },
  {
    id: "room-invalid",
    parent_id: "floor-ground",
    kind: "room" as const,
    label: "Invalid",
    position_json: null,
    geometry_json: "{\"type\":\"box\",\"points\":[[0,0,0],[0,0,0]]}",
    sort_order: 30,
  },
];

describe("floor-plan projection", () => {
  it("builds one deterministic floor from valid authored room footprints", () => {
    const plans = buildFloorPlans(entities);

    expect(plans).toHaveLength(1);
    expect(plans[0]).toMatchObject({
      id: "floor-ground",
      label: "Ground floor",
      bounds: { minX: -3, minZ: -2, maxX: 5, maxZ: 2 },
    });
    expect(plans[0]?.rooms.map((room) => room.id)).toEqual([
      "room-lobby",
      "room-gallery",
    ]);
  });

  it("builds a combined navigation map from standalone floor zones", () => {
    const floorZones = [{
      id: "zone-main",
      parent_id: null,
      kind: "floor" as const,
      label: "Main room",
      position_json: null,
      geometry_json: JSON.stringify({
        type: "polygon",
        points: [[0, 0.1, 0], [4, 0.1, 0], [4, 0.1, 3], [0, 0.1, 3]],
      }),
      sort_order: 10,
    }, {
      id: "zone-side",
      parent_id: null,
      kind: "floor" as const,
      label: "Side room",
      position_json: null,
      geometry_json: JSON.stringify({
        type: "polygon",
        points: [[-3, 0.2, 0], [-1, 0.2, 0], [-1, 0.2, 2], [-3, 0.2, 2]],
      }),
      sort_order: 20,
    }, {
      id: "zone-connector",
      parent_id: null,
      kind: "doorway" as const,
      label: "Main to side connector",
      position_json: null,
      geometry_json: JSON.stringify({
        type: "polygon",
        points: [[-1.2, 0.15, 0.8], [0.2, 0.15, 0.8], [0.2, 0.15, 1.2], [-1.2, 0.15, 1.2]],
      }),
      sort_order: 30,
    }];

    expect(buildFloorPlans(floorZones)).toEqual([expect.objectContaining({
      id: "standalone-floor-zones",
      label: "Walkable areas",
      rooms: [
        expect.objectContaining({ id: "zone-main", floorId: "standalone-floor-zones" }),
        expect.objectContaining({ id: "zone-side", floorId: "standalone-floor-zones" }),
      ],
      connectors: [
        expect.objectContaining({ id: "zone-connector", floorId: "standalone-floor-zones" }),
      ],
      bounds: { minX: -3, minZ: 0, maxX: 4, maxZ: 3 },
    })]);
    expect(projectFloorPlan(buildFloorPlans(floorZones)[0]!).connectors).toEqual([
      expect.objectContaining({ id: "zone-connector", path: expect.stringContaining(" Z") }),
    ]);
  });

  it("uses numbered map labels when full room names would collide", () => {
    expect(floorPlanDisplayLabel("Walk zone 3 — side room", 2, 4)).toBe("3");
    expect(floorPlanDisplayLabel("Lobby", 0, 2)).toBe("Lobby");
    expect(floorPlanDisplayLabel("A very long authored room name", 0, 1)).toBe("1");
  });

  it("preserves scene proportions in a bounded SVG projection", () => {
    const plan = buildFloorPlans(entities)[0]!;
    const projected = projectFloorPlan(plan, 400, 240, 20);

    expect(projected.viewBox).toBe("0 0 400 240");
    expect(projected.rooms[0]?.path).toBe("M20 210 L200 210 L200 30 L20 30 Z");
    expect(projected.rooms[1]?.path).toBe("M200 210 L380 210 L380 30 L200 30 Z");
    expect(projected.rooms[0]?.labelPosition).toEqual([110, 120]);
  });

  it("locates the current camera inside authored polygons", () => {
    const plan = buildFloorPlans(entities)[0]!;

    expect(locatePlanRoom(plan, [-1, 1.6, 0])?.id).toBe("room-lobby");
    expect(locatePlanRoom(plan, [4, 1.6, 0])?.id).toBe("room-gallery");
    expect(locatePlanRoom(plan, [12, 1.6, 0])).toBeNull();
  });

  it("derives a room camera that remains inside the authored box", () => {
    const room = buildFloorPlans(entities)[0]!.rooms[0]!;

    expect(cameraPoseForPlanRoom(room)).toEqual({
      position: [-1, 1.6, 0.72],
      target: [-1, 1.25, 0],
      up: [0, 1, 0],
      fovDegrees: 58,
    });
  });

  it("stands the destination camera above a flat extracted floor polygon", () => {
    // Extracted rooms are flat slabs, so their vertical extent is far below a
    // room height and their authored position sits on the floor. The pose has
    // to be a standing eye height; a floor-level Y makes the renderer derive
    // feet a full eye height under the navigation mesh and refuse the move.
    const plan = buildFloorPlans([{
      id: "room-extracted",
      parent_id: null,
      kind: "room" as const,
      label: "Extracted living room",
      position_json: JSON.stringify([3, 0.15, -2]),
      geometry_json: JSON.stringify({
        type: "polygon",
        points: [
          [1, 0.05, -4], [5, 0.05, -4], [5, 0.25, 0], [1, 0.25, 0],
        ],
      }),
    }])[0]!;
    const room = plan.rooms[0]!;
    const pose = cameraPoseForPlanRoom(room);

    expect(room.maxY - room.minY).toBeLessThan(1.7);
    expect(pose.position[1]).toBeCloseTo(room.minY + 1.6, 6);
    expect(pose.position[1] - room.maxY).toBeGreaterThan(1);
  });

  it("keeps the destination camera inside a concave standalone walk zone", () => {
    const plans = buildFloorPlans([{
      id: "zone-concave",
      parent_id: null,
      kind: "floor" as const,
      label: "Concave side room",
      position_json: null,
      geometry_json: JSON.stringify({
        type: "polygon",
        points: [
          [-2.1, 0.15, -0.8], [-2.1, 0.15, -1], [-3.6, 0.2, -1.15],
          [-4.1, 0.25, -1.2], [-4.1, 0.25, -0.7], [-4.4, 0.25, -0.5],
          [-4.4, 0.2, 0], [-4.4, 0.15, 1], [-2.2, 0.15, 1.1],
          [-2.2, 0.15, 0.5], [-2.6, 0.15, 0.3], [-2.6, 0.15, -0.5],
        ],
      }),
    }]);
    const plan = plans[0]!;
    const room = plan.rooms[0]!;
    const pose = cameraPoseForPlanRoom(room);

    expect(locatePlanRoom(plan, pose.position)?.id).toBe(room.id);
  });
});
