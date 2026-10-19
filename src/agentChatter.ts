/**
 * agentChatter.ts — charla contextual por rol y tarea.
 *
 * El chat de la oficina tiene dos capas: lo que dice el servidor (los
 * "starting:" / "done:" que n8n produce) y la charla de los personajes.
 *
 * Esta segunda capa es la que hacía el upstream con una IA (un watcher que
 * corría `claude -p`): frases genéricas ("on it", "typing furiously"). Eso
 * cuesta tokens, un proceso extra en el servidor y la CLI de Claude
 * instalada — para un texto decorativo.
 *
 * Aquí lo mismo se resuelve con cero tokens: cada rol habla de lo que
 * realmente está haciendo. El comercial habla de cotizaciones, el de
 * procesos habla de manuales y diagramas, el de soporte habla del cliente
 * que espera. Y cuando la tarea lo permite, la frase la nombra.
 *
 * Todo es local: ni una llamada, ni un token.
 */

/** El vocabulario de un rol. */
interface RoleVocab {
  /**
   * Que la charla contextual gane siempre, incluso con el tema de The Office
   * puesto. Es para los roles de una oficina de n8n: un agente de soporte de
   * Polyrafia no puede hablar de "it is not DNS" aunque el usuario haya
   * puesto el tema de la serie.
   */
  always?: boolean
  /** Frases que no necesitan la tarea. */
  plain: string[]
  /** Frases que meten el asunto de la tarea; `{s}` es el asunto. */
  withTask: string[]
  /** Frases de descanso (café o agua). */
  rest: string[]
}

/**
 * El asunto de una tarea: lo que va detrás de los dos puntos.
 *
 * "Consultando el proceso: ¿Cómo se hace AXIAL?" → "¿Cómo se hace AXIAL?"
 * "Atendiendo a Juan Pérez"                     → "Atendiendo a Juan Pérez"
 *
 * Una pregunta no sirve como sujeto de en medio de una frase ("el cliente
 * pregunta por ¿Cómo se hace AXIAL?"), así que se descarta: las frases con
 * `{s}` no se usan en ese caso y quedan las de `plain`.
 */
export function taskSubject(task?: string | null): string {
  if (!task) return ''
  const raw = String(task).trim()
  if (!raw) return ''
  if (raw.includes('?')) return ''
  const colon = raw.indexOf(':')
  const subject = (colon >= 0 ? raw.slice(colon + 1) : raw).trim()
  if (!subject) return ''
  // Solo la primera letra baja: "Atendiendo a Juan Pérez" → "atendiendo a
  // Juan Pérez" (el nombre conserva su mayúscula) y "Precio PolySack" →
  // "precio PolySack" (la marca también).
  return subject.charAt(0).toLowerCase() + subject.slice(1)
}

/**
 * El sujeto sin el verbo con el que ya empieza.
 *
 * Las tareas de n8n ya son frases ("Atendiendo a Juan Pérez", "Consultando
 * precio PolySack 25kg"), así que ponerlas detrás de otro verbo produce
 * "voy con atendiendo a Juan Pérez". Quitar el gerundio deja el objeto
 * solo: "voy con a Juan Pérez" tampoco mola, así que en ese caso el
 * asunto no se usa y la frase del rol se queda sin objeto.
 */
function subjectWithoutVerb(subject: string): string {
  const m = /^(atendiendo|consultando|cotizando|respondiendo|revisando|buscando|analizando|clasificando|preparando|redactando|enviando|revisando)\s+/i.exec(subject)
  if (!m) return subject
  const rest = subject.slice(m[0].length).trim()
  // "a Juan Pérez" → "Juan Pérez" (el artículo se cuela)
  return rest.replace(/^[aá]\s+/i, '')
}

