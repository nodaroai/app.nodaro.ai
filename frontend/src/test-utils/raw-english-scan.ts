/**
 * Shared source scan for raw English copy in localized UI directories.
 *
 * The config panels (and the node components that share their copy) are
 * translated through `t()`/`tx()` keys; a literal English string that reaches
 * the DOM renders English inside a Hebrew UI. There is no runtime that can
 * see all ~350 of those components, so the guard is a source scan.
 *
 * Kept dependency-free (node `fs`/`path` only, no `@/` alias) so it can be
 * driven from a vitest file OR from a plain `npx tsx` script when the
 * inventory of current leaks has to be dumped.
 */
import fs from "node:fs"
import path from "node:path"

export type Hit = {
  /** Path as given to the scanner (repo-relative when a root is passed). */
  file: string
  line: number
  /** The offending English string. */
  snippet: string
  /** Which pattern fired — jsx-text | prop | single-word | object-prop. */
  kind: string
}

/**
 * Brand, model and vendor names are product identity, not copy: they stay
 * Latin in every locale. Anchored at the start of the string: a phrase that
 * OPENS with a brand token ("Kling 3.0 only") is a model name in practice.
 */
export const BRAND_ALLOW =
  /^(Nano Banana|Flux|GPT Image|GPT|Kling|Wan|Hailuo|Seedream|Seedance|Gemini|Grok|Runway|Luma|Suno|ElevenLabs|Sync\b|Higgs|LTX|MiniMax|Bytedance|Google|xAI|OpenAI|Anthropic|Stability|Ideogram|Recraft|Imagen|Veo|Sora|Pika|Hedra|Heygen|D-ID|Kie|Fal|Replicate|BFL|Topaz|Midjourney|Qwen|Kontext|Photon|Ray|Vidu|Pixverse|Framepack|Mochi|Hunyuan|Lightricks|Stable Diffusion|Nvidia|Meta|Amazon|Azure|Claude|Llama|Mistral|Fish\b|HappyHorse|OmniHuman|Ken Burns|PNG\b|JPG\b|JPEG\b|WebP\b|MP4\b|MP3\b|WAV\b|SRT\b|Multilingual v|Turbo v|Flash v|Lipsync|Volcengine)/i

/**
 * Single capitalised words that are format / brand / unit tokens rather than
 * UI copy. `[A-Z][a-z]{2,}` never matches an all-caps token (MP3, WAV, JSON,
 * FPS, SRT), so only mixed-case tokens need listing here. A real word
 * ("Duration", "Model", "Auto") is a hit and belongs in the dict.
 */
export const ALLOW_SINGLE = new Set([
  "Pro", "Beta", "Alpha", "Max", "Mini", "Nano", "Turbo", "Flash", "Lite", "Plus", "Ultra",
  "Fast", "Std", "Dev", "Schnell", "Kontext", "Sonnet", "Opus", "Haiku",
])

/** A word inside an English phrase: letters, digits and sentence punctuation. */
const WORD = "[A-Za-z0-9&/,.'’()?!:;%$#@+°-]+"

/**
 * A JSX text node: `>` … capitalised word … at least one more word … then the
 * next `<` (any tag, opening or closing) or `{` (an interpolation — the
 * English half before `{name}` is still English copy). Whitespace inside the
 * phrase may be a newline: prettier wraps long text nodes.
 */
export const JSX_TEXT = new RegExp(
  `>\\s*([A-Z][A-Za-z]+[?!.:;,]?(?:\\s+${WORD})+)\\s*(?=[<{])`,
  "g",
)

/**
 * A single capitalised word as the whole text node — "Duration", "Model",
 * "Style". Requires a closing tag so `=> Boolean` style code cannot match.
 */
export const JSX_SINGLE = />\s*([A-Z][a-z]{2,})\s*<\//g

const PROP_NAMES =
  "placeholder|title|aria-label|alt|label|description|content|emptyText|helperText|tooltip"

/**
 * A string-valued prop in any of the four shapes the codebase uses:
 * `p="X"`, `p={"X"}`, `p={\`X\`}` and `p={cond ? "X" : "Y"}` (both branches).
 */
export const PROP = new RegExp(
  `\\b(?:${PROP_NAMES})=(?:"([^"\\n]*)"` +
    `|\\{\\s*"([^"\\n]*)"\\s*\\}` +
    "|\\{\\s*`([^`$\\n]*)`\\s*\\}" +
    `|\\{[^}"\\n]*\\?\\s*"([^"\\n]*)"\\s*:\\s*"([^"\\n]*)")`,
  "g",
)

/**
 * The same copy hiding in a data module: `label: "Commercial / Product"`.
 * Option tables are legitimate here (they are the KEYS the option localizer
 * maps), so callers pass `isLocalizedData` to spare a string that a
 * localizer actually translates.
 */
export const OBJECT_PROP =
  /\b(?:label|title|desc|description|tooltip|placeholder|hint):\s*"([^"\n]*)"/g

/** The English-phrase shape a prop / object value must have to count. */
const ENGLISH_PHRASE = new RegExp(`^[A-Z][A-Za-z]+[?!.:;,]?(?:\\s+${WORD})+$`)

/** Replace block comments with the same number of newlines (line numbers stay true). */
export function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ""))
    .replace(/^\s*\/\/.*$/gm, "")
}

function lineOf(src: string, index: number): number {
  let n = 1
  for (let i = 0; i < index; i++) if (src[i] === "\n") n++
  return n
}

