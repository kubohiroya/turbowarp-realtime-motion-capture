import { Pose } from "kalidokit";
import { describe, expect, it, vi } from "vitest";
import {
  KalidokitPoseAdapter,
  type KalidokitPoseApi,
} from "../src/avatar/kalidokit-adapter.js";
import type {
  KalidokitPoseRig,
  PoseFrame2DPerson,
  PoseFrame3DPerson,
} from "../src/avatar/types.js";
import { COCO_17_KEYPOINT_IDS } from "../src/pose/types.js";

describe("KalidokitPoseAdapter", () => {
  it("adapts corresponding COCO-17 world and screen landmarks to BlazePose-33", () => {
    const solve = vi.fn<KalidokitPoseApi["solve"]>(() => rig());
    const adapter = new KalidokitPoseAdapter({ solve });
    const result = adapter.solve(worldPerson(), screenPerson(), {
      width: 1920,
      height: 1080,
    });
    expect(result).toEqual(rig());
    const [world, screen, options] = solve.mock.calls[0]!;
    expect(world).toHaveLength(33);
    expect(screen).toHaveLength(33);
    // Moved so that the hips (COCO-17 indices 11 and 12) are centred on the origin.
    expect(world[0]).toMatchObject({
      x: -11.5,
      y: -11.5,
      z: -11.5,
      score: 0.9,
    });
    expect(world[1]).toEqual(world[2]);
    expect(world[11]).toMatchObject({ x: -6.5, y: -6.5, z: -6.5 });
    expect(world[17]?.score).toBeCloseTo(0.225);
    expect(world[29]?.score).toBeCloseTo(0.225);
    expect(screen[11]).toMatchObject({ x: 150, y: 225, z: 0 });
    expect(options).toEqual({
      runtime: "tfjs",
      imageSize: { width: 1920, height: 1080 },
      enableLegs: true,
    });
  });

  it("solves a pose in a room's frame as it solves the same pose centred on the hips", () => {
    const adapter = new KalidokitPoseAdapter(Pose as KalidokitPoseApi);
    const size = { width: 1920, height: 1080 };
    const centred = adapter.solve(standing(0, 0, 0), standingScreen(), size);
    const inRoom = adapter.solve(standing(3, 1.2, 4), standingScreen(), size);
    for (const key of Object.keys(centred) as (keyof KalidokitPoseRig)[]) {
      if (key === "Hips") continue;
      for (const axis of ["x", "y", "z"] as const) {
        expect(inRoom[key][axis]).toBeCloseTo(centred[key][axis], 9);
      }
    }
    expect(inRoom.Hips.rotation?.y).toBeCloseTo(centred.Hips.rotation!.y, 9);
    // Arms held out and legs in view are solved rather than dropped to rest as off screen.
    expect(Math.abs(inRoom.RightUpperArm.z)).toBeLessThan(0.5);
    expect(Math.abs(inRoom.LeftUpperArm.z)).toBeLessThan(0.5);
    expect(inRoom.RightUpperLeg).not.toEqual({ x: 0, y: 0, z: 0 });
    expect(inRoom.LeftLowerLeg).not.toEqual({ x: 0, y: 0, z: 0 });
  });

  it("rejects missing, degenerate, and unsupported solver output explicitly", () => {
    const adapter = new KalidokitPoseAdapter({
      solve: vi.fn<KalidokitPoseApi["solve"]>(() => rig()),
    });
    const missing = worldPerson();
    missing.keypoints.pop();
    expect(() =>
      adapter.solve(missing, screenPerson(), { width: 1920, height: 1080 }),
    ).toThrow(/Missing world COCO-17 landmark/u);

    const degenerate = worldPerson();
    for (const point of degenerate.keypoints) {
      point.x = 0;
      point.y = 0;
      point.z = 0;
    }
    expect(() =>
      adapter.solve(degenerate, screenPerson(), { width: 1920, height: 1080 }),
    ).toThrow(/degenerate world pose/u);

    const empty = new KalidokitPoseAdapter({
      solve: vi.fn<KalidokitPoseApi["solve"]>(() => undefined),
    });
    expect(() =>
      empty.solve(worldPerson(), screenPerson(), { width: 1920, height: 1080 }),
    ).toThrow(/returned no rig/u);
  });
});

function worldPerson(): PoseFrame3DPerson {
  return {
    personId: "performer-1",
    score: 0.9,
    keypoints: COCO_17_KEYPOINT_IDS.map((id, index) => ({
      id,
      x: index,
      y: index + 1,
      z: index + 2,
      score: 0.9,
    })),
  };
}

function screenPerson(): PoseFrame2DPerson {
  return {
    trackingId: "performer-1",
    score: 0.9,
    keypoints: COCO_17_KEYPOINT_IDS.map((id, index) => ({
      id,
      x: 100 + index * 10,
      y: 200 + index * 5,
      score: 0.9,
    })),
  };
}

function rig(): KalidokitPoseRig {
  const rotation = { x: 0.1, y: 0.2, z: 0.3 };
  return {
    RightUpperArm: rotation,
    RightLowerArm: rotation,
    LeftUpperArm: rotation,
    LeftLowerArm: rotation,
    RightHand: rotation,
    LeftHand: rotation,
    RightUpperLeg: rotation,
    RightLowerLeg: rotation,
    LeftUpperLeg: rotation,
    LeftLowerLeg: rotation,
    Spine: rotation,
    Hips: { position: rotation, worldPosition: rotation, rotation },
  };
}

/** Metres, y down: arms held out to the sides, knees slightly bent, then moved by (dx, dy, dz). */
const STANDING: Record<string, [number, number, number]> = {
  nose: [0, -0.62, -0.1],
  left_eye: [0.03, -0.66, -0.08],
  right_eye: [-0.03, -0.66, -0.08],
  left_ear: [0.07, -0.64, 0],
  right_ear: [-0.07, -0.64, 0],
  left_shoulder: [0.18, -0.5, 0],
  right_shoulder: [-0.18, -0.5, 0],
  left_elbow: [0.45, -0.5, 0.02],
  right_elbow: [-0.45, -0.5, 0.02],
  left_wrist: [0.7, -0.5, 0.04],
  right_wrist: [-0.7, -0.5, 0.04],
  left_hip: [0.1, 0, 0],
  right_hip: [-0.1, 0, 0],
  left_knee: [0.11, 0.45, -0.05],
  right_knee: [-0.11, 0.45, -0.05],
  left_ankle: [0.12, 0.88, 0.02],
  right_ankle: [-0.12, 0.88, 0.02],
};

function standing(dx: number, dy: number, dz: number): PoseFrame3DPerson {
  return {
    personId: "performer-1",
    score: 0.9,
    keypoints: COCO_17_KEYPOINT_IDS.map((id) => {
      const [x, y, z] = STANDING[id]!;
      return { id, x: x + dx, y: y + dy, z: z + dz, score: 0.9 };
    }),
  };
}

/** The same pose seen from the front, mirrored as a camera sees it. */
function standingScreen(): PoseFrame2DPerson {
  return {
    trackingId: "performer-1",
    score: 0.9,
    keypoints: COCO_17_KEYPOINT_IDS.map((id) => {
      const [x, y] = STANDING[id]!;
      return { id, x: 960 - x * 400, y: 600 + y * 400, score: 0.9 };
    }),
  };
}
