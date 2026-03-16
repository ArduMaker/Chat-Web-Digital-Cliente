# API de Chat Público

Este documento explica cómo funciona el chat público (anónimo) para integración con widgets en WordPress.

---

## 📋 Resumen General

El chat público permite que visitantes sin cuenta hablen con el bot o vendedores en tiempo real. 

**Flujo típico:**  
1. **`/init`** → Crear sesión de chat  
2. **`/poll` (cada 4 segundos)** → Obtener nuevos mensajes  
3. **`/messages`** → Enviar mensaje de cliente  
4. **`/fotos`** → Subir imágenes (opcional)  

---

## 🔐 Autenticación

- **Sin usuario:** El chat es completamente anónimo.
- **Token de sesión:** Se usa un header `X-Session-Token` (no un JWT).
  - Se obtiene de `/init` en el campo `session_token`.
  - Expira en **1 hora**.
  - Se requiere para todas las operaciones excepto `/init`.

**Formato:**
```
X-Session-Token: <token-string>
```

---

## 📡 Endpoints

### 1. **POST** `/api/v1/public/chats/init/`

#### ¿Qué hace?  
Comienza una sesión de chat. Genera un UUID único y un token de sesión.

#### Qué necesita (Body JSON):
```json
{
  "fingerprint": "fp-1773017168238-v8s2xh0gio",
  "customerName": "Juan Pérez",
  "customerEmail": "juan@example.com"
}
```

| Campo | Tipo | Requerido | Descripción |
|-------|------|-----------|-------------|
| `fingerprint` | string | ✅ | Identificador único del navegador (para rate limiting) |
| `customerName` | string | ✅ | Nombre visible en el chat |
| `customerEmail` | string | ❌ | Email del cliente |

#### Qué devuelve (HTTP 201):
```json
{
  "uuid": "c536f9a0-d8fb-4e6e-bd4f-9cc988550083",
  "session_token": "token-muy-largo-aqui",
  "expires_at": "2026-03-17T00:00:00+00:00"
}
```

#### Usar después:  
- Guardar `uuid` y `session_token` en el cliente.
- Enviar `session_token` en el header `X-Session-Token` de las siguientes peticiones.

---

### 2. **GET** `/api/v1/public/chats/{uuid}/poll/`

#### ¿Qué hace?  
Obtiene nuevos mensajes desde una hora específica. **Llamar cada 4 segundos.**

#### Headers requeridos:
```
X-Session-Token: <token-string>
```

#### Parámetros (Query):
```
?since=1773696949502
```

| Parámetro | Tipo | Significado |
|-----------|------|-------------|
| `since` | Unix timestamp (ms) | Timestamp del último sondeo. Si no hay cambios después de este tiempo, devuelve `has_new: false` |

#### Qué devuelve (HTTP 200):
```json
{
  "has_new": true,
  "messages": [
    {
      "id": 532,
      "sender": "customer",
      "senderName": "Juan Pérez",
      "message": "Hola, estoy buscando una pantalla",
      "sentAt": "2026-03-16T22:21:23.542913+01:00",
      "read": true,
      "images": []
    },
    {
      "id": 533,
      "sender": "bot",
      "senderName": "DigitalMTX AI",
      "message": "Hola, puedo ayudarte a encontrar...",
      "sentAt": "2026-03-16T22:22:09.138891+01:00",
      "read": true,
      "images": [
        {
          "id": 101,
          "image": "chats/2025-03-16/pantalla.jpg",
          "uploadedAt": "2026-03-16T22:22:05.123456+01:00",
          "url": "https://api.digitalmtx.com/media/chats/2025-03-16/pantalla.jpg"
        }
      ]
    }
  ],
  "images": [
    {
      "id": 101,
      "image": "chats/2025-03-16/pantalla.jpg",
      "uploadedAt": "2026-03-16T22:22:05.123456+01:00",
      "url": "https://api.digitalmtx.com/media/chats/2025-03-16/pantalla.jpg"
    }
  ],
  "chat_status": {
    "status": "active",
    "responder": "bot",
    "humanRequested": false
  },
  "ai_status": {
    "current_status_step": "completed",
    "current_status_message": "",
    "is_processing": false
  },
  "server_time": 1773696949502
}
```

