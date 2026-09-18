import { Value } from "@sinclair/typebox/value";
import { PoseFrame2DSchema, PoseFrame3DSchema } from "../protocol/schemas.js";
import { requireAFrameCapability } from "./aframe-port.js";
import { KalidokitPoseAdapter } from "./kalidokit-adapter.js";
import { KALIDOKIT_RIG_KEYS } from "./types.js";
import type { Coco17KeypointId } from "../pose/types.js";
import type {
  AFrameCapabilityPort,
  AvatarPoseSolverPort,
  AvatarRigMapping,
  KalidokitPoseRig,
  KalidokitRigKey,
  PoseFrame2D,
  PoseFrame2DPerson,
  PoseFrame3D,
  PoseFrame3DKeypoint,
  PoseFrame3DPerson,
} from "./types.js";

interface AvatarAsset {
  id: string;
  templateId: string;
  vrmUrl: string;
  rig: AvatarRigMapping;
}

interface AvatarBinding {
  personId: string;
  instanceId: string;
  assetId: string;
  confidence: number;
  recognized: boolean;
  loaded: boolean;
}

const identifiers = /^[A-Za-z0-9._-]{1,64}$/u;
const eventNames = /^[A-Za-z0-9._:-]{1,80}$/u;
/** Every avatar instance is an empty node that the VRM is loaded onto. */
const HOLDER_TEMPLATE = JSON.stringify({ type: "empty" });

/**
 * Kalidokit solves a mirrored selfie view: its `Right*` outputs come from the performer's
 * left landmarks. A stage avatar moves the performer's own side, so each output drives the
 * opposite VRM humanoid bone.
 */
const VRM_BONES: Record<KalidokitRigKey, string> = {
  RightUpperArm: "leftUpperArm",
  RightLowerArm: "leftLowerArm",
  LeftUpperArm: "rightUpperArm",
  LeftLowerArm: "rightLowerArm",
  RightHand: "leftHand",
  LeftHand: "rightHand",
  RightUpperLeg: "leftUpperLeg",
  RightLowerLeg: "leftLowerLeg",
  LeftUpperLeg: "rightUpperLeg",
  LeftLowerLeg: "rightLowerLeg",
  Spine: "spine",
  Hips: "hips",
};
/**
 * The joints each Kalidokit output is computed from. Its `Right*` outputs read the
 * performer's left landmarks (BlazePose 11, 13, 15, 23, 25, 27), and `Left*` the right.
 */
const RIG_REQUIRED_JOINTS: Record<
  KalidokitRigKey,
  readonly Coco17KeypointId[]
> = {
  RightUpperArm: ["left_shoulder", "left_elbow"],
  RightLowerArm: ["left_elbow", "left_wrist"],
  LeftUpperArm: ["right_shoulder", "right_elbow"],
  LeftLowerArm: ["right_elbow", "right_wrist"],
  RightHand: ["left_wrist"],
  LeftHand: ["right_wrist"],
  RightUpperLeg: ["left_hip", "left_knee"],
  RightLowerLeg: ["left_knee", "left_ankle"],
  LeftUpperLeg: ["right_hip", "right_knee"],
  LeftLowerLeg: ["right_knee", "right_ankle"],
  Spine: ["left_shoulder", "right_shoulder", "left_hip", "right_hip"],
  Hips: ["left_hip", "right_hip"],
};

export class AvatarRetargetController {
  private readonly runtime: TurboWarpRuntime;
  private readonly solver: AvatarPoseSolverPort;
  private readonly assets = new Map<string, AvatarAsset>();
  private readonly bindings = new Map<string, AvatarBinding>();
  private lastState = "idle";
  private lastError = "";
  private lastUpdated = 0;

  public constructor(
    runtime: TurboWarpRuntime,
    solver: AvatarPoseSolverPort = new KalidokitPoseAdapter(),
  ) {
    this.runtime = runtime;
    this.solver = solver;
  }

