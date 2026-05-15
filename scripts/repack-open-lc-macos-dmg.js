#!/usr/bin/env bun
import { existsSync, mkdirSync, readdirSync, rmSync, symlinkSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'

const repoRoot = resolve(import.meta.dir, '..')
const target = process.argv[2]
const assetName = process.argv[3]

if (!target || !assetName) {
  console.error('Usage: bun run scripts/repack-open-lc-macos-dmg.js <target> <asset-name>')
  process.exit(1)
}

if (process.platform !== 'darwin') {
  console.error('macOS DMG repackaging must run on macOS')
  process.exit(1)
}

const run = (command, args, options = {}) => {
  console.log(`$ ${command} ${args.map((arg) => JSON.stringify(arg)).join(' ')}`)
  execFileSync(command, args, { stdio: 'inherit', ...options })
}

const findFirst = (root, predicate) => {
  const entries = readdirSync(root, { withFileTypes: true })
  for (const entry of entries) {
    const path = join(root, entry.name)
    if (predicate(path, entry)) return path
    if (entry.isDirectory()) {
      const match = findFirst(path, predicate)
      if (match) return match
    }
  }
  return null
}

const buildRoot = join(repoRoot, 'agent', 'electrobun', 'build')
const candidateBuildDirs = [
  join(buildRoot, `stable-${target}`),
  join(buildRoot, target),
]
const buildDir = candidateBuildDirs.find((dir) => existsSync(dir)) ?? candidateBuildDirs[0]
const artifactsDir = join(repoRoot, 'agent', 'electrobun', 'artifacts')
const artifactPath = join(artifactsDir, assetName)
const tarPath = findFirst(buildDir, (path, entry) => entry.isFile() && path.endsWith('.app.tar.zst'))
const directAppPath = tarPath
  ? null
  : findFirst(buildDir, (path, entry) => entry.isDirectory() && path.endsWith('.app'))

const workDir = join(buildDir, '.release-dmg')
const extractedDir = join(workDir, 'extracted')
const stagingDir = join(workDir, 'staging')

rmSync(workDir, { recursive: true, force: true })
mkdirSync(stagingDir, { recursive: true })
mkdirSync(artifactsDir, { recursive: true })

let appPath = directAppPath

if (tarPath) {
  mkdirSync(extractedDir, { recursive: true })
  run('tar', ['--extract', '--file', tarPath, '--directory', extractedDir])
  appPath = findFirst(extractedDir, (path, entry) => entry.isDirectory() && path.endsWith('.app'))
}

if (!appPath) {
  console.error(`No .app bundle or .app.tar.zst found under ${buildDir}`)
  process.exit(1)
}

const stagedAppPath = join(stagingDir, basename(appPath))
run('ditto', [appPath, stagedAppPath])
run('codesign', ['--force', '--deep', '--sign', '-', stagedAppPath])
run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', stagedAppPath])
symlinkSync('/Applications', join(stagingDir, 'Applications'))

rmSync(artifactPath, { force: true })
run('hdiutil', [
  'create',
  '-volname',
  'LC Agent',
  '-srcfolder',
  stagingDir,
  '-ov',
  '-fs',
  'HFS+',
  '-format',
  'UDZO',
  artifactPath,
])
run('hdiutil', ['verify', artifactPath])

if (!existsSync(artifactPath)) {
  console.error(`Expected DMG was not created: ${artifactPath}`)
  process.exit(1)
}

rmSync(workDir, { recursive: true, force: true })
console.log(`Repacked macOS DMG: ${artifactPath}`)
