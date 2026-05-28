import {
  configureMarkdown,
  enhanceCodeBlocks,
  isRendererReady,
  renderMarkdown,
} from "./chatRenderer.js";

const STORAGE_KEY = "cc-worker-session-id";
const TITLES = {
  overview: "概览",
  chat: "对话",
  skills: "技能",
  api: "API 接口",
};

const CHAT_LAYOUT_VERSION = "3";

let overviewData = null;
let sidebarMode = "gateway";

function getSessionId() {
  let id = localStorage.getItem(STORAGE_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(STORAGE_KEY, id);
  }
  return id;
}

function setSessionId(id) {
  localStorage.setItem(STORAGE_KEY, id);
}

function esc(s) {
  const d = document.createElement("div");
  d.textContent = s ?? "";
  return d.innerHTML;
}

function fmtTime(ts) {
  if (!ts) return "—";
  return new Date(ts).toLocaleString("zh-CN");
}

function fmtRelative(ts) {
  if (!ts) return "—";
  const diff = Date.now() - ts;
  if (diff < 60_000) return "刚刚";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  if (diff < 604_800_000) return `${Math.floor(diff / 86_400_000)} 天前`;
  return fmtTime(ts);
}

function formatTokensShort(t) {
  if (!t?.totalTokens) return "";
  const fmt = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
  return `${fmt(t.totalTokens)} tokens`;
}

function badge(label, kind = "") {
  return `<span class="badge ${kind}">${esc(label)}</span>`;
}

async function api(path, opts) {
  const res = await fetch(path, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function showView(name) {
  document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
  document.querySelectorAll(".nav-item").forEach((n) => n.classList.remove("active"));
  document.getElementById(`view-${name}`)?.classList.add("active");
  document.querySelector(`.nav-item[data-view="${name}"]`)?.classList.add("active");
  document.getElementById("view-title").textContent = TITLES[name] ?? name;
  location.hash = name;

  if (name === "overview") renderOverview();
  if (name === "chat") {
    ensureChat();
    chatReloadHistory?.();
  }
  if (name === "skills") renderSkills();
  if (name === "api") renderApi();
}

function renderGlobalBadges(data) {
  const el = document.getElementById("global-status");
  if (!data) {
    el.innerHTML = badge("加载中…", "warn");
    return;
  }
  const authOk = data.auth?.hasApiKey;
  const wx = data.channels?.weixin;
  el.innerHTML = [
    badge(authOk ? "API Key ✓" : "无 API Key", authOk ? "ok" : "err"),
    badge(`Web ${data.channels?.web?.activeSessions ?? 0}`, "ok"),
    badge(
      `微信 ${wx?.connectionStatus ?? wx?.status ?? "—"}`,
      wx?.running || wx?.connectionStatus === "connected"
        ? "ok"
        : wx?.enabled
          ? "warn"
          : "",
    ),
  ].join("");
}

async function loadOverview() {
  overviewData = await api("/api/gateway/overview");
  renderGlobalBadges(overviewData);
  return overviewData;
}

function renderOverview() {
  const root = document.getElementById("view-overview");
  if (!overviewData) {
    root.innerHTML = `<p class="empty">加载中…</p>`;
    loadOverview().then(() => renderOverview()).catch((e) => {
      root.innerHTML = `<p class="empty">${esc(e.message)}</p>`;
    });
    return;
  }

  const d = overviewData;
  const wx = d.channels.weixin;

  root.innerHTML = `
    <div class="grid">
      <div class="card">
        <h3>服务</h3>
        <dl class="kv">
          <dt>状态</dt><dd>${d.ok ? "运行中" : "异常"}</dd>
          <dt>运行时长</dt><dd>${d.uptimeSec}s</dd>
          <dt>工作目录</dt><dd>${esc(d.cwd)}</dd>
          <dt>活跃会话</dt><dd>${d.sessions.active}</dd>
        </dl>
      </div>
      <div class="card">
        <h3>模型 / 鉴权</h3>
        <dl class="kv">
          <dt>Base URL</dt><dd>${esc(d.auth.baseUrl)}</dd>
          <dt>Model</dt><dd>${esc(d.auth.model)}</dd>
          <dt>API Key</dt><dd>${d.auth.hasApiKey ? esc(d.auth.apiKeyPreview) : "未配置"}</dd>
          <dt>权限模式</dt><dd>${esc(d.auth.permissionMode)}</dd>
        </dl>
      </div>
      <div class="card">
        <h3>通道 · Web</h3>
        <dl class="kv">
          <dt>状态</dt><dd>${esc(d.channels.web.status)}</dd>
          <dt>活跃会话</dt><dd>${d.channels.web.activeSessions}</dd>
        </dl>
      </div>
      <div class="card">
        <h3>通道 · 微信 iLink</h3>
        <dl class="kv">
          <dt>启用</dt><dd>${wx.enabled ? "是" : "否"}</dd>
          <dt>连接</dt><dd>${esc(wx.connectionStatus ?? wx.status)}</dd>
          <dt>轮询</dt><dd>${wx.running ? "运行中" : "未运行"}</dd>
          <dt>Token</dt><dd>${wx.hasToken ? "已配置" : "无"}</dd>
          <dt>上次轮询</dt><dd>${fmtTime(wx.lastPollAt)}</dd>
          <dt>已处理消息</dt><dd>${wx.messagesHandled ?? 0}</dd>
          <dt>最近错误</dt><dd>${esc(wx.lastError || "—")}</dd>
        </dl>
        <p style="margin-top:0.75rem"><button class="btn sm ghost" type="button" id="btn-wx-detail">查看通道详情</button></p>
      </div>
    </div>
    <div class="card" style="margin-top:1rem">
      <h3>快速探测</h3>
      <p class="empty" style="padding:0 0 0.5rem">点击下方按钮直接调用接口（结果展示在下方）</p>
      <div style="display:flex;gap:0.5rem;flex-wrap:wrap;margin-bottom:0.75rem">
        <button type="button" class="btn sm" data-probe="/api/health">GET /api/health</button>
        <button type="button" class="btn sm" data-probe="/api/gateway/overview">GET /api/gateway/overview</button>
        <button type="button" class="btn sm" data-probe="/api/channels/weixin">GET /api/channels/weixin</button>
        <button type="button" class="btn sm" data-probe="/api/sessions">GET /api/sessions</button>
        <button type="button" class="btn sm" data-probe="/api/skills">GET /api/skills</button>
      </div>
      <pre class="pre" id="probe-result">（尚未请求）</pre>
    </div>
  `;

  root.querySelector("#btn-wx-detail")?.addEventListener("click", async () => {
    const pre = root.querySelector("#probe-result");
    try {
      pre.textContent = JSON.stringify(await api("/api/channels/weixin"), null, 2);
    } catch (e) {
      pre.textContent = e.message;
    }
  });

  root.querySelectorAll("[data-probe]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const pre = root.querySelector("#probe-result");
      pre.textContent = "请求中…";
      try {
        const data = await api(btn.dataset.probe);
        pre.textContent = JSON.stringify(data, null, 2);
      } catch (e) {
        pre.textContent = e.message;
      }
    });
  });
}

