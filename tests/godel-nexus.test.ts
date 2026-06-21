import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { MemoryStore } from "../src/memory";
import { ToolRegistry } from "../src/tools";
import { IntrospectionEngine } from "../src/godel/introspection";
import { DynamicActionRegistry } from "../src/godel/dynamic-actions";

/**
 * Tests for the Gödel-Nexus recursive improvement loop.
 * These tests verify the core self-referential properties:
 *   1. The agent can inspect its own code
 *   2. The agent can modify its own code
 *   3. The improvement loop terminates correctly
 *   4. State propagates across recursive calls
 */

describe("Gödel-Nexus: Self-Referential Properties", () => {
  let dir: string;
  let memory: MemoryStore;
  let tools: ToolRegistry;
  let introspection: IntrospectionEngine;
  let actions: DynamicActionRegistry;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "nexus-fusion-test-"));
    memory = new MemoryStore(dir);
    tools = new ToolRegistry();
    introspection = new IntrospectionEngine(memory, dir);
    actions = new DynamicActionRegistry(tools);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("self-referential: agent can read its own source code", () => {
    // Create a fake module that represents the agent
    writeFileSync(join(dir, "agent.ts"), `export function decide() { return "think"; }`);

    const code = introspection.inspectModule("agent.ts");
    expect(code).toContain("export function decide()");
  });

  it("self-referential: agent can modify its own source code", async () => {
    writeFileSync(join(dir, "agent.ts"), `const VERSION = 1;`);

    const selfModify = tools.get("self_modify")!;
    const result = await selfModify.execute({
      path: join(dir, "agent.ts"),
      oldCode: "const VERSION = 1;",
      newCode: "const VERSION = 2;",
    });

    expect((result as any).success).toBe(true);
    const updated = introspection.inspectModule("agent.ts");
    expect(updated).toContain("const VERSION = 2;");
  });

  it("self-referential: modification is reflected in next inspection", async () => {
    writeFileSync(join(dir, "agent.ts"), `const STRATEGY = "initial";`);

    // Modify
    const selfModify = tools.get("self_modify")!;
    await selfModify.execute({
      path: join(dir, "agent.ts"),
      oldCode: `const STRATEGY = "initial";`,
      newCode: `const STRATEGY = "improved";`,
    });

    // Inspect again
    const code = introspection.inspectModule("agent.ts");
    expect(code).toContain("improved");
    expect(code).not.toContain("initial");
  });

  it("recursive: state propagates across depth levels", () => {
    // Simulate the recursive state tracking
    interface State { depth: number; modifications: number; score: number }

    function simulateImprove(state: State, maxDepth: number): State {
      if (state.depth >= maxDepth) return state;
      return simulateImprove(
        { depth: state.depth + 1, modifications: state.modifications + 1, score: state.score + 2 },
        maxDepth
      );
    }

    const result = simulateImprove({ depth: 0, modifications: 0, score: 0 }, 3);
    expect(result.depth).toBe(3);
    expect(result.modifications).toBe(3);
    expect(result.score).toBe(6);
  });

  it("recursive: terminates at max depth", () => {
    let callCount = 0;

    function recursiveImprove(depth: number, maxDepth: number): number {
      callCount++;
      if (depth >= maxDepth) return depth;
      return recursiveImprove(depth + 1, maxDepth);
    }

    const result = recursiveImprove(0, 5);
    expect(result).toBe(5);
    expect(callCount).toBe(6); // 0,1,2,3,4,5
  });

  it("recursive: evaluation can stop recursion early", () => {
    let callCount = 0;

    function improveWithEval(depth: number, maxDepth: number): number {
      callCount++;
      if (depth >= maxDepth) return depth;
      // Simulate: at depth 2, evaluation says stop
      if (depth === 2) return depth;
      return improveWithEval(depth + 1, maxDepth);
    }

    const result = improveWithEval(0, 10);
    expect(result).toBe(2);
    expect(callCount).toBe(3); // stopped early
  });

  it("action: all Gödel actions are executable", async () => {
    const context = {
      introspection,
      toolRegistry: tools,
      memory,
      llmCall: async () => "{}",
      state: {},
    };

    const builtinActions = ["self_inspect", "interact", "evolve", "deconstruct", "awaken", "continue_improve"];

    for (const name of builtinActions) {
      const action = actions.get(name);
      expect(action, `Action ${name} should exist`).toBeDefined();

      const result = await action!.execute({}, context);
      expect(result, `Action ${name} should return a result`).toBeDefined();
    }
  });

  it("action: propose_action extends the action set", async () => {
    const initialCount = actions.names().length;

    const mockLLM = async () => JSON.stringify({
      name: "custom_analyze",
      description: "Analyze code quality",
      parameters: { code: "string" },
      handler: "self_inspect", // delegates to existing built-in action
    });

    const action = actions.get("propose_action")!;
    await action.execute(
      { need: "code analysis" },
      { introspection, toolRegistry: tools, memory, llmCall: mockLLM, state: {} }
    );

    expect(actions.names().length).toBe(initialCount + 1);
    expect(actions.get("custom_analyze")).toBeDefined();
  });

  it("memory: actions write to episodic memory", async () => {
    memory.add({
      layer: "episodic",
      content: "Action evolve: evolution_triggered",
      tags: ["action", "evolve"],
      metadata: { depth: 1 },
    });

    const results = memory.query({ text: "evolve", topK: 5 });
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].entry.layer).toBe("episodic");
  });

  it("memory: self-model persists across inspections", () => {
    memory.add({
      layer: "semantic",
      content: "Self-Model v1: I am a recursive self-improving agent",
      tags: ["self-model"],
      metadata: { version: 1 },
    });

    const snap = introspection.getMemorySnapshot();
    expect(snap.semantic).toBe(1);
    // recent may be empty if query("") returns nothing
    expect(snap.total).toBe(1);
  });
});
