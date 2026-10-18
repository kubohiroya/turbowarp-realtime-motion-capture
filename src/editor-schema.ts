import { utf8ByteLength } from "./protocol/utf8.js";
import calibration from "../schemas/camera-calibration-v1.json" with { type: "json" };
import dsl from "../schemas/performance-dsl-v1.json" with { type: "json" };
import pose2d from "../schemas/pose-frame-2d-v1.json" with { type: "json" };
import pose2dv2 from "../schemas/pose-frame-2d-v2.json" with { type: "json" };
import pose3d from "../schemas/pose-frame-3d-v1.json" with { type: "json" };
import policy from "../schemas/session-policy-v1.json" with { type: "json" };
import { Value } from "@sinclair/typebox/value";
import {
  compileSchemaBundle,
  validateSchemaInput,
} from "@kubohiroya/turbowarp-extension-data-editor/schema";
import type {
  SchemaBundle,
  SchemaDocument,
  SchemaResource,
  SchemaProvenance,
  SchemaJsonValue,
  SchemaValidationContext,
  SyncOwnerValidator,
  OwnerValidationResult,
  InputDiagnostic,
  OwnerExecutionDiagnostic,
} from "@kubohiroya/turbowarp-extension-data-editor/schema";
import {
  cameraProfileSchemaBundles,
  readCameraProfileDocument,
} from "@kubohiroya/turbowarp-camera-source/editor-schema";
import { validateProtocolValue } from "./protocol/codec.js";
import { PoseFrame2DSchema, PoseFrame3DSchema } from "./protocol/schemas.js";
import { validateLegacyCalibrationValue } from "./input-validation.js";
import type { CameraCalibrationV1 } from "./calibration/profile-types.js";
import { createCameraModel } from "./fusion/geometry.js";
import { validateGlowStickPerformer } from "./fusion/palette-input.js";
export {
  parseFrame,
  parsePoseFrame2D,
  parseCalibrationProfile,
} from "./input-validation.js";
export { validateProtocolValue } from "./protocol/codec.js";
export type MotionInputConsumer =
  | "protocol"
  | "fusion-calibration"
  | "fusion-pose2d"
  | "avatar-pose2d"
  | "avatar-pose3d"
  | "performance-dsl"
  | "motion-import";
