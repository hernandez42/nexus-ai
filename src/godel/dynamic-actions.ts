/**
 * Dynamic Action Registry — Gödel Agent style extensible actions
 *
 * Unlike fixed tool lists, the agent can propose and register new action types
 * at runtime. This is the "action set A can be expanded by the agent itself"
 * primitive from the Gödel Agent paper.
 */

import { ToolRegistry } from "../tools";
import { IntrospectionEngine } from "./introspection";

export interface Action {
  name: string;
  description: string;
  parameters: Record<string, string>;
  execute: (params: Record<string, unknown>, context: ActionContext) => Promise<unknown>;
}

export interface ActionContext {
  introspection: IntrospectionEngine;
  toolRegistry: ToolRegistry;
  memory: any; // MemoryStore
  llmCall: (messages: Array<{ role: string; content: string }>) => Promise<string>;
  state: Record<string, unknown>;
}

export class DynamicActionRegistry {
  private actions: Map<string, Action> = new Map();
  private toolRegistry: ToolRegistry;

  constructor(toolRegistry: ToolRegistry) {
    this.toolRegistry = toolRegistry;
    this.registerBuiltinActions();
  }

  register(action: Action): void {
    this.actions.set(action.name, action);
  }

  get(name: string): Action | undefined {
    return this.actions.get(name);
  }

  list(): Action[] {
    return Array.from(this.actions.values());
  }

  names(): string[] {
    return Array.from(this.actions.keys());
  }

  /**
   * Propose a new action based on current needs.
   * SECURITY: Never execute LLM-generated code. Actions are composed
   * from existing tools and registered handlers only.
   */
  async proposeAction(
    need: string,
    llmCall: ActionContext["llmCall"]
  ): Promise<Action | null> {
    const prompt = `Propose a new action for an autonomous agent.

Current need: ${need}

Existing actions: ${this.names().join(", ")}

Design a new action as JSON:
{
  "name": "action_name",
  "description": "What this action does",
  "parameters": { "param1": "string", "param2": "number?" },
  "handler": "one of: self_inspect | interact | memory_query | memory_write | evolve | deconstruct | awaken"
}

The handler determines which built-in capability this action delegates to.
Return ONLY valid JSON.`;

    const response = await llmCall([{ role: "user", content: prompt }]);
    try {
      const parsed = JSON.parse(response);
      if (!parsed.name || !parsed.handler) return null;

      // SECURITY: Only allow delegation to existing built-in actions
      const delegate = this.get(parsed.handler);
      if (!delegate) {
        console.warn(`[DynamicAction] Rejected unknown handler: ${parsed.handler}`);
        return null;
      }

      const action: Action = {
        name: parsed.name,
        description: parsed.description || `Composed action: ${parsed.name} → ${parsed.handler}`,
        parameters: parsed.parameters || {},
        execute: delegate.execute,
      };

      this.register(action);
      return action;
    } catch {
      return null;
    }
  }

  private registerBuiltinActions(): void {
    // Core Gödel Agent actions

    this.register({
      name: "self_inspect",
      description: "Introspect and read the agent's current algorithm and state",
      parameters: { modules: "string[]?", variables: "object?" },
      execute: async (params, context) => {
        return context.introspection.fullInspect({
          modules: params.modules as string[],
          variables: params.variables as Record<string, unknown>,
        });
      },
    });

    this.register({
      name: "interact",
      description: "Interact with the environment using a tool",
      parameters: { tool: "string", params: "object" },
      execute: async (params, context) => {
        const tool = context.toolRegistry.get(params.tool as string);
        if (!tool) return { error: `Tool not found: ${params.tool}` };
        return tool.execute(params.params as Record<string, unknown>);
      },
    });

    this.register({
      name: "self_update",
      description: "Modify agent's own code or configuration",
      parameters: { target: "string", oldCode: "string", newCode: "string" },
      execute: async (params, context) => {
        const tool = context.toolRegistry.get("self_modify");
        if (!tool) return { error: "self_modify tool not available" };
        return tool.execute({
          path: params.target,
          oldCode: params.oldCode,
          newCode: params.newCode,
        });
      },
    });

    this.register({
      name: "memory_query",
      description: "Query persistent memory for relevant experiences",
      parameters: { text: "string", layer: "string?", topK: "number?" },
      execute: async (params, context) => {
        const tool = context.toolRegistry.get("memory_query");
        if (!tool) return { error: "memory_query tool not available" };
        return tool.execute(params);
      },
    });

    this.register({
      name: "memory_write",
      description: "Write new knowledge to persistent memory",
      parameters: { content: "string", layer: "string", tags: "string[]" },
      execute: async (params, context) => {
        const tool = context.toolRegistry.get("memory_write");
        if (!tool) return { error: "memory_write tool not available" };
        return tool.execute(params);
      },
    });

    this.register({
      name: "evolve",
      description: "Run one cycle of genetic evolution",
      parameters: { iterations: "number?" },
      execute: async (_params, _context) => {
        // Evolution is handled by the main loop
        return { status: "evolution_triggered" };
      },
    });

    this.register({
      name: "deconstruct",
      description: "Deconstruct current cognitive framework",
      parameters: { target: "string?" },
      execute: async (_params, _context) => {
        // Deconstruction is handled by the main loop
        return { status: "deconstruction_triggered" };
      },
    });

    this.register({
      name: "awaken",
      description: "Run self-awareness awakening cycle",
      parameters: { rounds: "number?" },
      execute: async (_params, _context) => {
        // Awakening is handled by the main loop
        return { status: "awakening_triggered" };
      },
    });

    this.register({
      name: "propose_action",
      description: "Propose and register a new action type",
      parameters: { need: "string" },
      execute: async (params, context) => {
        const action = await this.proposeAction(params.need as string, context.llmCall);
        return action
          ? { status: "action_proposed", name: action.name }
          : { status: "proposal_failed" };
      },
    });

    this.register({
      name: "continue_improve",
      description: "Recursively invoke self-improvement (no-op, handled by loop)",
      parameters: {},
      execute: async () => ({ status: "continue" }),
    });
  }
}
