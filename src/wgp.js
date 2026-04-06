/**
 * WGP — WhatsApp Gateway Protocol v1.0
 * Recebe JSON no formato WGP, executa a ação e devolve JSON WGP padronizado.
 */

const wa = require('./whatsapp')

// ── Schema mínimo por action ─────────────────────────────────────
const REQUIRED = {
  send_message:        ['channel', 'to', 'payload'],
  send_media:          ['channel', 'to', 'payload'],
  send_reaction:       ['channel', 'to', 'payload'],
  create_group:        ['payload'],
  update_group:        ['to', 'payload'],
  add_member:          ['to', 'payload'],
  remove_member:       ['to', 'payload'],
  promote_admin:       ['to', 'payload'],
  demote_admin:        ['to', 'payload'],
  leave_group:         ['to'],
  get_group_info:      ['to'],
  broadcast_send:      ['payload'],
  mark_read:           ['to', 'payload'],
  get_status:          [],
  get_messages:        [],
}

// ── Dispatcher principal ─────────────────────────────────────────
async function execute(input) {
  const start = Date.now()
  let result

  try {
    validate(input)
    result = await dispatch(input)
  } catch (err) {
    return errorOutput(err, input, Date.now() - start)
  }

  return successOutput(result, input, Date.now() - start)
}

async function dispatch(inp) {
  const { action, channel, to, payload = {}, options = {} } = inp

  switch (action) {

    // ── Mensagem de texto ───────────────────────────────────────
    case 'send_message': {
      if (!payload.text) throw new Error('payload.text é obrigatório')
      const sent = await wa.sendText(to, payload.text, options.reply_to)
      return { message_id: sent.key?.id, to }
    }

    // ── Mídia ──────────────────────────────────────────────────
    case 'send_media': {
      const { media_type, url, caption = '', filename = '' } = payload
      if (!media_type) throw new Error('payload.media_type é obrigatório (image|video|audio|document|sticker)')
      if (!url)        throw new Error('payload.url é obrigatório')
      const sent = await wa.sendMedia(to, media_type, url, caption, filename)
      return { message_id: sent.key?.id, to }
    }

    // ── Reação ──────────────────────────────────────────────────
    case 'send_reaction': {
      const { emoji, message_id } = payload
      if (!emoji)      throw new Error('payload.emoji é obrigatório')
      if (!message_id) throw new Error('payload.message_id é obrigatório')
      await wa.sendReaction(to, message_id, emoji)
      return { reacted_to: message_id, emoji }
    }

    // ── Criar grupo ─────────────────────────────────────────────
    case 'create_group': {
      const { name, members = [], description = '' } = payload
      if (!name)             throw new Error('payload.name é obrigatório')
      if (!members.length)   throw new Error('payload.members[] precisa ter ao menos 1 número')
      const grp = await wa.createGroup(name, members, description)
      return { group_id: grp.id, name, members_added: members.length }
    }

    // ── Atualizar grupo ─────────────────────────────────────────
    case 'update_group': {
      const res = await wa.updateGroup(to, payload)
      return res
    }

    // ── Membros ─────────────────────────────────────────────────
    case 'add_member':
    case 'remove_member':
    case 'promote_admin':
    case 'demote_admin': {
      const map    = { add_member: 'add', remove_member: 'remove', promote_admin: 'promote', demote_admin: 'demote' }
      const waAct  = map[action]
      const { members } = payload
      if (!members?.length) throw new Error('payload.members[] é obrigatório')
      const res = await wa.updateGroupMembers(to, waAct, members)
      return { group_id: to, action: waAct, members, result: res }
    }

    // ── Sair do grupo ───────────────────────────────────────────
    case 'leave_group': {
      await wa.leaveGroup(to)
      return { group_id: to, left: true }
    }

    // ── Info do grupo ───────────────────────────────────────────
    case 'get_group_info': {
      const info = await wa.getGroupInfo(to)
      return {
        group_id:    info.id,
        name:        info.subject,
        description: info.desc,
        owner:       info.owner,
        creation:    new Date(info.creation * 1000).toISOString(),
        participants: info.participants.map(p => ({
          number: p.id.split('@')[0],
          jid:    p.id,
          admin:  p.admin || null,
        })),
      }
    }

    // ── Broadcast ──────────────────────────────────────────────
    case 'broadcast_send': {
      const { recipients = [], text, media_type, url, caption = '', delay_ms = 2000 } = payload
      if (!recipients.length) throw new Error('payload.recipients[] é obrigatório')
      if (!text && !url)      throw new Error('payload.text ou payload.url é obrigatório')

      const results = []
      for (const num of recipients) {
        try {
          let sent
          if (url) {
            sent = await wa.sendMedia(num, media_type || 'image', url, caption)
          } else {
            sent = await wa.sendText(num, text)
          }
          results.push({ to: num, status: 'sent', message_id: sent.key?.id })
        } catch (err) {
          results.push({ to: num, status: 'failed', error: err.message })
        }
        // Anti-ban: delay entre envios
        if (delay_ms > 0) await sleep(delay_ms)
      }

      const sent   = results.filter(r => r.status === 'sent').length
      const failed = results.filter(r => r.status === 'failed').length
      return { total: recipients.length, sent, failed, results }
    }

    // ── Marcar como lido ────────────────────────────────────────
    case 'mark_read': {
      const { message_ids = [] } = payload
      await wa.markRead(to, message_ids)
      return { marked: message_ids.length }
    }

    // ── Status da conexão ───────────────────────────────────────
    case 'get_status': {
      const s = wa.getState()
      return {
        status:     s.status,
        phone:      s.phone,
        name:       s.name,
        started_at: s.startedAt,
        reconnects: s.reconnects,
        qr_ready:   s.status === 'qr_ready',
      }
    }

    // ── Mensagens recebidas (store local) ───────────────────────
    case 'get_messages': {
      const { limit = 50 } = inp.options || {}
      return { messages: wa.getState().msgStore.slice(0, limit) }
    }

    default:
      throw new Error(`Action desconhecida: "${action}". Actions válidas: ${Object.keys(REQUIRED).join(', ')}`)
  }
}

