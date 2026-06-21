/**
 * ToolLoopReasoner — pi/eve-style native tool calling loop
 *
 * Flow:
 *   LLM receives system prompt + tools + messages
 *   → LLM decides: call tool OR reply with text
 *   → If tool_call: execute → append tool result to messages → loop
 *   → If text: return as final answer
 *
 * Fallback: if LLM provider doesn't support chatWithTools, falls back to
 * plain chat() — still answers but without tool calling.
 */

import type { ChatMessage, ToolCall, ToolDefinition, ToolCallResult, LLMClient } from "./llm";

export interface ToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (params: Record<string, unknown>) => Promise<string>;
}

/**
 * Convert nexus tool parameters (e.g. { path: "string", offset: "number?" })
 * to OpenAI JSON Schema format.
 */
function convertParamsToOpenAI(params: Record<string, unknown>): { type: string; properties: Record<string, unknown>; required: string[] } {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  for (const [key, val] of Object.entries(params)) {
    const typeStr = String(val);
    const isOptional = typeStr.endsWith("?");
    const baseType = isOptional ? typeStr.slice(0, -1) : typeStr;

    let schema: Record<string, unknown> = {};
    if (baseType === "string") schema = { type: "string" };
    else if (baseType === "number") schema = { type: "number" };
    else if (baseType === "boolean") schema = { type: "boolean" };
    else if (baseType === "object") schema = { type: "object" };
    else schema = { type: "string" }; // fallback

    properties[key] = schema;
    if (!isOptional) required.push(key);
  }

  return { type: "object", properties, required };
}

export interface ToolLoopConfig {
  systemPrompt: string;
  userPrompt: string;
  tools: ToolDef[];
  llm: LLMClient;
  maxSteps?: number; // default 5
  onStream?: (chunk: string) => void;
}

export interface ToolLoopResult {
  answer: string;
  steps: Array<{ type: "thought" | "tool_call" | "tool_result" | "answer"; content: string }>;
  toolCallsUsed: string[];
}

/**
 * Build a plain text message list from structured messages for providers
 * that don't support tool calling natively.
 */
function buildPlainMessages(systemPrompt: string, userPrompt: string): ChatMessage[] {
  return [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ];
}

export async function runToolLoop(config: ToolLoopConfig): Promise<ToolLoopResult> {
  const { systemPrompt, userPrompt, tools, llm, maxSteps = 5, onStream } = config;

  const steps: ToolLoopResult["steps"] = [];
  const toolCallsUsed: string[] = [];

  // --- Fallback: no tools available OR provider doesn't support chatWithTools ---
  const useToolCalling = tools.length > 0 && !!llm.chatWithTools;

  if (!useToolCalling) {
    // Simple path: just ask the LLM directly
    try {
      const answer = await llm.chat(buildPlainMessages(systemPrompt, userPrompt));
      steps.push({ type: "answer", content: answer });
      return { answer, steps, toolCallsUsed };
    } catch (e: unknown) {
      const msg = `LLM call failed: ${e instanceof Error ? e.message : String(e)}`;
      steps.push({ type: "answer", content: msg });
      return { answer: msg, steps, toolCallsUsed };
    }
  }

  // --- Native tool calling path ---
  // Build OpenAI tool definitions
  const toolDefinitions: ToolDefinition[] = tools.map(t => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: convertParamsToOpenAI(t.parameters),
    },
  }));

  // Build initial messages: system + user query
  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ];

  for (let step = 0; step < maxSteps; step++) {
    let result: ToolCallResult;
    try {
      result = await llm.chatWithTools!(messages, toolDefinitions);
    } catch (e: unknown) {
      // Fallback to plain chat on tool-calling failure
      try {
        const fallback = await llm.chat(messages);
        steps.push({ type: "answer", content: fallback });
        return { answer: fallback, steps, toolCallsUsed };
      } catch (e2: unknown) {
        const msg = `LLM failed: ${e2 instanceof Error ? e2.message : String(e2)}`;
        steps.push({ type: "answer", content: msg });
        return { answer: msg, steps, toolCallsUsed };
      }
    }

    if (result.toolCalls && result.toolCalls.length > 0) {
      // LLM wants to call tools — execute them
      const assistantMsg: ChatMessage = {
        role: "assistant",
        content: result.content || "",
        tool_calls: result.toolCalls,
      };
      messages.push(assistantMsg);

      for (const tc of result.toolCalls) {
        const toolName = tc.function.name;
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(tc.function.arguments || "{}");
        } catch {
          args = {};
        }

        steps.push({ type: "tool_call", content: `${toolName}(${JSON.stringify(args).slice(0, 100)})` });
        if (onStream) onStream(`[${toolName}]`);

        // Execute tool
        const tool = tools.find(t => t.name === toolName);
        let toolOutput: string;
        if (tool) {
          try {
            toolOutput = await tool.execute(args);
            toolCallsUsed.push(toolName);
          } catch (e: unknown) {
            toolOutput = `Error: ${e instanceof Error ? e.message : String(e)}`;
          }
        } else {
          toolOutput = `Error: Tool "${toolName}" not found`;
        }

        steps.push({ type: "tool_result", content: toolOutput.slice(0, 500) });
        if (onStream) onStream(toolOutput.slice(0, 120));

        // Append tool result to messages
        messages.push({
          role: "tool",
          content: toolOutput,
          tool_call_id: tc.id,
        });
      }
      // Loop continues — LLM will see tool results and decide next action
    } else {
      // LLM returned text — this is the final answer
      const answer = result.content || "";
      steps.push({ type: "answer", content: answer });
      return { answer, steps, toolCallsUsed };
    }
  }

  // Max steps reached — return last LLM output or truncation message
  const lastMsg = messages[messages.length - 1];
  const answer = lastMsg?.content || "Max reasoning steps reached.";
  steps.push({ type: "answer", content: answer });
  return { answer, steps, toolCallsUsed };
}
