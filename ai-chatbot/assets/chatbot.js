// chatbot.js — Entry point DigitalMTX Chat Widget
// Depende de: chatbot-api.js, chatbot-ui.js, chatbot-poll.js
console.log("CHATBOT DIGITALMTX v4.0", Date.now());

(function () {
  if (window.__DMTX_CHATBOT_BOOTSTRAPPED__) {
    console.warn("[Chat] Widget ya inicializado. Ignorando bootstrap duplicado.");
    return;
  }
  window.__DMTX_CHATBOT_BOOTSTRAPPED__ = true;

  let chatUuid = null;
  let sessionToken = null;
  let sessionExpiresAt = null;
  let customerName = "";
  let customerEmail = "";
  let chatFingerprint = "";
  let sseTimeout = null;
  let pollingTimer = null;
  let liveSyncTimer = null;
  let startingSession = false;
  let pendingImages = [];
  const seenAgentMessageKeys = new Set();
  const DEBUG_ENABLED = Boolean(
    (window.DMTX_CHATBOT_CONFIG && window.DMTX_CHATBOT_CONFIG.debug) ||
    (typeof localStorage !== "undefined" && localStorage.getItem("dmtx_chat_debug") === "1")
  );
  const dbg = (...args) => {
    if (!DEBUG_ENABLED) return;
    console.debug("[WP-Chat][debug]", ...args);
  };

  const SSE_TIMEOUT_MS = 6000;
  const POLL_INTERVAL_MS = 1200;
  const POLL_MAX_ATTEMPTS = 30;
  const WELCOME_MESSAGE = "Hola! 👋 ¿Cómo puedo ayudarte hoy?";
  const SESSION_STORAGE_KEY = "dmtx_chat_public_session";

  const root = ChatUI.createHTML();
  const toggleBtn = root.querySelector(".cb-btn");
  const panel = root.querySelector(".cb-panel");
  const closeBtn = root.querySelector(".cb-close-btn");
  const endBtn = root.querySelector("#cb-end-chat");
  const screenForm = root.querySelector("#cb-screen-form");
  const screenChat = root.querySelector("#cb-screen-chat");
  const nameInput = root.querySelector("#cb-name");
  const emailInput = root.querySelector("#cb-email");
  const startBtn = root.querySelector("#cb-start");
  const body = root.querySelector("#cb-body");
  const statusEl = root.querySelector("#cb-responder-status");
  const input = root.querySelector("#cb-input");
  const sendBtn = root.querySelector("#cb-send");
  
  function syncEndButtonVisibility() {
    if (!endBtn) return;
    const hasSession = Boolean(chatUuid && sessionToken);
    endBtn.style.display = hasSession ? "inline-flex" : "none";
  }
  syncEndButtonVisibility();

  function ensureFingerprint() {
    const key = "dmtx_chat_fingerprint";
    let fp = localStorage.getItem(key);
    if (!fp) {
      fp = `fp-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
      localStorage.setItem(key, fp);
    }
    return fp;
  }

  function setResponderState(kind) {
    if (kind === "human") {
      ChatUI.setResponderStatus(statusEl, "Un agente humano está respondiendo", "human");
      return;
    }
    if (kind === "waiting") {
      ChatUI.setResponderStatus(statusEl, "Intervención humana solicitada", "waiting");
      return;
    }
    ChatUI.setResponderStatus(statusEl, "Asistente virtual respondiendo", "neutral");
  }

  function isInterventionSignal(text) {
    return String(text || "").trim() === "__REQUEST_HUMAN_INTERVENTION__";
  }

  function clearWaitTimers() {
    if (sseTimeout) {
      clearTimeout(sseTimeout);
      sseTimeout = null;
    }
    if (pollingTimer) {
      clearInterval(pollingTimer);
      pollingTimer = null;
    }
  }

  function stopLiveSync() {
    if (liveSyncTimer) {
      clearInterval(liveSyncTimer);
      liveSyncTimer = null;
    }
  }

  function startLiveSync() {
    if (liveSyncTimer || !chatUuid || !sessionToken) return;
    liveSyncTimer = setInterval(async () => {
      if (document.hidden) return;
      if (!panel.classList.contains("open")) return;
      if (!chatUuid || !sessionToken) return;
      try {
        const data = await ChatAPI.getChat(chatUuid, sessionToken);
        const messages = Array.isArray(data?.messages) ? data.messages : [];
        for (const msg of messages) {
          const sender = getSender(msg);
          if (sender === "customer") continue;
          const text = getMessageText(msg);
          if (!text) continue;
          renderAgentMessage(text, sender || "bot", msg?.id || msg?.sentAt || text);
        }
      } catch (err) {
        dbg("liveSync:error", err);
      }
    }, 3000);
  }

  function getMessageText(raw) {
    if (!raw) return "";
    const text = raw.message || raw.text || raw.response || "";
    return String(text).trim();
  }

  function getSender(raw) {
    return String(raw?.sender || raw?.role || "").toLowerCase();
  }

  function deriveConversationState(messages) {
    let waitingForHuman = false;
    let lastAgentText = "";
    let lastAgentSender = "bot";
    let lastAgentKey = "";

    for (const msg of Array.isArray(messages) ? messages : []) {
      const sender = getSender(msg);
      if (sender === "customer") continue;

      const text = getMessageText(msg);
      if (!text) continue;

      if (isInterventionSignal(text)) {
        waitingForHuman = true;
        continue;
      }

      // Any agent reply resolves the previous intervention wait state.
      waitingForHuman = false;
      lastAgentText = text;
      lastAgentSender = sender || "bot";
      lastAgentKey = `${msg?.id || msg?.sentAt || text}`;
    }

    return { waitingForHuman, lastAgentText, lastAgentSender, lastAgentKey };
  }

  function saveSession() {
    if (!chatUuid || !sessionToken) return;
    const payload = {
      chatUuid,
      sessionToken,
      sessionExpiresAt,
      customerName,
      customerEmail,
      chatFingerprint,
    };
    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(payload));
  }

  function clearSession() {
    chatUuid = null;
    sessionToken = null;
    sessionExpiresAt = null;
    localStorage.removeItem(SESSION_STORAGE_KEY);
    syncEndButtonVisibility();
  }

  function readStoredSession() {
    try {
      const raw = localStorage.getItem(SESSION_STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed?.chatUuid || !parsed?.sessionToken) return null;

      const expiresAt = parsed.sessionExpiresAt ? new Date(parsed.sessionExpiresAt).getTime() : 0;
      if (expiresAt && expiresAt - Date.now() < 30000) return null;

      return parsed;
    } catch {
      return null;
    }
  }

  function ensureInterventionButton() {
    const existingStatus = statusEl?.textContent?.toLowerCase() || "";
    const isHumanActive = existingStatus.includes("humano") && existingStatus.includes("responder");
    const isWaitingHuman = existingStatus.includes("intervenção humana solicitada");
    if (isHumanActive || isWaitingHuman) return;

    ChatUI.addInterventionButton(body, async (evt) => {
      const btn = evt?.currentTarget;
      if (!btn || typeof btn !== "object") return;
      dbg("intervention:click");
      // Feedback instantaneo para el cliente al solicitar intervención.
      if (typeof btn.remove === "function") {
        btn.remove();
      } else if (btn.parentNode) {
        btn.parentNode.removeChild(btn);
      }
      setResponderState("waiting");
      ChatUI.showBadge(body, "⏳ Esperando a un agente humano...", "cb-badge-orange", "cb-waiting-badge");
      ChatUI.addSystemMessage(body, "Solicitud enviada. Un agente humano responderá.");
      btn.disabled = true;
      btn.textContent = "Solicitando...";
      try {
        await ChatAPI.requestIntervention(chatUuid, customerName, sessionToken);
        dbg("intervention:sent");
      } catch {
        dbg("intervention:error");
        ChatUI.removeBadge(body, "cb-waiting-badge");
        ChatUI.addSystemMessage(body, "No se pudo enviar la solicitud. Inténtalo de nuevo.");
        ensureInterventionButton();
      }
    });
  }

  function renderAgentMessage(text, sender, dedupeSeed) {
    const clean = String(text || "").trim();
    if (!clean) return false;
    if (isInterventionSignal(clean)) {
      clearWaitTimers();
      ChatUI.hideTyping();
      setResponderState("waiting");
      ChatUI.showBadge(body, "⏳ Esperando a un agente humano...", "cb-badge-orange", "cb-waiting-badge");
      resetInput();
      return false;
    }

    const messageId = dedupeSeed || Date.now();
    const key = `${sender || "bot"}:${messageId}:${clean}`;
    if (seenAgentMessageKeys.has(key)) return false;
    seenAgentMessageKeys.add(key);

    ChatUI.hideTyping();
    ChatUI.addBotMessage(body, clean, ensureInterventionButton);
    if (sender === "seller") {
      setResponderState("human");
      ChatUI.removeBadge(body, "cb-waiting-badge");
      ChatUI.showBadge(body, "✅ Un agente humano está respondiendo", "cb-badge-green", "cb-seller-badge");
    } else {
      setResponderState("bot");
      ChatUI.removeBadge(body, "cb-seller-badge");
    }
    resetInput();
    return true;
  }

  function renderHistory(messages) {
    if (!Array.isArray(messages) || body.childElementCount > 0) return;

    const state = deriveConversationState(messages);

    for (const msg of messages) {
      const sender = getSender(msg);
      const text = getMessageText(msg);
      if (!text) continue;
      if (isInterventionSignal(text)) {
        continue;
      }

      if (sender === "customer") {
        ChatUI.addUserMessage(body, text);
      } else {
        // During history hydration, do not auto-create intervention CTA per message.
        ChatUI.addBotMessage(body, text, null);
        seenAgentMessageKeys.add(text);
        setResponderState(sender === "seller" ? "human" : "bot");
      }
    }

    if (state.waitingForHuman) {
      setResponderState("waiting");
      ChatUI.showBadge(body, "⏳ Esperando a un agente humano...", "cb-badge-orange", "cb-waiting-badge");
      ChatUI.removeBadge(body, "cb-seller-badge");
    } else {
      ChatUI.removeBadge(body, "cb-waiting-badge");
      const lastAgentIsSeller = state.lastAgentSender === "seller";
      if (lastAgentIsSeller) {
        setResponderState("human");
        ChatUI.showBadge(body, "✅ Un agente humano está respondiendo", "cb-badge-green", "cb-seller-badge");
      } else {
        ChatUI.removeBadge(body, "cb-seller-badge");
        ensureInterventionButton();
      }
    }
  }

  async function restoreSessionIfPossible() {
    const stored = readStoredSession();
    if (!stored) return false;

    chatUuid = stored.chatUuid;
    sessionToken = stored.sessionToken;
    sessionExpiresAt = stored.sessionExpiresAt || null;
    customerName = stored.customerName || "Cliente";
    customerEmail = stored.customerEmail || "";
    chatFingerprint = stored.chatFingerprint || ensureFingerprint();

    try {
      dbg("restoreSession:start", { chatUuid });
      const chat = await ChatAPI.getChat(chatUuid, sessionToken);
      ChatUI.showChat(screenForm, screenChat, handleImageUploadButtonClick);
      renderHistory(chat?.messages || []);
      openPoll();
      startLiveSync();
      syncEndButtonVisibility();
      dbg("restoreSession:success");
      return true;
    } catch (err) {
      const status = err?.status;
      // Solo invalida la sesión cuando el backend confirma que no es válida.
      // En errores transitorios (429/5xx/network), mantiene la sesión para evitar
      // crear nuevas sesiones en cascada.
      if (status === 401 || status === 403 || status === 404) {
        console.warn("[Chat] Sesión almacenada inválida, creando una nueva.", err);
        clearSession();
      } else {
        console.warn("[Chat] No se pudo restaurar la sesión (error transitorio).", err);
      }
      dbg("restoreSession:error", { status });
      return false;
    }
  }

  async function pollForAgentResponse(maxAttempts = POLL_MAX_ATTEMPTS) {
    if (!chatUuid || !sessionToken) return;

    let attempts = 0;
    pollingTimer = setInterval(async () => {
      attempts += 1;
      dbg("poll:tick", { attempts, chatUuid });

      try {
        const data = await ChatAPI.getChat(chatUuid, sessionToken);
        const messages = Array.isArray(data?.messages) ? data.messages : [];
        const state = deriveConversationState(messages);

        if (state.waitingForHuman) {
          dbg("poll:intervention-detected");
          clearWaitTimers();
          ChatUI.hideTyping();
          setResponderState("waiting");
          ChatUI.showBadge(body, "⏳ Esperando a un agente humano...", "cb-badge-orange", "cb-waiting-badge");
          resetInput();
          return;
        }

        if (state.lastAgentText) {
          dbg("poll:agent-message-detected");
          clearWaitTimers();
          const rendered = renderAgentMessage(state.lastAgentText, state.lastAgentSender, state.lastAgentKey);
          if (rendered) return;
        }
      } catch (err) {
        dbg("poll:error", err);
        console.warn("[Chat] Falló el fallback de polling:", err);
      }

      if (attempts >= maxAttempts) {
        dbg("poll:max-attempts");
        clearWaitTimers();
        ChatUI.hideTyping();
        if (!body.querySelector("#cb-waiting-badge")) {
          ChatUI.addSystemMessage(body, "Procesando la respuesta. Inténtalo de nuevo en unos instantes.");
        }
        setResponderState("bot");
        ensureInterventionButton();
        resetInput();
      }
    }, POLL_INTERVAL_MS);
  }

  toggleBtn.onclick = async () => {
    toggleBtn.classList.remove("pulse");
    toggleBtn.style.display = "none";
    panel.classList.add("open");

    if (!chatUuid) {
      await restoreSessionIfPossible();
    }
    startLiveSync();

    setTimeout(() => (chatUuid ? input : nameInput).focus(), 100);
  };

  closeBtn.onclick = () => {
    panel.classList.remove("open");
    toggleBtn.style.display = "flex";
    stopLiveSync();
  };

  function resetWidgetToForm() {
    ChatPoll.close();
    clearWaitTimers();
    stopLiveSync();
    ChatUI.hideTyping();
    clearSession();
    startingSession = false;
    seenAgentMessageKeys.clear();
    pendingImages = [];
    body.innerHTML = "";
    input.value = "";
    input.style.height = "auto";
    input.disabled = false;
    sendBtn.disabled = true;
    screenChat.style.display = "none";
    screenForm.style.display = "flex";
    nameInput.focus();
    dbg("chat:ended");
  }

  endBtn.onclick = async () => {
    const confirmed = window.confirm("¿Finalizar esta conversación?");
    if (!confirmed) return;
    if (chatUuid && sessionToken) {
      try {
        await ChatAPI.closeChat(chatUuid, sessionToken);
      } catch (err) {
        dbg("chat:close:error", err);
        ChatUI.addSystemMessage(body, "No se pudo finalizar la conversación en el servidor. Inténtalo de nuevo.");
        return;
      }
    }
    resetWidgetToForm();
  };

  nameInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      startChat();
    }
  });
  startBtn.onclick = startChat;

  async function startChat() {
    if (startingSession) return;

    if (chatUuid && sessionToken) {
      ChatUI.showChat(screenForm, screenChat, handleImageUploadButtonClick);
      syncEndButtonVisibility();
      input.focus();
      openPoll();
      startLiveSync();
      return;
    }

    const name = nameInput.value.trim();
    if (!name) {
      nameInput.style.borderColor = "#ef4444";
      nameInput.focus();
      return;
    }

    nameInput.style.borderColor = "";
    customerName = name;
    customerEmail = emailInput.value.trim();
    chatFingerprint = ensureFingerprint();

    startingSession = true;
    startBtn.disabled = true;
    startBtn.textContent = "Iniciando...";

    try {
      dbg("startChat:createSession");
      const data = await ChatAPI.createChat(customerName, customerEmail, chatFingerprint);
      chatUuid = data.uuid || data.chat_uuid || data.id || data.chatId;
      sessionToken = data.session_token || data.sessionToken || null;
      sessionExpiresAt = data.expires_at || data.expiresAt || null;

      if (!chatUuid) throw new Error("No se encontró el UUID de la conversación en la respuesta de inicio.");
      if (!sessionToken) throw new Error("No se encontró el token de sesión en la respuesta de inicio.");

      saveSession();
      ChatUI.showChat(screenForm, screenChat, handleImageUploadButtonClick);
      input.focus();
      syncEndButtonVisibility();

      ChatUI.addBotMessage(body, WELCOME_MESSAGE, null);
      setResponderState("bot");
      openPoll();
      startLiveSync();
      dbg("startChat:ready", { chatUuid });
    } catch (err) {
      dbg("startChat:error", err);
      console.error("[Chat] Error al crear la sesión:", err);
      const status = err?.status;
      if (status === 429) {
        ChatUI.addSystemMessage(body, "Demasiados intentos de conexión. Espera un momento e inténtalo de nuevo.");
      } else {
        ChatUI.addSystemMessage(body, "Error al conectar. Inténtalo de nuevo.");
      }
    } finally {
      startingSession = false;
      startBtn.disabled = false;
      startBtn.textContent = "Iniciar conversación";
    }
  }

  input.addEventListener("input", () => {
    sendBtn.disabled = !input.value.trim();
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 100) + "px";
  });

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!sendBtn.disabled) doSend();
    }
  });

  function handleImageUploadButtonClick() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.multiple = true;
    input.onchange = async (e) => {
      const files = Array.from(e.target.files || []);
      if (files.length === 0) return;
      
      const validFiles = files.filter(f => f.type.startsWith("image/")).slice(0, 5 - pendingImages.length);
      if (validFiles.length === 0) return;
      
      for (const file of validFiles) {
        pendingImages.push(file);
        ChatUI.addImagePreview(body, file, () => {
          const idx = pendingImages.indexOf(file);
          if (idx > -1) pendingImages.splice(idx, 1);
        });
      }
    };
    input.click();
  }

  sendBtn.onclick = doSend;

  async function doSend() {
    const text = input.value.trim();
    if (!text && pendingImages.length === 0) return;
    if (!chatUuid || !sessionToken) return;

    input.value = "";
    input.style.height = "auto";
    sendBtn.disabled = true;

    if (pendingImages.length > 0) {
      try {
        dbg("send:uploading-images", { count: pendingImages.length });
        await ChatAPI.uploadImages(chatUuid, pendingImages, sessionToken);
        pendingImages = [];
      } catch (err) {
        dbg("send:image-upload-error", err);
        ChatUI.addSystemMessage(body, "Error al subir las imágenes. Continuando sin ellas.");
        pendingImages = [];
      }
    }

    if (!text) return;

    ChatUI.addUserMessage(body, text);
    ChatUI.showTyping(body);
    dbg("send:start", { textLength: text.length, chatUuid });

    clearWaitTimers();
    sseTimeout = setTimeout(() => {
      pollForAgentResponse();
    }, SSE_TIMEOUT_MS);

    try {
      await ChatAPI.sendMessage(chatUuid, customerName, text, sessionToken);
      saveSession();
      dbg("send:success");
    } catch (err) {
      dbg("send:error", err);
      console.error("[Chat] Error al enviar:", err);
      clearWaitTimers();
      ChatUI.hideTyping();
      ChatUI.addSystemMessage(body, "Error al enviar. Inténtalo de nuevo.");
      resetInput();
    }
  }

  function resetInput() {
    sendBtn.disabled = !input.value.trim();
    input.focus();
  }

  function openPoll() {
    if (!chatUuid || !sessionToken) return;
    dbg("poll:open", { chatUuid });

    ChatPoll.open(chatUuid, sessionToken, {
      onThinking: () => {
        dbg("poll:thinking");
        setResponderState("bot");
        ChatUI.showTyping(body);
      },

      onAIStatus: (payload) => {
        dbg("poll:ai_status", payload);
        const step = payload?.current_status_step;
        const message = payload?.current_status_message;
        if (message) {
          ChatUI.showAIStatus(body, message, step);
          ChatPoll.updateAIStatus(true);
        } else {
          ChatUI.hideAIStatus(body);
          ChatPoll.updateAIStatus(false);
        }
      },

      onMessages: (messages) => {
        dbg("poll:messages", { count: messages.length });
        const parsed = ChatPoll.parseMessages(messages);
        for (const msg of parsed) {
          if (msg.sender === "customer") continue;
          const rendered = renderAgentMessage(msg.text, msg.sender, msg.id || msg.sentAt || msg.text);
          if (rendered) {
            clearWaitTimers();
            ChatPoll.updateAIStatus(false);
          }
        }
      },

      onIntervention: () => {
        dbg("poll:intervention");
        clearWaitTimers();
        ChatUI.hideTyping();
        setResponderState("waiting");
        ChatUI.showBadge(body, "⏳ Esperando a un agente humano...", "cb-badge-orange", "cb-waiting-badge");
        ChatUI.removeBadge(body, "cb-seller-badge");
        const interventionBtn = body.querySelector(".cb-intervention-btn");
        if (interventionBtn && typeof interventionBtn.remove === "function") {
          interventionBtn.remove();
        }
        resetInput();
        ChatPoll.updateAIStatus(false);
      },

      onSellerActive: () => {
        dbg("poll:seller-active");
        setResponderState("human");
        ChatUI.removeBadge(body, "cb-waiting-badge");
        ChatUI.showBadge(body, "✅ Un agente humano está respondiendo", "cb-badge-green", "cb-seller-badge");
        const interventionBtn = body.querySelector(".cb-intervention-btn");
        if (interventionBtn && typeof interventionBtn.remove === "function") {
          interventionBtn.remove();
        }
        ChatPoll.updateAIStatus(false);
      },

      onError: (err) => {
        dbg("poll:error", err);
        console.warn("[Chat] Error en polling:", err);
      },
    });
  }
})();
