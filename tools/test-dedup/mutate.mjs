// tools/test-dedup/mutate.mjs
// The dependency-free mutator behind `equivalence.mjs remove` — the gate (a
// StrykerJS report is an optional cross-check). A fixed, deterministic operator
// set over the TypeScript 5.9 AST (StrykerJS's set, less regex and the
// arguments of string methods):
//   compare    — flip a comparison (<→>=, ===→!==, …)
//   logical    — swap && / || (?? → &&); `a ?? b` also → a, → b
//   arithmetic — + ↔ -, * ↔ /, % → *
//   assign     — += ↔ -=, *= ↔ /=, %= → *=, &&= ↔ ||=, ??= → &&=
//   update     — x++ ↔ x--, ++x ↔ --x
//   unary      — -x, +x, !x, ~x → x (a condition's `!` too)
//   optional   — a?.b → a.b, a?.[k] → a[k], f?.() → f()
//   negate     — negate an if/while/do/for/ternary condition
//   literal    — 0→1, n→0, "x"→"", `x${y}`→"", ""→"__mutant__", true↔false
//   array      — [a, …] → [], [] → ["__mutant__"]
//   object     — { a, … } → {}
//   block      — a non-empty block → {}
//   method     — startsWith ↔ endsWith, some ↔ every, min ↔ max, …; filter,
//                sort, slice, trim, … dropped (x.filter(f) → x)
//   call       — delete a call statement; any other call → undefined
//   return     — return undefined instead of the expression
//   arrow      — a concise arrow body → undefined
// A mutant must still parse: a syntax error fails every test, which would
// count as a kill. The self-test re-parses every applied site of its fixtures.
// A site is plain data ({ id, file, operator, start, end, original,
// replacement, line, column }), so applying one and running tests needs no
// TypeScript: `typescript` is loaded lazily, only to enumerate sites (never
// at import time — tools self-tests run without npm ci).
// @reads-none sites are computed from the source text the caller passes in
import { createRequire } from "node:module"
import path from "node:path"

/** The repo's `typescript` (root devDependency, 5.9 — TS 7 has no JS API). */
export function loadTypeScript(repoRoot) {
  const ts = createRequire(path.join(repoRoot, "package.json"))("typescript")
  if (typeof ts.createSourceFile !== "function") throw new Error(`typescript ${ts.version} has no JS API — the mutator needs TypeScript 5.x`)
  return ts
}

const COMPARE_FLIP = { "<": ">=", "<=": ">", ">": "<=", ">=": "<", "===": "!==", "!==": "===", "==": "!=", "!=": "==" }
const LOGICAL_FLIP = { "&&": "||", "||": "&&", "??": "&&" }
const ARITHMETIC_FLIP = { "+": "-", "-": "+", "*": "/", "/": "*", "%": "*" }
const ASSIGN_FLIP = { "+=": "-=", "-=": "+=", "*=": "/=", "/=": "*=", "%=": "*=", "&&=": "||=", "||=": "&&=", "??=": "&&=" }
// StrykerJS's MethodExpression: a swap names the replacement method, null
// drops the call (`x.filter(f)` → `x`).
const METHOD_SWAP = {
  startsWith: "endsWith", endsWith: "startsWith", some: "every", every: "some", min: "max", max: "min",
  toUpperCase: "toLowerCase", toLowerCase: "toUpperCase", toLocaleUpperCase: "toLocaleLowerCase",
  toLocaleLowerCase: "toLocaleUpperCase", trimStart: "trimEnd", trimEnd: "trimStart",
  indexOf: "lastIndexOf", lastIndexOf: "indexOf", find: "findLast", findLast: "find",
  findIndex: "findLastIndex", findLastIndex: "findIndex",
  filter: null, sort: null, reverse: null, slice: null, substring: null, substr: null, trim: null, charAt: null,
}

/**
 * Parses `spec` = `path[:from-to]` (1-based, inclusive lines, as Stryker's
 * mutation ranges) into { file, from, to }.
 */
