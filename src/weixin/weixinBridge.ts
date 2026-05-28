import { runChat } from "../services/chatService.js";
import type { SessionStore } from "../session/SessionStore.js";
import { extractInboundText, IlinkClient } from "./ilinkClient.js";
import { setWeixinStatus, weixinBridgeState } from "./bridgeState.js";
import type { WeixinMessage } from "./types.js";

export type WeixinBridgeOptions = {
  client: IlinkClient;
  sessionStore: SessionStore;
  onStatus?: (msg: string) => void;
};

export class WeixinBridge {
  private running = false;

  constructor(private readonly options: WeixinBridgeOptions) {}

  async start(): Promise<void> {
    const { client, onStatus } = this.options;
    setWeixinStatus({ enabled: true, status: "starting", lastError: null });
    const hasToken = await client.loadToken();
    setWeixinStatus({ hasToken: hasToken || Boolean(process.env.ILINK_BOT_TOKEN) });
    if (!hasToken) {
      onStatus?.("No ILINK_BOT_TOKEN — fetching QR code (see server logs)...");
      const qr = await client.fetchQrcode();
      if (!qr.qrcode) {
        throw new Error(`get_bot_qrcode failed: ret=${qr.ret}`);
      }
      onStatus?.(`Scan WeChat QR — qrcode id: ${qr.qrcode}`);
      if (qr.qrcode_img_content) {
        console.log("\n[iLink] QR image (base64) length:", qr.qrcode_img_content.length);
        console.log("[iLink] Open WeChat → scan the QR shown in OpenClaw / ilink login flow.");
        console.log("[iLink] Or set ILINK_BOT_TOKEN after logging in elsewhere.\n");
      }
      await client.waitForLogin(qr.qrcode);
      onStatus?.("WeChat iLink login confirmed.");
    } else {
      onStatus?.("WeChat iLink using saved bot token.");
    }

    this.running = true;
    setWeixinStatus({ running: true, status: "polling" });
    void this.pollLoop();
  }

  stop(): void {
    this.running = false;
    setWeixinStatus({ running: false, status: "stopped" });
  }

  private async pollLoop(): Promise<void> {
    const { client, sessionStore, onStatus } = this.options;
    onStatus?.("WeChat iLink long-polling started.");

    while (this.running) {
      try {
        const { msgs } = await client.getUpdates();
        setWeixinStatus({ lastPollAt: Date.now(), lastError: null, status: "polling" });
        for (const msg of msgs ?? []) {
          await this.handleMessage(msg, sessionStore, client);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error("[iLink] poll error:", message);
        setWeixinStatus({ lastError: message, status: "error" });
        await sleep(3000);
      }
    }
  }

  private async handleMessage(
    msg: WeixinMessage,
    sessionStore: SessionStore,
    client: IlinkClient,
  ): Promise<void> {
    const text = extractInboundText(msg);
    if (!text) return;

    const peerId = msg.from_user_id;
    console.log(`[iLink] <- ${peerId}: ${text.slice(0, 80)}${text.length > 80 ? "…" : ""}`);

    try {
      const { text: reply } = await runChat(sessionStore, "weixin", peerId, text);
      await client.sendText(peerId, reply || "（无回复内容）", msg.context_token);
      setWeixinStatus({ messagesHandled: weixinBridgeState.messagesHandled + 1 });
      console.log(`[iLink] -> ${peerId}: ${(reply || "").slice(0, 80)}…`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[iLink] agent error:", message);
      try {
        await client.sendText(
          peerId,
          `处理失败：${message.slice(0, 500)}`,
          msg.context_token,
        );
      } catch (sendErr) {
        console.error("[iLink] failed to send error reply:", sendErr);
      }
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
