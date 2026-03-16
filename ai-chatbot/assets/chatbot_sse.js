// chatbot-sse.js — SSE stream (Public Web Chats)
const ChatSSE = (function () {
  let controller = null;
  let reconnectTimer = null;
  let closed = false;
  let retries = 0;

  const SESSION_HEADER = "X-Session-Token";
  const MAX_RETRIES = 12;
  const BASE_RETRY_MS = 700;
  const MAX_RETRY_MS = 12000;
  const DEBUG_ENABLED = Boolean(
    (window.DMTX_CHATBOT_CONFIG && window.DMTX_CHATBOT_CONFIG.debug) ||
    (typeof localStorage !== "undefined" && localStorage.getItem("dmtx_chat_debug") === "1")
  );
  const dbg = (...args) => {
    if (!DEBUG_ENABLED) return;
    console.debug("[WP-Chat-SSE][debug]", ...args);
  };

  function clearReconnect() {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  }

  function parseEventBlock(block) {
    const lines = block.split("\n");
    let eventName = "";
    const dataLines = [];

    for (const line of lines) {
      if (!line || line.startsWith(":")) continue;
      if (line.startsWith("event:")) {
        eventName = line.slice(6).trim();
        continue;
      }
      if (line.startsWith("data:")) {
        dataLines.push(line.slice(5).trimStart());
      }
    }

    if (!dataLines.length) return null;

    try {
      const payload = JSON.parse(dataLines.join("\n"));
      if (!payload.type && eventName) payload.type = eventName;
      return payload;
    } catch {
      return null;
    }
  }

  function scheduleReconnect(connectFn) {
    if (closed) return;
    if (typeof document !== "undefined" && document.hidden) return;
    clearReconnect();

    retries += 1;
    if (retries > MAX_RETRIES) {
      console.warn("[SSE] Se alcanzó el límite de reconexiones.");
      return;
    }

    const jitter = Math.floor(Math.random() * 250);
    const delay = Math.min(BASE_RETRY_MS * (2 ** Math.min(retries - 1, 6)), MAX_RETRY_MS) + jitter;
    dbg("reconnect:scheduled", { retries, delay });
    reconnectTimer = setTimeout(connectFn, delay);
  }

  function open(chatUuid, sessionToken, handlers) {
    close();

    closed = false;
    retries = 0;
    controller = new AbortController();

    async function connect() {
      if (closed) return;
      if (typeof document !== "undefined" && document.hidden) return;

      try {
        controller = new AbortController();
        const res = await fetch(ChatAPI.streamUrl(chatUuid), {
          method: "GET",
          headers: {
            Accept: "text/event-stream",
            ...(sessionToken ? { [SESSION_HEADER]: sessionToken } : {}),
          },
          signal: controller.signal,
        });

        if (!res.ok || !res.body) {
          console.warn("[SSE] Resposta inválida:", res.status);
          dbg("connect:invalid-response", { status: res.status });
          scheduleReconnect(connect);
          return;
        }

        retries = 0;
        dbg("connect:ok");
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = "";

        while (!closed) {
          const { done, value } = await reader.read();
          if (done) {
            dbg("stream:done");
            scheduleReconnect(connect);
            break;
          }

          buf += dec.decode(value, { stream: true });
          const parts = buf.split("\n\n");
          buf = parts.pop() ?? "";

          for (const part of parts) {
            const payload = parseEventBlock(part);
            if (!payload) continue;
            handleEvent(payload, handlers);
          }
        }
      } catch (err) {
        if (err?.name !== "AbortError") {
          dbg("connect:error", err);
          console.warn("[SSE] Conexión perdida. Reconectando...");
          scheduleReconnect(connect);
        }
      }
    }

    void connect();
  }

  function close() {
    closed = true;
    clearReconnect();

    if (controller) {
      controller.abort();
      controller = null;
    }
    dbg("close");
  }

  function handleEvent(payload, handlers) {
    dbg("event", payload?.type, payload);
    switch (payload.type) {
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

      case "heartbeat":
      default:
        break;
    }
  }

  return { open, close };
})();
