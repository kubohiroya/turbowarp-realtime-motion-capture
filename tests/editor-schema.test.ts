import { readFileSync } from "node:fs";
import { expect, it, vi } from "vitest";
import { compileSchemaBundle } from "@kubohiroya/turbowarp-extension-data-editor/schema";
import {
  motionSchemaBundles,
  validateMotionSource,
  parseFrame,
  parsePoseFrame2D,
  parseCalibrationProfile,
} from "../src/editor-schema.js";
import type { MotionInputConsumer } from "../src/editor-schema.js";
import { decodeProtocolJson } from "../src/protocol/codec.js";
import { protocolSchemaFiles } from "../src/protocol/schemas.js";
import { createCameraModel } from "../src/fusion/geometry.js";
import { readCameraProfileDocument } from "@kubohiroya/turbowarp-camera-source/profile";
import { poseFrame2D, poseFrame2DV2 } from "./fusion-fixtures.js";
import { utf8ByteLength } from "../src/protocol/utf8.js";
const context = {
  consumerId: "headless-fixture",
  nowMs: Date.parse("2026-09-13T13:00:00Z"),
  settings: { delegate: false },
};
const calibration = JSON.parse(
  readFileSync(
    "tests/fixtures/calibration/valid-camera-calibration-v1.json",
    "utf8",
  ),
);
const dsl = JSON.parse(
  readFileSync("tests/fixtures/protocol/valid/performance-dsl.json", "utf8"),
);
const policy = JSON.parse(
  readFileSync(
    "tests/fixtures/protocol/invalid/session-policy-with-credential.json",
    "utf8",
  ),
);
delete policy.offer;
const pose2d = poseFrame2D("camera", 123, []),
  pose2dv2 = poseFrame2DV2("camera", 123, []);
