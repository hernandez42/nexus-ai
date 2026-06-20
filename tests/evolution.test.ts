import { describe, it, expect } from "vitest";
import { EvolutionEngine } from "../src/evolution";

describe("EvolutionEngine", () => {
  const mockLLM = async () => JSON.stringify({
    perception: ["detect patterns"],
    reasoning: ["logical deduction"],
    action: ["plan carefully"],
    reflection: ["audit outcomes"],
  });

  it("should seed population", async () => {
    const engine = new EvolutionEngine({
      populationSize: 3,
      mutationRate: 0.5,
      extinctionThreshold: 10,
      maxPopulation: 8,
    }, mockLLM);

    await engine.seed();
    expect(engine.getAlive().length).toBe(3);
  });

  it("should apply pressure and select", async () => {
    const engine = new EvolutionEngine({
      populationSize: 3,
      mutationRate: 0.5,
      extinctionThreshold: 10,
      maxPopulation: 8,
    }, mockLLM);

    await engine.seed();
    engine.applyPressure({ source: "test", intensity: 5, description: "test pressure" });
    engine.select();

    const stats = engine.getStats();
    expect(stats.aliveOrganisms).toBeLessThanOrEqual(3);
  });
});
