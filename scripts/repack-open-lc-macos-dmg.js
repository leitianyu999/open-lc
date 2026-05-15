#!/usr/bin/env bun
import { copyFileSync, existsSync, mkdirSync, readdirSync, readlinkSync, rmSync, symlinkSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
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

const copyRecursive = (from, to) => {
  const entries = readdirSync(from, { withFileTypes: true })
  mkdirSync(to, { recursive: true })

  for (const entry of entries) {
    const source = join(from, entry.name)
    const targetPath = join(to, entry.name)

    if (entry.isSymbolicLink()) {
      symlinkSync(readlinkSync(source), targetPath)
      continue
    }

    if (entry.isDirectory()) {
      copyRecursive(source, targetPath)
      continue
    }

    if (entry.isFile()) {
      mkdirSync(dirname(targetPath), { recursive: true })
      copyFileSync(source, targetPath)
    }
  }
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

if (!tarPath) {
  console.error(`No .app.tar.zst found under ${buildDir}`)
  process.exit(1)
}

const workDir = join(buildDir, '.release-dmg')
const extractedDir = join(workDir, 'extracted')
const stagingDir = join(workDir, 'staging')

rmSync(workDir, { recursive: true, force: true })
mkdirSync(extractedDir, { recursive: true })
mkdirSync(stagingDir, { recursive: true })
mkdirSync(artifactsDir, { recursive: true })

run('tar', ['--extract', '--file', tarPath, '--directory', extractedDir])

const appPath = findFirst(extractedDir, (path, entry) => entry.isDirectory() && path.endsWith('.app'))
if (!appPath) {
  console.error(`No .app bundle found in ${tarPath}`)
  process.exit(1)
}

const stagedAppPath = join(stagingDir, basename(appPath))
copyRecursive(appPath, stagedAppPath)
symlinkSync('/Applications', join(stagingDir, 'Applications'))

rmSync(artifactPath, { force: true })
run('hdiutil', [
  'create',
  '-volname',
  'LC Agent',
  '-srcfolder',
  stagingDir,
  '-ov',
  '-format',
  'ULFO',
  artifactPath,
])
run('hdiutil', ['verify', artifactPath])

if (!existsSync(artifactPath)) {
  console.error(`Expected DMG was not created: ${artifactPath}`)
  process.exit(1)
}

rmSync(workDir, { recursive: true, force: true })
console.log(`Repacked macOS DMG: ${artifactPath}`)
