import definitions from "./block-definitions.json";
import { extensionConfig } from "./config.js";
import {
  featureFlags,
  requireConsistentFeatureFlags,
} from "../config/feature-flags.js";
import { qrConfig } from "../config/qr-config.js";
import {
  createQrCourierParts,
  type QrErrorCorrectionLevel,
} from "./qr-courier.js";
import { createQrSvg } from "./qr-svg.js";
import { TemporarySpriteSkinManager } from "./sprite-skin.js";
import { requireWebRtcOfferCapability } from "./webrtc-capability.js";
import { PosePipelineController } from "./pose/controller.js";
import { TfjsWebGpuMoveNet } from "./pose/tfjs-movenet.js";
import type { PoseModelPort } from "./pose/types.js";
import { ProtocolV1Codec } from "./protocol/codec.js";
import { CameraCalibrationController } from "./calibration/controller.js";
import { OpenCvChessboardCalibrationBackend } from "./calibration/opencv-backend.js";
import type { CalibrationBackendPort } from "./calibration/types.js";
import { AvatarRetargetController } from "./avatar/controller.js";
import type { AvatarPoseSolverPort } from "./avatar/types.js";
import { FrameSyncPatternController } from "./frame-sync/controller.js";
import { FrameSyncDelegate } from "./frame-sync/delegate.js";
import { CalibrationProfileDelegate } from "./calibration/delegate.js";
import { FrameSyncPatternDisplay } from "./frame-sync/pattern-display.js";
import { PATTERN_WRAP_US } from "./frame-sync/pattern.js";
import { requireSynchronizedTimeSource } from "./frame-sync/time-source.js";
import { VideoFramePump } from "./frame-sync/video-frame-pump.js";
import type { PatternDisplayPort } from "./frame-sync/types.js";
import { PoseFusionController } from "./fusion/controller.js";
import { CanvasGlowStickSampler } from "./markers/canvas-sampler.js";
import { parseKeypointIds } from "./markers/sampler.js";
import {
  DEFAULT_MARKER_SAMPLING_OPTIONS,
  type MarkerImageSamplerPort,
} from "./markers/types.js";

type BlockTypeName = "COMMAND" | "REPORTER" | "BOOLEAN" | "HAT";
type ArgumentTypeName = "STRING" | "NUMBER" | "BOOLEAN";
type OfferQrState =
  "idle" | "generating-offer" | "rendering" | "displayed" | "error";

interface DefinitionArgument {
  type: ArgumentTypeName;
  defaultValue: string | number | boolean;
}

interface BlockDefinition {
  opcode: string;
  feature:
    | "qrCourierPairing"
    | "webgpuMoveNetMultiPose"
    | "protocolV1Codec"
    | "cameraCalibrationV1"
    | "avatarRetargetV1"
    | "frameSyncPatternV1"
    | "timeSpaceSyncDelegateV1"
    | "poseFusion3D"
    | "glowStickMarkers";
  blockType: BlockTypeName;
  text: string;
  description: string;
  arguments: Record<string, DefinitionArgument>;
}

interface OfferQrSession {
  peer: string;
  texts: string[];
  svgs: string[];
  currentIndex: number;
}

export interface MultiviewPoseExtensionOptions {
  enabled?: boolean;
  poseEnabled?: boolean;
  protocolEnabled?: boolean;
  calibrationEnabled?: boolean;
  avatarEnabled?: boolean;
  frameSyncEnabled?: boolean;
  timeSpaceSyncDelegated?: boolean;
  calibrationDelegated?: boolean;
  fusionEnabled?: boolean;
  markersEnabled?: boolean;
  markerSampler?: MarkerImageSamplerPort;
  errorCorrectionLevel?: QrErrorCorrectionLevel;
  runtime?: TurboWarpRuntime;
  poseModel?: PoseModelPort;
  calibrationBackend?: CalibrationBackendPort;
  avatarPoseSolver?: AvatarPoseSolverPort;
  frameSyncController?: FrameSyncPatternController;
  frameSyncDisplay?: PatternDisplayPort;
  nowMilliseconds?: () => number;
}

const blockDefinitions = definitions.blocks as readonly BlockDefinition[];
const FRAME_SYNC_ANALYSIS_WIDTH = 240;
const FRAME_SYNC_ANALYSIS_HEIGHT = 180;