export type ScanOptions = {
  /** File label used in the hits (repo-relative path, usually). */
  file?: string
  /** Return true for a value that a runtime localizer already translates. */
  isLocalizedData?: (value: string) => boolean
}

/** Every raw-English hit in one source file's text. */
export function scanRawEnglish(source: string, opts: ScanOptions = {}): Hit[] {
  const file = opts.file ?? "<source>"
  const src = stripComments(source)
  const hits: Hit[] = []
  const push = (kind: string, index: number, snippet: string) =>
    hits.push({ file, line: lineOf(src, index), snippet, kind })

  for (const m of src.matchAll(JSX_TEXT)) {
    const s = m[1].trim()
    if (!BRAND_ALLOW.test(s)) push("jsx-text", m.index ?? 0, s)
  }
  for (const m of src.matchAll(JSX_SINGLE)) {
    const s = m[1]
    if (!ALLOW_SINGLE.has(s) && !BRAND_ALLOW.test(s)) push("single-word", m.index ?? 0, s)
  }
  for (const m of src.matchAll(PROP)) {
    for (const g of m.slice(1)) {
      if (!g) continue
      const s = g.trim()
      if (!ENGLISH_PHRASE.test(s) || BRAND_ALLOW.test(s)) continue
      // A `label=` on a handle pip is a LOOKUP key: HandleWithPopover
      // localizes it through the handle-label table at render.
      if (m[0].startsWith("label=") && isHandleLabelProp(src, m.index ?? 0) && opts.isLocalizedData?.(s)) continue
      push("prop", m.index ?? 0, s)
    }
  }
  for (const m of src.matchAll(OBJECT_PROP)) {
    const s = m[1].trim()
    if (!ENGLISH_PHRASE.test(s) || BRAND_ALLOW.test(s)) continue
    if (opts.isLocalizedData?.(s)) continue
    push("object-prop", m.index ?? 0, s)
  }
  return hits
}

/** Is the prop at `index` inside a `<HandleWithPopover …>` (or a handle-def row) tag? */
function isHandleLabelProp(src: string, index: number): boolean {
  const open = src.lastIndexOf("<", index)
  if (open < 0) return false
  const tag = src.slice(open, index)
  return /^<HandleWithPopover\b/.test(tag) && !tag.includes(">")
}

/**
 * A module-scope label table that resolves its copy at IMPORT time freezes on
 * whatever locale the store held at boot — the exact regression the PR
 * converted ~55 tables into getter functions to avoid. Any top-level
 * `const NAME = {` / `= [` whose initializer calls `t(`/`tx(` is one.
 */
export function scanBootFrozenTables(source: string, file = "<source>"): Hit[] {
  const src = stripComments(source)
  const hits: Hit[] = []
  // Column 0 == module scope: an indented `const` lives inside a function.
  const DECL = /^(?:export\s+)?const\s+([A-Z][A-Z0-9_]*)\b/gm
  for (const m of src.matchAll(DECL)) {
    const start = m.index ?? 0
    const eq = findAssignment(src, start + m[0].length)
    if (eq < 0) continue
    let i = eq + 1
    while (i < src.length && /\s/.test(src[i])) i++
    if (src[i] !== "{" && src[i] !== "[") continue
    const end = matchBracket(src, i)
    if (end < 0) continue
    const body = src.slice(i, end)
    if (TRANSLATION_CALL.test(body)) {
      TRANSLATION_CALL.lastIndex = 0
      hits.push({ file, line: lineOf(src, start), snippet: m[1], kind: "boot-frozen-table" })
    }
    TRANSLATION_CALL.lastIndex = 0
  }
  return hits
}

/** `t(` / `tx(` as a CALL — not `.at(`, `split(`, `format(`, `next(`. */
export const TRANSLATION_CALL = /(?<![\w.$])tx?\(/

/** Index of the initializer `=`, skipping a type annotation; -1 if none on the decl. */
function findAssignment(src: string, from: number): number {
  // A type annotation may carry `=>` (`Record<string, () => void>`), so skip
  // arrows and comparisons and take the first real assignment `=`.
  const limit = Math.min(src.length, from + 400)
  for (let i = from; i < limit; i++) {
    const c = src[i]
    if (c === ";") return -1
    if (c !== "=") continue
    if (src[i + 1] === "=" || src[i + 1] === ">") continue
    if ("=!<>".includes(src[i - 1])) continue
    return i
  }
  return -1
}

/** Index just past the bracket that closes the one at `open`; -1 if unbalanced. */
function matchBracket(src: string, open: number): number {
  const pairs: Record<string, string> = { "{": "}", "[": "]", "(": ")" }
  const stack: string[] = [pairs[src[open]]]
  let quote: string | null = null
  for (let i = open + 1; i < src.length; i++) {
    const c = src[i]
    if (quote) {
      if (c === "\\") i++
      else if (c === quote) quote = null
      continue
    }
    if (c === '"' || c === "'" || c === "`") { quote = c; continue }
    if (pairs[c]) { stack.push(pairs[c]); continue }
    if (c === "}" || c === "]" || c === ")") {
      if (stack[stack.length - 1] !== c) return -1
      stack.pop()
      if (stack.length === 0) return i + 1
    }
  }
  return -1
}

/** Every .ts/.tsx source file under `dirs`, recursively, minus test folders. */
export function listSourceFiles(dirs: string[]): string[] {
  const out: string[] = []
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === "__tests__" || e.name === "node_modules") continue
      const p = path.join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) out.push(p)
    }
  }
  for (const d of dirs) walk(d)
  return out.sort()
}
