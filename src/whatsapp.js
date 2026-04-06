/**
 * WGP WhatsApp Gateway — Módulo de conexão (Baileys)
 * Gerencia sessão, QR Code e reconexão automática.
 */

const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
} = require('@whiskeysockets/baileys')
const pino   = require('pino')
const path   = require('path')
const fs     = require('fs')
const QRCode = require('qrcode')

const AUTH_DIR = path.join(process.cwd(), 'auth_info')

// Estado global da instância
const state = {
  socket:      null,
  status:      'disconnected', // disconnected | connecting | qr_ready | connected
  qrBase64:    null,
  qrCode:      null,
  phone:       null,
  name:        null,
  startedAt:   null,
  reconnects:  0,
  msgStore:    [],             // últimas 200 msgs recebidas
  webhookUrl:  null,
}

// Store em memória de contatos (simplificado)

// Callbacks externos
let onMessageCb  = null
let onStatusCb   = null
let onQRCb       = null

function setOnMessage(fn)  { onMessageCb = fn }
function setOnStatus(fn)   { onStatusCb  = fn }
function setOnQR(fn)       { onQRCb      = fn }

function getState() { return { ...state, socket: undefined } }

async function connect() {
  if (!fs.existsSync(AUTH_DIR)) fs.mkdirSync(AUTH_DIR, { recursive: true })

  const { state: authState, saveCreds } = await useMultiFileAuthState(AUTH_DIR)
  const { version }                      = await fetchLatestBaileysVersion()

  const logger = pino({ level: 'silent' })

  const sock = makeWASocket({
    version,
    logger,
    auth:            authState,
    printQRInTerminal: false,
    generateHighQualityLinkPreview: true,
    getMessage: async (key) => {
      return { conversation: '' }
    },
  })

  state.socket   = sock
  state.status   = 'connecting'
  state.startedAt = new Date().toISOString()
  notifyStatus()

  // ── QR Code ────────────────────────────────────────────────────
  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update

    if (qr) {
      state.qrCode   = qr
      state.qrBase64 = await QRCode.toDataURL(qr)
      state.status   = 'qr_ready'
      console.log('[WGP] QR Code gerado — acesse /qr para escanear')
      notifyStatus()
      if (onQRCb) onQRCb(state.qrBase64)
    }

    if (connection === 'open') {
      state.status  = 'connected'
      state.qrBase64 = null
      state.qrCode   = null
      const info     = sock.user
      state.phone    = info?.id?.split(':')[0] || info?.id
      state.name     = info?.name || 'WhatsApp'
      state.reconnects = 0
      console.log(`[WGP] ✅ Conectado como ${state.name} (${state.phone})`)
      notifyStatus()
    }

    if (connection === 'close') {
      const code   = lastDisconnect?.error?.output?.statusCode
      const reason = DisconnectReason
      const should = code !== reason.loggedOut

      state.status = should ? 'disconnected' : 'logged_out'
      console.log(`[WGP] Desconectado — código ${code} — reconectar: ${should}`)
      notifyStatus()

      if (should) {
        state.reconnects++
        const delay = Math.min(3000 * state.reconnects, 30000)
        setTimeout(connect, delay)
      } else {
        // Sessão encerrada — limpar auth
        fs.rmSync(AUTH_DIR, { recursive: true, force: true })
      }
    }
  })

  // ── Salvar credenciais ─────────────────────────────────────────
  sock.ev.on('creds.update', saveCreds)

  // ── Mensagens recebidas ────────────────────────────────────────
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return
    for (const msg of messages) {
      if (msg.key.fromMe) continue  // ignorar msgs enviadas por nós
      const wgp = normalizeIncoming(msg)
      if (!wgp) continue

      // Guardar no store local (máx 200)
      state.msgStore.unshift(wgp)
      if (state.msgStore.length > 200) state.msgStore.pop()

      // Disparar webhook externo
      if (state.webhookUrl) fireWebhook(wgp)

      if (onMessageCb) onMessageCb(wgp)
    }
  })

  return sock
}

// ── Normalizar mensagem recebida → formato WGP ──────────────────
function normalizeIncoming(raw) {
  try {
    const jid   = raw.key.remoteJid
    const isGrp = jid.endsWith('@g.us')
    const msgContent = raw.message

    let type    = 'unknown'
    let payload = {}

    if (msgContent?.conversation || msgContent?.extendedTextMessage) {
      type = 'text'
      payload.text = msgContent.conversation || msgContent.extendedTextMessage?.text
    } else if (msgContent?.imageMessage) {
      type = 'image'
      payload.caption = msgContent.imageMessage.caption
      payload.mimetype = msgContent.imageMessage.mimetype
    } else if (msgContent?.videoMessage) {
      type = 'video'
      payload.caption = msgContent.videoMessage.caption
    } else if (msgContent?.audioMessage) {
      type = 'audio'
      payload.duration = msgContent.audioMessage.seconds
    } else if (msgContent?.documentMessage) {
      type = 'document'
      payload.filename = msgContent.documentMessage.fileName
      payload.mimetype = msgContent.documentMessage.mimetype
    } else if (msgContent?.locationMessage) {
      type = 'location'
      payload.latitude  = msgContent.locationMessage.degreesLatitude
      payload.longitude = msgContent.locationMessage.degreesLongitude
    } else if (msgContent?.reactionMessage) {
      type = 'reaction'
      payload.emoji     = msgContent.reactionMessage.text
      payload.react_to  = msgContent.reactionMessage.key?.id
    } else {
      return null // tipo não suportado
    }

    return {
      wgp_version: '1.0',
      action:      'webhook_receive',
      channel:     isGrp ? 'group' : 'individual',
      from:        raw.key.participant || raw.key.remoteJid,
      message_id:  raw.key.id,
      timestamp:   new Date(raw.messageTimestamp * 1000).toISOString(),
      type,
      payload,
      context: {
        group_id:    isGrp ? jid : null,
        reply_to:    raw.message?.extendedTextMessage?.contextInfo?.stanzaId || null,
        push_name:   raw.pushName || null,
      },
    }
  } catch {
    return null
  }
}

