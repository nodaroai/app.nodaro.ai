#!/usr/bin/env node
// Guards the manifests of the PUBLISHED workspace packages (packages/* with
// `private` !== true) against intra-workspace dependency ranges that do not
// survive `npm publish`.
//
// npm workspaces resolve `"@nodaro/shared": "*"` to the local sibling while
// developing, but `npm publish` copies the manifest VERBATIM — the registry
// then tells every consumer "any version of @nodaro/shared is fine", so a
// consumer's lockfile keeps whatever old @nodaro/shared it already had and the
// new package fails at runtime with "does not provide an export named …"
// (@nodaro/prompts@1.8.0 shipped exactly that, 2026-08-28, and studio had to
// bump @nodaro/shared by hand).
//
// Rule: every `@nodaro/*` dependency of a published package must be a plain
// caret / tilde / exact semver range that the sibling's CURRENT workspace
// version satisfies — so the workspace still links locally AND the registry
// gets a range consumers can trust. changesets keeps such ranges bumped
// (`updateInternalDependencies: "patch"` in .changeset/config.json); a
// wildcard is the one shape it silently leaves alone.
//
// Runs in CI (Check EE Imports job) and in the release workflow's pre-publish
// leak gate. Run locally: node tools/check-published-manifests.mjs

import { readdirSync, readFileSync, existsSync } from "node:fs"
import { join } from "node:path"

const PACKAGES_DIR = "packages"
const SCOPE = "@nodaro/"
const DEP_FIELDS = ["dependencies", "peerDependencies", "optionalDependencies"]
const RANGE_RE = /^([\^~]?)(\d+)\.(\d+)\.(\d+)$/

function readManifest(dir) {
  const file = join(PACKAGES_DIR, dir, "package.json")
  if (!existsSync(file)) return null
  return { file, json: JSON.parse(readFileSync(file, "utf8")) }
}

/** Minimal semver-range check for the three shapes the rule allows. */
export function satisfies(version, range) {
  const r = RANGE_RE.exec(range)
  const v = /^(\d+)\.(\d+)\.(\d+)$/.exec(version)
  if (!r || !v) return false
  const [, op, M, m, p] = r
  const base = [Number(M), Number(m), Number(p)]
  const cur = [Number(v[1]), Number(v[2]), Number(v[3])]
  const cmp = cur[0] - base[0] || cur[1] - base[1] || cur[2] - base[2]
  if (op === "") return cmp === 0
  if (cmp < 0) return false
  if (op === "~") return cur[0] === base[0] && cur[1] === base[1]
  // caret: same major; when major is 0, same minor as well
  if (cur[0] !== base[0]) return false
  if (base[0] === 0 && cur[1] !== base[1]) return false
  return true
}

export function checkManifests(manifests) {
  const versions = new Map(manifests.map((m) => [m.json.name, m.json.version]))
  const violations = []
  for (const { file, json } of manifests) {
    if (json.private === true) continue
    for (const field of DEP_FIELDS) {
      for (const [dep, range] of Object.entries(json[field] ?? {})) {
        if (!dep.startsWith(SCOPE)) continue
        const local = versions.get(dep)
        if (!RANGE_RE.test(String(range))) {
          violations.push(`${file}: ${field}["${dep}"] = "${range}" — must be a plain ^x.y.z / ~x.y.z / x.y.z range (wildcards, workspace:, file:, link:, tags and compound ranges do not survive npm publish)`)
          continue
        }
        if (local && !satisfies(local, String(range))) {
          violations.push(`${file}: ${field}["${dep}"] = "${range}" does not match the workspace sibling's current version ${local} — the workspace would stop linking locally; bump the range`)
        }
      }
    }
  }
  return violations
}

function main() {
  const manifests = readdirSync(PACKAGES_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => readManifest(d.name))
    .filter(Boolean)
  const published = manifests.filter((m) => m.json.private !== true)
  const violations = checkManifests(manifests)
  if (violations.length > 0) {
    console.error(`${violations.length} published-manifest violation(s):`)
    for (const v of violations) console.error("  " + v)
    console.error("")
    console.error("A published package's @nodaro/* dependency must be a real semver range that the")
    console.error("sibling's workspace version satisfies. changesets bumps it on every release.")
    process.exit(1)
  }
  console.log(`OK: ${published.length} published package manifest(s) declare publishable @nodaro/* ranges (${published.map((m) => m.json.name).join(", ")})`)
}

const invokedDirectly = process.argv[1] && /check-published-manifests\.mjs$/.test(process.argv[1])
if (invokedDirectly) main()
