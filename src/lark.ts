/**
 * Lark (Feishu) IM Integration — 飞书消息收发
 *
 * 使用 @larksuiteoapi/node-sdk 的 Channel 模块（WebSocket 长连接）
 * 功能：
 *   - 接收飞书 DM / 群聊消息
 *   - 触发 nexus cycle
 *   - 回复 cycle 结果
 *
 * 环境变量（从 nexus.env 读取）：
 *   LARK_APP_ID, LARK_APP_SECRET
 */

import { createLarkChannel, type LarkChannel, type NormalizedMessage } from "@larksuiteoapi/node-sdk";

export interface LarkConfig {
  appId: string;
  appSecret: string;
  allowFrom?: string[]; // open_id whitelist (empty = allow all)
}

export interface LarkMessageHandler {
  (text: string, sender: { chatId: string; senderId: string; messageId: string }): Promise<string>;
}

let channel: LarkChannel | null = null;
const processedMessageIds = new Set<string>();
const MESSAGE_DEDUP_WINDOW = 100; // Keep last 100 message IDs

/**
 * Start Lark WebSocket connection and listen for messages.
 */
export async function startLarkBot(
  config: LarkConfig,
  onMessage: LarkMessageHandler
): Promise<void> {
  if (!config.appId || !config.appSecret) {
    console.warn("[Lark] Missing LARK_APP_ID or LARK_APP_SECRET — skipping");
    return;
  }

  channel = createLarkChannel({
    appId: config.appId,
    appSecret: config.appSecret,
  });

  channel.on("message", async (msg: NormalizedMessage) => {
    // Deduplicate: skip if we've already processed this message
    if (processedMessageIds.has(msg.messageId)) {
      console.log(`[Lark] Skipping duplicate message ${msg.messageId.slice(0, 16)}`);
      return;
    }
    processedMessageIds.add(msg.messageId);
    if (processedMessageIds.size > MESSAGE_DEDUP_WINDOW) {
      const first = processedMessageIds.values().next().value;
      if (first) processedMessageIds.delete(first);
    }

    // ALLOW_FROM whitelist check
    if (config.allowFrom && config.allowFrom.length > 0) {
      if (!config.allowFrom.includes(msg.senderId)) {
        console.log(`[Lark] Rejected message from unauthorized sender: ${msg.senderId.slice(0, 16)}`);
        return;
      }
    }

    console.log(`[Lark] Message from ${msg.senderId}: ${msg.content.slice(0, 100)}`);

    try {
      const reply = await onMessage(msg.content, {
        chatId: msg.chatId,
        senderId: msg.senderId,
        messageId: msg.messageId,
      });

      await channel!.send(
        msg.chatId,
        { text: reply.slice(0, 2000) }, // Lark text limit ~2000
        { replyTo: msg.messageId }
      );
    } catch (e: unknown) {
      const err = e instanceof Error ? e.message : String(e);
      console.error("[Lark] Handler failed:", err);
      await channel!.send(
        msg.chatId,
        { text: `[Error] ${err.slice(0, 500)}` },
        { replyTo: msg.messageId }
      );
    }
  });

  channel.on("error", (err) => {
    console.error("[Lark] Channel error:", err);
  });

  await channel.connect();
  console.log("[Lark] Connected — listening for messages");
}

/**
 * Stop Lark connection.
 */
export async function stopLarkBot(): Promise<void> {
  if (channel) {
    await channel.disconnect();
    channel = null;
    console.log("[Lark] Disconnected");
  }
}