export function parseSubject(spec) {
  const m = /^(.*?):(\d+)-(\d+)$/.exec(spec)
  if (!m) return { file: spec, from: 1, to: Number.POSITIVE_INFINITY }
  const from = Number(m[2])
  const to = Number(m[3])
  if (from > to) throw new Error(`bad line range in ${spec}`)
  return { file: m[1], from, to }
}

const isDeclare = (ts, n) => !!n.modifiers?.some((m) => m.kind === ts.SyntaxKind.DeclareKeyword)

// Code that never runs: types, import/export clauses, enums, `declare`.
function isTypeOnly(ts, n) {
  return ts.isTypeNode(n) || ts.isInterfaceDeclaration(n) || ts.isTypeAliasDeclaration(n)
    || ts.isImportDeclaration(n) || ts.isExportDeclaration(n) || ts.isEnumDeclaration(n)
    || ts.isExternalModuleReference(n) || isDeclare(ts, n)
}

function isPropertyNameLiteral(ts, node) {
  const p = node.parent
  return !!p && (ts.isPropertyAssignment(p) || ts.isPropertyDeclaration(p) || ts.isMethodDeclaration(p)
    || ts.isPropertySignature(p) || ts.isEnumMember(p) || ts.isGetAccessor(p) || ts.isSetAccessor(p)) && p.name === node
}

