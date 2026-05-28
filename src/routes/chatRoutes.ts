import type { Express } from "express";
import { chatHistoryStore } from "../storage/chatHistoryStore.js";
import { usageStore } from "../storage/usageStore.js";
import type { SessionStore } from "../session/SessionStore.js";

export function registerChatRoutes(app: Express, sessionStore: SessionStore): void {
  app.get("/api/chat/sessions", async (_req, res) => {
    try {
      const sessions = await chatHistoryStore.listWebSessions();
      const enriched = await Promise.all(
        sessions.map(async (s) => {
          const ledger = await usageStore.getLedger("web", s.sessionId);
          return {
            ...s,
            queryCount: ledger.queryCount,
            tokenTotals: ledger.totals,
          };
        }),
      );
      res.json({ sessions: enriched });
    } catch (err) {
      res.status(500).json({ error: formatErr(err) });
    }
  });

  app.get("/api/chat/sessions/:sessionId", async (req, res) => {
    try {
      const sessionId = String(req.params.sessionId ?? "").trim();
      if (!sessionId) {
        res.status(400).json({ error: "sessionId required" });
        return;
      }

      const chat = await chatHistoryStore.getSession("web", sessionId);
      const usage = await usageStore.getLedger("web", sessionId);

      const claudeSessionId =
        chat.claudeSessionId ??
        sessionStore.getClaudeSessionId("web", sessionId) ??
        undefined;

      res.json({
        sessionId: chat.peerId,
        channel: chat.channel,
        title: chat.title,
        createdAt: chat.createdAt,
        updatedAt: chat.updatedAt,
        claudeSessionId,
        messages: chat.messages,
        usage: {
          queryCount: usage.queryCount,
          totals: usage.totals,
          recentQueries: usage.queries.slice(-30),
        },
      });
    } catch (err) {
      res.status(500).json({ error: formatErr(err) });
    }
  });

  app.patch("/api/chat/sessions/:sessionId", async (req, res) => {
    try {
      const sessionId = String(req.params.sessionId ?? "").trim();
      const title = String(req.body?.title ?? "").trim();
      if (!sessionId) {
        res.status(400).json({ error: "sessionId required" });
        return;
      }
      const session = await chatHistoryStore.renameSession("web", sessionId, title);
      res.json({
        sessionId: session.peerId,
        title: session.title,
        updatedAt: session.updatedAt,
      });
    } catch (err) {
      res.status(400).json({ error: formatErr(err) });
    }
  });

  app.get("/api/usage/:channel/:peerId", async (req, res) => {
    try {
      const channel = req.params.channel === "weixin" ? "weixin" : "web";
      const peerId = String(req.params.peerId ?? "").trim();
      if (!peerId) {
        res.status(400).json({ error: "peerId required" });
        return;
      }
      const ledger = await usageStore.getLedger(channel, peerId);
      res.json(ledger);
    } catch (err) {
      res.status(500).json({ error: formatErr(err) });
    }
  });
}

function formatErr(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
