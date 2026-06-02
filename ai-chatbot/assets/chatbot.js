// chatbot.js — Entry point DigitalMTX Chat Widget
// Depende de: chatbot-api.js, chatbot-ui.js, chatbot-poll.js
console.log("CHATBOT DIGITALMTX v5.1", Date.now());

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
  let startingSession = false;
  let pendingImages = [];
  let wsOpen = false;
  let aiStatusVisible = false;
  let awaitingResponse = false;
  let interventionRequested = false;
  let userHasSentMessage = false;
  let pendingAITrace = null;
  let pendingAITraceId = null;
  let lastPipelineStatusMessage = "";

  const seenAgentMessageKeys = new Set();
  const seenCustomerMessageKeys = new Set();
  const outboundTextQueue = [];
  const seenImageUrls = new Set();

  const DEBUG_ENABLED = Boolean(
    (window.DMTX_CHATBOT_CONFIG && window.DMTX_CHATBOT_CONFIG.debug) ||
    (typeof localStorage !== "undefined" && localStorage.getItem("dmtx_chat_debug") === "1")
  );
  const dbg = (...args) => {
    if (!DEBUG_ENABLED) return;
    console.debug("[WP-Chat][debug]", ...args);
  };

  const WELCOME_MESSAGE = "¡Hola! 👋 ¿Cómo puedo ayudarte hoy?";
  const SESSION_STORAGE_KEY = "dmtx_chat_public_session";
  const MAX_IMAGES_PER_REQUEST = 5;
  const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024;

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
  ChatUI.initBody(body);
  const statusEl = root.querySelector("#cb-responder-status");
  const input = root.querySelector("#cb-input");
  const sendBtn = root.querySelector("#cb-send");

  function syncEndButtonVisibility() {
    if (!endBtn) return;
    endBtn.style.display = chatUuid && sessionToken ? "inline-flex" : "none";
  }
  syncEndButtonVisibility();

  function updateSendAvailability() {
    const hasText = Boolean(input.value.trim());
    const hasImages = pendingImages.length > 0;
    sendBtn.disabled = !(hasText || hasImages);
  }

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

  function isHumanStateActive() {
    const existingStatus = statusEl?.textContent?.toLowerCase() || "";
    const isHumanActive = existingStatus.includes("humano") && existingStatus.includes("respondiendo");
    const isWaitingHuman = existingStatus.includes("intervención humana solicitada");
    return isHumanActive || isWaitingHuman;
  }

  function setPipelineLiveStatus(message) {
    const text = String(message || "").trim();
    if (!text || isHumanStateActive()) return;
    ChatUI.setResponderStatus(statusEl, `IA en proceso: ${text}`, "waiting");
  }

  function formatServerDate(value) {
    if (!value) return "";
    const dt = new Date(value);
    if (Number.isNaN(dt.getTime())) return String(value);
    return dt.toLocaleString("es-ES", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  }

  function parsePipelineTrace(metadata) {
    const history = Array.isArray(metadata?.pipeline_history) ? metadata.pipeline_history : [];
    const normalized = history
      .map((entry) => {
        const pipeline = entry?.foto_pipeline && typeof entry.foto_pipeline === "object" ? entry.foto_pipeline : {};
        const label = String(entry?.timestamp || pipeline?.estado || "Paso de procesamiento").trim();
        const detail = String(pipeline?.detalle || "").trim();
        const status = String(pipeline?.estado || "").trim();
        const loggedAt = formatServerDate(entry?.logged_at || pipeline?.ultima_revision || "");
        return { label, detail, status, loggedAt };
      })
      .filter((step) => step.label || step.detail || step.status);

    const dedup = [];
    const seen = new Set();
    for (const step of normalized) {
      const key = `${step.label}|${step.detail}|${step.status}|${step.loggedAt}`;
      if (seen.has(key)) continue;
      seen.add(key);
      dedup.push(step);
    }
    return dedup;
  }

  function getLivePipelineStatus(metadata) {
    const pipeline = metadata?.foto_pipeline && typeof metadata.foto_pipeline === "object" ? metadata.foto_pipeline : {};
    const history = Array.isArray(metadata?.pipeline_history) ? metadata.pipeline_history : [];
    const latest = history.length > 0 ? history[history.length - 1] : null;
    const latestPipeline = latest?.foto_pipeline && typeof latest.foto_pipeline === "object" ? latest.foto_pipeline : {};

    return String(
      metadata?.timestamp ||
      latest?.timestamp ||
      pipeline?.estado ||
      latestPipeline?.estado ||
      pipeline?.detalle ||
      latestPipeline?.detalle ||
      ""
    ).trim();
  }

  function capturePipelineFromMessage(msg) {
    const metadata = msg?.metadata && typeof msg.metadata === "object" ? msg.metadata : {};
    const steps = parsePipelineTrace(metadata);
    if (steps.length > 0) {
      pendingAITrace = steps;
      pendingAITraceId = String(msg?.id || msg?.sentAt || msg?.sent_at || Date.now());
    }

    const liveStatus = getLivePipelineStatus(metadata);
    if (liveStatus) {
      lastPipelineStatusMessage = liveStatus;
      setPipelineLiveStatus(liveStatus);
      aiStatusVisible = true;
      ChatUI.showAIStatus(body, liveStatus);
      ChatUI.hideTyping();
    }
  }

  function flushPendingAITrace() {
    if (!pendingAITrace || pendingAITrace.length === 0) return;
    ChatUI.addAITrace(body, pendingAITrace, pendingAITraceId || undefined);
    pendingAITrace = null;
    pendingAITraceId = null;
    lastPipelineStatusMessage = "";
  }

  function isInterventionSignal(text) {
    return String(text || "").trim() === "__REQUEST_HUMAN_INTERVENTION__";
  }

  function normalizeImageUrl(url) {
    const value = String(url || "").trim();
    if (!value) return "";
    if (/^https?:\/\//i.test(value)) return value;

    const base = String(window?.DMTX_CHATBOT_CONFIG?.apiBaseUrl || "").replace(/\/+$/, "");
    if (base && value.startsWith("/")) return `${base}${value}`;
    return value;
  }

  function getMessageText(raw) {
    if (!raw) return "";
    const text = raw.message || raw.text || raw.response || "";
    return String(text).trim();
  }

  function getSender(raw) {
    return String(raw?.sender || raw?.role || "").toLowerCase();
  }

  function getImages(raw) {
    if (!Array.isArray(raw)) return [];

    const unique = [];
    for (const img of raw) {
      const url = normalizeImageUrl(img?.url || img?.image || "");
      if (!url || seenImageUrls.has(url)) continue;
      seenImageUrls.add(url);
      unique.push({ ...img, url });
    }

    return unique;
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
      if (expiresAt && expiresAt - Date.now() < 30_000) return null;

      return parsed;
    } catch {
      return null;
    }
  }

  function clearPendingPreviews() {
    const previews = body.querySelectorAll(".cb-image-preview");
    previews.forEach((el) => el.remove());
  }

  function resetComposer() {
    input.value = "";
    input.style.height = "auto";
    pendingImages = [];
    clearPendingPreviews();
    updateSendAvailability();
  }

  function resetInput() {
    updateSendAvailability();
    input.focus();
  }

  function setAwaitingResponse(value) {
    awaitingResponse = Boolean(value);
  }

  function normalizeTextForMatch(text) {
    return String(text || "").trim().replace(/\s+/g, " ").toLowerCase();
  }

  function queueOutboundText(text) {
    const normalized = normalizeTextForMatch(text);
    if (!normalized) return;
    outboundTextQueue.push({ text: normalized, at: Date.now() });
    if (outboundTextQueue.length > 40) {
      outboundTextQueue.splice(0, outboundTextQueue.length - 40);
    }
  }

  function consumeOutboundEcho(text) {
    const normalized = normalizeTextForMatch(text);
    if (!normalized) return false;
    const now = Date.now();

    for (let i = outboundTextQueue.length - 1; i >= 0; i -= 1) {
      if (now - outboundTextQueue[i].at > 90_000) {
        outboundTextQueue.splice(i, 1);
      }
    }

    for (let i = 0; i < outboundTextQueue.length; i += 1) {
      if (outboundTextQueue[i].text === normalized) {
        outboundTextQueue.splice(i, 1);
        return true;
      }
    }
    return false;
  }

  function showWaitingForHuman() {
    setResponderState("waiting");
    ChatUI.showBadge(body, "⏳ Esperando a un agente humano...", "cb-badge-orange", "cb-waiting-badge");
    ChatUI.removeBadge(body, "cb-seller-badge");
  }

  function showSellerActive() {
    setResponderState("human");
    ChatUI.removeBadge(body, "cb-waiting-badge");
    ChatUI.showBadge(body, "✅ Un agente humano está respondiendo", "cb-badge-green", "cb-seller-badge");
  }

  function showBotActive() {
    setResponderState("bot");
    ChatUI.removeBadge(body, "cb-seller-badge");
  }

  function renderImages(images, sender = "bot") {
    const newImages = getImages(images);
    if (newImages.length > 0) {
      ChatUI.addMessageImages(body, newImages, sender);
    }
  }

  function renderAgentMessage(msg) {
    const sender = getSender(msg);
    const text = getMessageText(msg);
    const idSeed = msg?.id || msg?.sentAt || msg?.sent_at || "";
    const key = `${sender}:${idSeed}:${text}`;
    const alreadySeen = seenAgentMessageKeys.has(key);

    if (!alreadySeen) {
      seenAgentMessageKeys.add(key);

      if (isInterventionSignal(text)) {
        ChatUI.hideTyping();
        ChatUI.hideAIStatus();
        aiStatusVisible = false;
        setAwaitingResponse(false);
        showWaitingForHuman();
        resetInput();
        return true;
      }

      if (text) {
        ChatUI.hideTyping();
        ChatUI.hideAIStatus();
        aiStatusVisible = false;
        setAwaitingResponse(false);
        ChatUI.addBotMessage(body, text, sender === "bot" ? ensureInterventionButton : null);
        flushPendingAITrace();
      }
    }

    if (sender === "seller") {
      showSellerActive();
    } else {
      showBotActive();
    }

    renderImages(msg?.images, sender);
    resetInput();
    return !alreadySeen;
  }

  function renderCustomerMessage(msg) {
    const sender = getSender(msg);
    const text = getMessageText(msg);
    const idSeed = msg?.id || msg?.sentAt || msg?.sent_at || "";
    const key = `${sender}:${idSeed}:${text}`;

    capturePipelineFromMessage(msg);
    renderImages(msg?.images, "customer");

    if (seenCustomerMessageKeys.has(key)) return false;
    seenCustomerMessageKeys.add(key);

    if (!text) return false;

    if (consumeOutboundEcho(text)) {
      return false;
    }

    ChatUI.addUserMessage(body, text);
    return true;
  }

  function stopWS() {
    if (!wsOpen) return;
    ChatWS.close();
    wsOpen = false;
  }

  function showFormScreen() {
    screenChat.style.display = "none";
    screenForm.style.display = "flex";
    setTimeout(() => nameInput.focus(), 60);
  }

  function showChatScreen() {
    ChatUI.showChat(screenForm, screenChat, handleImageUploadButtonClick);
  }

  async function handleSessionExpired(err) {
    dbg("session:expired", err);
    stopWS();
    ChatUI.hideTyping();
    ChatUI.hideAIStatus();
    aiStatusVisible = false;
    awaitingResponse = false;
    interventionRequested = false;
    pendingAITrace = null;
    pendingAITraceId = null;
    lastPipelineStatusMessage = "";
    clearSession();
    resetComposer();
    showFormScreen();
  }

  async function ensureInterventionButton() {
    const headerContainer = panel.querySelector("#cb-intervention-container");
    if (!headerContainer) return;

    if (!userHasSentMessage) return;

    const existing = headerContainer.querySelector(".cb-intervention-btn");
    if (existing) return;

    ChatUI.addInterventionButton(body, async (evt) => {
      const btn = evt?.currentTarget;
      if (!btn || typeof btn !== "object") return;

      if (interventionRequested) {
        showWaitingForHuman();
        return;
      }

      btn.disabled = true;
      btn.textContent = "Solicitando...";
      showWaitingForHuman();
      ChatUI.addSystemMessage(body, "Solicitud enviada. Un agente humano responderá.");

      try {
        await ChatAPI.requestIntervention(chatUuid, sessionToken);
        interventionRequested = true;
        btn.disabled = false;
        btn.textContent = "Hablar con un humano";
      } catch (err) {
        dbg("intervention:error", err);
        ChatUI.removeBadge(body, "cb-waiting-badge");
        ChatUI.addSystemMessage(body, "No se pudo solicitar intervención humana. Inténtalo de nuevo.");
        btn.disabled = false;
        btn.textContent = "Hablar con un humano";
      }
    });
  }

  function openWS() {
    if (!chatUuid || !sessionToken || wsOpen) return;
    wsOpen = true;
    dbg("ws:opening", { chatUuid });

    ChatWS.open(chatUuid, sessionToken, {
      onInitialState: (payload) => {
        dbg("ws:initial_state", payload);

        // Restaurar estado del chat
        if (payload.humanRequested) {
          interventionRequested = true;
          showWaitingForHuman();
        } else if (payload.responder === "seller") {
          showSellerActive();
        } else {
          showBotActive();
        }

        if (payload.is_processing) {
          setAwaitingResponse(true);
          const statusMsg = payload.current_status_message;
          if (statusMsg) {
            aiStatusVisible = true;
            ChatUI.showAIStatus(body, statusMsg, payload.current_status_step);
          } else {
            ChatUI.showTyping(body);
          }
        }

        // Renderizar historial (seenKeys evita duplicados al reconectar)
        const msgs = Array.isArray(payload.messages) ? payload.messages : [];
        const parsed = ChatWS.parseMessages(msgs);
        for (const msg of parsed) {
          if (msg.sender === "customer") {
            renderCustomerMessage(msg);
          } else {
            renderAgentMessage(msg);
          }
        }
      },

      onThinking: () => {
        if (aiStatusVisible) return;
        showBotActive();
        ChatUI.showTyping(body);
      },

      onAIStatus: (payload) => {
        dbg("ws:ai_status", payload);
        const message = payload?.current_status_message;
        const isProcessing = Boolean(payload?.is_processing);
        const hasStatusMessage = typeof message === "string" && message.trim().length > 0;
        const effectiveMessage = hasStatusMessage ? message.trim() : lastPipelineStatusMessage;

        if (isProcessing) {
          setAwaitingResponse(true);
        }

        if (effectiveMessage) {
          aiStatusVisible = true;
          ChatUI.showAIStatus(body, effectiveMessage, payload?.current_status_step);
          setPipelineLiveStatus(effectiveMessage);
        } else {
          aiStatusVisible = false;
          ChatUI.hideAIStatus();
          if (!isProcessing) {
            showBotActive();
          }
        }

        if (isProcessing) {
          showBotActive();
          if (aiStatusVisible) {
            ChatUI.hideTyping();
          } else {
            ChatUI.showTyping(body);
          }
        } else {
          ChatUI.hideTyping();
        }
      },

      onMessages: (messages) => {
        dbg("ws:messages", { count: messages.length });
        const parsed = ChatWS.parseMessages(messages);
        for (const msg of parsed) {
          if (msg.sender === "customer") {
            renderCustomerMessage(msg);
            continue;
          }
          renderAgentMessage(msg);
        }

        const lastMessage = parsed.length > 0 ? parsed[parsed.length - 1] : null;
        if (lastMessage && lastMessage.sender !== "customer") {
          setAwaitingResponse(false);
          ChatUI.hideTyping();
          ChatUI.hideAIStatus();
          aiStatusVisible = false;
        }
      },

      onImages: () => {
        // Las imágenes se manejan dentro de onMessages vía msg.images
      },

      onIntervention: () => {
        dbg("ws:intervention");
        setAwaitingResponse(false);
        interventionRequested = true;
        ChatUI.hideTyping();
        showWaitingForHuman();
      },

      onSellerActive: () => {
        dbg("ws:seller-active");
        setAwaitingResponse(false);
        interventionRequested = false;
        showSellerActive();
      },

      onClosed: () => {
        dbg("ws:chat-closed");
        ChatUI.addSystemMessage(body, "La conversación fue cerrada.");
        setTimeout(() => resetWidgetToForm(), 2000);
      },

      onUnauthorized: async (err) => {
        await handleSessionExpired(err);
      },

      onError: (err) => {
        dbg("ws:error", err);
        console.warn("[Chat] Error en WebSocket:", err);
      },
    });
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
    interventionRequested = false;

    showChatScreen();
    syncEndButtonVisibility();
    openWS();
    dbg("session:restored", { chatUuid });
    return true;
  }

  function resetWidgetToForm() {
    stopWS();
    ChatUI.resetScroll();
    ChatUI.hideTyping();
    ChatUI.hideAIStatus();
    aiStatusVisible = false;
    awaitingResponse = false;
    interventionRequested = false;
    pendingAITrace = null;
    pendingAITraceId = null;
    lastPipelineStatusMessage = "";
    clearSession();

    startingSession = false;
    userHasSentMessage = false;
    seenAgentMessageKeys.clear();
    seenCustomerMessageKeys.clear();
    outboundTextQueue.length = 0;
    seenImageUrls.clear();

    body.innerHTML = "";
    resetComposer();

    input.disabled = false;
    showFormScreen();
    dbg("chat:ended");
  }

  toggleBtn.onclick = async () => {
    toggleBtn.classList.remove("pulse");
    toggleBtn.style.display = "none";
    panel.classList.add("open");

    if (!chatUuid || !sessionToken) {
      await restoreSessionIfPossible();
    } else {
      showChatScreen();
      openWS();
    }

    setTimeout(() => (chatUuid ? input : nameInput).focus(), 100);
  };

  closeBtn.onclick = () => {
    stopWS();
    panel.classList.remove("open");
    toggleBtn.style.display = "flex";
  };

  endBtn.onclick = async () => {
    const confirmed = window.confirm("¿Finalizar esta conversación?");
    if (!confirmed) return;

    if (chatUuid && sessionToken) {
      try {
        await ChatAPI.closeChat(chatUuid, sessionToken);
      } catch (err) {
        dbg("chat:close:error", err);
        ChatUI.addSystemMessage(body, "No se pudo cerrar el chat en el servidor. Inténtalo de nuevo.");
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
      showChatScreen();
      syncEndButtonVisibility();
      openPoll();
      input.focus();
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
      const data = await ChatAPI.createChat(customerName, customerEmail, chatFingerprint);
      chatUuid = data.uuid || data.chat_uuid || data.id || data.chatId;
      sessionToken = data.session_token || data.sessionToken || null;
      sessionExpiresAt = data.expires_at || data.expiresAt || null;

      if (!chatUuid) throw new Error("No se encontró el UUID de la conversación en la respuesta de /init.");
      if (!sessionToken) throw new Error("No se encontró el token de sesión en la respuesta de /init.");

      saveSession();
      syncEndButtonVisibility();
      showChatScreen();
      ChatUI.addBotMessage(body, WELCOME_MESSAGE, null);
      showBotActive();
      openWS();
      input.focus();
      dbg("chat:ready", { chatUuid });
    } catch (err) {
      dbg("start:error", err);
      const status = err?.status;
      if (status === 429) {
        ChatUI.addSystemMessage(body, "Demasiados intentos. Espera un momento e inténtalo de nuevo.");
      } else {
        ChatUI.addSystemMessage(body, "Error al iniciar conversación. Inténtalo de nuevo.");
      }
    } finally {
      startingSession = false;
      startBtn.disabled = false;
      startBtn.textContent = "Iniciar conversación";
    }
  }

  input.addEventListener("input", () => {
    updateSendAvailability();
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 100) + "px";
  });

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!sendBtn.disabled) doSend();
    }
  });

  function addImageFiles(files) {
    let availableSlots = MAX_IMAGES_PER_REQUEST - pendingImages.length;
    if (availableSlots <= 0) {
      ChatUI.addSystemMessage(body, "Solo puedes enviar hasta 5 imágenes por mensaje.");
      return;
    }
    for (const file of files) {
      if (availableSlots <= 0) break;
      if (!file.type.startsWith("image/")) continue;
      if (file.size > MAX_IMAGE_SIZE_BYTES) {
        ChatUI.addSystemMessage(body, `La imagen supera 10MB y no se agregó.`);
        continue;
      }
      pendingImages.push(file);
      availableSlots -= 1;
      ChatUI.addImagePreview(body, file, () => {
        const idx = pendingImages.indexOf(file);
        if (idx >= 0) pendingImages.splice(idx, 1);
        updateSendAvailability();
      });
    }
    updateSendAvailability();
  }

  panel.addEventListener("paste", (e) => {
    const items = Array.from(e.clipboardData?.items || []);
    const imageItems = items.filter((item) => item.type.startsWith("image/"));
    if (imageItems.length === 0) return;
    e.preventDefault();
    const files = imageItems.map((item) => item.getAsFile()).filter(Boolean);
    addImageFiles(files);
  });

  function handleImageUploadButtonClick() {
    const picker = document.createElement("input");
    picker.type = "file";
    picker.accept = "image/*";
    picker.multiple = true;

    picker.onchange = (e) => {
      const files = Array.from(e.target.files || []);
      if (files.length > 0) addImageFiles(files);
    };

    picker.click();
  }

  sendBtn.onclick = doSend;

  async function doSend() {
    const text = input.value.trim();
    const hasText = Boolean(text);
    const hasImages = pendingImages.length > 0;

    if (!hasText && !hasImages) return;
    if (!chatUuid || !sessionToken) return;

    input.value = "";
    input.style.height = "auto";
    updateSendAvailability();

    if (hasImages) {
      try {
        await ChatAPI.uploadImages(chatUuid, pendingImages, sessionToken);
        resetComposer();
        if (!hasText) {
          setAwaitingResponse(true);
          showBotActive();
          ChatUI.showTyping(body);
        }
      } catch (err) {
        dbg("send:image-upload-error", err);
        if (!hasText) {
          ChatUI.addSystemMessage(body, "Error al subir imágenes. Inténtalo nuevamente.");
          return;
        }
        ChatUI.addSystemMessage(body, "No se pudieron subir las imágenes. Enviando solo el texto.");
        resetComposer();
      }
    }

    if (!hasText) {
      resetInput();
      return;
    }

    ChatUI.addUserMessage(body, text);
    queueOutboundText(text);
    userHasSentMessage = true;
    setAwaitingResponse(true);
    ChatUI.showTyping(body);
    ensureInterventionButton();

    const sent = ChatWS.sendMessage(text);
    if (sent) {
      saveSession();
      dbg("send:ok");
    } else {
      dbg("send:error — ws not open");
      setAwaitingResponse(false);
      ChatUI.hideTyping();
      ChatUI.addSystemMessage(body, "Error al enviar el mensaje. Inténtalo de nuevo.");
      resetInput();
    }
  }
})();