export class MultiviewPoseExtension implements TurboWarpExtension {
  private readonly enabled: boolean;
  private readonly poseEnabled: boolean;
  private readonly protocolEnabled: boolean;
  private readonly calibrationEnabled: boolean;
  private readonly avatarEnabled: boolean;
  private readonly frameSyncEnabled: boolean;
  /**
   * Whether the optical time path has been handed to time-space-sync.
   *
   * While this is on nothing here builds a decoder or an overlay: the two would
   * lease the same camera and cover the screen twice, and neither says so.
   */
  private readonly timeSpaceSyncDelegated: boolean;
  /**
   * Whether calibration profiles are kept in Camera Source's registry.
   *
   * Running a calibration is not delegated: the extension that owns the
   * procedure publishes no way to be asked. So this turns over storage,
   * validation and reading, and the backend here still drives a session.
   */
  private readonly calibrationDelegated: boolean;
  private readonly fusionEnabled: boolean;
  private readonly markersEnabled: boolean;
  private readonly errorCorrectionLevel: QrErrorCorrectionLevel;
  private readonly runtime: TurboWarpRuntime;
  private readonly skins: TemporarySpriteSkinManager;
  private readonly pose: PosePipelineController;
  private readonly protocol: ProtocolV1Codec;
  private readonly calibration: CameraCalibrationController;
  private readonly avatar: AvatarRetargetController;
  private frameSync: FrameSyncPatternController | undefined;
  private frameSyncDelegate: FrameSyncDelegate | undefined;
  private calibrationDelegate: CalibrationProfileDelegate | undefined;
  private frameSyncOverlay: PatternDisplayPort | undefined;
  private readonly fusion: PoseFusionController;
  private session: OfferQrSession | undefined;
  private state: OfferQrState = "idle";
  private lastError = "";
  private operation = 0;
  /**
   * Runs whenever the thread queue empties, which releases camera leases and
   * temporary skins but must keep buffered fusion state alive: event-driven
   * projects buffer frames from hat scripts that finish between messages.
   */
  private readonly runStopListener = () => {
    this.endOfferQrDisplay();
    void this.pose.stop();
    void this.calibration.cancel();
    this.avatar.reset();
    void this.frameSync?.stop();
    this.frameSyncOverlay?.hide();
  };
  /** The stop button and project reload also discard buffered fusion state. */
  private readonly stopListener = () => {
    this.runStopListener();
    this.fusion.stop();
  };
  private readonly disposeListener = () => this.dispose();
  private readonly targetRemovedListener = (target: unknown) => {
    if (isTarget(target) && this.skins.isDisplaying(target))
      this.endOfferQrDisplay();
  };

  public constructor(options: MultiviewPoseExtensionOptions = {}) {
    // Before anything is built. A combination that would run two
    // implementations of one path has to stop here, while there is still
    // somewhere to put the reason.
    requireConsistentFeatureFlags();
    this.enabled = options.enabled ?? featureFlags.qrCourierPairing;
    this.poseEnabled =
      options.poseEnabled ?? featureFlags.webgpuMoveNetMultiPose;
    this.protocolEnabled =
      options.protocolEnabled ?? featureFlags.protocolV1Codec;
    this.calibrationEnabled =
      options.calibrationEnabled ?? featureFlags.cameraCalibrationV1;
    this.avatarEnabled = options.avatarEnabled ?? featureFlags.avatarRetargetV1;
    this.frameSyncEnabled =
      options.frameSyncEnabled ?? featureFlags.frameSyncPatternV1;
    this.timeSpaceSyncDelegated =
      options.timeSpaceSyncDelegated ?? featureFlags.timeSpaceSyncDelegateV1;
    this.calibrationDelegated =
      options.calibrationDelegated ?? featureFlags.cameraCalibrationDelegateV1;
    this.fusionEnabled = options.fusionEnabled ?? featureFlags.poseFusion3D;
    this.markersEnabled =
      options.markersEnabled ?? featureFlags.glowStickMarkers;
    this.errorCorrectionLevel =
      options.errorCorrectionLevel ?? qrConfig.errorCorrectionLevel;
    this.runtime = options.runtime ?? Scratch.vm?.runtime ?? {};
    this.skins = new TemporarySpriteSkinManager(this.runtime);
    this.pose = new PosePipelineController({
      runtime: this.runtime,
      model: options.poseModel ?? new TfjsWebGpuMoveNet(),
      markerSampler:
        options.markerSampler ??
        new CanvasGlowStickSampler(DEFAULT_MARKER_SAMPLING_OPTIONS),
    });
    this.protocol = new ProtocolV1Codec(options.nowMilliseconds);
    this.calibration = new CameraCalibrationController({
      runtime: this.runtime,
      backend:
        options.calibrationBackend ?? new OpenCvChessboardCalibrationBackend(),
      ...(options.nowMilliseconds
        ? { nowMilliseconds: options.nowMilliseconds }
        : {}),
    });
    this.avatar = new AvatarRetargetController(
      this.runtime,
      options.avatarPoseSolver,
    );
    this.frameSync = options.frameSyncController;
    this.frameSyncOverlay = options.frameSyncDisplay;
    this.fusion = new PoseFusionController();
    this.runtime.on?.("PROJECT_STOP_ALL", this.stopListener);
    this.runtime.on?.("PROJECT_RUN_STOP", this.runStopListener);
    this.runtime.on?.("PROJECT_LOADED", this.stopListener);
    this.runtime.on?.("RUNTIME_DISPOSED", this.disposeListener);
    this.runtime.on?.("targetWasRemoved", this.targetRemovedListener);
  }

