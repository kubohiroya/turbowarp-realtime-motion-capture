/**
 * Where the MoveNet MultiPose Lightning model comes from.
 *
 * By default TensorFlow.js fetches it from TF Hub, which needs the internet at every start. A venue
 * without a connection gives the model to the extension instead, through `__TWMP_POSE_MODEL__` on the
 * global object, set before the pose pipeline starts:
 *
 * - `{ url }` — the `model.json` of a TF.js graph model, with its weight shards beside it, such as a
 *   copy served by the application's own host.
 * - `{ modelJson, weights }` — the parsed `model.json` and the weight shards' bytes, in the order its
 *   weights manifest lists them, for an application that carries the model inside itself.
 *
 * It is read when the model loads, not when the extension loads, so the application may set it at
 * any time before starting the pipeline.
 */

export type PoseModelSource =
  | { readonly kind: "tf-hub" }
  | { readonly kind: "url"; readonly url: string }
  | { readonly kind: "memory"; readonly artifacts: PoseModelArtifacts };

/** The subset of TensorFlow.js `ModelArtifacts` a graph model is loaded from. */
export interface PoseModelArtifacts {
  readonly modelTopology: unknown;
  readonly weightSpecs: readonly unknown[];
  readonly weightData: ArrayBuffer;
  readonly format?: unknown;
  readonly generatedBy?: unknown;
  readonly convertedBy?: unknown;
  readonly signature?: unknown;
  readonly userDefinedMetadata?: unknown;
  readonly modelInitializer?: unknown;
}

interface PoseModelGlobal {
  readonly __TWMP_POSE_MODEL__?: unknown;
}

export class PoseModelConfigError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "PoseModelConfigError";
  }
}

/** The configured source, read from the global object each time the model loads. */
export function configuredPoseModelSource(): PoseModelSource {
  return resolvePoseModelSource(
    (globalThis as PoseModelGlobal).__TWMP_POSE_MODEL__,
  );
}

/**
 * Checks a configured value and turns it into a source. A value that is set but malformed fails
 * loudly rather than falling back to TF Hub: an offline venue would otherwise wait on a network it
 * does not have, with nothing saying why.
 */
export function resolvePoseModelSource(value: unknown): PoseModelSource {
  if (value === undefined || value === null) return { kind: "tf-hub" };
  if (typeof value !== "object") {
    throw new PoseModelConfigError(
      "__TWMP_POSE_MODEL__ must be { url } or { modelJson, weights }.",
    );
  }
  const config = value as Record<string, unknown>;
  if ("url" in config) {
    if (typeof config.url !== "string" || config.url.trim() === "") {
      throw new PoseModelConfigError(
        "__TWMP_POSE_MODEL__.url must be the URL of model.json.",
      );
    }
    return { kind: "url", url: config.url.trim() };
  }
  if ("modelJson" in config || "weights" in config) {
    return { kind: "memory", artifacts: artifactsOf(config) };
  }
  throw new PoseModelConfigError(
    "__TWMP_POSE_MODEL__ must be { url } or { modelJson, weights }.",
  );
}

function artifactsOf(config: Record<string, unknown>): PoseModelArtifacts {
  const modelJson = config.modelJson;
  if (typeof modelJson !== "object" || modelJson === null) {
    throw new PoseModelConfigError(
      "__TWMP_POSE_MODEL__.modelJson must be the parsed model.json.",
    );
  }
  const model = modelJson as Record<string, unknown>;
  const manifest = model.weightsManifest;
  if (
    model.modelTopology === undefined ||
    !Array.isArray(manifest) ||
    manifest.some(
      (group) =>
        typeof group !== "object" ||
        group === null ||
        !Array.isArray((group as { weights?: unknown }).weights),
    )
  ) {
    throw new PoseModelConfigError(
      "__TWMP_POSE_MODEL__.modelJson is not a TF.js graph model: it needs modelTopology and weightsManifest.",
    );
  }
  const weightSpecs = manifest.flatMap(
    (group) => (group as { weights: unknown[] }).weights,
  );
  return {
    modelTopology: model.modelTopology,
    weightSpecs,
    weightData: joinWeights(config.weights),
    ...optional("format", model.format),
    ...optional("generatedBy", model.generatedBy),
    ...optional("convertedBy", model.convertedBy),
    ...optional("signature", model.signature),
    ...optional("userDefinedMetadata", model.userDefinedMetadata),
    ...optional("modelInitializer", model.modelInitializer),
  };
}

/** One buffer of every shard's bytes, in order, as `ModelArtifacts.weightData` expects. */
function joinWeights(weights: unknown): ArrayBuffer {
  const shards = Array.isArray(weights) ? weights : [weights];
  const parts = shards.map((shard) => {
    if (shard instanceof ArrayBuffer) return new Uint8Array(shard);
    if (ArrayBuffer.isView(shard)) {
      return new Uint8Array(shard.buffer, shard.byteOffset, shard.byteLength);
    }
    throw new PoseModelConfigError(
      "__TWMP_POSE_MODEL__.weights must be the weight shards as ArrayBuffers or byte arrays.",
    );
  });
  if (parts.length === 0) {
    throw new PoseModelConfigError(
      "__TWMP_POSE_MODEL__.weights must hold at least one weight shard.",
    );
  }
  const joined = new Uint8Array(
    parts.reduce((total, part) => total + part.byteLength, 0),
  );
  let offset = 0;
  for (const part of parts) {
    joined.set(part, offset);
    offset += part.byteLength;
  }
  return joined.buffer;
}

function optional<Key extends string>(
  key: Key,
  value: unknown,
): Partial<Record<Key, unknown>> {
  return value === undefined ? {} : ({ [key]: value } as Record<Key, unknown>);
}
