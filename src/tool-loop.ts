/**
 * ToolLoopReasoner — pi/eve-style native tool calling loop
 *
 * Replaces AgentReasoningEngine's JSON-forced format with
 * OpenAI-native function calling (like pi Amimo's runLoop).
 *
 * Flow (matching pi Amimo):
 *   LLM receives system prompt + tools + messages
 *   → LLM decides: call tool OR reply with text
 *   → If tool_call: execute → append tool result to messages → loop
 *   → If text: return as final answer
 *
 * No JSON forcing. LLM thinks natively.
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

export async function runToolLoop(config: ToolLoopConfig): Promise<ToolLoopResult> {
  const { systemPrompt, userPrompt, tools, llm, maxSteps = 5, onStream } = config;

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

  const steps: ToolLoopResult["steps"] = [];
  const toolCallsUsed: string[] = [];

  for (let step = 0; step < maxSteps; step++) {
    // Call LLM with tools
    if (!llm.chatWithTools) {
      throw new Error("LLM provider does not support chatWithTools. Use OpenAI-compatible provider.");
    }
    const result: ToolCallResult = await llm.chatWithTools(messages, toolDefinitions);

    if (result.toolCalls && result.toolCalls.length > 0) {
      // LLM wants to call tools — execute them
      // Append assistant message with tool_calls to history
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
          args = JSON.parse(tc.function.arguments);
        } catch {
          args = {};
        }

        steps.push({ type: "tool_call", content: `[调用] ${toolName}(${JSON.stringify(args).slice(0, 100)})` });
        if (onStream) onStream(`[调用] ${toolName}`);

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
        if (onStream) onStream(`[结果] ${toolOutput.slice(0, 80)}`);

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

  // Max steps reached — return last LLM output
  const lastMsg = messages[messages.length - 1];
  const answer = lastMsg?.content || "Max reasoning steps reached.";
  steps.push({ type: "answer", content: answer });
  return { answer, steps, toolCallsUsed };
}
