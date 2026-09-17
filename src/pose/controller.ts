import { createPoseFrame2D } from "./pose-frame.js";
import type {
  CameraFrameSourcePort,
  CameraFrameTimePort,
  FrameTimeSource,
  CameraLeasePort,
  CameraSourcePort,
  Coco17KeypointId,
  ModelPose,
  PoseDetectorPort,
  PoseFrame2D,
  PoseModelPort,
  PoseMarkerV2,
} from "./types.js";
import { markerPatchesFor, toMarkers } from "../markers/sampler.js";
import {
  DEFAULT_MARKER_SAMPLING_OPTIONS,
  type MarkerImageSamplerPort,
  type MarkerPatch,
  type MarkerSamplingOptions,
  type SampledColor,
} from "../markers/types.js";

export type PosePipelineState =
  | "idle"
  | "initializing-webgpu"
  | "loading-model"
  | "acquiring-camera"
  | "ready"
  | "inferencing"
  | "stopping"
  | "error";

export type PosePipelineErrorCode =
  | ""
  | "webgpu-unavailable"
  | "model-load-failed"
  | "camera-unavailable"
  | "camera-ended"
  | "inference-failed"
  | "marker-sampling-failed"
  | "invalid-output";

export interface PoseStartOptions {
  cameraId: string;
  peerId: string;
  calibrationId: string;
}

export interface PosePipelineControllerOptions {
  runtime: TurboWarpRuntime;
  model: PoseModelPort;
  markerSampler?: MarkerImageSamplerPort;
  /**
   * Monotonic milliseconds, used only to measure how long an inference took.
   * The value never enters a frame: timestamps come from outside.
   */
  measureMs?: () => number;
}

/**
 * - `inferred`: a frame was produced.
 * - `no-new-frame`: the camera has presented nothing since the frame inferred
 *   last, so there was nothing new to infer.
 * - `no-frame-time`: Camera Source reports no capture time for the frame, so
 *   there is no timestamp to carry.
 */
export type FrameTimedInferenceOutcome =
  "inferred" | "no-new-frame" | "no-frame-time";

/** What a camera's pipeline has done, for measuring it. */
export interface PosePipelineStats {
  readonly state: PosePipelineState;
  readonly errorCode: PosePipelineErrorCode;
  readonly inferences: number;
  readonly skippedFrames: number;
  /** Duration of the last inference, in milliseconds. */
  readonly lastInferenceMs: number;
  readonly frameTimeSource: FrameTimeSource | "";
  /** Capture timestamp of the latest frame produced, or 0. */
  readonly captureTimestampUs: number;
  readonly persons: number;
}

export class PosePipelineController {
  private readonly runtime: TurboWarpRuntime;
  private readonly model: PoseModelPort;
  private detector: PoseDetectorPort | undefined;
  private lease: CameraLeasePort | undefined;
  private startOptions: PoseStartOptions | undefined;
  private starting: Promise<void> | undefined;
  private inference: Promise<void> | undefined;
  private operation = 0;
  private sequence = 0;
  private latestFrame: PoseFrame2D | undefined;
  private readonly markerSampler: MarkerImageSamplerPort | undefined;
  private readonly measureMs: (() => number) | undefined;
  private inferredPresentedFrames: number | undefined;
  private inferences = 0;
  private skippedFrames = 0;
  private lastInferenceMs = 0;
  private lastFrameTimeSource: FrameTimeSource | "" = "";
  private markerOptions: MarkerSamplingOptions | undefined;
  private pipelineState: PosePipelineState = "idle";
  private pipelineErrorCode: PosePipelineErrorCode = "";
  private pipelineErrorMessage = "";

  public constructor(options: PosePipelineControllerOptions) {
    this.runtime = options.runtime;
    this.model = options.model;
    this.markerSampler = options.markerSampler;
    this.measureMs = options.measureMs;
  }

  /**
   * Turns PoseFrame2D v2 output on: every inference also samples the named
   * keypoints for a uniquely colored glow stick.
   */
  public enableMarkers(keypointIds: Coco17KeypointId[]): void {
    if (!this.markerSampler) {
      throw new Error("No glow stick image sampler is available.");
    }
    this.markerOptions = { ...DEFAULT_MARKER_SAMPLING_OPTIONS, keypointIds };
  }

  public disableMarkers(): void {
    this.markerOptions = undefined;
  }

  public markersEnabled(): boolean {
    return this.markerOptions !== undefined;
  }

  /** Glow stick markers carried by the latest frame. */
  public markerCount(): number {
    const frame = this.latestFrame;
    if (!frame || frame.version !== 2) return 0;
    return frame.persons.reduce(
      (total, person) => total + person.markers.length,
      0,
    );
  }

  public async start(options: PoseStartOptions): Promise<void> {
    const normalized = normalizeStartOptions(options);
    await this.stop();
    const operation = ++this.operation;
    const starting = this.initialize(normalized, operation);
    this.starting = starting;
    try {
      await starting;
    } finally {
      if (this.starting === starting) this.starting = undefined;
    }
  }

