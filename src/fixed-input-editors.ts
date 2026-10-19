import { parseFixedNumberInput } from "@kubohiroya/turbowarp-extension-data-editor";
import type {
  FixedInputBinding,
  FixedInputEditorOptions,
  FixedBlockSnapshot,
  JsonValue,
  LiteralValue,
} from "@kubohiroya/turbowarp-extension-data-editor";
import { fixedInputBundle } from "./fixed-input-schema.js";

const invalid = () => [{ message: "Invalid fixed input." }];
function number(value: JsonValue | LiteralValue): number {
  if (
    (typeof value !== "number" && typeof value !== "string") ||
    (typeof value === "string" && value.trim() === "")
  )
    throw new TypeError("Unrepresentable numeric literal.");
  const result = Number(value);
  if (!Number.isFinite(result))
    throw new TypeError("Nonfinite numeric literal.");
  return result;
}
function numericBinding(opcode: string, argument: string): FixedInputBinding {
  return {
    argument,
    schemaBundle: fixedInputBundle(opcode, argument),
    control: { label: argument, kind: "number" },
    read: number,
    encode(value) {
      const parsed = parseFixedNumberInput(value);
      if (parsed.kind !== "valid")
        throw new TypeError("Invalid numeric token.");
      return parsed.token;
    },
    validateCandidate(candidate, _context, finalSnapshot) {
      try {
        number(candidate);
        return ownerCheck(opcode, argument, candidate, finalSnapshot)
          ? []
          : invalid();
      } catch {
        return invalid();
      }
    },
  };
}
function enumBinding(
  opcode: string,
  argument: string,
  choices: readonly string[],
  normalization: "none" | "trim" | "trim-lower",
): FixedInputBinding {
  const project = (value: JsonValue | LiteralValue) => {
    if (typeof value !== "string") return value;
    const normalized =
      normalization === "none"
        ? value
        : normalization === "trim"
          ? value.trim()
          : value.trim().toLowerCase();
    return choices.includes(normalized) ? normalized : value;
  };
  return {
    argument,
    schemaBundle: fixedInputBundle(opcode, argument),
    control: {
      label: argument,
      kind: "enum",
      choices: choices.map((value) => ({ value })),
    },
    read: project,
    encode(value) {
      if (typeof value !== "string" || !choices.includes(value))
        throw new TypeError("Choose a known value.");
      return value;
    },
    validateCandidate(candidate, _context, finalSnapshot) {
      try {
        return typeof candidate === "string" &&
          choices.includes(candidate) &&
          ownerCheck(opcode, argument, candidate, finalSnapshot)
          ? []
          : invalid();
      } catch {
        return invalid();
      }
    },
  };
}
// Per-field schema constraints are checked by the common prepared engine against the exact candidate.
// Clamp/fallback and device/session prerequisites remain runtime behavior, never editor providers.
function ownerCheck(
  _opcode: string,
  _argument: string,
  _candidate: LiteralValue,
  _snapshot: FixedBlockSnapshot,
): boolean {
  void [_opcode, _argument, _candidate, _snapshot];
  return true;
}

