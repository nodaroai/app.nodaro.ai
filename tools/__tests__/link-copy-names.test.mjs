// Every surface that takes a link to a video (the editor's Video URL node, a
// published app's video-link input, the admin trends source intake, the
// server's refusals, the SDK, the CLI and the docs) says "a link to where the
// video is" and never names the sites the link may come from. The one place a
// site's host may appear is the allowlist the server checks a link against
// (`packages/shared/src/video-link.ts`); copy stays generic so the product
// never advertises what it downloads from (decided 2026-11-02).
//
// Out of scope, on purpose: labels that name the site of a link the person
// ALREADY pasted (the Video URL node's "TikTok Video" title and badge, the
// admin intake's "From TikTok"), the Reference Audio node (one site by design),
// the social-posting nodes, Social Search, and the node-docs summaries that are
// a snapshot of the live docs site.
//
// @test-watches frontend/src/lib/i18n/*.ts frontend/src/ee/app/(admin)/admin/trends/components/source-intake/*.ts frontend/src/ee/app/(admin)/admin/trends/components/source-intake/*.tsx backend/src/routes/download-video.ts backend/src/routes/video-metadata.ts backend/src/routes/youtube-audio.ts backend/src/lib/input-override-lock.ts backend/src/lib/node-registry.ts packages/client/src/resources/media.ts packages/cli/src/commands/media.ts docs/nodes/input/youtube-video.md docs/nodes/README.md docs/node-inventory.md docs/cli.md docs/sdk-reference.md docs/api-integration.md docs/mcp/tools.md
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..")
const read = (rel) => readFileSync(join(root, rel), "utf8")

// Case-sensitive on purpose: the node's own type id and docs path are
// `youtube-video`, which is not copy; a site's NAME is capitalised, its host
// is lowercase with its dot.
const SITE_NAMES = /\b(YouTube|TikTok|Instagram|Facebook|Twitter|Reels?|Shorts)\b|\byoutu\.be\b|\byoutube\.com\b|\btiktok\.com\b|\binstagram\.com\b|\bfacebook\.com\b|\bfb\.watch\b|\bx\.com\b/

/** The i18n keys behind every link-taking field, in all five locales. */
const LINK_COPY_KEYS = [
  "inputcfg.youtubeFacebookTiktokInstagramOrX",
  "present.videoLinkHint",
  "present.videoLinkInvalid",
  "audiocfg.hintDubSourceUrl",
]

const LOCALES = ["en", "he", "ja", "ko", "pt-br"]

function i18nValue(source, key) {
  const match = source.match(new RegExp(`^\\s*"${key.replace(/\./g, "\\.")}":\\s*"((?:[^"\\\\]|\\\\.)*)"`, "m"))
  assert.ok(match, `${key} is missing`)
  return match[1]
}

test("the link-taking fields' copy names no site, in any locale", () => {
  for (const locale of LOCALES) {
    const source = read(`frontend/src/lib/i18n/${locale}.ts`)
    for (const key of LINK_COPY_KEYS) {
      const value = i18nValue(source, key)
      assert.doesNotMatch(value, SITE_NAMES, `${locale} ${key}: ${value}`)
    }
  }
})

/**
 * The double-quoted string literals of a file (the refusal messages are all
 * double-quoted; a single-quoted scan would pair apostrophes in prose). Comments
 * are dropped first so a quoted word in one is not read as a message.
 */
function stringLiterals(source) {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")
  return [...code.matchAll(/"((?:[^"\\\n]|\\.)*)"/g)].map((m) => m[1] ?? "")
}

test("the server's link refusals name no site", () => {
  for (const rel of [
    "backend/src/routes/download-video.ts",
    "backend/src/routes/video-metadata.ts",
    "backend/src/routes/youtube-audio.ts",
    "backend/src/lib/input-override-lock.ts",
  ]) {
    const messages = stringLiterals(read(rel)).filter((s) => /\b(must be|paste|link)\b/i.test(s))
    assert.ok(messages.length > 0, `${rel}: no refusal text found`)
    for (const message of messages) assert.doesNotMatch(message, SITE_NAMES, `${rel}: ${message}`)
  }
})

