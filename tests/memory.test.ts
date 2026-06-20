import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MemoryStore } from "../src/memory";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

describe("MemoryStore", () => {
  let dir: string;
  let store: MemoryStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "nexus-test-"));
    store = new MemoryStore(dir);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("should add and retrieve entries", () => {
    const id = store.add({
      layer: "semantic",
      content: "test knowledge",
      tags: ["test"],
      metadata: {},
    });

    const entry = store.get(id);
    expect(entry).toBeDefined();
    expect(entry?.content).toBe("test knowledge");
  });

  it("should query by similarity", () => {
    store.add({ layer: "semantic", content: "machine learning is cool", tags: ["ml"], metadata: {} });
    store.add({ layer: "semantic", content: "deep neural networks", tags: ["dl"], metadata: {} });
    store.add({ layer: "episodic", content: "I ate breakfast", tags: ["food"], metadata: {} });

    const results = store.query({ text: "neural network", topK: 2 });
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].entry.content).toContain("neural");
  });

  it("should filter by layer", () => {
    store.add({ layer: "semantic", content: "fact A", tags: [], metadata: {} });
    store.add({ layer: "episodic", content: "event B", tags: [], metadata: {} });

    const semantic = store.query({ text: "fact event", layer: "semantic", topK: 5 });
    expect(semantic.length).toBe(1);
    expect(semantic[0].entry.layer).toBe("semantic");
  });

  it("should persist and reload", () => {
    store.add({ layer: "procedural", content: "how to code", tags: ["skill"], metadata: {} });
    store.save();

    const store2 = new MemoryStore(dir);
    expect(store2.stats().total).toBe(1);
  });
});
