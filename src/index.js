/**
 * WGP WhatsApp Gateway — Entry Point
 * Inicia conexão com WhatsApp e servidor HTTP simultaneamente.
 */

const wa             = require('./whatsapp')
const { app, PORT }  = require('./server')

// ── Variáveis de ambiente ────────────────────────────────────────
const API_KEY     = process.env.WGP_API_KEY    || 'wgp-secret-key'
const WEBHOOK_URL = process.env.WGP_WEBHOOK_URL || null
const HOST        = process.env.HOST            || '0.0.0.0'

// Aplicar webhook configurado via env
if (WEBHOOK_URL) wa.webhookUrl = WEBHOOK_URL

// ── Iniciar servidor HTTP ────────────────────────────────────────
app.listen(PORT, HOST, () => {
  console.log(`\n╔══════════════════════════════════════════════╗`)
  console.log(`║        WGP WhatsApp Gateway v1.0             ║`)
  console.log(`╚══════════════════════════════════════════════╝`)
  console.log(`\n🌐 Servidor:  http://${HOST}:${PORT}`)
  console.log(`🔑 API Key:   ${API_KEY}`)
  console.log(`📡 Webhook:   ${WEBHOOK_URL || '(não configurado)'}`)
  console.log(`\n📖 Endpoints:`)
  console.log(`   GET  /          → Painel web`)
  console.log(`   GET  /status    → Status da conexão`)
  console.log(`   GET  /qr        → QR Code para conectar WA`)
  console.log(`   GET  /messages  → Mensagens recebidas`)
  console.log(`   POST /wgp       → Endpoint principal WGP`)
  console.log(`   POST /send      → Atalho: enviar texto`)
  console.log(`   POST /send/media→ Atalho: enviar mídia`)
  console.log(`   POST /broadcast → Atalho: broadcast`)
  console.log(`   POST /group/create → Atalho: criar grupo`)
  console.log(`   POST /webhook   → Configurar webhook URL`)
  console.log(`\nℹ️  Autenticação: header 'apikey: ${API_KEY}'`)
  console.log(`\n🔄 Conectando ao WhatsApp...\n`)
})

// ── Iniciar conexão WhatsApp ─────────────────────────────────────
wa.setOnStatus((s) => {
  const icons = {
    connected:    '✅',
    qr_ready:     '📱',
    connecting:   '🔄',
    disconnected: '❌',
    logged_out:   '🚪',
  }
  const icon = icons[s.status] || '❓'
  if (s.status === 'qr_ready') {
    console.log(`${icon} QR Code pronto — acesse: http://localhost:${PORT}/qr`)
  } else if (s.status === 'connected') {
    console.log(`${icon} Conectado como ${s.name} (+${s.phone})`)
  } else {
    console.log(`${icon} Status: ${s.status}`)
  }
})

wa.connect().catch((err) => {
  console.error('[WGP] Erro fatal ao conectar:', err.message)
  process.exit(1)
})

// ── Graceful shutdown ────────────────────────────────────────────
process.on('SIGINT',  () => { console.log('\n[WGP] Encerrando...'); wa.disconnect(); process.exit(0) })
process.on('SIGTERM', () => { console.log('\n[WGP] Encerrando...'); wa.disconnect(); process.exit(0) })
process.on('uncaughtException',  (e) => console.error('[WGP] Uncaught:', e.message))
process.on('unhandledRejection', (r) => console.error('[WGP] Unhandled:', r))