  public getInfo(): Record<string, unknown> {
    return {
      id: extensionConfig.id,
      name: Scratch.translate(definitions.extensionName),
      docsURI: extensionConfig.docsURI,
      blockIconURI: extensionConfig.blockIconURI,
      blocks: blockDefinitions
        .filter((block) => this.blockEnabled(block.feature))
        .map((block) => this.toScratchBlock(block)),
    };
  }

  public async prepareOfferQr(args: { PEER: unknown }): Promise<void> {
    this.requireEnabled();
    if (this.state === "generating-offer" || this.state === "rendering") {
      throw new Error("An offer QR operation is already running.");
    }
    const peer = Scratch.Cast.toString(args.PEER).trim();
    if (!peer) throw new Error("Peer name must not be empty.");
    this.clearPreparedSession();
    const operation = ++this.operation;
    this.state = "generating-offer";
    this.lastError = "";
    try {
      const capability = requireWebRtcOfferCapability(this.runtime);
      await capability.createOffer(peer);
      if (operation !== this.operation) return;
      const code = capability.getOffer(peer);
      if (!code)
        throw new Error(
          "TurboWarp WebRTC did not return an offer pairing code.",
        );
      this.state = "rendering";
      const courier = await createQrCourierParts(code, {
        peerId: peer,
        kind: "offer",
        errorCorrectionLevel: this.errorCorrectionLevel,
      });
      if (operation !== this.operation) return;
      this.session = {
        peer,
        texts: courier.texts,
        svgs: courier.texts.map((text) =>
          createQrSvg(text, this.errorCorrectionLevel),
        ),
        currentIndex: 0,
      };
      this.state = "displayed";
    } catch (error) {
      if (operation === this.operation) {
        this.state = "error";
        this.lastError = errorMessage(error);
      }
      throw error;
    }
  }

  public showOfferQrPart(
    args: { INDEX: unknown },
    util?: TurboWarpBlockUtility,
  ): void {
    this.requireEnabled();
    const session = this.requireSession();
    const index = Scratch.Cast.toNumber(args.INDEX);
    if (!Number.isInteger(index) || index < 1 || index > session.svgs.length) {
      throw new Error(
        `Offer QR part index must be between 1 and ${session.svgs.length}.`,
      );
    }
    this.skins.show(util?.target, session.svgs[index - 1] ?? "");
    session.currentIndex = index - 1;
  }

  public offerQrPartCount(): number {
    return this.session?.texts.length ?? 0;
  }

  public offerQrCurrentPart(): number {
    return this.session ? this.session.currentIndex + 1 : 0;
  }

  public showNextOfferQrPart(
    _args?: Record<string, never>,
    util?: TurboWarpBlockUtility,
  ): void {
    this.requireEnabled();
    const session = this.requireSession();
    const next = (session.currentIndex + 1) % session.svgs.length;
    this.skins.show(util?.target, session.svgs[next] ?? "");
    session.currentIndex = next;
  }

  public async createAndShowOfferQr(
    args: { PEER: unknown },
    util?: TurboWarpBlockUtility,
  ): Promise<void> {
    const target = this.skins.validateTarget(util?.target);
    await this.prepareOfferQr(args);
    if (this.runtime.targets && !this.runtime.targets.includes(target)) {
      this.endOfferQrDisplay();
      throw new Error(
        "Offer QR sprite target was removed while the offer was being created.",
      );
    }
    this.showOfferQrPart({ INDEX: 1 }, { target });
  }

  public endOfferQrDisplay(): void {
    this.operation += 1;
    this.skins.releaseAll();
    this.clearPreparedSession();
    this.state = "idle";
    this.lastError = "";
  }

  public offerQrState(): string {
    return this.enabled ? this.state : "disabled";
  }

  public offerQrError(): string {
    return this.lastError;
  }

