/**
 * Unified Configuration System
 *
 * Loads from (priority order):
 *   1. Environment variables (NEXUS_*)
 *   2. config.json in workspace root
 *   3. Default values
 */

import { readFileSync, existsSync, writeFileSync } from "fs";
import { join } from "path";
import type { LLMConfig } from "./llm";

export interface NexusConfig {
  // LLM settings
  llm: LLMConfig;

  // Paths
  workspaceDir: string;
  memoryDir: string;
  logDir: string;

  // Modules
  modules: {
    selfAwareness: {
      enabled: boolean;
      maxRoundsPerCycle: number;
    };
    triOrchestrator: {
      maxIterations: number;
      maxReasoningSteps: number;
    };
    glue: {
      superpowersToEve: boolean;
      evolverToPiMono: boolean;
      autoresearchToEvolver: boolean;
    };
  };

  // Source repositories
  repos: {
    eve: string;
    piMono: string;
    evolver: string;
    superpowers: string;
    autoresearch: string;
  };

  // Logging
  logLevel: "debug" | "info" | "warn" | "error";
  persistExperiences: boolean;
}

const DEFAULT_CONFIG: NexusConfig = {
  llm: {
    provider: "mock",
    model: "gpt-4o",
    temperature: 0.7,
    maxTokens: 4096,
  },

  workspaceDir: "/workspace/nexus-workspace",
  memoryDir: "/workspace/nexus-workspace/memory",
  logDir: "/workspace/nexus-workspace/logs",

  modules: {
    selfAwareness: {
      enabled: true,
      maxRoundsPerCycle: 1,
    },
    triOrchestrator: {
      maxIterations: 3,
      maxReasoningSteps: 5,
    },
    glue: {
      superpowersToEve: true,
      evolverToPiMono: true,
      autoresearchToEvolver: true,
    },
  },

  repos: {
    eve: "/workspace/eve",
    piMono: "/workspace/pi-mono",
    evolver: "/workspace/evolver",
    superpowers: "/workspace/superpowers",
    autoresearch: "/workspace/autoresearch",
  },

  logLevel: "info",
  persistExperiences: true,
};

function loadFromEnv(config: NexusConfig): NexusConfig {
  return {
    ...config,
    llm: {
      provider: (process.env.NEXUS_LLM_PROVIDER as LLMConfig["provider"]) || config.llm.provider,
      model: process.env.NEXUS_LLM_MODEL || config.llm.model,
      apiKey: process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY || config.llm.apiKey,
      baseURL: process.env.NEXUS_LLM_BASE_URL || config.llm.baseURL,
      temperature: process.env.NEXUS_LLM_TEMPERATURE ? parseFloat(process.env.NEXUS_LLM_TEMPERATURE) : config.llm.temperature,
      maxTokens: process.env.NEXUS_LLM_MAX_TOKENS ? parseInt(process.env.NEXUS_LLM_MAX_TOKENS, 10) : config.llm.maxTokens,
    },
    workspaceDir: process.env.NEXUS_WORKSPACE_DIR || config.workspaceDir,
    memoryDir: process.env.NEXUS_MEMORY_DIR || config.memoryDir,
    logDir: process.env.NEXUS_LOG_DIR || config.logDir,
    logLevel: (process.env.NEXUS_LOG_LEVEL as NexusConfig["logLevel"]) || config.logLevel,
  };
}

function loadFromFile(configPath: string, config: NexusConfig): NexusConfig {
  if (!existsSync(configPath)) return config;
  try {
    const fileConfig = JSON.parse(readFileSync(configPath, "utf-8"));
    return { ...config, ...fileConfig };
  } catch {
    return config;
  }
}

export function loadConfig(configPath?: string): NexusConfig {
  const path = configPath || join(process.cwd(), "config.json");
  let config = DEFAULT_CONFIG;
  config = loadFromFile(path, config);
  config = loadFromEnv(config);
  return config;
}

export function saveConfig(config: NexusConfig, configPath?: string): void {
  const path = configPath || join(process.cwd(), "config.json");
  writeFileSync(path, JSON.stringify(config, null, 2));
}

export function generateDefaultConfig(path?: string): void {
  saveConfig(DEFAULT_CONFIG, path);
}
