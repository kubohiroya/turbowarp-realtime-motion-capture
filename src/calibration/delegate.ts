import { cameraSourceCapabilityKey } from "@kubohiroya/turbowarp-camera-source/runtime";

/**
 * Calibration profiles, kept by Camera Source instead of here.
 *
 * Only the profile half is delegated. Running a calibration -- pointing a
 * camera at a board, collecting samples, solving -- belongs to
 * turbowarp-camera-calibration, which publishes no way for another extension to
 * ask it to. Until it does, the opcodes that drive a calibration keep using the
 * backend here, and the ones that store, validate and hand back a result use
 * the shared registry.
 *
 * Splitting it that way is not a compromise for its own sake: the profile is
 * what other extensions read, so a second copy of it here is the thing that
 * actually causes trouble, while a second calibrator is merely duplicated code.
 */

/**
 * What Camera Source offers, narrowed to the parts used here.
 *
 * Camera Source publishes `CameraFrameSource` and the lease from its `./runtime`
 * entry but not the calibration capability, so this shape is declared. It is
 * checked at the seam instead: `requireVersion` refuses a build that does not
 * implement version 1, and every member is feature-detected before use.
 */
export interface CameraProfileCapability {
  readonly version: number;
  requireVersion(version: number): CameraProfileCapability;
  registerProfile(document: unknown): {
    ok: boolean;
    profile?: { cameraId: string };
    error?: { code: string; path: string; message: string };
  };
  profileFor(cameraId: string): unknown;
  calibratedCameras(): string[];
}

const REQUIRED_VERSION = 1;
const MEMBERS = [
  "requireVersion",
  "registerProfile",
  "profileFor",
  "calibratedCameras",
] as const;

export interface CalibrationProfileDelegateOptions {
  readonly runtime: TurboWarpRuntime;
  /** Overrides the runtime lookup; used by tests. */
  readonly capability?: CameraProfileCapability;
}

export class CalibrationProfileDelegate {
  private readonly runtime: TurboWarpRuntime;
  private readonly injected: CameraProfileCapability | undefined;
  private lastError = "";
  private lastErrorDetail = "";
  private cameraId = "";

  public constructor(options: CalibrationProfileDelegateOptions) {
    this.runtime = options.runtime;
    this.injected = options.capability;
  }

  public capability(): CameraProfileCapability {
    const candidate =
      this.injected ??
      (this.runtime[cameraSourceCapabilityKey] as
        CameraProfileCapability | undefined);
    if (typeof candidate !== "object" || candidate === null) {
      throw new Error(
        "Camera Source is not loaded. Load it, or turn off cameraCalibrationDelegateV1 here and use this extension's own calibration path.",
      );
    }
    const missing = MEMBERS.filter(
      (name) =>
        typeof (candidate as unknown as Record<string, unknown>)[name] !==
        "function",
    );
    if (missing.length > 0) {
      throw new Error(
        `Camera Source does not publish the calibration profile API: ${missing.join(", ")} missing.`,
      );
    }
    return candidate.requireVersion(REQUIRED_VERSION);
  }

  /**
   * Hands a profile document to the shared registry.
   *
   * Both the old `twrmc/camera-calibration` documents and the current
   * `twcs/camera-intrinsics` ones go in at the same entry, because Camera Source
   * dispatches on what the document says it is. An operator holding a file they
   * saved once should not have to know which of two schemas it uses.
   */
  public importProfile(text: string): void {
    let document: unknown;
    try {
      document = JSON.parse(text);
    } catch {
      this.lastError = "invalid-json";
      this.lastErrorDetail = "The calibration profile is not valid JSON.";
      return;
    }
    const result = this.capability().registerProfile(document);
    if (result.ok) {
      this.cameraId = result.profile?.cameraId ?? this.cameraId;
      this.lastError = "";
      this.lastErrorDetail = "";
      return;
    }
    this.lastError = result.error?.code ?? "invalid-profile";
    this.lastErrorDetail = result.error
      ? `${result.error.path}: ${result.error.message}`
      : "The calibration profile was refused.";
  }

  /**
   * Whether a document would be accepted, without storing it.
   *
   * The registry stores nothing when validation fails, so asking is the same as
   * trying; a profile that half-registered would be indistinguishable from a
   * good one at the point of use.
   */
  public validateProfile(text: string): boolean {
    let document: unknown;
    try {
      document = JSON.parse(text);
    } catch {
      return false;
    }
    return this.capability().registerProfile(document).ok;
  }

  public ready(): boolean {
    const capability = this.quietCapability();
    if (!capability) return false;
    return this.cameraId
      ? capability.profileFor(this.cameraId) !== undefined
      : capability.calibratedCameras().length > 0;
  }

  public profileJson(): string {
    const capability = this.quietCapability();
    if (!capability) return "";
    const cameraId = this.cameraId || (capability.calibratedCameras()[0] ?? "");
    if (!cameraId) return "";
    const profile = capability.profileFor(cameraId);
    return profile === undefined ? "" : JSON.stringify(profile);
  }

  public errorCode(): string {
    return this.lastError;
  }

  public errorDetail(): string {
    return this.lastErrorDetail;
  }

  /** The capability if it is there, without raising when it is not. */
  private quietCapability(): CameraProfileCapability | undefined {
    try {
      return this.capability();
    } catch {
      // Reporters must not throw: one that does stops the script that read it,
      // and an extension that is not loaded is not an error to report there.
      return undefined;
    }
  }
}
