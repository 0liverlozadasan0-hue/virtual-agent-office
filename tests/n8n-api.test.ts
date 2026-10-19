/**
 * n8n-api.test.ts — the n8n bridge over HTTP.
 *
 * The unit tests in n8n.test.ts cover the translation; these cover the routes
 * the workflow actually calls: the auth, the answers, and what the office
 * ends up holding afterwards.
 */

import { describe, it, expect, afterEach } from 'vitest'
import request from 'supertest'
import { loadOffice, removeOffice, type Office } from './helpers.js'

let office: Office | undefined

afterEach(() => {
  removeOffice(office)
  office = undefined
})

/** POST /api/n8n/* with the office's own token. */
function post(server: Office['server'], path: string, body: unknown, token?: string) {
  const req = request(server.app).post(path)
  if (token !== null) req.set('Authorization', `Bearer ${token ?? server.AUTH_TOKEN}`)
  return req.send(body as object)
}

describe('the n8n API', () => {
  describe('authentication', () => {
    it('refuses a request with no token', async () => {
      office = await loadOffice()
      const res = await post(office.server, '/api/n8n/agent', { id: 'a' }, null)
      expect(res.status).toBe(401)
    })

    it('refuses a request with a wrong token', async () => {
      office = await loadOffice()
      const res = await post(office.server, '/api/n8n/agent', { id: 'a' }, 'not-the-token')
      expect(res.status).toBe(401)
    })

    it('answers the health route without a token', async () => {
      office = await loadOffice()
      const res = await request(office.server.app).get('/api/n8n/health')
      expect(res.status).toBe(200)
      expect(res.body.ok).toBe(true)
    })
  })

  describe('spawning an agent', () => {
    it('puts the agent in the office and answers with its id', async () => {
      office = await loadOffice()
      const res = await post(office.server, '/api/n8n/agent', {
        id: 'chatwoot-receiver',
        name: 'Chatwoot Receiver',
        role: 'soporte',
        task: 'Respondiendo a Juan',
      })
      expect(res.status).toBe(200)
      expect(res.body.ok).toBe(true)
      expect(res.body.agentId).toBe('chatwoot-receiver')

      const agents = await request(office.server.app)
        .get('/api/n8n/agents')
        .set('Authorization', `Bearer ${office.server.AUTH_TOKEN}`)
      expect(agents.body.map((a: { id: string }) => a.id)).toContain('chatwoot-receiver')
    })

    it('keeps the role, so the office picks that character', async () => {
      office = await loadOffice()
      await post(office.server, '/api/n8n/agent', { id: 'a', role: 'comercial' })
      const agents = await request(office.server.app)
        .get('/api/n8n/agents')
        .set('Authorization', `Bearer ${office.server.AUTH_TOKEN}`)
      expect(agents.body[0].role).toBe('comercial')
    })

    it('links a sub-agent to its parent', async () => {
      office = await loadOffice()
      await post(office.server, '/api/n8n/agent', { id: 'parent', role: 'soporte' })
      await post(office.server, '/api/n8n/agent', { id: 'child', role: 'comercial', parentId: 'parent' })
      const agents = await request(office.server.app)
        .get('/api/n8n/agents')
        .set('Authorization', `Bearer ${office.server.AUTH_TOKEN}`)
      const child = agents.body.find((a: { id: string }) => a.id === 'child')
      expect(child.parentId).toBe('parent')
    })

    it('rejects a spawn with no id', async () => {
      office = await loadOffice()
      const res = await post(office.server, '/api/n8n/agent', { name: 'Sin id' })
      expect(res.status).toBe(400)
    })
  })

  describe('working', () => {
    it('marks the agent as working', async () => {
      office = await loadOffice()
      await post(office.server, '/api/n8n/agent', { id: 'a', role: 'soporte' })
      const res = await post(office.server, '/api/n8n/working', {
        id: 'a',
        status: 'Leyendo contexto',
        tool: 'Read',
      })
      expect(res.status).toBe(200)
      expect(res.body.agentId).toBe('a')

      const agents = await request(office.server.app)
        .get('/api/n8n/agents')
        .set('Authorization', `Bearer ${office.server.AUTH_TOKEN}`)
      expect(agents.body[0].status).toBe('Leyendo contexto')
    })

    it('rejects a working event with no id', async () => {
      office = await loadOffice()
      const res = await post(office.server, '/api/n8n/working', { status: 'x' })
      expect(res.status).toBe(400)
    })
  })

  describe('completing', () => {
    it('completes the agent', async () => {
      office = await loadOffice()
      await post(office.server, '/api/n8n/agent', { id: 'a', role: 'soporte' })
      const res = await post(office.server, '/api/n8n/complete', { id: 'a', result: 'Respuesta enviada' })
      expect(res.status).toBe(200)
    })

    it('brings the agent back when the next message arrives', async () => {
      office = await loadOffice()
      await post(office.server, '/api/n8n/agent', { id: 'a', role: 'soporte' })
      await post(office.server, '/api/n8n/complete', { id: 'a', result: 'fin' })

      // The next message reuses the same id: the character must come back,
      // not be swallowed as a replayed spawn.
      await post(office.server, '/api/n8n/agent', { id: 'a', role: 'soporte', task: 'otro mensaje' })
      const agents = await request(office.server.app)
        .get('/api/n8n/agents')
        .set('Authorization', `Bearer ${office.server.AUTH_TOKEN}`)
      const agent = agents.body.find((a: { id: string }) => a.id === 'a')
      expect(agent.state).not.toBe('completed')
    })
  })

  describe('signals', () => {
    it('accepts a signal and names the agent', async () => {
      office = await loadOffice()
      await post(office.server, '/api/n8n/agent', { id: 'a', role: 'soporte' })
      const res = await post(office.server, '/api/n8n/signal', {
        id: 'a',
        kind: 'deploy_success',
        detail: 'WhatsApp enviado',
      })
      expect(res.status).toBe(200)
      expect(res.body.ok).toBe(true)
    })

    it('rejects a signal with no kind', async () => {
      office = await loadOffice()
      const res = await post(office.server, '/api/n8n/signal', { id: 'a' })
      expect(res.status).toBe(400)
    })
  })

  describe('the office event path', () => {
    it('accepts an n8n event on /event too', async () => {
      office = await loadOffice()
      const res = await post(office.server, '/event', {
        type: 'n8n_spawned',
        id: 'via-event',
        role: 'soporte',
      })
      expect(res.status).toBe(200)
      expect(res.body.agentId).toBe('via-event')
    })

    it('leaves a Claude Code event alone', async () => {
      office = await loadOffice()
      const res = await post(office.server, '/event', {
        type: 'agent_spawned',
        agent: { id: 'claude-style', name: 'Claude', role: 'general-purpose' },
      })
      expect(res.status).toBe(200)
    })
  })
})
