import { createBlockEditorService } from "@kubohiroya/turbowarp-extension-data-editor/rjsf";
import { extensionConfig } from "../src/config.js";
import { expect, it } from "vitest";
import {
  createSourceEditorOptions,
  registerSourceEditors,
} from "../src/source-editors.js";
import definitions from "../src/block-definitions.json";
const targets: Record<string, readonly string[]> = {
  protocolJsonValid: ["JSON"],
  decodeProtocolJson: ["JSON"],
  encodeProtocolJson: ["JSON"],
  importCameraCalibration: ["JSON"],
  cameraCalibrationJsonValid: ["JSON"],
  registerAvatarAsset: ["RIG_JSON"],
  applyPoseFrame3DToAvatars: ["POSE3D_JSON", "POSE2D_JSON"],
  loadFusionCameraCalibration: ["JSON"],
  bufferPoseFrame2D: ["JSON"],
  loadGlowStickPalette: ["JSON"],
};
it("covers every planned opcode and input against the actual block definitions", () => {
  const options = createSourceEditorOptions();
  const actual = options
    .flatMap((option) =>
      option.opcodes.flatMap((opcode) =>
        option.bindings.map(
          (binding) =>
            `${opcode.slice(option.extensionId.length + 1)}.${binding.argument}`,
        ),
      ),
    )
    .sort();
  expect(actual).toEqual(
    Object.entries(targets)
      .flatMap(([opcode, arguments_]) =>
        arguments_.map((argument) => `${opcode}.${argument}`),
      )
      .sort(),
  );
  for (const [opcode, arguments_] of Object.entries(targets)) {
    const block = definitions.blocks.find((block) => block.opcode === opcode);
    expect(block).toBeDefined();
    for (const argument of arguments_)
      expect(block!.arguments).toHaveProperty(argument);
  }
});
it("skips old hosts, registers only through the optional source API, and removes once", () => {
  expect(() => registerSourceEditors({})()).not.toThrow();
  expect(() =>
    registerSourceEditors({ gui: { blockEditors: { apiVersion: 1 } } })(),
  ).not.toThrow();
  const seen: unknown[] = [];
  let removals = 0;
  const remove = registerSourceEditors({
    gui: {
      blockEditors: {
        apiVersion: 1,
        registerSourceEditor: (options: unknown) => {
          seen.push(options);
          return () => {
            removals++;
          };
        },
      },
    },
  });
  expect(seen.length).toBe(createSourceEditorOptions().length);
  remove();
  remove();
  expect(removals).toBe(seen.length);
});
it("keeps decode failures safe and preserves the exact source at owner validation", () => {
  const source = "{private-input broken";
  for (const definition of createSourceEditorOptions())
    for (const binding of definition.bindings) {
      expect(() => binding.decode(source)).toThrow();
      const result = binding.validateSource(
        source,
        definition.validationContext(),
      );
      expect(result.source).toBe(source);
      expect(result.result.kind).toBe("invalid");
      expect(JSON.stringify(result.result)).not.toContain("private-input");
      expect(binding.variants.length).toBeGreaterThan(0);
    }
});

import { parseRigMapping } from "../src/avatar/rig-input.js";
import { validateAvatarRigSource } from "../src/editor-schema.js";
it("keeps both avatar pose arguments in one editor and freezes startup delegation", () => {
  const all = createSourceEditorOptions(true, () => 123);
  expect(
    all
      .find((option) => option.editorId === "avatar-pose-source")!
      .bindings.map((binding) => binding.argument),
  ).toEqual(["POSE3D_JSON", "POSE2D_JSON"]);
  const imports = all.find(
    (option) => option.editorId === "calibration-import-source",
  )!;
  expect(imports.validationContext()).toEqual({
    consumerId: imports.extensionId,
    nowMs: 123,
    settings: { delegate: true },
  });
  expect(
    imports.bindings[0]!.variants.map((variant) => variant.variantId),
  ).toEqual(["delegate-on-twcs", "delegate-on-legacy"]);
  expect(
    createSourceEditorOptions(false, Date.now, ["registerAvatarAsset"]).flatMap(
      (option) => option.opcodes,
    ),
  ).toEqual([`${extensionConfig.id}_registerAvatarAsset`]);
});
it("matches the pure rig reader including omitted/null defaults, whitespace, arrays and forbidden fields", () => {
  const context = { consumerId: "rig-test", nowMs: 0, settings: null };
  for (const value of [
    {},
    { root: null, rootScale: null, rootOffset: null },
    { recognitionStartEvent: "  event-name  " },
    { root: "world", rootScale: 2, rootOffset: [1, 2, 3] },
    { bones: {} },
    { extra: 1 },
    { rootScale: 0 },
    { rootOffset: [0, 1] },
    { recognitionEndEvent: "bad space" },
    [],
  ]) {
    const source = JSON.stringify(value);
    let valid = true;
    try {
      parseRigMapping(source);
    } catch {
      valid = false;
    }
    const before = JSON.stringify(value);
    expect(
      validateAvatarRigSource(source, context).result.kind === "valid",
    ).toBe(valid);
    expect(JSON.stringify(value)).toBe(before);
  }
});

it("registers and resolves every fully qualified opcode through the actual common service", () => {
  const service = createBlockEditorService();
  const remove = registerSourceEditors({ gui: { blockEditors: service.api } });
  const options = createSourceEditorOptions();
  for (const option of options)
    for (const opcode of option.opcodes) {
      expect(opcode.startsWith(`${option.extensionId}_`)).toBe(true);
      expect(service.registry.resolve(opcode)).toMatchObject({
        extensionId: option.extensionId,
        editorId: option.editorId,
        editableArguments: option.bindings.map((binding) => binding.argument),
      });
    }
  remove();
  remove();
  for (const option of options)
    for (const opcode of option.opcodes)
      expect(service.registry.resolve(opcode)).toBeUndefined();
});
