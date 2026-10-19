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