test("the admin source intake's label, placeholder and failures name no site", () => {
  const dir = "frontend/src/ee/app/(admin)/admin/trends/components/source-intake"
  const link = read(`${dir}/link.ts`)
  const failures = link.slice(link.indexOf("LINK_FAILURES"), link.indexOf("RETRYABLE"))
  for (const s of stringLiterals(failures)) assert.doesNotMatch(s, SITE_NAMES, `LINK_FAILURES: ${s}`)
  const source = read(`${dir}/LinkSource.tsx`)
  const jsx = source.replace(/^\s*\/\/.*$/gm, "")
  const labels = [...jsx.matchAll(/<label\b[^>]*>([\s\S]*?)<\/label>/g)].map((m) => m[1])
  assert.ok(labels.length > 0, "LinkSource.tsx: no <label> found")
  for (const label of labels) assert.doesNotMatch(label, SITE_NAMES, `label: ${label.trim()}`)
  const placeholders = [...jsx.matchAll(/placeholder=(?:"([^"]*)"|\{`([^`]*)`\})/g)].map((m) => m[1] ?? m[2] ?? "")
  assert.ok(placeholders.length > 0, "LinkSource.tsx: no placeholder found")
  for (const placeholder of placeholders) assert.doesNotMatch(placeholder, SITE_NAMES, `placeholder: ${placeholder}`)
})

test("the Video URL node's description, the SDK, the CLI and the docs name no site in link copy", () => {
  const registry = read("backend/src/lib/node-registry.ts")
  const entryAt = registry.indexOf('type: "youtube-video"')
  assert.ok(entryAt >= 0, "node-registry: the youtube-video entry was not found")
  const description = registry.slice(entryAt).match(/description:\s*"([^"]*)"/)?.[1] ?? ""
  assert.ok(description, "node-registry: the youtube-video description was not found")
  assert.doesNotMatch(description, SITE_NAMES, `node-registry: ${description}`)

  const sdk = read("packages/client/src/resources/media.ts")
  const sdkDoc = sdk.slice(sdk.indexOf("/**", sdk.indexOf("class MediaResource")), sdk.indexOf("downloadVideo(input"))
  assert.doesNotMatch(sdkDoc, SITE_NAMES, "SDK downloadVideo doc")

  const cli = read("packages/cli/src/commands/media.ts")
  const cliLine = cli.match(/\.command\("download <url>"\)\s*\.description\("([^"]*)"\)/)?.[1] ?? ""
  assert.ok(cliLine, "CLI media download description not found")
  assert.doesNotMatch(cliLine, SITE_NAMES, `CLI: ${cliLine}`)

  assert.doesNotMatch(read("docs/nodes/input/youtube-video.md"), SITE_NAMES, "docs/nodes/input/youtube-video.md")
  for (const [rel, needle] of [
    ["docs/nodes/README.md", "[Video URL]("],
    ["docs/node-inventory.md", "| `youtube-video` |"],
    ["docs/cli.md", "nodaro media download <url>"],
    ["docs/api-integration.md", "| `POST` | `/v1/download-video` |"],
  ]) {
    const source = read(rel)
    const at = source.indexOf(needle)
    assert.ok(at >= 0, `${rel}: ${needle} not found`)
    const lines = source.slice(at).split("\n").slice(0, rel === "docs/cli.md" ? 3 : 1).join("\n")
    assert.doesNotMatch(lines, SITE_NAMES, `${rel}: ${lines}`)
  }
  // The SDK reference: the downloadVideo section, from its heading to the next one.
  const sdkRef = read("docs/sdk-reference.md")
  const refAt = sdkRef.indexOf("downloadVideo(input")
  assert.ok(refAt >= 0, "docs/sdk-reference.md: the downloadVideo signature was not found")
  const refEnd = sdkRef.indexOf("\n#### ", refAt)
  assert.doesNotMatch(sdkRef.slice(refAt, refEnd > 0 ? refEnd : refAt + 2000), SITE_NAMES, "docs/sdk-reference.md downloadVideo section")
  // The MCP tools doc: the paragraph on a Video URL input of a published app.
  const tools = read("docs/mcp/tools.md")
  const toolsAt = tools.indexOf("node the app exposes is")
  assert.ok(toolsAt >= 0, "docs/mcp/tools.md: the Video URL input paragraph was not found")
  const toolsEnd = tools.indexOf("\n\n", toolsAt)
  assert.doesNotMatch(tools.slice(toolsAt, toolsEnd > 0 ? toolsEnd : toolsAt + 1500), SITE_NAMES, "docs/mcp/tools.md Video URL input paragraph")
})