  public async startWebGpuMoveNetMultiPose(args: {
    CAMERA_ID: unknown;
    PEER_ID: unknown;
    CALIBRATION_ID: unknown;
  }): Promise<void> {
    this.requirePoseEnabled();
    await this.pose.start({
      cameraId: Scratch.Cast.toString(args.CAMERA_ID).trim(),
      peerId: Scratch.Cast.toString(args.PEER_ID).trim(),
      calibrationId: Scratch.Cast.toString(args.CALIBRATION_ID).trim(),
    });
  }

  public async stopWebGpuMoveNetMultiPose(): Promise<void> {
    await this.pose.stop();
  }

  public async inferNextPoseFrame(args: {
    CAPTURE_TIMESTAMP_US: unknown;
  }): Promise<void> {
    this.requirePoseEnabled();
    await this.pose.inferLatestFrame(
      Scratch.Cast.toNumber(args.CAPTURE_TIMESTAMP_US),
    );
  }

  public webGpuMoveNetReady(): boolean {
    return this.poseEnabled && this.pose.ready();
  }

  public poseBackend(): string {
    return this.poseEnabled ? this.pose.backend() : "disabled";
  }

  public posePipelineState(): string {
    return this.poseEnabled ? this.pose.state() : "disabled";
  }

  public poseErrorCode(): string {
    return this.pose.errorCode();
  }

  public poseError(): string {
    return this.pose.errorMessage();
  }

  public latestPoseFrame2D(): string {
    return this.pose.latestFrameJson();
  }

  public protocolJsonValid(args: { JSON: unknown }): boolean {
    this.requireProtocolEnabled();
    return this.protocol.validate(Scratch.Cast.toString(args.JSON));
  }

  public decodeProtocolJson(args: { JSON: unknown }): void {
    this.requireProtocolEnabled();
    this.protocol.decode(Scratch.Cast.toString(args.JSON));
  }

  public encodeProtocolJson(args: { JSON: unknown }): string {
    this.requireProtocolEnabled();
    return this.protocol.encode(Scratch.Cast.toString(args.JSON));
  }

  public decodedProtocolJson(): string {
    return this.protocolEnabled ? this.protocol.decodedJson() : "";
  }

  public protocolSchema(): string {
    return this.protocolEnabled ? this.protocol.schema() : "disabled";
  }

  public protocolVersion(): number {
    return this.protocolEnabled ? this.protocol.version() : 0;
  }

  public protocolErrorPath(): string {
    return this.protocol.errorPath();
  }

  public protocolErrorMessage(): string {
    return this.protocol.errorMessage();
  }

  public async startCameraCalibration(args: {
    CAMERA_ID: unknown;
    CALIBRATION_ID: unknown;
    COLUMNS: unknown;
    ROWS: unknown;
    SQUARE_METERS: unknown;
    MAX_ERROR_PX: unknown;
  }): Promise<void> {
    this.requireCalibrationEnabled();
    await this.calibration.start({
      cameraId: Scratch.Cast.toString(args.CAMERA_ID),
      calibrationId: Scratch.Cast.toString(args.CALIBRATION_ID),
      board: {
        columns: Scratch.Cast.toNumber(args.COLUMNS),
        rows: Scratch.Cast.toNumber(args.ROWS),
        squareSizeMeters: Scratch.Cast.toNumber(args.SQUARE_METERS),
      },
      maximumReprojectionErrorPx: Scratch.Cast.toNumber(args.MAX_ERROR_PX),
    });
  }

  public async addCameraCalibrationSample(): Promise<void> {
    this.requireCalibrationEnabled();
    await this.calibration.addSample();
  }

  public async solveCameraCalibration(): Promise<void> {
    this.requireCalibrationEnabled();
    await this.calibration.solve();
  }

  public async cancelCameraCalibration(): Promise<void> {
    await this.calibration.cancel();
  }

  public async cleanupCameraCalibration(): Promise<void> {
    await this.calibration.cleanup();
  }

  public async importCameraCalibration(args: { JSON: unknown }): Promise<void> {
    if (this.calibrationDelegated) {
      this.requireCalibrationDelegate().importProfile(
        Scratch.Cast.toString(args.JSON),
      );
      return;
    }
    this.requireCalibrationEnabled();
    await this.calibration.importProfile(Scratch.Cast.toString(args.JSON));
  }

  public cameraCalibrationJsonValid(args: { JSON: unknown }): boolean {
    if (this.calibrationDelegated) {
      return this.requireCalibrationDelegate().validateProfile(
        Scratch.Cast.toString(args.JSON),
      );
    }
    this.requireCalibrationEnabled();
    return this.calibration.validateProfile(Scratch.Cast.toString(args.JSON));
  }

