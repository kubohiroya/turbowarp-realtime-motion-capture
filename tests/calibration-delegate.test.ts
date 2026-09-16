import { describe, expect, it } from "vitest";
import { CalibrationProfileDelegate } from "../src/calibration/delegate.js";
import type { CameraProfileCapability } from "../src/calibration/delegate.js";
import { cameraSourceCapabilityKey } from "@kubohiroya/turbowarp-camera-source/runtime";

const legacyProfile = {
  schema: "twrmc/camera-calibration",
  version: 1,
  calibrationId: "run-1",
  cameraId: "stage-left",
  imageWidth: 1280,
  imageHeight: 720,
  intrinsicMatrix: [900, 0, 640, 0, 900, 360, 0, 0, 1],
  distortionCoefficients: [-0.2, 0.05, 0.001, -0.001],
  worldFromCameraMatrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
  worldUnit: "meter",
  calibratedAt: "2026-09-15T04:05:06Z",
};

function capability(
  overrides: Partial<CameraProfileCapability> = {},
): CameraProfileCapability {
  const stored = new Map<string, unknown>();
  const base: CameraProfileCapability = {
    version: 1,
    requireVersion: (version: number) => {
      if (version !== 1) throw new Error(`Unsupported version ${version}.`);
      return base;
    },
    registerProfile: (document: unknown) => {
      const cameraId = (document as { cameraId?: string }).cameraId;
      if (!cameraId) {
        return {
          ok: false,
          error: {
            code: "missing-field",
            path: "cameraId",
            message: "is required",
          },
        };
      }
      stored.set(cameraId, { cameraId, producer: "adopted" });
      return { ok: true, profile: { cameraId } };
    },
    profileFor: (cameraId: string) => stored.get(cameraId),
    calibratedCameras: () => [...stored.keys()].sort(),
    ...overrides,
  };
  return base;
}

function delegate(overrides: Partial<CameraProfileCapability> = {}) {
  return new CalibrationProfileDelegate({
    runtime: {} as TurboWarpRuntime,
    capability: capability(overrides),
  });
}

describe("finding Camera Source", () => {
  it("says which extension is missing rather than failing later", () => {
    const bare = new CalibrationProfileDelegate({
      runtime: {} as TurboWarpRuntime,
    });
    expect(() => bare.capability()).toThrowError(/Camera Source is not loaded/);
  });

  it("names the members an older build does not publish", () => {
    const runtime = {
      [cameraSourceCapabilityKey]: { requireVersion: () => undefined },
    } as unknown as TurboWarpRuntime;
    expect(() =>
      new CalibrationProfileDelegate({ runtime }).capability(),
    ).toThrowError(/registerProfile/);
  });

  it("refuses a capability version it was not written against", () => {
    const subject = delegate({
      requireVersion: (version: number) => {
        throw new Error(`Unsupported version ${version}.`);
      },
    });
    expect(() => subject.capability()).toThrowError(/Unsupported version/);
  });

  it("stays quiet in reporters when the extension is absent", () => {
    // A reporter that throws stops the script that read it.
    const bare = new CalibrationProfileDelegate({
      runtime: {} as TurboWarpRuntime,
    });
    expect(bare.ready()).toBe(false);
    expect(bare.profileJson()).toBe("");
  });
});

describe("handing a profile to the shared registry", () => {
  it("accepts a file saved in the old format", () => {
    // An operator holding a file should not have to know which of two schemas
    // it uses; Camera Source dispatches on what the document says it is.
    const subject = delegate();
    subject.importProfile(JSON.stringify(legacyProfile));
    expect(subject.errorCode()).toBe("");
    expect(subject.ready()).toBe(true);
  });

  it("reports text that is not JSON as such", () => {
    const subject = delegate();
    subject.importProfile("not json");
    expect(subject.errorCode()).toBe("invalid-json");
  });

  it("names the member the registry refused", () => {
    const subject = delegate();
    subject.importProfile(JSON.stringify({ schema: "twcs/camera-intrinsics" }));
    expect(subject.errorCode()).toBe("missing-field");
    expect(subject.errorDetail()).toContain("cameraId");
  });

  it("stores nothing when the document is refused", () => {
    const subject = delegate();
    subject.importProfile(JSON.stringify({ schema: "twcs/camera-intrinsics" }));
    expect(subject.ready()).toBe(false);
    expect(subject.profileJson()).toBe("");
  });

  it("answers whether a document would be accepted", () => {
    const subject = delegate();
    expect(subject.validateProfile(JSON.stringify(legacyProfile))).toBe(true);
    expect(subject.validateProfile("{}")).toBe(false);
    expect(subject.validateProfile("not json")).toBe(false);
  });

  it("hands back what the registry kept, not what was handed in", () => {
    // The registry normalises: an old document comes back as the current shape,
    // recording where it came from.
    const subject = delegate();
    subject.importProfile(JSON.stringify(legacyProfile));
    const returned = JSON.parse(subject.profileJson());
    expect(returned.cameraId).toBe("stage-left");
    expect(returned.producer).toBe("adopted");
    expect("worldFromCameraMatrix" in returned).toBe(false);
  });

  it("clears an earlier failure once a good document arrives", () => {
    const subject = delegate();
    subject.importProfile("not json");
    subject.importProfile(JSON.stringify(legacyProfile));
    expect(subject.errorCode()).toBe("");
  });
});
