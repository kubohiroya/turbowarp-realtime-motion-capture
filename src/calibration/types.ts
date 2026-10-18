export interface CalibrationBoard {
  columns: number;
  rows: number;
  squareSizeMeters: number;
}

export interface CalibrationFrame {
  element: HTMLVideoElement;
  width: number;
  height: number;
}

export interface CalibrationSample {
  corners: Array<{ x: number; y: number }>;
  quality: number;
  coverage: number;
  sharpness: number;
}

export interface CalibrationSolveResult {
  intrinsicMatrix: number[];
  distortionCoefficients: number[];
  worldFromCameraMatrix: number[];
  reprojectionErrorPx: number;
}

export interface CalibrationBackendPort {
  readonly name: string;
  captureSample(
    frame: CalibrationFrame,
    board: CalibrationBoard,
  ): Promise<CalibrationSample | undefined>;
  solve(
    samples: readonly CalibrationSample[],
    board: CalibrationBoard,
    imageWidth: number,
    imageHeight: number,
  ): Promise<CalibrationSolveResult>;
}

export type { CameraCalibrationV1 } from "./profile-types.js";
