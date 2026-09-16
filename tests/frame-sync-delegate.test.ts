import { describe, expect, it, vi } from "vitest";
import {
  FrameSyncDelegate,
  LEGACY_REFERENCE_ID,
} from "../src/frame-sync/delegate.js";
import { runtimeCapabilityKey } from "@kubohiroya/turbowarp-time-space-sync/runtime";
import type {
  OpticalTimeObservation,
  TimeSpaceSyncCapabilityV1,
} from "@kubohiroya/turbowarp-time-space-sync/runtime";

const profile = {
  id: "twtss.pattern.v1",
  columns: 4,
  rows: 4,
  dataBits: 12,
  checkBits: 4,
  stepUs: 1000,
  encoding: "absolute",
  sampling: "grid",
  fiducials: [],
} as const;

function observation(
  patch: Partial<OpticalTimeObservation> = {},
): OpticalTimeObservation {
  return {
    schema: "twtss/optical-time-observation",
    version: 1,
    cameraId: "camera-left",
    referenceId: LEGACY_REFERENCE_ID,
    patternProfileId: profile.id,
    observerDomain: {
      id: "local:test",
      kind: "local-monotonic",
      epoch: 0,
      uncertaintyUs: 0,
    },
    displayDomain: null,
    deliveredAtUs: 1_737_000_000_050_000,
    monotonicAtUs: 500_000,
    captureTimeUs: 1_737_000_000_012_000,
    captureTimeKind: "capture",
    patternCodeTimestampUs: 1_234_000,
    wrapUs: 4_096_000,
    stepUs: 1000,
    displayRefreshUs: 16_667,
    refreshUncertaintyUs: 120,
    constraintLoUs: 1_737_000_000_012_000,
    constraintHiUs: 1_737_000_000_050_000,
    decodeMargin: 40,
    panel: { x: 1, y: 1, width: 10, height: 10 },
    imageWidth: 240,
    imageHeight: 180,
    captureConditions: {},
    sequence: 1,
    ...patch,
  } as OpticalTimeObservation;
}

function capability(
  overrides: Partial<TimeSpaceSyncCapabilityV1> = {},
): TimeSpaceSyncCapabilityV1 {
  const base = {
    version: 1,
    requireVersion: (version: number) => {
      if (version !== 1) throw new Error(`Unsupported version ${version}.`);
      return base;
    },
    patternProfile: () => profile,
    showPattern: vi.fn(),
    hidePattern: vi.fn(),
    patternShown: () => false,
    patternRefreshUs: () => 16_667,
    startDecoder: vi.fn(async () => undefined),
    stopDecoder: vi.fn(async () => undefined),
    decoderState: () => "idle" as const,
    decoderError: () => "" as const,
    takeObservation: () => undefined,
    drainObservations: () => [],
    ...overrides,
  } as unknown as TimeSpaceSyncCapabilityV1;
  return base;
}

function delegate(overrides: Partial<TimeSpaceSyncCapabilityV1> = {}) {
  return new FrameSyncDelegate({
    runtime: {} as TurboWarpRuntime,
    capability: capability(overrides),
  });
}

describe("finding the extension", () => {
  it("says which extension is missing rather than failing later", () => {
    const bare = new FrameSyncDelegate({ runtime: {} as TurboWarpRuntime });
    expect(() => bare.capability()).toThrowError(/is not loaded/);
  });

  it("refuses a capability version it was not written against", () => {
    const runtime = {
      [runtimeCapabilityKey]: {
        requireVersion: (version: number) => {
          throw new Error(`Unsupported version ${version}.`);
        },
      },
    } as unknown as TurboWarpRuntime;
    expect(() => new FrameSyncDelegate({ runtime }).capability()).toThrowError(
      /Unsupported version/,
    );
  });

  it("does not quietly fall back to the path here", () => {
    // Running it would be the double capture the flags exist to prevent.
    const bare = new FrameSyncDelegate({ runtime: {} as TurboWarpRuntime });
    expect(() => bare.showPattern()).toThrow();
  });
});

describe("showing the pattern", () => {
  it("will not show it before the flashing is acknowledged", () => {
    // The old opcode asked for nothing because the path it drove asked for
    // nothing. Manufacturing an acknowledgement so it keeps working would
    // defeat the only thing between an operator and a screen of flashing.
    const subject = delegate();
    expect(() => subject.showPattern()).toThrowError(/acknowledge/);
  });

  it("shows it once the operator has acknowledged", () => {
    const shown = vi.fn();
    const subject = delegate({ showPattern: shown });
    subject.acknowledgeFlashing(1_737_000_000_000_000);
    subject.showPattern();
    expect(shown).toHaveBeenCalledWith({
      acknowledgedByOperator: true,
      acknowledgedAtUs: 1_737_000_000_000_000,
    });
  });

  it("reports the wrap period from the profile in use", () => {
    expect(delegate().patternWrapUs()).toBe(4_096_000);
  });
});

