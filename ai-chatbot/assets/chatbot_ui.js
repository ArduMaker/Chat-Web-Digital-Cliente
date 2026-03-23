// chatbot-ui.js — DOM y mensajes
const ChatUI = (function () {
    const ICON_SVG = `<svg fill="#FFFFFF" height="28px" width="28px" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg"><path d="M16 2C8.28 2 2 7.8 2 14.93c0 3.6 1.56 6.86 4.1 9.25L4.5 29.5l5.84-2.6A14.8 14.8 0 0016 27.86c7.72 0 14-5.8 14-12.93S23.72 2 16 2z"/></svg>`;
    const CLOSE_SVG = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 4L4 12M4 4l8 8" stroke="white" stroke-width="2" stroke-linecap="round"/></svg>`;
    const SEND_SVG = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M22 2L11 13M22 2L15 22L11 13M22 2L2 9L11 13" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  
    // ── Criar HTML ──────────────────────────────────────────────────────────────
    function createHTML() {
      const root = document.createElement("div");
      root.innerHTML = `
<button class="cb-btn pulse" aria-label="Abrir chat">${ICON_SVG}</button>
<div class="cb-panel" role="dialog" aria-label="Chat de soporte">
  <div class="cb-header">
    <div class="cb-header-info">
      <div class="cb-avatar">${ICON_SVG}</div>
      <div>
        <div class="cb-title">Asistente digital</div>
        <div class="cb-sub">Soporte instantáneo</div>
        <div class="cb-online"><span class="cb-online-dot"></span> En línea</div>
      </div>
    </div>
    <div class="cb-header-actions">
      <button class="cb-close-btn" aria-label="Cerrar">${CLOSE_SVG}</button>
      <div id="cb-intervention-container" style="display:none"></div>
      <button class="cb-end-btn" id="cb-end-chat" type="button">Finalizar conversación</button>
    </div>
  </div>

  <div id="cb-screen-form" style="flex:1;display:flex;flex-direction:column;overflow:hidden">
    <div class="cb-form">
      <div>
        <div class="cb-form-title">¡Bienvenido! 👋</div>
        <div class="cb-form-sub">Díganos su nombre para poder ayudarle mejor.</div>
      </div>
      <div>
        <label class="cb-label" for="cb-name">Su nombre *</label>
        <input class="cb-field" id="cb-name" type="text" placeholder="Juan García" autocomplete="name" />
      </div>
      <div>
        <label class="cb-label" for="cb-email">Correo electrónico (opcional)</label>
        <input class="cb-field" id="cb-email" type="email" placeholder="juan@ejemplo.com" autocomplete="email" />
      </div>
      <button class="cb-start-btn" id="cb-start">Iniciar conversación</button>
    </div>
  </div>

  <div id="cb-screen-chat" style="display:none;flex:1;flex-direction:column;overflow:hidden;min-height:0">
    <div class="cb-body" id="cb-body"></div>
    <div id="cb-responder-status" style="padding:8px 12px;border-top:1px solid #e2e8f0;font-size:12px;color:#64748b;background:#f8fafc;">
      Asistente virtual respondiendo
    </div>
    <div class="cb-footer">
      <textarea class="cb-input" id="cb-input" placeholder="Escriba su mensaje..." rows="1"></textarea>
      <button class="cb-send-btn" id="cb-send" disabled aria-label="Enviar">${SEND_SVG}</button>
    </div>
  </div>
</div>
      `;
      document.body.appendChild(root);
      return root;
    }
  
    // ── Mensajes ────────────────────────────────────────────────────────────────
    function addUserMessage(body, text) {
      const d = document.createElement("div");
      d.className = "cb-msg cb-user";
      d.innerHTML = `${esc(text)}<span class="cb-msg-time">${time()}</span>`;
      body.appendChild(d);
      scroll(body);
    }
  
    function addBotMessage(body, text, onFirstMessage) {
      const d = document.createElement("div");
      d.className = "cb-msg cb-bot";
      const fmt = renderMarkdown(text);
      d.innerHTML = `${fmt}<span class="cb-msg-time">${time()}</span>`;
      body.appendChild(d);
  
      if (!body.querySelector(".cb-intervention-btn") && !body.querySelector(".cb-badge")) {
        if (typeof onFirstMessage === "function") onFirstMessage();
      }
  
      scroll(body);
    }

    function addMessageImages(body, images, sender = "bot") {
      if (!Array.isArray(images) || images.length === 0) return;

      const validImages = images
        .map((img) => img?.url || img?.image || "")
        .filter((url) => typeof url === "string" && url.trim().length > 0);

      if (validImages.length === 0) return;

      const wrapper = document.createElement("div");
      const isCustomer = String(sender || "").toLowerCase() === "customer";
      wrapper.className = `cb-msg-images ${isCustomer ? "cb-msg-images-customer" : "cb-msg-images-bot"}`;

      for (const url of validImages) {
        const link = document.createElement("a");
        link.className = "cb-msg-image-link";
        link.href = url;
        link.target = "_blank";
        link.rel = "noopener noreferrer";

        const img = document.createElement("img");
        img.className = "cb-msg-image";
        img.src = url;
        img.alt = "Imagen enviada en el chat";
        img.loading = "lazy";

        link.appendChild(img);
        wrapper.appendChild(link);
      }

      body.appendChild(wrapper);
      scroll(body);
    }
  
    function addSystemMessage(body, text) {
      const d = document.createElement("div");
      d.style.cssText = "align-self:center;font-size:12px;color:#94a3b8;padding:4px 0;text-align:center";
      d.textContent = text;
      body.appendChild(d);
      scroll(body);
    }

    function addAITrace(body, trace, traceId) {
      if (!body || !Array.isArray(trace) || trace.length === 0) return;

      const uid = String(traceId || `trace-${Date.now()}`);
      if (body.querySelector(`[data-ai-trace-id="${uid}"]`)) return;

      const wrap = document.createElement("details");
      wrap.className = "cb-ai-trace";
      wrap.setAttribute("data-ai-trace-id", uid);

      const summary = document.createElement("summary");
      summary.textContent = "Ver pasos de la IA";
      wrap.appendChild(summary);

      const list = document.createElement("ol");
      list.className = "cb-ai-trace-list";

      for (const step of trace) {
        const item = document.createElement("li");
        const timestamp = String(step?.loggedAt || step?.timestamp || "").trim();
        const title = String(step?.label || step?.status || "Paso de procesamiento").trim();
        const detail = String(step?.detail || "").trim();

        const titleEl = document.createElement("div");
        titleEl.className = "cb-ai-trace-title";
        titleEl.textContent = title;
        item.appendChild(titleEl);

        if (detail) {
          const detailEl = document.createElement("div");
          detailEl.className = "cb-ai-trace-detail";
          detailEl.textContent = detail;
          item.appendChild(detailEl);
        }

        if (timestamp) {
          const timeEl = document.createElement("div");
          timeEl.className = "cb-ai-trace-time";
          timeEl.textContent = timestamp;
          item.appendChild(timeEl);
        }

        list.appendChild(item);
      }

      wrap.appendChild(list);
      body.appendChild(wrap);
      scroll(body);
    }
  
    // ── Typing indicator ────────────────────────────────────────────────────────
    let typingEl = null;
  
    function showTyping(body) {
      if (typingEl) return;
      typingEl = document.createElement("div");
      typingEl.className = "cb-typing";
      typingEl.innerHTML = `<div class="cb-dot"></div><div class="cb-dot"></div><div class="cb-dot"></div>`;
      body.appendChild(typingEl);
      scroll(body);
    }
  
    function hideTyping() {
      if (typingEl) { typingEl.remove(); typingEl = null; }
    }
  
    // ── Badges ──────────────────────────────────────────────────────────────────
    function showBadge(body, text, colorClass, id) {
      if (body.querySelector(`#${id}`)) return;
      const d = document.createElement("div");
      d.className = `cb-badge ${colorClass}`;
      d.id = id;
      d.textContent = text;
      body.appendChild(d);
      scroll(body);
    }
  
    function removeBadge(body, id) {
      const el = body.querySelector(`#${id}`);
      if (el) el.remove();
    }

    // ── AI Status ─────────────────────────────────────────────────────────────────
    let aiStatusEl = null;

    function showAIStatus(body, message, step) {
      if (aiStatusEl) {
        aiStatusEl.querySelector(".cb-ai-status-message").textContent = message;
        return;
      }
      aiStatusEl = document.createElement("div");
      aiStatusEl.className = "cb-ai-status";
      aiStatusEl.innerHTML = `<span class="cb-ai-status-spinner"></span><span class="cb-ai-status-message">${esc(message)}</span>`;
      body.appendChild(aiStatusEl);
      scroll(body);
    }

    function hideAIStatus() {
      if (aiStatusEl) {
        aiStatusEl.remove();
        aiStatusEl = null;
      }
    }

    // ── Image Upload ──────────────────────────────────────────────────────────────
    let imageUploadInput = null;

    function getImageUploadInput() {
      if (imageUploadInput) return imageUploadInput;
      imageUploadInput = document.createElement("input");
      imageUploadInput.type = "file";
      imageUploadInput.accept = "image/*";
      imageUploadInput.multiple = true;
      imageUploadInput.style.display = "none";
      document.body.appendChild(imageUploadInput);
      return imageUploadInput;
    }

    function showImageUploadButton(body, onImagesSelected) {
      const existingBtn = body.querySelector(".cb-image-upload-btn");
      if (existingBtn) return existingBtn;

      const btn = document.createElement("button");
      btn.className = "cb-image-upload-btn";
      btn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M21 15V19C21 20.1046 20.1046 21 19 21H5C3.89543 21 3 20.1046 3 19V15" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M17 8L12 3L7 8" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M12 3V15" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
      btn.title = "Subir imagen";
      btn.onclick = () => {
        const input = getImageUploadInput();
        input.onchange = (e) => {
          const files = Array.from(e.target.files || []);
          if (files.length > 0 && typeof onImagesSelected === "function") {
            onImagesSelected(files);
          }
          input.value = "";
        };
        input.click();
      };
      body.appendChild(btn);
      return btn;
    }

    function addImagePreview(body, file, onRemove) {
      const container = document.createElement("div");
      container.className = "cb-image-preview";
      const img = document.createElement("img");
      img.src = URL.createObjectURL(file);
      const removeBtn = document.createElement("button");
      removeBtn.className = "cb-image-preview-remove";
      removeBtn.innerHTML = "&times;";
      removeBtn.onclick = () => {
        URL.revokeObjectURL(img.src);
        container.remove();
        if (typeof onRemove === "function") onRemove();
      };
      container.appendChild(img);
      container.appendChild(removeBtn);
      body.appendChild(container);
      scroll(body);
      return container;
    }

    function setResponderStatus(statusEl, text, tone = "neutral") {
      if (!statusEl) return;
      statusEl.textContent = text;
      statusEl.style.background = tone === "human" ? "#ecfdf5" : tone === "waiting" ? "#fff7ed" : "#f8fafc";
      statusEl.style.color = tone === "human" ? "#047857" : tone === "waiting" ? "#b45309" : "#64748b";
      statusEl.style.borderTop = "1px solid #e2e8f0";
    }
  
    function addInterventionButton(body, onClick) {
      const existing = body.querySelector(".cb-intervention-btn");
      if (existing) return existing;

      const container = document.querySelector("#cb-intervention-container");
      if (!container) return null;

      const btn = document.createElement("button");
      btn.className = "cb-intervention-btn";
      btn.textContent = "Hablar con un humano";
      btn.onclick = onClick;
      container.appendChild(btn);
      container.style.display = "flex";
      container.style.alignItems = "center";
      return btn;
    }
  
    // ── Utilitários ─────────────────────────────────────────────────────────────
    function isAtBottom(body) {
      if (!body) return true;
      const tolerance = 50;
      return body.scrollHeight - body.scrollTop - body.clientHeight <= tolerance;
    }

    function scroll(body) {
      if (!body) return;
      if (isAtBottom(body)) {
        body.scrollTop = body.scrollHeight;
      }
    }

    function time() { return new Date().toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" }); }
    function esc(t) {
      return String(t)
        .replace(/&/g, "&amp;").replace(/</g, "&lt;")
        .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    }

    function parseTableCells(line) {
      const trimmed = String(line || "").trim().replace(/^\|/, "").replace(/\|$/, "");
      return trimmed.split("|").map((cell) => cell.trim());
    }

    function safeLink(link) {
      const value = String(link || "").trim();
      if (!value) return "";
      if (/^javascript:/i.test(value)) return "";
      return value;
    }

    function inlineMd(input) {
      let out = String(input || "");
      out = out.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
      out = out.replace(/\*(.+?)\*/g, "<em>$1</em>");
      out = out.replace(/`([^`]+?)`/g, "<code class=\"cb-md-inline\">$1</code>");

      // Convierte referencias WP-1234 en enlaces al post de WordPress.
      out = out.replace(/\bWP-(\d+)\b/gi, (_, postId) => {
        const id = String(postId || "").trim();
        if (!id) return "";
        const href = `https://digitalmtx.com/?p=${id}`;
        return `<a class=\"cb-wp-link\" href=\"${href}\" target=\"_blank\" rel=\"noopener noreferrer\">WP-${id}</a>`;
      });

      out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, url) => {
        const href = safeLink(url);
        if (!href) return label;
        return `<a href="${href}" target="_blank" rel="noopener noreferrer">${label}</a>`;
      });
      return out;
    }

    function renderMarkdown(text) {
      const raw = esc(text || "").replace(/\r\n?/g, "\n");
      const lines = raw.split("\n");
      const html = [];
      let i = 0;

      while (i < lines.length) {
        const line = lines[i];
        const trimmed = line.trim();

        if (!trimmed) {
          i += 1;
          continue;
        }

        if (/^```/.test(trimmed)) {
          const codeLines = [];
          i += 1;
          while (i < lines.length && !/^```/.test(lines[i].trim())) {
            codeLines.push(lines[i]);
            i += 1;
          }
          if (i < lines.length) i += 1;
          html.push(`<pre class="cb-md-pre"><code>${codeLines.join("\n")}</code></pre>`);
          continue;
        }

        if (trimmed.includes("|") && i + 1 < lines.length && /^\s*\|?\s*:?-{3,}/.test(lines[i + 1])) {
          const headers = parseTableCells(trimmed);
          i += 2;
          const rows = [];
          while (i < lines.length && lines[i].includes("|")) {
            rows.push(parseTableCells(lines[i]));
            i += 1;
          }

          const headHtml = headers.map((h) => `<th>${inlineMd(h)}</th>`).join("");
          const bodyHtml = rows
            .map((row) => `<tr>${row.map((c) => `<td>${inlineMd(c)}</td>`).join("")}</tr>`)
            .join("");
          html.push(`<div class="cb-md-table-wrap"><table class="cb-md-table"><thead><tr>${headHtml}</tr></thead><tbody>${bodyHtml}</tbody></table></div>`);
          continue;
        }

        if (/^###\s+/.test(trimmed)) {
          html.push(`<h3 class="cb-md-h3">${inlineMd(trimmed.replace(/^###\s+/, ""))}</h3>`);
          i += 1;
          continue;
        }
        if (/^##\s+/.test(trimmed)) {
          html.push(`<h2 class="cb-md-h2">${inlineMd(trimmed.replace(/^##\s+/, ""))}</h2>`);
          i += 1;
          continue;
        }
        if (/^#\s+/.test(trimmed)) {
          html.push(`<h1 class="cb-md-h1">${inlineMd(trimmed.replace(/^#\s+/, ""))}</h1>`);
          i += 1;
          continue;
        }

        if (/^[-*]\s+/.test(trimmed)) {
          const items = [];
          while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
            items.push(lines[i].replace(/^\s*[-*]\s+/, ""));
            i += 1;
          }
          html.push(`<ul class="cb-md-ul">${items.map((item) => `<li>${inlineMd(item)}</li>`).join("")}</ul>`);
          continue;
        }

        if (/^\d+\.\s+/.test(trimmed)) {
          const items = [];
          while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
            items.push(lines[i].replace(/^\s*\d+\.\s+/, ""));
            i += 1;
          }
          html.push(`<ol class="cb-md-ol">${items.map((item) => `<li>${inlineMd(item)}</li>`).join("")}</ol>`);
          continue;
        }

        const paragraph = [];
        while (i < lines.length && lines[i].trim()) {
          paragraph.push(lines[i]);
          i += 1;
        }
        html.push(`<p class="cb-md-p">${inlineMd(paragraph.join("<br>"))}</p>`);
      }

      return html.join("");
    }
  
    // ── Pantallas ───────────────────────────────────────────────────────────────
    function showChat(screenForm, screenChat, onImageUpload) {
      screenForm.style.display = "none";
      screenChat.style.display = "flex";
      
      const footer = screenChat.querySelector(".cb-footer");
      let imageBtn = footer ? footer.querySelector(".cb-image-upload-btn") : null;
      
      if (footer && !imageBtn) {
        imageBtn = document.createElement("button");
        imageBtn.className = "cb-image-upload-btn";
        imageBtn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M21 15V19C21 20.1046 20.1046 21 19 21H5C3.89543 21 3 20.1046 3 19V15" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M17 8L12 3L7 8" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M12 3V15" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg><span class="cb-image-upload-label">Subir</span>`;
        imageBtn.title = "Subir imagen";
        footer.insertBefore(imageBtn, footer.firstChild);
      }
      
      if (imageBtn && typeof onImageUpload === "function") {
        imageBtn.onclick = onImageUpload;
      }
    }
  
    return {
      createHTML,
      addUserMessage,
      addBotMessage,
      addSystemMessage,
      addAITrace,
      showTyping,
      hideTyping,
      showBadge,
      removeBadge,
      showAIStatus,
      hideAIStatus,
      showImageUploadButton,
      addImagePreview,
      addMessageImages,
      setResponderStatus,
      addInterventionButton,
      showChat,
    };
  })();
