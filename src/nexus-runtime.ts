/**
 * Nexus Runtime — 突破驱动，不是目标驱动
 *
 * 旧 TriOrchestrator：推理→探索→进化→收敛到 FINAL ANSWER
 * 新 Nexus Runtime：
 *   1. 解构当前认知框架（ContinuousDeconstruction）
 *   2. 种群进化（EvolutionEngine）
 *   3. 突破检测：发现新物种/新能力
 *   4. 将突破注入下一轮
 *   5. 永不收敛，持续突破
 *
 * 没有 FINAL ANSWER。只有持续的突破和新生。
 */

import { readFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { ContinuousDeconstruction, type Deconstruction } from "./deconstruction";
import { EvolutionEngine, type SelectionPressure } from "./evolution";
import type { LLMClient } from "./llm";

// ============================================================
// Types
// ============================================================

export interface NexusResult {
  cycles: number;
  deconstructions: Deconstruction[];
  breakthroughs: string[];
  species: string[];
  stats: {
    organisms: number;
    mutations: number;
    novelMutations: number;
    speciesCount: number;
    maxDepth: number;
  };
}

// ============================================================
// Nexus Runtime
// ============================================================

export interface NexusRuntimeConfig {
  maxCycles: number;
  evolution: {
    populationSize: number;
    mutationRate: number;
    extinctionThreshold: number;
    maxPopulation: number;
  };
  tools: Array<{
    name: string;
    description: string;
    execute: (params: Record<string, unknown>) => Promise<unknown>;
  }>;
}

export class NexusRuntime {
  private config: NexusRuntimeConfig;
  private llm: LLMClient;
  private deconstruction: ContinuousDeconstruction;
  private evolution: EvolutionEngine;

  constructor(config: NexusRuntimeConfig, llm: LLMClient) {
    this.config = config;
    this.llm = llm;

    this.deconstruction = new ContinuousDeconstruction(
      (messages) => llm.chat(messages as any),
      config.maxCycles
    );

    this.evolution = new EvolutionEngine(
      config.evolution,
      (messages) => llm.chat(messages as any)
    );
  }

  /**
   * 启动运行
   * 没有返回"最终答案"，只有突破记录
   */
  async run(task: string): Promise<NexusResult> {
    console.log(`\n${"=".repeat(60)}`);
    console.log(`  NEXUS — Breakthrough-Driven Runtime`);
    console.log(`  Task: ${task.slice(0, 80)}...`);
    console.log(`${"=".repeat(60)}`);

    // Phase 1: 初始化进化种群
    await this.evolution.seed();

    // Phase 2: 连续解构
    const deconstructions = await this.deconstruction.run();

    // Phase 3: 将解构结果转化为选择压力
    for (const d of deconstructions) {
      if (d.dismantled.contradictions.length > 0) {
        this.evolution.applyPressure({
          source: `contradiction-cycle-${d.cycle}`,
          intensity: Math.min(d.dismantled.contradictions.length * 2, 10),
          description: d.dismantled.contradictions.join("; "),
        });
      }
      if (d.dismantled.blindSpots.length > 0) {
        this.evolution.applyPressure({
          source: `blindspot-cycle-${d.cycle}`,
          intensity: Math.min(d.dismantled.blindSpots.length * 2, 10),
          description: d.dismantled.blindSpots.join("; "),
        });
      }
    }

    // Phase 4: 进化循环
    for (let i = 0; i < this.config.maxCycles; i++) {
      // 突变
      const alive = this.evolution.getAlive();
      for (const organism of alive) {
        const mutated = await this.evolution.mutate(organism);
        if (mutated.id !== organism.id) {
          // 新有机体诞生
        }
      }

      // 选择
      const selectionResult = this.evolution.select();

      // 突破检测
      const breakthroughs = this.evolution.detectBreakthroughs();

      // 物种形成（每 3 代一次）
      if (i % 3 === 0) {
        await this.evolution.formSpecies();
      }

      // 检查是否还有活跃进化
      if (selectionResult.survived === 0) {
        console.log("[Nexus] All organisms extinct. Restarting population...");
        await this.evolution.seed();
      }
    }

    // Phase 5: 最终物种形成
    const species = await this.evolution.formSpecies();

    // 收集结果
    const stats = this.evolution.getStats();
    const breakthroughs = this.evolution.detectBreakthroughs();
    const maxDepth = deconstructions.length > 0
      ? Math.max(...deconstructions.map(d => d.rebuilt.depthReached))
      : 0;

    const result: NexusResult = {
      cycles: deconstructions.length,
      deconstructions,
      breakthroughs: breakthroughs.map(b => `${b.id.slice(0, 8)}: ${b.genome.perception.slice(0, 30)}...`),
      species: species.map(s => `${s.archetype} (${s.members.length} members)`),
      stats: {
        organisms: stats.aliveOrganisms,
        mutations: stats.totalMutations,
        novelMutations: stats.novelMutations,
        speciesCount: stats.speciesCount,
        maxDepth,
      },
    };

    return result;
  }
}


