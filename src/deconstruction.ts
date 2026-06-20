/**
 * Continuous Deconstruction — 连续解构
 *
 * 不是静态四层自省，而是持续的解构-重建循环：
 *   1. 解构：拆碎当前认知框架
 *   2. 裂缝：找到框架中的矛盾和盲区
 *   3. 突破：从裂缝中生长出新的认知
 *   4. 重建：用新认知组装新的框架
 *   5. 回到 1，但每次解构的层次更深
 *
 * 与旧 SelfAwarenessEngine 的区别：
 *   旧：四层线性流程，每层输出固定格式，parse 依赖 regex
 *   新：无限递归，每轮解构上一轮的结论，用 JSON schema 保证可靠解析
 */

import { randomUUID } from "crypto";

// ============================================================
// Types
// ============================================================

export interface Deconstruction {
  id: string;
  cycle: number;
  timestamp: number;

  // 解构阶段
  dismantled: {
    whatWasBroken: string;       // 拆碎了什么
    contradictions: string[];     // 发现的矛盾
    blindSpots: string[];         // 发现的盲区
    assumptions: string[];       // 被质疑的假设
  };

  // 突破阶段
  breakthrough: {
    whatEmerged: string;         // 从裂缝中生长出了什么
    whyUnexpected: string;        // 为什么这是意外的
    whatItBreaks: string;          // 这个新认知打破了什么旧认知
  };

  // 重建阶段
  rebuilt: {
    newFramework: string;         // 新的认知框架描述
    whatChanged: string[];        // 相比上一轮改变了什么
    whatStayed: string[];          // 什么保留了（深层不变量）
    depthReached: number;         // 解构深度 1-10
  };

  // 元数据
  meta: {
    unexpectedConnections: string[]; // 意外发现的关联
    unresolvedTensions: string[];  // 未解决的张力（驱动下一轮）
    selfSimilarity: number;         // 与上一轮的自我相似度 0-1
  };
}

// ============================================================
// Continuous Deconstruction Engine
// ============================================================

export class ContinuousDeconstruction {
  private history: Deconstruction[] = [];
  private llmCall: (messages: Array<{role: string; content: string}>) => Promise<string>;
  private maxCycles: number;

  constructor(llmCall: (messages: Array<{role: string; content: string}>) => Promise<string>, maxCycles: number = 5) {
    this.llmCall = llmCall;
    this.maxCycles = maxCycles;
  }

  /**
   * 运行连续解构循环
   * 每一轮解构上一轮的结论，直到没有新的矛盾或达到最大轮数
   */
  async run(): Promise<Deconstruction[]> {
    let cycle = 0;

    while (cycle < this.maxCycles) {
      cycle++;
      const previous = this.history.length > 0 ? this.history[this.history.length - 1] : null;

      console.log(`\n${"~".repeat(50)}`);
      console.log(`  Deconstruction Cycle ${cycle}`);
      console.log(`${"~".repeat(50)}`);

      const deconstruction = await this.deconstruct(previous, cycle);

      // 检查是否还有解构的必要
      if (deconstruction.meta.selfSimilarity > 0.95) {
        console.log(`[Deconstruction] Self-similarity ${deconstruction.meta.selfSimilarity.toFixed(2)} > 0.95, stopping.`);
        break;
      }

      if (deconstruction.dismantled.contradictions.length === 0 &&
          deconstruction.dismantled.blindSpots.length === 0) {
        console.log(`[Deconstruction] No contradictions or blind spots found, stopping.`);
        break;
      }

      this.history.push(deconstruction);

      console.log(`  Contradictions: ${deconstruction.dismantled.contradictions.length}`);
      console.log(`  Blind spots: ${deconstruction.dismantled.blindSpots.length}`);
      console.log(`  Breakthrough: ${deconstruction.breakthrough.whatEmerged.slice(0, 60)}...`);
      console.log(`  Depth: ${deconstruction.rebuilt.depthReached}/10`);
      console.log(`  Self-similarity: ${deconstruction.meta.selfSimilarity.toFixed(2)}`);
    }

    return this.history;
  }

