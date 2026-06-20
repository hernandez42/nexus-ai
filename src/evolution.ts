/**
 * Evolution Engine — 突变 + 选择压力 + 物种形成
 *
 * 核心原则：
 *   - 进化没有方向，只有突破和新生
 *   - 突变是随机的、不可预测的
 *   - 选择压力来自环境（任务失败、矛盾、意外）
 *   - 存活下来的不是"最优的"，而是"能适应的"
 *   - 物种形成：不同的生存策略形成不同的能力族群
 *
 * 与旧 GEPEngine 的区别：
 *   旧：signals_match → 确定性匹配 → 策略注入（查表）
 *   新：随机突变 → 环境选择 → 适者生存 → 物种分化
 */

import { randomUUID } from "crypto";

// ============================================================
// Types
// ============================================================

export interface Organism {
  id: string;
  lineage: string[];          // 祖先 ID 链
  generation: number;
  genome: Genome;            // 基因组
  fitness: number;           // 适应度（由环境决定，不是自评）
  age: number;               // 存活轮数
  offspring: string[];       // 子代 ID
  isAlive: boolean;
  deathReason?: string;
}

export interface Genome {
  // 认知基因
  perception: string[];       // 感知模式（关注什么信号）
  reasoning: string[];       // 推理策略（怎么思考）
  action: string[];           // 行为模式（怎么做）
  reflection: string[];      // 反思模式（怎么回顾）

  // 突变标记
  mutations: Mutation[];
}

export interface Mutation {
  id: string;
  type: "point" | "duplication" | "deletion" | "recombination" | "novel";
  locus: "perception" | "reasoning" | "action" | "reflection";
  description: string;
  parentGene?: string;       // 突变前的基因
  timestamp: number;
}

export interface SelectionPressure {
  source: string;             // 压力来源（任务失败、矛盾、意外）
  intensity: number;          // 1-10
  description: string;
}

export interface Species {
  id: string;
  archetype: string;          // 物种原型描述
  members: string[];          // 成员 Organism ID
  strategy: string;          // 核心策略
  emergenceGeneration: number;
}

// ============================================================
// Evolution Engine
// ============================================================

export interface EvolutionConfig {
  populationSize: number;     // 种群大小
  mutationRate: number;       // 突变率 0-1
  extinctionThreshold: number; // 灭绝阈值（适应度低于此值则死亡）
  maxPopulation: number;       // 最大种群（超过则竞争淘汰）
}

export class EvolutionEngine {
  private organisms: Map<string, Organism> = new Map();
  private species: Map<string, Species> = new Map();
  private pressures: SelectionPressure[] = [];
  private generation = 0;
  private config: EvolutionConfig;
  private llmCall: (messages: Array<{role: string; content: string}>) => Promise<string>;

  constructor(config: EvolutionConfig, llmCall: (messages: Array<{role: string; content: string}>) => Promise<string>) {
    this.config = config;
    this.llmCall = llmCall;
  }

  // ============================================================
  // 1. 种群初始化 — 从零开始，不是从预设 Gene
  // ============================================================

  async seed(): Promise<void> {
    console.log("[Evolution] Seeding initial population...");

    for (let i = 0; i < this.config.populationSize; i++) {
      const genome = await this.generateRandomGenome();
      const organism: Organism = {
        id: randomUUID(),
        lineage: [],
        generation: 0,
        genome,
        fitness: 0,
        age: 0,
        offspring: [],
        isAlive: true,
      };
      this.organisms.set(organism.id, organism);
    }

    console.log(`[Evolution] ${this.config.populationSize} organisms seeded with random genomes`);
  }