function isDirective(ts, node) {
  return ts.isExpressionStatement(node.parent) && /^["']use (strict|client|server)["']$/.test(node.getText())
}

// A string that is data: not a property name, a directive, a literal type, or
// a require()/import() specifier.
function mutableString(ts, node) {
  const p = node.parent
  if (isPropertyNameLiteral(ts, node) || isDirective(ts, node) || ts.isLiteralTypeNode(p)) return false
  if (ts.isCallExpression(p) && (p.expression.kind === ts.SyntaxKind.ImportKeyword
    || (ts.isIdentifier(p.expression) && p.expression.text === "require"))) return false
  return true
}

/**
 * Every mutation site of `source`, in source order (ids are stable for a given
 * text). `lines` restricts to sites whose start lies in [from, to].
 */
export function mutationSites(ts, source, file, { from = 1, to = Number.POSITIVE_INFINITY } = {}) {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, scriptKind(ts, file))
  const sites = []
  const seen = new Set() // one site per (span, replacement): `=> f()` is both an arrow body and a call
  const add = (start, end, operator, replacement) => {
    const lc = sf.getLineAndCharacterOfPosition(start)
    const line = lc.line + 1
    if (line < from || line > to) return
    const original = source.slice(start, end)
    if (original === replacement) return
    const key = `${start}:${end}:${replacement}`
    if (seen.has(key)) return
    seen.add(key)
    sites.push({ file, operator, start, end, original, replacement, line, column: lc.character + 1 })
  }
  const nodeSpan = (n) => [n.getStart(sf), n.getEnd()]

  const text = (n) => source.slice(n.getStart(sf), n.getEnd())

  const visit = (node) => {
    if (isTypeOnly(ts, node)) return
    if (ts.isBinaryExpression(node)) {
      const op = node.operatorToken.getText(sf)
      const [s, e] = nodeSpan(node.operatorToken)
      if (COMPARE_FLIP[op]) add(s, e, "compare", COMPARE_FLIP[op])
      if (LOGICAL_FLIP[op]) add(s, e, "logical", LOGICAL_FLIP[op])
      if (ARITHMETIC_FLIP[op]) add(s, e, "arithmetic", ARITHMETIC_FLIP[op])
      if (ASSIGN_FLIP[op]) add(s, e, "assign", ASSIGN_FLIP[op])
      if (op === "??") {
        const [ns, ne] = nodeSpan(node)
        add(ns, ne, "logical", `(${text(node.left)})`)
        add(ns, ne, "logical", `(${text(node.right)})`)
      }
    }
    if (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) {
      const [s, e] = nodeSpan(node)
      const k = node.operator
      if (k === ts.SyntaxKind.PlusPlusToken || k === ts.SyntaxKind.MinusMinusToken) {
        const flip = k === ts.SyntaxKind.PlusPlusToken ? "--" : "++"
        if (ts.isPrefixUnaryExpression(node)) add(s, s + 2, "update", flip)
        else add(e - 2, e, "update", flip)
      } else if (ts.isPrefixUnaryExpression(node)) {
        // -x, +x, !x, ~x → x, parenthesized so `-a ** 2` and the like still parse.
        add(s, e, "unary", `(${text(node.operand)})`)
      }
    }
    if ((ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node) || ts.isCallExpression(node)) && node.questionDotToken) {
      const [s, e] = nodeSpan(node.questionDotToken)
      add(s, e, "optional", ts.isPropertyAccessExpression(node) ? "." : "")
    }
    const condition = (ts.isIfStatement(node) || ts.isWhileStatement(node) || ts.isDoStatement(node)) ? node.expression
      : ts.isForStatement(node) ? node.condition
        : ts.isConditionalExpression(node) ? node.condition : undefined
    if (condition) {
      const [s, e] = nodeSpan(condition)
      add(s, e, "negate", `!(${source.slice(s, e)})`)
    }
    if (ts.isNumericLiteral(node)) {
      const [s, e] = nodeSpan(node)
      add(s, e, "literal", Number(node.text) === 0 ? "1" : "0")
    } else if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && mutableString(ts, node)) {
      const [s, e] = nodeSpan(node)
      add(s, e, "literal", node.text === "" ? '"__mutant__"' : '""')
    } else if (ts.isTemplateExpression(node) && !ts.isTaggedTemplateExpression(node.parent)) {
      const [s, e] = nodeSpan(node)
      add(s, e, "literal", '""')
    } else if (node.kind === ts.SyntaxKind.TrueKeyword || node.kind === ts.SyntaxKind.FalseKeyword) {
      const [s, e] = nodeSpan(node)
      add(s, e, "literal", node.kind === ts.SyntaxKind.TrueKeyword ? "false" : "true")
    }
    if (ts.isArrayLiteralExpression(node) && !isAssignmentTarget(ts, node)) {
      const [s, e] = nodeSpan(node)
      add(s, e, "array", node.elements.length > 0 ? "[]" : '["__mutant__"]')
    }
    if (ts.isObjectLiteralExpression(node) && node.properties.length > 0 && !isAssignmentTarget(ts, node)) {
      const [s, e] = nodeSpan(node)
      add(s, e, "object", "{}")
    }
    if (ts.isBlock(node) && node.statements.length > 0) {
      const [s, e] = nodeSpan(node)
      add(s, e, "block", "{}")
    }
    if (ts.isArrowFunction(node) && !ts.isBlock(node.body) && text(node.body) !== "undefined") {
      const [s, e] = nodeSpan(node.body)
      add(s, e, "arrow", "undefined")
    }
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && Object.hasOwn(METHOD_SWAP, node.expression.name.text)) {
      const swap = METHOD_SWAP[node.expression.name.text]
      if (swap) {
        const [s, e] = nodeSpan(node.expression.name)
        add(s, e, "method", swap)
      } else {
        const [s, e] = nodeSpan(node)
        add(s, e, "method", text(node.expression.expression))
      }
    }
    if (ts.isExpressionStatement(node)) {
      const ex = ts.isAwaitExpression(node.expression) ? node.expression.expression : node.expression
      if (ts.isCallExpression(ex) && !isSuperCall(ts, ex)) {
        const [s, e] = nodeSpan(node)
        add(s, e, "call", ";")
      }
    }
    if (ts.isCallExpression(node) && isValueCall(ts, node)) {
      const [s, e] = nodeSpan(node)
      add(s, e, "call", "undefined")
    }
    if (ts.isReturnStatement(node) && node.expression && node.expression.getText(sf) !== "undefined") {
      const [s, e] = nodeSpan(node.expression)
      add(s, e, "return", "undefined")
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  sites.sort((a, b) => a.start - b.start || a.end - b.end || a.operator.localeCompare(b.operator))
  return sites.map((site, i) => ({ id: `${file}#${i}`, ...site }))
}

