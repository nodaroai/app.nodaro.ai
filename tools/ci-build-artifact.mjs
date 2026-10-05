#!/usr/bin/env node
// Current-run build reuse only. Dependencies remain clean npm ci installs.
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { execFileSync } from 'node:child_process'

const outputs = {
  packages: ['packages/shared/dist', 'packages/prompts/dist', 'packages/client/dist', 'packages/picker-ui/dist', 'packages/render-rules/dist'],
  backend: ['backend/dist'],
}
const hash = path => createHash('sha256').update(readFileSync(path)).digest('hex')
try {
  const [command, kind, destination] = process.argv.slice(2)
  if (!['pack', 'restore'].includes(command) || !outputs[kind] || !destination) {
    throw new Error('Usage: ci-build-artifact.mjs pack|restore packages|backend DIRECTORY')
  }
  const { GITHUB_SHA: sha, GITHUB_RUN_ID: run } = process.env
  if (!sha || !run) throw new Error('GitHub commit and run identity are required')
  const identity = {
    version: 1, kind, sha, run, lock: hash('package-lock.json'),
    node: process.versions.node.split('.')[0], platform: process.platform, arch: process.arch,
  }
  const dir = resolve(destination)
  const archive = join(dir, 'outputs.tgz')
  const manifest = join(dir, 'manifest.json')
  if (command === 'pack') {
    for (const path of outputs[kind]) {
      if (readdirSync(path).length === 0) throw new Error(`Empty build output: ${path}`)
    }
    mkdirSync(dir, { recursive: true })
    execFileSync('tar', ['-czf', archive, ...outputs[kind]])
    writeFileSync(manifest, JSON.stringify({ identity, checksum: hash(archive) }))
  } else {
    const saved = JSON.parse(readFileSync(manifest, 'utf8'))
    if (JSON.stringify(saved.identity) !== JSON.stringify(identity)) {
      throw new Error('Build artifact identity mismatch')
    }
    if (saved.checksum !== hash(archive)) throw new Error('Build artifact checksum mismatch')
    execFileSync('tar', ['-xzf', archive])
  }
  console.log(`${command}: verified ${kind} outputs for ${sha}`)
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
}