  private async generateRandomGenome(): Promise<Genome> {
    // 用 LLM 生成一个随机的认知基因组
    const response = await this.llmCall([
      { role: "system", content: "You generate random cognitive patterns. Be creative and diverse. No two outputs should be similar." },
      { role: "user", content: `Generate a random cognitive genome. Include exactly 3 items for each category.
Format as JSON:
{"perception": ["...", "...", "..."], "reasoning": ["...", "...", "..."], "action": ["...", "...", "..."], "reflection": ["...", "...", "..."]}` },
    ]);

    try {
      const parsed = JSON.parse(response);
      return {
        perception: parsed.perception || ["observe patterns", "detect anomalies", "track changes"],
        reasoning: ["analyze sequentially", "compare alternatives", "predict outcomes"],
        action: parsed.action || ["execute planned steps", "adapt to feedback", "try alternatives"],
        reflection: parsed.reflection || ["review outcomes", "identify gaps", "question assumptions"],
        mutations: [],
      };
    } catch {
      return {
        perception: ["observe patterns", "detect anomalies", "track changes"],
        reasoning: ["analyze sequentially", "compare alternatives", "predict outcomes"],
        action: ["execute planned steps", "adapt to feedback", "try alternatives"],
        reflection: ["review outcomes", "identify gaps", "question assumptions"],
        mutations: [],
      };
    }
  }

  // ============================================================
  // 2. 突变 — 随机的、不可预测的
  // ============================================================

  async mutate(organism: Organism): Promise<Organism> {
    if (Math.random() > this.config.mutationRate) return organism;

    const loci: Array<keyof Pick<Genome, "perception" | "reasoning" | "action" | "reflection">> =
      ["perception", "reasoning", "action", "reflection"];
    const locus = loci[Math.floor(Math.random() * loci.length)];

    const mutationTypes: Mutation["type"][] = ["point", "duplication", "deletion", "recombination", "novel"];
    const mutationType = mutationTypes[Math.floor(Math.random() * mutationTypes.length)];

    // 用 LLM 生成突变内容（不是确定性规则）
    const currentGenes = organism.genome[locus];
    const response = await this.llmCall([
      { role: "system", content: "You are a mutation engine. Generate cognitive mutations that are SURPRISING and UNEXPECTED, not incremental improvements." },
      { role: "user", content: `Current ${locus} genes: ${JSON.stringify(currentGenes)}
Mutation type: ${mutationType}
Generate a mutation. Be creative — the best mutations are ones that would never be designed on purpose.
Return JSON: {"description": "...", "newGenes": [...]}` },
    ]);

    let newGenes = [...currentGenes];
    let description = "";

    try {
      const parsed = JSON.parse(response);
      description = parsed.description || `${mutationType} mutation on ${locus}`;

      switch (mutationType) {
        case "point":
          // 修改一个现有基因
          if (currentGenes.length > 0 && parsed.newGenes?.[0]) {
            const idx = Math.floor(Math.random() * currentGenes.length);
            newGenes[idx] = parsed.newGenes[0];
          }
          break;
        case "duplication":
          // 复制一个基因并变异
          if (currentGenes.length > 0) {
            const copy = currentGenes[Math.floor(Math.random() * currentGenes.length)];
            newGenes.push(copy + " (variant)");
          }
          break;
        case "deletion":
          // 删除一个基因
          if (newGenes.length > 1) {
            newGenes.splice(Math.floor(Math.random() * newGenes.length), 1);
          }
          break;
        case "recombination":
          // 重组基因顺序
          newGenes.sort(() => Math.random() - 0.5);
          break;
        case "novel":
          // 全新基因
          if (parsed.newGenes) {
            newGenes.push(...parsed.newGenes.slice(0, 2));
          }
          break;
      }
    } catch {
      description = `${mutationType} mutation on ${locus} (parse failed)`;
    }

    const mutation: Mutation = {
      id: randomUUID(),
      type: mutationType,
      locus,
      description,
      timestamp: Date.now(),
    };

    const newGenome: Genome = {
      ...organism.genome,
      [locus]: newGenes,
      mutations: [...organism.genome.mutations, mutation],
    };

    const offspring: Organism = {
      id: randomUUID(),
      lineage: [...organism.lineage, organism.id],
      generation: organism.generation + 1,
      genome: newGenome,
      fitness: 0,
      age: 0,
      offspring: [],
      isAlive: true,
    };

    organism.offspring.push(offspring.id);
    organism.isAlive = false;
    organism.deathReason = "reproduced (mutation)";

    return offspring;
  }

  // ============================================================
  // 3. 选择压力 — 来自环境，不是自评
  // ============================================================

