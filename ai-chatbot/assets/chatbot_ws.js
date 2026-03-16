// chatbot-ws.js — WebSocket (Public Web Chats)
const ChatWS = (function () {
  let ws = null;
  let reconnectTimer = null;
  let closed = false;
  let retries = 0;
  let messageQueue = [];
  let heartbeatInterval = null;

  const MAX_RETRIES = 12;
  const BASE_RETRY_MS = 700;
  const MAX_RETRY_MS = 12000;
  const HEARTBEAT_INTERVAL_MS = 30000;
  const DEBUG_ENABLED = Boolean(
    (window.DMTX_CHATBOT_CONFIG && window.DMTX_CHATBOT_CONFIG.debug) ||
    (typeof localStorage !== "undefined" && localStorage.getItem("dmtx_chat_debug") === "1")
  );
  const dbg = (...args) => {
    if (!DEBUG_ENABLED) return;
    console.debug("[WP-Chat-WS][debug]", ...args);
  };

  function clearReconnect() {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  }

  function clearHeartbeat() {
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
      heartbeatInterval = null;
    }
  }

  function scheduleReconnect(connectFn) {
    if (closed) return;
    if (typeof document !== "undefined" && document.hidden) return;
    clearReconnect();

    retries += 1;
    if (retries > MAX_RETRIES) {
      console.warn("[WS] Se alcanzó el límite de reconexiones.");
      return;
    }

    const jitter = Math.floor(Math.random() * 250);
    const delay = Math.min(BASE_RETRY_MS * (2 ** Math.min(retries - 1, 6)), MAX_RETRY_MS) + jitter;
    dbg("reconnect:scheduled", { retries, delay });
    reconnectTimer = setTimeout(connectFn, delay);
  }

  function getWebSocketUrl(chatUuid) {
    const apiBase = window.DMTX_CHATBOT_CONFIG?.apiBaseUrl || "https://apidigitalmtx.arducloud.com";
    const wsBase = apiBase.replace(/^http/, "ws");
    return `${wsBase}/ws/public/chats/${encodeURIComponent(chatUuid)}/`;
  }

  function startHeartbeat() {
    clearHeartbeat();
    heartbeatInterval = setInterval(() => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(JSON.stringify({ type: "ping" }));
          dbg("heartbeat:sent");
        } catch (err) {
          dbg("heartbeat:error", err);
        }
      }
    }, HEARTBEAT_INTERVAL_MS);
  }

  function processQueuedMessages() {
    while (messageQueue.length > 0 && ws && ws.readyState === WebSocket.OPEN) {
      const msg = messageQueue.shift();
      try {
        ws.send(msg);
        dbg("queue:sent", msg);
      } catch (err) {
        dbg("queue:error", err);
        messageQueue.unshift(msg);
        break;
      }
    }
  }

  function open(chatUuid, sessionToken, handlers) {
    close();

    closed = false;
    retries = 0;
    messageQueue = [];

    async function connect() {
      if (closed) return;
      if (typeof document !== "undefined" && document.hidden) return;

      try {
        const url = getWebSocketUrl(chatUuid);
        dbg("connect:attempting", url);

        ws = new WebSocket(url);

        ws.onopen = () => {
          dbg("connect:ok");
          retries = 0;
          startHeartbeat();
          processQueuedMessages();
        };

        ws.onmessage = (event) => {
          try {
            const payload = JSON.parse(event.data);
            dbg("message:received", payload);
            handleEvent(payload, handlers);
          } catch (err) {
            dbg("message:parse-error", err, event.data);
          }
        };

        ws.onerror = (err) => {
          dbg("connect:error", err);
          console.warn("[WS] Error de conexión");
        };

        ws.onclose = (event) => {
          dbg("connect:closed", event.code, event.reason);
          clearHeartbeat();
          if (!closed) {
            dbg("reconnect:triggered");
            scheduleReconnect(connect);
          }
        };
      } catch (err) {
        dbg("connect:exception", err);
        if (!closed) {
          scheduleReconnect(connect);
        }
      }
    }

    void connect();
  }

  function sendMessage(msg) {
    const jsonMsg = JSON.stringify(msg);
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(jsonMsg);
        dbg("send:ok", msg);
      } catch (err) {
        dbg("send:error", err);
        messageQueue.push(jsonMsg);
      }
    } else {
      messageQueue.push(jsonMsg);
      dbg("queue:added", msg);
    }
  }

  function close() {
    closed = true;
    clearReconnect();
    clearHeartbeat();
    messageQueue = [];

    if (ws) {
      ws.close();
      ws = null;
    }
    dbg("close");
  }

  function handleEvent(payload, handlers) {
    dbg("event", payload?.type, payload);
    switch (payload.type) {
      case "ping":
        sendMessage({ type: "pong" });
        break;

      case "pong":
        dbg("heartbeat:received");
        break;

      case "ai_thinking":
        handlers.onThinking?.();
        break;

      case "ai_status": {
        const step = payload?.step || payload?.data?.step;
        const message = payload?.message || payload?.data?.message;
        handlers.onAIStatus?.({ step, message });
        break;
      }

      case "new_message": {
        const msg = payload.message || payload.data || payload;
        const sender = msg?.sender || payload?.sender;
        const id = msg?.id ?? payload?.id;
        const sentAt = msg?.sentAt ?? msg?.sent_at ?? payload?.sentAt ?? payload?.sent_at;
        const rawText =
          msg?.message ||
          msg?.text ||
          msg?.response ||
          payload?.message ||
          payload?.text ||
          payload?.response ||
          payload?.data?.message ||
          payload?.data?.text ||
          payload?.data?.response;
        const text = typeof rawText === "string" ? rawText.trim() : "";
        if (!text || sender === "customer") break;
        handlers.onMessage?.({ text, sender, id, sentAt });
        break;
      }

      case "intervention_requested":
        handlers.onIntervention?.();
        break;

      case "chat_updated": {
        const responder =
          payload?.responder ||
          payload?.data?.responder ||
          payload?.currentResponder ||
          payload?.data?.currentResponder ||
          payload?.current_responder ||
          payload?.data?.current_responder;
        const humanRequested =
          payload?.humanRequested ??
          payload?.data?.humanRequested ??
          payload?.human_requested ??
          payload?.data?.human_requested;
        if (responder === "seller") handlers.onSellerActive?.();
        if (humanRequested === true) handlers.onIntervention?.();
        break;
      }

      default:
        break;
    }
  }

  return { open, close };
})();