/** @type {(() => Promise<void>) | null} */
let chatReloadHistory = null;
/** @type {(() => Promise<void>) | null} */
let chatRefreshSidebar = null;

const THINKING_INDICATOR_HTML = `
  <div class="thinking-indicator" role="status" aria-label="思考中">
    <svg class="thinking-svg" width="28" height="28" viewBox="0 0 32 32" aria-hidden="true">
      <circle cx="16" cy="16" r="13" fill="none" stroke="currentColor" stroke-width="2"
        stroke-dasharray="20 62" stroke-linecap="round" opacity="0.35"/>
      <circle cx="16" cy="16" r="13" fill="none" stroke="currentColor" stroke-width="2"
        stroke-dasharray="20 62" stroke-linecap="round">
        <animateTransform attributeName="transform" type="rotate" from="0 16 16" to="360 16 16"
          dur="0.9s" repeatCount="indefinite"/>
      </circle>
      <circle cx="16" cy="6" r="2.5" fill="currentColor">
        <animateTransform attributeName="transform" type="rotate" from="0 16 16" to="360 16 16"
          dur="0.9s" repeatCount="indefinite"/>
      </circle>
    </svg>
    <span class="thinking-label">思考中</span>
    <span class="thinking-dots" aria-hidden="true"><i></i><i></i><i></i></span>
  </div>`;

function formatTokens(t) {
  if (!t || !t.totalTokens) return "";
  const fmt = (n) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(2)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
  const parts = [`↑${fmt(t.inputTokens)}`, `↓${fmt(t.outputTokens)}`];
  if (t.cacheReadInputTokens) parts.push(`缓存读 ${fmt(t.cacheReadInputTokens)}`);
  if (t.cacheCreationInputTokens) parts.push(`缓存写 ${fmt(t.cacheCreationInputTokens)}`);
  return `${parts.join(" · ")} · 共 ${fmt(t.totalTokens)}`;
}