#### Interpretar respuesta:
- **`has_new: true`** → Hay mensajes o imágenes nuevos.
- **`has_new: false`** → No hay nada nuevo, array vacío.
- **`messages`** → Array de mensajes (cada uno puede incluir imágenes anidadas en `images`).
- **`images`** → Array de TODAS las imágenes del chat (acceso directo sin iterar mensajes).
- **`responder`** → Quién está respondiendo: `"bot"` o `"seller"`.
- **`is_processing`** → `true` si el bot está procesando (muestra "escribiendo...").
- **`server_time`** → Usar este valor en el siguiente `?since=` del polling.

#### Lógica de polling en frontend:
```javascript
let lastServerTime = null;

async function pollMessages() {
  const url = `/api/v1/public/chats/${chatUuid}/poll/`;
  const queryString = lastServerTime ? `?since=${lastServerTime}` : '';
  
  const response = await fetch(url + queryString, {
    headers: {
      'X-Session-Token': sessionToken
    }
  });
  
  const data = await response.json();
  
  // Si hay mensajes nuevos, mostrar
  if (data.has_new) {
    data.messages.forEach(msg => {
      console.log(`${msg.senderName}: ${msg.message}`);
      displayMessage(msg);
      
      // Mostrar imágenes anidadas del mensaje
      if (msg.images && msg.images.length > 0) {
        msg.images.forEach(img => {
          displayImageInMessage(msg.id, img);
        });
      }
    });
    
    // Alternativa: acceder a TODAS las imágenes del chat
    if (data.images && data.images.length > 0) {
      data.images.forEach(img => {
        console.log(`Imagen: ${img.url}`);
      });
    }
  }
  
  // Actualizar timestamp para el siguiente poll
  lastServerTime = data.server_time;
  
  // Mostrar spinner si el bot está procesando
  if (data.ai_status.is_processing) {
    showTypingIndicator();
  } else {
    hideTypingIndicator();
  }
  
  // Llamar de nuevo en 4 segundos
  setTimeout(pollMessages, 4000);
}

// Iniciar polling
pollMessages();
```

---

### 3. **POST** `/api/v1/public/chats/{uuid}/messages/`

#### ¿Qué hace?  
Envía un mensaje de cliente al chat. Si el responder es `"bot"`, se dispara automáticamente la IA.

#### Headers requeridos:
```
X-Session-Token: <token-string>
Content-Type: application/json
```

#### Body JSON:
```json
{
  "sender": "customer",
  "senderName": "Juan Pérez",
  "message": "Hola, ¿tienes pantallas disponibles?"
}
```

| Campo | Tipo | Requerido | Notas |
|-------|------|-----------|-------|
| `sender` | string | ✅ | Siempre `"customer"` desde el widget |
| `senderName` | string | ❌ | Nombre visible (suele ignorarse, usa customerName del /init) |
| `message` | string | ✅ | Texto del mensaje |

#### Qué devuelve (HTTP 201):
```json
{
  "id": 532,
  "sender": "customer",
  "senderName": "Juan Pérez",
  "message": "Hola, ¿tienes pantallas disponibles?",
  "sentAt": "2026-03-16T22:21:23.542913+01:00",
  "read": false
}
```

#### Después de enviar:
- El cliente debe continuar haciendo polling para recibir la respuesta del bot.
- Si el bot estaba idle, recibirá el mensaje y responderá.
- La respuesta llegará en el siguiente polling (generalmente en < 5 segundos).

---

### 4. **POST** `/api/v1/public/chats/{uuid}/fotos/`

#### ¿Qué hace?  
Sube imágenes al chat para que el bot las analice (ej: foto de una laptop dañada).

#### Headers requeridos:
```
X-Session-Token: <token-string>
Content-Type: multipart/form-data
```

