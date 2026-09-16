export interface MultiviewPoseFeatureFlags {
  readonly qrCourierPairing: boolean;
  readonly webgpuMoveNetMultiPose: boolean;
  readonly protocolV1Codec: boolean;
  readonly cameraCalibrationV1: boolean;
  readonly avatarRetargetV1: boolean;
  readonly frameSyncPatternV1: boolean;
  /**
   * Hand the optical time path to turbowarp-time-space-sync.
   *
   * Independent of `cameraCalibrationV1` and its own delegation: during the
   * move one path can be delegated while the other is not, and both states are
   * legitimate.
   */
  readonly timeSpaceSyncDelegateV1: boolean;
  readonly poseFusion3D: boolean;
  readonly glowStickMarkers: boolean;
}

interface FeatureFlagGlobal {
  readonly __TWMP_FEATURE_FLAGS__?: Partial<MultiviewPoseFeatureFlags>;
}

const overrides = (globalThis as FeatureFlagGlobal).__TWMP_FEATURE_FLAGS__;

/**
 * Pairs where one flag runs the old path and the other hands it away.
 *
 * Turning both on runs two implementations of the same thing at once: two
 * leases on one camera, two overlays covering the screen, two corrections
 * applied to the same observation. None of those announce themselves -- a
 * second lease is granted, a second overlay is drawn on top of the first, a
 * doubled correction is a plausible number -- so the combination is refused
 * before anything starts rather than diagnosed afterwards.
 */
const exclusivePairs: ReadonlyArray<
  readonly [keyof MultiviewPoseFeatureFlags, keyof MultiviewPoseFeatureFlags]
> = [["frameSyncPatternV1", "timeSpaceSyncDelegateV1"]];

/**
 * Refuses a combination that would run two implementations of one thing.
 *
 * Called when the extension is built rather than when this module loads: a
 * throw during module evaluation gives TurboWarp nothing to show the operator,
 * and the message is the only thing that explains what to change.
 */
export function requireConsistentFeatureFlags(
  flags: MultiviewPoseFeatureFlags = featureFlags,
): MultiviewPoseFeatureFlags {
  for (const [older, delegate] of exclusivePairs) {
    if (flags[older] && flags[delegate]) {
      throw new Error(
        `${older} and ${delegate} are both on. One runs the path here and the other hands it to another extension; together they lease the same camera twice and draw two overlays. Turn off ${older} to delegate, or ${delegate} to keep the path here.`,
      );
    }
  }
  return flags;
}

/** Startup-fixed flags. Experimental QR and pose paths stay independently opt-in. */
export const featureFlags: MultiviewPoseFeatureFlags = Object.freeze({
  qrCourierPairing: overrides?.qrCourierPairing === true,
  webgpuMoveNetMultiPose: overrides?.webgpuMoveNetMultiPose === true,
  protocolV1Codec: overrides?.protocolV1Codec === true,
  cameraCalibrationV1: overrides?.cameraCalibrationV1 === true,
  avatarRetargetV1: overrides?.avatarRetargetV1 === true,
  frameSyncPatternV1: overrides?.frameSyncPatternV1 === true,
  timeSpaceSyncDelegateV1: overrides?.timeSpaceSyncDelegateV1 === true,
  poseFusion3D: overrides?.poseFusion3D === true,
  glowStickMarkers: overrides?.glowStickMarkers === true,
});
