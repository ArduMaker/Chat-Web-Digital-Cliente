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
  let pollOpen = false;

  const seenAgentMessageKeys = new Set();
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

  function renderImages(images) {
    const newImages = getImages(images);
    if (newImages.length > 0) {
      ChatUI.addMessageImages(body, newImages);
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
        showWaitingForHuman();
        resetInput();
        return true;
      }

      if (text) {
        ChatUI.hideTyping();
        ChatUI.addBotMessage(body, text, sender === "bot" ? ensureInterventionButton : null);
      }
    }

    if (sender === "seller") {
      showSellerActive();
    } else {
      showBotActive();
    }

    renderImages(msg?.images);
    resetInput();
    return !alreadySeen;
  }

  function stopPoll() {
    if (!pollOpen) return;
    ChatPoll.close();
    pollOpen = false;
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
    stopPoll();
    ChatUI.hideTyping();
    ChatUI.hideAIStatus();
    clearSession();
    resetComposer();
    showFormScreen();
  }

  async function ensureInterventionButton() {
    const existingStatus = statusEl?.textContent?.toLowerCase() || "";
    const isHumanActive = existingStatus.includes("humano") && existingStatus.includes("respondiendo");
    const isWaitingHuman = existingStatus.includes("intervención humana solicitada");
    if (isHumanActive || isWaitingHuman) return;

    ChatUI.addInterventionButton(body, async (evt) => {
      const btn = evt?.currentTarget;
      if (!btn || typeof btn !== "object") return;

      btn.disabled = true;
      btn.textContent = "Solicitando...";
      showWaitingForHuman();
      ChatUI.addSystemMessage(body, "Solicitud enviada. Un agente humano responderá.");

      try {
        await ChatAPI.requestIntervention(chatUuid, sessionToken);
      } catch (err) {
        dbg("intervention:error", err);
        ChatUI.removeBadge(body, "cb-waiting-badge");
        ChatUI.addSystemMessage(body, "No se pudo solicitar intervención humana. Inténtalo de nuevo.");
        if (typeof btn.remove === "function") btn.remove();
        ensureInterventionButton();
      }
    });
  }

  function openPoll() {
    if (!chatUuid || !sessionToken || pollOpen) return;
    pollOpen = true;
    dbg("poll:open", { chatUuid });

    ChatPoll.open(chatUuid, sessionToken, {
      onThinking: () => {
        showBotActive();
        ChatUI.showTyping(body);
      },

      onAIStatus: (payload) => {
        dbg("poll:ai_status", payload);
        const message = payload?.current_status_message;
        const isProcessing = Boolean(payload?.is_processing);

        if (message) {
          ChatUI.showAIStatus(body, message, payload?.current_status_step);
        } else {
          ChatUI.hideAIStatus();
        }

        if (isProcessing) {
          showBotActive();
          ChatUI.showTyping(body);
        } else {
          ChatUI.hideTyping();
        }
      },

      onMessages: (messages) => {
        dbg("poll:messages", { count: messages.length });
        const parsed = ChatPoll.parseMessages(messages);
        for (const msg of parsed) {
          if (msg.sender === "customer") continue;
          renderAgentMessage(msg);
        }
      },

      onImages: (images) => {
        renderImages(images);
      },

      onIntervention: () => {
        dbg("poll:intervention");
        ChatUI.hideTyping();
        showWaitingForHuman();
        const interventionBtn = body.querySelector(".cb-intervention-btn");
        if (interventionBtn && typeof interventionBtn.remove === "function") {
          interventionBtn.remove();
        }
      },

      onSellerActive: () => {
        dbg("poll:seller-active");
        showSellerActive();
        const interventionBtn = body.querySelector(".cb-intervention-btn");
        if (interventionBtn && typeof interventionBtn.remove === "function") {
          interventionBtn.remove();
        }
      },

      onClosed: () => {
        dbg("poll:chat-closed");
        ChatUI.addSystemMessage(body, "La conversación fue cerrada.");
        stopPoll();
        clearSession();
      },

      onUnauthorized: async (err) => {
        await handleSessionExpired(err);
      },

      onError: (err) => {
        dbg("poll:error", err);
        console.warn("[Chat] Error en polling:", err);
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

    showChatScreen();
    syncEndButtonVisibility();
    openPoll();
    dbg("session:restored", { chatUuid });
    return true;
  }

  function resetWidgetToForm() {
    stopPoll();
    ChatUI.hideTyping();
    ChatUI.hideAIStatus();
    clearSession();

    startingSession = false;
    seenAgentMessageKeys.clear();
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
      openPoll();
    }

    setTimeout(() => (chatUuid ? input : nameInput).focus(), 100);
  };

  closeBtn.onclick = () => {
    stopPoll();
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

      if (body.childElementCount === 0) {
        ChatUI.addBotMessage(body, WELCOME_MESSAGE, null);
      }

      showBotActive();
      openPoll();
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

  function handleImageUploadButtonClick() {
    const picker = document.createElement("input");
    picker.type = "file";
    picker.accept = "image/*";
    picker.multiple = true;

    picker.onchange = (e) => {
      const files = Array.from(e.target.files || []);
      if (files.length === 0) return;

      let availableSlots = MAX_IMAGES_PER_REQUEST - pendingImages.length;
      if (availableSlots <= 0) {
        ChatUI.addSystemMessage(body, "Solo puedes enviar hasta 5 imágenes por mensaje.");
        return;
      }

      for (const file of files) {
        if (availableSlots <= 0) break;
        if (!file.type.startsWith("image/")) continue;
        if (file.size > MAX_IMAGE_SIZE_BYTES) {
          ChatUI.addSystemMessage(body, `La imagen ${file.name} supera 10MB y no se agregó.`);
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
          ChatUI.addSystemMessage(body, "Imágenes enviadas. Procesando...");
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
    ChatUI.showTyping(body);

    try {
      await ChatAPI.sendMessage(chatUuid, customerName, text, sessionToken);
      saveSession();
      dbg("send:ok");
    } catch (err) {
      dbg("send:error", err);
      ChatUI.hideTyping();
      ChatUI.addSystemMessage(body, "Error al enviar el mensaje. Inténtalo de nuevo.");
      resetInput();
    }
  }
})();
