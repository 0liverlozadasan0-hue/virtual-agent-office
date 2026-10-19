/**
 * n8n.js — the bridge between an n8n workflow and this office.
 *
 * The office speaks the Agent Office wire protocol (`agent_spawned`,
 * `agent_working`, `agent_completed`), which is exactly what an n8n workflow
 * produces — a node starts working, it finishes. So the bridge is a rename,
 * not a translation: an n8n event is turned into the office event that would
 * have driven the same character.
 *
 * Two ways in:
 *
 *  1. `POST /api/n8n/*` — the friendly facade. n8n calls this.
 *  2. `POST /event` with an `n8n_*` type — `n8nEvent()` maps it in place, so
 *     a caller that already speaks the office protocol can stay on /event.
 *
 * The agent id is the caller's own string, so an n8n workflow can name its
 * agents ("chatwoot-receiver", "router-productos") and address them later
 * without keeping a mapping table.
 */

import { ALLOWED_HOSTS, ALLOWED_ORIGINS, API_TOKEN } from './deploy-config.js'

/** Cap the free-text fields an n8n payload may carry. */
function text(value, max = 200) {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (!trimmed) return undefined
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed
}

/**
 * Map an n8n-shaped event body onto the office event that drives the same
 * character. Returns null for anything that is not an n8n event, so the caller
 * falls through to the normal (Claude Code) path untouched.
 *
 * @param {unknown} body the incoming JSON body
 * @returns {object|null} an office event body, or null
 */
export function n8nEvent(body) {
  if (!body || typeof body !== 'object') return null
  const type = body.type
  if (typeof type !== 'string' || !type.startsWith('n8n_')) return null

  switch (type) {
    case 'n8n_spawned': {
      const agent = body.agent ?? body
      const id = text(agent.id ?? body.id, 80)
      if (!id) return null
      const role = text(agent.role ?? body.role, 60) ?? 'general-purpose'
      return {
        type: 'agent_spawned',
        agent: {
          id,
          name: text(agent.name ?? body.name, 80) ?? id,
          role,
          task: text(agent.task ?? body.task, 300) ?? '',
          // The server reads agentType for lineage guessing only; the sprite
          // comes from the role (src/config.ts ROLE_TO_CHAR).
          agentType: role,
          // A parent id makes this character a sub-agent of that one.
          parentSubagentId: text(agent.parentSubagentId ?? body.parentId, 80),
        },
        sessionId: text(body.sessionId, 120),
        project: text(body.project, 120),
        // An n8n workflow reuses one agent id for every message: the next
        // message must bring the character back to life, not be read as a
        // replayed hook spawn.
        revive: true,
      }
    }

    case 'n8n_working': {
      const id = text(body.agentId ?? body.id, 80)
      if (!id) return null
      // The status n8n sends is the most accurate thing there is, so it
      // wins. Without one, the field is left out on purpose: the office
      // then has the agent say what its role is doing (and what it is
      // working on) instead of a placeholder — see src/agentChatter.ts.
      const status = text(body.status ?? body.activity, 200)
      return {
        type: 'agent_working',
        agentId: id,
        ...(status ? { status } : {}),
        // The tool decides the animation: a read shows the character
        // reading, anything else shows it typing.
        tool: text(body.tool, 80),
        failed: body.failed === true || undefined,
        sessionId: text(body.sessionId, 120),
      }
    }

    case 'n8n_completed': {
      const id = text(body.agentId ?? body.id, 80)
      if (!id) return null
      return {
        type: 'agent_completed',
        agentId: id,
        result: text(body.result ?? body.status, 300),
        sessionId: text(body.sessionId, 120),
      }
    }

    default:
      return null
  }
}

/**
 * Mount the n8n facade on the Express app.
 *
 * @param {import('express').Express} app
 * @param {object} deps
 * @param {(body: object) => object|null} deps.processEvent  the office normaliser
 * @param {(event: object) => void} deps.broadcast
 * @param {() => object[]} deps.liveAgents
 * @param {(req, res, next) => void} deps.requireToken
 * @param {(body: object) => void} [deps.relaySignals]
 * @param {(body: object) => void} [deps.noteEvent]
 */
