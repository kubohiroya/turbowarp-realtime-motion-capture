import {
  PosePipelineController,
  type FrameTimedInferenceOutcome,
  type PosePipelineControllerOptions,
  type PosePipelineStats,
  type PoseStartOptions,
} from "./controller.js";

/** One camera's pipeline, as a project reads it back. */
export interface PoseCameraStatus extends PosePipelineStats {
  readonly cameraId: string;
  readonly lastOutcome: FrameTimedInferenceOutcome | "";
  readonly error: string;
}

/**
 * A pose pipeline per camera, for a page that runs several cameras.
 *
 * Each camera keeps its own detector. MoveNet tracks people from one frame to
 * the next, and a tracker fed frames from two cameras would hand one person's
 * ID to whoever stands in the same place in the other view. They share the
 * model port, so WebGPU is initialized once and inference runs on one device;
 * the project decides the order cameras take turns in.
 */
export class PoseCameraSet {
  private readonly options: Omit<
    PosePipelineControllerOptions,
    "markerSampler"
  >;
  private readonly pipelines = new Map<string, PosePipelineController>();
  private readonly outcomes = new Map<string, FrameTimedInferenceOutcome>();

  public constructor(
    options: Omit<PosePipelineControllerOptions, "markerSampler">,
  ) {
    this.options = options;
  }

  public async start(options: PoseStartOptions): Promise<void> {
    const cameraId = options.cameraId.trim();
    let pipeline = this.pipelines.get(cameraId);
    if (!pipeline) {
      pipeline = new PosePipelineController(this.options);
      this.pipelines.set(cameraId, pipeline);
    }
    this.outcomes.delete(cameraId);
    await pipeline.start(options);
  }

  /** Infers the camera's current frame at its capture time. */
  public async infer(cameraId: string): Promise<void> {
    const pipeline = this.pipelines.get(cameraId.trim());
    if (!pipeline) throw new Error(`Pose camera ${cameraId} is not started.`);
    const outcome = await pipeline.inferAtFrameTime();
    this.outcomes.set(cameraId.trim(), outcome);
  }

  public async stop(cameraId: string): Promise<void> {
    const id = cameraId.trim();
    const pipeline = this.pipelines.get(id);
    this.pipelines.delete(id);
    this.outcomes.delete(id);
    await pipeline?.stop();
  }

  public async stopAll(): Promise<void> {
    const pipelines = [...this.pipelines.values()];
    this.pipelines.clear();
    this.outcomes.clear();
    await Promise.allSettled(pipelines.map((pipeline) => pipeline.stop()));
  }

  public cameraIds(): string[] {
    return [...this.pipelines.keys()].sort();
  }

  public latestFrameJson(cameraId: string): string {
    return this.pipelines.get(cameraId.trim())?.latestFrameJson() ?? "";
  }

  public status(cameraId: string): PoseCameraStatus | undefined {
    const id = cameraId.trim();
    const pipeline = this.pipelines.get(id);
    if (!pipeline) return undefined;
    return {
      cameraId: id,
      ...pipeline.stats(),
      lastOutcome: this.outcomes.get(id) ?? "",
      error: pipeline.errorMessage(),
    };
  }
}
