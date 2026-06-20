import { defineTool } from "eve/tools";
import { z } from "zod";
import { IntrospectionEngine } from "../../src/godel/introspection";
import { MemoryStore } from "../../src/memory";

const memory = new MemoryStore("./nexus-workspace/memory/persistent");
const introspection = new IntrospectionEngine(memory, "./src");

export default defineTool({
  description: "Introspect and read the agent's own source code, call stack, and runtime state.",
  inputSchema: z.object({
    modules: z.array(z.string()).optional().describe("Source file paths to inspect"),
    variables: z.record(z.any()).optional().describe("Runtime variables to capture"),
  }),
  async execute(input) {
    const result = introspection.fullInspect({
      modules: input.modules,
      variables: input.variables,
    });
    return {
      modulesInspected: Object.keys(result.sourceCode).length,
      callStackDepth: result.callStack.length,
      memoryEntries: result.memorySnapshot.total,
      sourceCode: result.sourceCode,
      runtimeState: result.runtimeState,
    };
  },
});
