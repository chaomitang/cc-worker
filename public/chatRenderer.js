/** Markdown + sanitization for chat bubbles (marked + DOMPurify from CDN). */

export function isRendererReady() {
  return typeof marked !== "undefined" && typeof DOMPurify !== "undefined";
}

function escapeHtml(s) {
  const d = document.createElement("div");
  d.textContent = s ?? "";
  return d.innerHTML;
}

let configured = false;

export function configureMarkdown() {
  if (!isRendererReady() || configured) return;
  configured = true;
  marked.setOptions({
    gfm: true,
    breaks: true,
    headerIds: false,
    mangle: false,
  });
}

export function renderMarkdown(text) {
  if (!text) return "";
  configureMarkdown();

  if (!isRendererReady()) {
    return `<p class="md-fallback">${escapeHtml(text).replace(/\n/g, "<br>")}</p>`;
  }

  const raw = marked.parse(text, { async: false });
  return DOMPurify.sanitize(raw, {
    ADD_ATTR: ["target", "rel", "class"],
    ALLOWED_TAGS: [
      "p", "br", "strong", "em", "u", "s", "del", "code", "pre", "span", "div",
      "h1", "h2", "h3", "h4", "h5", "h6",
      "ul", "ol", "li",
      "blockquote", "hr",
      "a", "img",
      "table", "thead", "tbody", "tr", "th", "td",
    ],
  });
}

export function enhanceCodeBlocks(root) {
  if (!root || typeof hljs === "undefined") return;
  root.querySelectorAll("pre code").forEach((block) => {
    try {
      hljs.highlightElement(block);
    } catch {
      /* ignore */
    }
  });
}
