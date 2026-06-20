/**
 * Unified LLM Provider Layer
 *
 * Supports: OpenAI, Anthropic Claude, local Ollama
 * Configurable via environment variables or config file
 *
 * Usage:
 *   const llm = createLLM({ provider: "openai", model: "gpt-4o", apiKey: "..." });
 *   const response = await llm.chat([{ role: "user", content: "Hello" }]);
 */

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LLMConfig {
  provider: "openai" | "anthropic" | "ollama" | "mock";
  model?: string;
  apiKey?: string;
  baseURL?: string;      // For Ollama or custom endpoints
  temperature?: number;
  maxTokens?: number;
}

export interface LLMClient {
  chat(messages: ChatMessage[]): Promise<string>;
  chatStream?(messages: ChatMessage[]): AsyncIterable<string>;
}

// ============================================================
// OpenAI Provider
// ============================================================

function createOpenAIClient(config: LLMConfig): LLMClient {
  const apiKey = config.apiKey || process.env.OPENAI_API_KEY;
  const baseURL = config.baseURL || "https://api.openai.com/v1";
  const model = config.model || "gpt-4o";

  return {
    async chat(messages) {
      const response = await fetch(`${baseURL}/chat/completions`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages,
          temperature: config.temperature ?? 0.7,
          max_tokens: config.maxTokens ?? 4096,
        }),
      });

      if (!response.ok) {
        const err = await response.text();
        throw new Error(`LLM API error ${response.status}: ${err}`);
      }

      const data = await response.json();
      const msg = data.choices?.[0]?.message as any;
      return msg?.content || msg?.reasoning_content || "";
    },

    async *chatStream(messages) {
      const response = await fetch(`${baseURL}/chat/completions`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages,
          temperature: config.temperature ?? 0.7,
          max_tokens: config.maxTokens ?? 4096,
          stream: true,
        }),
      });

      const reader = response.body?.getReader();
      if (!reader) return;

      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed === "data: [DONE]") continue;
          if (trimmed.startsWith("data: ")) {
            try {
              const chunk = JSON.parse(trimmed.slice(6));
              const content = chunk.choices?.[0]?.delta?.content;
              if (content) yield content;
            } catch { /* ignore */ }
          }
        }
      }
    },
  };
}

// ============================================================
// Anthropic Provider
// ============================================================

function createAnthropicClient(config: LLMConfig): LLMClient {
  const apiKey = config.apiKey || process.env.ANTHROPIC_API_KEY;
  const model = config.model || "claude-3-5-sonnet-20241022";

  return {
    async chat(messages) {
      const systemMsg = messages.find(m => m.role === "system")?.content || "";
      const nonSystem = messages.filter(m => m.role !== "system");

      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": apiKey || "",
          "anthropic-version": "2023-06-01",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          max_tokens: config.maxTokens ?? 4096,
          temperature: config.temperature ?? 0.7,
          system: systemMsg || undefined,
          messages: nonSystem.map(m => ({ role: m.role, content: m.content })),
        }),
      });

      if (!response.ok) {
        const err = await response.text();
        throw new Error(`Anthropic API error ${response.status}: ${err}`);
      }

      const data = await response.json();
      const content = data.content?.[0];
      return content?.type === "text" ? content.text : "";
    },
  };
}

// ============================================================
// Ollama (Local) Provider
// ============================================================

function createOllamaClient(config: LLMConfig): LLMClient {
  const baseURL = config.baseURL || "http://localhost:11434";
  const model = config.model || "llama3.1";

  return {
    async chat(messages) {
      const response = await fetch(`${baseURL}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          messages,
          stream: false,
          options: { temperature: config.temperature ?? 0.7 },
        }),
      });
      const data = await response.json();
      return data.message?.content || "";
    },

    async *chatStream(messages) {
      const response = await fetch(`${baseURL}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          messages,
          stream: true,
          options: { temperature: config.temperature ?? 0.7 },
        }),
      });

      const reader = response.body?.getReader();
      if (!reader) return;

      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value);
        for (const line of chunk.split("\n").filter(l => l.trim())) {
          try {
            const data = JSON.parse(line);
            if (data.message?.content) yield data.message.content;
          } catch { /* ignore parse errors */ }
        }
      }
    },
  };
}

// ============================================================
// Mock Provider (for testing without API keys)
// ============================================================

function createMockClient(_config: LLMConfig): LLMClient {
  return {
    async chat(messages) {
      const lastMsg = messages[messages.length - 1]?.content || "";

      if (lastMsg.includes("What is your thought process") || lastMsg.includes("思考过程")) {
        return `THOUGHT: I need to read the file to understand the codebase structure. I see references to flash attention 3 (fa3) which I don't fully understand yet.`;
      }
      if (lastMsg.includes("Based on your thought, what ACTION") || lastMsg.includes("什么动作")) {
        return `ACTION: read params={"path": "/workspace/autoresearch/train.py"}`;
      }
      if (lastMsg.includes("knowledge gaps or missing capabilities") || lastMsg.includes("知识盲区")) {
        return `GOAL: understand_flash_attention | REASON: The code uses fa3 which I don't know about | PRIORITY: 8
GOAL: optimize_kernel_selection | REASON: Need to understand Hopper vs non-Hopper GPU kernel selection | PRIORITY: 7`;
      }
      if (lastMsg.includes("No specific Gene matched") || lastMsg.includes("基因策略")) {
        return `NAME: knowledge_gap_resolver | DESC: When the agent encounters unknown concepts or missing understanding, systematically research and build expertise | TOOLS: read, bash | STRATEGY: 1. Identify the unknown concept from context 2. Search documentation and source code 3. Build a minimal working example 4. Verify understanding by explaining it back | VALIDATION: echo "Knowledge gap resolved"`;
      }

      return `THOUGHT: I have gathered enough information. FINAL ANSWER: This is a GPT-style transformer with configurable depth, using RMS norm and rotary embeddings.`;
    },
  };
}

// ============================================================
// Factory
// ============================================================

export function createLLM(config: LLMConfig): LLMClient {
  switch (config.provider) {
    case "openai":
      return createOpenAIClient(config);
    case "anthropic":
      return createAnthropicClient(config);
    case "ollama":
      return createOllamaClient(config);
    case "mock":
      return createMockClient(config);
    default:
      throw new Error(`Unknown LLM provider: ${config.provider}`);
  }
}

// ============================================================
// Environment-based auto-config
// ============================================================

export function createLLMFromEnv(): LLMClient {
  const provider = (process.env.NEXUS_LLM_PROVIDER as LLMConfig["provider"]) || "mock";
  return createLLM({
    provider,
    model: process.env.NEXUS_LLM_MODEL,
    apiKey: process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY,
    baseURL: process.env.NEXUS_LLM_BASE_URL,
    temperature: process.env.NEXUS_LLM_TEMPERATURE ? parseFloat(process.env.NEXUS_LLM_TEMPERATURE) : undefined,
  });
}
