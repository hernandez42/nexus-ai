/**
 * Runtime Introspection — Gödel Agent style self-awareness
 *
 * Provides the agent with the ability to inspect its own:
 *   - Source code (any module)
 *   - Runtime call stack
 *   - Current variable states
 *   - Memory store contents
 *   - Evolution engine state
 *
 * This is the "SELF_INSPECT" primitive from the Gödel Agent paper.
 */

import { readFileSync, existsSync } from "fs";
import { MemoryStore } from "../memory";

export interface IntrospectionResult {
  sourceCode: Record<string, string>;
  callStack: string[];
  runtimeState: Record<string, unknown>;
  memorySnapshot: {
    total: number;
    episodic: number;
    semantic: number;
    procedural: number;
    recent: Array<{ id: string; content: string; layer: string }>;
  };
  evolutionState?: {
    organisms: number;
    species: number;
    breakthroughs: number;
  };
}

export class IntrospectionEngine {
  private memory: MemoryStore;
  private sourceDir: string;

  constructor(memory: MemoryStore, sourceDir: string = "./src") {
    this.memory = memory;
    this.sourceDir = sourceDir;
  }

  /**
   * Read source code of any module
   */
  inspectModule(modulePath: string): string {
    const fullPath = modulePath.startsWith("/")
      ? modulePath
      : `${this.sourceDir}/${modulePath}`;
    if (!existsSync(fullPath)) {
      throw new Error(`Module not found: ${fullPath}`);
    }
    return readFileSync(fullPath, "utf-8");
  }

  /**
   * Get current call stack (V8 stack trace)
   */
  getCallStack(): string[] {
    const stack = new Error().stack || "";
    return stack
      .split("\n")
      .slice(2) // Skip Error constructor and this function
      .map(line => line.trim())
      .filter(line => line.startsWith("at "));
  }

  /**
   * Capture runtime state of key variables
   */
  captureState(variables: Record<string, unknown>): Record<string, unknown> {
    const state: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(variables)) {
      try {
        if (typeof value === "function") {
          state[key] = `[Function: ${value.name || "anonymous"}]`;
        } else if (value && typeof value === "object") {
          // Limit depth to avoid circular references
          state[key] = JSON.parse(JSON.stringify(value, null, 2));
        } else {
          state[key] = value;
        }
      } catch {
        state[key] = `[Unserializable: ${typeof value}]`;
      }
    }
    return state;
  }

  /**
   * Get memory store snapshot
   */
  getMemorySnapshot(): IntrospectionResult["memorySnapshot"] {
    const stats = this.memory.stats();
    const recent = this.memory
      .query({ text: "", topK: 10 })
      .map(r => ({
        id: r.entry.id,
        content: r.entry.content.slice(0, 100),
        layer: r.entry.layer,
      }));

    return {
      total: stats.total,
      episodic: stats.episodic,
      semantic: stats.semantic,
      procedural: stats.procedural,
      recent,
    };
  }

  /**
   * Full self-inspection — the SELF_INSPECT primitive
   */
  fullInspect(options: {
    modules?: string[];
    variables?: Record<string, unknown>;
    includeEvolution?: boolean;
  } = {}): IntrospectionResult {
    const result: IntrospectionResult = {
      sourceCode: {},
      callStack: this.getCallStack(),
      runtimeState: {},
      memorySnapshot: this.getMemorySnapshot(),
    };

    // Inspect requested modules
    if (options.modules) {
      for (const mod of options.modules) {
        try {
          result.sourceCode[mod] = this.inspectModule(mod);
        } catch (e: unknown) {
          result.sourceCode[mod] = `Error: ${e instanceof Error ? e.message : String(e)}`;
        }
      }
    }

    // Capture runtime state
    if (options.variables) {
      result.runtimeState = this.captureState(options.variables);
    }

    return result;
  }
}
