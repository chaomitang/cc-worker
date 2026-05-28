#!/usr/bin/env node
import "./loadEnv.js";
import express from "express";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { SessionStore } from "./session/SessionStore.js";
import { streamChat } from "./services/chatService.js";
import { registerGatewayRoutes } from "./routes/gatewayRoutes.js";
import { registerSkillsRoutes } from "./routes/skillsRoutes.js";
import { registerChatRoutes } from "./routes/chatRoutes.js";
import { IlinkClient } from "./weixin/ilinkClient.js";
import { WeixinBridge } from "./weixin/weixinBridge.js";
import { setWeixinStatus } from "./weixin/bridgeState.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, "..", "public");
const port = Number(process.env.CC_WORKER_PORT ?? 3000);

const sessionStore = new SessionStore({
  permissionMode:
    (process.env.CC_WORKER_PERMISSION_MODE as "acceptEdits" | "default") ?? "acceptEdits",
});

const app = express();
app.use(express.json({ limit: "2mb" }));
app.use(express.static(publicDir));

registerGatewayRoutes(app, sessionStore);
registerSkillsRoutes(app);
registerChatRoutes(app, sessionStore);

app.get("/api/health", async (_req, res) => {
  const client = new IlinkClient();
  await client.loadToken();
  res.json({
    ok: true,
    sessions: sessionStore.size(),
    weixin: Boolean(process.env.ILINK_BOT_TOKEN || process.env.ILINK_ENABLE === "1"),
    auth: {
      hasApiKey: Boolean(process.env.ANTHROPIC_API_KEY),
      baseUrl: process.env.ANTHROPIC_BASE_URL ?? null,
      model: process.env.ANTHROPIC_MODEL ?? null,
    },
  });
});

app.post("/api/chat", async (req, res) => {
  const prompt = String(req.body?.prompt ?? "").trim();
  const sessionId = String(req.body?.sessionId ?? randomUUID());

  if (!prompt) {
    res.status(400).json({ error: "prompt is required" });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  const send = (event: string, data: unknown) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  send("session", { sessionId });

  try {
    for await (const ev of streamChat(sessionStore, "web", sessionId, prompt, (request) => {
      send("permission", { request });
    })) {
      if (ev.type === "text") send("delta", { text: ev.delta });
      else if (ev.type === "done") send("done", ev);
      else if (ev.type === "error") send("error", { message: ev.message });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    send("error", { message });
  }

  res.end();
});

app.post("/api/chat/permission", (req, res) => {
  const sessionId = String(req.body?.sessionId ?? "").trim();
  const requestId = String(req.body?.requestId ?? "").trim();
  const allow = req.body?.allow !== false;

  if (!sessionId || !requestId) {
    res.status(400).json({ error: "sessionId 与 requestId 必填" });
    return;
  }

  const broker = sessionStore.getPermissionBroker("web", sessionId);
  const info = broker.respond(requestId, allow);
  if (!info) {
    res.status(404).json({ error: "权限请求不存在或已过期" });
    return;
  }
  res.json({ ok: true, toolName: info.toolName });
});

app.listen(port, () => {
  console.log(`cc-worker gateway UI: http://localhost:${port}`);
});

if (process.env.ILINK_ENABLE === "1" || process.env.ILINK_BOT_TOKEN) {
  setWeixinStatus({ enabled: true });
  const client = new IlinkClient();
  const bridge = new WeixinBridge({
    client,
    sessionStore,
    onStatus: (msg) => {
      console.log(`[iLink] ${msg}`);
      setWeixinStatus({ status: msg });
    },
  });
  bridge.start().catch((err) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[iLink] bridge failed to start:", err);
    setWeixinStatus({ lastError: message, status: "error", running: false });
  });
}
