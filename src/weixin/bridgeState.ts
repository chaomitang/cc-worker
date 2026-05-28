export type WeixinBridgeState = {
  enabled: boolean;
  running: boolean;
  hasToken: boolean;
  status: string;
  lastError: string | null;
  lastPollAt: number | null;
  messagesHandled: number;
};

export const weixinBridgeState: WeixinBridgeState = {
  enabled: false,
  running: false,
  hasToken: false,
  status: "disabled",
  lastError: null,
  lastPollAt: null,
  messagesHandled: 0,
};

export function setWeixinStatus(partial: Partial<WeixinBridgeState>): void {
  Object.assign(weixinBridgeState, partial);
}