export interface MotionInputSettings {
  readonly delegate: boolean;
}
const documents = [calibration, dsl, pose2d, pose2dv2, pose3d, policy];
const symbols = [
  "CameraCalibrationSchema",
  "PerformanceDslSchema",
  "PoseFrame2DSchema",
  "PoseFrame2DV2Schema",
  "PoseFrame3DSchema",
  "SessionPolicySchema",
];
const canonical = documents.map((_, i) => ({
  repository: "turbowarp-realtime-motion-capture",
  path: "src/protocol/schemas.ts",
  symbol: symbols[i]!,
}));
const generated = documents.map((d) => ({
  repository: "turbowarp-realtime-motion-capture",
  path: "schemas/" + d.$id.split("/").at(-1),
}));
const resources: SchemaResource[] = documents.map((document, i) => ({
  retrievalUri: document.$id,
  document: document as SchemaDocument,
  artifact: {
    role: "generated-schema",
    source: generated[i]!,
    generatedFrom: [canonical[i]!],
  },
}));
const provenance: SchemaProvenance = {
  canonicalSources: [canonical[0]!, ...canonical.slice(1)],
  generatedFiles: generated,
  referenceSchemas: [],
  generationSources: [
    {
      repository: "turbowarp-realtime-motion-capture",
      path: "scripts/generate-schemas.ts",
    },
  ],
};
function single(index: number, contractId: string): SchemaBundle {
  return {
    identity: {
      ownerId: "turbowarp-realtime-motion-capture",
      contractId,
      revision: "typebox-v0.7.0",
      variantId: "v" + (index === 3 ? "2" : "1"),
    },
    dialect: "draft-07",
    root: resources[index]!,
    resources: [],
    provenance,
  };
}
function union(
  indices: readonly number[],
  contractId: string,
  symbol: string,
): SchemaBundle {
  const source = {
    repository: "turbowarp-realtime-motion-capture",
    path: "src/editor-schema.ts",
    symbol,
  };
  const document: SchemaDocument = {
    anyOf: indices.map((i) => ({ $ref: resources[i]!.retrievalUri })),
  };
  return {
    identity: {
      ownerId: "turbowarp-realtime-motion-capture",
      contractId,
      revision: "typebox-v0.7.0",
      variantId: "fixed-union",
    },
    dialect: "draft-07",
    root: {
      retrievalUri: "urn:twrmc:editor:" + contractId,
      document,
      artifact: { role: "canonical-schema", source },
    },
    resources: indices.map((i) => resources[i]!),
    provenance: {
      ...provenance,
      canonicalSources: [source, ...provenance.canonicalSources],
    },
  };
}
const protocolUnion = union(
  [0, 1, 2, 3, 4, 5],
  "protocol-union",
  "protocolUnion",
);
const pose2dUnion = union([2, 3], "pose2d-union", "pose2dUnion");
function importBundle(original: SchemaBundle, variantId: string): SchemaBundle {
  return {
    ...original,
    identity: {
      ownerId: "turbowarp-realtime-motion-capture",
      contractId: "motion-calibration-import",
      revision: "delegate-off-v0.7.0-on-source-v0.16.0",
      variantId,
    },
  };
}
export const motionSchemaBundles = {
  calibration: single(0, "motion-calibration"),
  pose2d: single(2, "pose2d"),
  pose2dV2: single(3, "pose2d-v2"),
  pose3d: single(4, "pose3d"),
  performanceDsl: single(1, "performance-dsl"),
  protocolUnion,
  pose2dUnion,
  importDelegateOff: importBundle(
    single(0, "motion-calibration"),
    "delegate-off-legacy",
  ),
  importTwcs: importBundle(cameraProfileSchemaBundles.twcs, "delegate-on-twcs"),
  importLegacy: importBundle(
    cameraProfileSchemaBundles.legacy,
    "delegate-on-legacy",
  ),
} as const;
const prepared = Object.fromEntries(
  Object.entries(motionSchemaBundles).map(([key, bundle]) => [
    key,
    compileSchemaBundle(bundle),
  ]),
);
const invalid = (ruleId: string): OwnerValidationResult => ({
  kind: "invalid",
  issues: [{ dataPath: "", ruleId }],
});
/** Pure data checks only: original source byte/character limits are applied by the source adapter. */
export function motionOwnerValidator(
  consumer: MotionInputConsumer,
): SyncOwnerValidator<MotionInputSettings> {
  return (data, context) => {
    if (consumer === "avatar-pose2d" || consumer === "avatar-pose3d")
      return Value.Check(
        consumer === "avatar-pose2d" ? PoseFrame2DSchema : PoseFrame3DSchema,
        data,
      )
        ? { kind: "valid", issues: [] }
        : invalid("avatar-input");
    if (consumer === "motion-import") {
      if (context.settings.delegate)
        return readCameraProfileDocument(data).ok
          ? { kind: "valid", issues: [] }
          : invalid("delegated-profile-input");
      try {
        validateLegacyCalibrationValue(data);
        return { kind: "valid", issues: [] };
      } catch {
        return invalid("legacy-profile-input");
      }
    }
    const decoded = validateProtocolValue(data, context.nowMs);
    if (!decoded.ok) return invalid("protocol-input");
    if (
      consumer === "fusion-pose2d" &&
      decoded.schema !== "twrmc/pose-frame-2d"
    )
      return invalid("pose2d-dispatch");
    if (consumer === "fusion-calibration") {
      if (decoded.schema !== "twrmc/camera-calibration")
        return invalid("calibration-dispatch");
      try {
        createCameraModel(data as unknown as CameraCalibrationV1);
      } catch {
        return invalid("fusion-camera-geometry");
      }
    }
    if (consumer === "performance-dsl") {
      if (decoded.schema !== "twrmc/performance-dsl")
        return invalid("dsl-dispatch");
      try {
        for (const performer of (
          data as {
            performers: { performerId: string; glowStickColor: string }[];
          }
        ).performers)
          validateGlowStickPerformer(performer);
      } catch {
        return invalid("palette-color");
      }
    }
    return { kind: "valid", issues: [] };
  };
}
export function decodeMotionSource(source: string) {
  return {
    source,
    format: "json" as const,
    data: JSON.parse(source) as SchemaJsonValue,
  };
}
/** Consumer and startup settings are explicit; no controller, registry or clock is consulted. */
export function validateMotionSource(
  source: string,
  consumer: MotionInputConsumer,
  context: SchemaValidationContext<MotionInputSettings>,
) {
  const initial = {
    protocol: "protocolUnion",
    "fusion-calibration": "calibration",
    "fusion-pose2d": "pose2dUnion",
    "avatar-pose2d": "pose2d",
    "avatar-pose3d": "pose3d",
    "performance-dsl": "performanceDsl",
    "motion-import": "importDelegateOff",
  } as const;
  const fallback = motionSchemaBundles[initial[consumer]].identity;
  let consumerId: string | undefined;
  let delegate: boolean | undefined;
  try {
    const id = Object.getOwnPropertyDescriptor(context, "consumerId");
    if (id && "value" in id && typeof id.value === "string")
      consumerId = id.value;
    const settings = Object.getOwnPropertyDescriptor(context, "settings");
    if (
      settings &&
      "value" in settings &&
      settings.value &&
      typeof settings.value === "object"
    ) {
      const flag = Object.getOwnPropertyDescriptor(settings.value, "delegate");
      if (flag && "value" in flag && typeof flag.value === "boolean")
        delegate = flag.value;
    }
  } catch {
    /* Context errors use the same safe diagnostic as common composition. */
  }
  const scope = {
    identity: fallback,
    ...(consumerId === undefined ? {} : { consumerId }),
  };
  if (delegate === undefined) {
    const diagnostics: readonly [OwnerExecutionDiagnostic] = [
      {
        scope,
        phase: "execution",
        operation: "semantic",
        code: "owner-context-invalid",
      },
    ];
    return {
      source,
      result: { kind: "execution-error" as const, diagnostics },
    };
  }
  let decoded: ReturnType<typeof decodeMotionSource>;
  try {
    decoded = decodeMotionSource(source);
  } catch {
    const diagnostics: readonly [InputDiagnostic & { phase: "decode" }] = [
      { scope, phase: "decode", code: "input-format-invalid", dataPath: "" },
    ];
    return { source, result: { kind: "invalid" as const, diagnostics } };
  }
  const data = decoded.data;
  let key: keyof typeof motionSchemaBundles;
  switch (consumer) {
    case "protocol":
      key = "protocolUnion";
      break;
    case "fusion-calibration":
      key = "calibration";
      break;
    case "fusion-pose2d":
      key = "pose2dUnion";
      break;
    case "avatar-pose2d":
      key = "pose2d";
      break;
    case "avatar-pose3d":
      key = "pose3d";
      break;
    case "performance-dsl":
      key = "performanceDsl";
      break;
    case "motion-import":
      key = !delegate
        ? "importDelegateOff"
        : data &&
            typeof data === "object" &&
            "schema" in data &&
            data.schema === "twcs/camera-intrinsics"
          ? "importTwcs"
          : "importLegacy";
      break;
  }
  const compilation = prepared[key]!;
  if (compilation.kind !== "compiled")
    return { ...decoded, result: compilation };
  const avatar = consumer === "avatar-pose2d" || consumer === "avatar-pose3d";
  const protocol = consumer !== "motion-import" && !avatar;
  const limit = avatar
    ? source.length > 1_048_576
    : protocol
      ? utf8ByteLength(source) > 1_048_576
      : false;
  const result = validateSchemaInput(compilation.validator, data, {
    context,
    ownerValidate: limit
      ? () => invalid(avatar ? "avatar-character-limit" : "protocol-byte-limit")
      : motionOwnerValidator(consumer),
  });
  return {
    ...decoded,
    variantId: motionSchemaBundles[key].identity.variantId,
    result,
  };
}

