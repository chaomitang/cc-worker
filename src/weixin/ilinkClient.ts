import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type {
  GetUpdatesResponse,
  QrcodeResponse,
  QrcodeStatusResponse,
  WeixinMessage,
} from "./types.js";

const DEFAULT_BASE = "https://ilinkai.weixin.qq.com";

export type IlinkClientOptions = {
  baseUrl?: string;
  botToken?: string;
  tokenFile?: string;
};

function randomWechatUin(): string {
  const n = Math.floor(Math.random() * 0xffffffff);
  return Buffer.from(String(n), "utf8").toString("base64");
}

export class IlinkClient {
  private botToken: string | undefined;
  private readonly baseUrl: string;
  private readonly tokenFile: string;
  private getUpdatesBuf = "";

  constructor(options: IlinkClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? process.env.ILINK_BASE_URL ?? DEFAULT_BASE).replace(
      /\/$/,
      "",
    );
    this.botToken = options.botToken ?? process.env.ILINK_BOT_TOKEN;
    this.tokenFile =
      options.tokenFile ?? process.env.ILINK_TOKEN_FILE ?? ".data/ilink-bot-token.json";
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = {
      "Content-Type": "application/json",
      AuthorizationType: "ilink_bot_token",
      "X-WECHAT-UIN": randomWechatUin(),
    };
    if (this.botToken) {
      h.Authorization = `Bearer ${this.botToken}`;
    }
    return h;
  }

  async loadToken(): Promise<boolean> {
    if (this.botToken) return true;
    try {
      const raw = await readFile(this.tokenFile, "utf8");
      const data = JSON.parse(raw) as { bot_token?: string };
      if (data.bot_token) {
        this.botToken = data.bot_token;
        return true;
      }
    } catch {
      // no saved token
    }
    return false;
  }

  async saveToken(token: string): Promise<void> {
    this.botToken = token;
    await mkdir(dirname(this.tokenFile), { recursive: true });
    await writeFile(this.tokenFile, JSON.stringify({ bot_token: token }, null, 2), "utf8");
  }

  getToken(): string | undefined {
    return this.botToken;
  }

  async fetchQrcode(): Promise<QrcodeResponse> {
    const res = await fetch(`${this.baseUrl}/ilink/bot/get_bot_qrcode?bot_type=3`, {
      headers: this.headers(),
    });
    if (!res.ok) throw new Error(`get_bot_qrcode HTTP ${res.status}`);
    return (await res.json()) as QrcodeResponse;
  }

  async fetchQrcodeStatus(qrcode: string): Promise<QrcodeStatusResponse> {
    const res = await fetch(
      `${this.baseUrl}/ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcode)}`,
      { headers: this.headers() },
    );
    if (!res.ok) throw new Error(`get_qrcode_status HTTP ${res.status}`);
    return (await res.json()) as QrcodeStatusResponse;
  }

  /** Poll until confirmed or timeout. Returns bot_token. */
  async waitForLogin(qrcode: string, timeoutMs = 120_000): Promise<string> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const status = await this.fetchQrcodeStatus(qrcode);
      if (status.status === "confirmed" && status.bot_token) {
        await this.saveToken(status.bot_token);
        return status.bot_token;
      }
      await sleep(1500);
    }
    throw new Error("WeChat iLink login timeout");
  }

  async getUpdates(): Promise<GetUpdatesResponse> {
    if (!this.botToken) throw new Error("iLink bot_token not set; login first");
    const res = await fetch(`${this.baseUrl}/ilink/bot/getupdates`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        get_updates_buf: this.getUpdatesBuf,
        base_info: { channel_version: "1.0.0" },
      }),
    });
    if (!res.ok) throw new Error(`getupdates HTTP ${res.status}`);
    const data = (await res.json()) as GetUpdatesResponse;
    if (data.get_updates_buf) {
      this.getUpdatesBuf = data.get_updates_buf;
    }
    return data;
  }

  async sendText(toUserId: string, text: string, contextToken: string): Promise<void> {
    if (!this.botToken) throw new Error("iLink bot_token not set");
    const chunks = splitText(text, 3500);
    for (const chunk of chunks) {
      const res = await fetch(`${this.baseUrl}/ilink/bot/sendmessage`, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({
          msg: {
            to_user_id: toUserId,
            message_type: 2,
            message_state: 2,
            context_token: contextToken,
            item_list: [{ type: 1, text_item: { text: chunk } }],
          },
        }),
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`sendmessage HTTP ${res.status}: ${body}`);
      }
    }
  }

  loadCursor(buf: string): void {
    this.getUpdatesBuf = buf;
  }

  getCursor(): string {
    return this.getUpdatesBuf;
  }
}

export function extractInboundText(msg: WeixinMessage): string | null {
  if (msg.message_type !== 1) return null;
  const parts: string[] = [];
  for (const item of msg.item_list ?? []) {
    if (item.type === 1 && item.text_item?.text) {
      parts.push(item.text_item.text);
    }
  }
  const text = parts.join("\n").trim();
  return text || null;
}

function splitText(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text];
  const chunks: string[] = [];
  let i = 0;
  while (i < text.length) {
    chunks.push(text.slice(i, i + maxLen));
    i += maxLen;
  }
  return chunks;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