function isSuperCall(ts, call) {
  return call.expression.kind === ts.SyntaxKind.SuperKeyword
}

// A call whose value is used: not a statement of its own (those are deleted
// instead), not super()/import()/require(), not a decorator.
function isValueCall(ts, call) {
  if (isSuperCall(ts, call) || call.expression.kind === ts.SyntaxKind.ImportKeyword) return false
  if (ts.isIdentifier(call.expression) && call.expression.text === "require") return false
  let p = call.parent
  if (ts.isDecorator(p)) return false
  if (ts.isAwaitExpression(p)) p = p.parent
  return !ts.isExpressionStatement(p)
}

// `[a, b] = …`, `({ a } = …)` and `for ([k, v] of …)` write to a pattern that
// is spelled as a literal: emptying it is not a mutant, it is a syntax error.
function isAssignmentTarget(ts, node) {
  let top = node
  while (top.parent && (ts.isArrayLiteralExpression(top.parent) || ts.isObjectLiteralExpression(top.parent)
    || ts.isPropertyAssignment(top.parent) || ts.isShorthandPropertyAssignment(top.parent)
    || ts.isSpreadElement(top.parent) || ts.isSpreadAssignment(top.parent) || ts.isParenthesizedExpression(top.parent))) top = top.parent
  const p = top.parent
  if (!p) return false
  if (ts.isBinaryExpression(p) && p.operatorToken.kind === ts.SyntaxKind.EqualsToken && p.left === top) return true
  return (ts.isForOfStatement(p) || ts.isForInStatement(p)) && p.initializer === top
}

const scriptKind = (ts, file) => (file.endsWith(".tsx") ? ts.ScriptKind.TSX
  : file.endsWith(".jsx") ? ts.ScriptKind.JSX
    : /\.[cm]?js$/.test(file) ? ts.ScriptKind.JS : ts.ScriptKind.TS)

/** The parse errors of `source` (TypeScript's own parser): a mutant must have none. */
export function parseErrors(ts, source, file) {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, false, scriptKind(ts, file))
  return (sf.parseDiagnostics ?? []).map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n"))
}

/** `source` with one site applied. Throws when the text no longer matches. */
export function applySite(source, site) {
  if (source.slice(site.start, site.end) !== site.original) {
    throw new Error(`site ${site.id} no longer matches the source (expected ${JSON.stringify(site.original)} at ${site.line}:${site.column})`)
  }
  return source.slice(0, site.start) + site.replacement + source.slice(site.end)
}

/** One line naming a mutant, for tables: `file:line:col operator  "orig" → "repl"`. */
export function describeSite(site) {
  const clip = (s) => { const one = s.replace(/\s+/g, " "); return one.length > 60 ? `${one.slice(0, 57)}...` : one }
  return `${site.file}:${site.line}:${site.column} ${site.operator} \`${clip(site.original)}\` → \`${clip(site.replacement)}\``
}

// node tools/test-dedup/mutate.mjs <file> [--as <name>]  → the file's sites as JSON
// (--as names the file in the sites, e.g. relative to a fixture directory).
if (process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  const { readFileSync } = await import("node:fs")
  const { parseArgs } = await import("node:util")
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { as: { type: "string" } } })
  const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..")
  const { file, from, to } = parseSubject(positionals[0])
  const sites = mutationSites(loadTypeScript(repoRoot), readFileSync(file, "utf8"), values.as ?? file, { from, to })
  process.stdout.write(`${JSON.stringify(sites, null, 2)}\n`)
}
