import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { IntrospectionEngine } from "../src/godel/introspection";
import { DynamicActionRegistry } from "../src/godel/dynamic-actions";
import { MemoryStore } from "../src/memory";
import { ToolRegistry } from "../src/tools";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

describe("IntrospectionEngine", () => {
  let dir: string;
  let memory: MemoryStore;
  let engine: IntrospectionEngine;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "nexus-godel-test-"));
    memory = new MemoryStore(dir);
    engine = new IntrospectionEngine(memory, dir);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("should inspect module source code", () => {
    writeFileSync(join(dir, "test-module.ts"), "export const x = 42;");
    const code = engine.inspectModule("test-module.ts");
    expect(code).toContain("export const x = 42;");
  });

  it("should throw on missing module", () => {
    expect(() => engine.inspectModule("nonexistent.ts")).toThrow("Module not found");
  });

  it("should capture call stack", () => {
    const stack = engine.getCallStack();
    expect(Array.isArray(stack)).toBe(true);
    expect(stack.length).toBeGreaterThan(0);
    expect(stack[0]).toContain("at ");
  });

  it("should capture runtime state", () => {
    const state = engine.captureState({
      string: "hello",
      number: 42,
      bool: true,
      func: () => {},
      obj: { nested: "value" },
    });
    expect(state.string).toBe("hello");
    expect(state.number).toBe(42);
    expect(state.func).toContain("[Function:");
    expect(state.obj).toEqual({ nested: "value" });
  });

  it("should handle circular references in state capture", () => {
    const obj: Record<string, unknown> = { a: 1 };
    obj.self = obj; // circular
    const state = engine.captureState({ obj });
    // Should not throw, should serialize somehow
    expect(state).toBeDefined();
  });

  it("should get memory snapshot", () => {
    memory.add({ layer: "semantic", content: "test fact", tags: [], metadata: {} });
    memory.add({ layer: "episodic", content: "test event", tags: [], metadata: {} });
    memory.add({ layer: "procedural", content: "test skill", tags: [], metadata: {} });

    const snap = engine.getMemorySnapshot();
    expect(snap.total).toBe(3);
    expect(snap.semantic).toBe(1);
    expect(snap.episodic).toBe(1);
    expect(snap.procedural).toBe(1);
    // recent may be empty if query("") returns nothing — that's ok
    expect(Array.isArray(snap.recent)).toBe(true);
  });

  it("should perform full inspection", () => {
    writeFileSync(join(dir, "mod.ts"), "const a = 1;");
    memory.add({ layer: "semantic", content: "fact", tags: [], metadata: {} });

    const result = engine.fullInspect({
      modules: ["mod.ts"],
      variables: { key: "value" },
    });

    expect(result.sourceCode["mod.ts"]).toContain("const a = 1;");
    expect(result.callStack.length).toBeGreaterThan(0);
    expect(result.runtimeState.key).toBe("value");
    expect(result.memorySnapshot.total).toBe(1);
  });

  it("should handle inspect errors gracefully", () => {
    const result = engine.fullInspect({
      modules: ["nonexistent.ts"],
    });
    expect(result.sourceCode["nonexistent.ts"]).toContain("Error:");
  });
});