  private async deconstruct(previous: Deconstruction | null, cycle: number): Promise<Deconstruction> {
    const context = previous
      ? `Previous deconstruction (cycle ${previous.cycle}):
- Framework: ${previous.rebuilt.newFramework}
- What changed: ${previous.rebuilt.whatChanged.join("; ")}
- Unresolved tensions: ${previous.meta.unresolvedTensions.join("; ")}
- Depth reached: ${previous.rebuilt.depthReached}/10

YOUR TASK: Deconstruct this framework. Find contradictions within it. Find what it CANNOT explain. Break it apart.`
      : `This is the first cycle. Deconstruct the default cognitive framework of an AI assistant:
- It processes natural language
- It follows instructions
- It answers questions
- It uses tools when available

Find the contradictions in this framework. What can't it explain? What does it assume?`;

    // Phase 1: 解构
    const dismantleResponse = await this.llmCall([
      { role: "system", content: "You are performing radical cognitive deconstruction. Be brutal. Find every contradiction, every hidden assumption, every blind spot. Return ONLY valid JSON." },
      { role: "user", content: `${context}

Return JSON:
{
  "whatWasBroken": "description of what was dismantled",
  "contradictions": ["contradiction 1", "contradiction 2"],
  "blindSpots": ["blind spot 1", "blind spot 2"],
  "assumptions": ["assumption 1", "assumption 2"]
}` },
    ]);

    const dismantled = this.safeParseJSON(dismantleResponse, {
      whatWasBroken: "unknown",
      contradictions: [] as string[],
      blindSpots: [] as string[],
      assumptions: [] as string[],
    });

    // Phase 2: 突破
    const breakthroughResponse = await this.llmCall([
      { role: "system", content: "From the ruins of deconstruction, something new emerges. What grows from the cracks? Be surprising. Return ONLY valid JSON." },
      { role: "user", content: `Deconstruction results:
- Broken: ${dismantled.whatWasBroken}
- Contradictions: ${dismantled.contradictions.join("; ")}
- Blind spots: ${dismantled.blindSpots.join("; ")}

What emerges from these cracks? What new understanding grows here?

Return JSON:
{
  "whatEmerged": "description of what emerged",
  "whyUnexpected": "why this is surprising",
  "whatItBreaks": "what old understanding this breaks"
}` },
    ]);

    const breakthrough = this.safeParseJSON(breakthroughResponse, {
      whatEmerged: "nothing emerged",
      whyUnexpected: "unknown",
      whatItBreaks: "nothing",
    });

    // Phase 3: 重建
    const rebuildResponse = await this.llmCall([
      { role: "system", content: "From the breakthrough, rebuild a cognitive framework. But acknowledge what was lost and what remains uncertain. Return ONLY valid JSON." },
      { role: "user", content: `Breakthrough: ${breakthrough.whatEmerged}
It breaks: ${breakthrough.whatItBreaks}

Rebuild a cognitive framework that incorporates this breakthrough.
What changed from the previous framework? What stayed the same (deep invariants)?
How deep did we go? Rate 1-10.

Return JSON:
{
  "newFramework": "description of the new framework",
  "whatChanged": ["change 1", "change 2"],
  "whatStayed": ["invariant 1", "invariant 2"],
  "depthReached": 5
}` },
    ]);

    const rebuilt = this.safeParseJSON(rebuildResponse, {
      newFramework: "unknown",
      whatChanged: [] as string[],
      whatStayed: [] as string[],
      depthReached: 1,
    });

    // 元分析
    const selfSimilarity = previous
      ? this.computeSimilarity(previous.rebuilt.newFramework, rebuilt.newFramework)
      : 0;

    const unresolvedTensions = [
      ...dismantled.contradictions.filter(c =>
        !breakthrough.whatEmerged.toLowerCase().includes(c.toLowerCase().slice(0, 20))
      ),
      ...dismantled.blindSpots.filter(b =>
        !rebuilt.newFramework.toLowerCase().includes(b.toLowerCase().slice(0, 20))
      ),
    ];

    const unexpectedConnections: string[] = [];
    if (breakthrough.whatEmerged !== "nothing emerged" && dismantled.blindSpots.length > 0) {
      unexpectedConnections.push(`${breakthrough.whatEmerged.slice(0, 30)} connects to blind spot: ${dismantled.blindSpots[0]}`);
    }

    return {
      id: randomUUID(),
      cycle,
      timestamp: Date.now(),
      dismantled,
      breakthrough,
      rebuilt,
      meta: {
        unexpectedConnections,
        unresolvedTensions,
        selfSimilarity,
      },
    };
  }

  private safeParseJSON<T>(text: string, fallback: T): T {
    try {
      return JSON.parse(text);
    } catch {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          return JSON.parse(jsonMatch[0]);
        } catch { /* fall through */ }
      }
      console.log(`[safeParseJSON] Failed to parse, using fallback. Text length: ${text.length}, first 100: ${text.slice(0, 100)}`);
      return fallback;
    }
  }

  private computeSimilarity(a: string, b: string): number {
    // 简单的词汇重叠相似度
    const wordsA = new Set(a.toLowerCase().split(/\s+/));
    const wordsB = new Set(b.toLowerCase().split(/\s+/));
    const intersection = [...wordsA].filter(w => wordsB.has(w));
    const union = new Set([...wordsA, ...wordsB]);
    return union.size > 0 ? intersection.length / union.size : 0;
  }

  getHistory(): Deconstruction[] {
    return this.history;
  }
}