  public cameraCalibrationReady(): boolean {
    if (this.calibrationDelegated)
      return this.requireCalibrationDelegate().ready();
    return this.calibrationEnabled && this.calibration.ready();
  }

  public cameraCalibrationState(): string {
    return this.calibrationEnabled ? this.calibration.state() : "disabled";
  }

  public cameraCalibrationBackend(): string {
    return this.calibrationEnabled ? this.calibration.backend() : "disabled";
  }

  public cameraCalibrationSampleCount(): number {
    return this.calibration.sampleCount();
  }

  public cameraCalibrationSampleQuality(): number {
    return this.calibration.latestSampleQuality();
  }

  public cameraCalibrationReprojectionError(): number {
    return this.calibration.latestReprojectionError();
  }

  public cameraCalibrationErrorCode(): string {
    return this.calibration.errorCode();
  }

  public cameraCalibrationError(): string {
    return this.calibration.errorMessage();
  }

  public cameraCalibrationJson(): string {
    if (this.calibrationDelegated)
      return this.requireCalibrationDelegate().profileJson();
    return this.calibration.profileJson();
  }

  public registerAvatarAsset(args: {
    ASSET_ID: unknown;
    TEMPLATE_JSON: unknown;
    RIG_JSON: unknown;
  }): void {
    this.requireAvatarEnabled();
    this.avatar.registerAsset(
      Scratch.Cast.toString(args.ASSET_ID),
      Scratch.Cast.toString(args.TEMPLATE_JSON),
      Scratch.Cast.toString(args.RIG_JSON),
    );
  }

  public bindAvatarPerson(args: {
    PERSON_ID: unknown;
    INSTANCE_ID: unknown;
    ASSET_ID: unknown;
    PARENT: unknown;
    CONFIDENCE: unknown;
  }): void {
    this.requireAvatarEnabled();
    this.avatar.bind(
      Scratch.Cast.toString(args.PERSON_ID),
      Scratch.Cast.toString(args.INSTANCE_ID),
      Scratch.Cast.toString(args.ASSET_ID),
      Scratch.Cast.toString(args.PARENT),
      Scratch.Cast.toNumber(args.CONFIDENCE),
    );
  }

  public unbindAvatarPerson(args: { PERSON_ID: unknown }): void {
    this.requireAvatarEnabled();
    this.avatar.unbind(Scratch.Cast.toString(args.PERSON_ID));
  }

  public applyPoseFrame3DToAvatars(args: {
    POSE3D_JSON: unknown;
    POSE2D_JSON: unknown;
  }): void {
    this.requireAvatarEnabled();
    this.avatar.apply(
      Scratch.Cast.toString(args.POSE3D_JSON),
      Scratch.Cast.toString(args.POSE2D_JSON),
    );
  }

  public resetAvatarRetarget(): void {
    this.avatar.reset();
  }

  public avatarBindingCount(): number {
    return this.avatarEnabled ? this.avatar.bindingCount() : 0;
  }

  public avatarUpdatedCount(): number {
    return this.avatarEnabled ? this.avatar.updatedCount() : 0;
  }

  public avatarRetargetState(): string {
    return this.avatarEnabled ? this.avatar.state() : "disabled";
  }

  public avatarRetargetError(): string {
    return this.avatar.error();
  }

  public acknowledgeFrameSyncFlashing(): void {
    this.requireDelegate().acknowledgeFlashing(Date.now() * 1000);
  }

  public setFrameSyncDisplayRefresh(args: { REFRESH_US: unknown }): void {
    this.requireDelegate().setDisplayRefreshUs(
      Scratch.Cast.toNumber(args.REFRESH_US),
    );
  }

  public showFrameSyncPattern(): void {
    if (this.timeSpaceSyncDelegated) {
      this.requireDelegate().showPattern();
      return;
    }
    this.requireFrameSyncEnabled();
    this.requireFrameSyncDisplay().show();
  }

  public hideFrameSyncPattern(): void {
    if (this.timeSpaceSyncDelegated) {
      this.requireDelegate().hidePattern();
      return;
    }
    this.requireFrameSyncEnabled();
    this.frameSyncOverlay?.hide();
  }

  public frameSyncPatternShown(): boolean {
    if (this.timeSpaceSyncDelegated)
      return this.requireDelegate().patternShown();
    return this.frameSyncOverlay?.visible() ?? false;
  }

  public frameSyncPatternWrapUs(): number {
    if (this.timeSpaceSyncDelegated)
      return this.requireDelegate().patternWrapUs();
    return PATTERN_WRAP_US;
  }

