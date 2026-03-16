// chatbot-poll.js — HTTP Polling for Public Web Chats
const ChatPoll = (function () {
  let pollTimer = null;
  let lastServerTime = null;
  let lastSince = null;
  let closed = false;
  let retries = 0;
  let isProcessingAI = false;

  const MIN_POLL_INTERVAL_MS = 500;
  const MAX_POLL_INTERVAL_MS = 30000;
  const IDLE_POLL_INTERVAL_MS = 10000;
  const PROCESSING_POLL_INTERVAL_MS = 500;
  const BASE_RETRY_MS = 1000;
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

  function calculateNextInterval(isProcessing) {
    if (isProcessing) {
      return PROCESSING_POLL_INTERVAL_MS;
    }
    if (typeof document !== "undefined" && document.hidden) {
      return MAX_POLL_INTERVAL_MS;
    }
    return IDLE_POLL_INTERVAL_MS;
  }

  function scheduleNextPoll(chatUuid, sessionToken, handlers, isProcessing) {
    if (closed) return;

    const interval = calculateNextInterval(isProcessing);
    dbg("poll:scheduled", { interval, isProcessing });

    pollTimer = setTimeout(async () => {
      if (closed) return;
      if (typeof document !== "undefined" && document.hidden) {
        scheduleNextPoll(chatUuid, sessionToken, handlers, isProcessing);
        return;
      }

      try {
        const data = await ChatAPI.pollChat(chatUuid, sessionToken, lastSince);

        // server_time is now Unix timestamp in milliseconds (timezone-independent)
        if (data?.server_time) {
          lastServerTime = data.server_time;
          lastSince = data.server_time;
        }

        if (data?.ai_status?.is_processing !== undefined) {
          isProcessingAI = data.ai_status.is_processing;
        }

        if (data?.has_new && Array.isArray(data?.messages)) {
          handlers.onMessages?.(data.messages);
        }

        if (data?.ai_status) {
          handlers.onAIStatus?.(data.ai_status);
        }

        if (data?.chat_status) {
          if (data.chat_status.humanRequested) {
            handlers.onIntervention?.();
          }
          if (data.chat_status.responder === "seller") {
            handlers.onSellerActive?.();
          }
        }

        retries = 0;
      } catch (err) {
        dbg("poll:error", err);
        retries += 1;
        if (retries > MAX_RETRIES) {
          dbg("poll:max-retries");
          handlers.onError?.(err);
          return;
        }
        const delay = BASE_RETRY_MS * Math.min(retries, 5);
        pollTimer = setTimeout(() => {
          scheduleNextPoll(chatUuid, sessionToken, handlers, isProcessing);
        }, delay);
        return;
      }

      scheduleNextPoll(chatUuid, sessionToken, handlers, isProcessingAI);
    }, interval);
  }

  function open(chatUuid, sessionToken, handlers) {
    close();

    closed = false;
    retries = 0;
    lastSince = null;
    lastServerTime = null;
    isProcessingAI = false;

    dbg("poll:open", { chatUuid });

    scheduleNextPoll(chatUuid, sessionToken, handlers, false);
  }

  function updateAIStatus(isProcessing) {
    isProcessingAI = isProcessing;
    dbg("poll:ai-status-update", { isProcessing });
  }

  function close() {
    closed = true;
    clearPollTimer();
    lastSince = null;
    lastServerTime = null;
    isProcessingAI = false;
    retries = 0;
    dbg("poll:close");
  }

  function parseMessages(messages) {
    return messages.map((msg) => {
      const rawText =
        msg.message ||
        msg.text ||
        msg.response ||
        "";
      const text = typeof rawText === "string" ? rawText.trim() : "";
      const sender = String(msg?.sender || "bot").toLowerCase();
      const id = msg?.id;
      const sentAt = msg?.sentAt || msg?.sent_at;

      return { text, sender, id, sentAt };
    });
  }

  return { open, close, updateAIStatus, parseMessages };
})();
