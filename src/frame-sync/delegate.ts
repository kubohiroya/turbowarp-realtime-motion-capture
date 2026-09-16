import {
  readTimeSpaceSyncCapability,
  runtimeCapabilityVersion,
  toLegacyFrameSyncErrorCode,
  type LegacyFrameSyncErrorCode,
  type OpticalTimeObservation,
  type PhotosensitivityAcknowledgement,
  type TimeSpaceSyncCapabilityV1,
} from "@kubohiroya/turbowarp-time-space-sync/runtime";

/**
 * The old frame sync opcodes, answered by turbowarp-time-space-sync.
 *
 * The declarations come from that package rather than being written out here.
 * A copy is checked against nothing: the other side could change the shape,
 * this repository would still typecheck, and the mismatch would surface in a
 * browser. That has already happened in this family once.
 *
 * What the old opcodes publish is narrower than what the new path measures, and
 * the gaps are not all bridgeable. Where they are not, this refuses and says
 * which block to use instead; it does not invent a value to keep an old opcode
 * returning something.
 */

export type DelegateState =
  "idle" | "acquiring-camera" | "calibrating" | "ready" | "error";

/**
 * The reference the old opcodes stand for.
 *
 * They were written when one display was the only thing a decoder could be
 * pointed at, so they carry no reference of their own. Naming it here keeps the
 * observations these produce distinguishable from any raised through the new
 * blocks against a reference the operator chose.
 */
export const LEGACY_REFERENCE_ID = "legacy-frame-sync";

export interface FrameSyncDelegateOptions {
  readonly runtime: TurboWarpRuntime;
  /** Overrides the runtime lookup; used by tests. */
  readonly capability?: TimeSpaceSyncCapabilityV1;
}

export class FrameSyncDelegate {
  private readonly runtime: TurboWarpRuntime;
  private readonly injected: TimeSpaceSyncCapabilityV1 | undefined;
  private acknowledgement: PhotosensitivityAcknowledgement | undefined;
  private displayRefreshUs: number | undefined;
  private observation: OpticalTimeObservation | undefined;
  /**
   * One reading held back so that asking whether any is waiting does not throw
   * it away.
   *
   * The capability hands over the oldest reading and has no way to be asked how
   * many there are. The old pair of blocks -- one asking, one taking -- needs
   * both, so the asking one takes a reading and keeps it here for the taking
   * one to find.
   */
  private pending: OpticalTimeObservation | undefined;
  private cameraId = "";

  public constructor(options: FrameSyncDelegateOptions) {
    this.runtime = options.runtime;
    this.injected = options.capability;
  }

  /**
   * The capability, at the version this adapter was written against.
   *
   * A missing extension and a version this build cannot speak are different
   * failures with different remedies, so they carry different messages. Neither
   * falls back to the path here: the flags forbid that path being built at all
   * while this one is in use, and quietly running it would be the double
   * capture the flags exist to prevent.
   */
  public capability(): TimeSpaceSyncCapabilityV1 {
    const capability =
      this.injected ?? readTimeSpaceSyncCapability(this.runtime);
    if (!capability) {
      throw new Error(
        "turbowarp-time-space-sync is not loaded, or its optical time feature is off. Load it and turn on opticalTimeSyncV1, or turn off timeSpaceSyncDelegateV1 here.",
      );
    }
    return capability.requireVersion(runtimeCapabilityVersion);
  }

  /**
   * Records that the operator was warned the pattern flashes.
   *
   * The old opcode had nothing to say about this, because the path it drove
   * asked for nothing. The new one will not show the pattern without it, and
   * manufacturing an acknowledgement here so that an old block keeps working
   * would defeat the only thing standing between an operator and a full screen
   * of flashing. Projects that opt into delegation accept this extra step.
   */
  public acknowledgeFlashing(nowUs: number): void {
    this.acknowledgement = {
      acknowledgedByOperator: true,
      acknowledgedAtUs: nowUs,
    };
  }

  public showPattern(): void {
    const acknowledgement = this.acknowledgement;
    if (!acknowledgement) {
      throw new Error(
        "The full screen pattern flashes and has to be acknowledged before it is shown. Run `acknowledge that the frame sync pattern flashes` first.",
      );
    }
    this.capability().showPattern(acknowledgement);
  }

  public hidePattern(): void {
    this.capability().hidePattern();
  }

  public patternShown(): boolean {
    return this.injectedOrAbsent()?.patternShown() ?? false;
  }

  public patternWrapUs(): number {
    const profile = this.injectedOrAbsent()?.patternProfile();
    return profile ? 2 ** profile.dataBits * profile.stepUs : 0;
  }

