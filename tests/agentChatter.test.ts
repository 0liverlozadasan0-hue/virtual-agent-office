/**
 * agentChatter.test.ts — la charla contextual.
 *
 * Lo que importa: cada rol habla de lo suyo, la tarea se usa cuando se
 * puede usar en una frase, y una tarea en forma de pregunta no rompe la
 * frase.
 */

import { describe, it, expect } from 'vitest'
import { taskSubject, contextualWork, contextualBreak } from '../src/agentChatter.js'

describe('taskSubject', () => {
  it('takes what is behind the colon', () => {
    expect(taskSubject('Consultando el proceso: cómo se hace AXIAL')).toBe('cómo se hace AXIAL')
  })

  it('uses the whole task when there is no colon', () => {
    expect(taskSubject('Atendiendo a Juan Pérez')).toBe('atendiendo a Juan Pérez')
  })

  it('lowercases only the first letter, so names and brands keep theirs', () => {
    expect(taskSubject('Atendiendo a Juan Pérez')).toBe('atendiendo a Juan Pérez')
    expect(taskSubject('Cotizando PolySack 25kg')).toBe('cotizando PolySack 25kg')
  })

  it('drops a task that is a question — it does not fit mid-sentence', () => {
    expect(taskSubject('Consultando: ¿cómo se hace AXIAL?')).toBe('')
  })

  it('is empty for no task', () => {
    expect(taskSubject(undefined)).toBe('')
    expect(taskSubject(null)).toBe('')
    expect(taskSubject('')).toBe('')
    expect(taskSubject('   ')).toBe('')
  })
})

describe('the subject inside a sentence', () => {
  it('does not repeat the verb the task already starts with', () => {
    const lines = Array.from({ length: 80 }, () => contextualWork('soporte', 'Atendiendo a Juan Pérez'))
    // Ni "voy con atendiendo a Juan Pérez" ni "voy a responder a atendiendo a..."
    for (const line of lines) {
      expect(line, line).not.toMatch(/atendiendo a/i)
    }
  })

  it('keeps the name intact', () => {
    const lines = Array.from({ length: 80 }, () => contextualWork('soporte', 'Atendiendo a Juan Pérez'))
    expect(lines.some(l => /Juan Pérez/.test(l))).toBe(true)
  })

  it('does not repeat the verb on a "Consultando X" task either', () => {
    const lines = Array.from({ length: 80 }, () => contextualWork('comercial', 'Consultando precio PolySack 25kg'))
    for (const line of lines) {
      expect(line, line).not.toMatch(/consultando/i)
    }
  })

  it('keeps a task that already has no verb', () => {
    const lines = Array.from({ length: 80 }, () => contextualWork('clasificador', 'Clasificando tema: productos'))
    expect(lines.some(l => /productos/.test(l))).toBe(true)
  })
})

describe('contextualWork', () => {
  it('always says something for a known role', () => {
    for (const role of ['soporte', 'comercial', 'procesos', 'clasificador', 'atencion-al cliente']) {
      const line = contextualWork(role, 'algo')
      expect(line, role).toBeTruthy()
      expect(line!.length, role).toBeGreaterThan(0)
    }
  })

  it('says something even for an unknown role', () => {
    expect(contextualWork('un-rol-inventado', 'algo')).toBeTruthy()
  })

  it('speaks the role, not a generic line', () => {
    // Con muchas repeticiones tiene que aparecer la voz del rol.
    const lines = Array.from({ length: 60 }, () => contextualWork('comercial', 'Precio PolySack 25kg'))
    const mentionsQuotes = lines.filter(l => /precio|cotiza|tarifa|lista|existencia|cliente/i.test(l))
    expect(mentionsQuotes.length).toBeGreaterThan(0)
  })

  it('uses the task when it fits', () => {
    const lines = Array.from({ length: 80 }, () => contextualWork('comercial', 'Precio PolySack 25kg'))
    const withTask = lines.filter(l => /PolySack/.test(l))
    expect(withTask.length).toBeGreaterThan(0)
  })

  it('never puts a question in the middle of a sentence', () => {
    const lines = Array.from({ length: 80 }, () => contextualWork('procesos', 'Consultando: ¿cómo se hace AXIAL?'))
    for (const line of lines) {
      expect(line).not.toMatch(/\?/)
    }
  })

  it('never leaves the placeholder in', () => {
    const lines = Array.from({ length: 80 }, () => contextualWork('soporte', 'Atendiendo a Juan Pérez'))
    for (const line of lines) {
      expect(line).not.toContain('{s}')
    }
  })

  it('says something different across calls', () => {
    const lines = new Set(Array.from({ length: 40 }, () => contextualWork('soporte', 'x')))
    expect(lines.size).toBeGreaterThan(1)
  })
})

describe('contextualBreak', () => {
  it('always says something', () => {
    expect(contextualBreak('comercial', 'Precio PolySack')).toBeTruthy()
    expect(contextualBreak('comercial', 'Precio PolySack', 'water')).toBeTruthy()
    expect(contextualBreak('desconocido', undefined, 'water')).toBeTruthy()
  })

  it('mentions the work it is leaving', () => {
    const lines = Array.from({ length: 60 }, () => contextualBreak('comercial', 'Precio PolySack 25kg', 'coffee'))
    expect(lines.some(l => /cotizaci|pausa/i.test(l))).toBe(true)
  })

  it('never leaves the placeholder in', () => {
    for (const kind of ['coffee', 'water'] as const) {
      const lines = Array.from({ length: 40 }, () => contextualBreak('soporte', 'Atendiendo a Juan', kind))
      for (const line of lines) expect(line).not.toContain('{s}')
    }
  })
})