/** Los roles de una oficina de n8n (Polyrafia) y los del upstream. */
const VOCAB: Record<string, RoleVocab> = {
  // ── Polyrafia ──────────────────────────────────────────────────
  soporte: {
    always: true,
    plain: [
      'el cliente espera',
      'voy a responder con calma',
      'ya le contesto',
      'revisando la duda',
      'un momento por favor',
      'a ver si lo ubico',
    ],
    withTask: [
      'voy a responder a {s}',
      'tengo a {s} esperando',
      'me pongo con {s}',
      'a ver qué necesita {s}',
    ],
    rest: [
      'un café y vuelvo',
      'la cola de clientes no se mueve sola',
      'tomo agua y sigo',
    ],
  },
  comercial: {
    always: true,
    plain: [
      'el precio no se sabe solo',
      'voy a revisar la lista',
      'falta confirmar la existencia',
      'el cliente ya se impacienta',
      'busco la tarifa vigente',
    ],
    withTask: [
      'ya casi mando lo de {s}',
      'confirmando {s}',
      'trabajando en {s}',
      'el cliente volvió por {s}',
    ],
    rest: [
      'voy por un café, las cotizaciones esperan',
      'descanso un momento y vuelvo a la tarifa',
    ],
  },
  procesos: {
    always: true,
    plain: [
      'el manual no es claro',
      'revisando el diagrama',
      'esto tiene muchos pasos',
      'buscando la norma',
      'el diagrama no coincide con el texto',
    ],
    withTask: [
      'consultando {s}',
      'ya encontré {s}',
      'revisando {s} paso a paso',
      'el proceso de {s} no está claro',
    ],
    rest: [
      'un café y vuelvo a los manuales',
      'tomo agua, los diagramas esperan',
    ],
  },
  clasificador: {
    always: true,
    plain: [
      '¿procesos o productos?',
      'a ver de qué va esto',
      'esto no está claro',
      'lo encajo en alguna parte',
      'hmm, este caso es raro',
    ],
    withTask: [
      'clasificando {s}',
      'esto huele a {s}',
      'creo que es {s}',
      'encajando {s}',
    ],
    rest: [
      'un café y vuelvo a ordenar',
      'tomo agua mientras ordeno las consultas',
    ],
  },
  'atencion-al cliente': {
    always: true,
    plain: [
      'una duda general',
      'a ver si sé',
      'lo busco',
      'creo que sí',
      'eso se responde rápido',
    ],
    withTask: [
      'revisando {s}',
      'sobre {s}... un segundo',
      'voy con {s}',
      'esto de {s} lo atendemos',
    ],
    rest: [
      'un café y vuelvo',
      'tomo agua un momento',
    ],
  },

  // ── Upstream (roles de desarrollo) ─────────────────────────────
  debugger: {
    plain: ['reproduciendo el fallo', 'añadí un log', 'vaya, era esto', 'stack overflow al rescate'],
    withTask: ['voy con {s}', 'depurando {s}'],
    rest: ['necesito café para leer este stack'],
  },
  'code-reviewer': {
    plain: ['leyendo el diff', 'hmm, este cambio', 'un comentario más', 'apruebo con reservas'],
    withTask: ['revisando {s}', 'el diff de {s} tiene cosas'],
    rest: ['café y vuelvo al diff'],
  },
  'test-engineer': {
    plain: ['el test falló', 'lo reproduje', 'coverage subió', 'failing test otra vez'],
    withTask: ['probando {s}', 'el test de {s} sigue rojo'],
    rest: ['café, que los tests no se pasan solos'],
  },
  'frontend-developer': {
    plain: ['un refactor más', 'cambió el layout', 'CSS duel', 'lo probé en el navegador'],
    withTask: ['estoy con {s}', 'arreglando {s}'],
    rest: ['café y vuelvo al CSS'],
  },
  'devops-engineer': {
    plain: ['pipeline en verde', 'desplegando', 'reviso los logs', 'la CI tardó'],
    withTask: ['deployando {s}', 'mirando {s} en los logs'],
    rest: ['café mientras corren los pipelines'],
  },
}

/** El vocabulario por defecto cuando el rol no tiene uno propio. */
const DEFAULT_VOCAB: RoleVocab = {
  plain: ['en ello', 'dale', 'voy avanzando', 'un momento', 'sigo con ello'],
  withTask: ['voy con {s}', 'me pongo con {s}', 'tengo {s} entre manos'],
  rest: ['un café y vuelvo', 'tomo agua un momento'],
}

function vocabFor(role: string): RoleVocab {
  return VOCAB[role] ?? DEFAULT_VOCAB
}

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

/** Si un rol prefiere siempre su charla contextual al tema de The Office. */
export function isAlwaysContextual(role: string): boolean {
  return vocabFor(role).always === true
}

/**
 * El sujeto listo para meterse en una frase: sin el gerundio con el que
 * empieza la tarea ("Consultando precio X" → "precio X").
 */
function usableSubject(task?: string | null): string {
  const subject = taskSubject(task)
  if (!subject) return ''
  const bare = subjectWithoutVerb(subject)
  // "a Juan Pérez" → "Juan Pérez" ya lo resuelve el helper; si aun así se
  // queda corto ("atendiendo a" sin nombre), mejor no usarlo.
  if (bare.length < 3) return ''
  return bare
}

/** Una frase de trabajo que tenga en cuenta el rol y la tarea. */
export function contextualWork(role: string, task?: string | null): string | null {
  const v = vocabFor(role)
  const subject = usableSubject(task)
  if (subject && v.withTask.length) {
    // 70% con la tarea, 30% la frase genérica del rol: que no suene a
    // robot repitiendo la misma estructura.
    if (Math.random() < 0.7) return pick(v.withTask).replace('{s}', subject)
  }
  return v.plain.length ? pick(v.plain) : null
}

/** Una frase de descanso (café o agua) del rol. */
export function contextualBreak(role: string, task?: string | null, kind: 'coffee' | 'water' = 'coffee'): string | null {
  const v = vocabFor(role)
  const subject = usableSubject(task)
  if (subject && v.rest.length && Math.random() < 0.5) {
    return pick(v.rest).replace('{s}', subject)
  }
  if (v.rest.length) return pick(v.rest)
  return kind === 'water' ? 'tomo agua un momento' : 'un café y vuelvo'
}
