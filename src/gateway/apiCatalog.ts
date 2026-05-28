export type ApiEndpoint = {
  method: string;
  path: string;
  description: string;
  body?: string;
};

export const API_CATALOG: ApiEndpoint[] = [
  {
    method: "GET",
    path: "/api/gateway/overview",
    description: "网关总览：健康、鉴权、通道、活跃会话数",
  },
  {
    method: "GET",
    path: "/api/gateway/endpoints",
    description: "本服务全部 HTTP 接口列表",
  },
  {
    method: "GET",
    path: "/api/health",
    description: "健康检查（简版）",
  },
  {
    method: "GET",
    path: "/api/chat/sessions",
    description: "已落盘的 Web 对话会话列表",
  },
  {
    method: "GET",
    path: "/api/chat/sessions/:sessionId",
    description: "加载会话消息 + token 用量汇总",
  },
  {
    method: "PATCH",
    path: "/api/chat/sessions/:sessionId",
    description: "重命名 Web 会话",
    body: '{ "title": "string" }',
  },
  {
    method: "GET",
    path: "/api/usage/:channel/:peerId",
    description: "按 channel/peerId 读取 token 用量账本",
  },
  {
    method: "POST",
    path: "/api/chat",
    description: "发送消息，SSE 流式返回（event: session | delta | permission | done | error）",
    body: '{ "prompt": "string", "sessionId": "uuid?" }',
  },
  {
    method: "POST",
    path: "/api/chat/permission",
    description: "批准/拒绝 query 模式下的工具权限（配合 event: permission）",
    body: '{ "sessionId": "uuid", "requestId": "uuid", "allow": true }',
  },
  {
    method: "GET",
    path: "/api/sessions",
    description: "当前进程内活跃会话（Web / 微信）",
  },
  {
    method: "DELETE",
    path: "/api/sessions/:channel/:peerId",
    description: "移除活跃会话缓存",
  },
  {
    method: "GET",
    path: "/api/sessions/history",
    description: "Claude Code 磁盘历史会话（listSessions）",
  },
  {
    method: "GET",
    path: "/api/sessions/history/:sessionId/messages",
    description: "读取历史会话消息 transcript",
  },
  {
    method: "GET",
    path: "/api/skills",
    description: "已发现的 Skills（含目录位置）",
  },
  {
    method: "GET",
    path: "/api/skills/locations",
    description: "技能目录路径（项目 / 用户）",
  },
  {
    method: "POST",
    path: "/api/skills/upload",
    description: "上传 ZIP 安装技能（multipart: file, target, overwrite）",
    body: 'file: .zip, target: "project"|"user", overwrite?: boolean',
  },
  {
    method: "POST",
    path: "/api/skills/create",
    description: "创建空技能脚手架",
    body: '{ "name": "my-skill", "target": "project"|"user" }',
  },
  {
    method: "POST",
    path: "/api/skills/open-folder",
    description: "在本机打开技能目录（xdg-open / open / explorer）",
    body: '{ "target": "project"|"user" }',
  },
  {
    method: "GET",
    path: "/api/skills/:target/:name/content",
    description: "读取 SKILL.md 内容",
  },
  {
    method: "DELETE",
    path: "/api/skills/:target/:name",
    description: "删除指定技能目录",
  },
  {
    method: "GET",
    path: "/api/channels/weixin",
    description: "微信 iLink 通道状态",
  },
  {
    method: "GET",
    path: "/api/weixin/status",
    description: "微信状态（兼容旧路径）",
  },
];
