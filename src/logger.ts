/**
 * Unified Logger
 *
 * All modules write to the same log directory with structured JSONL format.
 * Supports console output + file persistence.
 */

import { mkdirSync, appendFileSync, existsSync } from "fs";
import { join } from "path";

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  module: string;
  message: string;
  data?: Record<string, unknown>;
}

export class Logger {
  private logDir: string;
  private minLevel: LogLevel;
  private moduleName: string;

  constructor(moduleName: string, logDir: string, minLevel: LogLevel = "info") {
    this.moduleName = moduleName;
    this.logDir = logDir;
    this.minLevel = minLevel;
    mkdirSync(logDir, { recursive: true });
  }

  private shouldLog(level: LogLevel): boolean {
    return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[this.minLevel];
  }

  private write(level: LogLevel, message: string, data?: Record<string, unknown>): void {
    if (!this.shouldLog(level)) return;

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      module: this.moduleName,
      message,
      data,
    };

    // Console output
    const prefix = `[${entry.timestamp.slice(11, 19)}] [${level.toUpperCase()}] [${this.moduleName}]`;
    if (level === "error") {
      console.error(`${prefix} ${message}`);
    } else if (level === "warn") {
      console.warn(`${prefix} ${message}`);
    } else {
      console.log(`${prefix} ${message}`);
    }

    // File persistence
    const logFile = join(this.logDir, `${new Date().toISOString().slice(0, 10)}.jsonl`);
    appendFileSync(logFile, JSON.stringify(entry) + "\n");
  }

  debug(message: string, data?: Record<string, unknown>): void {
    this.write("debug", message, data);
  }

  info(message: string, data?: Record<string, unknown>): void {
    this.write("info", message, data);
  }

  warn(message: string, data?: Record<string, unknown>): void {
    this.write("warn", message, data);
  }

  error(message: string, data?: Record<string, unknown>): void {
    this.write("error", message, data);
  }
}