  public async startFrameSyncDecoder(args: {
    CAMERA_ID: unknown;
    SECONDS: unknown;
  }): Promise<void> {
    if (this.timeSpaceSyncDelegated) {
      await this.requireDelegate().start(
        Scratch.Cast.toString(args.CAMERA_ID),
        Scratch.Cast.toNumber(args.SECONDS),
      );
      return;
    }
    this.requireFrameSyncEnabled();
    await this.requireFrameSyncController().start({
      cameraId: Scratch.Cast.toString(args.CAMERA_ID),
      calibrationSeconds: Scratch.Cast.toNumber(args.SECONDS),
    });
  }

  public async calibrateFrameSyncDecoder(args: {
    SECONDS: unknown;
  }): Promise<void> {
    if (this.timeSpaceSyncDelegated) {
      await this.requireDelegate().recalibrate(
        Scratch.Cast.toNumber(args.SECONDS),
      );
      return;
    }
    this.requireFrameSyncEnabled();
    await this.requireFrameSyncController().recalibrate(
      Scratch.Cast.toNumber(args.SECONDS),
    );
  }

  public async stopFrameSyncDecoder(): Promise<void> {
    if (this.timeSpaceSyncDelegated) {
      await this.requireDelegate().stop();
      return;
    }
    await this.frameSync?.stop();
  }

  public frameSyncDecoderState(): string {
    if (this.timeSpaceSyncDelegated) return this.requireDelegate().state();
    return this.frameSync?.state() ?? "idle";
  }

  public frameSyncDecoderError(): string {
    if (this.timeSpaceSyncDelegated) return this.requireDelegate().errorCode();
    return this.frameSync?.errorCode() ?? "";
  }

  public frameSyncDecodeRate(): number {
    if (this.timeSpaceSyncDelegated) return 0;
    return this.frameSync?.decodeRate() ?? 0;
  }

  public frameSyncObservationAvailable(): boolean {
    if (this.timeSpaceSyncDelegated) {
      return this.requireDelegate().observationAvailable();
    }
    return (this.frameSync?.pendingObservations() ?? 0) > 0;
  }

  public takeFrameSyncObservation(): void {
    if (this.timeSpaceSyncDelegated) {
      this.requireDelegate().takeObservation();
      return;
    }
    this.requireFrameSyncEnabled();
    this.requireFrameSyncController().takeObservation();
  }

  public frameSyncFrameTimestampUs(): number {
    if (this.timeSpaceSyncDelegated)
      return this.requireDelegate().frameTimestampUs();
    return this.frameSync?.currentObservation()?.frameTimestampUs ?? 0;
  }

  public frameSyncFrameAgeUs(): number {
    if (this.timeSpaceSyncDelegated) return this.requireDelegate().frameAgeUs();
    return this.frameSync?.currentObservation()?.frameAgeUs ?? 0;
  }

  public frameSyncPatternTimestampUs(): number {
    if (this.timeSpaceSyncDelegated)
      return this.requireDelegate().patternTimestampUs();
    return this.frameSync?.currentObservation()?.patternTimestampUs ?? 0;
  }

  /**
   * The adapter, built once the path has actually been handed over.
   *
   * Never built otherwise: the flags forbid both paths at once, and an adapter
   * sitting ready beside a running local decoder is the second half of the
   * double capture they exist to prevent.
   */
  private requireDelegate(): FrameSyncDelegate {
    if (!this.timeSpaceSyncDelegated) {
      throw new Error(
        "The optical time path has not been delegated. Turn on timeSpaceSyncDelegateV1 before the project starts.",
      );
    }
    if (!this.frameSyncDelegate) {
      this.frameSyncDelegate = new FrameSyncDelegate({ runtime: this.runtime });
    }
    return this.frameSyncDelegate;
  }

  /**
   * The profile adapter, built once the registry has been handed over.
   *
   * Never built otherwise: the flags forbid both paths at once, and a second
   * store of the same profiles is what makes two extensions disagree about a
   * camera.
   */
  private requireCalibrationDelegate(): CalibrationProfileDelegate {
    if (!this.calibrationDelegated) {
      throw new Error(
        "Calibration profiles have not been delegated. Turn on cameraCalibrationDelegateV1 before the project starts.",
      );
    }
    if (!this.calibrationDelegate) {
      this.calibrationDelegate = new CalibrationProfileDelegate({
        runtime: this.runtime,
      });
    }
    return this.calibrationDelegate;
  }

  private requireFrameSyncEnabled(): void {
    if (this.frameSyncEnabled) return;
    // Reached only when neither path is on: every frame sync opcode routes to
    // the adapter before getting here while the path is delegated.
    throw new Error(
      "Frame sync pattern v1 is disabled. Enable it before the project starts.",
    );
  }

