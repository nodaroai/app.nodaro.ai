import { describe, it, expect } from "vitest"
import fs from "node:fs"
import path from "node:path"
import ts from "typescript"

/**
 * Every user-visible English string in the core UI must go through the
 * dictionary (`t()` / `tx()`), or it stays English in every language — the
 * 2026-09 pass found ~1,400 such strings that survived a "100% translated"
 * Hebrew dictionary. This guard parses the component sources and fails on a
 * NEW bare literal in the places copy hides: JSX text, the copy-bearing JSX
 * attributes (title, placeholder, aria-label, alt, label, …) and `toast.*()`
 * messages, descriptions and action labels — including every branch of a
 * conditional (`busy ? "Saving…" : "Save"`) and toast wrappers such as
 * `guardedToast`.
 *
 * Scope is everything a signed-in user sees: the core app (`components/`,
 * `app/`, `routes/`, `hooks/`) and the user-facing `ee/` surfaces (copilot,
 * credits, billing, organizations). Plain `.ts` modules are scanned too — the
 * node executor and the studio hooks raise their toasts from `.ts` files, and
 * ~200 English toasts sat there while only `.tsx` was checked. The operator-only admin pages are excluded — they
 * are a separate pass. Tokens that are not copy — brand and model names,
 * format and unit strings — go in ALLOWED_LITERALS, which the last test
 * keeps honest (an entry no file uses any more must be removed).
 *
 * Real parser, not a regex: multi-line JSX text and template literals are
 * exactly where a grep-based scan under-counts.
 */
const SRC = path.resolve(__dirname, "../../..")
const SCAN_ROOTS = ["components", "app", "routes", "hooks", "ee"]
const SKIP_DIR = new Set(["__tests__", "node_modules", "(admin)"])
/** Operator-only surfaces outside the `(admin)` route group. */
const SKIP_PATHS = ["ee/components/admin", "ee/layouts/admin-layout.tsx"]
const TIMEOUT = 60_000

/** Attributes whose string value is rendered to the user. */
const COPY_ATTRIBUTES = new Set([
  "title", "placeholder", "aria-label", "alt", "label", "description", "tooltip",
  "heading", "subtitle", "emptyText", "helperText", "emptyMessage", "confirmLabel", "cancelLabel", "iconLabel",
])

/**
 * Elements whose `label` prop is not shown as written: localized downstream by
 * the string maps in `lib/i18n/labels.ts` (handle pips, node headers) — so a
 * bare English `label` there is the lookup key — or used only as a download
 * file name (the result overlays).
 */
const LABEL_IS_LOOKUP_KEY = new Set(["HandleWithPopover", "BaseNode", "EditableNodeLabel", "VideoResultOverlay"])

/**
 * Exact literals that are legitimately Latin in every language: brand,
 * product, model and provider names, format / unit / ratio tokens, and
 * glyph-only separators. Reviewed one by one — extend with the same care.
 */
const ALLOWED_LITERALS: ReadonlySet<string> = new Set<string>([
  // Brand, product, model and provider names — Latin in every language.
  "ElevenLabs", "ElevenLabs Multilingual v2", "ElevenLabs SFX v2", "Multilingual v2", "Turbo v2.5", "Flash v2.5",
  "Fish", "S2 Pro", "GFPGAN", "RestoreFormer", "MMAudio", "YouTube", "Suno", "SwitchX", "RemX",
  "VEO 1080p", "VEO 4K", "musicgen", "tangoflux", // model ids shown as the node's model
  "Std", "Pro", // Kling 3 tiers
  "YT", // YouTube, on the reference-audio source chip
  "Avatar V", "AVATAR V", "NODARO", "Cinema", "odaro", "nodaro.ai",
  "TypeScript SDK — @nodaro/sdk", "CLI — @nodaro/cli",
  // Codecs, protocols and keys.
  "AAC", "H.265 (HEVC)", "/ CRF", "POST", "esc",
  // Code, syntax and values the user types verbatim (env vars, paths, expressions, JSON literals).
  ".env", "AUDIOMASS_URL", "FREECUT_URL", "NODARO_API_KEY", "NODARO_ENCRYPTION_KEY", "localhost",
  "/app/", "/org/", "@image:", "@BotFather", "null", "undefined", "output_video",
  "last", "1, 2, last", "3, last, last-1", ".data.items[] | select(.active == true) | {id, name}",
  "us", // country-code field placeholder
  "cut", // the slideshow transition id, shown as a mono token beside the others
  "music", // the default negative prompt sent to the SFX model, shown as its placeholder
  // Sample values in placeholders.
  "123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ", "BCDF-GHJK", "sunrise-school", "school.example",
  "ada@school.example, grace@school.example",
])

/**
 * Unit and format tokens that are the same in every language. A literal made
 * only of these (plus digits and punctuation) is not copy — "24 fps", "4K",
 * "MP4 · 16:9". Anything with another word alongside them still is.
 */
