import { Value } from "@sinclair/typebox/value";
import {
  CameraCalibrationSchema,
  PoseFrame2DSchema,
  PoseFrame3DSchema,
} from "./protocol/schemas.js";
import type { CameraCalibrationV1 } from "./calibration/profile-types.js";
import type { PoseFrame2D, PoseFrame3D } from "./avatar/types.js";

export function parseFrame(source: string): PoseFrame3D {
  const value = parseJsonObject(source, "PoseFrame3D JSON");
  if (!Value.Check(PoseFrame3DSchema, value)) {
    const first = Value.Errors(PoseFrame3DSchema, value).First();
    throw new Error(
      `Invalid PoseFrame3D v1 at ${first?.path || "/"}: ${first?.message ?? "schema mismatch"}`,
    );
  }
  return value as unknown as PoseFrame3D;
}

export function parsePoseFrame2D(source: string): PoseFrame2D {
  const value = parseJsonObject(source, "PoseFrame2D JSON");
  if (!Value.Check(PoseFrame2DSchema, value)) {
    const first = Value.Errors(PoseFrame2DSchema, value).First();
    throw new Error(
      `Invalid PoseFrame2D v1 at ${first?.path || "/"}: ${first?.message ?? "schema mismatch"}`,
    );
  }
  return value as unknown as PoseFrame2D;
}

export function parseJsonObject(
  source: string,
  label: string,
): Record<string, unknown> {
  if (source.length > 1_048_576) throw new Error(`${label} exceeds 1 MiB.`);
  try {
    return record(JSON.parse(source) as unknown, label);
  } catch (error) {
    if (error instanceof SyntaxError)
      throw new Error(`${label} is invalid JSON.`);
    throw error;
  }
}

export function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function findPairingCredential(value: unknown, path = ""): string | undefined {
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      const found = findPairingCredential(item, `${path}/${index}`);
      if (found) return found;
    }
    return undefined;
  }
  if (typeof value !== "object" || value === null) return undefined;
  for (const [key, item] of Object.entries(value)) {
    const itemPath = `${path}/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`;
    const normalized = key.toLowerCase().replaceAll(/[^a-z]/gu, "");
    if (
      /^(?:offer|answer|sdp|icecandidate|icecandidates|icepwd|iceufrag|dtlsfingerprint|credential|credentials)$/u.test(
        normalized,
      )
    ) {
      return itemPath;
    }
    const found = findPairingCredential(item, itemPath);
    if (found) return found;
  }
  return undefined;
}

export function parseCalibrationProfile(json: string): CameraCalibrationV1 {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch (error) {
    throw new CalibrationValidationError("invalid-calibration", String(error));
  }
  return validateLegacyCalibrationValue(value);
}

export function validateLegacyCalibrationValue(
  value: unknown,
): CameraCalibrationV1 {
  const credentialPath = findPairingCredential(value);
  if (credentialPath) {
    throw new CalibrationValidationError(
      "credential-forbidden",
      `Pairing credential is forbidden at ${credentialPath}.`,
    );
  }
  if (!Value.Check(CameraCalibrationSchema, value)) {
    const first = Value.Errors(CameraCalibrationSchema, value).First();
    throw new CalibrationValidationError(
      "invalid-calibration",
      `${first?.path || "/"}: ${first?.message ?? "Invalid v1 profile."}`,
    );
  }
  return value as CameraCalibrationV1;
}

export class CalibrationValidationError extends Error {
  public constructor(
    public readonly code: "invalid-calibration" | "credential-forbidden",
    message: string,
  ) {
    super(message);
  }
}
