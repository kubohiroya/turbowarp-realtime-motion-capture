export * from "./data-types.js";

export interface ModelKeypoint {
  name?: string;
  x: number;
  y: number;
  score?: number;
}

export interface ModelPose {
  id?: number;
  score?: number;
  keypoints: ModelKeypoint[];
}

export interface PoseDetectorPort {
  estimatePoses(
    image: HTMLVideoElement,
    config: { maxPoses: 6; flipHorizontal: false },
  ): Promise<ModelPose[]>;
  dispose(): void;
}

export interface PoseModelPort {
  initializeWebGpu(): Promise<void>;
  backend(): string;
  createMultiPoseDetector(): Promise<PoseDetectorPort>;
}

export type FrameTimeSource = "capture" | "presentation";

/**
 * The capture time Camera Source (0.13.0 and later) reports for the frame a
 * source was taken at, in microseconds since the Unix epoch on the page clock.
 */
export interface CameraFrameTimePort {
  readonly timestampUs: number;
  readonly source: FrameTimeSource;
  readonly presentedFrames: number;
}

export interface CameraFrameSourcePort {
  readonly kind: "video";
  readonly element: HTMLVideoElement;
  readonly width: number;
  readonly height: number;
  readonly mirrored: boolean;
  readonly deviceId: string;
  /** Absent before Camera Source 0.13.0, and while a frame has no time. */
  readonly frameTime?: CameraFrameTimePort;
}

export interface CameraLeasePort {
  getFrameSource(): CameraFrameSourcePort;
  release(): Promise<void>;
}

export interface CameraSourcePort {
  acquireCamera(options: {
    owner: string;
    cameraId: string;
  }): Promise<CameraLeasePort>;
}