const UNIT_TOKENS = new Set([
  "fps", "px", "ms", "s", "sec", "min", "hr", "kb", "mb", "gb", "k", "hd", "uhd", "kbps", "mbps", "hz", "khz", "db",
  "mp4", "mp3", "wav", "png", "jpg", "jpeg", "gif", "webp", "webm", "mov", "svg", "json", "csv", "pdf", "srt", "vtt",
  "x", "ai", "id", "url", "api", "cr",
])

/** Elements whose text is code, keys, sample values or CSS — never copy. */
const NON_COPY_PARENTS = new Set(["code", "pre", "kbd", "samp", "var", "style"])

const NAMED_ENTITIES: Record<string, string> = {
  nbsp: " ", quot: '"', apos: "'", amp: "&", lt: "<", gt: ">", middot: "·", hellip: "…",
  mdash: "—", ndash: "–", rarr: "→", larr: "←", times: "×", copy: "©", bull: "•", laquo: "«", raquo: "»",
  lsaquo: "‹", rsaquo: "›",
}

/** JSX text carries entities verbatim; decode them so `&quot;` is not a "word". */
function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&([a-z]+);/gi, (m, name: string) => NAMED_ENTITIES[name.toLowerCase()] ?? m)
}

/** A literal is copy when a two-letter Latin word other than a unit token survives. */
function isCopy(text: string): boolean {
  // A URL (or URL placeholder such as "https://…") is a token, not a sentence.
  if (/^[a-z]+:\/\//i.test(text)) return false
  // Split on anything that is neither a letter nor a digit, so "MP4" stays
  // one token and matches its unit entry (a letters-only split left "MP").
  // A leading number is the value, not the word: "42ms", "5cr", "4K".
  const isUnit = (word: string) => {
    const w = word.toLowerCase()
    return UNIT_TOKENS.has(w) || UNIT_TOKENS.has(w.replace(/^\d+(?:\.\d+)?/, ""))
  }
  return text
    .split(/[^A-Za-z0-9]+/)
    .some((word) => /[A-Za-z]{2,}/.test(word) && !isUnit(word))
}

interface Hit {
  readonly file: string
  readonly line: number
  readonly kind: string
  readonly text: string
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIR.has(entry.name)) continue
    const p = path.join(dir, entry.name)
    if (SKIP_PATHS.some((skip) => path.relative(SRC, p) === skip)) continue
    if (entry.isDirectory()) walk(p, out)
    else if (/\.tsx?$/.test(entry.name) && !/\.(test|spec|stories|d)\.tsx?$/.test(entry.name)) out.push(p)
  }
  return out
}

/**
 * The literal copy an expression can render: a string or template literal
 * itself, or any of them reached through a conditional — both branches of
 * `?:`, both sides of `??` / `||`, the right side of `&&` — or parentheses.
 * `cond ? "Saving…" : "Save"` is two strings the user reads.
 */
function literalTexts(node: ts.Node): string[] {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return [node.text]
  if (ts.isTemplateExpression(node)) {
    // `Picker language: ${x}` — the fixed parts are copy, the holes are not.
    return [[node.head.text, ...node.templateSpans.map((s) => s.literal.text)].join(" ")]
  }
  if (ts.isJsxExpression(node) && node.expression) return literalTexts(node.expression)
  if (ts.isParenthesizedExpression(node)) return literalTexts(node.expression)
  if (ts.isConditionalExpression(node)) return [...literalTexts(node.whenTrue), ...literalTexts(node.whenFalse)]
  if (ts.isBinaryExpression(node)) {
    const op = node.operatorToken.kind
    if (op === ts.SyntaxKind.QuestionQuestionToken || op === ts.SyntaxKind.BarBarToken) {
      return [...literalTexts(node.left), ...literalTexts(node.right)]
    }
    if (op === ts.SyntaxKind.AmpersandAmpersandToken) return literalTexts(node.right)
  }
  return []
}

/** The object literals an `action:` value can be, through the same conditionals. */
function objectBranches(node: ts.Node): ts.ObjectLiteralExpression[] {
  if (ts.isObjectLiteralExpression(node)) return [node]
  if (ts.isParenthesizedExpression(node)) return objectBranches(node.expression)
  if (ts.isConditionalExpression(node)) return [...objectBranches(node.whenTrue), ...objectBranches(node.whenFalse)]
  if (ts.isBinaryExpression(node)) return [...objectBranches(node.left), ...objectBranches(node.right)]
  return []
}

function tagNameOf(attr: ts.JsxAttribute): string {
  const opening = attr.parent.parent
  return ts.isJsxOpeningLikeElement(opening) ? opening.tagName.getText() : ""
}

/** `.ts` parses as TS: in TSX mode a `<T>value` assertion reads as a JSX tag. */
function parse(file: string): ts.SourceFile {
  const kind = file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  return ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, kind)
}

/**
 * The copy a toast renders besides its message: `{ description }` and
 * `{ action: { label } }` in the options argument.
 */
