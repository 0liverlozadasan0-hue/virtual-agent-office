/**
 * sqlite-compat.js — a drop-in replacement for the `better-sqlite3` API,
 * backed by Node's built-in `node:sqlite` (DatabaseSync).
 *
 * Why: better-sqlite3 is a native module. It needs node-gyp + a C toolchain
 * at install time, which breaks on Windows, on Hostinger's shared hosting and
 * on any deploy without a compiler. `node:sqlite` ships with Node itself, so
 * the office installs anywhere with zero native builds.
 *
 * Only the surface chat-db.js actually uses is emulated:
 *   new Database(path)      → openDatabase(path)
 *   db.pragma('...')        → PRAGMA via exec
 *   db.exec(sql)            → native
 *   db.prepare(sql)         → native
 *   stmt.run/get/all(params)→ native (named @param/:param objects work)
 *   stmt.run(...) → { changes, lastInsertRowid }  → native
 *   db.transaction(fn)      → manual BEGIN/COMMIT/ROLLBACK
 *
 * Node 22 needs `--experimental-sqlite`; Node 24+ has it stable. On older
 * runtimes the chat history degrades to an in-memory stub so the office still
 * runs (the chat panel just stops persisting between restarts).
 */

let DatabaseSync = null
let sqliteAvailable = false
try {
  const mod = await import('node:sqlite')
  DatabaseSync = mod.DatabaseSync
  sqliteAvailable = true
} catch {
  sqliteAvailable = false
}

/** In-memory fallback used when node:sqlite is unavailable. */
class MemoryDatabase {
  constructor() {
    this.statements = []
    this.execCount = 0
  }
  pragma() { return this }
  exec(sql) {
    this.execCount++
    // Only CREATE TABLE matters for the fallback's shape.
    if (/CREATE TABLE/i.test(sql)) {
      const m = /CREATE TABLE\s+(?:IF NOT EXISTS\s+)?([A-Za-z0-9_]+)/i.exec(sql)
      if (m && !this.statements.some((s) => s.startsWith('__table__' + m[1]))) {
        this.statements.push('__table__' + m[1])
      }
    }
  }
  prepare(sql) {
    const stub = {
      run: () => ({ changes: 0, lastInsertRowid: 0 }),
      get: () => undefined,
      all: () => [],
    }
    return stub
  }
  transaction(fn) {
    return (...args) => fn(...args)
  }
  close() {}
}

/**
 * The named parameters a SQL statement declares (without their `@`/`:`/`$`
 * prefix), ignoring anything that sits inside a string literal.
 *
 * better-sqlite3 binds a named-parameter object by walking the *statement's*
 * parameters and looking each one up in the object: a key the statement does
 * not declare is ignored, and a parameter the statement declares but the
 * object lacks is an error. node:sqlite does the opposite — it walks the
 * *object* and refuses a key the statement does not declare. To be a
 * drop-in, the shim has to hand node:sqlite only the keys the statement
 * actually declares.
 */
function declaredParams(sql) {
  // Strip single-quoted string literals first: a ':' inside one is text.
  const stripped = String(sql).replace(/'(?:[^']|'')*'/g, "''")
  const names = new Set()
  for (const match of stripped.matchAll(/[:@$]([A-Za-z_][A-Za-z0-9_]*)/g)) names.add(match[1])
  return names
}

/** Wrap a node:sqlite statement so it binds like better-sqlite3's. */
function compatStatement(stmt, sql) {
  const allowed = declaredParams(sql)

  /** Keep only the keys the statement declares (extra ones are ignored). */
  function filter(params) {
    if (!params || typeof params !== 'object' || Array.isArray(params)) return params
    const out = {}
    for (const [key, value] of Object.entries(params)) {
      if (allowed.has(key)) out[key] = value
    }
    return out
  }

  const originalGet = stmt.get.bind(stmt)
  const originalAll = stmt.all.bind(stmt)
  const originalRun = stmt.run.bind(stmt)

  stmt.get = (...args) => originalGet(...args.map(a => (a && typeof a === 'object' && !Array.isArray(a) ? filter(a) : a)))
  stmt.all = (...args) => originalAll(...args.map(a => (a && typeof a === 'object' && !Array.isArray(a) ? filter(a) : a)))
  stmt.run = (...args) => originalRun(...args.map(a => (a && typeof a === 'object' && !Array.isArray(a) ? filter(a) : a)))

  return stmt
}

/**
 * Open a database file with the better-sqlite3-ish surface.
 * @param {string} path file path, or ':memory:'
 */
export function openDatabase(path) {
  if (!sqliteAvailable) {
    console.warn(
      '[sqlite] node:sqlite unavailable (Node < 22 without --experimental-sqlite). ' +
        'Chat history will not persist.',
    )
    return new MemoryDatabase()
  }

  const db = new DatabaseSync(path)

  // better-sqlite3's db.prepare(sql) — the statement binds like better-sqlite3's
  const nativePrepare = db.prepare.bind(db)
  db.prepare = (sql) => compatStatement(nativePrepare(sql), sql)

  // better-sqlite3's db.pragma('journal_mode = WAL')
  db.pragma = (statement) => {
    try {
      db.exec(`PRAGMA ${statement}`)
    } catch {
      /* an unsupported pragma must not take the server down */
    }
    return db
  }

  // better-sqlite3's db.transaction(fn) — returns a wrapped fn that runs
  // inside BEGIN/COMMIT and rolls back on throw.
  db.transaction = (fn) => {
    return (...args) => {
      db.exec('BEGIN')
      try {
        const result = fn(...args)
        db.exec('COMMIT')
        return result
      } catch (err) {
        try {
          db.exec('ROLLBACK')
        } catch {
          /* the transaction may already be closed */
        }
        throw err
      }
    }
  }

  return db
}

export { sqliteAvailable }
