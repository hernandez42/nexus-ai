# Nexus AI — System Requirements Specification (SRS)

## 1. 概述

Nexus 是一个飞书机器人，基于 LLM 原生 tool calling（对齐 pi Amimo 的 runLoop 和 eve 的 ToolLoopAgent），接收用户消息后调用工具、推理、返回答案。

### 1.1 架构（对齐 pi Amimo）

```
飞书消息 → lark.ts
  → send "⏳ 收到，正在处理..." (ack)
  → runLightweightCycle(prompt, onProgress)
    → memory.query(prompt) → 构建 system prompt
    → buildToolSet() → 从 ToolRegistry 加载 22+ 工具
    → runToolLoop(systemPrompt, userPrompt, tools, llm)
      → LLM 原生 tool_calls → 执行工具 → 结果反馈 → LLM 继续推理
      → LLM 输出文本 → 循环结束
    → return answer
  → send final reply to user
```

### 1.2 两种运行模式

| 模式 | 流程 | LLM 调用次数 | 延迟 |
|------|------|-------------|------|
| **Lark（飞书）** | runLightweightCycle | 1-3 次 | 5-15s |
| **Daemon（后台）** | runFullCycle | 1-3 次 | 5-15s |

飞书模式**不跑** Glue/Deconstruction/Self-Awareness/Evolution。这些只在 daemon 模式后台运行。

## 2. 核心模块

### 2.1 tool-loop.ts — pi/eve 风格原生 tool calling

```typescript
runToolLoop({ systemPrompt, userPrompt, tools, llm, maxSteps, onStream })
```

- LLM 收到 system prompt + tools + user message
- LLM 自己决定：调用工具（原生 tool_calls）或直接回复文本
- 如果 tool_call：执行 → 结果追加到 messages → 循环
- 如果文本：返回作为最终答案
- maxSteps = 5（防止无限循环）

### 2.2 llm.ts — LLM 统一层

- 支持 OpenAI / Anthropic / Ollama / Mock
- `chat()` — 普通对话
- `chatWithTools()` — 原生 function calling（仅 OpenAI 完整实现）
- `chatStream()` — 流式输出
- 多 key fallback：401 自动跳下一个 key
- 全局限速：2 req/s
- 重试：3 次，指数退避

### 2.3 lark.ts — 飞书集成

- WebSocket 长连接（@larksuiteoapi/node-sdk）
- 消息去重（Set，窗口 100）
- 白名单（allowFrom）
- 即时确认："⏳ 收到，正在处理..."
- 进度更新：每 3s 发送 streaming chunk
- 最终回复：截断到 2000 字符
- 错误处理：catch → 发送 [Error] 消息

### 2.4 tools.ts — 工具注册表（22+ 工具）

| 类别 | 工具 |
|------|------|
| 文件 | read_file, write_file, list_dir, file_info |
| Shell | bash, grep, find, env |
| 代码 | parse_json, format_json, diff, count_lines |
| 记忆 | memory_query, memory_write, dreamer_tick |
| 网络 | fetch_url, http_post |

### 2.5 memory.ts — 三层记忆

- episodic（事件）/ semantic（知识）/ procedural（技能）
- TF-IDF + 余弦相似度检索
- JSON 持久化，30s 自动保存

### 2.6 local-reasoner.ts — 本地推理（无 LLM）

- 只处理简单查询：问候（hi/hello/你好）
- OBSERVE → RETRIEVE → REASON → COMPOSE → FINAL
- 失败时 fallback 到 tool loop

## 3. 配置

### 3.1 环境变量

| 变量 | 说明 | 必需 |
|------|------|------|
| `LLM_API_KEY` | LLM API 密钥 | 是 |
| `LLM_BASE_URL` | LLM API 地址 | 是 |
| `LARK_APP_ID` | 飞书应用 ID | Lark 模式必需 |
| `LARK_APP_SECRET` | 飞书应用密钥 | Lark 模式必需 |
| `LARK_ALLOW_FROM` | 允许的发送者 open_id（逗号分隔） | 否 |

### 3.2 config.json

```json
{
  "llm": {
    "provider": "openai",
    "model": "deepseek-v4-flash",
    "temperature": 0.7,
    "maxTokens": 4096
  },
  "workspaceDir": "./nexus-workspace",
  "memoryDir": "./nexus-workspace/memory",
  "logDir": "./nexus-workspace/logs"
}
```

注意：`apiKey` 和 `baseURL` 通过环境变量设置，不在 config.json 中。

## 4. 部署

### 4.1 服务器部署

```bash
cd /opt/nexus-test
git pull origin main
npm install
npm run build
sudo systemctl restart nexus-test
```

### 4.2 systemd 服务

```ini
[Unit]
Description=Nexus AI Bot
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/nexus-test
Exec=/usr/bin/node dist/nexus.js --lark
Restart=always
RestartSec=5
Environment=LLM_API_KEY=xxx
Environment=LLM_BASE_URL=xxx
Environment=LARK_APP_ID=xxx
Environment=LARK_APP_SECRET=xxx
Environment=LARK_ALLOW_FROM=xxx

[Install]
WantedBy=multi-user.target
```

### 4.3 验证

```bash
# 编译检查
npx tsc --noEmit

# 测试
npx vitest run

# 手动测试（单次运行）
node dist/nexus.js "你好"

# 飞书模式
node dist/nexus.js --lark
```

## 5. 已知限制

| 限制 | 说明 | 计划 |
|------|------|------|
| chatWithTools 仅 OpenAI | Anthropic/Ollama 不支持 tool calling | 后续适配 |
| 非流式 tool calling | LLM 生成文本时无实时输出 | 后续加 SSE 流式 |
| 2000 字符截断 | 飞书文本限制 | 后续分段发送 |
| TF-IDF 检索 | 无 vector embedding | 后续加 embedding |

## 6. 代码质量

- TypeScript 严格模式：0 错误
- 测试：36 个测试全过
- CodeGraph 扫描：无断开调用链
- CI/CD：GitHub Actions 自动构建 + 测试