function toastOptionCopy(node: ts.CallExpression): ReadonlyArray<readonly [string, ts.Node]> {
  const options = node.arguments[1]
  if (!options || !ts.isObjectLiteralExpression(options)) return []
  const found: Array<readonly [string, ts.Node]> = []
  for (const prop of options.properties) {
    if (!ts.isPropertyAssignment(prop)) continue
    const name = prop.name.getText()
    if (name === "description") found.push(["toast:description", prop.initializer])
    if (name === "action") {
      for (const action of objectBranches(prop.initializer)) {
        for (const inner of action.properties) {
          if (ts.isPropertyAssignment(inner) && inner.name.getText() === "label") found.push(["toast:action", inner.initializer])
        }
      }
    }
  }
  return found
}

/** `toast(…)`, `toast.error(…)` and any wrapper named like one (`guardedToast.error(…)`). */
function isToastCall(node: ts.CallExpression): boolean {
  const callee = node.expression
  const receiver = ts.isIdentifier(callee)
    ? callee.text
    : ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression)
      ? callee.expression.text
      : ""
  return /toast$/i.test(receiver)
}

function scanFile(file: string): Hit[] {
  const source = parse(file)
  const rel = path.relative(SRC, file)
  const hits: Hit[] = []
  const push = (node: ts.Node, kind: string, raw: string) => {
    const text = decodeEntities(raw).replace(/\s+/g, " ").trim()
    if (!isCopy(text) || ALLOWED_LITERALS.has(text)) return
    hits.push({ file: rel, line: source.getLineAndCharacterOfPosition(node.getStart()).line + 1, kind, text })
  }
  const inNonCopyParent = (node: ts.JsxText | ts.JsxExpression): boolean => {
    const parent = node.parent
    return ts.isJsxElement(parent) && NON_COPY_PARENTS.has(parent.openingElement.tagName.getText())
  }
  const isJsxChild = (node: ts.JsxExpression): boolean =>
    (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent)) && !inNonCopyParent(node)
  const visit = (node: ts.Node) => {
    if (ts.isJsxText(node)) {
      if (!inNonCopyParent(node)) push(node, "jsx-text", node.text)
    } else if (ts.isJsxExpression(node) && node.expression && isJsxChild(node)) {
      // `{busy ? "Saving…" : "Save"}` renders its strings like JSX text does.
      for (const text of literalTexts(node.expression)) push(node, "jsx-expr", text)
    } else if (ts.isJsxAttribute(node) && node.initializer) {
      const name = node.name.getText()
      if (COPY_ATTRIBUTES.has(name) && !(name === "label" && LABEL_IS_LOOKUP_KEY.has(tagNameOf(node)))) {
        for (const text of literalTexts(node.initializer)) push(node, `attr:${name}`, text)
      }
    } else if (ts.isCallExpression(node) && isToastCall(node) && node.arguments[0]) {
      for (const text of literalTexts(node.arguments[0])) push(node, "toast", text)
      for (const [kind, value] of toastOptionCopy(node)) {
        for (const text of literalTexts(value)) push(value, kind, text)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return hits
}

function scanAll(): Hit[] {
  return SCAN_ROOTS.flatMap((root) => walk(path.join(SRC, root))).flatMap(scanFile)
}

describe("no hardcoded UI copy in core components", () => {
  it(
    "every user-visible string goes through the dictionary (t / tx)",
    () => {
      const hits = scanAll()
      const report = hits.map((h) => `${h.file}:${h.line}  [${h.kind}]  ${h.text}`).join("\n")
      expect(hits, `${hits.length} bare English literal(s) in core components — add a dictionary key or, for a brand/format token, an ALLOWED_LITERALS entry:\n${report}`).toEqual([])
    },
    TIMEOUT,
  )

  it(
    "the allowlist stays honest — every entry is still used by some component",
    () => {
      const used = new Set<string>()
      const seen = (raw: string) => used.add(decodeEntities(raw).replace(/\s+/g, " ").trim())
      for (const file of SCAN_ROOTS.flatMap((root) => walk(path.join(SRC, root)))) {
        const source = parse(file)
        const visit = (node: ts.Node) => {
          if (ts.isJsxText(node)) seen(node.text)
          else if (ts.isJsxExpression(node) && node.expression) literalTexts(node.expression).forEach(seen)
          else if (ts.isJsxAttribute(node) && node.initializer) literalTexts(node.initializer).forEach(seen)
          else if (ts.isCallExpression(node) && node.arguments[0]) literalTexts(node.arguments[0]).forEach(seen)
          ts.forEachChild(node, visit)
        }
        visit(source)
      }
      const stale = [...ALLOWED_LITERALS].filter((s) => !used.has(s))
      expect(stale, `ALLOWED_LITERALS entries no component uses any more:\n${stale.join("\n")}`).toEqual([])
    },
    TIMEOUT,
  )
})
