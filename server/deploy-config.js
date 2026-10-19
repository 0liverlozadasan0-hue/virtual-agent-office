/**
 * deploy-config.js — the environment-driven overrides that let this office run
 * behind a public domain instead of on loopback.
 *
 * Upstream Agent Office is a local-first tool: it binds 127.0.0.1, refuses any
 * Host header that isn't a loopback name (a DNS-rebinding guard) and only
 * allows loopback Origins. That is right for a tool on someone's laptop and
 * wrong for an n8n-driven office on a VPS.
 *
 * Everything here is opt-in: with none of these variables set, the server
 * behaves exactly as upstream does.
 *
 *   AGENT_OFFICE_API_TOKEN   the Bearer token n8n sends. Overrides the
 *                            0600 token file (which is fine on a VPS with a
 *                            single app user but awkward to hand to n8n).
 *   AGENT_OFFICE_PUBLIC_URL  the office's public origin, e.g.
 *                            https://oficina.polyrafia.com. Its hostname is
 *                            added to the allowed hosts and its origin to the
 *                            allowed origins. The port is ignored (a proxy
 *                            terminates TLS on 443).
 *   AGENT_OFFICE_ALLOW_HOSTS comma-separated extra Host names to accept.
 *   AGENT_OFFICE_ALLOW_ORIGINS comma-separated extra Origins to accept.
 */

import { homedir } from 'os'

/** Split a comma-separated env list into trimmed, non-empty entries. */
function envList(name) {
  const raw = process.env[name]
  if (!raw) return []
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

/** The hostname of a URL, or '' when it isn't one. */
function hostnameOf(url) {
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return ''
  }
}

/** The origin (scheme://host[:port]) of a URL, or '' when it isn't one. */
function originOf(url) {
  try {
    return new URL(url).origin.toLowerCase()
  } catch {
    return ''
  }
}

const publicUrl = (process.env.AGENT_OFFICE_PUBLIC_URL || '').trim()

/**
 * Host names (no port) the server answers to. Upstream allows only loopback;
 * a public deployment adds its own domain.
 */
export const ALLOWED_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  '[::1]',
  ...envList('AGENT_OFFICE_ALLOW_HOSTS').map((h) => h.toLowerCase()),
  ...(hostnameOf(publicUrl) ? [hostnameOf(publicUrl)] : []),
])

/**
 * Origins the server accepts browser requests from. Upstream allows only
 * loopback origins on the known dev ports; a public deployment adds its own.
 */
export const ALLOWED_ORIGINS = new Set([
  ...envList('AGENT_OFFICE_ALLOW_ORIGINS').map((o) => o.toLowerCase()),
  ...(originOf(publicUrl) ? [originOf(publicUrl)] : []),
])

/**
 * The token n8n authenticates with. When unset, upstream's own token file is
 * used and the office stays a local-only tool.
 *
 * The shape is 64 lowercase hex characters: the browser's `#token=` fragment
 * check rejects anything else, and a token the page ignores leaves the office
 * read-only with no visible symptom. A misconfigured token is therefore
 * worth saying out loud at boot.
 */
export const API_TOKEN = (process.env.AGENT_OFFICE_API_TOKEN || '').trim()

if (API_TOKEN && !/^[0-9a-f]{64}$/.test(API_TOKEN)) {
  console.warn(
    '[token] AGENT_OFFICE_API_TOKEN is not 64 lowercase hex characters. ' +
    'The API will accept it, but the office page will ignore a #token= fragment ' +
    'with it and stay read-only. Generate a well-formed one with: node server/token.js',
  )
}

/** True when the office is configured to be reachable from outside the host. */
export const IS_PUBLIC = Boolean(publicUrl) || ALLOWED_HOSTS.size > 3 || ALLOWED_ORIGINS.size > 0

/**
 * A one-line summary for the boot log.
 */
export function describeDeployment() {
  if (!IS_PUBLIC) return 'loopback only (local mode)'
  const bits = []
  if (publicUrl) bits.push(`public url ${publicUrl}`)
  if (API_TOKEN) bits.push('api token from environment')
  else bits.push('api token from ~/.agent-office/auth-token')
  return bits.join(' · ')
}
