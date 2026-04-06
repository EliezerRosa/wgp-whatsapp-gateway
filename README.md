# WGP WhatsApp Gateway v1.0

**WhatsApp Gateway Protocol — JSON I/O, self-contained, sem cartão de crédito**

Conecta qualquer app ao WhatsApp (individual, grupos, broadcast) via API REST com JSON padronizado.

---

## Stack

- **Runtime:** Node.js ≥ 18
- **WhatsApp:** [@whiskeysockets/baileys](https://github.com/WhiskeySockets/Baileys) (protocolo WhatsApp Web)
- **HTTP:** Express.js
- **Deploy:** Render free tier (sem cartão)

---

## Deploy no Render (3 passos, gratuito)

### 1. Fork no GitHub
```
github.com/SEU_USUARIO/wgp-whatsapp-gateway
```

### 2. Criar Web Service no Render
- render.com → New → Web Service → Connect GitHub
- Selecionar o fork
- Plan: **Free**
- Build: `npm install`
- Start: `npm start`
- Adicionar env var: `WGP_API_KEY` = sua chave secreta

### 3. Escanear QR Code
Acesse `https://seu-app.onrender.com/qr` e escaneie no WhatsApp.

---

## Rodar localmente

```bash
git clone <repo>
cd wgp-whatsapp-gateway
npm install

# Configurar (opcional)
export WGP_API_KEY=minha-chave-secreta
export WGP_WEBHOOK_URL=https://meu-backend.com/webhook

npm start
# Abrir http://localhost:3000
```

---

## Variáveis de ambiente

| Variável | Padrão | Descrição |
|---|---|---|
| `WGP_API_KEY` | `wgp-secret-key` | Chave de autenticação da API |
| `WGP_WEBHOOK_URL` | — | URL para receber mensagens em tempo real |
| `PORT` | `3000` | Porta HTTP |

---

## API — Endpoints

### `POST /wgp` — Endpoint principal WGP
```
Header: apikey: SUA_CHAVE
Content-Type: application/json
```

### `GET /status` — Status da conexão (público)
### `GET /qr` — QR Code para conectar (público)
### `GET /messages?limit=50` — Mensagens recebidas
### `POST /webhook` — Configurar URL de webhook
### `POST /send` — Atalho enviar texto
### `POST /send/media` — Atalho enviar mídia
### `POST /group/create` — Atalho criar grupo
### `POST /broadcast` — Atalho broadcast
### `GET /` — Painel web

---

## Formato WGP — Input

```json
{
  "wgp_version": "1.0",
  "action": "send_message",
  "channel": "individual",
  "to": "5511999998888",
  "payload": {
    "text": "Olá mundo!"
  },
  "options": {
    "reply_to": "wamid.abc123"
  }
}
```

## Formato WGP — Output (sucesso)

```json
{
  "wgp_version": "1.0",
  "status": "success",
  "http_code": 200,
  "action": "send_message",
  "channel": "individual",
  "timestamp": "2026-04-06T10:00:00Z",
  "to": "5511999998888",
  "data": { "message_id": "wamid.xyz" },
  "meta": { "api": "wgp_baileys", "latency_ms": 234 }
}
```

---

## Actions disponíveis

| Action | Campos obrigatórios |
|---|---|
| `send_message` | `channel`, `to`, `payload.text` |
| `send_media` | `channel`, `to`, `payload.media_type`, `payload.url` |
| `send_reaction` | `channel`, `to`, `payload.emoji`, `payload.message_id` |
| `create_group` | `payload.name`, `payload.members[]` |
| `update_group` | `to` (group_id) |
| `add_member` | `to`, `payload.members[]` |
| `remove_member` | `to`, `payload.members[]` |
| `promote_admin` | `to`, `payload.members[]` |
| `demote_admin` | `to`, `payload.members[]` |
| `leave_group` | `to` |
| `get_group_info` | `to` |
| `broadcast_send` | `payload.recipients[]`, `payload.text` ou `payload.url` |
| `mark_read` | `to`, `payload.message_ids[]` |
| `get_status` | — |
| `get_messages` | — |

---

## Exemplos de uso

### Python
```python
import requests

BASE = "https://seu-app.onrender.com"
KEY  = "sua-api-key"

def wgp(action, **kwargs):
    return requests.post(
        f"{BASE}/wgp",
        headers={"apikey": KEY},
        json={"action": action, **kwargs}
    ).json()

# Enviar texto
wgp("send_message", channel="individual", to="5511999998888",
    payload={"text": "Olá!"})

# Criar grupo
wgp("create_group", channel="group",
    payload={"name": "Equipe", "members": ["5511999990001"]})

# Broadcast
wgp("broadcast_send", channel="broadcast",
    payload={"text": "Promoção!", "recipients": ["5511999990001","5511999990002"]})
```

### JavaScript / Node.js
```javascript
const axios = require('axios')

const wgp = (action, data) => axios.post(
  'https://seu-app.onrender.com/wgp',
  { action, ...data },
  { headers: { apikey: 'sua-api-key' } }
).then(r => r.data)

await wgp('send_message', {
  channel: 'individual',
  to: '5511999998888',
  payload: { text: 'Olá via Node!' }
})
```

### cURL
```bash
curl -X POST https://seu-app.onrender.com/wgp \
  -H "apikey: sua-api-key" \
  -H "Content-Type: application/json" \
  -d '{"action":"send_message","channel":"individual","to":"5511999998888","payload":{"text":"Olá!"}}'
```

---

## Webhook — receber mensagens

Configure um endpoint POST no seu backend e registre:

```bash
curl -X POST https://seu-app.onrender.com/webhook \
  -H "apikey: sua-api-key" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://seu-backend.com/whatsapp-in"}'
```

Payload que seu backend receberá:
```json
{
  "wgp_version": "1.0",
  "action": "webhook_receive",
  "channel": "individual",
  "from": "5511999998888",
  "message_id": "wamid.xyz",
  "timestamp": "2026-04-06T10:01:00Z",
  "type": "text",
  "payload": { "text": "Olá!" },
  "context": { "group_id": null, "reply_to": null, "push_name": "João" }
}
```

---

## Manter acordado no Render free (UptimeRobot)

1. Criar conta gratuita em **uptimerobot.com**
2. New Monitor → HTTP(s) → URL: `https://seu-app.onrender.com/status`
3. Interval: 5 minutes

---

## ⚠️ Avisos importantes

- **Não-oficial:** usa o protocolo WhatsApp Web (Baileys). Viola os ToS do WhatsApp.
- **Risco de ban:** não envie spam. Use delays de 2-3s entre mensagens em massa.
- **Sessão perdida:** no Render free, o serviço reinicia ocasionalmente — você precisará re-escanear o QR.
- **Produção real:** para uso comercial, use a [Meta Cloud API oficial](https://developers.facebook.com/docs/whatsapp).

---

## Licença

MIT — use livremente, sem garantias.
