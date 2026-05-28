import type { Express } from "express";
import { API_CATALOG } from "../gateway/apiCatalog.js";
import { listHistorySessions, loadHistoryMessages } from "../services/sessionHistory.js";
import type { SessionStore } from "../session/SessionStore.js";
import { IlinkClient } from "../weixin/ilinkClient.js";
import { weixinBridgeState } from "../weixin/bridgeState.js";

function projectCwd(): string {
  return process.env.CC_WORKER_CWD ?? process.cwd();
}

function maskKey(key: string | undefined): string | null {
  if (!key) return null;
  if (key.length <= 8) return "***";
  return `${key.slice(0, 4)}…${key.slice(-4)}`;
}

export function registerGatewayRoutes(app: Express, sessionStore: SessionStore): void {
  app.get("/api/gateway/endpoints", (_req, res) => {
    res.json({ endpoints: API_CATALOG });
  });

  app.get("/api/gateway/overview", async (_req, res) => {
    const client = new IlinkClient();
    await client.loadToken();

    res.json({
      ok: true,
      uptimeSec: Math.floor(process.uptime()),
      cwd: projectCwd(),
      auth: {
        hasApiKey: Boolean(process.env.ANTHROPIC_API_KEY),
        apiKeyPreview: maskKey(process.env.ANTHROPIC_API_KEY),
        baseUrl: process.env.ANTHROPIC_BASE_URL ?? null,
        model: process.env.ANTHROPIC_MODEL ?? null,
        permissionMode: process.env.CC_WORKER_PERMISSION_MODE ?? "acceptEdits",
        interactivePermissions: process.env.CC_WORKER_INTERACTIVE_PERMISSIONS ?? "0",
        allowDangerouslySkip: process.env.CC_WORKER_ALLOW_DANGEROUS_SKIP ?? "0",
      },
      channels: {
        web: {
          id: "web",
          label: "Web",
          status: "up",
          activeSessions: sessionStore.listActive().filter((s) => s.channel === "web").length,
        },
        weixin: {
          id: "weixin",
          label: "微信 iLink",
          ...weixinBridgeState,
          connectionStatus: weixinBridgeState.running
            ? "connected"
            : weixinBridgeState.enabled
              ? weixinBridgeState.lastError
                ? "error"
                : "starting"
              : "disabled",
          hasToken: Boolean(client.getToken() || process.env.ILINK_BOT_TOKEN),
        },
      },
      sessions: {
        active: sessionStore.size(),
      },
    });
  });

  app.get("/api/sessions", (_req, res) => {
    res.json({ sessions: sessionStore.listActive() });
  });

  app.delete("/api/sessions/:channel/:peerId", (req, res) => {
    const channel = req.params.channel as "web" | "weixin";
    if (channel !== "web" && channel !== "weixin") {
      res.status(400).json({ error: "invalid channel" });
      return;
    }
    const removed = sessionStore.remove(channel, decodeURIComponent(req.params.peerId));
    res.json({ removed });
  });

  app.get("/api/sessions/history", async (req, res) => {
    try {
      const limit = Math.min(Number(req.query.limit) || 50, 100);
      const sessions = await listHistorySessions(projectCwd(), limit);
      res.json({ cwd: projectCwd(), sessions });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  app.get("/api/sessions/history/:sessionId/messages", async (req, res) => {
    try {
      const limit = Math.min(Number(req.query.limit) || 40, 200);
      const messages = await loadHistoryMessages(
        req.params.sessionId,
        projectCwd(),
        limit,
      );
      res.json({ sessionId: req.params.sessionId, messages });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  app.get("/api/channels/weixin", async (_req, res) => {
    const client = new IlinkClient();
    await client.loadToken();
    res.json({
      channel: "weixin",
      protocol: "iLink Bot API",
      baseUrl: process.env.ILINK_BASE_URL ?? "https://ilinkai.weixin.qq.com",
      ...weixinBridgeState,
      enabled:
        weixinBridgeState.enabled ||
        process.env.ILINK_ENABLE === "1" ||
        Boolean(process.env.ILINK_BOT_TOKEN),
      hasToken: Boolean(client.getToken() || process.env.ILINK_BOT_TOKEN),
      tokenFile: process.env.ILINK_TOKEN_FILE ?? ".data/ilink-bot-token.json",
    });
  });

  app.get("/api/weixin/status", async (_req, res) => {
    const client = new IlinkClient();
    await client.loadToken();
    res.json({
      enabled: process.env.ILINK_ENABLE === "1" || Boolean(process.env.ILINK_BOT_TOKEN),
      hasToken: Boolean(client.getToken() || process.env.ILINK_BOT_TOKEN),
      bridge: weixinBridgeState,
    });
  });
}
