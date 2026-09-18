import type { AFrameCapabilityPort } from "./types.js";

export const AFRAME_CAPABILITY_KEY = "turbowarpAFrameCapability";
export const AFRAME_CAPABILITY_VERSION = 2;

const METHODS = [
  "loadTemplate",
  "createFromTemplate",
  "setPosition",
  "emitEvent",
  "deleteSelector",
  "countSelector",
  "loadVrm",
  "setVrmBoneRotation",
  "requireVersion",
] as const;

/**
 * Returns TurboWarp-A-Frame capability v2, the only version avatar retargeting accepts.
 * A build that cannot provide v2 is refused rather than driven through an older contract.
 */
export function requireAFrameCapability(
  runtime: TurboWarpRuntime,
): AFrameCapabilityPort {
  const candidate = runtime[AFRAME_CAPABILITY_KEY];
  if (typeof candidate !== "object" || candidate === null) {
    throw new Error(
      "TurboWarp-A-Frame capability v2 must be loaded before avatar retargeting.",
    );
  }
  const requireVersion = Reflect.get(candidate, "requireVersion");
  if (typeof requireVersion !== "function") {
    throw new Error(
      "TurboWarp-A-Frame capability v2 is missing requireVersion().",
    );
  }
  let capability: unknown;
  try {
    capability = requireVersion.call(candidate, 2);
  } catch (error) {
    throw new Error(
      `TurboWarp-A-Frame capability v2 is required: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (typeof capability !== "object" || capability === null) {
    throw new Error("TurboWarp-A-Frame capability v2 is required.");
  }
  for (const method of METHODS) {
    if (typeof Reflect.get(capability, method) !== "function") {
      throw new Error(
        `TurboWarp-A-Frame capability v2 is missing ${method}().`,
      );
    }
  }
  const version = Reflect.get(capability, "version");
  if (version !== AFRAME_CAPABILITY_VERSION) {
    throw new Error(
      `TurboWarp-A-Frame capability v2 is required; found version ${String(version)}.`,
    );
  }
  return capability as AFrameCapabilityPort;
}