  public registerAsset(
    assetIdValue: string,
    vrmUrlValue: string,
    rigJson: string,
  ): void {
    const assetId = identifier(assetIdValue, "avatar asset ID");
    const vrmUrl = nonEmpty(vrmUrlValue, "VRM URL");
    if (vrmUrl.length > 2048)
      throw new Error("VRM URL exceeds 2048 characters.");
    const rig = parseRigMapping(rigJson);
    const aframe = requireAFrameCapability(this.runtime);
    const templateId = `twmp-avatar-${assetId}`;
    aframe.loadTemplate(templateId, HOLDER_TEMPLATE);
    this.assets.set(assetId, { id: assetId, templateId, vrmUrl, rig });
    this.succeed("configured");
  }

  public async bind(
    personIdValue: string,
    instanceIdValue: string,
    assetIdValue: string,
    parentSelectorValue: string,
    confidenceValue: number,
  ): Promise<void> {
    const personId = identifier(personIdValue, "person ID");
    const instanceId = identifier(instanceIdValue, "avatar instance ID");
    const assetId = identifier(assetIdValue, "avatar asset ID");
    const parentSelector = nonEmpty(parentSelectorValue, "parent selector");
    const confidence = threshold(confidenceValue);
    const asset = this.assets.get(assetId);
    if (!asset) throw new Error(`Unknown avatar asset: ${assetId}`);
    const existingPerson = this.bindings.get(personId);
    const existingInstance = [...this.bindings.values()].find(
      (binding) => binding.instanceId === instanceId,
    );
    if (existingInstance && existingInstance.personId !== personId) {
      throw new Error(`Avatar instance is already bound: ${instanceId}`);
    }
    if (!existingPerson && this.bindings.size >= 6) {
      throw new Error("Avatar retargeting supports at most six people.");
    }
    const aframe = requireAFrameCapability(this.runtime);
    if (
      instanceId !== existingPerson?.instanceId &&
      aframe.countSelector(`#${instanceId}`) > 0
    ) {
      throw new Error(`A-Frame node already exists: ${instanceId}`);
    }
    if (existingPerson) this.removeBinding(aframe, existingPerson);
    if (aframe.countSelector(`#${instanceId}`) > 0) {
      throw new Error(`A-Frame node already exists: ${instanceId}`);
    }
    aframe.createFromTemplate(asset.templateId, instanceId, parentSelector);
    const binding: AvatarBinding = {
      personId,
      instanceId,
      assetId,
      confidence,
      recognized: false,
      loaded: false,
    };
    this.bindings.set(personId, binding);
    this.lastState = "loading";
    try {
      await aframe.loadVrm(asset.vrmUrl, `#${instanceId}`);
    } catch (error) {
      if (this.bindings.get(personId) === binding) {
        this.bindings.delete(personId);
        aframe.deleteSelector(`#${instanceId}`);
        this.lastState = "error";
        this.lastError = `${personId}: ${message(error)}`;
      }
      throw error;
    }
    // A rebind, unbind, or reset during the load has already replaced this binding.
    if (this.bindings.get(personId) !== binding) return;
    binding.loaded = true;
    this.succeed("bound");
  }

  public unbind(personIdValue: string): void {
    const personId = identifier(personIdValue, "person ID");
    const binding = this.bindings.get(personId);
    if (!binding) return;
    this.removeBinding(requireAFrameCapability(this.runtime), binding);
    this.succeed("configured");
  }

  public apply(frameJson: string, pose2dJson: string): void {
    this.lastUpdated = 0;
    this.lastError = "";
    let frame: PoseFrame3D;
    let pose2d: PoseFrame2D;
    let aframe: AFrameCapabilityPort;
    try {
      frame = parseFrame(frameJson);
      pose2d = parsePoseFrame2D(pose2dJson);
      aframe = requireAFrameCapability(this.runtime);
    } catch (error) {
      this.lastState = "error";
      this.lastError = message(error);
      throw error;
    }
    const people = new Map(
      frame.persons.map((person) => [person.personId, person]),
    );
    const screenPeople = new Map(
      pose2d.persons.map((person) => [person.trackingId, person]),
    );
    const errors: string[] = [];
    for (const binding of [...this.bindings.values()]) {
      if (!binding.loaded) continue;
      try {
        if (aframe.countSelector(`#${binding.instanceId}`) !== 1) {
          this.bindings.delete(binding.personId);
          errors.push(
            `${binding.personId}: avatar instance is missing after scene reset`,
          );
          continue;
        }
        const person = people.get(binding.personId);
        const screenPerson = screenPeople.get(binding.personId);
        if (
          !person ||
          !screenPerson ||
          person.score < binding.confidence ||
          screenPerson.score < binding.confidence
        ) {
          this.setRecognized(aframe, binding, false, frame.timestampUs);
          continue;
        }
        this.applyPerson(aframe, binding, person, screenPerson, pose2d);
        this.setRecognized(aframe, binding, true, frame.timestampUs);
        this.lastUpdated += 1;
      } catch (error) {
        errors.push(`${binding.personId}: ${message(error)}`);
      }
    }
    if (errors.length > 0) {
      this.lastState = "partial";
      this.lastError = errors.join("; ");
    } else {
      this.lastState = "ready";
    }
  }

