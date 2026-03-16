// chatbot.js — Mock Chatbot Widget (Shadcn-inspired)
console.log("CHATBOT NOVO CARREGADO MARIO", Date.now());

// chatbot.js — Mock Chatbot Widget (Shadcn-inspired)
(function () {
  const CONFIG = {
    title: "Asistente digital",
    subtitle: "Soporte instantáneo",
    welcomeMessage: "Hola! 👋 ¿Cómo puedo ayudarte hoy?",
    position: "right",
    primaryColor: "#182054",
    accentColor: "#FF8057", // botão e destaques
    responses: {
      default: "Gracias por tu mensaje. Un agente responderá en breve. 😊",
      hours: "Estamos abiertos de lunes a viernes, de 9:00 a 18:00.",
      pricing: "Nuestros planes empiezan en 19 €/mes. ¿Quieres que te envíe los detalles?",
      support: "¿Puedes describir mejor tu problema para que lo derive a soporte?",
      hello: "Hola! 👋 ¿En qué puedo ayudarte?",
    },
  };


  // Ícone SVG similar ao fornecido (customer service)
  const ICON_SVG = `<svg fill="#FFFFFF" height="191px" width="191px" version="1.1" id="Layer_1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="-188.46 -188.46 836.59 836.59" xml:space="preserve"><g id="SVGRepo_bgCarrier" stroke-width="0" transform="translate(0,0), scale(1)"></g><g id="SVGRepo_tracerCarrier" stroke-linecap="round" stroke-linejoin="round" stroke="#CCCCCC" stroke-width="0.919336"></g><g id="SVGRepo_iconCarrier"> <g id="XMLID_2_"> <g> <g> <path d="M359.574,297.043c-18.204,25.002-47.692,41.286-80.916,41.286h-46.618c-16.104,0-29.818-10.224-35.011-24.534 c-6.41-1.912-12.696-4.394-18.83-7.442c-12.99-6.454-24.785-15.198-35.168-26.03c-67.35,14.796-117.757,74.808-117.757,146.603 v9.384c0,12.9,10.458,23.358,23.358,23.358h362.403c12.9,0,23.358-10.458,23.358-23.358v-9.384 C434.392,371.464,404.309,323.032,359.574,297.043z"></path> <path d="M118.205,232.178c10.039,0,18.777-5.564,23.304-13.775c0.119,0.325,0.24,0.648,0.362,0.971 c0.036,0.097,0.072,0.194,0.108,0.291c10.62,27.954,31.284,51.388,58.532,61.627c6.59-10.471,18.243-17.435,31.53-17.435h46.618 c4.65,0,8.978-1.312,12.772-3.433c6.372-3.563,12.102-12.602,15.061-17.393c4.735-7.667,8.404-15.788,11.657-24.642 c1.828,3.32,4.342,6.208,7.354,8.471v11.431c0,25.83-21.014,46.845-46.845,46.845H232.04c-8.813,0-15.958,7.145-15.958,15.958 c0,8.814,7.145,15.958,15.958,15.958h46.618c43.429,0,78.761-35.332,78.761-78.761V226.86 c6.46-4.853,10.639-12.577,10.639-21.278v-48.119v-18.452c0-8.88-4.355-16.737-11.042-21.568C351.83,51.816,296.77,0,229.833,0 C162.895,0,107.836,51.816,102.65,117.442c-6.687,4.831-11.042,12.689-11.042,21.568v66.57 C91.608,220.311,103.575,232.178,118.205,232.178z M229.833,31.917c49.552,0,90.423,37.868,95.2,86.185 c-3.136,2.467-5.705,5.62-7.475,9.238c-15.058-39.286-48.672-66.638-87.726-66.638c-39.896,0-72.971,28.292-87.667,66.481 c-0.02,0.052-0.039,0.105-0.059,0.158c-1.77-3.618-4.339-6.771-7.475-9.238C139.411,69.785,180.281,31.917,229.833,31.917z"></path>
  </g> </g> </g> </g></svg>`;

  // Inline styles to avoid theme conflicts (no global CSS)
  const BUTTON_STYLE = `
  position:fixed;${CONFIG.position}:24px;bottom:24px;
  width:60px;height:60px;min-width:60px;min-height:60px;
  border-radius:50%;
  background:#2563eb;
  color:white;
  border:0 !important;
  padding:0 !important;
  margin:0 !important;
  box-sizing:content-box;
  cursor:pointer;
  display:flex;
  align-items:center;
  justify-content:center;
  line-height:60px;
  z-index:999999;
  transition:background-color .2s ease, transform .2s ease;
  user-select:none;
  appearance:none;
  outline:none; `;
 
  const PANEL_STYLE = `
    width:360px;max-height:520px;background:white;border-radius:16px;box-shadow:0 20px 40px rgba(0,0,0,.2);
    overflow:hidden;display:none;flex-direction:column;
  `;
  const ROOT_STYLE = `position:fixed;${CONFIG.position}:24px;bottom:24px;z-index:999999;font-family:Inter,system-ui,Segoe UI,Roboto,Helvetica,Arial,sans-serif;`;

  // Minimal scoped CSS only for message bubbles
  // Minimal scoped CSS only for message bubbles + button animations
  const css = `
  .cb-btn:hover{transform:scale(1.06)}
  .cb-btn.pulse{animation:cb-pulse 1.8s infinite}
  @keyframes cb-pulse{0%{box-shadow:0 0 0 0 rgba(255,128,87,.6)}70%{box-shadow:0 0 0 18px rgba(255,128,87,0)}100%{box-shadow:0 0 0 0 rgba(255,128,87,0)}}
  .cb-body{padding:12px;flex:1;overflow-y:auto;background:#f8fafc}
  .cb-msg{max-width:80%;padding:10px 12px;border-radius:12px;margin:6px 0;font-size:14px;line-height:1.4}
  .cb-user{margin-left:auto;background:${CONFIG.accentColor};color:white;border-bottom-right-radius:4px}
  .cb-bot{margin-right:auto;background:white;border:1px solid #e5e7eb;color:#0f172a;border-bottom-left-radius:4px}
  .cb-header{background:${CONFIG.primaryColor};color:white;padding:14px 16px}
  .cb-footer{padding:10px;border-top:1px solid #e5e7eb;display:flex;gap:8px;background:white}
  .cb-input{flex:1;border:1px solid #e5e7eb;border-radius:9999px;padding:8px 12px;font-size:14px;outline:none}
  .cb-send{border:none;border-radius:9999px;padding:8px 14px;background:${CONFIG.accentColor};color:white !important;cursor:pointer}
  `;

  const style = document.createElement("style");
  style.innerHTML = css;
  document.head.appendChild(style);

    const root = document.createElement("div");
  root.className = "cb-root";
  root.setAttribute("style", ROOT_STYLE);
    root.innerHTML = `
    <button class="cb-btn" aria-label="Abrir chat" style="${BUTTON_STYLE}">${ICON_SVG}</button>
    <div class="cb-panel" style="${PANEL_STYLE}">
      <div class="cb-header" style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
        <div>
          <div class="cb-title">${CONFIG.title}</div>
          <div class="cb-sub">${CONFIG.subtitle}</div>
        </div>
        <button class="cb-close" aria-label="Cerrar chat" style="border:0;background:transparent;color:white;font-size:18px;cursor:pointer;padding:6px;line-height:1;">✕</button>
      </div>
      <div class="cb-body"></div>
      <div class="cb-footer">
        <input class="cb-input" placeholder="Escribe tu mensaje..." />
        <button class="cb-send">Enviar</button>
      </div>
    </div>
  `;

  document.body.appendChild(root);

      const btn = root.querySelector(".cb-btn");
  const panel = root.querySelector(".cb-panel");
  const body = root.querySelector(".cb-body");
  const input = root.querySelector(".cb-input");
  const send = root.querySelector(".cb-send");
  const closeBtn = root.querySelector(".cb-close");

  // start with a gentle pulse to attract attention
  btn.classList.add('pulse');

      btn.onclick = () => {
    btn.classList.remove('pulse');
    btn.style.display = 'none';
    panel.style.display = 'flex';
    if (body.children.length === 0) botMessage(CONFIG.welcomeMessage);
  };

  closeBtn.onclick = () => {
    panel.style.display = 'none';
    btn.style.display = 'flex';
  };

  function userMessage(text) {
    const div = document.createElement("div");
    div.className = "cb-msg cb-user";
    div.textContent = text;
    body.appendChild(div);
    body.scrollTop = body.scrollHeight;
  }

  function botMessage(text) {
    const div = document.createElement("div");
    div.className = "cb-msg cb-bot";
    div.textContent = text;
    body.appendChild(div);
    body.scrollTop = body.scrollHeight;
  }

  function mockReply(text) {
    const t = text.toLowerCase();
    if (t.includes("hora") || t.includes("abierto")) return CONFIG.responses.hours;
    if (t.includes("precio") || t.includes("plan")) return CONFIG.responses.pricing;
    if (t.includes("soporte") || t.includes("error") || t.includes("problema")) return CONFIG.responses.support;
    if (t.includes("ola") || t.includes("olá") || t.includes("hello")) return CONFIG.responses.hello;
    return CONFIG.responses.default;
  }

  function sendMsg() {
    const text = input.value.trim();
    if (!text) return;
    userMessage(text);
    input.value = "";
    setTimeout(() => botMessage(mockReply(text)), 600);
  }

  send.onclick = sendMsg;
  input.addEventListener("keydown", (e) => e.key === "Enter" && sendMsg());
})();
