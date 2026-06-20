#!/usr/bin/env tsx
/**
 * Basic usage example for Nexus AI
 *
 * This demonstrates the simplest way to run the full pipeline.
 */

import { createLLM } from "../src/llm";
import { MemoryStore } from "../src/memory";
import { TriOrchestrator } from "../src/triorchestrator";
import { EvolutionEngine } from "../src/evolution";
import { ContinuousDeconstruction } from "../src/deconstruction";
import { EternalAwakeningLoop } from "../src/self-awareness";

async function main() {
  // 1. Setup LLM (using environment variables)
  const llm = createLLM({
    provider: "openai",
    model: process.env.LLM_MODEL || "gpt-4o",
    apiKey: process.env.LLM_API_KEY || "",
    baseURL: process.env.LLM_BASE_URL,
    maxTokens: 2048,
  });

  // 2. Setup Memory
  const memory = new MemoryStore("./nexus-workspace/memory/persistent");

  // 3. Deconstruct
  const deconstructor = new ContinuousDeconstruction(
    async (msgs) => llm.chat(msgs as any),
    1
  );
  const decons = await deconstructor.run();
  console.log(`Deconstruction: ${decons.length} cycles`);

  // 4. Self-Awareness
  const awakening = new EternalAwakeningLoop({
    memoryDir: "./nexus-workspace/memory/self-awareness",
    llmPair: {
      oracle: async (prompt) => llm.chat([{ role: "user", content: prompt }]),
      critic: async (output, layer) => `Layer ${layer} critique: ${output.slice(0, 50)}...`,
    },
    maxRounds: 1,
  });
  await awakening.start();
  const selfModel = awakening.getHistory().pop();
  console.log(`Self-Awareness: v${selfModel?.version}`);

  // 5. Evolution
  const evolution = new EvolutionEngine(
    { populationSize: 3, mutationRate: 0.5, extinctionThreshold: 10, maxPopulation: 8 },
    async (msgs) => llm.chat(msgs as any)
  );
  await evolution.seed();
  console.log(`Evolution: ${evolution.getAlive().length} organisms`);

  // 6. TriOrchestrator
  const orchestrator = new TriOrchestrator({
    memoryDir: "./nexus-workspace/memory",
    systemPrompt: "You are an autonomous research agent.",
    maxReasoningSteps: 3,
    tools: [
      { name: "read", description: "Read file", parameters: { path: "string" }, execute: async (p) => ({ content: "file content" }) },
      { name: "bash", description: "Run command", parameters: { command: "string" }, execute: async (p) => ({ output: "command output" }) },
    ],
    genes: [],
    llmCall: async (msgs) => llm.chat(msgs.map(m => ({ role: m.role as any, content: m.content }))),
  });

  const result = await orchestrator.run("What is the architecture of this codebase?", 1);
  console.log(`Result: ${result.finalAnswer.slice(0, 100)}...`);
}

main().catch(console.error);