const pose3d = {
  schema: "twrmc/pose-frame-3d",
  version: 1,
  sequence: 1,
  timestampUs: 123,
  persons: [],
};
const values = [calibration, dsl, policy, pose2d, pose2dv2, pose3d];
const accepted = (
  source: string,
  consumer: MotionInputConsumer,
  ctx = context,
) => validateMotionSource(source, consumer, ctx).result.kind === "valid";
function accepts(fn: () => unknown) {
  try {
    fn();
    return true;
  } catch {
    return false;
  }
}
it("all fixed bundles compile offline and all six generated files match TypeBox in full", () => {
  for (const bundle of Object.values(motionSchemaBundles))
    expect(compileSchemaBundle(bundle).kind).toBe("compiled");
  expect(Object.keys(protocolSchemaFiles)).toHaveLength(6);
  for (const [file, schema] of Object.entries(protocolSchemaFiles))
    expect(readFileSync("schemas/" + file, "utf8")).toBe(
      JSON.stringify(schema, null, 2) + "\n",
    );
});
it("protocol union follows pinned codec dispatch, credentials and injected policy time", () => {
  for (const data of [
    ...values,
    { ...pose2d, version: 9 },
    { schema: "unknown", version: 1 },
    { ...policy, offer: "private" },
    { ...policy, expiresAt: policy.issuedAt },
  ]) {
    const source = JSON.stringify(data);
    expect(accepted(source, "protocol")).toBe(
      decodeProtocolJson(source, context.nowMs).ok,
    );
  }
  expect(accepted(JSON.stringify(policy), "protocol")).toBe(true);
  expect(
    accepted(JSON.stringify(policy), "protocol", {
      ...context,
      nowMs: Date.parse("2027-01-01T00:00:00Z"),
    }),
  ).toBe(false);
  const clock = vi.spyOn(Date, "now").mockImplementation(() => {
    throw Error("Clock must be injected");
  });
  try {
    expect(accepted(JSON.stringify(policy), "protocol")).toBe(true);
  } finally {
    clock.mockRestore();
  }
});
it("fusion calibration adds geometry without narrowing protocol or import OFF", () => {
  const zero = structuredClone(calibration);
  zero.intrinsicMatrix[0] = 0;
  const lower = structuredClone(calibration);
  lower.intrinsicMatrix[3] = 0.1;
  const six = structuredClone(calibration);
  six.distortionCoefficients = Array(6).fill(0);
  const affine = structuredClone(calibration);
  affine.worldFromCameraMatrix[12] = 1;
  const rotation = structuredClone(calibration);
  rotation.worldFromCameraMatrix[0] = 2;
  for (const data of [calibration, zero, lower, six, affine, rotation]) {
    const source = JSON.stringify(data);
    const codec = decodeProtocolJson(source, context.nowMs);
    expect(accepted(source, "protocol")).toBe(codec.ok);
    expect(accepted(source, "fusion-calibration")).toBe(
      codec.ok && accepts(() => createCameraModel(data)),
    );
    expect(accepted(source, "motion-import")).toBe(
      accepts(() => parseCalibrationProfile(source)),
    );
  }
  expect(accepted(JSON.stringify(zero), "protocol")).toBe(true);
  expect(accepted(JSON.stringify(zero), "fusion-calibration")).toBe(false);
});
it("avatar retains its own v1 parser while fusion pose union accepts v1/v2", () => {
  for (const data of [
    pose2d,
    pose2dv2,
    pose3d,
    {},
    { ...pose3d, version: 2 },
  ]) {
    const source = JSON.stringify(data);
    expect(accepted(source, "avatar-pose2d")).toBe(
      accepts(() => parsePoseFrame2D(source)),
    );
    expect(accepted(source, "avatar-pose3d")).toBe(
      accepts(() => parseFrame(source)),
    );
    const decoded = decodeProtocolJson(source, context.nowMs);
    expect(accepted(source, "fusion-pose2d")).toBe(
      decoded.ok && decoded.schema === "twrmc/pose-frame-2d",
    );
  }
});
it("DSL checks its own dispatch/color without loading a mutable palette", () => {
  expect(accepted(JSON.stringify(dsl), "performance-dsl")).toBe(true);
  expect(accepted(JSON.stringify(pose2d), "performance-dsl")).toBe(false);
  const bad = structuredClone(dsl);
  bad.performers[0].glowStickColor = "red";
  expect(accepted(JSON.stringify(bad), "performance-dsl")).toBe(false);
});
it("delegate ON/OFF remain separate JSON consumers and never register a profile", () => {
  const twcs = {
    schema: "twcs/camera-intrinsics",
    version: 1,
    profileId: "run",
    cameraId: "camera",
    calibratedAt: "2026-09-15T04:05:06Z",
    producer: "fixture",
    cameraModel: "pinhole",
    image: { width: 800, height: 600, undistorted: false },
    intrinsics: { fx: 700, fy: 700, cx: 400, cy: 300, skew: 0 },
    distortion: { model: "none", coefficients: [] },
  };
  for (const data of [
    calibration,
    twcs,
    { ...twcs, version: 2 },
    { schema: "camerasource/camera-intrinsics", version: 1 },
  ]) {
    const source = JSON.stringify(data);
    expect(
      accepted(source, "motion-import", {
        ...context,
        settings: { delegate: true },
      }),
    ).toBe(readCameraProfileDocument(data).ok);
    expect(accepted(source, "motion-import")).toBe(
      accepts(() => parseCalibrationProfile(source)),
    );
  }
  expect(
    accepted("image_width: 800\n", "motion-import", {
      ...context,
      settings: { delegate: true },
    }),
  ).toBe(false);
});
it("source limits apply to original whitespace and differ from unlimited legacy import", () => {
  const payload = JSON.stringify(calibration),
    source = " ".repeat(1_048_576 - payload.length) + payload;
  expect(accepted(source, "protocol")).toBe(true);
  expect(accepted(" " + source, "protocol")).toBe(false);
  expect(accepted(" " + source, "motion-import")).toBe(true);
  const pose = JSON.stringify(pose2d),
    avatar = " ".repeat(1_048_576 - pose.length) + pose;
  expect(accepted(avatar, "avatar-pose2d")).toBe(true);
  expect(accepted(" " + avatar, "avatar-pose2d")).toBe(false);
  for (const text of ["a", "日本語", "😃", "\ud800", "\udc00", "a\ud800b"])
    expect(utf8ByteLength(text)).toBe(
      new TextEncoder().encode(text).byteLength,
    );
});
it("bad context and malformed source fail safely; input, source and settings remain unchanged", () => {
  const source = " \n" + JSON.stringify(pose2d) + "\n";
  const before = JSON.stringify(context);
  const result = validateMotionSource(source, "fusion-pose2d", context);
  expect(result.result.kind).toBe("valid");
  expect(result.source).toBe(source);
  expect(result).toHaveProperty("data", pose2d);
  expect(JSON.stringify(context)).toBe(before);
  expect(
    validateMotionSource(source, "protocol", { ...context, nowMs: NaN }).result
      .kind,
  ).toBe("execution-error");
  const bad = validateMotionSource("{private malformed", "protocol", context);
  expect(bad.result.kind).toBe("invalid");
  expect(JSON.stringify(bad.result)).not.toContain("private");
});

it("decode/context diagnostics keep the selected contract without invoking setting accessors", () => {
  const result = validateMotionSource("{bad", "avatar-pose2d", context);
  expect(result.result.diagnostics[0]?.scope.identity.contractId).toBe(
    "pose2d",
  );
  let reads = 0;
  const invalidContext = {
    ...context,
    settings: Object.defineProperty({}, "delegate", {
      get() {
        reads++;
        throw Error("private");
      },
    }),
  };
  const failed = validateMotionSource(
    "{}",
    "motion-import",
    invalidContext as never,
  );
  expect(failed.result.kind).toBe("execution-error");
  expect(reads).toBe(0);
  expect(failed.result.diagnostics[0]?.scope.identity.contractId).toBe(
    "motion-calibration-import",
  );
});
