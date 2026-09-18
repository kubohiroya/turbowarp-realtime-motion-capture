import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import { AvatarRetargetController } from "../src/avatar/controller.js";
import { AFRAME_CAPABILITY_KEY } from "../src/avatar/aframe-port.js";
import { COCO_17_KEYPOINT_IDS } from "../src/pose/types.js";
import type { KalidokitPoseRig } from "../src/avatar/types.js";

const VRM_URL = "avatars/actor.vrm";

function mockCapability() {
  const nodes = new Set<string>();
  const capability = {
    version: 2,
    requireVersion: vi.fn(function (this: unknown, version: number) {
      if (version !== 2) throw new Error(`unsupported version ${version}`);
      return this;
    }),
    loadTemplate: vi.fn(),
    createFromTemplate: vi.fn((_template: string, instance: string) => {
      nodes.add(instance);
    }),
    setPosition: vi.fn(),
    emitEvent: vi.fn(),
    deleteSelector: vi.fn((selector: string) => {
      nodes.delete(selector.replace(/^#/u, ""));
    }),
    countSelector: vi.fn((selector: string) =>
      nodes.has(selector.replace(/^#/u, "")) ? 1 : 0,
    ),
    loadVrm: vi.fn<(url: string, selector: string) => Promise<undefined>>(
      async () => undefined,
    ),
    setVrmBoneRotation: vi.fn(),
    setVrmExpression: vi.fn(),
    vrmExpressionNames: vi.fn<(selector: string) => string[]>(() => [
      "happy",
      "blink",
    ]),
  };
  const runtime: TurboWarpRuntime = { [AFRAME_CAPABILITY_KEY]: capability };
  return { capability, nodes, runtime };
}

async function fixture(name: string): Promise<string> {
  return readFile(new URL(`fixtures/avatar/${name}`, import.meta.url), "utf8");
}

async function configured() {
  const context = mockCapability();
  const poseSolver = { solve: vi.fn(() => solvedRig()) };
  const controller = new AvatarRetargetController(context.runtime, poseSolver);
  controller.registerAsset("actor", VRM_URL, await fixture("rig.json"));
  return { ...context, controller, poseSolver };
}

function boneCalls(
  capability: ReturnType<typeof mockCapability>["capability"],
  instance: string,
): Map<string, number[]> {
  return new Map(
    capability.setVrmBoneRotation.mock.calls
      .filter(([selector]) => selector === `#${instance}`)
      .map(([, bone, x, y, z]) => [bone as string, [x, y, z] as number[]]),
  );
}

const degrees = (radians: number) => (radians * 180) / Math.PI;

describe("AvatarRetargetController", () => {
  it("loads the VRM through capability v2 and drives every humanoid bone", async () => {
    const { capability, controller } = await configured();
    await controller.bind("performer-1", "avatar-1", "actor", "#scene", 0.3);
    applyFrame(controller, [person("performer-1")]);

    expect(capability.requireVersion).toHaveBeenCalledWith(2);
    expect(capability.requireVersion).not.toHaveBeenCalledWith(1);
    expect(capability.loadTemplate).toHaveBeenCalledWith(
      "twmp-avatar-actor",
      '{"type":"empty"}',
    );
    expect(capability.createFromTemplate).toHaveBeenCalledWith(
      "twmp-avatar-actor",
      "avatar-1",
      "#scene",
    );
    expect(capability.loadVrm).toHaveBeenCalledWith(VRM_URL, "#avatar-1");
    expect(capability.setPosition).toHaveBeenCalledWith("#avatar-1", 3, 4, 5);

    const bones = boneCalls(capability, "avatar-1");
    expect([...bones.keys()].sort()).toEqual(
      [
        "hips",
        "leftHand",
        "leftLowerArm",
        "leftLowerLeg",
        "leftUpperArm",
        "leftUpperLeg",
        "rightHand",
        "rightLowerArm",
        "rightLowerLeg",
        "rightUpperArm",
        "rightUpperLeg",
        "spine",
      ].sort(),
    );
    // Kalidokit's RightUpperArm (0.1, 0.2, 0.3) is the performer's left arm; on the VRM
    // normalized bone its signs become (-x, -y, z).
    const [x, y, z] = bones.get("leftUpperArm") ?? [];
    expect(x).toBeCloseTo(-degrees(0.1), 10);
    expect(y).toBeCloseTo(-degrees(0.2), 10);
    expect(z).toBeCloseTo(degrees(0.3), 10);
    expect(bones.get("rightUpperArm")?.[0]).toBeCloseTo(-degrees(0.4), 10);

    expect(capability.emitEvent).toHaveBeenCalledWith(
      "actor-recognition-start",
      "#avatar-1",
      JSON.stringify({
        personId: "performer-1",
        avatarInstanceId: "avatar-1",
        timestampUs: 9_007_199_254_740_000,
      }),
    );
    expect(controller.updatedCount()).toBe(1);
    expect(controller.state()).toBe("ready");
  });

  it("skips bones whose source joints are unsure and emits recognition end without blocking another person", async () => {
    const { capability, controller } = await configured();
    await controller.bind("performer-1", "avatar-1", "actor", "#scene", 0.5);
    await controller.bind("performer-2", "avatar-2", "actor", "#scene", 0.5);
    const first = person("performer-1");
    first.keypoints[5]!.score = 0.1; // left_shoulder
    applyFrame(controller, [first, person("performer-2")]);
    const bones = boneCalls(capability, "avatar-1");
    expect(bones.has("leftUpperArm")).toBe(false);
    expect(bones.has("spine")).toBe(false);
    expect(bones.has("rightUpperArm")).toBe(true);
    expect(boneCalls(capability, "avatar-2").has("leftUpperArm")).toBe(true);
    expect(controller.updatedCount()).toBe(2);

    applyFrame(controller, [person("performer-2")]);
    expect(capability.emitEvent).toHaveBeenCalledWith(
      "actor-recognition-end",
      "#avatar-1",
      expect.any(String),
    );
    expect(controller.updatedCount()).toBe(1);
  });

  it("isolates per-person A-Frame failures and detects scene-reset bindings", async () => {
    const { capability, controller, nodes } = await configured();
    await controller.bind("performer-1", "avatar-1", "actor", "#scene", 0.3);
    await controller.bind("performer-2", "avatar-2", "actor", "#scene", 0.3);
    capability.setVrmBoneRotation.mockImplementation((selector: string) => {
      if (selector === "#avatar-1")
        throw new Error("VRM avatar-1 has no humanoid bone");
    });
    applyFrame(controller, [person("performer-1"), person("performer-2")]);
    expect(controller.updatedCount()).toBe(1);
    expect(controller.state()).toBe("partial");
    expect(controller.error()).toMatch(
      /performer-1: VRM avatar-1 has no humanoid bone/u,
    );

    nodes.clear();
    applyFrame(controller, [person("performer-1"), person("performer-2")]);
    expect(controller.bindingCount()).toBe(0);
    expect(controller.error()).toMatch(/scene reset/u);
  });

  it("removes the instance when its VRM fails to load", async () => {
    const { capability, controller, nodes } = await configured();
    capability.loadVrm.mockRejectedValueOnce(
      new Error("fetch responded with 404"),
    );
    await expect(
      controller.bind("performer-1", "avatar-1", "actor", "#scene", 0.3),
    ).rejects.toThrow(/404/u);
    expect(capability.deleteSelector).toHaveBeenCalledWith("#avatar-1");
    expect(nodes.has("avatar-1")).toBe(false);
    expect(controller.bindingCount()).toBe(0);
    expect(controller.state()).toBe("error");
    expect(controller.error()).toMatch(
      /performer-1: fetch responded with 404/u,
    );
  });

  it("does not drive an avatar until its VRM is ready, and drops one unbound while loading", async () => {
    const { capability, controller } = await configured();
    let finish: (() => void) | undefined;
    capability.loadVrm.mockImplementationOnce(
      () =>
        new Promise<undefined>(
          (resolve) => (finish = () => resolve(undefined)),
        ),
    );
    const binding = controller.bind(
      "performer-1",
      "avatar-1",
      "actor",
      "#scene",
      0.3,
    );
    expect(controller.state()).toBe("loading");
    applyFrame(controller, [person("performer-1")]);
    expect(capability.setVrmBoneRotation).not.toHaveBeenCalled();
    expect(controller.updatedCount()).toBe(0);

    controller.unbind("performer-1");
    finish?.();
    await binding;
    expect(controller.bindingCount()).toBe(0);
    expect(capability.deleteSelector).toHaveBeenCalledWith("#avatar-1");
  });

  it("rejects old rig mappings, invalid frames, duplicate instances, and more than six bindings", async () => {
    const { controller } = await configured();
    expect(() =>
      controller.registerAsset(
        "bad",
        VRM_URL,
        '{"bones":[{"selector":"#{avatar}-x","rig":"LeftUpperArm"}]}',
      ),
    ).toThrow(/no longer takes bones/u);
    expect(() =>
      controller.registerAsset("bad", VRM_URL, '{"scale":1}'),
    ).toThrow(/unknown field: scale/u);
    expect(() => controller.registerAsset("bad", " ", "{}")).toThrow(
      /VRM URL must not be empty/u,
    );
    expect(() => controller.apply("{}", "{}")).toThrow(
      /Invalid PoseFrame3D v1/u,
    );
    for (let index = 0; index < 6; index += 1) {
      await controller.bind(
        `performer-${index}`,
        `avatar-${index}`,
        "actor",
        "#scene",
        0.3,
      );
    }
    await expect(
      controller.bind("performer-6", "avatar-6", "actor", "#scene", 0.3),
    ).rejects.toThrow(/at most six/u);
    await expect(
      controller.bind("different", "avatar-0", "actor", "#scene", 0.3),
    ).rejects.toThrow(/already bound/u);
  });

  it("cleans recognition state and created instances on reset", async () => {
    const { capability, controller } = await configured();
    await controller.bind("performer-1", "avatar-1", "actor", "#scene", 0.3);
    applyFrame(controller, [person("performer-1")]);
    await controller.bind("performer-1", "avatar-2", "actor", "#scene", 0.3);
    expect(capability.deleteSelector).toHaveBeenCalledWith("#avatar-1");
    expect(controller.bindingCount()).toBe(1);
    applyFrame(controller, [person("performer-1")]);
    controller.reset();
    expect(capability.emitEvent).toHaveBeenLastCalledWith(
      "actor-recognition-end",
      "#avatar-2",
      expect.any(String),
    );
    expect(capability.deleteSelector).toHaveBeenCalledWith("#avatar-2");
    expect(controller.bindingCount()).toBe(0);
    expect(controller.state()).toBe("idle");
  });

  it("sets expressions on the avatar bound to a person", async () => {
    const { capability, controller } = await configured();
    await controller.bind("performer-1", "avatar-1", "actor", "#scene", 0.3);
    controller.setExpression("performer-1", "happy", 0.7);
    expect(capability.setVrmExpression).toHaveBeenCalledWith(
      "#avatar-1",
      "happy",
      0.7,
    );
    expect(controller.expressionNames("performer-1")).toEqual([
      "happy",
      "blink",
    ]);
    expect(capability.vrmExpressionNames).toHaveBeenCalledWith("#avatar-1");

    expect(() => controller.setExpression("performer-2", "happy", 1)).toThrow(
      /No avatar is bound to person: performer-2/u,
    );
    expect(() => controller.setExpression("performer-1", " ", 1)).toThrow(
      /expression name must not be empty/u,
    );
    capability.setVrmExpression.mockImplementationOnce(() => {
      throw new Error("VRM avatar-1 has no expression: angry");
    });
    expect(() => controller.setExpression("performer-1", "angry", 1)).toThrow(
      /no expression: angry/u,
    );
  });

  it("skips expressions while the VRM loads", async () => {
    const { capability, controller } = await configured();
    let finish: (() => void) | undefined;
    capability.loadVrm.mockImplementationOnce(
      () =>
        new Promise<undefined>(
          (resolve) => (finish = () => resolve(undefined)),
        ),
    );
    const binding = controller.bind(
      "performer-1",
      "avatar-1",
      "actor",
      "#scene",
      0.3,
    );
    controller.setExpression("performer-1", "happy", 1);
    expect(capability.setVrmExpression).not.toHaveBeenCalled();
    expect(controller.expressionNames("performer-1")).toEqual([]);
    finish?.();
    await binding;
    controller.setExpression("performer-1", "happy", 1);
    expect(capability.setVrmExpression).toHaveBeenCalledTimes(1);
  });

  it("stands the avatar on the PoseFrame3D hips when the rig asks for the world root", async () => {
    const context = mockCapability();
    const controller = new AvatarRetargetController(context.runtime, {
      solve: vi.fn(() => solvedRig()),
    });
    controller.registerAsset(
      "actor",
      VRM_URL,
      JSON.stringify({ root: "world", rootScale: 2, rootOffset: [1, 2, 3] }),
    );
    await controller.bind("performer-1", "avatar-1", "actor", "#scene", 0.3);
    const screen = person2d("performer-1");
    // The screen hips are unsure; the world root does not read them.
    screen.keypoints[11]!.score = 0.1;
    controller.apply(frame([person("performer-1")]), frame2d([screen]));
    // Hips at (0, 1, 1) and (2, 1, 1): midpoint (1, 1, 1), in scene axes (1, -1, -1), then scaled and offset.
    expect(context.capability.setPosition).toHaveBeenCalledWith(
      "#avatar-1",
      3,
      0,
      1,
    );
    expect(() =>
      controller.registerAsset("bad", VRM_URL, '{"root":"floor"}'),
    ).toThrow(/root must be "kalidokit" or "world"/u);
  });

  it("fails closed unless A-Frame provides capability v2", async () => {
    const rig = await fixture("rig.json");
    expect(() =>
      new AvatarRetargetController({}).registerAsset("actor", VRM_URL, rig),
    ).toThrow(/capability v2 must be loaded/u);

    // TurboWarp-A-Frame 0.3.0 published version 1 only and refuses requireVersion(2).
    const versionOne = mockCapability();
    versionOne.capability.version = 1;
    versionOne.capability.requireVersion.mockImplementation(() => {
      throw new Error(
        "Unsupported A-Frame runtime capability version: 2; supported version is 1.",
      );
    });
    expect(() =>
      new AvatarRetargetController(versionOne.runtime).registerAsset(
        "actor",
        VRM_URL,
        rig,
      ),
    ).toThrow(/capability v2 is required: Unsupported .* version: 2/u);

    const wrongVersion = mockCapability();
    wrongVersion.capability.version = 3;
    expect(() =>
      new AvatarRetargetController(wrongVersion.runtime).registerAsset(
        "actor",
        VRM_URL,
        rig,
      ),
    ).toThrow(/v2 is required; found version 3/u);

    // TurboWarp-A-Frame 0.4.0 has capability v2 without the expression operations.
    const withoutExpressions = mockCapability();
    Reflect.deleteProperty(withoutExpressions.capability, "setVrmExpression");
    expect(() =>
      new AvatarRetargetController(withoutExpressions.runtime).registerAsset(
        "actor",
        VRM_URL,
        rig,
      ),
    ).toThrow(/missing setVrmExpression\(\); TurboWarp-A-Frame 0.5.0/u);

    const withoutVrm = mockCapability();
    Reflect.deleteProperty(withoutVrm.capability, "loadVrm");
    expect(() =>
      new AvatarRetargetController(withoutVrm.runtime).registerAsset(
        "actor",
        VRM_URL,
        rig,
      ),
    ).toThrow(/missing loadVrm\(\)/u);
  });
});

function frame(persons: ReturnType<typeof person>[]): string {
  return JSON.stringify({
    schema: "twrmc/pose-frame-3d",
    version: 1,
    sequence: 7,
    timestampUs: 9_007_199_254_740_000,
    persons,
  });
}

function applyFrame(
  controller: AvatarRetargetController,
  people: ReturnType<typeof person>[],
): void {
  controller.apply(
    frame(people),
    frame2d(people.map(({ personId }) => person2d(personId))),
  );
}

function person(personId: string) {
  const keypoints = COCO_17_KEYPOINT_IDS.map((id) => ({
    id,
    x: 1,
    y: 1,
    z: 1,
    score: 0.9,
  }));
  keypoints[5] = { ...keypoints[5]!, x: 0, y: 0, z: 0 };
  keypoints[7] = { ...keypoints[7]!, x: 0, y: 1, z: 0 };
  keypoints[11] = { ...keypoints[11]!, x: 0, y: 1, z: 1 };
  keypoints[12] = { ...keypoints[12]!, x: 2, y: 1, z: 1 };
  return {
    personId,
    score: 0.9,
    cameraIds: ["camera-1", "camera-2"],
    meanReprojectionErrorPx: 1,
    keypoints,
  };
}

function frame2d(persons: ReturnType<typeof person2d>[]): string {
  return JSON.stringify({
    schema: "twrmc/pose-frame-2d",
    version: 1,
    cameraId: "camera-1",
    peerId: "source-1",
    sequence: 7,
    captureTimestampUs: 9_007_199_254_740_000,
    frameWidth: 1920,
    frameHeight: 1080,
    calibrationId: "calibration-1",
    persons,
  });
}

function person2d(trackingId: string) {
  return {
    trackingId,
    score: 0.9,
    keypoints: COCO_17_KEYPOINT_IDS.map((id, index) => ({
      id,
      x: 100 + index * 10,
      y: 200 + index * 5,
      score: 0.9,
    })),
  };
}

function solvedRig(): KalidokitPoseRig {
  const rotation = { x: 0.1, y: 0.2, z: 0.3 };
  return {
    RightUpperArm: rotation,
    RightLowerArm: rotation,
    LeftUpperArm: { x: 0.4, y: 0.5, z: 0.6 },
    LeftLowerArm: rotation,
    RightHand: rotation,
    LeftHand: rotation,
    RightUpperLeg: rotation,
    RightLowerLeg: rotation,
    LeftUpperLeg: rotation,
    LeftLowerLeg: rotation,
    Spine: rotation,
    Hips: {
      position: rotation,
      worldPosition: { x: 1, y: 1, z: 1 },
      rotation,
    },
  };
}
