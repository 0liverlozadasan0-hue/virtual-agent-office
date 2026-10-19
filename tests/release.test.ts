/**
 * Tagged releases. .github/workflows/release.yml builds the desktop installers
 * on a `v*` tag and uploads them to a draft GitHub release, from the `build`
 * section of package.json. These checks keep the workflow, that section and
 * electron/after-pack.cjs in step with each other.
 *
 * The Claude Code plugin (`.claude-plugin/plugin.json` and the
 * `scripts/sync-plugin-version.mjs` that kept its version in step) is not part
 * of this deployment, so there is no `version` script to run any more.
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8')

const pkg = JSON.parse(read('package.json'))
const build = pkg.build
const workflow = read('.github/workflows/release.yml')

describe('the electron-builder configuration a release is built from', () => {
  it('names every installer Agent-Office-<version>-<os>-<arch>.<ext>', () => {
    expect(build.artifactName).toBe('Agent-Office-${version}-${os}-${arch}.${ext}')
  })

  it('publishes to a GitHub draft, in the repository package.json names', () => {
    expect(build.publish).toEqual({ provider: 'github', releaseType: 'draft' })
    expect(pkg.repository.url).toMatch(/^https:\/\/github\.com\/W17ant\/Claude-Office(\.git)?$/)
  })

  it('builds macOS as one dmg per architecture, never universal — after-pack.cjs refuses that', () => {
    expect(build.mac.target).toEqual([{ target: 'dmg', arch: ['arm64', 'x64'] }])
    expect(read('electron/after-pack.cjs')).toMatch(/archName === 'universal'/)
  })

  it('builds an NSIS installer that asks where to install on Windows, and an AppImage on Linux', () => {
    expect(build.win.target).toEqual(['nsis'])
    expect(build.nsis).toMatchObject({ oneClick: false, allowToChangeInstallationDirectory: true })
    expect(build.linux.target).toEqual(['AppImage'])
  })
})

describe('.github/workflows/release.yml', () => {
  it('runs on v* tags and by hand, with a token that may create the release, one run per ref at a time', () => {
    expect(workflow).toMatch(/^on:\n  push:\n    tags: \['v\*'\]\n  workflow_dispatch:/m)
    expect(workflow).toMatch(/^permissions:\n  contents: write/m)
    expect(workflow).toMatch(/^concurrency:\n  group: release-\$\{\{ github\.ref \}\}/m)
  })

  it('builds on all three runners, unsigned, and uploads to the draft', () => {
    for (const os of ['macos-latest', 'windows-latest', 'ubuntu-latest']) {
      expect(workflow).toContain(`os: ${os}`)
    }
    expect(workflow).toContain('npx electron-builder ${{ matrix.args }} --publish always')
    expect(workflow).toContain('GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}')
    expect(workflow).toContain('CSC_IDENTITY_AUTO_DISCOVERY: false')
  })

  it('ships the default boss: the example office.config.json is never copied in', () => {
    expect(workflow).not.toMatch(/cp office\.config\.example\.json/)
  })
})

describe('the Claude Code plugin', () => {
  it('is not part of this deployment: no plugin manifest and no `version` script', () => {
    expect(existsSync(join(ROOT, '.claude-plugin', 'plugin.json'))).toBe(false)
    expect(pkg.scripts.version).toBeUndefined()
  })
})
