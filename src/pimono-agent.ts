/**
 * Pi-Mono Agent Application
 *
 * Based on @earendil-works/pi-agent-core Agent class.
 * Creates a stateful agent with tool execution, event streaming,
 * and persistent state management.
 */

import { MemoryStore } from "./memory";
import { ToolRegistry } from "./tools";
import { EvolutionEngine } from "./evolution";
import { Logger } from "./logger";

let AgentClass: any;
let piTried = false;

async function getAgentClass(): Promise<any> {
  if (piTried) return AgentClass;
  piTried = true;
  try {
    const pi = await import("@earendil-works/pi-agent-core");
    AgentClass = pi.Agent;
  } catch {
    // Pi-Mono not available — stub fallback
    AgentClass = undefined;
  }
  return AgentClass;
}

export interface PiMonoAgentConfig {
  name: string;
  systemPrompt: string;
  tools: ToolRegistry;
  memory: MemoryStore;
  evolution?: EvolutionEngine;
  log: Logger;
}

/**
 * Create a Pi-Mono based agent with Nexus AI capabilities.
 *
 * Note: Pi-Mono's Agent requires a model instance in initialState.
 * This creates the agent structure; the caller must set the model
 * before executing prompts.
 */
export async function createPiMonoAgent(config: PiMonoAgentConfig): Promise<any> {
  const cls = await getAgentClass();
  if (!cls) {
    return {
      prompt: async () => "Pi-Mono not available (package @earendil-works/pi-agent-core not installed)",
      subscribe: () => () => {},
      waitForIdle: async () => {},
    };
  }

  const agent = new cls({
    initialState: {
      systemPrompt: config.systemPrompt,
    } as any,
  });

  return agent;
}

/**
 * Run a task through the Pi-Mono agent with full Nexus context.
 *
 * Pi-Mono is event-driven: prompt() returns void, responses come via events.
 * This function collects the response from the agent_end event.
 */
export async function runPiMonoTask(
  agent: any,
  task: string,
  context: {
    memory: MemoryStore;
    tools: ToolRegistry;
    log: Logger;
  }
): Promise<string> {
  // Query memory for relevant context
  const memories = context.memory.query({ text: task, topK: 5 });
  const memoryContext = memories
    .map(m => `[${m.entry.layer}] ${m.entry.content.slice(0, 200)}`)
    .join("\n");

  // Build prompt with memory context
  const fullPrompt = [
    "## Task",
    task,
    "",
    "## Relevant Memory",
    memoryContext || "No relevant memory found.",
    "",
    "## Available Tools",
    context.tools.names().join(", "),
  ].join("\n");

  context.log.info("Pi-Mono agent executing task", { task: task.slice(0, 50) });

  // Pi-Mono is event-driven: collect response via subscribe
  let response = "";
  const unsubscribe = agent.subscribe((event: any) => {
    if (event.type === "agent_end") {
      response = event.message?.content || "";
    }
  });

  await agent.prompt(fullPrompt);
  await agent.waitForIdle();
  unsubscribe();

  // Log to memory
  context.memory.add({
    layer: "episodic",
    content: `Pi-Mono task: ${task}\nResponse: ${response.slice(0, 500)}`,
    tags: ["pimono", "task"],
    metadata: { agent: "PiMonoAgent" },
  });

  return response;
}

/**
 * Create a multi-turn conversation with Pi-Mono agent.
 */
export async function converseWithPiMono(
  agent: any,
  messages: Array<{ role: "user" | "assistant"; content: string }>,
  context: {
    memory: MemoryStore;
    log: Logger;
  }
): Promise<string> {
  const conversation = messages.map(m => `${m.role}: ${m.content}`).join("\n");

  context.log.info("Pi-Mono conversation", { turns: messages.length });

  let response = "";
  const unsubscribe = agent.subscribe((event: any) => {
    if (event.type === "agent_end") {
      response = event.message?.content || "";
    }
  });

  await agent.prompt(conversation);
  await agent.waitForIdle();
  unsubscribe();

  context.memory.add({
    layer: "episodic",
    content: `Conversation (${messages.length} turns): ${response.slice(0, 300)}`,
    tags: ["pimono", "conversation"],
    metadata: {},
  });

  return response;
}
