import type {
  SourceBinding,
  SourceEditorOptions,
  SourceValidation,
} from "@kubohiroya/turbowarp-extension-data-editor/schema";
import { extensionConfig } from "./config.js";

function checkedSource(value: {
  source: string;
  result: {
    kind: "valid" | "invalid" | "execution-error" | "schema-error";
    diagnostics: readonly { code: string; dataPath?: string }[];
  };
}): SourceValidation {
  return value.result.kind === "valid"
    ? { source: value.source, result: { kind: "valid", diagnostics: [] } }
    : {
        source: value.source,
        result: {
          kind: value.result.kind,
          diagnostics: value.result.diagnostics,
        },
      };
}
import {
  motionSchemaBundles,
  decodeMotionSource,
  validateMotionSource,
  avatarRigSchemaBundle,
  decodeAvatarRigSource,
  validateAvatarRigSource,
} from "./editor-schema.js";
import type {
  MotionInputConsumer,
  MotionInputSettings,
} from "./editor-schema.js";

export function createSourceEditorOptions(
  delegate = false,
  nowMs: () => number = Date.now,
  availableOpcodes?: readonly string[],
): readonly SourceEditorOptions<MotionInputSettings>[] {
  const context = () => ({
    consumerId: extensionConfig.id,
    nowMs: nowMs(),
    settings: { delegate },
  });
  const binding = (
    argument: string,
    consumer: MotionInputConsumer,
    keys: readonly (keyof typeof motionSchemaBundles)[],
  ): SourceBinding<MotionInputSettings> => ({
    argument,
    variants: keys.map((key) => ({
      variantId: motionSchemaBundles[key].identity.variantId,
      format: "json",
      schemaBundle: motionSchemaBundles[key],
    })),
    decode: (source) => {
      const decoded = decodeMotionSource(source);
      const key =
        consumer === "motion-import" && delegate
          ? decoded.data &&
            typeof decoded.data === "object" &&
            "schema" in decoded.data &&
            decoded.data.schema === "twcs/camera-intrinsics"
            ? "importTwcs"
            : "importLegacy"
          : keys[0]!;
      return {
        ...decoded,
        variantId: motionSchemaBundles[key].identity.variantId,
      };
    },
    validateSource: (source, current) =>
      checkedSource(validateMotionSource(source, consumer, current)),
  });
  const definitions: readonly SourceEditorOptions<MotionInputSettings>[] = [
    {
      apiVersion: 1,
      extensionId: extensionConfig.id,
      editorId: "protocol-source",
      opcodes: [
        "protocolJsonValid",
        "decodeProtocolJson",
        "encodeProtocolJson",
      ],
      bindings: [binding("JSON", "protocol", ["protocolUnion"])],
      validationContext: context,
    },
    {
      apiVersion: 1,
      extensionId: extensionConfig.id,
      editorId: "calibration-import-source",
      opcodes: ["importCameraCalibration", "cameraCalibrationJsonValid"],
      bindings: [
        binding(
          "JSON",
          "motion-import",
          delegate ? ["importTwcs", "importLegacy"] : ["importDelegateOff"],
        ),
      ],
      validationContext: context,
    },
    {
      apiVersion: 1,
      extensionId: extensionConfig.id,
      editorId: "avatar-rig-source",
      opcodes: ["registerAvatarAsset"],
      bindings: [
        {
          argument: "RIG_JSON",
          variants: [
            {
              variantId: "json",
              format: "json",
              schemaBundle: avatarRigSchemaBundle,
            },
          ],
          decode: decodeAvatarRigSource,
          validateSource: (source, current) =>
            checkedSource(validateAvatarRigSource(source, current)),
        },
      ],
      validationContext: context,
    },
    {
      apiVersion: 1,
      extensionId: extensionConfig.id,
      editorId: "avatar-pose-source",
      opcodes: ["applyPoseFrame3DToAvatars"],
      bindings: [
        binding("POSE3D_JSON", "avatar-pose3d", ["pose3d"]),
        binding("POSE2D_JSON", "avatar-pose2d", ["pose2d"]),
      ],
      validationContext: context,
    },
    {
      apiVersion: 1,
      extensionId: extensionConfig.id,
      editorId: "fusion-calibration-source",
      opcodes: ["loadFusionCameraCalibration"],
      bindings: [binding("JSON", "fusion-calibration", ["calibration"])],
      validationContext: context,
    },
    {
      apiVersion: 1,
      extensionId: extensionConfig.id,
      editorId: "fusion-pose-source",
      opcodes: ["bufferPoseFrame2D"],
      bindings: [binding("JSON", "fusion-pose2d", ["pose2dUnion"])],
      validationContext: context,
    },
    {
      apiVersion: 1,
      extensionId: extensionConfig.id,
      editorId: "palette-source",
      opcodes: ["loadGlowStickPalette"],
      bindings: [binding("JSON", "performance-dsl", ["performanceDsl"])],
      validationContext: context,
    },
  ];
  const available =
    availableOpcodes === undefined
      ? definitions
      : definitions
          .map((definition) => ({
            ...definition,
            opcodes: definition.opcodes.filter((opcode) =>
              availableOpcodes.includes(opcode),
            ),
          }))
          .filter((definition) => definition.opcodes.length > 0);
  return available.map((definition) => ({
    ...definition,
    opcodes: definition.opcodes.map(
      (opcode) => `${extensionConfig.id}_${opcode}`,
    ),
  }));
}

/** Optional capability: old GUIs continue executing blocks without editor registration. */
export function registerSourceEditors(
  scratch: unknown,
  delegate = false,
  nowMs: () => number = Date.now,
  availableOpcodes?: readonly string[],
): () => void {
  const api = (
    scratch as {
      gui?: {
        blockEditors?: {
          apiVersion?: number;
          registerSourceEditor?: (
            options: SourceEditorOptions<MotionInputSettings>,
          ) => () => void;
        };
      };
    }
  )?.gui?.blockEditors;
  if (api?.apiVersion !== 1 || typeof api.registerSourceEditor !== "function")
    return () => {};
  const removers: (() => void)[] = [];
  try {
    for (const options of createSourceEditorOptions(
      delegate,
      nowMs,
      availableOpcodes,
    ))
      removers.push(api.registerSourceEditor(options));
  } catch {
    for (const remove of removers.reverse()) remove();
    return () => {};
  }
  let active = true;
  return () => {
    if (active) {
      active = false;
      for (const remove of removers.reverse()) remove();
    }
  };
}
