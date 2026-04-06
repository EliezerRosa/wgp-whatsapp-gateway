/**
 * WGP WhatsApp Gateway — Servidor HTTP
 * POST /wgp        → executa qualquer action WGP
 * GET  /status     → estado da conexão
 * GET  /qr         → QR Code (HTML ou JSON)
 * GET  /messages   → mensagens recebidas
 * POST /webhook    → configura URL de webhook
 * GET  /           → painel web
 */

const express = require('express')
const path    = require('path')
const wgp     = require('./wgp')
const wa      = require('./whatsapp')

const app  = express()
const PORT = process.env.PORT || 3000
const API_KEY = process.env.WGP_API_KEY || 'wgp-secret-key'

app.use(express.json({ limit: '10mb' }))
app.use(express.static(path.join(__dirname, '../public')))

// ── Middleware de autenticação ───────────────────────────────────
function auth(req, res, next) {
  // Rotas públicas
  if (['/', '/status', '/qr'].includes(req.path)) return next()
  const key = req.headers['apikey'] || req.headers['x-api-key'] || req.query.apikey
  if (key !== API_KEY) {
    return res.status(401).json({
      wgp_version: '1.0', status: 'error', http_code: 401,
      error: { message: 'API key inválida', type: 'UNAUTHORIZED', recoverable: false },
    })
  }
  next()
}
app.use(auth)

// ── POST /wgp — endpoint principal ──────────────────────────────
app.post('/wgp', async (req, res) => {
  const output = await wgp.execute(req.body)
  res.status(output.http_code).json(output)
})

// ── GET /status ──────────────────────────────────────────────────
app.get('/status', (req, res) => {
  const s = wa.getState()
  res.json({
    wgp_version: '1.0',
    status:      s.status,
    phone:       s.phone,
    name:        s.name,
    qr_ready:    s.status === 'qr_ready',
    started_at:  s.startedAt,
    reconnects:  s.reconnects,
    uptime_sec:  Math.floor(process.uptime()),
    node_version: process.version,
  })
})

// ── GET /qr — retorna QR code ────────────────────────────────────
app.get('/qr', (req, res) => {
  const s = wa.getState()
  if (s.status === 'connected') {
    return req.query.json
      ? res.json({ status: 'already_connected', phone: s.phone })
      : res.redirect('/')
  }
  if (s.status !== 'qr_ready' || !s.qrBase64) {
    if (req.query.json) {
      return res.json({ status: s.status, qr: null, message: 'QR ainda não disponível. Aguarde alguns segundos.' })
    }
    return res.send(qrWaitPage(s.status))
  }
  if (req.query.json) {
    return res.json({ status: 'qr_ready', qr: s.qrBase64 })
  }
  res.send(qrPage(s.qrBase64))
})

// ── GET /messages — mensagens recebidas ──────────────────────────
app.get('/messages', (req, res) => {
  const limit = parseInt(req.query.limit) || 50
  const msgs  = wa.getState().msgStore.slice(0, limit)
  res.json({ wgp_version: '1.0', status: 'success', count: msgs.length, messages: msgs })
})

// ── POST /webhook — configurar URL ──────────────────────────────
app.post('/webhook', (req, res) => {
  const { url } = req.body
  if (!url) return res.status(400).json({ error: 'Campo url é obrigatório' })
  wa.webhookUrl = url
  res.json({ wgp_version: '1.0', status: 'success', webhook_url: url })
})

// ── GET /webhook — consultar URL configurada ─────────────────────
app.get('/webhook', (req, res) => {
  res.json({ wgp_version: '1.0', webhook_url: wa.webhookUrl || null })
})

// ── Rotas de conveniência (atalhos REST) ─────────────────────────

// POST /send — atalho para send_message
app.post('/send', async (req, res) => {
  const { to, text, channel = 'individual' } = req.body
  const output = await wgp.execute({ action: 'send_message', channel, to, payload: { text } })
  res.status(output.http_code).json(output)
})

// POST /send/media — atalho para send_media
app.post('/send/media', async (req, res) => {
  const { to, media_type, url, caption, channel = 'individual' } = req.body
  const output = await wgp.execute({
    action: 'send_media', channel, to, payload: { media_type, url, caption },
  })
  res.status(output.http_code).json(output)
})

