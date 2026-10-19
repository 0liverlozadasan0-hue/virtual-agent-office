/**
 * verificar-despliegue.js — comprueba, en local, todo lo que Easypanel hará
 * en el servidor. Si algo falla aquí, fallará allí con un log de 20 líneas.
 *
 *   node verificar-despliegue.js
 *
 * Simula las dos etapas del Dockerfile y levanta el servidor de producción.
 */

import { execSync, spawn } from 'node:child_process'
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(fileURLToPath(import.meta.url))
const PORT = 3399
// 64 hexadecimales, como el que genera `npm run token`: el navegador
// rechaza cualquier otro formato en el fragmento #token=.
const TOKEN = 'a1b2c3d4e5f6'.repeat(5) + 'abcd'

let fallos = 0
const ok = (m) => console.log('  OK    ' + m)
const bad = (m) => { fallos++; console.log('  FALLA ' + m) }
const seccion = (t) => console.log('\n' + t)

const run = (cmd, cwd) =>
  execSync(cmd, { cwd, stdio: 'pipe', shell: process.platform === 'win32' }).toString()

// ─────────────────────────────────────────────────────────────
// 1. Lo que la imagen necesita
// ─────────────────────────────────────────────────────────────
seccion('1. Ficheros que la imagen necesita')

for (const f of ['package.json', 'package-lock.json', 'Dockerfile', '.dockerignore', 'index.html', 'tsconfig.json', 'vite.config.ts', '.env', 'office.config.json']) {
  existsSync(join(ROOT, f)) ? ok(f) : bad(`falta ${f}`)
}
for (const d of ['src', 'public', 'server']) {
  existsSync(join(ROOT, d)) ? ok(`${d}/`) : bad(`falta ${d}/`)
}

// ─────────────────────────────────────────────────────────────
// 2. El package.json tiene que ser UTF-8 valido
// ─────────────────────────────────────────────────────────────
seccion('2. El package.json es UTF-8 valido (sin BOM)')

const raw = readFileSync(join(ROOT, 'package.json'))
if (raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf) {
  bad('tiene BOM: node lo rechaza con ERR_INVALID_PACKAGE_CONFIG')
} else {
  ok('sin BOM')
}
try {
  JSON.parse(raw.toString('utf8'))
  ok('JSON valido')
} catch (e) {
  bad('JSON invalido: ' + e.message)
}
try {
  new TextDecoder('utf-8', { fatal: true }).decode(raw)
  ok('UTF-8 valido')
} catch {
  bad('UTF-8 invalido: hay bytes sueltos (lo escribio una herramienta en ANSI)')
}

// ─────────────────────────────────────────────────────────────
// 3. Etapa build
// ─────────────────────────────────────────────────────────────
seccion('3. Etapa build (npm ci + npm run build)')

const sim = mkdtempSync(join(tmpdir(), 'office-build-'))
try {
  for (const f of ['package.json', 'package-lock.json', 'index.html', 'tsconfig.json', 'vite.config.ts', '.env', 'office.config.json']) {
    cpSync(join(ROOT, f), join(sim, f))
  }
  for (const d of ['src', 'public', 'server']) cpSync(join(ROOT, d), join(sim, d), { recursive: true })

  process.stdout.write('  ...npm ci (puede tardar)')
  run('npm ci --no-audit --no-fund', sim)
  console.log('\r  OK    npm ci                      ')

  process.stdout.write('  ...npm run build (tsc + vite)')
  run('npm run build', sim)
  console.log('\r  OK    npm run build              ')

  existsSync(join(sim, 'dist', 'index.html')) ? ok('dist/index.html generado') : bad('dist/index.html no se genero')
  existsSync(join(sim, 'dist', 'sprites', 'characters')) ? ok('los sprites estan en dist/') : bad('faltan los sprites en dist/')
} catch (e) {
  bad('la etapa build fallo: ' + String(e.stdout || e.message).slice(0, 400))
} finally {
  rmSync(sim, { recursive: true, force: true })
}

// ─────────────────────────────────────────────────────────────
// 4. Etapa runtime
// ─────────────────────────────────────────────────────────────
seccion('4. Etapa runtime (npm ci --omit=dev + arranque)')