#### Body (multipart/form-data):
```
images: [archivo1.jpg, archivo2.png, ...]
```

| Límites | Valor |
|---------|-------|
| Máximo de imágenes por petición | 5 |
| Máximo de tamaño por imagen | 10 MB |
| Formatos permitidos | JPEG, PNG, WebP, GIF |

#### Qué devuelve (HTTP 200):
```json
{
  "success": true,
  "images": [
    {
      "id": 123,
      "image": "/media/chat_images/2026/03/16/abc123.jpg",
      "uploadedAt": "2026-03-16T22:21:00+00:00",
      "url": "https://apidigitalmtx.arducloud.com/media/chat_images/2026/03/16/abc123.jpg"
    }
  ],
  "message": "Uploaded 1 images"
}
```

#### Después de subir:
- Las imágenes quedan vinculadas al chat.
- El bot las analizará en el siguiente polling (si el responder es `"bot"`).
- El cliente puede seguir recibiendo updates en los siguientes polls.

---

### 5. **POST** `/api/v1/public/chats/{uuid}/request_intervention/`

#### ¿Qué hace?  
Solicita hablar con un vendedor (humano). El bot pasará el chat a cola de vendedores.

#### Headers requeridos:
```
X-Session-Token: <token-string>
```

#### Body:
```
(vacío)
```

#### Qué devuelve (HTTP 200):
```json
{
  "success": true,
  "chat": {
    "uuid": "c536f9a0-d8fb-4e6e-bd4f-9cc988550083",
    "customerName": "Juan Pérez",
    "status": "active",
    "lastMessageAt": "2026-03-16T22:29:50.304079+01:00",
    "humanRequested": true,
    "messages": [...]
  }
}
```

#### Después:
- El flag `humanRequested` pasa a `true`.
- Un vendedor será notificado en dashboard.
- El responder típicamente cambiará a `"seller"` cuando uno se asigne.
- En el siguiente poll verás `"responder": "seller"`.

---

### 6. **POST** `/api/v1/public/chats/{uuid}/close/`

#### ¿Qué hace?  
Cierra la sesión del chat.

#### Headers requeridos:
```
X-Session-Token: <token-string>
```

#### Body:
```
(vacío)
```

#### Qué devuelve (HTTP 200):
```json
{
  "success": true,
  "message": "Chat closed successfully."
}
```

#### Después:
- El chat entra en estado `"closed"`.
- Ya no se pueden enviar mensajes.
- Se detiene el polling automáticamente en el frontend.

---

### 7. **GET** `/api/v1/public/chats/{uuid}/status/`

#### ¿Qué hace?  
Obtiene el estado actual del procesamiento de la IA (sin esperar nuevos mensajes).

#### Headers requeridos:
```
X-Session-Token: <token-string>
```

#### Qué devuelve (HTTP 200):
```json
{
  "chat_id": 123,
  "current_status_step": "analyzing_image",
  "current_status_message": "Analizando la imagen del dispositivo...",
  "is_processing": true
}
```

---

## 🔄 Flujo Completo - Ejemplo en JavaScript

