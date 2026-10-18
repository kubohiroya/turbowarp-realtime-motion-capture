import { expect, it } from "vitest";
import { createBlockEditorService } from "@kubohiroya/turbowarp-extension-data-editor/rjsf";
import type {
  BlockEditorHost,
  BlockSnapshot,
  CommitRequest,
  JsonObject,
} from "@kubohiroya/turbowarp-extension-data-editor";
import { createSourceEditorOptions } from "../src/source-editors.js";
import { poseFrame2D } from "./fusion-fixtures.js";

// Reuse the same valid protocol values as editor-schema.test.ts, without a VM or avatar controller.
function fixture() {
  const definition = createSourceEditorOptions(false, () =>
    Date.parse("2026-09-13T13:00:00Z"),
  ).find((entry) => entry.editorId === "avatar-pose-source")!;
  const pose3d = {
    schema: "twrmc/pose-frame-3d",
    version: 1,
    sequence: 1,
    timestampUs: 123,
    persons: [],
  };
  const inputs = {
    POSE3D_JSON: " \n" + JSON.stringify(pose3d) + "\n ",
    POSE2D_JSON:
      " \n" + JSON.stringify(poseFrame2D("camera", 123, [], 1)) + "\n ",
  };
  const reference = { targetId: "sprite", blockId: "pose-block" };
  const snapshot: BlockSnapshot = {
    ...reference,
    opcode: definition.opcodes[0]!,
    revision: "1",
    arguments: Object.fromEntries(
      Object.entries(inputs).map(([argument, value]) => [
        argument,
        { kind: "literal" as const, value },
      ]),
    ),
  };
  const commits: CommitRequest[] = [];
  const host: BlockEditorHost = {
    readBlock: () => snapshot,
    commit: (request) => {
      commits.push(request);
    },
  };
  const service = createBlockEditorService();
  const remove = service.api.registerSourceEditor(definition);
  const session = service.registry.open(reference, host)!;
  return { definition, inputs, snapshot, commits, session, remove };
}

it("commits actual Motion POSE3D_JSON and POSE2D_JSON edits in one prepared transaction", async () => {
  const { definition, inputs, commits, session, remove } = fixture();
  const draft = session.getDraft();
  const sources = draft.sources as JsonObject;
  for (const argument of ["POSE3D_JSON", "POSE2D_JSON"]) {
    ((sources[argument] as JsonObject).data as JsonObject).sequence = 2;
  }
  session.setDraft(draft);
  expect(await session.save()).toEqual({ status: "saved", changed: true });
  expect(commits).toHaveLength(1);
  expect(commits[0]!.changes.map((change) => change.argument)).toEqual([
    "POSE3D_JSON",
    "POSE2D_JSON",
  ]);
  for (const change of commits[0]!.changes) {
    const original = inputs[change.argument as keyof typeof inputs];
    expect(change.value).toBe(original.replace('"sequence":1', '"sequence":2'));
    const binding = definition.bindings.find(
      (entry) => entry.argument === change.argument,
    )!;
    expect(
      binding.validateSource(
        change.value as string,
        definition.validationContext(),
      ).result.kind,
    ).toBe("valid");
  }
  remove();
});

it("rejects one invalid Motion pose without a partial write or discarding either draft", async () => {
  const { inputs, snapshot, commits, session, remove } = fixture();
  const draft = session.getDraft();
  const sources = draft.sources as JsonObject;
  ((sources.POSE3D_JSON as JsonObject).data as JsonObject).sequence = 2;
  sources.POSE2D_JSON = {
    mode: "source",
    source: '{"schema":"invalid-pose"}',
    sourceEdited: true,
  };
  session.setDraft(draft);
  const before = session.getDraft();
  expect((await session.save()).status).toBe("invalid");
  expect(commits).toEqual([]);
  expect(session.getDraft()).toEqual(before);
  expect(snapshot.arguments.POSE3D_JSON).toEqual({
    kind: "literal",
    value: inputs.POSE3D_JSON,
  });
  expect(snapshot.arguments.POSE2D_JSON).toEqual({
    kind: "literal",
    value: inputs.POSE2D_JSON,
  });
  expect(session.getState().status).toBe("editing");
  remove();
});
