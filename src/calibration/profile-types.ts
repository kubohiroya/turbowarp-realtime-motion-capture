export interface CameraCalibrationV1 {
  schema: "twrmc/camera-calibration";
  version: 1;
  calibrationId: string;
  cameraId: string;
  imageWidth: number;
  imageHeight: number;
  intrinsicMatrix: number[];
  distortionCoefficients: number[];
  worldFromCameraMatrix: number[];
  worldUnit: "meter";
  calibratedAt: string;
}
