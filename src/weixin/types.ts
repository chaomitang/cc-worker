export type IlinkTextItem = {
  type: 1;
  text_item: { text: string };
};

export type WeixinMessage = {
  from_user_id: string;
  to_user_id: string;
  message_type: number;
  message_state: number;
  context_token: string;
  item_list?: Array<{ type: number; text_item?: { text: string } }>;
};

export type QrcodeResponse = {
  ret: number;
  qrcode?: string;
  qrcode_img_content?: string;
};

export type QrcodeStatusResponse = {
  ret: number;
  status?: string;
  bot_token?: string;
  baseurl?: string;
};

export type GetUpdatesResponse = {
  ret: number;
  msgs?: WeixinMessage[];
  get_updates_buf?: string;
  longpolling_timeout_ms?: number;
};