  public inferLatestFrame(captureTimestampUs: number): Promise<void> {
    if (!Number.isSafeInteger(captureTimestampUs) || captureTimestampUs < 0) {
      throw new Error(
        "Capture timestamp must be an externally synchronized non-negative integer in microseconds.",
      );
    }
    if (this.inference) return this.inference;
    if (!this.detector || !this.lease || !this.startOptions) {
      throw new Error("WebGPU MoveNet MultiPose is not ready.");
    }
    const operation = this.operation;
    const inference = this.runInference(operation, captureTimestampUs);
    this.inference = inference;
    const clear = () => {
      if (this.inference === inference) this.inference = undefined;
    };
    void inference.then(clear, clear);
    return inference;
  }

  /**
   * Infers the frame the camera is showing and carries the capture time Camera
   * Source reports for it, instead of a timestamp supplied by the project.
   *
   * For cameras on one page, whose frame times share the page clock. A frame
   * already inferred is not inferred again: with several cameras taking turns
   * on one GPU, a camera that has not delivered a new frame gives its turn away.
   */
  public async inferAtFrameTime(): Promise<FrameTimedInferenceOutcome> {
    if (this.inference) {
      await this.inference;
      return "inferred";
    }
    if (!this.detector || !this.lease || !this.startOptions) {
      throw new Error("WebGPU MoveNet MultiPose is not ready.");
    }
    let time: CameraFrameTimePort | undefined;
    try {
      time = this.lease.getFrameSource().frameTime;
    } catch (error) {
      this.fail("camera-ended", error);
    }
    if (time === undefined) return "no-frame-time";
    if (time.presentedFrames === this.inferredPresentedFrames) {
      this.skippedFrames += 1;
      return "no-new-frame";
    }
    this.inferredPresentedFrames = time.presentedFrames;
    await this.inferTimed(time);
    return "inferred";
  }

  public stats(): PosePipelineStats {
    return {
      state: this.pipelineState,
      errorCode: this.pipelineErrorCode,
      inferences: this.inferences,
      skippedFrames: this.skippedFrames,
      lastInferenceMs: this.lastInferenceMs,
      frameTimeSource: this.lastFrameTimeSource,
      captureTimestampUs: this.latestFrame?.captureTimestampUs ?? 0,
      persons: this.latestFrame?.persons.length ?? 0,
    };
  }

  private inferTimed(time: CameraFrameTimePort): Promise<void> {
    const operation = this.operation;
    const inference = this.runInference(operation, time.timestampUs).then(
      () => {
        if (operation === this.operation)
          this.lastFrameTimeSource = time.source;
      },
    );
    this.inference = inference;
    const clear = () => {
      if (this.inference === inference) this.inference = undefined;
    };
    void inference.then(clear, clear);
    return inference;
  }

  public async stop(): Promise<void> {
    this.operation += 1;
    if (
      this.pipelineState !== "idle" ||
      this.detector ||
      this.lease ||
      this.starting ||
      this.inference
    ) {
      this.pipelineState = "stopping";
    }
    const starting = this.starting;
    const inference = this.inference;
    const detector = this.detector;
    const lease = this.lease;
    this.detector = undefined;
    this.lease = undefined;
    this.startOptions = undefined;
    await Promise.allSettled([starting, inference].filter(isPromise));
    detector?.dispose();
    await lease?.release();
    this.latestFrame = undefined;
    this.sequence = 0;
    this.inferredPresentedFrames = undefined;
    this.inferences = 0;
    this.skippedFrames = 0;
    this.lastInferenceMs = 0;
    this.lastFrameTimeSource = "";
    this.pipelineState = "idle";
    this.clearError();
  }

  public state(): PosePipelineState {
    return this.pipelineState;
  }

  public ready(): boolean {
    return Boolean(this.detector && this.lease && this.startOptions);
  }

  public backend(): string {
    return this.model.backend();
  }

  public errorCode(): PosePipelineErrorCode {
    return this.pipelineErrorCode;
  }

  public errorMessage(): string {
    return this.pipelineErrorMessage;
  }

  public latestFrameJson(): string {
    return this.latestFrame ? JSON.stringify(this.latestFrame) : "";
  }

  private async initialize(
    options: PoseStartOptions,
    operation: number,
  ): Promise<void> {
    this.clearError();
    this.pipelineState = "initializing-webgpu";
    try {
      await this.model.initializeWebGpu();
      if (this.model.backend() !== "webgpu") {
        throw new Error(
          `Selected backend is ${this.model.backend() || "none"}.`,
        );
      }
    } catch (error) {
      this.fail("webgpu-unavailable", error);
    }
    if (operation !== this.operation) return;

    this.pipelineState = "loading-model";
    let detector: PoseDetectorPort;
    try {
      detector = await this.model.createMultiPoseDetector();
    } catch (error) {
      this.fail("model-load-failed", error);
    }
    if (operation !== this.operation) {
      detector.dispose();
      return;
    }

    this.pipelineState = "acquiring-camera";
    let lease: CameraLeasePort;
    try {
      lease = await requireCameraSource(this.runtime).acquireCamera({
        owner: "turbowarp-realtime-motion-capture",
        cameraId: options.cameraId,
      });
    } catch (error) {
      detector.dispose();
      this.fail("camera-unavailable", error);
    }
    if (operation !== this.operation) {
      detector.dispose();
      await lease.release();
      return;
    }

    this.detector = detector;
    this.lease = lease;
    this.startOptions = options;
    this.sequence = 0;
    this.pipelineState = "ready";
  }

