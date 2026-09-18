import { Pose, type TFVectorPose } from "kalidokit";
import type {
  AvatarPoseSolverPort,
  KalidokitPoseRig,
  PoseFrame2DPerson,
  PoseFrame3DPerson,
} from "./types.js";

export interface KalidokitPoseApi {
  solve(
    world: TFVectorPose,
    screen: Omit<TFVectorPose, "z">,
    options: {
      runtime: "tfjs";
      imageSize: { width: number; height: number };
      enableLegs: true;
    },
  ): KalidokitPoseRig | undefined;
}

export class KalidokitPoseAdapter implements AvatarPoseSolverPort {
  private readonly solver: KalidokitPoseApi;

  public constructor(solver: KalidokitPoseApi = Pose as KalidokitPoseApi) {
    this.solver = solver;
  }

  public solve(
    worldPerson: PoseFrame3DPerson,
    screenPerson: PoseFrame2DPerson,
    imageSize: { width: number; height: number },
  ): KalidokitPoseRig {
    if (
      !Number.isInteger(imageSize.width) ||
      !Number.isInteger(imageSize.height) ||
      imageSize.width <= 0 ||
      imageSize.height <= 0
    ) {
      throw new Error("Kalidokit image size must contain positive integers.");
    }
    rejectDegenerateWorldPose(worldPerson);
    const world = blazePose33(hipCentred(worldPerson.keypoints), "world");
    const screen = blazePose33(screenPerson.keypoints, "screen");
    const result = this.solver.solve(world, screen, {
      runtime: "tfjs",
      imageSize,
      enableLegs: true,
    });
    if (!result) throw new Error("Kalidokit Pose.solve returned no rig.");
    validateRig(result);
    return result as KalidokitPoseRig;
  }
}

function rejectDegenerateWorldPose(person: PoseFrame3DPerson): void {
  const points = new Map<string, PoseFrame3DPerson["keypoints"][number]>(
    person.keypoints.map((point) => [point.id, point]),
  );
  const distance = (left: string, right: string) => {
    const a = points.get(left);
    const b = points.get(right);
    if (!a || !b) return 0;
    return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
  };
  if (
    distance("left_shoulder", "right_shoulder") <= Number.EPSILON &&
    distance("left_hip", "right_hip") <= Number.EPSILON
  ) {
    throw new Error("Kalidokit cannot solve a degenerate world pose.");
  }
}

/**
 * Kalidokit reads world landmarks as MediaPipe gives them, centred between the hips: a wrist or
 * hip more than 0.1 below that centre counts as off screen and its limb falls back to rest. A
 * PoseFrame3D from several cameras is in the room's frame, where every joint lies far from the
 * origin, so it is moved to the hips first. Rotations do not depend on where the origin is.
 */
function hipCentred(
  keypoints: PoseFrame3DPerson["keypoints"],
): PoseFrame3DPerson["keypoints"] {
  const left = keypoints.find((point) => point.id === "left_hip");
  const right = keypoints.find((point) => point.id === "right_hip");
  if (!left || !right) return keypoints;
  const x = (left.x + right.x) / 2;
  const y = (left.y + right.y) / 2;
  const z = (left.z + right.z) / 2;
  return keypoints.map((point) => ({
    ...point,
    x: point.x - x,
    y: point.y - y,
    z: point.z - z,
  }));
}

type SourcePoint = {
  id: string;
  x: number;
  y: number;
  z?: number;
  score: number;
};

function blazePose33(
  source: readonly SourcePoint[],
  kind: "world" | "screen",
): TFVectorPose {
  const points = new Map(source.map((point) => [point.id, point]));
  const get = (id: string) => {
    const point = points.get(id);
    if (!point) throw new Error(`Missing ${kind} COCO-17 landmark: ${id}`);
    return landmark(point, kind);
  };
  const leftEye = get("left_eye");
  const rightEye = get("right_eye");
  const nose = get("nose");
  const faceMidpoint = midpoint(leftEye, rightEye, nose);
  const leftWrist = get("left_wrist");
  const rightWrist = get("right_wrist");
  const leftAnkle = get("left_ankle");
  const rightAnkle = get("right_ankle");
  const synthetic = (point: ReturnType<typeof landmark>) => ({
    ...point,
    score: point.score * 0.25,
    visibility: point.visibility * 0.25,
  });
  return [
    nose,
    leftEye,
    leftEye,
    leftEye,
    rightEye,
    rightEye,
    rightEye,
    get("left_ear"),
    get("right_ear"),
    faceMidpoint,
    faceMidpoint,
    get("left_shoulder"),
    get("right_shoulder"),
    get("left_elbow"),
    get("right_elbow"),
    leftWrist,
    rightWrist,
    synthetic(leftWrist),
    synthetic(rightWrist),
    synthetic(leftWrist),
    synthetic(rightWrist),
    synthetic(leftWrist),
    synthetic(rightWrist),
    get("left_hip"),
    get("right_hip"),
    get("left_knee"),
    get("right_knee"),
    leftAnkle,
    rightAnkle,
    synthetic(leftAnkle),
    synthetic(rightAnkle),
    synthetic(leftAnkle),
    synthetic(rightAnkle),
  ];
}

function landmark(point: SourcePoint, kind: "world" | "screen") {
  const z = kind === "world" ? point.z : 0;
  if (kind === "world" && typeof z !== "number") {
    throw new Error(`Missing world z coordinate for ${point.id}.`);
  }
  return {
    x: point.x,
    y: point.y,
    z: z ?? 0,
    score: point.score,
    visibility: point.score,
  };
}

function midpoint(
  left: ReturnType<typeof landmark>,
  right: ReturnType<typeof landmark>,
  fallback: ReturnType<typeof landmark>,
) {
  if (left.score <= 0 || right.score <= 0) return { ...fallback };
  return {
    x: (left.x + right.x) / 2,
    y: (left.y + right.y) / 2,
    z: (left.z + right.z) / 2,
    score: Math.min(left.score, right.score),
    visibility: Math.min(left.visibility, right.visibility),
  };
}

function validateRig(value: KalidokitPoseRig): void {
  const rotations = [
    value.RightUpperArm,
    value.RightLowerArm,
    value.LeftUpperArm,
    value.LeftLowerArm,
    value.RightHand,
    value.LeftHand,
    value.RightUpperLeg,
    value.RightLowerLeg,
    value.LeftUpperLeg,
    value.LeftLowerLeg,
    value.Spine,
    value.Hips.rotation ?? { x: 0, y: 0, z: 0 },
    value.Hips.worldPosition ?? value.Hips.position,
  ];
  if (
    rotations.some(({ x, y, z }) =>
      [x, y, z].some((coordinate) => !Number.isFinite(coordinate)),
    )
  ) {
    throw new Error("Kalidokit Pose.solve returned a non-finite rig value.");
  }
}