```javascript
// ========== 1. INICIAR CHAT ==========
async function initChat() {
  const fingerprint = "fp-" + Date.now() + "-v8s2xh0gio";
  
  const response = await fetch('/api/v1/public/chats/init/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fingerprint,
      customerName: "Juan Pérez",
      customerEmail: "juan@example.com"
    })
  });
  
  const data = await response.json();
  
  // Guardar para futuras peticiones
  window.chatUuid = data.uuid;
  window.sessionToken = data.session_token;
  
  console.log('Chat iniciado:', data.uuid);
  
  // Iniciar polling
  startPolling();
}

// ========== 2. POLLING CONTINUO ==========
let lastServerTime = null;

async function pollMessages() {
  const url = `/api/v1/public/chats/${window.chatUuid}/poll/`;
  const queryString = lastServerTime ? `?since=${lastServerTime}` : '';
  
  try {
    const response = await fetch(url + queryString, {
      headers: { 'X-Session-Token': window.sessionToken }
    });
    
    const data = await response.json();
    
    if (data.has_new) {
      data.messages.forEach(msg => {
        displayMessage(msg);
      });
    }
    
    lastServerTime = data.server_time;
    
    // Mostrar typing si el bot procesa
    if (data.ai_status.is_processing) {
      showTypingIndicator();
    } else {
      hideTypingIndicator();
    }
    
  } catch (error) {
    console.error('Error polling:', error);
  }
}

function startPolling() {
  // Poll cada 4 segundos
  setInterval(pollMessages, 4000);
  // Poll inmediatamente también
  pollMessages();
}

// ========== 3. ENVIAR MENSAJE ==========
async function sendMessage(text) {
  const response = await fetch(
    `/api/v1/public/chats/${window.chatUuid}/messages/`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Session-Token': window.sessionToken
      },
      body: JSON.stringify({
        sender: 'customer',
        message: text
      })
    }
  );
  
  const msg = await response.json();
  displayMessage(msg);
}

// ========== 4. SUBIR IMÁGENES (OPCIONAL) ==========
async function uploadImages(files) {
  const formData = new FormData();
  
  Array.from(files).slice(0, 5).forEach(file => {
    formData.append('images', file);
  });
  
  const response = await fetch(
    `/api/v1/public/chats/${window.chatUuid}/fotos/`,
    {
      method: 'POST',
      headers: {
        'X-Session-Token': window.sessionToken
      },
      body: formData
    }
  );
  
  const result = await response.json();
  console.log('Imágenes subidas:', result.images.length);
}

// ========== 5. SOLICITAR VENDEDOR ==========
async function requestVendor() {
  const response = await fetch(
    `/api/v1/public/chats/${window.chatUuid}/request_intervention/`,
    {
      method: 'POST',
      headers: { 'X-Session-Token': window.sessionToken }
    }
  );
  
  const data = await response.json();
  console.log('Vendedor solicitado:', data.success);
}

// ========== 6. CERRAR CHAT ==========
async function closeChat() {
  const response = await fetch(
    `/api/v1/public/chats/${window.chatUuid}/close/`,
    {
      method: 'POST',
      headers: { 'X-Session-Token': window.sessionToken }
    }
  );
  
  console.log('Chat cerrado');
}

// Iniciar cuando se carga
initChat();
```

---

## 🐛 Troubleshooting

### El polling tarda mucho en recibir respuestas
- La IA processa de 2-10 segundos.
- Mientras procesa, `is_processing` será `true`.
- El cliente debe mostrar "escribiendo..." cuando ve esto.

### "Missing session token" error (HTTP 401)
- Asegúrate de incluir el header `X-Session-Token`.
- Verificar que el token aún sea válido (expira en 1 hora).

### "Session not authorized for this chat" (HTTP 403)
- El token no pertenece a este UUID.
- Verificar que estés usando el mismo token y UUID de `/init`.

### "Chat not found" (HTTP 404)
- El UUID es inválido.
- Verificar que el chat exista en la BD.

---

## 📊 Estados del Chat

| Estado | Significado |
|--------|-----------|
| `pending` | Acaba de crearse, esperando primer mensaje |
| `active` | El chat tiene mensajes, está en conversación |
| `closed` | El cliente cerró el chat, no se puede reabrir |

## 📊 Responder Actual

| Valor | Significado |
|-------|-----------|
| `bot` | El IA está respondiendo automáticamente |
| `seller` | Un vendedor humano está respondiendo |

---

## 🚀 Notas Finales

- **Cada 4 segundos:** Hacer poll sin parar.
- **Usar `server_time`:** Del response anterior como `?since=` del siguiente.
- **Handling offline:** Si el fetch falla, reintentar con backoff.
- **Cerrar polling:** Cuando el usuario cierre el widget o el chat.
- **Timeout de sesión:** Si token expira (401), reintentar `/init`.
