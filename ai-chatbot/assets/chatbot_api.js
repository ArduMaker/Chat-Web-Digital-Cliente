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

  async function parseError(res) {
    try {
      const body = await res.json();
      return body?.detail || body?.message || `HTTP ${res.status}`;
    } catch {
      return `HTTP ${res.status}`;
    }
  }

  async function createChat(customerName, customerEmail, fingerprint) {
    if (createChatInFlight) return createChatInFlight;

    createChatInFlight = (async () => {
      const res = await fetch(buildUrl('/api/v1/public/chats/init/'), {
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

  function buildHeaders(sessionToken, hasJsonBody) {
    const headers = {};
    if (hasJsonBody) headers["Content-Type"] = "application/json";
    if (sessionToken) headers[SESSION_HEADER] = sessionToken;
    return headers;
  }

  async function getChat(chatUuid, sessionToken) {
    const res = await fetch(buildUrl(`/api/v1/public/chats/${encodeURIComponent(chatUuid)}/`), {
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

  async function sendMessage(chatUuid, customerName, text, sessionToken) {
    const res = await fetch(buildUrl(`/api/v1/public/chats/${encodeURIComponent(chatUuid)}/messages/`), {
      method: "POST",
      headers: buildHeaders(sessionToken, true),
      body: JSON.stringify({
        sender: "customer",
        senderName: customerName,
        message: text,
        read: false,
      }),
    });
    if (!res.ok) throw new Error(await parseError(res));
    return res.json().catch(() => null);
  }

  async function requestIntervention(chatUuid, customerName, sessionToken) {
    const res = await fetch(buildUrl(`/api/v1/public/chats/${encodeURIComponent(chatUuid)}/request_intervention/`), {
      method: "POST",
      headers: buildHeaders(sessionToken, true),
      body: JSON.stringify({
        reason: `Intervención solicitada por ${customerName || "Cliente"}`,
      }),
    });
    if (!res.ok) throw new Error(await parseError(res));
    return res.json().catch(() => null);
  }

  async function closeChat(chatUuid, sessionToken) {
    const res = await fetch(buildUrl(`/api/v1/public/chats/${encodeURIComponent(chatUuid)}/close/`), {
      method: "POST",
      headers: buildHeaders(sessionToken, true),
      body: JSON.stringify({}),
    });
    // Public API may not expose /close/. In that case, allow local close without surfacing an error.
    if (!res.ok) {
      if (res.status === 404) {
        return { ok: true, localOnly: true };
      }
      throw new Error(await parseError(res));
    }
    return res.json().catch(() => null);
  }

  function streamUrl(chatUuid) {
    return buildUrl(`/api/v1/public/chats/${encodeURIComponent(chatUuid)}/events/`);
  }

  async function uploadImages(chatUuid, files, sessionToken) {
    const formData = new FormData();
    for (const file of files) {
      formData.append('images', file);
    }
    const res = await fetch(buildUrl(`/api/v1/public/chats/${encodeURIComponent(chatUuid)}/fotos/`), {
      method: 'POST',
      headers: buildHeaders(sessionToken, false),
      body: formData
    });
    if (!res.ok) {
      const err = new Error(await parseError(res));
      err.status = res.status;
      throw err;
    }
    return res.json();
  }

  function pollUrl(chatUuid) {
    return buildUrl(`/api/v1/public/chats/${encodeURIComponent(chatUuid)}/poll/`);
  }

  async function pollChat(chatUuid, sessionToken, since) {
    let url = buildUrl(`/api/v1/public/chats/${encodeURIComponent(chatUuid)}/poll/`);
    if (since) {
      url += `?since=${encodeURIComponent(since)}`;
    }
    const res = await fetch(url, {
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

  return { createChat, getChat, sendMessage, requestIntervention, closeChat, streamUrl, uploadImages, pollUrl, pollChat, getStatus };
})();
