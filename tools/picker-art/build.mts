#!/usr/bin/env -S npx --no tsx
// Builds the self-hosted music / voice picker art (frontend/public/picker-art/
// emoji/ and flags/) from the pinned upstream sources in
// tools/picker-art/sources.json, and writes the
// content-hashed file map packages/picker-ui/src/icons/sound-art-files.generated.ts.
//
// Dev-time only: the output is committed, so CI and the Docker build never run
// this. Run it after editing sources.json or sound-art-map.ts:
//
//   npx --no tsx tools/picker-art/build.mts
//
// Supply-chain rules (fail closed on any of them):
//   - each pinned commit is a full 40-hex SHA reachable from the upstream `main`;
//   - every downloaded file must match the git blob SHA the pinned tree lists;
//   - downloads come from GitHub's own raw host, never follow a redirect, and
//     are size-capped while streaming;
//   - the whole set is built in tools/picker-art/.work/ (outside public/, so
//     nothing half-built is ever served or committed) and published only when
//     complete.
// A source whose blob, encoding and output are unchanged is reused, not
// re-encoded, so re-running produces no diff.
import { createHash } from "node:crypto"
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { dirname, join, relative } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import sharp from "sharp"

if (process.env.CI) {
  console.error("tools/picker-art/build.mts is a dev-time script; its output is committed. Refusing to run in CI.")
  process.exit(1)
}

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..")
const SOURCES_PATH = join(ROOT, "tools/picker-art/sources.json")
const MANIFEST_PATH = join(ROOT, "tools/picker-art/manifest.json")
const WORK_DIR = join(ROOT, "tools/picker-art/.work")
const OUT_DIR = join(ROOT, "frontend/public/picker-art")
const GENERATED_TS = join(ROOT, "packages/picker-ui/src/icons/sound-art-files.generated.ts")
const MAX_BYTES = 4 * 1024 * 1024

type Kind = "emoji" | "flags"

/** Recorded per file: a change here re-encodes instead of reusing. */
const ENCODING: Readonly<Record<Kind, string>> = {
  emoji: "webp 128x128 contain q82 effort6",
  flags: "webp w120 q90 effort6",
}

interface SourceSet {
  readonly repo: string
  readonly commit: string
  readonly license: string
  readonly files: Readonly<Record<string, string>>
}
interface Sources {
  readonly emoji: SourceSet
  readonly flags: SourceSet
}
interface ManifestEntry {
  readonly source: string
  readonly encoding: string
  readonly file: string
  readonly sha256: string
}

const sources = JSON.parse(readFileSync(SOURCES_PATH, "utf8")) as Sources
const previous: Readonly<Record<string, Partial<ManifestEntry>>> = existsSync(MANIFEST_PATH)
  ? (JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as Record<string, Partial<ManifestEntry>>)
  : {}

const sha256 = (buf: Buffer): string => createHash("sha256").update(buf).digest("hex")
const gitBlobSha = (buf: Buffer): string =>
  createHash("sha1").update(Buffer.concat([Buffer.from(`blob ${buf.length}\0`), buf])).digest("hex")

async function githubApi<T>(path: string): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/vnd.github+json", "User-Agent": "nodaro-picker-art" }
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`
  const res = await fetch(`https://api.github.com/${path}`, { headers, redirect: "error" })
  if (!res.ok) throw new Error(`GitHub API ${path} → HTTP ${res.status}`)
  return (await res.json()) as T
}