  public reset(): void {
    const candidate = this.runtime.turbowarpAFrameCapability;
    if (typeof candidate === "object" && candidate !== null) {
      try {
        const aframe = requireAFrameCapability(this.runtime);
        for (const binding of [...this.bindings.values()]) {
          this.removeBinding(aframe, binding);
        }
      } catch {
        this.bindings.clear();
      }
    } else {
      this.bindings.clear();
    }
    this.assets.clear();
    this.lastUpdated = 0;
    this.succeed("idle");
  }

  /**
   * Sets an expression on the VRM bound to a person. Connecting Performance DSL effects to
   * expressions belongs to the application; this only reaches the right avatar. A binding
   * whose VRM is still loading is skipped, as frames are.
   */
  public setExpression(
    personIdValue: string,
    name: string,
    weight: number,
  ): void {
    const binding = this.requireBinding(personIdValue);
    if (!binding.loaded) return;
    requireAFrameCapability(this.runtime).setVrmExpression(
      `#${binding.instanceId}`,
      nonEmpty(name, "expression name"),
      weight,
    );
  }

  public expressionNames(personIdValue: string): string[] {
    const binding = this.requireBinding(personIdValue);
    if (!binding.loaded) return [];
    return requireAFrameCapability(this.runtime).vrmExpressionNames(
      `#${binding.instanceId}`,
    );
  }

  public bindingCount(): number {
    return this.bindings.size;
  }

  public state(): string {
    return this.lastState;
  }

  public error(): string {
    return this.lastError;
  }

  public updatedCount(): number {
    return this.lastUpdated;
  }

  private applyPerson(
    aframe: AFrameCapabilityPort,
    binding: AvatarBinding,
    person: PoseFrame3DPerson,
    screenPerson: PoseFrame2DPerson,
    pose2d: PoseFrame2D,
  ): void {
    const asset = this.assets.get(binding.assetId);
    if (!asset) throw new Error(`Unknown avatar asset: ${binding.assetId}`);
    const rig = this.solver.solve(person, screenPerson, {
      width: pose2d.frameWidth,
      height: pose2d.frameHeight,
    });
    const worldKeypoints = new Map<string, PoseFrame3DKeypoint>(
      person.keypoints.map((point) => [point.id, point] as const),
    );
    const screenKeypoints = new Map<
      string,
      PoseFrame2DPerson["keypoints"][number]
    >(screenPerson.keypoints.map((point) => [point.id, point] as const));
    const fromWorld = asset.rig.root === "world";
    const rootConfident = requiredJoints("Hips").every(
      (id) =>
        (worldKeypoints.get(id)?.score ?? 0) >= binding.confidence &&
        (fromWorld ||
          (screenKeypoints.get(id)?.score ?? 0) >= binding.confidence),
    );
    const root = fromWorld
      ? worldRoot(worldKeypoints)
      : (rig.Hips.worldPosition ?? rig.Hips.position);
    if (rootConfident && root) {
      const [offsetX, offsetY, offsetZ] = asset.rig.rootOffset;
      aframe.setPosition(
        `#${binding.instanceId}`,
        root.x * asset.rig.rootScale + offsetX,
        root.y * asset.rig.rootScale + offsetY,
        root.z * asset.rig.rootScale + offsetZ,
      );
    }
    for (const key of KALIDOKIT_RIG_KEYS) {
      this.applyBone(
        aframe,
        binding,
        key,
        rig,
        worldKeypoints,
        screenKeypoints,
      );
    }
  }

