// chatbot-ws.js — WebSocket transport for Public Web Chat
const ChatWS = (function () {
  const configBase = (typeof window !== "undefined" && window.DMTX_CHATBOT_CONFIG?.apiBaseUrl)
    ? String(window.DMTX_CHATBOT_CONFIG.apiBaseUrl)
    : "https://apidigitalmtx.arducloud.com";

  const WS_BASE = configBase.replace(/\/+$/, "").replace(/^https?/, (m) => m === "https" ? "wss" : "ws");

  const DEBUG_ENABLED = Boolean(
    (window.DMTX_CHATBOT_CONFIG && window.DMTX_CHATBOT_CONFIG.debug) ||
    (typeof localStorage !== "undefined" && localStorage.getItem("dmtx_chat_debug") === "1")
  );
  const dbg = (...args) => {
    if (!DEBUG_ENABLED) return;
    console.debug("[WP-Chat-WS][debug]", ...args);
  };

  let ws = null;
  let closed = true;
  let chatUuid = null;
  let sessionToken = null;
  let handlers = null;
  let reconnectTimer = null;
  let reconnectDelay = 1000;

  const MAX_RECONNECT_DELAY_MS = 30000;
  const POLL_INTERVAL_MS = 5000;      // mantenido por compatibilidad de API
  const FAST_POLL_INTERVAL_MS = 2000; // mantenido por compatibilidad de API

  function buildWsUrl(uuid, token) {
    return `${WS_BASE}/ws/chat/${encodeURIComponent(uuid)}/?token=${encodeURIComponent(token)}`;
  }

  function clearReconnectTimer() {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  }

  function scheduleReconnect() {
    if (closed) return;
    clearReconnectTimer();
    dbg("ws:reconnect-in", reconnectDelay);
    reconnectTimer = setTimeout(() => {
      if (!closed) connect();
    }, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY_MS);
  }

  function handleMessage(msg) {
    dbg("ws:event", msg.type);
    switch (msg.type) {
      case "initial_state":
        handlers?.onInitialState?.(msg);
        break;

      case "new_message":
        handlers?.onMessages?.([msg]);
        break;

      case "ai_status":
        handlers?.onAIStatus?.(msg);
        if (msg.is_processing) handlers?.onThinking?.();
        break;

      case "chat_updated":
        if (msg.status === "closed") {
          handlers?.onClosed?.(msg);
          close();
          return;
        }
        if (msg.humanRequested) handlers?.onIntervention?.();
        if (msg.responder === "seller") handlers?.onSellerActive?.();
        break;

      default:
        dbg("ws:unknown-type", msg.type);
    }
  }

  function connect() {
    if (closed || !chatUuid || !sessionToken) return;

    try {
      ws = new WebSocket(buildWsUrl(chatUuid, sessionToken));
    } catch (err) {
      dbg("ws:open-error", err);
      scheduleReconnect();
      return;
    }

    ws.onopen = () => {
      dbg("ws:open");
      reconnectDelay = 1000;
    };

    ws.onmessage = (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch {
        dbg("ws:parse-error", event.data);
        return;
      }
      handleMessage(msg);
    };

    ws.onclose = (event) => {
      dbg("ws:close", event.code, event.reason);
      ws = null;
      if (closed) return;

      // 4001 = token inválido/expirado, 4003 = no autorizado
      if (event.code === 4001 || event.code === 4003) {
        handlers?.onUnauthorized?.({ status: 401, wsCode: event.code });
        close();
        return;
      }

      scheduleReconnect();
    };

    ws.onerror = () => {
      // onclose se dispara siempre después de onerror, la reconexión va ahí
    };
  }

  function open(uuid, token, newHandlers) {
    close();
    chatUuid = uuid;
    sessionToken = token;
    handlers = newHandlers;
    closed = false;
    reconnectDelay = 1000;
    dbg("ws:opening", { chatUuid });
    connect();
  }

  function close() {
    closed = true;
    clearReconnectTimer();
    if (ws) {
      try { ws.close(1000); } catch (_) {}
      ws = null;
    }
    dbg("ws:closed");
  }

  function sendMessage(text) {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      dbg("ws:send-failed — not open, readyState:", ws?.readyState);
      return false;
    }
    ws.send(JSON.stringify({ type: "send_message", message: text }));
    dbg("ws:sent", String(text).slice(0, 60));
    return true;
  }

  function parseMessages(messages) {
    return messages.map((msg) => {
      const rawText = msg.message || msg.text || msg.response || "";
      const text = typeof rawText === "string" ? rawText.trim() : "";
      const sender = String(msg?.sender || "bot").toLowerCase();
      const id = msg?.id;
      const sentAt = msg?.sentAt || msg?.sent_at;
      const images = Array.isArray(msg?.images) ? msg.images : [];
      const senderName = msg?.senderName || msg?.sender_name || "";
      const metadata = msg?.metadata && typeof msg.metadata === "object" ? msg.metadata : {};
      const chat = msg?.chat && typeof msg.chat === "object" ? msg.chat : null;

      return { text, sender, id, sentAt, images, senderName, metadata, chat, raw: msg };
    });
  }

  return { open, close, sendMessage, parseMessages, POLL_INTERVAL_MS, FAST_POLL_INTERVAL_MS };
})();