const rt = mkdtempSync(join(tmpdir(), 'office-runtime-'))
let server = null
try {
  for (const f of ['package.json', 'package-lock.json', 'office.config.json']) cpSync(join(ROOT, f), join(rt, f))
  for (const d of ['dist', 'server']) cpSync(join(ROOT, d), join(rt, d), { recursive: true })

  process.stdout.write('  ...npm ci --omit=dev')
  run('npm ci --omit=dev --no-audit --no-fund', rt)
  console.log('\r  OK    npm ci --omit=dev         ')

  const pkg = JSON.parse(readFileSync(join(rt, 'package.json'), 'utf8'))
  const runtimeDeps = Object.keys(pkg.dependencies).sort()
  runtimeDeps.join() === 'express,ws'
    ? ok('deps de runtime: ' + runtimeDeps.join(', '))
    : bad('deps de runtime inesperadas: ' + runtimeDeps.join(', '))

  server = spawn(process.execPath, ['server/index.js'], {
    cwd: rt,
    env: { ...process.env, AGENT_OFFICE_API_TOKEN: TOKEN, AGENT_OFFICE_PORT: String(PORT), AGENT_OFFICE_HOST: '127.0.0.1', AGENT_OFFICE_HOME: join(rt, 'data') },
    stdio: 'pipe',
  })
  let log = ''
  server.stdout.on('data', (d) => { log += d.toString() })
  server.stderr.on('data', (d) => { log += d.toString() })

  // Esperar a que levante
  let vivo = false
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 250))
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/health`)
      if (res.ok) { vivo = true; break }
    } catch {}
  }

  if (!vivo) {
    bad('el servidor no levanto:')
    console.log(log.split('\n').slice(0, 12).map((l) => '        ' + l).join('\n'))
  } else {
    ok('el servidor levanto y /health responde')

    const pagina = await fetch(`http://127.0.0.1:${PORT}/`)
    const html = await pagina.text()
    pagina.ok && html.includes('id="root"') ? ok('el frontend se sirve') : bad('el frontend no se sirve')

    const sprite = await fetch(`http://127.0.0.1:${PORT}/sprites/characters/Claude-1-front-left.png`)
    sprite.ok && sprite.headers.get('content-type')?.includes('png') ? ok('los sprites se sirven') : bad('los sprites no se sirven')

    const spawn2 = await fetch(`http://127.0.0.1:${PORT}/api/n8n/agent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ id: 'verificacion', name: 'Verificacion', role: 'soporte', task: 'Comprobando' }),
    })
    const spawnJson = await spawn2.json()
    spawn2.ok && spawnJson.ok ? ok('la API n8n acepta un agente') : bad('la API n8n fallo: ' + JSON.stringify(spawnJson))

    const sinToken = await fetch(`http://127.0.0.1:${PORT}/api/n8n/agents`)
    sinToken.status === 401 ? ok('sin token la API responde 401') : bad(`sin token respondió ${sinToken.status}, deberia ser 401`)

    const tokenMalo = await fetch(`http://127.0.0.1:${PORT}/api/n8n/agents`, { headers: { Authorization: 'Bearer incorrecto' } })
    tokenMalo.status === 401 ? ok('con token incorrecto responde 401') : bad(`con token incorrecto respondió ${tokenMalo.status}`)

    const len = (await (await fetch(`http://127.0.0.1:${PORT}/sprites/characters/Claude-1-front-left.png`)).arrayBuffer()).byteLength
    len > 100 ? ok(`un sprite pesa ${len} bytes`) : bad('un sprite parece vacio')
  }
} catch (e) {
  bad('la etapa runtime fallo: ' + String(e.stdout || e.message).slice(0, 400))
} finally {
  // En Windows el proceso sigue sujetando los archivos: hay que esperar a
  // que muera antes de borrar el directorio, o rmSync falla con EPERM.
  if (server) {
    server.kill()
    await new Promise((r) => setTimeout(r, 800))
  }
  try {
    rmSync(rt, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 })
  } catch {
    // Un temporal que no se puede borrar no es un fallo del despliegue.
  }
}

// ─────────────────────────────────────────────────────────────
// 5. El Dockerfile
// ─────────────────────────────────────────────────────────────
seccion('5. El Dockerfile')

const df = readFileSync(join(ROOT, 'Dockerfile'), 'utf8')
for (const [pat, desc] of [
  [/FROM node:24-alpine AS build/, 'etapa build'],
  [/FROM node:24-alpine AS runtime/, 'etapa runtime'],
  [/npm ci --omit=dev/, 'solo deps de produccion en runtime'],
  [/AGENT_OFFICE_HOST=0\.0\.0\.0/, 'bind en 0.0.0.0 (Traefik lo necesita)'],
  [/HEALTHCHECK/, 'healthcheck'],
  [/\/health/, 'el healthcheck usa /health'],
  [/USER node/, 'usuario sin privilegios'],
  [/AGENT_OFFICE_HOME=\/data/, 'el estado vive en el volumen'],
]) {
  pat.test(df) ? ok(desc) : bad('falta: ' + desc)
}

const di = readFileSync(join(ROOT, '.dockerignore'), 'utf8')
for (const skip of ['node_modules', 'dist', 'docs', 'electron']) {
  new RegExp('^' + skip, 'm').test(di) ? ok('.dockerignore excluye ' + skip) : bad('.dockerignore no excluye ' + skip)
}

// ─────────────────────────────────────────────────────────────
console.log('')
if (fallos === 0) {
  console.log('  TODO CORRECTO — la imagen deberia construir y arrancar en Easypanel.\n')
  process.exit(0)
} else {
  console.log(`  ${fallos} PROBLEMAS\n`)
  process.exit(1)
}