async function verifiedTree(set: SourceSet): Promise<ReadonlyMap<string, string>> {
  // A branch or tag name would pass the compare below and silently unpin.
  if (!/^[0-9a-f]{40}$/.test(set.commit)) throw new Error(`${set.repo}: commit must be a full 40-hex SHA, got "${set.commit}"`)
  const cmp = await githubApi<{ status: string }>(`repos/${set.repo}/compare/${set.commit}...main`)
  if (cmp.status !== "ahead" && cmp.status !== "identical") {
    throw new Error(`${set.repo}@${set.commit} is not on upstream main (compare status: ${cmp.status})`)
  }
  const tree = await githubApi<{ truncated: boolean; tree: Array<{ path: string; type: string; sha: string }> }>(
    `repos/${set.repo}/git/trees/${set.commit}?recursive=1`,
  )
  if (tree.truncated) throw new Error(`${set.repo} tree listing is truncated — cannot verify blobs`)
  return new Map(tree.tree.filter((e) => e.type === "blob").map((e) => [e.path, e.sha]))
}

/** Reads a response body, failing as soon as it passes MAX_BYTES. */
async function readCapped(res: Response, url: string): Promise<Buffer> {
  const declared = Number(res.headers.get("content-length") ?? "0")
  if (declared > MAX_BYTES) throw new Error(`${url} → declared size ${declared} is over the cap`)
  if (!res.body) throw new Error(`${url} → empty body`)
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > MAX_BYTES) {
      await reader.cancel()
      throw new Error(`${url} → over the ${MAX_BYTES}-byte cap`)
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks)
}

async function download(set: SourceSet, path: string, expectedBlob: string): Promise<Buffer> {
  const url = `https://raw.githubusercontent.com/${set.repo}/${set.commit}/${path.split("/").map(encodeURIComponent).join("/")}`
  const res = await fetch(url, { redirect: "manual" })
  if (res.status !== 200) throw new Error(`${url} → HTTP ${res.status} (redirects are refused)`)
  const buf = await readCapped(res, url)
  if (buf.length === 0) throw new Error(`${url} → empty file`)
  const actual = gitBlobSha(buf)
  if (actual !== expectedBlob) throw new Error(`${url} → blob ${actual} does not match the pinned tree (${expectedBlob})`)
  return buf
}

async function encode(kind: Kind, buf: Buffer): Promise<Buffer> {
  const img = kind === "emoji"
    ? sharp(buf).resize(128, 128, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    : sharp(buf).resize({ width: 120 })
  const out = await img.webp({ quality: kind === "emoji" ? 82 : 90, effort: 6 }).toBuffer()
  const meta = await sharp(out).metadata()
  if (meta.format !== "webp" || !meta.width || !meta.height) throw new Error("encoded output is not a valid WebP")
  return out
}

/** Every asset key the art map references — the build fails on any without a source. */
async function referencedKeys(): Promise<ReadonlySet<string>> {
  const mod = (await import(pathToFileURL(join(ROOT, "packages/picker-ui/src/icons/sound-art-map.ts")).href)) as {
    SOUND_ART: Record<string, Record<string, Record<string, string>>>
  }
  const keys = new Set<string>()
  for (const byField of Object.values(mod.SOUND_ART)) {
    for (const byId of Object.values(byField)) for (const key of Object.values(byId)) keys.add(key)
  }
  return keys
}

/** Relative paths ("emoji/x.webp") of every file under `root`. */
function filesUnder(root: string): string[] {
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name)
      return statSync(path).isDirectory() ? walk(path) : [relative(root, path).split("\\").join("/")]
    })
  return existsSync(root) ? walk(root) : []
}

/**
 * Make OUT_DIR's emoji/ and flags/ folders hold exactly the finished build:
 * drop files the build no longer has, copy the rest in. Other folders under
 * OUT_DIR belong to other builds (character/ → character-art.mts) and are left
 * alone. Runs only after the whole set built and verified, and never renames
 * the folder the Vite dev server watches (that fails with EPERM on Windows). If
 * a copy fails midway, re-run: the build is idempotent and the committed state
 * is one `git checkout` away.
 */
