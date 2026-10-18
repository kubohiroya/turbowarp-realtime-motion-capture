import { parseJsonObject } from "../input-validation.js";
import type { AvatarRigMapping } from "./types.js";
const eventNames = /^[A-Za-z0-9._:-]{1,80}$/u;

export function parseRigMapping(source: string): AvatarRigMapping {
  const value = parseJsonObject(source, "Avatar rig mapping JSON");
  if ("bones" in value) {
    throw new Error(
      "Rig mapping no longer takes bones: VRM humanoid bones are driven directly.",
    );
  }
  const allowed = new Set([
    "root",
    "rootScale",
    "rootOffset",
    "recognitionStartEvent",
    "recognitionEndEvent",
  ]);
  rejectUnknownKeys(value, allowed, "rig mapping");
  const root = value.root ?? "kalidokit";
  if (root !== "kalidokit" && root !== "world") {
    throw new Error('root must be "kalidokit" or "world".');
  }
  const rootScale = finite(value.rootScale ?? 1, "rootScale");
  if (rootScale <= 0) throw new Error("rootScale must be greater than zero.");
  const rootOffset = vector3(value.rootOffset ?? [0, 0, 0], "rootOffset");
  const recognitionStartEvent = eventName(
    value.recognitionStartEvent ?? "twmp-recognition-start",
    "recognitionStartEvent",
  );
  const recognitionEndEvent = eventName(
    value.recognitionEndEvent ?? "twmp-recognition-end",
    "recognitionEndEvent",
  );
  return {
    root,
    rootScale,
    rootOffset,
    recognitionStartEvent,
    recognitionEndEvent,
  };
}

function rejectUnknownKeys(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  label: string,
): void {
  const unknown = Object.keys(value).find((key) => !allowed.has(key));
  if (unknown) throw new Error(`${label} contains unknown field: ${unknown}`);
}

function vector3(value: unknown, label: string): [number, number, number] {
  if (!Array.isArray(value) || value.length !== 3) {
    throw new Error(`${label} must contain exactly three numbers.`);
  }
  return [
    finite(value[0], `${label}[0]`),
    finite(value[1], `${label}[1]`),
    finite(value[2], `${label}[2]`),
  ];
}

function finite(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number.`);
  }
  return value;
}

function nonEmpty(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0)
    throw new Error(`${label} must not be empty.`);
  return value.trim();
}
function eventName(value: unknown, label: string): string {
  const normalized = nonEmpty(value, label);
  if (!eventNames.test(normalized)) throw new Error(`Invalid ${label}.`);
  return normalized;
}
