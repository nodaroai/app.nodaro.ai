// An SVG a language model wrote (GPT Image 2.6's SVG output) is untrusted
// markup. Before it is stored on the public CDN it is made safe here, with a
// strict allow-list: parsed as XML by us (anything that is not a well-formed
// SVG document is refused; the one repair is a missing `xmlns` or `xmlns:xlink`
// on the root, `repairSvgNamespaces`), cleaned in place by DOMPurify's
// SVG profile plus the hooks below, checked again by an independent walk, and
// serialized as XML.
//
// What goes:
// - <script>, <foreignObject>, <iframe>, <embed>, <object>, <audio>, <video>,
//   <handler>, <listener>, and every <set>, <animate>, <animateColor> and
//   <discard> (each with everything inside it). <animateTransform> and
//   <animateMotion> stay unless they target an href.
// - <a>: the link goes, its drawing stays (its children take its place).
// - every on* attribute.
// - every href / xlink:href / src that is not a same-document `#id` or, on
//   <image> and <feImage> only, a base64 data:image/png|jpeg|webp. The element
//   carrying such a reference goes with it (a <use> must point at `#id`).
// - any attribute whose value loads something: a url() that is not url(#id),
//   image-set() and the like, @import, expression(), javascript:, a CSS
//   escape (a backslash can spell url( in a way no pattern sees).
// - a <style> whose text does any of that.
// - comments, processing instructions and everything outside the root.
//
// jsdom and DOMPurify are heavy and only SVG jobs need them, so they load on
// the first call (one shared window, cached).
import type { Config, DOMPurify, WindowLike } from "dompurify"
import type { DOMWindow } from "jsdom"

const SVG_NS = "http://www.w3.org/2000/svg"
const XLINK_NS = "http://www.w3.org/1999/xlink"
const XMLNS_NS = "http://www.w3.org/2000/xmlns/"

/** The message every SvgRefusedError carries; the reconcile cron matches it, so it never changes. */
export const SVG_REFUSED_MESSAGE =
  "The SVG the model wrote could not be read safely, so it was not saved. You were not charged."

/** The largest SVG accepted, in bytes. */
export const SVG_MAX_BYTES = 5 * 1024 * 1024

/**
 * Thrown when an SVG cannot be made safe: not well-formed XML, a root that is
 * not <svg> in the SVG namespace, a DOCTYPE/ENTITY, too large, or nothing
 * drawable left after sanitizing. A plain Error (never a PostProcessingError),
 * so the job is refunded. `reason` is for logs only.
 */
export class SvgRefusedError extends Error {
  readonly svgRefused = true
  readonly reason: string

  constructor(reason: string, options?: { cause?: unknown }) {
    super(SVG_REFUSED_MESSAGE, options)
    this.name = "SvgRefusedError"
    this.reason = reason
  }
}

export function isSvgRefusedError(err: unknown): boolean {
  return err instanceof SvgRefusedError ||
    (typeof err === "object" && err !== null && (err as { svgRefused?: unknown }).svgRefused === true)
}

// ─── What is allowed ────────────────────────────────────────────────────────

/** Removed whatever they hold or say. Lower case: DOMPurify matches names lower-cased. */
const FORBIDDEN_TAGS = [
  "script", "foreignobject", "iframe", "embed", "object", "audio", "video", "handler", "listener",
  "set", "animate", "animatecolor", "discard", "a",
]
const FORBIDDEN = new Set(FORBIDDEN_TAGS)
/** Animation elements kept unless they target an href. */
const ANIMATIONS = new Set(["animatetransform", "animatemotion"])
/** Presentation attributes SVG output uses that DOMPurify's SVG list lacks. */
const EXTRA_ATTRS = ["mix-blend-mode", "isolation", "fr", "side", "spacing", "baseprofile", "enable-background"]
/** Elements that draw something; a document with none of them left is refused. */
const DRAWABLE = new Set(["path", "rect", "circle", "ellipse", "line", "polyline", "polygon", "text", "image", "use"])

const PURIFY_CONFIG: Config & { IN_PLACE: true } = {
  USE_PROFILES: { svg: true, svgFilters: true },
  ADD_TAGS: ["use"],
  ADD_ATTR: EXTRA_ATTRS,
  FORBID_TAGS: FORBIDDEN_TAGS,
  // An <a>'s children are hoisted in its place; every other forbidden
  // element is removed with what it holds.
  ADD_FORBID_CONTENTS: FORBIDDEN_TAGS.filter((tag) => tag !== "a"),
  // DOM clobbering protection strips an id that names a document property
  // (`id="body"`, in a real sample), which breaks every url(#body). The file
  // is a standalone document with no script; it is never inlined here.
  SANITIZE_DOM: false,
  IN_PLACE: true,
}