  private async runInference(
    operation: number,
    captureTimestampUs: number,
  ): Promise<void> {
    const detector = this.detector;
    const lease = this.lease;
    const options = this.startOptions;
    if (!detector || !lease || !options) return;
    this.pipelineState = "inferencing";
    let frame;
    try {
      frame = lease.getFrameSource();
      if (frame.kind !== "video" || frame.width < 1 || frame.height < 1) {
        throw new Error(
          "Camera frame source has ended or has no current frame.",
        );
      }
    } catch (error) {
      this.fail("camera-ended", error);
    }
    let poses;
    const started = this.measureMs?.();
    try {
      poses = await detector.estimatePoses(frame.element, {
        maxPoses: 6,
        flipHorizontal: false,
      });
    } catch (error) {
      this.fail("inference-failed", error);
    }
    if (operation !== this.operation) return;
    const finished = this.measureMs?.();
    this.lastInferenceMs =
      started === undefined || finished === undefined ? 0 : finished - started;
    let markersByPose: Map<number, PoseMarkerV2[]> | undefined;
    try {
      markersByPose = this.sampleMarkers(poses, frame);
    } catch (error) {
      this.fail("marker-sampling-failed", error);
    }
    try {
      this.latestFrame = createPoseFrame2D(
        poses,
        {
          cameraId: options.cameraId,
          peerId: options.peerId,
          calibrationId: options.calibrationId,
          sequence: this.sequence,
          captureTimestampUs,
          frameWidth: frame.width,
          frameHeight: frame.height,
        },
        markersByPose,
      );
      this.sequence += 1;
      this.inferences += 1;
      this.pipelineState = "ready";
      this.clearError();
    } catch (error) {
      this.fail("invalid-output", error);
    }
  }

  /** Samples one patch per configured keypoint of every tracked person. */
  private sampleMarkers(
    poses: readonly ModelPose[],
    frame: CameraFrameSourcePort,
  ): Map<number, PoseMarkerV2[]> | undefined {
    const options = this.markerOptions;
    const sampler = this.markerSampler;
    if (!options || !sampler) return undefined;
    const patches: MarkerPatch[] = [];
    const owners: Array<{ pose: number; keypointId: Coco17KeypointId }> = [];
    poses.slice(0, 6).forEach((pose, index) => {
      for (const { keypointId, patch } of markerPatchesFor(pose, options)) {
        owners.push({ pose: index, keypointId });
        patches.push(patch);
      }
    });
    const colors = sampler.sample(
      { element: frame.element, width: frame.width, height: frame.height },
      patches,
    );
    const byPose = new Map<
      number,
      Array<{
        keypointId: Coco17KeypointId;
        color: SampledColor | undefined;
      }>
    >();
    owners.forEach((owner, index) => {
      const entries = byPose.get(owner.pose) ?? [];
      entries.push({ keypointId: owner.keypointId, color: colors[index] });
      byPose.set(owner.pose, entries);
    });
    const markers = new Map<number, PoseMarkerV2[]>();
    poses.slice(0, 6).forEach((_, index) => {
      markers.set(index, toMarkers(byPose.get(index) ?? []));
    });
    return markers;
  }

  private fail(
    code: Exclude<PosePipelineErrorCode, "">,
    cause: unknown,
  ): never {
    const detail = cause instanceof Error ? cause.message : String(cause);
    this.pipelineState = "error";
    this.pipelineErrorCode = code;
    this.pipelineErrorMessage = `${code}: ${detail}`;
    throw new Error(this.pipelineErrorMessage, { cause });
  }

  private clearError(): void {
    this.pipelineErrorCode = "";
    this.pipelineErrorMessage = "";
  }
}

function requireCameraSource(runtime: TurboWarpRuntime): CameraSourcePort {
  const candidate = runtime.ext_kubohiroyacamerasource;
  if (
    typeof candidate !== "object" ||
    candidate === null ||
    !("acquireCamera" in candidate) ||
    typeof candidate.acquireCamera !== "function"
  ) {
    throw new Error("TurboWarp Camera Source is not loaded.");
  }
  return candidate as CameraSourcePort;
}

function normalizeStartOptions(options: PoseStartOptions): PoseStartOptions {
  return {
    cameraId: identifier(options.cameraId, "camera ID"),
    peerId: identifier(options.peerId, "peer ID"),
    calibrationId: identifier(options.calibrationId, "calibration ID"),
  };
}

function identifier(value: string, label: string): string {
  const text = value.trim();
  if (!/^[A-Za-z0-9._-]{1,64}$/u.test(text))
    throw new Error(`Invalid ${label}.`);
  return text;
}

function isPromise(value: Promise<void> | undefined): value is Promise<void> {
  return value !== undefined;
}
