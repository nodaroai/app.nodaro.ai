// @vitest-environment node
// @test-watches frontend/src/app/** frontend/src/components/** frontend/src/ee/** frontend/src/routes/**
import { describe, it, expect } from "vitest"
import fs from "node:fs"
import path from "node:path"
import ts from "typescript"

/**
 * The signed-in pages and the public pages stay usable with a keyboard and a
 * screen reader (SI 5568 / WCAG 2.0: 4.1.2 Name, Role, Value; 2.1.1 Keyboard):
 *
 *  1. A button whose only content is an icon has a name (`aria-label`,
 *     `aria-labelledby` or `title`), or a screen reader announces "button".
 *  2. A <div>/<span>/<li>/<p>/<img>/<svg> that reacts to a click is reachable
 *     and usable from the keyboard: it has a `role` and a key handler, or it
 *     is decoration (`aria-hidden`, `role="presentation"` / `"none"`), e.g. a
 *     dialog backdrop that Escape also closes. A handler that only stops the
 *     click from bubbling is not an interaction.
 *
 * The editor and its panels are checked in their own phase; their folders are
 * outside SCOPE until then.
 */

const SRC = path.resolve(__dirname, "../..")

const SCOPE = [
  "app/(dashboard)",
  "app/(auth)",
  "app/gallery",
  "app/pricing",
  "app/checkout-complete",
  "components/dashboard",
  "components/layout",
  "components/apps",
  "components/integrations",
  "components/library",
  "components/gallery",
  "components/app-runner",
  "components/presentation",
  "components/legal",
  "ee/app/(dashboard)",
  "ee/app/org",
  "ee/app/workspace",
  "ee/app/join",
  "ee/app/accessibility",
  "ee/components/credits",
  "routes/project-page.tsx",
  "routes/app-runner-page.tsx",
  "routes/present-page.tsx",
  "routes/tutorial-page.tsx",
  "app/oauth",
  "app/auth",
  "app/setup",
  "app/mcp",
  "ee/app/explore",
  "components/tutorials",
  "components/templates",
  // The editor (phase 3).
  "components/editor",
  "components/nodes",
  "nodes",
  "components/pipeline",
  "components/edl-review",
  "components/render",
  "ee/components/copilot",
  "components/heygen",
  "components/audio-player",
  "components/inspector",
  "routes/workflow-editor-page.tsx",
  "routes/pipeline-page.tsx",
  "routes/video-director-page.tsx",
]

/** Elements that are controls by themselves: a click on them needs nothing more. */
const INTERACTIVE_TAGS = new Set(["button", "a", "input", "select", "textarea", "label", "summary", "option", "details"])
/** Components that render a plain, non-control element (an image, a card). */
const STATIC_COMPONENTS = new Set(["CachedImage", "GlassCard", "PreviewVideo"])
const isStatic = (tag: string) => (/^[a-z]/.test(tag) && !INTERACTIVE_TAGS.has(tag)) || STATIC_COMPONENTS.has(tag)
/** Components that render content of their own (a media preview, a text row), not a bare icon. */
const NOT_ICONS = /^(Badge|Avatar|AvatarImage|Image|Img|CachedImage|Spinner|Kbd|MetaAdMedia|SnippetRowContent)$/

function files(rel: string): string[] {
  const abs = path.join(SRC, rel)
  if (!fs.existsSync(abs)) return []
  if (fs.statSync(abs).isFile()) return [abs]
  const out: string[] = []
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === "__tests__" || e.name === "node_modules") continue
      const p = path.join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else if (e.name.endsWith(".tsx") && !e.name.includes(".test.")) out.push(p)
    }
  }
  walk(abs)
  return out
}

function attrNames(el: ts.JsxOpeningLikeElement, sf: ts.SourceFile): Map<string, ts.JsxAttribute | null> {
  const map = new Map<string, ts.JsxAttribute | null>()
  for (const a of el.attributes.properties) {
    if (ts.isJsxSpreadAttribute(a)) map.set(["pressable(", "seekSlider("].some((k) => a.getText(sf).includes(k)) ? "...pressable" : "...", null)
    else map.set(a.name.getText(sf), a)
  }
  return map
}

/** The tag of an icon element, or of both branches of {cond ? <A /> : <B />}. */
function iconTag(child: ts.JsxChild, sf: ts.SourceFile): string | null {
  if (ts.isJsxSelfClosingElement(child)) return child.tagName.getText(sf)
  if (ts.isJsxExpression(child) && child.expression) {
    let e: ts.Expression = child.expression
    while (ts.isParenthesizedExpression(e)) e = e.expression
    if (ts.isConditionalExpression(e)) {
      const unwrap = (x: ts.Expression) => { while (ts.isParenthesizedExpression(x)) x = x.expression; return x }
      const a = unwrap(e.whenTrue)
      const b = unwrap(e.whenFalse)
      if (ts.isJsxSelfClosingElement(a) && ts.isJsxSelfClosingElement(b)) return a.tagName.getText(sf)
    }
  }
  return null
}

