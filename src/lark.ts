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
  (text: string, sender: { chatId: string; senderId: string; messageId: string }, onProgress?: (chunk: string) => void): Promise<string>;
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
    // Defense: "*" or empty strings in allowFrom = allow all (misconfig protection)
    const effectiveWhitelist = (config.allowFrom || []).filter(s => s && s !== "*");
    if (effectiveWhitelist.length > 0) {
      if (!effectiveWhitelist.includes(msg.senderId)) {
        console.log(`[Lark] Rejected message from unauthorized sender: ${msg.senderId.slice(0, 16)}`);
        return;
      }
    }

    console.log(`[Lark] Message from ${msg.senderId}: ${String(msg.content).slice(0, 100)}`);

    // Ensure content is string (SDK may return object for rich text messages)
    const textContent = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);

    try {
      // 1. Send acknowledgment immediately (like nanobot)
      await channel!.send(
        msg.chatId,
        { text: "⏳ 收到，正在处理..." },
        { replyTo: msg.messageId }
      );

      // 2. Collect streaming chunks for progress updates
      let progressBuffer = "";
      let progressTimer: ReturnType<typeof setTimeout> | null = null;
      let lastSentLen = 0;

      const onProgress = (chunk: string) => {
        progressBuffer += chunk;
        // Send progress update every 3 seconds
        if (!progressTimer) {
          progressTimer = setTimeout(async () => {
            progressTimer = null;
            if (progressBuffer.length > lastSentLen) {
              const update = progressBuffer.slice(lastSentLen, lastSentLen + 200);
              lastSentLen += update.length;
              try {
                await channel!.send(
                  msg.chatId,
                  { text: `📝 ${update}...` },
                  { replyTo: msg.messageId }
                );
              } catch { /* ignore send errors during streaming */ }
            }
          }, 3000);
        }
      };

      // 3. Run handler (may take 30-90s)
      const reply = await onMessage(textContent, {
        chatId: msg.chatId,
        senderId: msg.senderId,
        messageId: msg.messageId,
      }, onProgress);

      // Clear progress timer
      if (progressTimer) clearTimeout(progressTimer);

      // 4. Send final reply
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