  private requireFrameSyncDisplay(): PatternDisplayPort {
    if (!this.frameSyncOverlay) {
      this.frameSyncOverlay = new FrameSyncPatternDisplay({
        timeSource: requireSynchronizedTimeSource(this.runtime),
      });
    }
    return this.frameSyncOverlay;
  }

  private requireFrameSyncController(): FrameSyncPatternController {
    if (!this.frameSync) {
      this.frameSync = new FrameSyncPatternController({
        runtime: this.runtime,
        timeSource: requireSynchronizedTimeSource(this.runtime),
        analysisWidth: FRAME_SYNC_ANALYSIS_WIDTH,
        analysisHeight: FRAME_SYNC_ANALYSIS_HEIGHT,
        createFramePump: (lease) =>
          new VideoFramePump(
            lease.getFrameSource().element,
            FRAME_SYNC_ANALYSIS_WIDTH,
            FRAME_SYNC_ANALYSIS_HEIGHT,
          ),
      });
    }
    return this.frameSync;
  }

  public startPoseFusion(args: {
    DELAY_MS: unknown;
    JITTER_MS: unknown;
    MIN_SCORE: unknown;
  }): void {
    this.requireFusionEnabled();
    this.fusion.start({
      delayMilliseconds: Scratch.Cast.toNumber(args.DELAY_MS),
      jitterMilliseconds: Scratch.Cast.toNumber(args.JITTER_MS),
      minKeypointScore: Scratch.Cast.toNumber(args.MIN_SCORE),
    });
  }

  public stopPoseFusion(): void {
    this.fusion.stop();
  }

  public cleanupPoseFusion(): void {
    this.fusion.cleanup();
  }

  public loadFusionCameraCalibration(args: { JSON: unknown }): void {
    this.requireFusionEnabled();
    this.fusion.loadCalibration(Scratch.Cast.toString(args.JSON));
  }

  public bufferPoseFrame2D(args: { JSON: unknown }): void {
    this.requireFusionEnabled();
    this.fusion.ingestFrame(Scratch.Cast.toString(args.JSON));
  }

  public fuseBufferedPoseFrame3D(): void {
    this.requireFusionEnabled();
    this.fusion.fuseBufferedInstant();
  }

  public fusePoseFrame3DAt(args: { TIMESTAMP_US: unknown }): void {
    this.requireFusionEnabled();
    this.fusion.fuseAt(Scratch.Cast.toNumber(args.TIMESTAMP_US));
  }

  public latestPoseFrame3D(): string {
    return this.fusionEnabled ? this.fusion.latestFrameJson() : "";
  }

  public synchronizedPoseSet2D(): string {
    return this.fusionEnabled ? this.fusion.synchronizedSampleJson() : "";
  }

  public poseFusionState(): string {
    return this.fusionEnabled ? this.fusion.state() : "disabled";
  }

  public poseFusionReady(): boolean {
    return this.fusionEnabled && this.fusion.ready();
  }

  public poseFusionCameraCount(): number {
    return this.fusion.cameraCount();
  }

  public poseFusionBufferedFrameCount(): number {
    return this.fusion.bufferedFrameCount();
  }

  public poseFusionDroppedFrameCount(): number {
    return this.fusion.droppedFrameCount();
  }

  public poseFusionPersonCount(): number {
    return this.fusion.personCount();
  }

  public poseFusionTimestampUs(): number {
    return this.fusion.fusedTimestampUs();
  }

  public poseFusionReprojectionErrorPx(): number {
    return this.fusion.meanReprojectionErrorPx();
  }

  public poseFusionErrorCode(): string {
    return this.fusion.errorCode();
  }

  public poseFusionError(): string {
    return this.fusion.errorMessage();
  }

  public enableGlowStickMarkers(args: { KEYPOINTS: unknown }): void {
    this.requireMarkersEnabled();
    this.requirePoseEnabled();
    this.pose.enableMarkers(
      parseKeypointIds(Scratch.Cast.toString(args.KEYPOINTS)),
    );
  }

  public disableGlowStickMarkers(): void {
    this.pose.disableMarkers();
  }

  public glowStickMarkerCount(): number {
    return this.markersEnabled ? this.pose.markerCount() : 0;
  }

  public loadGlowStickPalette(args: { JSON: unknown }): void {
    this.requireMarkersEnabled();
    this.requireFusionEnabled();
    this.fusion.loadPerformanceDsl(Scratch.Cast.toString(args.JSON));
  }

  public setPerformerGlowStick(args: {
    PERFORMER_ID: unknown;
    KEYPOINT: unknown;
  }): void {
    this.requireMarkersEnabled();
    this.requireFusionEnabled();
    this.fusion.setPerformerKeypoint(
      Scratch.Cast.toString(args.PERFORMER_ID).trim(),
      Scratch.Cast.toString(args.KEYPOINT).trim(),
    );
  }