describe("starting the decoder", () => {
  it("passes the refresh the display measured here", async () => {
    const startDecoder = vi.fn(async () => undefined);
    const subject = delegate({ startDecoder });
    await subject.start("camera-left", 8);
    expect(startDecoder).toHaveBeenCalledWith(
      expect.objectContaining({
        cameraId: "camera-left",
        referenceId: LEGACY_REFERENCE_ID,
        calibrationSeconds: 8,
        displayRefreshUs: 16_667,
      }),
    );
  });

  it("refuses to guess the refresh of a display on another computer", async () => {
    // It sets the whole width of the constraint an observation carries, so
    // assuming 60 Hz for a projector running at 50 biases every result with
    // nothing in the output saying so.
    const subject = delegate({ patternRefreshUs: () => undefined });
    await expect(subject.start("camera-left", 8)).rejects.toThrow(
      /refresh interval is not known/,
    );
  });

  it("takes the refresh when it is supplied for a remote display", async () => {
    const startDecoder = vi.fn(async () => undefined);
    const subject = delegate({
      patternRefreshUs: () => undefined,
      startDecoder,
    });
    subject.setDisplayRefreshUs(20_000);
    await subject.start("camera-left", 8);
    expect(startDecoder).toHaveBeenCalledWith(
      expect.objectContaining({ displayRefreshUs: 20_000 }),
    );
  });

  it("ignores a refresh that cannot be one", async () => {
    const subject = delegate({ patternRefreshUs: () => undefined });
    subject.setDisplayRefreshUs(0);
    await expect(subject.start("camera-left", 8)).rejects.toThrow();
  });
});

describe("the error vocabulary the old opcodes published", () => {
  it("narrows a code the old blocks never had to one they did", () => {
    // A project reads this against a literal, so a code it has never seen
    // reads to it as "no error I know about".
    const subject = delegate({ decoderError: () => "ambiguous-panel" });
    expect(subject.errorCode()).toBe("panel-not-found");
  });

  it("passes a code the old blocks already published straight through", () => {
    expect(delegate({ decoderError: () => "low-contrast" }).errorCode()).toBe(
      "low-contrast",
    );
  });

  it("reports no error as no error", () => {
    expect(delegate().errorCode()).toBe("");
  });

  it("stays quiet when the extension is not loaded", () => {
    // Reporters must not throw: one that does stops the script that read it.
    const bare = new FrameSyncDelegate({ runtime: {} as TurboWarpRuntime });
    expect(bare.errorCode()).toBe("");
    expect(bare.state()).toBe("idle");
    expect(bare.patternShown()).toBe(false);
  });
});

describe("taking an observation", () => {
  it("does not throw a reading away by asking whether one is waiting", () => {
    // The capability hands over the oldest reading and cannot be asked how many
    // there are, so asking has to take one and hold it.
    const entry = observation();
    const takeObservation = vi.fn(() => entry);
    const subject = delegate({ takeObservation });
    expect(subject.observationAvailable()).toBe(true);
    subject.takeObservation();
    expect(takeObservation).toHaveBeenCalledTimes(1);
    expect(subject.patternTimestampUs()).toBe(entry.patternCodeTimestampUs);
  });

  it("maps the taken reading onto what the old reporters published", () => {
    const subject = delegate({ takeObservation: () => observation() });
    subject.takeObservation();
    expect(subject.frameTimestampUs()).toBe(1_737_000_000_050_000);
    expect(subject.frameAgeUs()).toBe(38_000);
    expect(subject.patternTimestampUs()).toBe(1_234_000);
  });

  it("reports zero age when the browser reported no capture time", () => {
    // What the old opcode did, and what projects reading it expect. It is not a
    // measurement of no latency, and there is nowhere in the old surface to say
    // so; the new blocks report it properly.
    const vague = observation({ captureTimeKind: "none" });
    delete (vague as { captureTimeUs?: number }).captureTimeUs;
    const subject = delegate({ takeObservation: () => vague });
    subject.takeObservation();
    expect(subject.frameAgeUs()).toBe(0);
  });

  it("has nothing to report before one is taken", () => {
    const subject = delegate();
    expect(subject.frameTimestampUs()).toBe(0);
    expect(subject.observationAvailable()).toBe(false);
  });

  it("drops the held reading when the decoder stops", async () => {
    const subject = delegate({ takeObservation: () => observation() });
    expect(subject.observationAvailable()).toBe(true);
    await subject.stop();
    expect(subject.frameTimestampUs()).toBe(0);
  });
});
