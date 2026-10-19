/**
 * n8n.test.ts — the n8n bridge.
 *
 * The bridge's contract: an n8n event maps onto the office event that drives
 * the same character, and anything that is not an n8n event passes through
 * untouched so the Claude Code path keeps working.
 */

import { describe, it, expect } from 'vitest'
import { n8nEvent } from '../server/n8n.js'

describe('n8nEvent', () => {
  describe('spawning', () => {
    it('maps an n8n spawn onto agent_spawned', () => {
      const event = n8nEvent({
        type: 'n8n_spawned',
        id: 'chatwoot-receiver',
        name: 'Chatwoot Receiver',
        role: 'soporte',
        task: 'Respondiendo a Juan',
      })
      expect(event).not.toBeNull()
      expect(event!.type).toBe('agent_spawned')
      expect(event!.agent.id).toBe('chatwoot-receiver')
      expect(event!.agent.name).toBe('Chatwoot Receiver')
      expect(event!.agent.role).toBe('soporte')
      expect(event!.agent.task).toBe('Respondiendo a Juan')
    })

    it('defaults the role so the office always has a sprite', () => {
      const event = n8nEvent({ type: 'n8n_spawned', id: 'a' })
      expect(event!.agent.role).toBe('general-purpose')
      expect(event!.agent.name).toBe('a')
    })

    it('carries the parent so the character is a sub-agent', () => {
      const event = n8nEvent({
        type: 'n8n_spawned',
        id: 'child',
        role: 'comercial',
        parentId: 'parent',
      })
      expect(event!.agent.parentSubagentId).toBe('parent')
    })

    it('refuses a spawn with no id', () => {
      expect(n8nEvent({ type: 'n8n_spawned' })).toBeNull()
    })

    it('accepts the nested agent shape too', () => {
      const event = n8nEvent({
        type: 'n8n_spawned',
        agent: { id: 'nested', name: 'Nested', role: 'procesos' },
      })
      expect(event!.agent.id).toBe('nested')
      expect(event!.agent.role).toBe('procesos')
    })
  })

  describe('working', () => {
    it('maps an n8n working event onto agent_working', () => {
      const event = n8nEvent({
        type: 'n8n_working',
        id: 'chatwoot-receiver',
        status: 'Leyendo contexto',
        tool: 'Read',
      })
      expect(event!.type).toBe('agent_working')
      expect(event!.agentId).toBe('chatwoot-receiver')
      expect(event!.status).toBe('Leyendo contexto')
      expect(event!.tool).toBe('Read')
    })

    it('leaves the status out when n8n does not send one', () => {
      // Sin status, la oficina genera la frase contextual del rol
      // (src/agentChatter.ts) en vez de repetir el nombre del tool.
      const event = n8nEvent({ type: 'n8n_working', id: 'a', tool: 'Write' })
      expect(event!.status).toBeUndefined()
      expect(event!.tool).toBe('Write')
    })

    it('uses the status n8n sends — it is the most accurate thing there is', () => {
      const event = n8nEvent({ type: 'n8n_working', id: 'a', status: 'Leyendo contexto', tool: 'Read' })
      expect(event!.status).toBe('Leyendo contexto')
      expect(event!.tool).toBe('Read')
    })

    it('never sends a top-level agentType — it would trigger the recovered-spawn path', () => {
      const event = n8nEvent({ type: 'n8n_working', id: 'a', agentType: 'soporte' })
      expect(event!.agentType).toBeUndefined()
    })

    it('refuses a working event with no id', () => {
      expect(n8nEvent({ type: 'n8n_working' })).toBeNull()
    })
  })

  describe('completing', () => {
    it('maps an n8n completion onto agent_completed', () => {
      const event = n8nEvent({ type: 'n8n_completed', id: 'a', result: 'Respuesta enviada' })
      expect(event!.type).toBe('agent_completed')
      expect(event!.agentId).toBe('a')
      expect(event!.result).toBe('Respuesta enviada')
    })
  })

  describe('pass-through', () => {
    it('returns null for a non-n8n event so the Claude Code path is untouched', () => {
      expect(n8nEvent({ type: 'agent_danced' })).toBeNull()
      expect(n8nEvent({ type: 'session_prompt' })).toBeNull()
    })

    it('returns null for a body that is not an object', () => {
      expect(n8nEvent(null)).toBeNull()
      expect(n8nEvent('nope')).toBeNull()
      expect(n8nEvent(undefined)).toBeNull()
    })

    it('returns null for an unknown n8n type', () => {
      expect(n8nEvent({ type: 'n8n_danced' })).toBeNull()
    })

    it('leaves an office-protocol event for the caller to pass through', () => {
      // The caller does `n8nEvent(b) ?? b`, so a null here means the office
      // protocol body is used as it is.
      const body = { type: 'agent_spawned', agent: { id: 'x' } }
      expect(n8nEvent(body)).toBeNull()
    })
  })

  describe('text handling', () => {
    it('trims and drops empty text', () => {
      const event = n8nEvent({ type: 'n8n_spawned', id: 'a', name: '  ' })
      expect(event!.agent.name).toBe('a')
    })

    it('caps an overlong task so it cannot flood the office', () => {
      const event = n8nEvent({ type: 'n8n_spawned', id: 'a', task: 'x'.repeat(5000) })
      expect(event!.agent.task!.length).toBeLessThanOrEqual(300)
    })
  })
})