  /**
   * Tells the decoder how long each code stays on screen.
   *
   * The old opcode never asked, because the decoder it drove guessed. Guessing
   * is what the new path refuses to do: the interval sets the whole width of
   * the constraint an observation carries, so assuming 60 Hz for a projector
   * running at 50 biases every result with nothing in the output saying so.
   * When the pattern is being shown from this machine the display has measured
   * it and that figure is used; otherwise it has to be supplied.
   */
  public setDisplayRefreshUs(microseconds: number): void {
    this.displayRefreshUs =
      Number.isFinite(microseconds) && microseconds > 0
        ? Math.round(microseconds)
        : undefined;
  }

  public async start(
    cameraId: string,
    calibrationSeconds: number,
  ): Promise<void> {
    const capability = this.capability();
    const refreshUs = capability.patternRefreshUs() ?? this.displayRefreshUs;
    if (refreshUs === undefined) {
      throw new Error(
        "The display's refresh interval is not known. Show the pattern from this computer, or run `set frame sync display refresh` with the interval of the computer showing it.",
      );
    }
    this.cameraId = cameraId;
    await capability.startDecoder({
      cameraId,
      referenceId: LEGACY_REFERENCE_ID,
      calibrationSeconds,
      displayRefreshUs: refreshUs,
      // Nothing measured it, and the old opcodes have nowhere to put it. One
      // pattern step is the floor: the displayed value is quantised to that
      // however well the refresh itself is known.
      refreshUncertaintyUs: this.patternStepUs(),
    });
  }

  /**
   * Runs calibration again, by starting the decoder over.
   *
   * The capability has no separate recalibrate: the new path treats a fresh
   * calibration as a fresh run. The observable difference is that the camera
   * lease is released and taken again, where the old opcode kept it. A camera
   * shared with something else sees a gap it did not see before.
   */
  public async recalibrate(calibrationSeconds: number): Promise<void> {
    if (!this.cameraId) {
      throw new Error(
        "Start the frame sync decoder before calibrating it again.",
      );
    }
    await this.start(this.cameraId, calibrationSeconds);
  }

  public async stop(): Promise<void> {
    this.observation = undefined;
    this.pending = undefined;
    await this.injectedOrAbsent()?.stopDecoder();
  }

  public state(): DelegateState {
    return (this.injectedOrAbsent()?.decoderState() ?? "idle") as DelegateState;
  }

  /**
   * The last error, in the six codes the old opcodes published.
   *
   * A project reads this against a literal, so a code it has never seen reads
   * to it as "no error I know about". The mapping table comes from
   * time-space-sync, which owns both vocabularies.
   */
  public errorCode(): LegacyFrameSyncErrorCode {
    const code = this.injectedOrAbsent()?.decoderError() ?? "";
    return toLegacyFrameSyncErrorCode(code);
  }

  public observationAvailable(): boolean {
    if (this.pending === undefined) {
      this.pending = this.injectedOrAbsent()?.takeObservation();
    }
    return this.pending !== undefined;
  }

  public takeObservation(): void {
    const held = this.pending;
    this.pending = undefined;
    this.observation = held ?? this.capability().takeObservation();
  }

  /** When this computer finished recording the taken frame. */
  public frameTimestampUs(): number {
    return this.observation?.deliveredAtUs ?? 0;
  }

  /**
   * How old the taken frame was when the browser delivered it.
   *
   * Zero when the browser reported no capture time, which is what the old
   * opcode did and what projects reading it expect. It is not a measurement of
   * no latency, and the new path says so properly; this one cannot, because
   * there is nowhere in the old surface to say it.
   */
  public frameAgeUs(): number {
    const observation = this.observation;
    if (!observation || observation.captureTimeUs === undefined) return 0;
    return Math.max(0, observation.deliveredAtUs - observation.captureTimeUs);
  }

  /** The display time decoded out of the taken frame, within the wrap window. */
  public patternTimestampUs(): number {
    return this.observation?.patternCodeTimestampUs ?? 0;
  }

  public activeCameraId(): string {
    return this.cameraId;
  }

  /** The capability if it is there, without raising when it is not. */
  private injectedOrAbsent(): TimeSpaceSyncCapabilityV1 | undefined {
    try {
      return this.capability();
    } catch {
      // Reporters must not throw: one that does stops the script that read it,
      // and an extension that is not loaded is not an error to report there.
      return undefined;
    }
  }

  private patternStepUs(): number {
    return this.injectedOrAbsent()?.patternProfile().stepUs ?? 1000;
  }
}
