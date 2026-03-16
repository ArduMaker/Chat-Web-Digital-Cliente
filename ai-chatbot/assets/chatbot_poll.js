// chatbot-poll.js — HTTP Polling for Public Web Chats
const ChatPoll = (function () {
  let pollTimer = null;
  let closed = true;
  let retries = 0;
  let lastServerTime = null;

  const POLL_INTERVAL_MS = 4000; // 4 segundos
  const BASE_RETRY_MS = 1000;
  const MAX_RETRY_DELAY_MS = 30000;
  const MAX_RETRIES = 10;

  const DEBUG_ENABLED = Boolean(
    (window.DMTX_CHATBOT_CONFIG && window.DMTX_CHATBOT_CONFIG.debug) ||
    (typeof localStorage !== "undefined" && localStorage.getItem("dmtx_chat_debug") === "1")
  );
  const dbg = (...args) => {
    if (!DEBUG_ENABLED) return;
    console.debug("[WP-Chat-Poll][debug]", ...args);
  };

  function clearPollTimer() {
    if (pollTimer) {
      clearTimeout(pollTimer);
      pollTimer = null;
    }
  }

  function scheduleNextPoll(chatUuid, sessionToken, handlers, delayMs) {
    if (closed) return;

    clearPollTimer();
    const delay = typeof delayMs === "number" ? delayMs : POLL_INTERVAL_MS;
    dbg("poll:scheduled", { delay, lastServerTime });

    pollTimer = setTimeout(async () => {
      if (closed) return;

      try {
        const data = await ChatAPI.pollChat(chatUuid, sessionToken, lastServerTime);

        if (data?.server_time !== undefined && data?.server_time !== null) {
          lastServerTime = data.server_time;
        }

        if (data?.ai_status) {
          handlers.onAIStatus?.(data.ai_status);
          if (data.ai_status.is_processing) handlers.onThinking?.();
        }

        if (data?.has_new && Array.isArray(data?.messages)) {
          handlers.onMessages?.(data.messages);
        }

        if (data?.has_new && Array.isArray(data?.images)) {
          handlers.onImages?.(data.images);
        }

        if (data?.chat_status) {
          if (data.chat_status.status === "closed") {
            handlers.onClosed?.(data.chat_status);
            close();
            return;
          }

          if (data.chat_status.humanRequested) {
            handlers.onIntervention?.();
          }
          if (data.chat_status.responder === "seller") {
            handlers.onSellerActive?.();
          }
        }

        retries = 0;
        scheduleNextPoll(chatUuid, sessionToken, handlers, POLL_INTERVAL_MS);
      } catch (err) {
        dbg("poll:error", err);

        const status = err?.status;
        if (status === 401 || status === 403 || status === 404) {
          handlers.onUnauthorized?.(err);
          close();
          return;
        }

        retries += 1;
        if (retries > MAX_RETRIES) {
          dbg("poll:max-retries");
          handlers.onError?.(err);
          close();
          return;
        }

        const delay = Math.min(BASE_RETRY_MS * Math.pow(2, retries - 1), MAX_RETRY_DELAY_MS);
        scheduleNextPoll(chatUuid, sessionToken, handlers, delay);
      }
    }, delay);
  }

  function open(chatUuid, sessionToken, handlers) {
    close();

    closed = false;
    retries = 0;
    lastServerTime = null;

    dbg("poll:open", { chatUuid });

    // Primer poll inmediato, luego cada 4 segundos.
    scheduleNextPoll(chatUuid, sessionToken, handlers, 0);
  }

  function close() {
    closed = true;
    clearPollTimer();
    retries = 0;
    lastServerTime = null;
    dbg("poll:close");
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

      return { text, sender, id, sentAt, images, senderName };
    });
  }

  return { open, close, parseMessages };
})();