  private applyBone(
    aframe: AFrameCapabilityPort,
    binding: AvatarBinding,
    key: KalidokitRigKey,
    rig: KalidokitPoseRig,
    worldKeypoints: ReadonlyMap<string, PoseFrame3DKeypoint>,
    screenKeypoints: ReadonlyMap<
      string,
      PoseFrame2DPerson["keypoints"][number]
    >,
  ): void {
    if (
      !requiredJoints(key).every(
        (id) =>
          (worldKeypoints.get(id)?.score ?? 0) >= binding.confidence &&
          (screenKeypoints.get(id)?.score ?? 0) >= binding.confidence,
      )
    ) {
      return;
    }
    const [x, y, z] = vrmBoneDegrees(rotationForRig(rig, key));
    aframe.setVrmBoneRotation(
      `#${binding.instanceId}`,
      VRM_BONES[key],
      x,
      y,
      z,
    );
  }

  private setRecognized(
    aframe: AFrameCapabilityPort,
    binding: AvatarBinding,
    recognized: boolean,
    timestampUs: number | undefined,
  ): void {
    if (binding.recognized === recognized) return;
    const asset = this.assets.get(binding.assetId);
    if (!asset) return;
    binding.recognized = recognized;
    aframe.emitEvent(
      recognized
        ? asset.rig.recognitionStartEvent
        : asset.rig.recognitionEndEvent,
      `#${binding.instanceId}`,
      JSON.stringify({
        personId: binding.personId,
        avatarInstanceId: binding.instanceId,
        ...(timestampUs === undefined ? {} : { timestampUs }),
      }),
    );
  }

  private removeBinding(
    aframe: AFrameCapabilityPort,
    binding: AvatarBinding,
    timestampUs?: number,
  ): void {
    this.setRecognized(aframe, binding, false, timestampUs);
    aframe.deleteSelector(`#${binding.instanceId}`);
    this.bindings.delete(binding.personId);
  }

  private requireBinding(personIdValue: string): AvatarBinding {
    const personId = identifier(personIdValue, "person ID");
    const binding = this.bindings.get(personId);
    if (!binding) throw new Error(`No avatar is bound to person: ${personId}`);
    return binding;
  }

  private succeed(state: string): void {
    this.lastState = state;
    this.lastError = "";
  }
}

function parseFrame(source: string): PoseFrame3D {
  const value = parseJsonObject(source, "PoseFrame3D JSON");
  if (!Value.Check(PoseFrame3DSchema, value)) {
    const first = Value.Errors(PoseFrame3DSchema, value).First();
    throw new Error(
      `Invalid PoseFrame3D v1 at ${first?.path || "/"}: ${first?.message ?? "schema mismatch"}`,
    );
  }
  return value as unknown as PoseFrame3D;
}

function parsePoseFrame2D(source: string): PoseFrame2D {
  const value = parseJsonObject(source, "PoseFrame2D JSON");
  if (!Value.Check(PoseFrame2DSchema, value)) {
    const first = Value.Errors(PoseFrame2DSchema, value).First();
    throw new Error(
      `Invalid PoseFrame2D v1 at ${first?.path || "/"}: ${first?.message ?? "schema mismatch"}`,
    );
  }
  return value as unknown as PoseFrame2D;
}

function parseRigMapping(source: string): AvatarRigMapping {
  const value = parseJsonObject(source, "Avatar rig mapping JSON");
  if ("bones" in value) {
    throw new Error(
      "Rig mapping no longer takes bones: VRM humanoid bones are driven directly.",
    );
  }
  const allowed = new Set([
    "root",
    "rootScale",
    "rootOffset",
    "recognitionStartEvent",
    "recognitionEndEvent",
  ]);
  rejectUnknownKeys(value, allowed, "rig mapping");
  const root = value.root ?? "kalidokit";
  if (root !== "kalidokit" && root !== "world") {
    throw new Error('root must be "kalidokit" or "world".');
  }
  const rootScale = finite(value.rootScale ?? 1, "rootScale");
  if (rootScale <= 0) throw new Error("rootScale must be greater than zero.");
  const rootOffset = vector3(value.rootOffset ?? [0, 0, 0], "rootOffset");
  const recognitionStartEvent = eventName(
    value.recognitionStartEvent ?? "twmp-recognition-start",
    "recognitionStartEvent",
  );
  const recognitionEndEvent = eventName(
    value.recognitionEndEvent ?? "twmp-recognition-end",
    "recognitionEndEvent",
  );
  return {
    root,
    rootScale,
    rootOffset,
    recognitionStartEvent,
    recognitionEndEvent,
  };
}

