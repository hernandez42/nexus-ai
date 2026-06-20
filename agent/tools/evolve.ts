import { defineTool } from "eve/tools";
import { z } from "zod";
import { EvolutionEngine } from "../../src/evolution";

const evolution = new EvolutionEngine(
  { populationSize: 3, mutationRate: 0.5, extinctionThreshold: 10, maxPopulation: 8 },
  async () => "evolved"
);

export default defineTool({
  description: "Run one cycle of genetic evolution to improve agent capabilities.",
  inputSchema: z.object({
    iterations: z.number().min(1).max(10).optional().describe("Number of evolution cycles"),
    pressureSource: z.string().optional().describe("Source of selection pressure"),
    pressureIntensity: z.number().min(0).max(10).optional().describe("Intensity of selection pressure"),
  }),
  async execute(input) {
    await evolution.seed();

    const iterations = input.iterations || 1;
    for (let i = 0; i < iterations; i++) {
      const alive = evolution.getAlive();
      for (const org of alive) {
        await evolution.mutate(org);
      }
      evolution.select();
    }

    if (input.pressureSource) {
      evolution.applyPressure({
        source: input.pressureSource,
        intensity: input.pressureIntensity || 5,
        description: `Evolution pressure from ${input.pressureSource}`,
      });
    }

    const breakthroughs = evolution.detectBreakthroughs();
    const species = await evolution.formSpecies();

    return {
      organisms: evolution.getAlive().length,
      species: species.length,
      breakthroughs: breakthroughs.length,
      iterations,
    };
  },
});