  applyPressure(pressure: SelectionPressure): void {
    this.pressures.push(pressure);
    console.log(`[Evolution] Selection pressure: ${pressure.source} (intensity: ${pressure.intensity})`);

    // 压力直接影响适应度
    for (const organism of this.organisms.values()) {
      if (!organism.isAlive) continue;

      // 适应度由基因组和压力的交互决定
      const adaptation = this.evaluateAdaptation(organism, pressure);
      organism.fitness += adaptation * pressure.intensity;
    }
  }

  private evaluateAdaptation(organism: Organism, pressure: SelectionPressure): number {
    const genome = organism.genome;
    const allGenes = [...genome.perception, ...genome.reasoning, ...genome.action, ...genome.reflection];
    const diversity = new Set(allGenes).size / Math.max(allGenes.length, 1);

    // Normalized intensity: 1-10 → 0.1-1.0
    const normalizedIntensity = pressure.intensity / 10;

    if (pressure.intensity > 7) {
      // High pressure: moderate diversity is optimal (not too random, not too rigid)
      const optimalDiversity = 0.6;
      const fit = 1 - Math.abs(diversity - optimalDiversity);
      return fit * 0.2 * normalizedIntensity;
    }
    // Low pressure: diversity is beneficial
    return diversity * 0.2 * normalizedIntensity - 0.05;
  }

  // ============================================================
  // 4. 自然选择 — 适者生存，不适者灭绝
  // ============================================================

  select(): { survived: number; extinct: number; born: number } {
    let extinct = 0;
    let born = 0;

    // 灭绝适应度低的
    for (const organism of this.organisms.values()) {
      if (!organism.isAlive) continue;

      if (organism.fitness < -this.config.extinctionThreshold) {
        organism.isAlive = false;
        organism.deathReason = "extinction (low fitness)";
        extinct++;
      }
    }

    // 种群竞争：如果超过最大种群，淘汰最弱的
    const alive = Array.from(this.organisms.values()).filter(o => o.isAlive);
    if (alive.length > this.config.maxPopulation) {
      alive.sort((a, b) => b.fitness - a.fitness);
      const excess = alive.length - this.config.maxPopulation;
      for (let i = alive.length - excess; i < alive.length; i++) {
        alive[i].isAlive = false;
        alive[i].deathReason = "competition (overpopulation)";
        extinct++;
      }
    }

    // 繁殖适应度高的
    const survivors = Array.from(this.organisms.values()).filter(o => o.isAlive);
    for (const organism of survivors) {
      if (organism.fitness > this.config.extinctionThreshold && organism.age > 2) {
        // 高适应度的有机体有概率繁殖
        if (Math.random() < 0.3) {
          const child = this.cloneOrganism(organism);
          this.organisms.set(child.id, child);
          organism.offspring.push(child.id);
          born++;
        }
      }
    }

    // 年龄增长
    for (const organism of this.organisms.values()) {
      if (organism.isAlive) organism.age++;
    }

    this.generation++;
    const survived = Array.from(this.organisms.values()).filter(o => o.isAlive).length;

    console.log(`[Evolution] Gen ${this.generation}: ${survived} survived, ${extinct} extinct, ${born} born`);

    return { survived, extinct, born };
  }

  private cloneOrganism(parent: Organism): Organism {
    // 克隆时引入微小变异
    const genome = { ...parent.genome };
    const loci: Array<keyof Pick<Genome, "perception" | "reasoning" | "action" | "reflection">> =
      ["perception", "reasoning", "action", "reflection"];
    const locus = loci[Math.floor(Math.random() * loci.length)];
    const genes = [...genome[locus]];

    // 随机微调一个基因
    if (genes.length > 0) {
      const idx = Math.floor(Math.random() * genes.length);
      genes[idx] = genes[idx] + " (drift)";
    }

    genome[locus] = genes;
    genome.mutations = [...genome.mutations, {
      id: randomUUID(),
      type: "point",
      locus,
      description: "genetic drift during cloning",
      timestamp: Date.now(),
    }];

    return {
      id: randomUUID(),
      lineage: [...parent.lineage, parent.id],
      generation: parent.generation + 1,
      genome,
      fitness: parent.fitness * 0.9, // 子代初始适应度略低
      age: 0,
      offspring: [],
      isAlive: true,
    };
  }