function ensureChat() {
  const root = document.getElementById("view-chat");
  if (root.dataset.chatLayout === CHAT_LAYOUT_VERSION) return;
  root.dataset.chatLayout = CHAT_LAYOUT_VERSION;
  configureMarkdown();

  root.innerHTML = `
    <div class="chat-workspace">
      <aside class="session-sidebar" aria-label="会话列表">
        <div class="sidebar-mode-tabs" role="tablist">
          <button type="button" class="sidebar-mode-tab active" data-sidebar-mode="gateway" role="tab">网关会话</button>
          <button type="button" class="sidebar-mode-tab" data-sidebar-mode="claude" role="tab">Claude 磁盘</button>
        </div>
        <div id="sidebar-gateway" class="sidebar-panel">
          <div class="session-sidebar-head">
            <span class="session-sidebar-title">已保存</span>
            <button type="button" class="btn-icon" id="btn-new-session" title="新建会话" aria-label="新建会话">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                <path d="M12 5v14M5 12h14"/>
              </svg>
            </button>
          </div>
          <div id="session-list" class="session-list" role="listbox" aria-label="网关对话会话"></div>
          <details class="session-advanced" id="session-advanced">
            <summary>进程内 Agent 缓存</summary>
            <div id="session-advanced-body" class="session-advanced-body"></div>
          </details>
        </div>
        <div id="sidebar-claude" class="sidebar-panel" hidden>
          <p class="sidebar-claude-hint">Claude Code 在本机项目目录保存的 transcript。完整列表与消息在右侧主区域查看。</p>
          <button type="button" class="btn sm btn-block" id="btn-open-claude-history">打开磁盘历史表</button>
        </div>
      </aside>
      <div class="chat-panel">
        <div id="chat-view" class="chat-view">
        <header class="chat-header">
          <div class="chat-header-titles">
            <div class="chat-title-row">
              <h3 class="chat-current-title" id="chat-current-title">对话</h3>
              <button type="button" class="btn-icon-sm" id="btn-rename-session" title="重命名会话" aria-label="重命名会话">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                  <path d="M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>
                </svg>
              </button>
            </div>
            <code class="chat-session-id" id="chat-session-id" title="会话 ID"></code>
          </div>
          <div id="chat-usage-stats" class="chat-usage-stats" title="本会话累计 token"></div>
        </header>
        <div id="permission-dock" class="permission-dock" hidden></div>
        <div id="chat-toasts" class="chat-toasts" aria-live="polite"></div>
        <div class="chat-layout">
          <div id="messages" class="messages"></div>
          <div class="composer">
            <textarea id="input" rows="2" placeholder="输入消息…  Enter 发送，Shift+Enter 换行"></textarea>
            <button type="button" id="send" class="btn send-btn" aria-label="发送">
              <span class="send-label">发送</span>
            </button>
          </div>
        </div>
        </div>
        <div id="history-view" class="history-view" hidden>
          <header class="history-view-header">
            <div>
              <h3 class="history-view-title">Claude 磁盘历史</h3>
              <p class="history-view-sub" id="history-cwd-hint"></p>
            </div>
            <button type="button" class="btn sm ghost" id="btn-back-chat">← 返回对话</button>
          </header>
          <div class="history-split">
            <div class="history-table-pane card">
              <div class="history-pane-head">会话列表 <span class="muted" id="history-count"></span></div>
              <div class="table-wrap history-table-wrap">
                <table class="history-table">
                  <thead>
                    <tr>
                      <th>摘要</th>
                      <th>修改时间</th>
                      <th>Session ID</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody id="history-table-body"></tbody>
                </table>
              </div>
            </div>
            <div class="history-transcript-pane card">
              <div class="history-pane-head">Transcript <code id="history-selected-id" class="muted">未选择</code></div>
              <div id="history-transcript" class="history-transcript">
                <p class="empty">点击左侧表格中的会话查看 Claude Code 保存的消息</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
    <dialog id="rename-dialog" class="rename-dialog">
      <form method="dialog" id="rename-form" class="rename-dialog-inner">
        <h4 class="rename-dialog-title">重命名会话</h4>
        <input type="text" id="rename-input" class="rename-input" maxlength="120" autocomplete="off" />
        <div class="rename-dialog-actions">
          <button type="button" class="btn sm ghost" id="rename-cancel">取消</button>
          <button type="submit" class="btn sm" id="rename-save">保存</button>
        </div>
      </form>
    </dialog>
  `;

  const sessionListEl = root.querySelector("#session-list");
  const titleEl = root.querySelector("#chat-current-title");
  const sidEl = root.querySelector("#chat-session-id");
  const usageStatsEl = root.querySelector("#chat-usage-stats");
  const advancedDetails = root.querySelector("#session-advanced");
  const advancedBody = root.querySelector("#session-advanced-body");
  const renameDialog = root.querySelector("#rename-dialog");
  const renameInput = root.querySelector("#rename-input");
  const renameForm = root.querySelector("#rename-form");
  let renameTargetSessionId = null;

  function updateChatChrome(title, sessionId) {
    titleEl.textContent = title || "未命名会话";
    sidEl.textContent = sessionId.slice(0, 8) + "…";
    sidEl.title = sessionId;
  }

  function updateUsageHeader(totals) {
    usageStatsEl.textContent = totals?.totalTokens ? formatTokens(totals) : "";
  }

  function openRenameDialog(sessionId, currentTitle) {
    renameTargetSessionId = sessionId;
    renameInput.value = currentTitle || "";
    renameDialog.showModal();
    renameInput.focus();
    renameInput.select();
  }

  async function saveRename() {
    const sessionId = renameTargetSessionId;
    const title = renameInput.value.trim();
    if (!sessionId) return;
    if (!title) {
      showToast("名称不能为空", "err");
      return;
    }
    try {
      const data = await api(`/api/chat/sessions/${encodeURIComponent(sessionId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      });
      renameDialog.close();
      if (sessionId === getSessionId()) {
        updateChatChrome(data.title, sessionId);
      }
      await refreshSessionSidebar();
      showToast("已重命名", "ok");
    } catch (e) {
      showToast(e.message, "err");
    }
  }

  renameForm.addEventListener("submit", (e) => {
    e.preventDefault();
    saveRename();
  });
  root.querySelector("#rename-cancel")?.addEventListener("click", () => renameDialog.close());

  root.querySelector("#btn-rename-session")?.addEventListener("click", () => {
    openRenameDialog(getSessionId(), titleEl.textContent === "加载中…" ? "" : titleEl.textContent);
  });

  async function refreshSessionSidebar() {
    const current = getSessionId();
    let sessions = [];
    let activeWeb = new Set();

    try {
      const [saved, runtime] = await Promise.all([
        api("/api/chat/sessions"),
        api("/api/sessions").catch(() => ({ sessions: [] })),
      ]);
      sessions = saved.sessions ?? [];
      activeWeb = new Set(
        (runtime.sessions ?? []).filter((s) => s.channel === "web").map((s) => s.peerId),
      );
    } catch {
      sessions = [];
    }

    if (!sessions.some((s) => s.sessionId === current)) {
      sessions.unshift({
        sessionId: current,
        title: "新会话",
        updatedAt: Date.now(),
        messageCount: 0,
        tokenTotals: null,
      });
    }

    sessions.sort((a, b) => b.updatedAt - a.updatedAt);

    if (!sessions.length) {
      sessionListEl.innerHTML = `<p class="session-list-empty">暂无会话，点击 + 开始</p>`;
      return;
    }

    sessionListEl.innerHTML = sessions
      .map((s) => {
        const isActive = s.sessionId === current;
        const live = activeWeb.has(s.sessionId);
        const title = (s.title || "未命名会话").slice(0, 48);
        const tokens = s.tokenTotals?.totalTokens ? formatTokensShort(s.tokenTotals) : "";
        return `
          <div class="session-item-wrap${isActive ? " active" : ""}">
            <button type="button" role="option" aria-selected="${isActive}"
              class="session-item${isActive ? " active" : ""}${live ? " live" : ""}"
              data-id="${s.sessionId}" title="${esc(s.sessionId)}">
              <span class="session-item-row">
                <span class="session-item-title">${esc(title)}</span>
                ${live ? '<span class="session-live" title="进程内活跃">●</span>' : ""}
              </span>
              <span class="session-item-meta">${fmtRelative(s.updatedAt)} · ${s.messageCount ?? 0} 条${tokens ? ` · ${esc(tokens)}` : ""}</span>
            </button>
            <button type="button" class="session-rename btn-icon-sm" data-id="${s.sessionId}" data-title="${esc(title)}"
              title="重命名" aria-label="重命名">✎</button>
          </div>`;
      })
      .join("");

    sessionListEl.querySelectorAll(".session-item").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.id;
        if (!id || id === getSessionId()) return;
        setSessionId(id);
        loadPersistedChat();
      });
    });
    sessionListEl.querySelectorAll(".session-rename").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        openRenameDialog(btn.dataset.id, btn.dataset.title);
      });
    });
  }

  chatRefreshSidebar = refreshSessionSidebar;

  const chatViewEl = root.querySelector("#chat-view");
  const historyViewEl = root.querySelector("#history-view");
  const sidebarGateway = root.querySelector("#sidebar-gateway");
  const sidebarClaude = root.querySelector("#sidebar-claude");

  function showChatView() {
    chatViewEl.hidden = false;
    historyViewEl.hidden = true;
  }

  function showHistoryView() {
    chatViewEl.hidden = true;
    historyViewEl.hidden = false;
    renderClaudeHistoryTable();
  }

  function setSidebarMode(mode) {
    sidebarMode = mode;
    root.querySelectorAll("[data-sidebar-mode]").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.sidebarMode === mode);
      btn.setAttribute("aria-selected", btn.dataset.sidebarMode === mode ? "true" : "false");
    });
    sidebarGateway.hidden = mode !== "gateway";
    sidebarClaude.hidden = mode !== "claude";
    if (mode === "claude") showHistoryView();
    else showChatView();
  }

  function extractHistoryMessageText(msg) {
    if (!msg || typeof msg !== "object") return "";
    if (msg.type === "result" && msg.subtype === "success") return String(msg.result ?? "");
    const m = msg.message;
    if (!m) return "";
    if (typeof m.content === "string") return m.content;
    if (Array.isArray(m.content)) {
      return m.content
        .filter((b) => b.type === "text" && b.text)
        .map((b) => b.text)
        .join("\n");
    }
    return "";
  }

  function renderHistoryTranscript(messages) {
    if (!messages?.length) return '<p class="empty">该会话没有消息</p>';
    const parts = [];
    for (const msg of messages) {
      const role =
        msg.type === "user" ? "user" : msg.type === "assistant" ? "assistant" : "system";
      const text = extractHistoryMessageText(msg);
      if (role === "system") {
        if (msg.subtype) {
          parts.push(
            `<div class="hist-msg system"><span class="system-pill">${esc(msg.subtype)}</span></div>`,
          );
        }
        continue;
      }
      if (!text.trim()) continue;
      const body =
        role === "assistant"
          ? renderMarkdown(text)
          : `<p class="plain">${esc(text)}</p>`;
      parts.push(`
        <div class="hist-msg ${role}">
          <div class="hist-msg-label">${role === "user" ? "用户" : "助手"}</div>
          <div class="hist-msg-body ${role === "assistant" ? "markdown-body" : ""}">${body}</div>
        </div>`);
    }
    return parts.join("") || '<p class="empty">无法解析消息内容</p>';
  }

  async function selectClaudeHistoryRow(sessionId) {
    const transcript = root.querySelector("#history-transcript");
    const idEl = root.querySelector("#history-selected-id");
    root.querySelectorAll(".history-row").forEach((r) => {
      r.classList.toggle("selected", r.dataset.sid === sessionId);
    });
    idEl.textContent = sessionId.slice(0, 18) + "…";
    idEl.title = sessionId;
    transcript.innerHTML = '<p class="empty">加载 transcript…</p>';
    try {
      const data = await api(
        `/api/sessions/history/${encodeURIComponent(sessionId)}/messages?limit=100`,
      );
      transcript.innerHTML = renderHistoryTranscript(data.messages);
      enhanceCodeBlocks(transcript);
      transcript.scrollTop = 0;
    } catch (e) {
      transcript.innerHTML = `<p class="empty">${esc(e.message)}</p>`;
    }
  }

  async function renderClaudeHistoryTable() {
    const tbody = root.querySelector("#history-table-body");
    const cwdHint = root.querySelector("#history-cwd-hint");
    const countEl = root.querySelector("#history-count");
    tbody.innerHTML = '<tr><td colspan="4" class="empty">加载中…</td></tr>';

    try {
      const [{ sessions, cwd }, { sessions: webSessions }] = await Promise.all([
        api("/api/sessions/history?limit=80"),
        api("/api/chat/sessions"),
      ]);
      const claudeToWeb = new Map();
      for (const w of webSessions ?? []) {
        if (w.claudeSessionId) claudeToWeb.set(w.claudeSessionId, w);
      }
      cwdHint.innerHTML = `目录：<code>${esc(cwd)}</code>（Claude Code 本地 JSONL transcript）`;
      countEl.textContent = `共 ${sessions.length} 个`;

      if (!sessions.length) {
        tbody.innerHTML = '<tr><td colspan="4" class="empty">暂无记录</td></tr>';
        return;
      }

      tbody.innerHTML = sessions
        .map((s) => {
          const linked = claudeToWeb.get(s.sessionId);
          return `
          <tr class="history-row" data-sid="${esc(s.sessionId)}">
            <td class="history-summary">${esc(s.summary || s.firstPrompt || "—")}</td>
            <td>${fmtTime(s.lastModified)}</td>
            <td><code class="history-sid">${esc(s.sessionId)}</code></td>
            <td class="history-actions">${
              linked
                ? `<button type="button" class="btn-link" data-link-web="${esc(linked.sessionId)}">→ 网关</button>`
                : '<span class="muted">—</span>'
            }</td>
          </tr>`;
        })
        .join("");

      tbody.querySelectorAll(".history-row").forEach((row) => {
        row.addEventListener("click", () => selectClaudeHistoryRow(row.dataset.sid));
      });
      tbody.querySelectorAll("[data-link-web]").forEach((btn) => {
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          setSidebarMode("gateway");
          setSessionId(btn.dataset.linkWeb);
          loadPersistedChat();
        });
      });
    } catch (e) {
      tbody.innerHTML = `<tr><td colspan="4" class="empty">${esc(e.message)}</td></tr>`;
    }
  }

  async function renderAdvancedSessions() {
    advancedBody.innerHTML = `<p class="empty" style="padding:0.5rem">加载中…</p>`;
    try {
      const { sessions } = await api("/api/sessions");
      if (!sessions.length) {
        advancedBody.innerHTML = `<p class="empty">无进程内活跃会话</p>`;
        return;
      }
      advancedBody.innerHTML = `
        <ul class="session-advanced-list">
          ${sessions
            .map(
              (s) => `
            <li>
              <span class="adv-label">${esc(s.channel)}</span>
              <code class="adv-id">${esc(s.peerId.slice(0, 10))}…</code>
              <span class="adv-meta">${s.turns} 轮</span>
              <div class="adv-actions">
                ${s.channel === "web" ? `<button type="button" class="btn-link" data-use="${esc(s.peerId)}">打开</button>` : ""}
                <button type="button" class="btn-link danger" data-del="${esc(s.channel)}" data-peer="${esc(s.peerId)}">移除缓存</button>
              </div>
            </li>`,
            )
            .join("")}
        </ul>`;
      advancedBody.querySelectorAll("[data-use]").forEach((btn) => {
        btn.addEventListener("click", () => {
          setSidebarMode("gateway");
          setSessionId(btn.dataset.use);
          loadPersistedChat();
        });
      });
      advancedBody.querySelectorAll("[data-del]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          await api(`/api/sessions/${btn.dataset.del}/${encodeURIComponent(btn.dataset.peer)}`, {
            method: "DELETE",
          });
          renderAdvancedSessions();
          refreshSessionSidebar();
        });
      });
    } catch (e) {
      advancedBody.innerHTML = `<p class="empty">${esc(e.message)}</p>`;
    }
  }

  advancedDetails?.addEventListener("toggle", () => {
    if (advancedDetails.open) renderAdvancedSessions();
  });

  root.querySelectorAll("[data-sidebar-mode]").forEach((btn) => {
    btn.addEventListener("click", () => setSidebarMode(btn.dataset.sidebarMode));
  });
  root.querySelector("#btn-back-chat")?.addEventListener("click", () => setSidebarMode("gateway"));
  root.querySelector("#btn-open-claude-history")?.addEventListener("click", () => {
    setSidebarMode("claude");
  });

  const messagesEl = root.querySelector("#messages");
  const permissionDock = root.querySelector("#permission-dock");
  const toastsEl = root.querySelector("#chat-toasts");
  const inputEl = root.querySelector("#input");
  const sendBtn = root.querySelector("#send");

  function scrollMessages() {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function showToast(text, kind = "") {
    const t = document.createElement("div");
    t.className = `chat-toast ${kind}`;
    t.textContent = text;
    toastsEl.appendChild(t);
    setTimeout(() => t.classList.add("fade-out"), 2400);
    setTimeout(() => t.remove(), 3000);
  }

  function appendSystemLine(text) {
    const row = document.createElement("div");
    row.className = "msg-row system";
    row.innerHTML = `<div class="system-pill">${esc(text)}</div>`;
    messagesEl.appendChild(row);
    scrollMessages();
    return row;
  }

  function appendUserMessage(text) {
    const row = document.createElement("div");
    row.className = "msg-row user";
    row.innerHTML = `
      <div class="msg-avatar" aria-hidden="true">你</div>
      <div class="msg-bubble user">
        <div class="msg-content plain">${esc(text)}</div>
      </div>`;
    messagesEl.appendChild(row);
    scrollMessages();
    return row;
  }

  function setAssistantThinking(assistant, thinking) {
    assistant._thinking = thinking;
    assistant.row.classList.toggle("thinking", thinking);
  }

  function showThinkingIndicator(assistant) {
    setAssistantThinking(assistant, true);
    assistant.contentEl.innerHTML = THINKING_INDICATOR_HTML;
    assistant.contentEl.classList.remove("is-streaming");
  }

  function clearThinkingIndicator(assistant) {
    if (!assistant._thinking) return;
    setAssistantThinking(assistant, false);
    if (assistant.contentEl.querySelector(".thinking-indicator")) {
      assistant.contentEl.innerHTML = "";
    }
  }

  function beginAssistantMessage() {
    const row = document.createElement("div");
    row.className = "msg-row assistant streaming thinking";
    row.innerHTML = `
      <div class="msg-avatar" aria-hidden="true">AI</div>
      <div class="msg-bubble assistant">
        <div class="msg-content markdown-body"></div>
        <div class="msg-footer" hidden></div>
      </div>`;
    messagesEl.appendChild(row);
    const assistant = {
      row,
      contentEl: row.querySelector(".msg-content"),
      footerEl: row.querySelector(".msg-footer"),
      _thinking: false,
    };
    showThinkingIndicator(assistant);
    scrollMessages();
    return assistant;
  }

  let streamRaf = null;
  function updateAssistantContent(assistant, text, streaming) {
    if (text?.trim()) clearThinkingIndicator(assistant);
    assistant._streamText = text;
    assistant._streaming = streaming;
    if (streamRaf) return;
    streamRaf = requestAnimationFrame(() => {
      streamRaf = null;
      const t = assistant._streamText ?? "";
      const s = assistant._streaming;
      if (!t.trim() && assistant._thinking) {
        showThinkingIndicator(assistant);
        scrollMessages();
        return;
      }
      assistant.contentEl.innerHTML = renderMarkdown(t);
      enhanceCodeBlocks(assistant.contentEl);
      assistant.contentEl.classList.toggle("is-streaming", Boolean(s) && Boolean(t.trim()));
      assistant.row.classList.toggle("streaming", Boolean(s));
      scrollMessages();
    });
  }

  function finishAssistantMessage(assistant, text, tokens) {
    clearThinkingIndicator(assistant);
    updateAssistantContent(assistant, text, false);
    if (tokens?.totalTokens) {
      assistant.footerEl.hidden = false;
      assistant.footerEl.innerHTML = `<span class="token-badge" title="本条回复 token">${esc(formatTokens(tokens))}</span>`;
    }
  }

  async function loadPersistedChat() {
    const sessionId = getSessionId();
    updateChatChrome("加载中…", sessionId);
    await refreshSessionSidebar();
    try {
      const data = await api(`/api/chat/sessions/${encodeURIComponent(sessionId)}`);
      messagesEl.innerHTML = "";
      permissionDock.innerHTML = "";
      permissionDock.hidden = true;
      updateChatChrome(data.title || "未命名会话", sessionId);
      updateUsageHeader(data.usage?.totals);
      for (const m of data.messages ?? []) {
        if (m.role === "user") appendUserMessage(m.content);
        else if (m.role === "assistant") {
          const a = beginAssistantMessage();
          finishAssistantMessage(a, m.content, m.tokens);
        }
      }
      if (!data.messages?.length) appendSystemLine("输入消息开始对话 · 自动保存到磁盘");
    } catch {
      updateChatChrome("新会话", sessionId);
      appendSystemLine("输入消息开始对话");
    }
    scrollMessages();
  }

  chatReloadHistory = loadPersistedChat;

  function syncPermissionDock() {
    const count = permissionDock.querySelectorAll(".permission-card").length;
    permissionDock.hidden = count === 0;
    let title = permissionDock.querySelector(".permission-dock-title");
    if (count === 0) {
      title?.remove();
      return;
    }
    if (!title) {
      title = document.createElement("div");
      title.className = "permission-dock-title";
      permissionDock.prepend(title);
    }
    title.textContent = `待批准的工具 (${count})`;
  }

  function showPermissionPrompt(request) {
    const path =
      request.input?.file_path ??
      request.input?.path ??
      request.input?.notebook_path ??
      "";
    const card = document.createElement("div");
    card.className = "permission-card";
    card.dataset.requestId = request.id;
    card.innerHTML = `
      <div class="permission-card-head">
        <span class="permission-icon" aria-hidden="true">🔐</span>
        <div>
          <p class="permission-title">${esc(request.title || request.displayName || "需要工具权限")}</p>
          <p class="permission-meta"><code>${esc(request.toolName)}</code>${path ? ` · <code class="path">${esc(String(path))}</code>` : ""}</p>
        </div>
      </div>
      ${request.description ? `<p class="permission-desc">${esc(request.description)}</p>` : ""}
      <div class="permission-actions">
        <button type="button" class="btn sm" data-allow>允许</button>
        <button type="button" class="btn sm ghost" data-deny>拒绝</button>
      </div>
    `;
    permissionDock.appendChild(card);
    syncPermissionDock();
    scrollMessages();

    let responded = false;
    const respond = async (allow) => {
      if (responded) return;
      responded = true;
      card.classList.add("resolved");
      card.querySelectorAll("button").forEach((b) => (b.disabled = true));
      try {
        await api("/api/chat/permission", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId: getSessionId(),
            requestId: request.id,
            allow,
          }),
        });
        card.innerHTML = `<p class="permission-resolved ${allow ? "ok" : "err"}">${allow ? "✓ 已允许，正在执行…" : "✗ 已拒绝"}</p>`;
        showToast(allow ? "工具权限已批准" : "已拒绝工具权限", allow ? "ok" : "err");
        setTimeout(() => {
          card.remove();
          syncPermissionDock();
        }, 1200);
      } catch (e) {
        showToast(e.message, "err");
        card.classList.remove("resolved");
        responded = false;
        card.querySelectorAll("button").forEach((b) => (b.disabled = false));
      }
    };

    card.querySelector("[data-allow]")?.addEventListener("click", () => respond(true));
    card.querySelector("[data-deny]")?.addEventListener("click", () => respond(false));
  }

  root.querySelector("#btn-new-session").addEventListener("click", async () => {
    const id = crypto.randomUUID();
    setSessionId(id);
    messagesEl.innerHTML = "";
    permissionDock.innerHTML = "";
    permissionDock.hidden = true;
    updateChatChrome("新会话", id);
    updateUsageHeader(null);
    await refreshSessionSidebar();
    appendSystemLine("新会话 · 发送首条消息后自动保存");
    if (!isRendererReady()) {
      showToast("Markdown 库加载中，刷新页面可启用富文本", "");
    }
  });

  async function sendMessage() {
    const prompt = inputEl.value.trim();
    if (!prompt) return;
    inputEl.value = "";
    sendBtn.disabled = true;
    sendBtn.classList.add("loading");

    appendUserMessage(prompt);
    const assistant = beginAssistantMessage();
    let full = "";

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, sessionId: getSessionId() }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";

        for (const part of parts) {
          const lines = part.split("\n");
          let event = "message";
          let data = "";
          for (const line of lines) {
            if (line.startsWith("event: ")) event = line.slice(7);
            else if (line.startsWith("data: ")) data = line.slice(6);
          }
          if (!data) continue;
          const payload = JSON.parse(data);
          if (event === "session" && payload.sessionId) {
            setSessionId(payload.sessionId);
            updateChatChrome(titleEl.textContent, payload.sessionId);
            refreshSessionSidebar().catch(() => {});
          } else if (event === "delta" && payload.text) {
            full += payload.text;
            updateAssistantContent(assistant, full, true);
          } else if (event === "done") {
            if (payload.text) full = payload.text;
            finishAssistantMessage(assistant, full, payload.tokens);
            updateUsageHeader(payload.usageTotals);
            showToast(
              payload.tokens?.totalTokens
                ? `完成 · ${formatTokens(payload.tokens)}`
                : "回复完成",
              "ok",
            );
            refreshSessionSidebar().catch(() => {});
            loadOverview().catch(() => {});
          } else if (event === "permission" && payload.request) {
            if (!full.trim()) showThinkingIndicator(assistant);
            showPermissionPrompt(payload.request);
          } else if (event === "error") {
            assistant.row.remove();
            appendSystemLine(payload.message ?? "错误");
            showToast(payload.message ?? "错误", "err");
          }
        }
      }
    } catch (err) {
      assistant.row.remove();
      appendSystemLine(err.message ?? String(err));
      showToast(err.message ?? String(err), "err");
    } finally {
      sendBtn.disabled = false;
      sendBtn.classList.remove("loading");
      inputEl.focus();
    }
  }

  sendBtn.addEventListener("click", sendMessage);
  inputEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  loadPersistedChat();
  if (!isRendererReady()) {
    showToast("正在加载 Markdown 渲染…");
  }
}

function copyText(text) {
  return navigator.clipboard.writeText(text).catch(() => {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  });
}

function skillStatus(root, msg, kind = "") {
  const el = root.querySelector("#skills-status");
  if (!el) return;
  el.textContent = msg;
  el.className = `skills-status ${kind}`;
}

async function renderSkills() {
  const root = document.getElementById("view-skills");
  root.innerHTML = `<p class="empty">扫描 Skills…</p>`;
  try {
    const { skills, cwd, count, locations } = await api("/api/skills");
    const layout = locations?.layout ?? ".claude/skills/<skill-name>/SKILL.md";

    root.innerHTML = `
      <div class="card skills-locations">
        <h3>技能存放位置</h3>
        <p class="skills-hint">标准目录结构：<code>${esc(layout)}</code></p>
        <dl class="kv">
          <dt>项目（当前仓库）</dt>
          <dd id="path-project">${esc(locations?.project?.skillsDir ?? "")}</dd>
          <dt>用户（全局）</dt>
          <dd id="path-user">${esc(locations?.user?.skillsDir ?? "")}</dd>
          <dt>工作目录</dt>
          <dd>${esc(cwd)}</dd>
        </dl>
        <div class="skills-actions-row">
          <button type="button" class="btn sm ghost" data-copy="project">复制项目路径</button>
          <button type="button" class="btn sm ghost" data-copy="user">复制用户路径</button>
          <button type="button" class="btn sm" data-open="project">打开项目目录</button>
          <button type="button" class="btn sm" data-open="user">打开用户目录</button>
        </div>
      </div>

      <div class="card" style="margin-top:1rem">
        <h3>安装技能（ZIP）</h3>
        <div class="skills-toolbar">
          <label>安装到
            <select id="skill-target">
              <option value="project">项目 .claude/skills</option>
              <option value="user">用户 ~/.claude/skills</option>
            </select>
          </label>
          <label class="skills-check">
            <input type="checkbox" id="skill-overwrite" /> 覆盖已存在
          </label>
        </div>
        <div id="skill-dropzone" class="skill-dropzone" tabindex="0">
          <p class="skill-dropzone-title">将 .zip 拖到此处，或点击选择文件</p>
          <p class="skill-dropzone-sub">ZIP 内需含 <code>&lt;技能名&gt;/SKILL.md</code>，或根目录直接放 SKILL.md</p>
          <input type="file" id="skill-file" accept=".zip,application/zip" hidden />
        </div>
        <div class="skills-toolbar" style="margin-top:0.75rem">
          <input type="text" id="skill-new-name" placeholder="新建技能名称（字母数字 - _ .）" />
          <button type="button" class="btn sm" id="skill-create-btn">新建空技能</button>
        </div>
        <p id="skills-status" class="skills-status" aria-live="polite"></p>
      </div>

      <p class="empty" style="margin:1rem 0 0.75rem">共发现 ${count} 个技能</p>
      <div class="grid" id="skills-grid">
        ${skills
          .map(
            (s) => `
          <div class="card skill-card" data-name="${esc(s.name)}" data-source="${esc(s.source)}">
            <h3>${esc(s.name)} <span class="skill-source">(${esc(s.source)})</span></h3>
            <p class="skill-desc">${esc(s.description || "无描述")}</p>
            <code class="skill-path">${esc(s.path)}</code>
            <div class="skills-actions-row" style="margin-top:0.65rem">
              <button type="button" class="btn sm ghost" data-view-md="${esc(s.name)}" data-target="${esc(s.source)}">查看 SKILL.md</button>
              <button type="button" class="btn sm ghost" data-copy-path="${esc(s.path)}">复制路径</button>
              <button type="button" class="btn sm ghost" data-del="${esc(s.name)}" data-target="${esc(s.source)}">删除</button>
            </div>
            <pre class="skill-md-preview hidden" hidden></pre>
          </div>`,
          )
          .join("")}
      </div>
      ${count === 0 ? `<p class="empty">暂无技能。拖入 ZIP 或点击「新建空技能」。</p>` : ""}
    `;

    root.querySelector('[data-copy="project"]')?.addEventListener("click", () => {
      copyText(locations.project.skillsDir);
      skillStatus(root, "已复制项目路径", "ok");
    });
    root.querySelector('[data-copy="user"]')?.addEventListener("click", () => {
      copyText(locations.user.skillsDir);
      skillStatus(root, "已复制用户路径", "ok");
    });

    root.querySelectorAll("[data-open]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const target = btn.dataset.open;
        skillStatus(root, "正在打开目录…");
        try {
          const data = await api("/api/skills/open-folder", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ target }),
          });
          skillStatus(root, `已请求打开：${data.path}`, "ok");
        } catch (e) {
          skillStatus(root, e.message, "err");
        }
      });
    });

    async function uploadZip(file) {
      if (!file) return;
      if (!file.name.toLowerCase().endsWith(".zip")) {
        skillStatus(root, "请选择 .zip 文件", "err");
        return;
      }
      const target = root.querySelector("#skill-target")?.value ?? "project";
      const overwrite = root.querySelector("#skill-overwrite")?.checked ?? false;
      const fd = new FormData();
      fd.append("file", file);
      fd.append("target", target);
      fd.append("overwrite", String(overwrite));

      skillStatus(root, `正在安装 ${file.name}…`);
      try {
        const res = await fetch("/api/skills/upload", { method: "POST", body: fd });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        const names = (data.installed ?? []).map((i) => i.name).join(", ");
        skillStatus(root, `已安装：${names || "完成"}`, "ok");
        renderSkills();
      } catch (e) {
        skillStatus(root, e.message, "err");
      }
    }

    const dropzone = root.querySelector("#skill-dropzone");
    const fileInput = root.querySelector("#skill-file");

    dropzone?.addEventListener("click", () => fileInput?.click());
    dropzone?.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        fileInput?.click();
      }
    });
    fileInput?.addEventListener("change", () => {
      const f = fileInput.files?.[0];
      if (f) uploadZip(f);
      fileInput.value = "";
    });

    ["dragenter", "dragover"].forEach((ev) => {
      dropzone?.addEventListener(ev, (e) => {
        e.preventDefault();
        dropzone.classList.add("dragover");
      });
    });
    dropzone?.addEventListener("dragleave", () => dropzone.classList.remove("dragover"));
    dropzone?.addEventListener("drop", (e) => {
      e.preventDefault();
      dropzone.classList.remove("dragover");
      const file = e.dataTransfer?.files?.[0];
      uploadZip(file);
    });

    root.querySelector("#skill-create-btn")?.addEventListener("click", async () => {
      const name = root.querySelector("#skill-new-name")?.value?.trim();
      if (!name) {
        skillStatus(root, "请输入技能名称", "err");
        return;
      }
      const target = root.querySelector("#skill-target")?.value ?? "project";
      skillStatus(root, "正在创建…");
      try {
        await api("/api/skills/create", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, target }),
        });
        skillStatus(root, `已创建 ${name}`, "ok");
        renderSkills();
      } catch (e) {
        skillStatus(root, e.message, "err");
      }
    });

    root.querySelectorAll("[data-copy-path]").forEach((btn) => {
      btn.addEventListener("click", () => {
        copyText(btn.dataset.copyPath);
        skillStatus(root, "已复制路径", "ok");
      });
    });

    root.querySelectorAll("[data-view-md]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const card = btn.closest(".skill-card");
        const pre = card?.querySelector(".skill-md-preview");
        if (!pre) return;
        if (!pre.hidden && pre.textContent) {
          pre.hidden = true;
          pre.classList.add("hidden");
          return;
        }
        pre.hidden = false;
        pre.classList.remove("hidden");
        pre.textContent = "加载中…";
        try {
          const data = await api(
            `/api/skills/${btn.dataset.target}/${encodeURIComponent(btn.dataset.viewMd)}/content`,
          );
          pre.textContent = data.content;
        } catch (e) {
          pre.textContent = e.message;
        }
      });
    });

    root.querySelectorAll("[data-del]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const name = btn.dataset.del;
        const target = btn.dataset.target;
        if (!confirm(`确定删除技能「${name}」？此操作不可恢复。`)) return;
        skillStatus(root, "正在删除…");
        try {
          await api(`/api/skills/${target}/${encodeURIComponent(name)}`, {
            method: "DELETE",
          });
          skillStatus(root, `已删除 ${name}`, "ok");
          renderSkills();
        } catch (e) {
          skillStatus(root, e.message, "err");
        }
      });
    });
  } catch (e) {
    root.innerHTML = `<p class="empty">${esc(e.message)}</p>`;
  }
}

async function renderApi() {
  const root = document.getElementById("view-api");
  root.innerHTML = `<p class="empty">加载接口目录…</p>`;
  try {
    const { endpoints } = await api("/api/gateway/endpoints");
    root.innerHTML = `
      <div class="card">
        <h3>HTTP API（${endpoints.length}）</h3>
        <div class="table-wrap">
          <table>
            <thead><tr><th>方法</th><th>路径</th><th>说明</th><th>Body</th><th></th></tr></thead>
            <tbody>
              ${endpoints
                .map(
                  (e) => `
                <tr>
                  <td><span class="method ${esc(e.method)}">${esc(e.method)}</span></td>
                  <td><code>${esc(e.path)}</code></td>
                  <td>${esc(e.description)}</td>
                  <td><code>${esc(e.body || "—")}</code></td>
                  <td>${e.method === "GET" ? `<button class="btn sm" data-try="${esc(e.path)}">试用</button>` : ""}</td>
                </tr>`,
                )
                .join("")}
            </tbody>
          </table>
        </div>
      </div>
      <div class="card" style="margin-top:1rem">
        <h3>响应</h3>
        <pre class="pre" id="api-try-result">点击「试用」调用 GET 接口</pre>
      </div>
    `;
    const pre = root.querySelector("#api-try-result");
    root.querySelectorAll("[data-try]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        pre.textContent = `GET ${btn.dataset.try} …`;
        try {
          pre.textContent = JSON.stringify(await api(btn.dataset.try), null, 2);
        } catch (err) {
          pre.textContent = err.message;
        }
      });
    });
  } catch (e) {
    root.innerHTML = `<p class="empty">${esc(e.message)}</p>`;
  }
}

document.getElementById("nav").addEventListener("click", (e) => {
  const btn = e.target.closest(".nav-item");
  if (btn?.dataset.view) showView(btn.dataset.view);
});

document.getElementById("btn-refresh").addEventListener("click", async () => {
  await loadOverview();
  if (document.querySelector("#view-overview.active")) renderOverview();
});

const initialRaw = location.hash.replace("#", "") || "overview";
const initial = initialRaw === "sessions" ? "chat" : initialRaw;
loadOverview()
  .then(() => showView(TITLES[initial] ? initial : "overview"))
  .catch((e) => {
    document.getElementById("view-overview").innerHTML = `<p class="empty">${esc(e.message)}</p>`;
    showView("overview");
  });

setInterval(() => {
  if (document.getElementById("view-overview")?.classList.contains("active")) {
    loadOverview().then(() => renderOverview()).catch(() => {});
  }
}, 15000);
