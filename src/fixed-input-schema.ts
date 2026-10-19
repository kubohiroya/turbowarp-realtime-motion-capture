import document from "../schemas/block-editor-fixed-inputs.schema.json" with { type: "json" };
import type {
  SchemaBundle,
  SchemaDocument,
} from "@kubohiroya/turbowarp-extension-data-editor/schema";

/** Canonical fixed field fragments; URI is identity only, never fetched. */
export function fixedInputBundle(
  opcode: string,
  argument: string,
): SchemaBundle {
  const source = {
    repository: "turbowarp-realtime-motion-capture",
    path: "schemas/block-editor-fixed-inputs.schema.json",
    symbol: `#/$defs/${opcode}/properties/${argument}`,
  };
  const definitions = document.$defs as Record<
    string,
    { properties: Record<string, SchemaDocument> }
  >;
  return {
    identity: {
      ownerId: "turbowarp-realtime-motion-capture",
      contractId: "fixed-inputs",
      revision: "1",
      variantId: opcode + "." + argument,
    },
    dialect: "2020-12",
    root: {
      retrievalUri: document.$id,
      document: definitions[opcode]!.properties[argument]!,
      artifact: { role: "canonical-schema", source },
    },
    resources: [],
    provenance: {
      canonicalSources: [
        source,
        ...[
          {
            repository: "turbowarp-realtime-motion-capture",
            path: "src/pose/data-types.ts",
            symbol: "COCO_17_KEYPOINT_IDS",
          },
          {
            repository: "turbowarp-realtime-motion-capture",
            path: "src/extension.ts",
            symbol:
              "numeric methods listed in numeric-policy-ledger, blockEnabled",
          },
          {
            repository: "turbowarp-realtime-motion-capture",
            path: "src/calibration/controller.ts",
            symbol: "legacy calibration pure numeric predicates",
          },
        ],
      ],
      generatedFiles: [
        {
          repository: "turbowarp-realtime-motion-capture",
          path: "docs/schemas/block-editor-fixed-inputs.schema.json",
        },
      ],
      generationSources: [
        {
          repository: "turbowarp-realtime-motion-capture",
          path: "scripts/generate-fixed-input-docs.mjs",
        },
      ],
      referenceSchemas: [],
    },
  };
}