  // ============================================================
  // 5. 物种形成 — 不同策略形成不同族群
  // ============================================================

  async formSpecies(): Promise<Species[]> {
    const alive = Array.from(this.organisms.values()).filter(o => o.isAlive);
    if (alive.length < 2) return [];

    // 用 LLM 对存活有机体的策略进行聚类
    const strategies = alive.map(o => ({
      id: o.id,
      strategy: JSON.stringify(o.genome),
    }));

    const response = await this.llmCall([
      { role: "system", content: "You are a species classification engine. Group organisms by their cognitive strategy. Create species names that capture the essence of each group." },
      { role: "user", content: `Classify these ${strategies.length} organisms into species based on their cognitive strategies.
${strategies.slice(0, 10).map(s => `Organism ${s.id.slice(0, 8)}: ${s.strategy.slice(0, 100)}`).join("\n")}

Return JSON array: [{"id": "species_id", "archetype": "name", "members": ["id1", "id2"], "strategy": "description"}]` },
    ]);

    try {
      const parsed = JSON.parse(response);
      const speciesList = (Array.isArray(parsed) ? parsed : [parsed]).map((s: any) => ({
        id: s.id || randomUUID(),
        archetype: s.archetype || "unknown",
        members: s.members || [],
        strategy: s.strategy || "",
        emergenceGeneration: this.generation,
      }));

      for (const species of speciesList) {
        this.species.set(species.id, species);
      }

      console.log(`[Evolution] ${speciesList.length} species formed at generation ${this.generation}`);
      return speciesList;
    } catch {
      return [];
    }
  }

  // ============================================================
  // 6. 突破检测 — 发现真正的创新
  // ============================================================

  detectBreakthroughs(): Organism[] {
    const alive = Array.from(this.organisms.values()).filter(o => o.isAlive);
    const breakthroughs: Organism[] = [];

    for (const organism of alive) {
      // 突破 = 拥有其他有机体都没有的基因
      const allOtherGenes = new Set<string>();
      for (const other of alive) {
        if (other.id === organism.id) continue;
        for (const genes of Object.values(other.genome)) {
          if (Array.isArray(genes)) {
            for (const gene of genes) {
              allOtherGenes.add(gene.replace(/ \(variant\)/, "").replace(/ \(drift\)/, ""));
            }
          }
        }
      }

      const myGenes = new Set<string>();
      for (const genes of Object.values(organism.genome)) {
        if (Array.isArray(genes)) {
          for (const gene of genes) {
            myGenes.add(gene.replace(/ \(variant\)/, "").replace(/ \(drift\)/, ""));
          }
        }
      }

      // 找出独有基因
      const uniqueGenes = [...myGenes].filter(g => !allOtherGenes.has(g));
      if (uniqueGenes.length > 0) {
        breakthroughs.push(organism);
        console.log(`[Evolution] BREAKTHROUGH: ${organism.id.slice(0, 8)} has unique genes: ${uniqueGenes.join(", ")}`);
      }
    }

    return breakthroughs;
  }

  // ============================================================
  // Query
  // ============================================================

  getAlive(): Organism[] {
    return Array.from(this.organisms.values()).filter(o => o.isAlive);
  }

  getSpecies(): Species[] {
    return Array.from(this.species.values());
  }

  getGeneration(): number {
    return this.generation;
  }

  getStats() {
    const all = Array.from(this.organisms.values());
    const alive = all.filter(o => o.isAlive);
    const totalMutations = all.reduce((sum, o) => sum + o.genome.mutations.length, 0);
    const novelMutations = all.reduce((sum, o) => sum + o.genome.mutations.filter(m => m.type === "novel").length, 0);

    return {
      generation: this.generation,
      totalOrganisms: all.length,
      aliveOrganisms: alive.length,
      speciesCount: this.species.size,
      totalMutations,
      novelMutations,
      pressures: this.pressures.length,
    };
  }
}