const extensionId = "kubohiroyarealtimemotioncapture";
const validationContext = () => ({
  consumerId: "turbowarp-realtime-motion-capture",
  nowMs: 0,
  settings: null,
});
export const fixedInputEditors: readonly FixedInputEditorOptions[] = [
  {
    apiVersion: 1,
    extensionId,
    editorId: "showOfferQrPart-fixed",
    opcodes: [`${extensionId}_showOfferQrPart`],
    contractId: "turbowarp-realtime-motion-capture/showOfferQrPart",
    contractRevision: "1",
    validationContext,
    readOnlyArguments: [],
    bindings: [numericBinding("showOfferQrPart", "INDEX")],
  },
  {
    apiVersion: 1,
    extensionId,
    editorId: "inferNextPoseFrame-fixed",
    opcodes: [`${extensionId}_inferNextPoseFrame`],
    contractId: "turbowarp-realtime-motion-capture/inferNextPoseFrame",
    contractRevision: "1",
    validationContext,
    readOnlyArguments: [],
    bindings: [numericBinding("inferNextPoseFrame", "CAPTURE_TIMESTAMP_US")],
  },
  {
    apiVersion: 1,
    extensionId,
    editorId: "startCameraCalibration-fixed",
    opcodes: [`${extensionId}_startCameraCalibration`],
    contractId: "turbowarp-realtime-motion-capture/startCameraCalibration",
    contractRevision: "1",
    validationContext,
    readOnlyArguments: [],
    bindings: [
      numericBinding("startCameraCalibration", "COLUMNS"),
      numericBinding("startCameraCalibration", "ROWS"),
      numericBinding("startCameraCalibration", "SQUARE_METERS"),
      numericBinding("startCameraCalibration", "MAX_ERROR_PX"),
    ],
  },
  {
    apiVersion: 1,
    extensionId,
    editorId: "bindAvatarPerson-fixed",
    opcodes: [`${extensionId}_bindAvatarPerson`],
    contractId: "turbowarp-realtime-motion-capture/bindAvatarPerson",
    contractRevision: "1",
    validationContext,
    readOnlyArguments: [],
    bindings: [numericBinding("bindAvatarPerson", "CONFIDENCE")],
  },
  {
    apiVersion: 1,
    extensionId,
    editorId: "setAvatarExpression-fixed",
    opcodes: [`${extensionId}_setAvatarExpression`],
    contractId: "turbowarp-realtime-motion-capture/setAvatarExpression",
    contractRevision: "1",
    validationContext,
    readOnlyArguments: [],
    bindings: [numericBinding("setAvatarExpression", "WEIGHT")],
  },
  {
    apiVersion: 1,
    extensionId,
    editorId: "startFrameSyncDecoder-fixed",
    opcodes: [`${extensionId}_startFrameSyncDecoder`],
    contractId: "turbowarp-realtime-motion-capture/startFrameSyncDecoder",
    contractRevision: "1",
    validationContext,
    readOnlyArguments: [],
    bindings: [numericBinding("startFrameSyncDecoder", "SECONDS")],
  },
  {
    apiVersion: 1,
    extensionId,
    editorId: "calibrateFrameSyncDecoder-fixed",
    opcodes: [`${extensionId}_calibrateFrameSyncDecoder`],
    contractId: "turbowarp-realtime-motion-capture/calibrateFrameSyncDecoder",
    contractRevision: "1",
    validationContext,
    readOnlyArguments: [],
    bindings: [numericBinding("calibrateFrameSyncDecoder", "SECONDS")],
  },
  {
    apiVersion: 1,
    extensionId,
    editorId: "setFrameSyncDisplayRefresh-fixed",
    opcodes: [`${extensionId}_setFrameSyncDisplayRefresh`],
    contractId: "turbowarp-realtime-motion-capture/setFrameSyncDisplayRefresh",
    contractRevision: "1",
    validationContext,
    readOnlyArguments: [],
    bindings: [numericBinding("setFrameSyncDisplayRefresh", "REFRESH_US")],
  },
  {
    apiVersion: 1,
    extensionId,
    editorId: "startPoseFusion-fixed",
    opcodes: [`${extensionId}_startPoseFusion`],
    contractId: "turbowarp-realtime-motion-capture/startPoseFusion",
    contractRevision: "1",
    validationContext,
    readOnlyArguments: [],
    bindings: [
      numericBinding("startPoseFusion", "DELAY_MS"),
      numericBinding("startPoseFusion", "JITTER_MS"),
      numericBinding("startPoseFusion", "MIN_SCORE"),
    ],
  },
  {
    apiVersion: 1,
    extensionId,
    editorId: "fusePoseFrame3DAt-fixed",
    opcodes: [`${extensionId}_fusePoseFrame3DAt`],
    contractId: "turbowarp-realtime-motion-capture/fusePoseFrame3DAt",
    contractRevision: "1",
    validationContext,
    readOnlyArguments: [],
    bindings: [numericBinding("fusePoseFrame3DAt", "TIMESTAMP_US")],
  },
  {
    apiVersion: 1,
    extensionId,
    editorId: "setPerformerGlowStick-fixed",
    opcodes: [`${extensionId}_setPerformerGlowStick`],
    contractId: "turbowarp-realtime-motion-capture/setPerformerGlowStick",
    contractRevision: "1",
    validationContext,
    readOnlyArguments: [],
    bindings: [
      enumBinding(
        "setPerformerGlowStick",
        "KEYPOINT",
        [
          "nose",
          "left_eye",
          "right_eye",
          "left_ear",
          "right_ear",
          "left_shoulder",
          "right_shoulder",
          "left_elbow",
          "right_elbow",
          "left_wrist",
          "right_wrist",
          "left_hip",
          "right_hip",
          "left_knee",
          "right_knee",
          "left_ankle",
          "right_ankle",
        ],
        "trim",
      ),
    ],
  },
];

interface RuntimeLifetime {
  on?: (event: string, listener: () => void) => void;
  off?: (event: string, listener: () => void) => void;
}

/** Register metadata only; the GUI startup capability owns editor activation. */
export function registerFixedInputEditors(
  scratch: unknown,
  definitions: readonly FixedInputEditorOptions[],
  runtimeOverride?: RuntimeLifetime,
): () => void {
  const host = scratch as {
    gui?: {
      blockEditors?: {
        apiVersion?: number;
        registerFixedInputEditor?: (
          options: FixedInputEditorOptions,
        ) => () => void;
      };
    };
    vm?: { runtime?: RuntimeLifetime };
  };
  const api = host.gui?.blockEditors;
  if (
    !definitions.length ||
    api?.apiVersion !== 1 ||
    typeof api.registerFixedInputEditor !== "function"
  )
    return () => {};
  const runtime = runtimeOverride ?? host.vm?.runtime;
  const removers: (() => void)[] = [];
  let active = true;
  const dispose = () => {
    if (!active) return;
    active = false;
    runtime?.off?.("RUNTIME_DISPOSED", dispose);
    for (const remove of removers.splice(0).reverse()) remove();
  };
  try {
    for (const definition of definitions) {
      const remove = api.registerFixedInputEditor.call(api, definition);
      if (typeof remove !== "function")
        throw new TypeError("Invalid fixed input registration disposer.");
      removers.push(remove);
    }
    runtime?.on?.("RUNTIME_DISPOSED", dispose);
  } catch (error) {
    dispose();
    throw error;
  }
  return dispose;
}
