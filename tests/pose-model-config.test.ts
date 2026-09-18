import { afterEach, describe, expect, it } from "vitest";

import {
  configuredPoseModelSource,
  PoseModelConfigError,
  resolvePoseModelSource,
} from "../config/pose-model-config.js";

type ModelGlobal = { __TWMP_POSE_MODEL__?: unknown };

afterEach(() => {
  delete (globalThis as ModelGlobal).__TWMP_POSE_MODEL__;
});

const modelJson = {
  format: "graph-model",
  generatedBy: "2.7.0",
  convertedBy: null,
  modelTopology: { node: [] },
  weightsManifest: [
    {
      paths: ["group1-shard1of2.bin", "group1-shard2of2.bin"],
      weights: [
        { name: "a", shape: [2], dtype: "float32" },
        { name: "b", shape: [1], dtype: "float32" },
      ],
    },
    {
      paths: ["group2-shard1of1.bin"],
      weights: [{ name: "c", shape: [1], dtype: "int32" }],
    },
  ],
  signature: { inputs: {} },
};

describe("the MoveNet model source", () => {
  it("is TF Hub unless the application gives one", () => {
    expect(configuredPoseModelSource()).toEqual({ kind: "tf-hub" });
    expect(resolvePoseModelSource(null)).toEqual({ kind: "tf-hub" });
  });

  it("takes the URL of a model.json the application serves", () => {
    (globalThis as ModelGlobal).__TWMP_POSE_MODEL__ = {
      url: " /models/movenet/model.json ",
    };
    expect(configuredPoseModelSource()).toEqual({
      kind: "url",
      url: "/models/movenet/model.json",
    });
  });

  it("builds the model artifacts from a model.json and its shards in order", () => {
    const first = new Uint8Array([1, 2, 3]);
    const second = new Uint8Array([9, 8, 7, 6]).subarray(1, 3);
    const third = new Uint8Array([5]).buffer;
    const source = resolvePoseModelSource({
      modelJson,
      weights: [first, second, third],
    });

    expect(source.kind).toBe("memory");
    if (source.kind !== "memory") return;
    expect(source.artifacts.modelTopology).toBe(modelJson.modelTopology);
    expect(
      source.artifacts.weightSpecs.map(
        (spec) => (spec as { name: string }).name,
      ),
    ).toEqual(["a", "b", "c"]);
    expect([...new Uint8Array(source.artifacts.weightData)]).toEqual([
      1, 2, 3, 8, 7, 5,
    ]);
    expect(source.artifacts).toMatchObject({
      format: "graph-model",
      generatedBy: "2.7.0",
      convertedBy: null,
      signature: { inputs: {} },
    });
  });

  it("takes all the weights as one buffer too", () => {
    const source = resolvePoseModelSource({
      modelJson,
      weights: new Uint8Array([4, 4]).buffer,
    });
    expect(
      source.kind === "memory" && source.artifacts.weightData.byteLength,
    ).toBe(2);
  });

  it("refuses a malformed setting instead of quietly going to TF Hub", () => {
    for (const value of [
      "model.json",
      { url: "" },
      { url: 42 },
      {},
      { modelJson: {}, weights: [new ArrayBuffer(1)] },
      { modelJson, weights: [] },
      { modelJson, weights: ["not bytes"] },
    ]) {
      expect(
        () => resolvePoseModelSource(value),
        JSON.stringify(value),
      ).toThrow(PoseModelConfigError);
    }
  });
});