export function registerN8nApi(app, deps) {
  const { processEvent, broadcast, liveAgents, requireToken } = deps

  /** Normalise, broadcast and feed the same side-channels the hook path feeds. */
  function ingest(body) {
    const event = processEvent(body)
    if (event) broadcast(event)
    if (deps.relaySignals && Array.isArray(body.signals) && body.signals.length) {
      deps.relaySignals(body, body.signals)
    }
    if (deps.noteEvent) deps.noteEvent(body)
    return event
  }

  /**
   * Bring an agent into the office. It walks in through the door, finds a
   * desk and sits down.
   */
  app.post('/api/n8n/agent', requireToken, (req, res) => {
    const body = req.body ?? {}
    const event = n8nEvent({ ...body, type: 'n8n_spawned' })
    if (!event) return res.status(400).json({ ok: false, error: 'id is required' })
    ingest(event)
    res.json({ ok: true, agentId: event.agent.id })
  })

  /**
   * An n8n node started working. The character types (or reads, when the
   * tool is a read).
   */
  app.post('/api/n8n/working', requireToken, (req, res) => {
    const body = req.body ?? {}
    const event = n8nEvent({ ...body, type: 'n8n_working' })
    if (!event) return res.status(400).json({ ok: false, error: 'id is required' })
    ingest(event)
    res.json({ ok: true, agentId: event.agentId })
  })

  /**
   * The node finished. The character stands up and walks out through the door.
   */
  app.post('/api/n8n/complete', requireToken, (req, res) => {
    const body = req.body ?? {}
    const event = n8nEvent({ ...body, type: 'n8n_completed' })
    if (!event) return res.status(400).json({ ok: false, error: 'id is required' })
    ingest(event)
    res.json({ ok: true, agentId: event.agentId })
  })

  /**
   * A signal about the work — a deploy landed, a test failed. The office
   * reacts (a rocket, a red beacon).
   */
  app.post('/api/n8n/signal', requireToken, (req, res) => {
    const body = req.body ?? {}
    const id = text(body.id, 80)
    const kind = text(body.kind, 40)
    if (!kind) return res.status(400).json({ ok: false, error: 'kind is required' })
    const signal = { kind, detail: text(body.detail, 300) }
    // The agent id rides on the body too: relaySignals reads it from there,
    // not out of the signal, and it is what names the agent in the log.
    const enriched = id ? { ...body, agentId: id } : body
    if (id) signal.agentId = id
    ingest({ ...enriched, type: 'signal', signals: [signal] })
    res.json({ ok: true })
  })

  /** The agents currently in the office. */
  app.get('/api/n8n/agents', requireToken, (_req, res) => {
    res.json(liveAgents())
  })

  /**
   * Many events at once — so a workflow that finishes a turn can close the
   * main agent and every sub-agent it spawned in a single call.
   *
   * The body is an array of the same shapes the single-event routes take,
   * each with a `type`: 'agent' | 'working' | 'complete' | 'signal'.
   */
  app.post('/api/n8n/batch', requireToken, (req, res) => {
    const body = req.body
    const list = Array.isArray(body) ? body : Array.isArray(body?.events) ? body.events : []
    if (list.length === 0) return res.status(400).json({ ok: false, error: 'no events' })

    const done = []
    for (const item of list) {
      if (!item || typeof item !== 'object') continue
      const kind = text(item.type, 20)
      let event = null
      if (kind === 'agent') event = n8nEvent({ ...item, type: 'n8n_spawned' })
      else if (kind === 'working') event = n8nEvent({ ...item, type: 'n8n_working' })
      else if (kind === 'complete') event = n8nEvent({ ...item, type: 'n8n_completed' })
      else if (kind === 'signal') {
        const signalKind = text(item.kind, 40)
        if (!signalKind) continue
        const signal = { kind: signalKind, detail: text(item.detail, 300) }
        const id = text(item.id, 80)
        if (id) signal.agentId = id
        event = { ...(id ? { agentId: id } : {}), type: 'signal', signals: [signal] }
      }
      if (!event) continue
      ingest(event)
      done.push(event.agent?.id ?? event.agentId ?? null)
    }
    res.json({ ok: true, count: done.length, agentIds: done })
  })

  /** Everything the n8n bridge knows about itself (handy for debugging). */
  app.get('/api/n8n/health', (_req, res) => {
    res.json({
      ok: true,
      tokenFromEnv: Boolean(API_TOKEN),
      allowedHosts: [...ALLOWED_HOSTS],
      allowedOrigins: [...ALLOWED_ORIGINS],
    })
  })
}
