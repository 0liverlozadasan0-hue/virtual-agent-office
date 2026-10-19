/**
 * token.js — generate and validate the office's API token.
 *
 * The office's token is 64 lowercase hex characters (32 random bytes). That
 * shape is what the browser's own check expects for the `#token=` fragment,
 * so a token that does not match it makes the page fall back to read-only.
 *
 *   node server/token.js            → prints a fresh token
 *   node server/token.js --check X  → says whether X is well-formed
 */

import { randomBytes } from 'crypto'
import { fileURLToPath } from 'url'
import { realpathSync } from 'fs'

const TOKEN_PATTERN = /^[0-9a-f]{64}$/

/** A fresh token: 32 random bytes as 64 lowercase hex digits. */
export function generateToken() {
  return randomBytes(32).toString('hex')
}

/** Whether a string is a well-formed office token. */
export function isValidToken(value) {
  return typeof value === 'string' && TOKEN_PATTERN.test(value)
}

/**
 * The token the office should use: the environment's, or a fresh one.
 * A malformed environment token is a misconfiguration worth saying out loud —
 * it would leave the browser read-only with no visible symptom.
 */
export function resolveToken(env = process.env) {
  const fromEnv = (env.AGENT_OFFICE_API_TOKEN || '').trim()
  if (fromEnv) {
    if (!isValidToken(fromEnv)) {
      console.warn(
        '[token] AGENT_OFFICE_API_TOKEN is not 64 lowercase hex characters. ' +
        'The office page will still load, but it stays read-only (the #token= ' +
        'fragment is ignored) and the API expects this exact string. ' +
        'Generate one with: node server/token.js',
      )
    }
    return fromEnv
  }
  return generateToken()
}

// Run directly? (`node server/token.js`). The URL and argv[1] are compared as
// real paths, because the two spell a Windows path differently.
const isMain = (() => {
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1])
  } catch {
    return false
  }
})()

if (isMain) {
  const arg = process.argv[2]
  if (arg === '--check') {
    const value = process.argv[3] || ''
    console.log(isValidToken(value) ? 'valid' : 'INVALID')
    process.exit(isValidToken(value) ? 0 : 1)
  }
  console.log(generateToken())
}