function publish(build: string): void {
  mkdirSync(OUT_DIR, { recursive: true })
  const wanted = new Set(filesUnder(build))
  const owned = (rel: string): boolean => rel.startsWith("emoji/") || rel.startsWith("flags/")
  for (const rel of filesUnder(OUT_DIR)) if (owned(rel) && !wanted.has(rel)) rmSync(join(OUT_DIR, rel))
  for (const rel of wanted) {
    mkdirSync(dirname(join(OUT_DIR, rel)), { recursive: true })
    copyFileSync(join(build, rel), join(OUT_DIR, rel))
  }
}

async function main(): Promise<void> {
  const referenced = await referencedKeys()
  const declared = new Set<string>([
    ...Object.keys(sources.emoji.files).map((s) => `emoji/${s}`),
    ...Object.keys(sources.flags.files).map((c) => `flags/${c}`),
  ])
  const missing = [...referenced].filter((k) => !declared.has(k))
  const unused = [...declared].filter((k) => !referenced.has(k))
  if (missing.length) throw new Error(`keys with no source in sources.json: ${missing.join(", ")}`)
  if (unused.length) throw new Error(`sources nothing references (remove them): ${unused.join(", ")}`)

  const build = join(WORK_DIR, `build-${process.pid}`)
  rmSync(build, { recursive: true, force: true })
  let manifest: Record<string, ManifestEntry>
  try {
    manifest = await buildInto(build)
  } catch (err) {
    rmSync(build, { recursive: true, force: true })
    throw err
  }

  publish(build)
  rmSync(build, { recursive: true, force: true })

  const sorted = Object.keys(manifest).sort()
  writeFileSync(MANIFEST_PATH, JSON.stringify(Object.fromEntries(sorted.map((k) => [k, manifest[k]])), null, 2) + "\n")
  const lines = sorted.map((k) => `  ${JSON.stringify(k)}: ${JSON.stringify(manifest[k].file)},`)
  writeFileSync(
    GENERATED_TS,
    `// GENERATED by tools/picker-art/build.mts — do not edit. Asset key → content-hashed\n` +
      `// file under frontend/public/picker-art/.\n` +
      `export const SOUND_ART_FILES = {\n${lines.join("\n")}\n} as const\n`,
  )
}

async function buildInto(build: string): Promise<Record<string, ManifestEntry>> {
  const manifest: Record<string, ManifestEntry> = {}
  let encoded = 0
  let reused = 0

  for (const kind of ["emoji", "flags"] as const) {
    const set = sources[kind]
    const tree = await verifiedTree(set)
    mkdirSync(join(build, kind), { recursive: true })

    const licenseBlob = tree.get(set.license)
    if (!licenseBlob) throw new Error(`${set.repo}@${set.commit} has no ${set.license}`)
    const license = await download(set, set.license, licenseBlob)
    const note = `The images in this folder are derived from https://github.com/${set.repo} at commit ${set.commit}:\nresized and re-encoded to WebP. The upstream license follows, unchanged.\n\n`
    writeFileSync(join(build, kind, "LICENSE.txt"), Buffer.concat([Buffer.from(note), license]))

    for (const [name, path] of Object.entries(set.files)) {
      const key = `${kind}/${name}`
      const blob = tree.get(path)
      if (!blob) throw new Error(`${set.repo}@${set.commit} has no ${path}`)
      const prior = previous[key]
      const priorFile = prior?.file ? join(OUT_DIR, prior.file) : ""
      let out: Buffer
      if (
        prior && prior.source === blob && prior.encoding === ENCODING[kind] &&
        priorFile && existsSync(priorFile) && sha256(readFileSync(priorFile)) === prior.sha256
      ) {
        out = readFileSync(priorFile)
        reused++
      } else {
        out = await encode(kind, await download(set, path, blob))
        encoded++
      }
      const digest = sha256(out)
      const file = `${kind}/${name}.${digest.slice(0, 8)}.webp`
      writeFileSync(join(build, file), out)
      manifest[key] = { source: blob, encoding: ENCODING[kind], file, sha256: digest }
    }
  }
  console.log(`picker-art: ${Object.keys(manifest).length} files (${encoded} encoded, ${reused} reused)`)
  return manifest
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