const FRAGMENT_REF = /^#[^\s"'()<>\\#]+$/
const DATA_IMAGE = /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=\s]+$/i
const CSS_FORBIDDEN = /@import|expression\s*\(|javascript:|vbscript:|livescript:|-moz-binding|behavior\s*:|\\/i
const CSS_RESOURCE_FN = /(?:^|[^\w-])(?:-webkit-)?(?:image-set|image|cross-fade|element|src)\s*\(/i
const URL_FN = /url\s*\(/gi
const INTERNAL_URL = /^url\s*\(\s*(["']?)#[^\s"'()<>\\#]+\1\s*\)/i

const isRefAttr = (lcName: string) => lcName === "href" || lcName === "src" || lcName.endsWith(":href")

/** A reference may only point inside the document, or carry an inline raster on an image. */
function refIsSafe(tag: string, value: string): boolean {
  const ref = value.trim()
  if (FRAGMENT_REF.test(ref)) return true
  return (tag === "image" || tag === "feimage") && DATA_IMAGE.test(ref)
}

/** CSS (a style attribute, a <style>, a presentation attribute) that loads nothing from outside. */
function cssIsSafe(text: string): boolean {
  if (CSS_FORBIDDEN.test(text) || CSS_RESOURCE_FN.test(text)) return false
  for (const match of text.matchAll(URL_FN)) {
    if (!INTERNAL_URL.test(text.slice(match.index))) return false
  }
  return true
}

function attributeIsSafe(tag: string, lcName: string, value: string): boolean {
  if (lcName.startsWith("on")) return false
  if (isRefAttr(lcName)) return refIsSafe(tag, value)
  return cssIsSafe(value)
}

function hasSafeRef(el: Element, tag: string): boolean {
  return Array.from(el.attributes).some((a) => isRefAttr(a.name.toLowerCase()) && refIsSafe(tag, a.value))
}

/** An element that must go whole, beyond the forbidden tags. */
function elementIsUnsafe(el: Element, tag: string): boolean {
  for (const attr of Array.from(el.attributes)) {
    const lcName = attr.name.toLowerCase()
    if (isRefAttr(lcName) && !refIsSafe(tag, attr.value)) return true
    if (lcName === "attributename" && ANIMATIONS.has(tag) && /href/i.test(attr.value)) return true
  }
  if (tag === "use" && !hasSafeRef(el, tag)) return true
  return tag === "style" && !cssIsSafe(el.textContent ?? "")
}

const isRoot = (node: Node) => node.parentNode !== null && node.parentNode.nodeType === 9 // DOCUMENT_NODE

function installHooks(purify: DOMPurify): void {
  purify.addHook("uponSanitizeElement", (node, data) => {
    if (node.nodeType !== 1 || isRoot(node) || FORBIDDEN.has(data.tagName)) return
    // A detached node is treated as removed by DOMPurify (its subtree is neutralized).
    if (elementIsUnsafe(node as Element, data.tagName)) node.parentNode?.removeChild(node)
  })
  purify.addHook("uponSanitizeAttribute", (node, data) => {
    if (!attributeIsSafe(node.nodeName.toLowerCase(), data.attrName, data.attrValue)) data.keepAttr = false
  })
  purify.addHook("afterSanitizeAttributes", (node) => {
    const tag = node.nodeName.toLowerCase()
    if ((tag === "use" || tag === "image") && !isRoot(node) && !hasSafeRef(node, tag)) {
      node.parentNode?.removeChild(node)
    }
  })
}

// ─── jsdom + DOMPurify, loaded once ─────────────────────────────────────────

interface SvgEnv {
  window: DOMWindow
  purify: DOMPurify
}

let envPromise: Promise<SvgEnv> | undefined

async function createEnv(): Promise<SvgEnv> {
  const [{ JSDOM }, { default: createDOMPurify }] = await Promise.all([import("jsdom"), import("dompurify")])
  const { window } = new JSDOM("")
  const purify = createDOMPurify(window as unknown as WindowLike)
  // An unsupported instance returns its input unchanged: never run without it.
  if (!purify.isSupported) throw new Error("DOMPurify cannot run on this jsdom window")
  installHooks(purify)
  return { window, purify }
}

function loadEnv(): Promise<SvgEnv> {
  envPromise ??= createEnv().catch((err: unknown) => {
    envPromise = undefined
    throw err
  })
  return envPromise
}

// ─── Sanitizing ─────────────────────────────────────────────────────────────

function decodeInput(input: Buffer | string): string {
  const bytes = typeof input === "string" ? Buffer.byteLength(input, "utf8") : input.length
  if (bytes > SVG_MAX_BYTES) throw new SvgRefusedError("too-large")
  let text: string
  if (typeof input === "string") {
    text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input
  } else {
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(input)
    } catch (err) {
      throw new SvgRefusedError("not-utf8", { cause: err })
    }
  }
  if (text.trim() === "") throw new SvgRefusedError("empty")
  return text
}

/** CDATA is plain text in XML; DOMPurify drops CDATA nodes, which would empty a <style>. */
function cdataToText(doc: Document, root: Element): void {
  const iterator = doc.createNodeIterator(root, 8) // NodeFilter.SHOW_CDATA_SECTION
  const sections: CDATASection[] = []
  for (let node = iterator.nextNode(); node; node = iterator.nextNode()) sections.push(node as CDATASection)
  for (const section of sections) section.parentNode?.replaceChild(doc.createTextNode(section.data), section)
}

/** The independent check after DOMPurify: every node must meet the rules above. */
function verifyClean(root: Element): void {
  const stack: Node[] = [root]
  while (stack.length > 0) {
    const node = stack.pop() as Node
    if (node.nodeType === 3) continue // TEXT_NODE
    if (node.nodeType !== 1) throw new SvgRefusedError("unsafe-after-sanitize")
    const el = node as Element
    const tag = el.localName.toLowerCase()
    if (el.namespaceURI !== SVG_NS || FORBIDDEN.has(tag) || (el !== root && elementIsUnsafe(el, tag))) {
      throw new SvgRefusedError("unsafe-after-sanitize")
    }
    for (const attr of Array.from(el.attributes)) {
      if (!attributeIsSafe(tag, attr.name.toLowerCase(), attr.value)) throw new SvgRefusedError("unsafe-after-sanitize")
    }
    for (const child of Array.from(el.childNodes)) stack.push(child)
  }
}

/**
 * The root and every element under it, walked iteratively. Never jsdom's live
 * HTMLCollection (getElementsByTagName*): every non-index property read on it
 * (`length`, read on each step of iterating it) scans the whole collection,
 * which made a 4 MB document take minutes.
 */
function elementsOf(root: Element): Element[] {
  const out: Element[] = []
  const stack: Element[] = [root]
  while (stack.length > 0) {
    const el = stack.pop() as Element
    out.push(el)
    for (let child = el.lastElementChild; child; child = child.previousElementSibling) stack.push(child)
  }
  return out
}

/** The SVG namespace on the root, and xmlns:xlink there only while an xlink: attribute is left. */
function fixNamespaces(root: Element, elements: Element[]): void {
  const usesXlink = elements.some((el) => Array.from(el.attributes).some((a) => a.namespaceURI === XLINK_NS))
  root.setAttributeNS(XMLNS_NS, "xmlns", SVG_NS)
  if (usesXlink) root.setAttributeNS(XMLNS_NS, "xmlns:xlink", XLINK_NS)
  else root.removeAttributeNS(XMLNS_NS, "xlink")
}

function sanitizeDocument(env: SvgEnv, text: string): string {
  const doc = new env.window.DOMParser().parseFromString(text, "image/svg+xml")
  if (doc.getElementsByTagNameNS("*", "parsererror").length > 0) throw new SvgRefusedError("not-well-formed")
  if (doc.doctype) throw new SvgRefusedError("doctype")
  const root = doc.documentElement
  // A root in another namespace (XHTML) is not an SVG document to any
  // renderer, and a prefixed root (`<svg:svg>`) is refused too. A root with no
  // namespace at all was given the SVG one before parsing (repairSvgNamespaces).
  if (!root || root.localName !== "svg" || root.namespaceURI !== SVG_NS || root.prefix !== null) {
    throw new SvgRefusedError("not-svg-root")
  }
  cdataToText(doc, root)
  env.purify.sanitize(root, PURIFY_CONFIG)
  if (root.parentNode !== doc) throw new SvgRefusedError("root-removed")
  verifyClean(root)
  const elements = elementsOf(root)
  if (!elements.some((el) => DRAWABLE.has(el.localName))) throw new SvgRefusedError("nothing-drawable")
  fixNamespaces(root, elements)
  // The root alone: nothing before or after it (a prolog's xml-stylesheet) is kept.
  const out = new env.window.XMLSerializer().serializeToString(root)
  if (!out.startsWith("<svg") || !out.includes(`xmlns="${SVG_NS}"`)) throw new SvgRefusedError("serialize")
  return out
}

/**
 * Elements nested deeper than this are refused before parsing: jsdom's parse
 * is quadratic in depth (8 000 levels took 6 s, so 5 MB of nesting would take
 * hours) and its serializer overflows the stack before 2 000. Model output
 * nests a few levels.
 */
const SVG_MAX_DEPTH = 256

/** Index just past the `>` closing a start tag at `lt`, skipping quoted values; -1 if none. */
function startTagEnd(text: string, lt: number): number {
  let quote = 0
  for (let j = lt + 1; j < text.length; j++) {
    const c = text.charCodeAt(j)
    if (quote !== 0) {
      if (c === quote) quote = 0
    } else if (c === 0x22 || c === 0x27) quote = c
    else if (c === 0x3e) return j + 1
  }
  return -1
}

/** Whether elements nest deeper than `limit`, read from the text (comments, CDATA and PIs skipped). */
function nestsDeeperThan(text: string, limit: number): boolean {
  let depth = 0
  for (let i = text.indexOf("<"); i >= 0; i = text.indexOf("<", i)) {
    let end: number
    if (text.startsWith("<!--", i)) end = closingAt(text, "-->", i + 4)
    else if (text.startsWith("<![CDATA[", i)) end = closingAt(text, "]]>", i + 9)
    else if (text.startsWith("<?", i) || text.startsWith("<!", i)) end = closingAt(text, ">", i + 2)
    else if (text.startsWith("</", i)) {
      depth--
      end = closingAt(text, ">", i + 2)
    } else {
      end = startTagEnd(text, i)
      if (end > 0 && text.charCodeAt(end - 2) !== 0x2f && ++depth > limit) return true // not `/>`
    }
    if (end < 0) return false // unterminated: the parser refuses it
    i = end
  }
  return false
}

/** An `xlink:` attribute anywhere in the text (`xlink:href="…"`). */
const XLINK_ATTRIBUTE = /[ \t\r\n]xlink:[A-Za-z_][\w.-]*[ \t\r\n]*=/

/**
 * The one repair, made before parsing: a model can write the root <svg>
 * without the SVG namespace, or use `xlink:` without declaring it. Each missing
 * declaration is added on the root (`xmlns`, and `xmlns:xlink` when an
 * `xlink:` attribute is used); the document is then cleaned and checked like
 * any other. Nothing else is repaired: a root that names another namespace, a
 * prefixed root, any other undeclared prefix or anything that does not parse is
 * refused as before. A root tag that cannot be read is left as it is.
 */
export function repairSvgNamespaces(text: string): string {
  const root = readRootTag(text)
  if (!root) return text
  const add = [
    ...(root.attrs.has("xmlns") ? [] : [` xmlns="${SVG_NS}"`]),
    ...(!root.attrs.has("xmlns:xlink") && XLINK_ATTRIBUTE.test(text) ? [` xmlns:xlink="${XLINK_NS}"`] : []),
  ]
  if (add.length === 0) return text
  const name = root.start + "<svg".length
  return text.slice(0, name) + add.join("") + text.slice(name)
}

/** Sanitize an SVG; returns the safe document as a UTF-8 string. Throws SvgRefusedError. */
export async function sanitizeSvg(input: Buffer | string): Promise<string> {
  const text = decodeInput(input)
  if (/<!DOCTYPE/i.test(text) || /<!ENTITY/i.test(text)) throw new SvgRefusedError("doctype")
  if (nestsDeeperThan(text, SVG_MAX_DEPTH)) throw new SvgRefusedError("too-deep")
  const env = await loadEnv()
  try {
    return sanitizeDocument(env, repairSvgNamespaces(text))
  } catch (err) {
    if (err instanceof SvgRefusedError) throw err
    throw new SvgRefusedError("sanitize-failed", { cause: err })
  }
}

// ─── Sniffing and the root tag (string only, no DOM) ────────────────────────

const SNIFF_BYTES = 4096
const XML_SPACE = /[ \t\r\n]/

/** Index just past `token` at or after `from`, or -1. */
function closingAt(text: string, token: string, from: number): number {
  const at = text.indexOf(token, from)
  return at < 0 ? -1 : at + token.length
}

function doctypeEnd(text: string, start: number): number {
  const close = text.indexOf(">", start)
  const subset = text.indexOf("[", start)
  if (subset < 0 || (close >= 0 && close < subset)) return close < 0 ? -1 : close + 1
  const subsetEnd = text.indexOf("]", subset)
  if (subsetEnd < 0) return -1
  const end = text.indexOf(">", subsetEnd)
  return end < 0 ? -1 : end + 1
}

/** Index of the first element's `<`, past a BOM, whitespace, PIs, comments and a DOCTYPE. */
function skipProlog(text: string): number | undefined {
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0
  for (;;) {
    while (i < text.length && XML_SPACE.test(text[i])) i++
    let end: number
    if (text.startsWith("<?", i)) end = closingAt(text, "?>", i + 2)
    else if (text.startsWith("<!--", i)) end = closingAt(text, "-->", i + 4)
    else if (text.slice(i, i + 9).toLowerCase() === "<!doctype") end = doctypeEnd(text, i)
    else return i < text.length ? i : undefined
    if (end < 0) return undefined
    i = end
  }
}

/**
 * True when the bytes look like an SVG document: the first element (after a
 * BOM, XML declaration, comments, a DOCTYPE, whitespace) is <svg> (prefixed
 * too). A DOCTYPE'd or prefixed SVG answers true so it reaches sanitizeSvg and
 * is refused there. Reads the first 4 KB; never throws.
 */
export function looksLikeSvg(input: Buffer | string): boolean {
  try {
    const head = typeof input === "string"
      ? input.slice(0, SNIFF_BYTES)
      : new TextDecoder("utf-8").decode(input.subarray(0, SNIFF_BYTES))
    const at = skipProlog(head)
    return at !== undefined && /^<(?:[A-Za-z_][\w.-]*:)?svg[\s/>]/.test(head.slice(at))
  } catch {
    return false
  }
}

interface RootTag {
  attrs: Map<string, string>
  /** Index of the root's `<`. */
  start: number
  /** Index just past the start tag's `>`. */
  end: number
  /** Index of the `/` of `/>`, when the root is self-closed. */
  selfCloseAt?: number
}

function decodeEntities(value: string): string {
  const named: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" }
  return value.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|lt|gt|amp|quot|apos);/g, (whole, ref: string) => {
    if (!ref.startsWith("#")) return named[ref] ?? whole
    const code = ref[1] === "x" ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10)
    try {
      return String.fromCodePoint(code)
    } catch {
      return whole
    }
  })
}

/** The root <svg> start tag's attributes, read from the text. */
function readRootTag(svg: string): RootTag | undefined {
  const at = skipProlog(svg)
  if (at === undefined || !/^<svg[\s/>]/.test(svg.slice(at, at + 5))) return undefined
  const attr = /[ \t\r\n]+([^\s=/>]+)[ \t\r\n]*=[ \t\r\n]*(?:"([^"]*)"|'([^']*)')/y
  const close = /[ \t\r\n]*(\/?)>/y
  const attrs = new Map<string, string>()
  let i = at + 4
  for (;;) {
    attr.lastIndex = i
    const m = attr.exec(svg)
    if (m) {
      if (!attrs.has(m[1])) attrs.set(m[1], decodeEntities(m[2] ?? m[3] ?? ""))
      i = attr.lastIndex
      continue
    }
    close.lastIndex = i
    const c = close.exec(svg)
    if (!c) return undefined
    return { attrs, start: at, end: close.lastIndex, selfCloseAt: c[1] === "/" ? close.lastIndex - 2 : undefined }
  }
}

/** A px or unitless length above 0; anything else (%, em, mm…) is unusable. */
function parseLength(value: string | undefined): number | undefined {
  const m = value === undefined ? null : /^[ \t\r\n]*\+?((?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)[ \t\r\n]*(?:px)?[ \t\r\n]*$/.exec(value)
  const n = m ? Number(m[1]) : NaN
  return Number.isFinite(n) && n > 0 ? n : undefined
}

function parseViewBox(value: string | undefined): { x: number; y: number; width: number; height: number } | undefined {
  const parts = value?.trim().split(/[\s,]+/) ?? []
  if (parts.length !== 4) return undefined
  const [x, y, width, height] = parts.map(Number)
  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return undefined
  return { x, y, width, height }
}

const pixels = (width: number, height: number) => ({
  width: Math.max(1, Math.round(width)),
  height: Math.max(1, Math.round(height)),
})

/**
 * The SVG's intended pixel size: numeric width/height on the root (px or
 * unitless; %, em and the rest are ignored), one of them with the viewBox's
 * shape for the other, else the viewBox's own size; integers ≥ 1. undefined
 * when neither is usable. Reads the text, never rasterises.
 */
export function svgIntrinsicSize(svg: string): { width: number; height: number } | undefined {
  const root = readRootTag(svg)
  if (!root) return undefined
  const width = parseLength(root.attrs.get("width"))
  const height = parseLength(root.attrs.get("height"))
  if (width !== undefined && height !== undefined) return pixels(width, height)
  const box = parseViewBox(root.attrs.get("viewBox"))
  if (!box) return undefined
  if (width !== undefined) return pixels(width, (width * box.height) / box.width)
  if (height !== undefined) return pixels((height * box.width) / box.height, height)
  return pixels(box.width, box.height)
}

// ─── Watermark ──────────────────────────────────────────────────────────────

const WATERMARK_FONT_SHARE = 0.025
const WATERMARK_FALLBACK_SIZE = 1024

/** Text content escaped as XMLSerializer writes it (quotes need none there), without characters XML cannot hold. */
function escapeXmlText(text: string): string {
  const entities: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;" }
  return text
    .replace(/[^\t\n\r\x20-\u{D7FF}\u{E000}-\u{FFFD}\u{10000}-\u{10FFFF}]/gu, "")
    .replace(/[&<>]/g, (c) => entities[c])
}

const num = (n: number) => String(Math.round(n * 100) / 100)

/** The outline's width, a share of the font size: thick enough to read, thin enough to keep the letters open. */
const WATERMARK_OUTLINE_SHARE = 0.12

/**
 * Add a small text watermark (bottom right, sans-serif, its size 2.5 % of the
 * width) as the LAST child of the root, in the root's user units: the viewBox,
 * else numeric width/height, else 1024×1024. It is white with a dark outline
 * drawn under the fill (`paint-order: stroke`), so it reads on a light drawing
 * and a dark one, in a browser and in the PNG still (librsvg). Its look is also
 * an inline `!important` style, so the model's own <style> cannot restyle or
 * hide it. Returns a new string; the input must already be sanitized.
 */
export function appendSvgWatermark(svg: string, text: string): string {
  const root = readRootTag(svg)
  if (!root) throw new SvgRefusedError("watermark-no-root")
  const viewBox = parseViewBox(root.attrs.get("viewBox"))
  const width = parseLength(root.attrs.get("width"))
  const height = parseLength(root.attrs.get("height"))
  const box = viewBox ?? (width !== undefined && height !== undefined
    ? { x: 0, y: 0, width, height }
    : { x: 0, y: 0, width: WATERMARK_FALLBACK_SIZE, height: WATERMARK_FALLBACK_SIZE })
  const size = num(box.width * WATERMARK_FONT_SHARE)
  const outline = num(box.width * WATERMARK_FONT_SHARE * WATERMARK_OUTLINE_SHARE)
  const pad = box.width * WATERMARK_FONT_SHARE * 0.8
  const style = [
    "font-family:sans-serif", `font-size:${size}px`, "fill:#ffffff", "fill-opacity:0.85",
    "stroke:#000000", "stroke-opacity:0.6", `stroke-width:${outline}px`, "stroke-linejoin:round", "paint-order:stroke",
    "text-anchor:end", "opacity:1", "display:inline", "visibility:visible", "transform:none",
  ].map((d) => `${d}!important`).join(";")
  const mark = `<text x="${num(box.x + box.width - pad)}" y="${num(box.y + box.height - pad)}"` +
    ` font-family="sans-serif" font-size="${size}" fill="#ffffff" fill-opacity="0.85"` +
    ` stroke="#000000" stroke-opacity="0.6" stroke-width="${outline}" stroke-linejoin="round" paint-order="stroke"` +
    ` text-anchor="end" style="${style}">${escapeXmlText(text)}</text>`
  if (root.selfCloseAt !== undefined) {
    return `${svg.slice(0, root.selfCloseAt)}>${mark}</svg>${svg.slice(root.end)}`
  }
  const close = svg.lastIndexOf("</svg")
  if (close < root.end) throw new SvgRefusedError("watermark-no-close")
  return svg.slice(0, close) + mark + svg.slice(close)
}
