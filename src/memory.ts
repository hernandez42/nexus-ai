/**
 * Persistent Memory — 持久记忆系统
 *
 * 不是 JSONL 文件，而是语义检索。
 * 每条记忆有 embedding，查询时用余弦相似度匹配。
 *
 * 实现方案：
 *   - 用 LLM 自身做 embedding（text-embedding-3-small 或类似）
 *   - 如果没有 embedding API，用 TF-IDF + 余弦相似度作为 fallback
 *   - 记忆分三层：episodic（事件）、semantic（知识）、procedural（技能）
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

// ============================================================
// Types
// ============================================================

export type MemoryLayer = "episodic" | "semantic" | "procedural";

export interface MemoryEntry {
  id: string;
  layer: MemoryLayer;
  content: string;
  tags: string[];
  embedding?: number[];
  createdAt: number;
  accessedAt: number;
  accessCount: number;
  metadata: Record<string, unknown>;
}

export interface MemoryQuery {
  text: string;
  layer?: MemoryLayer;
  topK?: number;
  minSimilarity?: number;
  tags?: string[];
}

export interface MemorySearchResult {
  entry: MemoryEntry;
  similarity: number;
}

// ============================================================
// TF-IDF Fallback Embedding (no API needed)
// ============================================================

class TFIDFVectorizer {
  private vocabulary: Map<string, number> = new Map();
  private idf: Map<string, number> = new Map();
  private docFreq: Map<string, number> = new Map();
  private docCount = 0;

  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fff\s]/g, " ")
      .split(/\s+/)
      .filter(t => t.length > 1);
  }

  fit(documents: string[]): void {
    this.docCount = documents.length;
    const df: Map<string, number> = new Map();

    for (const doc of documents) {
      const tokens = new Set(this.tokenize(doc));
      for (const token of tokens) {
        df.set(token, (df.get(token) || 0) + 1);
      }
    }

    // Build vocabulary from all tokens
    const allTokens = new Set<string>();
    for (const doc of documents) {
      for (const t of this.tokenize(doc)) allTokens.add(t);
    }

    let idx = 0;
    for (const token of allTokens) {
      this.vocabulary.set(token, idx++);
      const freq = df.get(token) || 0;
      this.idf.set(token, Math.log((this.docCount + 1) / (freq + 1)) + 1);
    }

    this.docFreq = df;
  }

  transform(text: string): number[] {
    const tokens = this.tokenize(text);
    const tf: Map<string, number> = new Map();
    for (const t of tokens) {
      tf.set(t, (tf.get(t) || 0) + 1);
    }

    const vec = new Array(this.vocabulary.size).fill(0);
    const norm = tokens.length || 1;

    for (const [token, count] of tf) {
      const idx = this.vocabulary.get(token);
      if (idx !== undefined) {
        vec[idx] = (count / norm) * (this.idf.get(token) || 1);
      }
    }

    return vec;
  }

  fitTransform(documents: string[]): number[][] {
    this.fit(documents);
    return documents.map(d => this.transform(d));
  }

  get dim(): number {
    return this.vocabulary.size;
  }
}

// ============================================================
// Cosine Similarity
// ============================================================

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

// ============================================================
// Memory Store
// ============================================================

export class MemoryStore {
  private memories: Map<string, MemoryEntry> = new Map();
  private vectorizer: TFIDFVectorizer;
  private dir: string;
  private dirty = false;

  constructor(dir: string) {
    this.dir = dir;
    mkdirSync(dir, { recursive: true });
    this.vectorizer = new TFIDFVectorizer();
    this.load();
  }

  // ============================================================
  // Write
  // ============================================================

  add(entry: Omit<MemoryEntry, "id" | "createdAt" | "accessedAt" | "accessCount">): string {
    const id = `mem_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const now = Date.now();

    const memory: MemoryEntry = {
      ...entry,
      id,
      createdAt: now,
      accessedAt: now,
      accessCount: 0,
    };

    this.memories.set(id, memory);
    this.dirty = true;
    return id;
  }

  // ============================================================
  // Read
  // ============================================================

  get(id: string): MemoryEntry | undefined {
    const entry = this.memories.get(id);
    if (entry) {
      entry.accessedAt = Date.now();
      entry.accessCount++;
    }
    return entry;
  }

  query(query: MemoryQuery): MemorySearchResult[] {
    const { text, layer, topK = 5, minSimilarity = 0.1, tags } = query;

    // Filter by layer and tags
    let candidates = Array.from(this.memories.values());
    if (layer) candidates = candidates.filter(m => m.layer === layer);
    if (tags?.length) {
      candidates = candidates.filter(m =>
        tags.some(t => m.tags.includes(t))
      );
    }

    if (candidates.length === 0) return [];

    // Rebuild vectorizer with all candidate contents + query
    const allTexts = candidates.map(m => m.content);
    allTexts.push(text);
    this.vectorizer.fit(allTexts);

    const queryVec = this.vectorizer.transform(text);
    const results: MemorySearchResult[] = candidates.map(entry => {
      const entryVec = this.vectorizer.transform(entry.content);
      const similarity = cosineSimilarity(queryVec, entryVec);
      return { entry, similarity };
    });

    return results
      .filter(r => r.similarity >= minSimilarity)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, topK);
  }

  // ============================================================
  // Update
  // ============================================================

  update(id: string, updates: Partial<Pick<MemoryEntry, "content" | "tags" | "metadata" | "layer">>): boolean {
    const entry = this.memories.get(id);
    if (!entry) return false;
    Object.assign(entry, updates);
    entry.accessedAt = Date.now();
    this.dirty = true;
    return true;
  }

  // ============================================================
  // Delete
  // ============================================================

  remove(id: string): boolean {
    this.dirty = this.memories.delete(id);
    return this.dirty;
  }

  // ============================================================
  // Stats
  // ============================================================

  stats() {
    const all = Array.from(this.memories.values());
    return {
      total: all.length,
      episodic: all.filter(m => m.layer === "episodic").length,
      semantic: all.filter(m => m.layer === "semantic").length,
      procedural: all.filter(m => m.layer === "procedural").length,
    };
  }

  // ============================================================
  // Persistence
  // ============================================================

  save(): void {
    try {
      const data = Array.from(this.memories.values()).map(m => ({
        ...m,
        // Don't persist embedding (will be recomputed)
        embedding: undefined,
      }));
      const path = join(this.dir, "memory.json");
      // Ensure directory exists before writing
      if (!existsSync(this.dir)) {
        mkdirSync(this.dir, { recursive: true });
      }
      writeFileSync(path, JSON.stringify(data, null, 2));
      this.dirty = false;
      console.log(`[Memory] Saved ${data.length} entries to ${path}`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[Memory] Save failed: ${msg}`);
    }
  }

  private load(): void {
    const path = join(this.dir, "memory.json");
    if (!existsSync(path)) return;
    try {
      const data = JSON.parse(readFileSync(path, "utf-8"));
      for (const entry of data) {
        this.memories.set(entry.id, entry);
      }
    } catch {
      // Corrupted file, start fresh
    }
  }

  // Auto-save on process exit
  autoSave(): void {
    if (this.dirty) this.save();
    process.on("exit", () => this.save());
    process.on("SIGINT", () => { this.save(); process.exit(0); });
    process.on("SIGTERM", () => { this.save(); process.exit(0); });
  }
}
