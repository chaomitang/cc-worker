# cc-worker

基于 [@anthropic-ai/claude-agent-sdk](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk) 的 Agent 封装：在 Node 中调用 **Claude Code 完整能力**，并支持 **Web 聊天页** 与 **微信 iLink** 对话。

## 架构

```
Web 浏览器 ──POST /api/chat (SSE)──┐
                                   ├── SessionStore ── CcWorkerAgent ── Claude Code CLI
微信用户 ── iLink 长轮询 ──────────┘                              └── 你的模型网关
```

## 环境要求

- Node.js 18+
- pnpm

## 安装

```bash
pnpm install
pnpm build
```

## 配置

```bash
cp .env.example .env
# 编辑 .env 即可；启动时会自动加载（无需手动 source）
```

启动后访问 http://localhost:3000/api/health ，确认 `auth.hasApiKey` 为 `true`、`auth.baseUrl` 为你的网关地址。

### 常用环境变量

| 变量 | 说明 |
|------|------|
| `ANTHROPIC_BASE_URL` | Anthropic Messages 兼容 API（你的网关） |
| `ANTHROPIC_API_KEY` | API Key |
| `ANTHROPIC_MODEL` | 默认模型 ID |
| `CC_WORKER_CWD` | Agent 工作目录 |
| `CC_WORKER_PERMISSION_MODE` | 见下方「query 模式与权限」 |
| `CC_WORKER_ALLOW_DANGEROUS_SKIP` | 与 `bypassPermissions` 同用，设为 `1` |
| `CC_WORKER_INTERACTIVE_PERMISSIONS` | 设为 `1` 时 Web 对话页可点「允许/拒绝」 |
| `CC_WORKER_PORT` | Web 服务端口，默认 `3000` |
| `ILINK_ENABLE` | 设为 `1` 启动微信 iLink 桥接 |
| `ILINK_BOT_TOKEN` | 扫码登录后的 bot token（可写入 `.data/ilink-bot-token.json`） |

## Web 网关控制台

启动带 UI 的服务：

```bash
pnpm dev:web
# 或 pnpm build && pnpm start:web
```

浏览器打开 **http://localhost:3000**，控制台包含：

| 页面 | 功能 |
|------|------|
| **概览** | 健康状态、鉴权、Web/微信通道、接口快速探测 |
| **对话** | 左侧「网关会话 / Claude 磁盘」切换；网关对话落盘恢复；Claude 磁盘为完整表格 + transcript 对照 |
| **技能** | 查看路径、拖放 ZIP 安装、新建脚手架、打开本机目录、查看/删除技能 |
| **API** | 全部 HTTP 接口列表，GET 接口可一键试用 |

主要 API：`/api/gateway/overview`、`/api/channels/weixin`、`/api/sessions`、`/api/sessions/history`、`/api/skills`、`/api/chat/sessions/:id`（历史+用量）、`/api/usage/:channel/:peerId`

对话与用量落盘目录（默认 `.data/`）：

- `.data/chats/web/<sessionId>.json` — 消息记录（刷新页面后从磁盘加载）
- `.data/usage/web/<sessionId>.json` — 按次 query 累计 **token**（input/output/cache，不依赖美元估算）

技能目录约定：项目 `<cwd>/.claude/skills/<name>/SKILL.md`，用户 `~/.claude/skills/<name>/SKILL.md`。在控制台 **技能** 页可拖入 ZIP 安装；「打开目录」需在运行服务的本机执行（调用 `xdg-open` / `open` / `explorer`）。

### query 模式与权限

SDK 的 `query()` **没有终端**，不会出现 Claude Code CLI 那种可点的 Allow 弹窗。若仍看到「需要批准写入」但点不了，是因为权限卡在子进程里、宿主没有 UI。

可选方案：

| 方式 | 配置 | 适用 |
|------|------|------|
| 自动放行编辑 | `CC_WORKER_PERMISSION_MODE=acceptEdits`（默认） | 改已有文件；**新建/Write 仍可能要问** |
| 全部自动放行 | `CC_WORKER_PERMISSION_MODE=bypassPermissions` + `CC_WORKER_ALLOW_DANGEROUS_SKIP=1` | 本机可信环境、自动化 |
| Web 里点允许 | `CC_WORKER_INTERACTIVE_PERMISSIONS=1` | 对话页出现黄条，点「允许」调用 `POST /api/chat/permission` |
| 不经过 Agent 写技能 | 控制台 **技能** 页拖 ZIP / 新建 | 写 `SKILL.md` 不需要工具权限 |

## 微信 iLink

腾讯官方 **iLink Bot API**（`ilinkai.weixin.qq.com`），个人号 1v1 私聊，HTTP/JSON，无需 Hook。

1. 在 `.env` 中设置 `ILINK_ENABLE=1`
2. 启动 `pnpm dev:web`（与 Web 共用同一进程）
3. 首次无 token 时会拉取登录二维码；用微信扫码完成授权
4. Token 保存到 `.data/ilink-bot-token.json`，下次自动使用
5. 用户发来的微信文字会交给 `CcWorkerAgent`，回复通过 `sendmessage` 发回

也可在其他环境登录后，将 `bot_token` 填入 `ILINK_BOT_TOKEN`。

参考：[iLink 协议说明](https://github.com/hao-ji-xing/openclaw-weixin/blob/main/weixin-bot-api.md)、npm `@tencent-weixin/openclaw-weixin`。

## CLI

```bash
pnpm dev "列出当前目录下的文件"
pnpm start "分析 src 目录结构"
```

## 作为库使用

```typescript
import { CcWorkerAgent } from "cc-worker";

const agent = new CcWorkerAgent();
const result = await agent.run("你的任务");
console.log(result.text, result.sessionId);
```

## 脚本

| 命令 | 说明 |
|------|------|
| `pnpm dev:web` | Web + 可选 iLink 服务 |
| `pnpm start:web` | 编译后运行 Web 服务 |
| `pnpm dev <prompt>` | 命令行单次任务 |
| `pnpm build` | 编译 TypeScript |
| `pnpm typecheck` | 类型检查 |

## 许可证

MIT