function stringValue(attr: ts.JsxAttribute | null | undefined, sf: ts.SourceFile): string | null {
  if (!attr?.initializer) return null
  if (ts.isStringLiteral(attr.initializer)) return attr.initializer.text
  const text = attr.initializer.getText(sf)
  const m = /^\{\s*["'`]([^"'`]*)["'`]\s*\}$/.exec(text)
  return m ? m[1]! : null
}

function onlyStopsPropagation(attr: ts.JsxAttribute | null | undefined, sf: ts.SourceFile): boolean {
  const body = attr?.initializer?.getText(sf) ?? ""
  return /^\{\s*\(?\s*\w+\s*\)?\s*=>\s*\{?\s*\w+\.(stopPropagation|preventDefault)\(\)\s*;?\s*\}?\s*\}$/.test(body)
}

interface Finding {
  readonly where: string
  readonly what: string
}

function scan(): Finding[] {
  const found: Finding[] = []
  for (const rel of SCOPE) {
    for (const file of files(rel)) {
      const text = fs.readFileSync(file, "utf8")
      const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
      const where = (n: ts.Node) =>
        `${path.relative(SRC, file).split(path.sep).join("/")}:${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1}`
      const visit = (node: ts.Node) => {
        if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
          const open = ts.isJsxElement(node) ? node.openingElement : node
          const tag = open.tagName.getText(sf)
          const attrs = attrNames(open, sf)
          if (ts.isJsxElement(node) && (tag === "Button" || tag === "button")) {
            const named = ["aria-label", "aria-labelledby", "title", "..."].some((a) => attrs.has(a))
            const kids = node.children.filter((c) => !(ts.isJsxText(c) && c.getText(sf).trim() === ""))
            const icon = kids.length === 1 ? iconTag(kids[0]!, sf) : null
            if (!named && icon && /^[A-Z]\w*$/.test(icon) && !NOT_ICONS.test(icon)) {
              found.push({ where: where(node), what: `icon-only <${tag}> (${icon}) has no name` })
            }
          }
          if (isStatic(tag) && attrs.has("onClick")) {
            const role = stringValue(attrs.get("role"), sf)
            const decorative = attrs.has("aria-hidden") || role === "presentation" || role === "none"
            // A dialog that closes when its backdrop is clicked must also close on Escape
            // (axe and the dialog tests check that); a video's own click is a play/open
            // shortcut beside its controls, which are buttons of their own.
            // An element with a role kept out of the Tab order on purpose (tabIndex
            // -1: the Copilot's chips, whose keyboard path is the composer's own keys).
            const notATabStop = attrs.has("role") && attrs.get("tabIndex")?.getText(sf) === "tabIndex={-1}"
            const shortcut = role === "dialog" || tag === "video" || tag === "audio" || notATabStop
            const keyboard =
              attrs.has("...pressable") ||
              (attrs.has("role") && attrs.has("tabIndex") && (attrs.has("onKeyDown") || attrs.has("onKeyUp") || attrs.has("onKeyPress")))
            // A card a mouse opens anywhere, whose keyboard control is a <CoverButton>
            // child; a table row whose cells hold a real button doing the same.
            const children = ts.isJsxElement(node) ? node.children : ts.factory.createNodeArray<ts.JsxChild>()
            const childTags = children
              .filter((c): c is ts.JsxElement | ts.JsxSelfClosingElement => ts.isJsxElement(c) || ts.isJsxSelfClosingElement(c))
              .map((c) => (ts.isJsxElement(c) ? c.openingElement : c).tagName.getText(sf))
            const coverButton =
              childTags.includes("CoverButton") ||
              children.some((c) => ts.isJsxExpression(c) && /<CoverButton[\s/>]/.test(c.getText(sf)))
            const rowWithButton = tag === "tr" && /<(button|Button)\b/.test(node.getText(sf))
            if (!decorative && !shortcut && !keyboard && !coverButton && !rowWithButton && !onlyStopsPropagation(attrs.get("onClick"), sf)) {
              found.push({ where: where(node), what: `clickable <${tag}> without a role and a key handler` })
            }
          }
        }
        ts.forEachChild(node, visit)
      }
      visit(sf)
    }
  }
  return found
}

describe("signed-in and public pages: keyboard and screen reader basics", () => {
  const findings = scan()

  it("scans real files (not vacuous)", () => {
    expect(SCOPE.flatMap(files).length).toBeGreaterThan(100)
  })

  it("no icon-only button without a name", () => {
    expect(findings.filter((f) => f.what.startsWith("icon-only")).map((f) => `${f.where} ${f.what}`)).toEqual([])
  })

  it("no clickable element that a keyboard cannot reach", () => {
    expect(findings.filter((f) => f.what.startsWith("clickable")).map((f) => `${f.where} ${f.what}`)).toEqual([])
  })
})
