/**
 * How this deployment ships.
 *
 * The upstream released tagged desktop installers (electron-builder) from
 * `.github/workflows/release.yml`. This deployment is a server for an n8n
 * workflow: it ships as a Docker image built from the Dockerfile, deployed by
 * Easypanel. There is no desktop installer and no release workflow, and the
 * checks below keep it that way.
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8')

const pkg = JSON.parse(read('package.json'))
const dockerfile = read('Dockerfile')
const dockerignore = read('.dockerignore')

describe('the Docker image', () => {
  it('builds the frontend in one stage and runs the server in another', () => {
    expect(dockerfile).toMatch(/FROM node:24-alpine AS build/)
    expect(dockerfile).toMatch(/FROM node:24-alpine AS runtime/)
    expect(dockerfile).toMatch(/npm run build/)
  })

  it('runs as a non-root user and binds every interface', () => {
    // Traefik reaches the container through the Docker network: a bind on
    // 127.0.0.1 would be unreachable.
    expect(dockerfile).toMatch(/ENV AGENT_OFFICE_HOST=0\.0\.0\.0/)
    expect(dockerfile).toMatch(/USER node/)
  })

  it('keeps the runtime image lean: production deps only', () => {
    expect(dockerfile).toMatch(/npm ci --omit=dev/)
  })

  it('checks health on the endpoint the server actually answers', () => {
    // /health is the upstream's; /api/health is the n8n bridge's and /api/health
    // is NOT a route on the server.
    expect(dockerfile).toMatch(/HEALTHCHECK/)
    expect(dockerfile).toMatch(/\/health/)
  })

  it('leaves out what the runtime does not need', () => {
    for (const skipped of ['node_modules', 'dist', 'docs', 'electron']) {
      expect(dockerignore, skipped).toMatch(new RegExp(`^${skipped}`, 'm'))
    }
  })
})

describe('the package manifest', () => {
  it('is valid UTF-8 without a BOM: Node refuses to start otherwise', () => {
    // A BOM (or a stray byte from a bad editor) makes node fail with
    // ERR_INVALID_PACKAGE_CONFIG, and it takes the whole image down.
    const bytes = readFileSync(join(ROOT, 'package.json'))
    expect(bytes[0]).toBe(0x7b) // '{'
    expect(bytes.subarray(0, 3).toString('hex')).not.toBe('efbbbf')
    expect(() => JSON.parse(bytes.toString('utf8'))).not.toThrow()
  })

  it('declares the Node version the built-in sqlite needs', () => {
    expect(pkg.engines.node).toBe('>=22')
  })

  it('starts the server, not the desktop app', () => {
    expect(pkg.main).toBe('server/index.js')
    expect(pkg.scripts.start).toBe('node server/index.js')
  })

  it('keeps react out of the runtime dependencies: it is bundled at build time', () => {
    expect(Object.keys(pkg.dependencies).sort()).toEqual(['express', 'ws'])
    expect(pkg.devDependencies).toHaveProperty('react')
  })

  it('has no electron-builder configuration: there is no desktop release', () => {
    expect(pkg.build).toBeUndefined()
    expect(existsSync(join(ROOT, '.github', 'workflows', 'release.yml'))).toBe(false)
  })
})
