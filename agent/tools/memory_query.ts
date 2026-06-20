import { defineTool } from "eve/tools";
import { z } from "zod";
import { MemoryStore } from "../../src/memory";

const memory = new MemoryStore("./nexus-workspace/memory/persistent");

export default defineTool({
  description: "Query the persistent memory store for relevant experiences and knowledge.",
  inputSchema: z.object({
    text: z.string().describe("The query text to search for"),
    layer: z.enum(["episodic", "semantic", "procedural"]).optional().describe("Memory layer to search"),
    topK: z.number().min(1).max(20).optional().describe("Number of results to return"),
  }),
  async execute(input) {
    const results = memory.query({
      text: input.text,
      layer: input.layer,
      topK: input.topK || 5,
    });
    return {
      count: results.length,
      results: results.map(r => ({
        id: r.entry.id,
        layer: r.entry.layer,
        content: r.entry.content.slice(0, 200),
        similarity: r.similarity,
      })),
    };
  },
});
