// chatbot-api.js — Public Web Chat API
const ChatAPI = (function () {
  const configBase = (typeof window !== "undefined" && window.DMTX_CHATBOT_CONFIG?.apiBaseUrl)
    ? String(window.DMTX_CHATBOT_CONFIG.apiBaseUrl)
    : "https://apidigitalmtx.arducloud.com";
  const BASE = configBase.replace(/\/+$/, "");
  const SESSION_HEADER = "X-Session-Token";
  let createChatInFlight = null;

  function buildUrl(path) {
    return `${BASE}${path.startsWith("/") ? "" : "/"}${path}`;
  }

  function buildHeaders(sessionToken, hasJsonBody) {
    const headers = {};
    if (hasJsonBody) headers["Content-Type"] = "application/json";
    if (sessionToken) headers[SESSION_HEADER] = sessionToken;
    return headers;
  }

  async function parseError(res) {
    try {
      const body = await res.json();
      return body?.detail || body?.message || body?.error || `HTTP ${res.status}`;
    } catch {
      return `HTTP ${res.status}`;
    }
  }

  async function createChat(customerName, customerEmail, fingerprint) {
    if (createChatInFlight) return createChatInFlight;

    createChatInFlight = (async () => {
      const res = await fetch(buildUrl("/api/v1/public/chats/init/"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerName,
          customerEmail: customerEmail || undefined,
          fingerprint,
        }),
      });

      if (!res.ok) {
        const err = new Error(await parseError(res));
        err.status = res.status;
        const retryAfter = res.headers.get("retry-after");
        if (retryAfter) err.retryAfter = retryAfter;
        throw err;
      }

      return res.json();
    })();

    try {
      return await createChatInFlight;
    } finally {
      createChatInFlight = null;
    }
  }

  async function sendMessage(chatUuid, customerName, text, sessionToken) {
    const payload = {
      sender: "customer",
      message: text,
    };

    if (customerName) {
      payload.senderName = customerName;
    }

    const res = await fetch(buildUrl(`/api/v1/public/chats/${encodeURIComponent(chatUuid)}/messages/`), {
      method: "POST",
      headers: buildHeaders(sessionToken, true),
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const err = new Error(await parseError(res));
      err.status = res.status;
      throw err;
    }

    return res.json().catch(() => null);
  }

  async function uploadImages(chatUuid, files, sessionToken) {
    const formData = new FormData();
    for (const file of files) {
      formData.append("images", file);
    }

    const res = await fetch(buildUrl(`/api/v1/public/chats/${encodeURIComponent(chatUuid)}/fotos/`), {
      method: "POST",
      headers: buildHeaders(sessionToken, false),
      body: formData,
    });

    if (!res.ok) {
      const err = new Error(await parseError(res));
      err.status = res.status;
      throw err;
    }

    return res.json();
  }

  async function pollChat(chatUuid, sessionToken, since) {
    let path = `/api/v1/public/chats/${encodeURIComponent(chatUuid)}/poll/`;
    if (since !== null && since !== undefined && since !== "") {
      path += `?since=${encodeURIComponent(String(since))}`;
    }

    const res = await fetch(buildUrl(path), {
      method: "GET",
      headers: buildHeaders(sessionToken, false),
    });

    if (!res.ok) {
      const err = new Error(await parseError(res));
      err.status = res.status;
      throw err;
    }

    return res.json();
  }

  async function requestIntervention(chatUuid, sessionToken) {
    const res = await fetch(buildUrl(`/api/v1/public/chats/${encodeURIComponent(chatUuid)}/request_intervention/`), {
      method: "POST",
      headers: buildHeaders(sessionToken, false),
    });

    if (!res.ok) {
      const err = new Error(await parseError(res));
      err.status = res.status;
      throw err;
    }

    return res.json().catch(() => null);
  }

  async function closeChat(chatUuid, sessionToken) {
    const res = await fetch(buildUrl(`/api/v1/public/chats/${encodeURIComponent(chatUuid)}/close/`), {
      method: "POST",
      headers: buildHeaders(sessionToken, false),
    });

    if (!res.ok) {
      const err = new Error(await parseError(res));
      err.status = res.status;
      throw err;
    }

    return res.json().catch(() => ({ success: true }));
  }

  async function getStatus(chatUuid, sessionToken) {
    const res = await fetch(buildUrl(`/api/v1/public/chats/${encodeURIComponent(chatUuid)}/status/`), {
      method: "GET",
      headers: buildHeaders(sessionToken, false),
    });

    if (!res.ok) {
      const err = new Error(await parseError(res));
      err.status = res.status;
      throw err;
    }

    return res.json();
  }

  return { createChat, sendMessage, uploadImages, pollChat, requestIntervention, closeChat, getStatus };
})();