/**
 * The midpoint of the PoseFrame3D hips, in the scene's axes.
 *
 * PoseFrame3D world coordinates are read in the axes Kalidokit reads them in, those of MediaPipe's
 * world landmarks: x to the viewer's right, y down, z away from the viewer. A-Frame's y is up and
 * its camera looks down -z, so the scene position is (x, -y, -z).
 */
function worldRoot(
  keypoints: ReadonlyMap<string, PoseFrame3DKeypoint>,
): { x: number; y: number; z: number } | undefined {
  const left = keypoints.get("left_hip");
  const right = keypoints.get("right_hip");
  if (!left || !right) return undefined;
  return {
    x: (left.x + right.x) / 2,
    y: -(left.y + right.y) / 2,
    z: -(left.z + right.z) / 2,
  };
}

function parseJsonObject(
  source: string,
  label: string,
): Record<string, unknown> {
  if (source.length > 1_048_576) throw new Error(`${label} exceeds 1 MiB.`);
  try {
    return record(JSON.parse(source) as unknown, label);
  } catch (error) {
    if (error instanceof SyntaxError)
      throw new Error(`${label} is invalid JSON.`);
    throw error;
  }
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function rejectUnknownKeys(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  label: string,
): void {
  const unknown = Object.keys(value).find((key) => !allowed.has(key));
  if (unknown) throw new Error(`${label} contains unknown field: ${unknown}`);
}

function vector3(value: unknown, label: string): [number, number, number] {
  if (!Array.isArray(value) || value.length !== 3) {
    throw new Error(`${label} must contain exactly three numbers.`);
  }
  return [
    finite(value[0], `${label}[0]`),
    finite(value[1], `${label}[1]`),
    finite(value[2], `${label}[2]`),
  ];
}

function finite(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number.`);
  }
  return value;
}

function threshold(value: number): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error("Avatar confidence threshold must be between 0 and 1.");
  }
  return value;
}

function identifier(value: string, label: string): string {
  const normalized = value.trim();
  if (!identifiers.test(normalized)) throw new Error(`Invalid ${label}.`);
  return normalized;
}

function nonEmpty(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} must not be empty.`);
  }
  return value.trim();
}

function eventName(value: unknown, label: string): string {
  const normalized = nonEmpty(value, label);
  if (!eventNames.test(normalized)) throw new Error(`Invalid ${label}.`);
  return normalized;
}

/**
 * Converts a Kalidokit rotation in radians to Euler degrees on a VRM normalized bone.
 *
 * Kalidokit's rotations are for VRM 0.x bone axes, which face -Z; normalized bones use the
 * VRM 1.0 axes, a half turn about Y away, which negates x and z. Driving the opposite side
 * (see VRM_BONES) also mirrors the rotation across the body's midline, which negates y and z.
 * Together the signs become (-x, -y, z).
 */
function vrmBoneDegrees(rotation: {
  x: number;
  y: number;
  z: number;
}): [number, number, number] {
  return [
    -radiansToDegrees(rotation.x),
    -radiansToDegrees(rotation.y),
    radiansToDegrees(rotation.z),
  ];
}

function radiansToDegrees(value: number): number {
  return (value * 180) / Math.PI;
}

function rotationForRig(
  rig: KalidokitPoseRig,
  key: KalidokitRigKey,
): { x: number; y: number; z: number } {
  if (key === "Hips") return rig.Hips.rotation ?? { x: 0, y: 0, z: 0 };
  return rig[key];
}

function requiredJoints(key: KalidokitRigKey): readonly Coco17KeypointId[] {
  return RIG_REQUIRED_JOINTS[key];
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