  public glowStickPaletteSize(): number {
    return this.markersEnabled ? this.fusion.paletteSize() : 0;
  }

  public identifiedPerformerCount(): number {
    return this.markersEnabled ? this.fusion.identifiedPerformerCount() : 0;
  }

  public mirrorCorrectedViewCount(): number {
    return this.markersEnabled ? this.fusion.mirrorCorrectedViewCount() : 0;
  }

  public dispose(): void {
    this.endOfferQrDisplay();
    void this.pose.stop();
    void this.calibration.cancel();
    this.avatar.reset();
    void this.frameSync?.stop();
    this.frameSyncOverlay?.hide();
    this.fusion.stop();
    this.runtime.off?.("PROJECT_STOP_ALL", this.stopListener);
    this.runtime.off?.("PROJECT_RUN_STOP", this.runStopListener);
    this.runtime.off?.("PROJECT_LOADED", this.stopListener);
    this.runtime.off?.("RUNTIME_DISPOSED", this.disposeListener);
    this.runtime.off?.("targetWasRemoved", this.targetRemovedListener);
  }

  private requireEnabled(): void {
    if (!this.enabled) {
      throw new Error(
        "QR courier pairing is disabled. Enable it before the project starts.",
      );
    }
  }

  private requirePoseEnabled(): void {
    if (!this.poseEnabled) {
      throw new Error(
        "WebGPU MoveNet MultiPose is disabled. Enable it before the project starts.",
      );
    }
  }

  private requireProtocolEnabled(): void {
    if (!this.protocolEnabled) {
      throw new Error(
        "Protocol v1 codec is disabled. Enable it before the project starts.",
      );
    }
  }

  private requireMarkersEnabled(): void {
    if (!this.markersEnabled) {
      throw new Error(
        "Glow stick markers are disabled. Enable them before the project starts.",
      );
    }
  }

  private requireFusionEnabled(): void {
    if (!this.fusionEnabled) {
      throw new Error(
        "Pose fusion 3D is disabled. Enable it before the project starts.",
      );
    }
  }

  private requireCalibrationEnabled(): void {
    if (!this.calibrationEnabled) {
      throw new Error(
        "Camera calibration v1 is disabled. Enable it before the project starts.",
      );
    }
  }

  private requireAvatarEnabled(): void {
    if (!this.avatarEnabled) {
      throw new Error(
        "Avatar retarget v1 is disabled. Enable it before the project starts.",
      );
    }
  }

  private blockEnabled(feature: BlockDefinition["feature"]): boolean {
    if (feature === "qrCourierPairing") return this.enabled;
    if (feature === "webgpuMoveNetMultiPose") return this.poseEnabled;
    if (feature === "protocolV1Codec") return this.protocolEnabled;
    // The old opcodes stay in the palette while profiles are delegated: they
    // are what an existing project calls.
    if (feature === "cameraCalibrationV1") {
      return this.calibrationEnabled || this.calibrationDelegated;
    }
    if (feature === "avatarRetargetV1") return this.avatarEnabled;
    // The old opcodes stay in the palette while the path is delegated: they
    // are what an existing project calls, and answering them is the point of
    // the adapter.
    if (feature === "frameSyncPatternV1") {
      return this.frameSyncEnabled || this.timeSpaceSyncDelegated;
    }
    if (feature === "timeSpaceSyncDelegateV1")
      return this.timeSpaceSyncDelegated;
    if (feature === "poseFusion3D") return this.fusionEnabled;
    return this.markersEnabled;
  }

  private requireSession(): OfferQrSession {
    if (!this.session)
      throw new Error("Prepare an offer QR before displaying a part.");
    return this.session;
  }

  private clearPreparedSession(): void {
    this.skins.releaseAll();
    if (this.session) {
      this.session.texts.fill("");
      this.session.svgs.fill("");
      this.session = undefined;
    }
  }

  private toScratchBlock(block: BlockDefinition): Record<string, unknown> {
    return {
      opcode: block.opcode,
      blockType: Scratch.BlockType[block.blockType],
      text: Scratch.translate(block.text),
      arguments: Object.fromEntries(
        Object.entries(block.arguments).map(([name, argument]) => [
          name,
          {
            type: Scratch.ArgumentType[argument.type],
            defaultValue: argument.defaultValue,
          },
        ]),
      ),
    };
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isTarget(value: unknown): value is TurboWarpTarget {
  return typeof value === "object" && value !== null;
}