// POST /group/create
app.post('/group/create', async (req, res) => {
  const output = await wgp.execute({ action: 'create_group', channel: 'group', payload: req.body })
  res.status(output.http_code).json(output)
})

// POST /broadcast
app.post('/broadcast', async (req, res) => {
  const output = await wgp.execute({ action: 'broadcast_send', channel: 'broadcast', payload: req.body })
  res.status(output.http_code).json(output)
})

// ── 404 ──────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({
    wgp_version: '1.0', status: 'error', http_code: 404,
    error: { message: `Rota não encontrada: ${req.method} ${req.path}`, type: 'NOT_FOUND' },
  })
})

// ── Páginas HTML inline ──────────────────────────────────────────
function qrPage(base64) {
  return `<!DOCTYPE html><html lang="pt-BR"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>WGP — Escanear QR Code</title>
<style>
  body{font-family:system-ui,sans-serif;background:#0a0a0a;color:#fff;display:flex;
       align-items:center;justify-content:center;min-height:100vh;margin:0;flex-direction:column;gap:16px}
  .card{background:#1a1a1a;border:1px solid #2a2a2a;border-radius:16px;padding:32px;
        display:flex;flex-direction:column;align-items:center;gap:16px;max-width:360px}
  img{width:260px;height:260px;border-radius:12px;background:#fff;padding:10px}
  h2{margin:0;font-size:18px;font-weight:600}
  p{margin:0;font-size:13px;color:#888;text-align:center;line-height:1.6}
  .badge{background:#25D366;color:#fff;font-size:11px;padding:4px 12px;
         border-radius:20px;font-weight:500}
  .steps{background:#111;border-radius:8px;padding:12px 16px;width:100%;font-size:12px;
         color:#aaa;line-height:1.8;list-style:none;margin:0}
  .steps li::before{content:"→ ";color:#25D366}
  button{background:#25D366;color:#fff;border:none;padding:8px 20px;border-radius:8px;
         cursor:pointer;font-size:13px;margin-top:4px}
  button:hover{background:#1ebe5a}
</style>
<script>
  setTimeout(()=>fetch('/qr?json=1').then(r=>r.json()).then(d=>{
    if(d.status==='connected')location.href='/';
    else location.reload();
  }),30000);
</script>
</head><body>
<div class="card">
  <span class="badge">WGP Gateway</span>
  <h2>Conectar WhatsApp</h2>
  <img src="${base64}" alt="QR Code">
  <ul class="steps">
    <li>Abra o WhatsApp no celular</li>
    <li>Configurações → Aparelhos conectados</li>
    <li>Conectar um aparelho</li>
    <li>Aponte a câmera para o QR Code</li>
  </ul>
  <p>O QR atualiza automaticamente a cada 30s.<br>Não compartilhe este QR com ninguém.</p>
  <button onclick="location.reload()">↻ Atualizar QR</button>
</div>
</body></html>`
}

function qrWaitPage(status) {
  return `<!DOCTYPE html><html lang="pt-BR"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>WGP — Aguardando...</title>
<meta http-equiv="refresh" content="4">
<style>
  body{font-family:system-ui,sans-serif;background:#0a0a0a;color:#fff;
       display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
  .card{background:#1a1a1a;border:1px solid #2a2a2a;border-radius:16px;padding:32px;
        text-align:center;max-width:300px}
  .spin{font-size:32px;animation:spin 1.5s linear infinite;display:inline-block}
  @keyframes spin{to{transform:rotate(360deg)}}
  p{color:#888;font-size:13px}
  code{background:#222;padding:2px 6px;border-radius:4px;font-size:11px;color:#25D366}
</style>
</head><body>
<div class="card">
  <div class="spin">⟳</div>
  <h3>Aguardando conexão...</h3>
  <p>Status: <code>${status}</code></p>
  <p>A página atualiza automaticamente.<br>O QR Code aparecerá em instantes.</p>
</div>
</body></html>`
}

module.exports = { app, PORT }