// ── Validação básica ─────────────────────────────────────────────
function validate(inp) {
  if (!inp || typeof inp !== 'object') throw new Error('Input deve ser um objeto JSON')
  if (!inp.action) throw new Error('Campo "action" é obrigatório')
  if (!REQUIRED[inp.action] && inp.action !== 'webhook_receive') {
    throw new Error(`Action inválida: "${inp.action}"`)
  }
  const missing = (REQUIRED[inp.action] || []).filter(f => !inp[f])
  if (missing.length) throw new Error(`Campos obrigatórios ausentes: ${missing.join(', ')}`)
}

// ── Builders de output WGP ───────────────────────────────────────
function successOutput(data, inp, ms) {
  return {
    wgp_version: '1.0',
    status:      'success',
    http_code:   200,
    action:      inp.action,
    channel:     inp.channel || null,
    timestamp:   new Date().toISOString(),
    to:          inp.to || null,
    data,
    meta: { api: 'wgp_baileys', latency_ms: ms },
  }
}

function errorOutput(err, inp, ms) {
  const code = err.message?.includes('não conectado') ? 503
             : err.message?.includes('obrigatório')   ? 400
             : err.message?.includes('inválid')        ? 400
             : 500

  return {
    wgp_version: '1.0',
    status:      'error',
    http_code:   code,
    action:      inp?.action || null,
    channel:     inp?.channel || null,
    timestamp:   new Date().toISOString(),
    to:          inp?.to || null,
    error: {
      message:     err.message,
      type:        code === 400 ? 'VALIDATION_ERROR'
                 : code === 503 ? 'NOT_CONNECTED'
                 : 'INTERNAL_ERROR',
      recoverable: code !== 400,
    },
    meta: { api: 'wgp_baileys', latency_ms: ms },
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

module.exports = { execute, validate, REQUIRED }