import { parseRigMapping } from "./avatar/rig-input.js";
import avatarRigDocument from "../schemas/avatar-rig.schema.json" with { type: "json" };
export const avatarRigSchemaBundle: SchemaBundle = {
  identity: {
    ownerId: "turbowarp-realtime-motion-capture",
    contractId: "avatar-rig",
    revision: "source-v1",
    variantId: "json",
  },
  dialect: "2020-12",
  root: {
    retrievalUri: avatarRigDocument.$id,
    document: avatarRigDocument as SchemaDocument,
    artifact: {
      role: "canonical-schema",
      source: {
        repository: "turbowarp-realtime-motion-capture",
        path: "schemas/avatar-rig.schema.json",
      },
    },
  },
  resources: [],
  provenance: {
    canonicalSources: [
      {
        repository: "turbowarp-realtime-motion-capture",
        path: "schemas/avatar-rig.schema.json",
      },
      {
        repository: "turbowarp-realtime-motion-capture",
        path: "src/avatar/rig-input.ts",
      },
    ],
    generatedFiles: [],
    referenceSchemas: [],
    generationSources: [],
  },
};
const avatarRigCompilation = compileSchemaBundle(avatarRigSchemaBundle);
export function decodeAvatarRigSource(source: string) {
  return {
    source,
    format: "json" as const,
    variantId: "json",
    data: JSON.parse(source) as SchemaJsonValue,
  };
}
/** Validate only the supplied source; no controller or runtime resources are touched. */
export function validateAvatarRigSource<C = null>(
  source: string,
  context: SchemaValidationContext<C>,
) {
  if (avatarRigCompilation.kind !== "compiled")
    return { source, result: avatarRigCompilation };
  let data: SchemaJsonValue;
  try {
    data = JSON.parse(source) as SchemaJsonValue;
  } catch {
    return {
      source,
      result: {
        kind: "invalid" as const,
        diagnostics: [
          {
            scope: { identity: avatarRigSchemaBundle.identity },
            phase: "decode" as const,
            code: "input-format-invalid" as const,
            dataPath: "",
          },
        ],
      },
    };
  }
  const accepted = (): boolean => {
    try {
      parseRigMapping(source);
      return true;
    } catch {
      return false;
    }
  };
  return {
    source,
    result: validateSchemaInput(avatarRigCompilation.validator, data, {
      context,
      ownerValidate: () =>
        accepted()
          ? { kind: "valid", issues: [] }
          : {
              kind: "invalid",
              issues: [{ dataPath: "", ruleId: "avatar-rig-owner-input" }],
            },
    }),
  };
}