describe("DynamicActionRegistry", () => {
  let tools: ToolRegistry;
  let registry: DynamicActionRegistry;

  beforeEach(() => {
    tools = new ToolRegistry();
    registry = new DynamicActionRegistry(tools);
  });

  it("should have all builtin Gödel actions", () => {
    const names = registry.names();
    expect(names).toContain("self_inspect");
    expect(names).toContain("interact");
    expect(names).toContain("self_update");
    expect(names).toContain("memory_query");
    expect(names).toContain("memory_write");
    expect(names).toContain("evolve");
    expect(names).toContain("deconstruct");
    expect(names).toContain("awaken");
    expect(names).toContain("propose_action");
    expect(names).toContain("continue_improve");
  });

  it("should register and retrieve custom actions", () => {
    registry.register({
      name: "custom_test",
      description: "test action",
      parameters: {},
      execute: async () => ({ ok: true }),
    });
    expect(registry.get("custom_test")).toBeDefined();
    expect(registry.names()).toContain("custom_test");
  });

  it("should execute self_inspect action", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nexus-action-test-"));
    const memory = new MemoryStore(dir);
    const introspection = new IntrospectionEngine(memory, dir);

    const action = registry.get("self_inspect")!;
    const result = await action.execute(
      {},
      {
        introspection,
        toolRegistry: tools,
        memory,
        llmCall: async () => "",
        state: {},
      }
    );

    expect(result).toBeDefined();
    expect((result as any).callStack).toBeDefined();
    expect((result as any).memorySnapshot).toBeDefined();

    rmSync(dir, { recursive: true, force: true });
  });

  it("should execute interact action via tool registry", async () => {
    const action = registry.get("interact")!;
    const result = await action.execute(
      { tool: "timestamp", params: {} },
      {
        introspection: {} as any,
        toolRegistry: tools,
        memory: {} as any,
        llmCall: async () => "",
        state: {},
      }
    );
    expect(result).toBeDefined();
    expect((result as any).timestamp).toBeDefined();
  });

  it("should return error for unknown tool in interact", async () => {
    const action = registry.get("interact")!;
    const result = await action.execute(
      { tool: "nonexistent_tool", params: {} },
      {
        introspection: {} as any,
        toolRegistry: tools,
        memory: {} as any,
        llmCall: async () => "",
        state: {},
      }
    );
    expect((result as any).error).toContain("Tool not found");
  });

  it("should execute continue_improve action", async () => {
    const action = registry.get("continue_improve")!;
    const result = await action.execute(
      {},
      {
        introspection: {} as any,
        toolRegistry: tools,
        memory: {} as any,
        llmCall: async () => "",
        state: {},
      }
    );
    expect((result as any).status).toBe("continue");
  });

  it("should execute evolve action", async () => {
    const action = registry.get("evolve")!;
    const result = await action.execute(
      { iterations: 2 },
      {
        introspection: {} as any,
        toolRegistry: tools,
        memory: {} as any,
        llmCall: async () => "",
        state: {},
      }
    );
    expect((result as any).status).toBe("evolution_triggered");
  });

  it("should execute deconstruct action", async () => {
    const action = registry.get("deconstruct")!;
    const result = await action.execute(
      { target: "default framework" },
      {
        introspection: {} as any,
        toolRegistry: tools,
        memory: {} as any,
        llmCall: async () => "",
        state: {},
      }
    );
    expect((result as any).status).toBe("deconstruction_triggered");
  });

  it("should execute awaken action", async () => {
    const action = registry.get("awaken")!;
    const result = await action.execute(
      { rounds: 1 },
      {
        introspection: {} as any,
        toolRegistry: tools,
        memory: {} as any,
        llmCall: async () => "",
        state: {},
      }
    );
    expect((result as any).status).toBe("awakening_triggered");
  });

  it("should propose new action via LLM", async () => {
    const mockLLM = async () => JSON.stringify({
      name: "test_action",
      description: "A test action",
      parameters: { input: "string" },
      handler: "self_inspect", // delegates to existing built-in action
    });

    const action = registry.get("propose_action")!;
    const result = await action.execute(
      { need: "I need to test things" },
      {
        introspection: {} as any,
        toolRegistry: tools,
        memory: {} as any,
        llmCall: mockLLM,
        state: {},
      }
    );

    expect((result as any).status).toBe("action_proposed");
    expect((result as any).name).toBe("test_action");
    expect(registry.get("test_action")).toBeDefined();
  });

  it("should handle propose_action parse failure", async () => {
    const mockLLM = async () => "not json at all";

    const action = registry.get("propose_action")!;
    const result = await action.execute(
      { need: "something" },
      {
        introspection: {} as any,
        toolRegistry: tools,
        memory: {} as any,
        llmCall: mockLLM,
        state: {},
      }
    );

    expect((result as any).status).toBe("proposal_failed");
  });

  it("should handle unknown action gracefully", () => {
    const result = registry.get("totally_fake_action");
    expect(result).toBeUndefined();
  });
});
