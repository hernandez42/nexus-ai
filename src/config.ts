/**
 * Configuration loader with environment variable support.
 * Environment variables take precedence over config file values.
 */

import { readFileSync, existsSync } from "fs";

export type LLMProvider = "openai" | "anthropic" | "ollama" | "mock";
export type LogLevel = "debug" | "info" | "warn" | "error";

export interface NexusConfig {
  llm: {
    provider: LLMProvider;
    model: string;
    apiKey: string;
    baseURL?: string;
    temperature?: number;
    maxTokens?: number;
  };
  workspaceDir: string;
  memoryDir: string;
  logDir: string;
  modules: {
    selfAwareness: { enabled: boolean; maxRoundsPerCycle: number };
    triOrchestrator: { maxIterations: number; maxReasoningSteps: number };
    glue: {
      superpowersToEve: boolean;
      evolverToPiMono: boolean;
      autoresearchToEvolver: boolean;
    };
  };
  repos: {
    eve: string;
    piMono: string;
    evolver: string;
    superpowers: string;
    autoresearch: string;
  };
  logLevel: LogLevel;
  persistExperiences: boolean;
}

export function loadConfig(path: string): NexusConfig {
  if (!existsSync(path)) {
    throw new Error(`Config file not found: ${path}`);
  }

  const raw = JSON.parse(readFileSync(path, "utf-8"));

  // Validate provider
  const rawProvider = raw.llm?.provider || "openai";
  const validProviders: LLMProvider[] = ["openai", "anthropic", "ollama", "mock"];
  const provider = validProviders.includes(rawProvider) ? (rawProvider as LLMProvider) : "openai";

  // Validate logLevel
  const rawLogLevel = raw.logLevel || "info";
  const validLevels: LogLevel[] = ["debug", "info", "warn", "error"];
  const logLevel = validLevels.includes(rawLogLevel) ? (rawLogLevel as LogLevel) : "info";

  // Environment variables override config file
  const config: NexusConfig = {
    llm: {
      provider,
      model: raw.llm?.model || "gpt-4o",
      apiKey: process.env.LLM_API_KEY || raw.llm?.apiKey || "",
      baseURL: process.env.LLM_BASE_URL || raw.llm?.baseURL,
      temperature: raw.llm?.temperature ?? 0.7,
      maxTokens: raw.llm?.maxTokens ?? 4096,
    },
    workspaceDir: raw.workspaceDir || "./nexus-workspace",
    memoryDir: raw.memoryDir || "./nexus-workspace/memory",
    logDir: raw.logDir || "./nexus-workspace/logs",
    modules: {
      selfAwareness: {
        enabled: raw.modules?.selfAwareness?.enabled ?? true,
        maxRoundsPerCycle: raw.modules?.selfAwareness?.maxRoundsPerCycle || 1,
      },
      triOrchestrator: {
        maxIterations: raw.modules?.triOrchestrator?.maxIterations || 1,
        maxReasoningSteps: raw.modules?.triOrchestrator?.maxReasoningSteps || 3,
      },
      glue: {
        superpowersToEve: raw.modules?.glue?.superpowersToEve ?? true,
        evolverToPiMono: raw.modules?.glue?.evolverToPiMono ?? true,
        autoresearchToEvolver: raw.modules?.glue?.autoresearchToEvolver ?? true,
      },
    },
    repos: {
      eve: raw.repos?.eve || "../eve",
      piMono: raw.repos?.piMono || "../pi-mono",
      evolver: raw.repos?.evolver || "../evolver",
      superpowers: raw.repos?.superpowers || "../superpowers",
      autoresearch: raw.repos?.autoresearch || "../autoresearch",
    },
    logLevel,
    persistExperiences: raw.persistExperiences ?? true,
  };

  return config;
}

export function generateDefaultConfig(path: string): void {
  const defaults: NexusConfig = {
    llm: {
      provider: "openai",
      model: "gpt-4o",
      apiKey: "${LLM_API_KEY}",
      baseURL: "${LLM_BASE_URL}",
      temperature: 0.7,
      maxTokens: 4096,
    },
    workspaceDir: "./nexus-workspace",
    memoryDir: "./nexus-workspace/memory",
    logDir: "./nexus-workspace/logs",
    modules: {
      selfAwareness: { enabled: true, maxRoundsPerCycle: 1 },
      triOrchestrator: { maxIterations: 1, maxReasoningSteps: 3 },
      glue: { superpowersToEve: true, evolverToPiMono: true, autoresearchToEvolver: true },
    },
    repos: {
      eve: "../eve",
      piMono: "../pi-mono",
      evolver: "../evolver",
      superpowers: "../superpowers",
      autoresearch: "../autoresearch",
    },
    logLevel: "info",
    persistExperiences: true,
  };

  const { writeFileSync } = require("fs");
  writeFileSync(path, JSON.stringify(defaults, null, 2) + "\n");
}