// ── Disparar webhook externo ─────────────────────────────────────
async function fireWebhook(payload) {
  if (!state.webhookUrl) return
  const axios = require('axios')
  try {
    await axios.post(state.webhookUrl, payload, { timeout: 5000 })
  } catch (err) {
    console.warn('[WGP] Webhook falhou:', err.message)
  }
}

// ── Notificar mudança de status ──────────────────────────────────
function notifyStatus() {
  if (onStatusCb) onStatusCb(getState())
}

// ── API de envio de mensagens ────────────────────────────────────
async function sendText(to, text, replyTo = null) {
  assertConnected()
  const jid = normalizeJid(to)
  const opts = replyTo ? { quoted: { key: { id: replyTo } } } : {}
  return state.socket.sendMessage(jid, { text }, opts)
}

async function sendMedia(to, type, url, caption = '', filename = '') {
  assertConnected()
  const jid  = normalizeJid(to)
  const axios = require('axios')
  const resp  = await axios.get(url, { responseType: 'arraybuffer', timeout: 30000 })
  const buffer = Buffer.from(resp.data)
  const mime   = resp.headers['content-type'] || 'application/octet-stream'

  const typeMap = {
    image:    { image: buffer, caption },
    video:    { video: buffer, caption },
    audio:    { audio: buffer, mimetype: 'audio/mp4' },
    document: { document: buffer, mimetype: mime, fileName: filename || 'file' },
    sticker:  { sticker: buffer },
  }
  if (!typeMap[type]) throw new Error(`Tipo de mídia inválido: ${type}`)
  return state.socket.sendMessage(jid, typeMap[type])
}

async function sendReaction(to, messageId, emoji) {
  assertConnected()
  const jid = normalizeJid(to)
  return state.socket.sendMessage(jid, {
    react: { text: emoji, key: { id: messageId, remoteJid: jid } },
  })
}

async function createGroup(name, members, description = '') {
  assertConnected()
  const jids   = members.map(normalizeJid)
  const result = await state.socket.groupCreate(name, jids)
  if (description) {
    await state.socket.groupUpdateDescription(result.id, description)
  }
  return result
}

async function updateGroupMembers(groupId, action, members) {
  // action: add | remove | promote | demote
  assertConnected()
  const jid   = normalizeJid(groupId, true)
  const jids  = members.map(normalizeJid)
  return state.socket.groupParticipantsUpdate(jid, jids, action)
}

async function updateGroup(groupId, data) {
  assertConnected()
  const jid = normalizeJid(groupId, true)
  if (data.name)        await state.socket.groupUpdateSubject(jid, data.name)
  if (data.description) await state.socket.groupUpdateDescription(jid, data.description)
  return { id: jid, updated: true }
}

async function leaveGroup(groupId) {
  assertConnected()
  return state.socket.groupLeave(normalizeJid(groupId, true))
}

async function getGroupInfo(groupId) {
  assertConnected()
  return state.socket.groupMetadata(normalizeJid(groupId, true))
}

async function markRead(to, messageIds) {
  assertConnected()
  const jid = normalizeJid(to)
  await state.socket.readMessages(messageIds.map(id => ({ id, remoteJid: jid })))
}

// ── Helpers ──────────────────────────────────────────────────────
function normalizeJid(raw, forceGroup = false) {
  if (!raw) throw new Error('Destinatário não informado')
  if (raw.includes('@')) return raw
  const clean = raw.replace(/[^0-9]/g, '')
  return forceGroup ? `${clean}@g.us` : `${clean}@s.whatsapp.net`
}

function assertConnected() {
  if (state.status !== 'connected') {
    throw new Error(`WhatsApp não conectado (status: ${state.status}). Escaneie o QR Code em /qr`)
  }
}

function disconnect() {
  if (state.socket) state.socket.end()
}

module.exports = {
  connect,
  disconnect,
  getState,
  setOnMessage,
  setOnStatus,
  setOnQR,
  sendText,
  sendMedia,
  sendReaction,
  createGroup,
  updateGroupMembers,
  updateGroup,
  leaveGroup,
  getGroupInfo,
  markRead,
  fireWebhook,
  get webhookUrl()  { return state.webhookUrl },
  set webhookUrl(v) { state.webhookUrl = v },
}
