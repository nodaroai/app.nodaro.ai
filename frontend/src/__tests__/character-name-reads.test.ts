// @test-watches frontend/src/**/*.{ts,tsx} backend/src/**/*.ts
import { describe, expect, it } from "vitest"
import fs from "node:fs"
import path from "node:path"
import ts from "typescript"
import { CHARACTER_NODE_DEFAULT_LABEL } from "@nodaro/shared/entities"
import { NODE_DEFINITIONS } from "@/types/nodes"

/**
 * A wired Character node is named by ONE rule (decided 2026-11-11):
 * `wiredCharacterNames` / `wiredCharacterNamesOf` in @nodaro/shared — its own
 * name, else "Character N" for each unnamed node, numbered for the node it
 * feeds. The editor's Run, the workflow run and the editor's panels all read
 * it, so they name the same characters the same way and never merge two
 * unnamed nodes.
 *
 * The bug it replaced was a local `characterName || label` (or `??`) at each
 * site: every unnamed node came out as its default label, "Character Asset",
 * so two of them merged into one character, and the sites disagreed (`||`
 * against `??`). This guard fails any app file that reads a node's
 * `characterName` together with its `label` in one `||` / `??` chain (across
 * lines, casts and parentheses). Read the shared rule instead.
 *
 * ALLOWED: files that do it for a display-only title, never a name a model or
 * a slug reads — each with the reason.
 */
const ALLOWED: Readonly<Record<string, string>> = {
  "frontend/src/components/nodes/character-node.tsx":
    "the facet chips' title for an identity source wired into a Character's Assets — on-canvas display text only, never sent to a model or slugified",
}

const REPO = path.resolve(__dirname, "..", "..", "..")
const SCAN = ["frontend/src", "backend/src"]
const SKIP_DIRS = new Set(["node_modules", "dist", "build", "coverage", "__tests__"])

function walk(rel: string, out: string[]): void {
  for (const e of fs.readdirSync(path.join(REPO, rel), { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name) || e.name.startsWith(".")) continue
    const r = `${rel}/${e.name}`
    if (e.isDirectory()) walk(r, out)
    else if (/\.tsx?$/.test(e.name) && !/\.(test|spec)\.tsx?$/.test(e.name)) out.push(r)
  }
}

const isOr = (n: ts.Node): n is ts.BinaryExpression =>
  ts.isBinaryExpression(n) &&
  (n.operatorToken.kind === ts.SyntaxKind.BarBarToken || n.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)

/** The operands of a whole `a || b ?? c` chain, parentheses and casts looked through. */
function operands(n: ts.Expression, out: ts.Expression[] = []): ts.Expression[] {
  let e: ts.Expression = n
  while (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isNonNullExpression(e) || ts.isTypeAssertionExpression(e)) e = e.expression
  if (isOr(e)) {
    operands(e.left, out)
    operands(e.right, out)
  } else out.push(e)
  return out
}

/** The property an operand reads at its end: `x.characterName`, `x?.label`, `x["label"]`. */
function readsProperty(e: ts.Expression): string | null {
  if (ts.isPropertyAccessExpression(e)) return e.name.text
  if (ts.isElementAccessExpression(e) && ts.isStringLiteralLike(e.argumentExpression)) return e.argumentExpression.text
  return null
}

function offenders(rel: string, text: string): string[] {
  if (!text.includes("characterName")) return []
  const sf = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true, rel.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const out: string[] = []
  const visit = (node: ts.Node): void => {
    if (isOr(node) && !(node.parent && (isOr(node.parent) || ts.isParenthesizedExpression(node.parent) && isOr(node.parent.parent)))) {
      const props = new Set(operands(node).map(readsProperty))
      if (props.has("characterName") && props.has("label")) {
        out.push(`${rel}:${sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1}`)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return out
}

describe("a wired Character is named by the shared rule, never by a local characterName || label", () => {
  const files: string[] = []
  for (const dir of SCAN) walk(dir, files)
  const hits = new Map<string, string[]>()
  for (const rel of files) {
    const found = offenders(rel, fs.readFileSync(path.join(REPO, rel), "utf8"))
    if (found.length > 0) hits.set(rel, found)
  }

  it("no app file reads characterName with label in one || / ?? chain (use wiredCharacterNames)", () => {
    const bad = [...hits].filter(([rel]) => !(rel in ALLOWED)).flatMap(([, at]) => at)
    expect(bad).toEqual([])
  })

  it("every allowed file still does it (the list only shrinks)", () => {
    expect(Object.keys(ALLOWED).filter((rel) => !hits.has(rel))).toEqual([])
  })

  it("the guard sees the shape it guards (a multi-line, cast, parenthesized chain)", () => {
    const sample = `const n = (\n  (d.characterName as string) ||\n  (d.label as string) ||\n  ""\n)\nconst m = d?.characterName ?? d?.["label"] ?? ""`
    expect(offenders("x.ts", sample)).toEqual(["x.ts:2", "x.ts:6"])
  })
})

describe("the Character node's default label is the one the naming rule treats as unnamed", () => {
  it("its definition label and default data label are CHARACTER_NODE_DEFAULT_LABEL", () => {
    const def = NODE_DEFINITIONS.find((d) => d.type === "character")
    expect(def?.label).toBe(CHARACTER_NODE_DEFAULT_LABEL)
    expect((def?.defaultData as { label?: string } | undefined)?.label).toBe(CHARACTER_NODE_DEFAULT_LABEL)
  })
})
