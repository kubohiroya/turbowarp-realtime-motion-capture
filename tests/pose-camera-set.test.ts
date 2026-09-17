import { describe, expect, it, vi } from "vitest";
import { PoseCameraSet } from "../src/pose/camera-set.js";
import { PosePipelineController } from "../src/pose/controller.js";
import { COCO_17_KEYPOINT_IDS } from "../src/pose/types.js";
import type {
  CameraFrameTimePort,
  CameraLeasePort,
  ModelPose,
  PoseDetectorPort,
  PoseModelPort,
} from "../src/pose/types.js";

function pose(id: number): ModelPose {
  return {
    id,
    score: 0.9,
    keypoints: COCO_17_KEYPOINT_IDS.map((name, index) => ({
      name,
      x: 10 + index,
      y: 20 + index,
      score: 0.8,
    })),
  };
}

/** The capture time Camera Source reports for each camera's current frame. */
class FrameTimes {
  public frame: CameraFrameTimePort | undefined;
}

function setup() {
  const clocks = new Map<string, FrameTimes>();
  const leases = new Map<string, { release: ReturnType<typeof vi.fn> }>();
  const detectors: Array<{
    estimatePoses: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
  }> = [];
  const acquireCamera = vi.fn(async ({ cameraId }: { cameraId: string }) => {
    const element = {} as HTMLVideoElement;
    const release = vi.fn(async () => undefined);
    const times = new FrameTimes();
    clocks.set(cameraId, times);
    leases.set(cameraId, { release });
    const lease: CameraLeasePort = {
      getFrameSource: () => ({
        kind: "video",
        element,
        width: 1280,
        height: 720,
        mirrored: false,
        deviceId: `device-${cameraId}`,
        ...(times.frame ? { frameTime: times.frame } : {}),
      }),
      release,
    };
    return lease;
  });
  const model: PoseModelPort = {
    initializeWebGpu: vi.fn(async () => undefined),
    backend: () => "webgpu",
    createMultiPoseDetector: vi.fn(async () => {
      const detector = {
        estimatePoses: vi.fn(async () => [pose(1), pose(2)]),
        dispose: vi.fn(),
      };
      detectors.push(detector);
      return detector as PoseDetectorPort;
    }),
  };
  let now = 1000;
  const set = new PoseCameraSet({
    runtime: { ext_kubohiroyacamerasource: { acquireCamera } },
    model,
    measureMs: () => (now += 7.5),
  });
  return { set, clocks, leases, detectors, acquireCamera, model };
}

const start = (cameraId: string) => ({
  cameraId,
  peerId: "local",
  calibrationId: `profile-${cameraId}`,
});

describe("PoseCameraSet", () => {
  it("runs a pipeline per camera with its own detector, lease and frame times", async () => {
    const { set, clocks, detectors, acquireCamera, model } = setup();
    await set.start(start("cam-1"));
    await set.start(start("cam-2"));

    expect(
      acquireCamera.mock.calls.map(([options]) => options.cameraId),
    ).toEqual(["cam-1", "cam-2"]);
    expect(model.createMultiPoseDetector).toHaveBeenCalledTimes(2);
    expect(set.cameraIds()).toEqual(["cam-1", "cam-2"]);

    clocks.get("cam-1")!.frame = {
      timestampUs: 5_000_000,
      source: "capture",
      presentedFrames: 1,
    };
    clocks.get("cam-2")!.frame = {
      timestampUs: 5_010_000,
      source: "presentation",
      presentedFrames: 1,
    };
    await set.infer("cam-1");
    await set.infer("cam-2");

    const first = JSON.parse(set.latestFrameJson("cam-1"));
    const second = JSON.parse(set.latestFrameJson("cam-2"));
    expect(first).toMatchObject({
      cameraId: "cam-1",
      calibrationId: "profile-cam-1",
      captureTimestampUs: 5_000_000,
      sequence: 0,
    });
    expect(second).toMatchObject({
      cameraId: "cam-2",
      captureTimestampUs: 5_010_000,
    });
    expect(detectors[0]!.estimatePoses).toHaveBeenCalledTimes(1);
    expect(detectors[1]!.estimatePoses).toHaveBeenCalledTimes(1);
    expect(set.status("cam-1")).toMatchObject({
      cameraId: "cam-1",
      state: "ready",
      inferences: 1,
      skippedFrames: 0,
      lastInferenceMs: 7.5,
      frameTimeSource: "capture",
      captureTimestampUs: 5_000_000,
      persons: 2,
      lastOutcome: "inferred",
    });
    expect(set.status("cam-2")?.frameTimeSource).toBe("presentation");
  });

  it("gives the turn away when the camera has shown nothing new", async () => {
    const { set, clocks, detectors } = setup();
    await set.start(start("cam-1"));

    await set.infer("cam-1");
    expect(set.status("cam-1")?.lastOutcome).toBe("no-frame-time");

    clocks.get("cam-1")!.frame = {
      timestampUs: 1,
      source: "capture",
      presentedFrames: 3,
    };
    await set.infer("cam-1");
    await set.infer("cam-1");
    expect(detectors[0]!.estimatePoses).toHaveBeenCalledTimes(1);
    expect(set.status("cam-1")).toMatchObject({
      lastOutcome: "no-new-frame",
      skippedFrames: 1,
      inferences: 1,
    });

    clocks.get("cam-1")!.frame = {
      timestampUs: 2,
      source: "capture",
      presentedFrames: 4,
    };
    await set.infer("cam-1");
    expect(JSON.parse(set.latestFrameJson("cam-1")).sequence).toBe(1);
  });

  it("stops one camera without touching the others, and all of them on request", async () => {
    const { set, clocks, leases, detectors } = setup();
    await set.start(start("cam-1"));
    await set.start(start("cam-2"));
    clocks.get("cam-1")!.frame = {
      timestampUs: 1,
      source: "capture",
      presentedFrames: 1,
    };
    await set.infer("cam-1");

    await set.stop("cam-1");
    expect(leases.get("cam-1")!.release).toHaveBeenCalledTimes(1);
    expect(detectors[0]!.dispose).toHaveBeenCalledTimes(1);
    expect(set.status("cam-1")).toBeUndefined();
    expect(set.latestFrameJson("cam-1")).toBe("");
    expect(leases.get("cam-2")!.release).not.toHaveBeenCalled();
    await expect(set.infer("cam-1")).rejects.toThrow("not started");

    await set.stopAll();
    expect(leases.get("cam-2")!.release).toHaveBeenCalledTimes(1);
    expect(set.cameraIds()).toEqual([]);
  });

  it("still takes an external timestamp on the single-camera pipeline", async () => {
    const acquireCamera = vi.fn(async () => ({
      getFrameSource: () => ({
        kind: "video" as const,
        element: {} as HTMLVideoElement,
        width: 640,
        height: 480,
        mirrored: false,
        deviceId: "d",
      }),
      release: vi.fn(async () => undefined),
    }));
    const controller = new PosePipelineController({
      runtime: { ext_kubohiroyacamerasource: { acquireCamera } },
      model: {
        initializeWebGpu: async () => undefined,
        backend: () => "webgpu",
        createMultiPoseDetector: async () => ({
          estimatePoses: async () => [pose(1)],
          dispose: () => undefined,
        }),
      },
    });
    await controller.start(start("pose"));
    await controller.inferLatestFrame(42);
    expect(JSON.parse(controller.latestFrameJson()).captureTimestampUs).toBe(
      42,
    );
    expect(controller.stats().frameTimeSource).toBe("");
  });
});
