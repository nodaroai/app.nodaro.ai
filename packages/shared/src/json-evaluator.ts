// --- Types ---

export type FilterOperator =
  | "equals" | "not_equals"
  | "contains" | "not_contains"
  | "starts_with" | "ends_with"
  | "greater_than" | "less_than"
  | "is_empty" | "is_not_empty"
  | "matches_regex"
  | "in_list"

export interface JsonFilter {
  id: string
  field: string
  operator: FilterOperator
  value: string | string[]
}

export type JsonEvalResult =
  | { ok: true; value: unknown }
  | { ok: false; error: string }

// --- Helpers ---

const BARE_IDENT = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/

function escapeString(v: string): string {
  return v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')
}

function fieldRef(field: string): string {
  return BARE_IDENT.test(field) ? `.${field}` : `.["${escapeString(field)}"]`
}

function coerceValue(v: string): string {
  const trimmed = v.trim()
  if (trimmed === "" || trimmed === "Infinity" || trimmed === "-Infinity" || trimmed === "NaN") return `"${trimmed}"`
  const n = Number(trimmed)
  return Number.isFinite(n) ? String(n) : `"${escapeString(trimmed)}"`
}

function buildFilterExpr(f: JsonFilter): string {
  const ref = fieldRef(f.field)
  switch (f.operator) {
    case "equals": return `select(${ref} == ${coerceValue(f.value as string)})`
    case "not_equals": return `select(${ref} != ${coerceValue(f.value as string)})`
    case "contains": return `select(${ref} | contains("${escapeString(f.value as string)}"))`
    case "not_contains": return `select(${ref} | contains("${escapeString(f.value as string)}") | not)`
    case "starts_with": return `select(${ref} | startswith("${escapeString(f.value as string)}"))`
    case "ends_with": return `select(${ref} | endswith("${escapeString(f.value as string)}"))`
    case "greater_than": {
      const n = Number((f.value as string).trim())
      if (!Number.isFinite(n)) return `select(${ref} > 0)`
      return `select(${ref} > ${n})`
    }
    case "less_than": {
      const n = Number((f.value as string).trim())
      if (!Number.isFinite(n)) return `select(${ref} < 0)`
      return `select(${ref} < ${n})`
    }
    case "is_empty": return `select(${ref} == null or ${ref} == "")`
    case "is_not_empty": return `select(${ref} != null and ${ref} != "")`
    case "matches_regex": return `select(${ref} | test("${escapeString(f.value as string)}"))`
    case "in_list": {
      // Tolerate string form: users can switch operator to "in_list" while the
      // previous operator's string value is still in place. Comma-split so the
      // config panel's "a, b, c" shape works before it's persisted as an array.
      const raw = Array.isArray(f.value)
        ? f.value
        : String(f.value ?? "").split(",").map((s) => s.trim()).filter(Boolean)
      if (raw.length === 0) return `select(false)`
      const items = raw.map((v) => `${ref} == ${coerceValue(v)}`)
      return `select(${items.join(" or ")})`
    }
    default: return `select(true)`
  }
}

// --- Public API ---

export function buildExpressionFromVisual(config: {
  inputPath?: string
  filters?: JsonFilter[]
  projections?: string[]
}): string {
  const { inputPath, filters = [], projections = [] } = config
  const hasFilters = filters.length > 0
  const hasProjections = projections.length > 0
  const hasPath = !!inputPath && inputPath.trim().length > 0

  // Stage 1: path
  let path = hasPath ? `.${inputPath}` : "."

  // Append [] if filters or projections exist
  if (hasFilters || hasProjections) {
    path += "[]"
  }

  // If nothing configured, return identity
  if (!hasPath && !hasFilters && !hasProjections) return "."

  const parts: string[] = [path]

  // Stage 2: filters (AND via separate select pipes)
  for (const f of filters) {
    parts.push(buildFilterExpr(f))
  }

  // Stage 3: projections
  if (hasProjections) {
    const fields = projections.map((p) => {
      if (BARE_IDENT.test(p)) return p
      return `"${p}": .["${p}"]`
    })
    parts.push(`{${fields.join(", ")}}`)
  }

  return parts.join(" | ")
}

// --- Tokenizer ---

type TokType =
  | "DOT" | "PIPE" | "LBRACE" | "RBRACE" | "LBRACKET" | "RBRACKET"
  | "LPAREN" | "RPAREN" | "COMMA" | "COLON"
  | "EMPTY_ITER"        // []
  | "INDEX"             // [N] or [-N]
  | "BRACKET_KEY"       // ["str"]
  | "IDENT"             // bare identifier or keyword
  | "STRING"            // "..."
  | "NUMBER"            // 42 / 3.14
  | "OP"                // == != > < >= <=

interface Token { type: TokType; value: string | number }

function tokenize(expr: string): Token[] {
  const tokens: Token[] = []
  let i = 0

  while (i < expr.length) {
    // whitespace
    if (/\s/.test(expr[i])) { i++; continue }

    const ch = expr[i]

    // single-char structural
    if (ch === ".") { tokens.push({ type: "DOT", value: "." }); i++; continue }
    if (ch === "|") { tokens.push({ type: "PIPE", value: "|" }); i++; continue }
    if (ch === "{") { tokens.push({ type: "LBRACE", value: "{" }); i++; continue }
    if (ch === "}") { tokens.push({ type: "RBRACE", value: "}" }); i++; continue }
    if (ch === "(") { tokens.push({ type: "LPAREN", value: "(" }); i++; continue }
    if (ch === ")") { tokens.push({ type: "RPAREN", value: ")" }); i++; continue }
    if (ch === ",") { tokens.push({ type: "COMMA", value: "," }); i++; continue }
    if (ch === ":") { tokens.push({ type: "COLON", value: ":" }); i++; continue }

    // bracket forms: [], [N], [-N], ["str"]
    if (ch === "[") {
      const rest = expr.slice(i)
      // ["str"]
      const bkStr = rest.match(/^\["((?:[^"\\]|\\.)*)"\]/)
      if (bkStr) {
        const unescaped = bkStr[1].replace(/\\"/g, '"').replace(/\\\\/g, "\\").replace(/\\n/g, "\n").replace(/\\t/g, "\t")
        tokens.push({ type: "BRACKET_KEY", value: unescaped })
        i += bkStr[0].length; continue
      }
      // []
      const bkEmpty = rest.match(/^\[\]/)
      if (bkEmpty) {
        tokens.push({ type: "EMPTY_ITER", value: "[]" })
        i += 2; continue
      }
      // [-N] or [N]
      const bkIdx = rest.match(/^\[-?(\d+)\]/)
      if (bkIdx) {
        const raw = rest.match(/^\[(-?\d+)\]/)!
        tokens.push({ type: "INDEX", value: parseInt(raw[1], 10) })
        i += raw[0].length; continue
      }
      // standalone [ (for parser completeness — treated as error later)
      tokens.push({ type: "LBRACKET", value: "[" }); i++; continue
    }

    // two-char operators
    if (i + 1 < expr.length) {
      const two = expr.slice(i, i + 2)
      if (two === "==" || two === "!=" || two === ">=" || two === "<=") {
        tokens.push({ type: "OP", value: two }); i += 2; continue
      }
    }
    if (ch === ">" || ch === "<") {
      tokens.push({ type: "OP", value: ch }); i++; continue
    }

    // string literal
    if (ch === '"') {
      let s = ""
      i++ // skip opening "
      while (i < expr.length && expr[i] !== '"') {
        if (expr[i] === "\\") {
          i++
          const esc = expr[i]
          if (esc === '"') s += '"'
          else if (esc === "\\") s += "\\"
          else if (esc === "n") s += "\n"
          else if (esc === "t") s += "\t"
          else s += esc
        } else {
          s += expr[i]
        }
        i++
      }
      if (expr[i] !== '"') throw new Error("Unterminated string literal")
      i++ // skip closing "
      tokens.push({ type: "STRING", value: s }); continue
    }

    // number
    if (/[0-9]/.test(ch) || (ch === "-" && /[0-9]/.test(expr[i + 1] ?? ""))) {
      const m = expr.slice(i).match(/^-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/)
      if (m) {
        const n = Number(m[0])
        if (!Number.isFinite(n)) throw new Error(`Invalid number: ${m[0]}`)
        tokens.push({ type: "NUMBER", value: n })
        i += m[0].length; continue
      }
    }

    // identifier / keyword
    const idm = expr.slice(i).match(/^[a-zA-Z_$][a-zA-Z0-9_$]*/)
    if (idm) {
      tokens.push({ type: "IDENT", value: idm[0] })
      i += idm[0].length; continue
    }

    throw new Error(`Unexpected character '${ch}' at position ${i}`)
  }

  return tokens
}

// --- AST Node Types ---

type AstNode =
  | { k: "identity" }
  | { k: "dot"; field: string }
  | { k: "bracket"; key: string }
  | { k: "iterate" }
  | { k: "index"; index: number }
  | { k: "pipe"; left: AstNode; right: AstNode }
  | { k: "select"; cond: AstNode }
  | { k: "object"; fields: Array<{ key: string; valueExpr: AstNode | null }> }
  | { k: "compare"; op: string; left: AstNode; right: AstNode }
  | { k: "bool"; op: "and" | "or"; left: AstNode; right: AstNode }
  | { k: "not" }
  | { k: "func"; name: string; arg: string }
  | { k: "literal"; value: string | number }
  | { k: "path"; steps: AstNode[] }  // chained dot/bracket/iterate/index

// --- Parser ---

class Parser {
  private pos = 0
  constructor(private tokens: Token[]) {}

  private peek(): Token | undefined { return this.tokens[this.pos] }
  private eat(): Token {
    const t = this.tokens[this.pos++]
    if (!t) throw new Error("Unexpected end of expression")
    return t
  }
  private expect(type: TokType): Token {
    const t = this.eat()
    if (t.type !== type) throw new Error(`Expected ${type}, got ${t.type} ('${t.value}')`)
    return t
  }
  private at(type: TokType): boolean { return this.peek()?.type === type }
  private atIdent(v: string): boolean { return this.peek()?.type === "IDENT" && this.peek()?.value === v }
  private done(): boolean { return this.pos >= this.tokens.length }

  parse(): AstNode {
    const node = this.parsePipe()
    if (!this.done()) throw new Error(`Unexpected token '${this.peek()!.value}' at position ${this.pos}`)
    return node
  }

  private parsePipe(): AstNode {
    let left = this.parseBoolExpr()
    while (this.at("PIPE")) {
      this.eat() // consume |
      const right = this.parseBoolExpr()
      left = { k: "pipe", left, right }
    }
    return left
  }

  private parseBoolExpr(): AstNode {
    let left = this.parseCompare()
    while (this.atIdent("and") || this.atIdent("or")) {
      const op = this.eat().value as "and" | "or"
      const right = this.parseCompare()
      left = { k: "bool", op, left, right }
    }
    return left
  }

  private parseCompare(): AstNode {
    const left = this.parseAtom()
    if (this.at("OP")) {
      const op = this.eat().value as string
      const right = this.parseAtom()
      return { k: "compare", op, left, right }
    }
    return left
  }

  // parseAtom handles all leaf-level filter constructs
  private parseAtom(): AstNode {
    // select(...)
    if (this.atIdent("select")) {
      this.eat()
      this.expect("LPAREN")
      // Allow full pipe expressions inside select (e.g., select(.name | contains("x")))
      const cond = this.parsePipe()
      this.expect("RPAREN")
      return { k: "select", cond }
    }
    // not (postfix — standalone in pipe context)
    if (this.atIdent("not")) {
      this.eat()
      return { k: "not" }
    }
    // object construction
    if (this.at("LBRACE")) {
      return this.parseObjectCtor()
    }
    // string function calls (contains, startswith, endswith, test) with arg
    if (this.at("IDENT")) {
      const name = this.peek()!.value as string
      if (["contains", "startswith", "endswith", "test"].includes(name)) {
        // look ahead for (
        if (this.tokens[this.pos + 1]?.type === "LPAREN") {
          this.eat() // name
          this.eat() // (
          const argTok = this.eat()
          if (argTok.type !== "STRING") throw new Error(`${name}() argument must be a string`)
          this.expect("RPAREN")
          return { k: "func", name, arg: argTok.value as string }
        }
      }
    }
    // parenthesised expression
    if (this.at("LPAREN")) {
      this.eat()
      const inner = this.parseBoolExpr()
      this.expect("RPAREN")
      return inner
    }
    // literals and paths
    if (this.at("STRING")) {
      return { k: "literal", value: this.eat().value as string }
    }
    if (this.at("NUMBER")) {
      return { k: "literal", value: this.eat().value as number }
    }
    return this.parsePath()
  }

  private parsePath(): AstNode {
    if (!this.at("DOT")) throw new Error(`Expected path starting with '.', got '${this.peek()?.value ?? "EOF"}'`)
    this.eat() // consume .

    // bare "." — identity
    const steps: AstNode[] = []

    // after dot, there may be an identifier or a bracket form
    if (this.at("IDENT") && !["select","not","contains","startswith","endswith","test","and","or","null","true","false"].includes(this.peek()!.value as string)) {
      steps.push({ k: "dot", field: this.eat().value as string })
    } else if (this.at("BRACKET_KEY")) {
      steps.push({ k: "bracket", key: this.eat().value as string })
    } else if (this.at("EMPTY_ITER")) {
      this.eat()
      steps.push({ k: "iterate" })
    } else if (this.at("INDEX")) {
      steps.push({ k: "index", index: this.eat().value as number })
    } else {
      // just "."
      if (steps.length === 0) return { k: "identity" }
    }

    // chain more accesses: .foo.bar, .foo[0], .foo[]
    while (true) {
      if (this.at("DOT")) {
        this.eat()
        if (this.at("IDENT") && !["select","not","contains","startswith","endswith","test","and","or"].includes(this.peek()!.value as string)) {
          steps.push({ k: "dot", field: this.eat().value as string })
        } else if (this.at("BRACKET_KEY")) {
          steps.push({ k: "bracket", key: this.eat().value as string })
        } else if (this.at("EMPTY_ITER")) {
          this.eat(); steps.push({ k: "iterate" })
        } else if (this.at("INDEX")) {
          steps.push({ k: "index", index: this.eat().value as number })
        } else {
          // trailing dot — treat as identity at end (shouldn't normally happen)
          break
        }
      } else if (this.at("BRACKET_KEY")) {
        steps.push({ k: "bracket", key: this.eat().value as string })
      } else if (this.at("EMPTY_ITER")) {
        this.eat(); steps.push({ k: "iterate" })
      } else if (this.at("INDEX")) {
        steps.push({ k: "index", index: this.eat().value as number })
      } else {
        break
      }
    }

    if (steps.length === 0) return { k: "identity" }
    if (steps.length === 1) return steps[0]
    return { k: "path", steps }
  }

  private parseObjectCtor(): AstNode {
    this.eat() // {
    const fields: Array<{ key: string; valueExpr: AstNode | null }> = []

    while (!this.at("RBRACE") && !this.done()) {
      let key: string
      let valueExpr: AstNode | null = null

      if (this.at("IDENT")) {
        key = this.eat().value as string
        if (this.at("COLON")) {
          this.eat() // :
          valueExpr = this.parsePipe()
        }
        // else shorthand: {name} => {name: .name}
      } else if (this.at("STRING")) {
        key = this.eat().value as string
        this.expect("COLON")
        valueExpr = this.parsePipe()
      } else {
        throw new Error(`Expected field name in object constructor, got '${this.peek()?.value}'`)
      }

      fields.push({ key, valueExpr })
      if (this.at("COMMA")) this.eat()
    }

    this.expect("RBRACE")
    return { k: "object", fields }
  }
}

// --- Evaluator ---

// Sentinel to represent "this item was dropped by select"
const DROPPED = Symbol("DROPPED")
// Sentinel to track that we're in iterate mode (stream of items)
type EvalValue = unknown | typeof DROPPED

function isTruthy(v: unknown): boolean {
  if (v === null || v === undefined || v === false || v === 0 || v === "") return false
  return true
}

// --- Per-call evaluation context ---

interface EvalCtx {
  expandedArrays: WeakSet<object>
  objectSourcedArrays: WeakSet<object>
  regexCache: Map<string, RegExp>
}

function evalNode(node: AstNode, input: unknown, ctx: EvalCtx): EvalValue | EvalValue[] {
  switch (node.k) {
    case "identity":
      return input

    case "dot": {
      if (input === null || input === undefined) return null
      if (typeof input !== "object" || Array.isArray(input)) {
        throw new Error(`Cannot access field '.${node.field}' on ${Array.isArray(input) ? "array" : typeof input}`)
      }
      const obj = input as Record<string, unknown>
      if (!(node.field in obj)) {
        const available = Object.keys(obj).join(", ")
        throw new Error(`Field '${node.field}' not found. Available fields: ${available || "(none)"}`)
      }
      return obj[node.field]
    }

    case "bracket": {
      if (input === null || input === undefined) return null
      if (typeof input !== "object" || Array.isArray(input)) {
        throw new Error(`Cannot bracket-access on ${Array.isArray(input) ? "array" : typeof input}`)
      }
      const obj = input as Record<string, unknown>
      if (!(node.key in obj)) {
        const available = Object.keys(obj).join(", ")
        throw new Error(`Field '${node.key}' not found. Available fields: ${available || "(none)"}`)
      }
      return obj[node.key]
    }

    case "index": {
      if (!Array.isArray(input)) throw new Error(`Cannot index non-array with .[${node.index}]`)
      const idx = node.index < 0 ? input.length + node.index : node.index
      return idx >= 0 && idx < input.length ? input[idx] : null
    }

    case "iterate": {
      if (Array.isArray(input)) {
        return input // return as array — caller handles fan-out
      }
      if (typeof input === "object" && input !== null) {
        // treat object as single-item sequence per spec
        const arr = [input]
        ctx.objectSourcedArrays.add(arr)
        return arr
      }
      throw new Error(`Cannot iterate over ${typeof input}`)
    }

    case "path": {
      let cur: unknown = input
      for (let i = 0; i < node.steps.length; i++) {
        const step = node.steps[i]
        const res = evalNode(step, cur, ctx)
        // if a step returns an array (from iterate), fan out remaining steps
        if (step.k === "iterate" && Array.isArray(res)) {
          const wasObjSourced = ctx.objectSourcedArrays.has(res as object)
          // fan out remaining steps over each element
          const remaining = node.steps.slice(i + 1)
          if (remaining.length === 0) return res
          const fanned: unknown[] = []
          for (const item of res) {
            const subNode: AstNode = remaining.length === 1 ? remaining[0] : { k: "path", steps: remaining }
            const subRes = evalNode(subNode, item, ctx)
            if (Array.isArray(subRes)) fanned.push(...subRes)
            else if (subRes !== DROPPED) fanned.push(subRes)
          }
          return markExpanded(fanned, wasObjSourced, ctx)
        }
        cur = res
      }
      return cur
    }

    case "pipe": {
      // Evaluate left side; if it produces an array (from iterate), fan-out over right side
      const leftVal = evalNode(node.left, input, ctx)

      // Check if left side was an iterate that produced array expansion
      const leftIsExpanded = isExpandedArray(node.left, leftVal, ctx)

      if (leftIsExpanded && Array.isArray(leftVal)) {
        const wasObjectSourced = ctx.objectSourcedArrays.has(leftVal as object)
        const results: unknown[] = []
        for (const item of leftVal) {
          const r = evalNode(node.right, item, ctx)
          if (r === DROPPED) continue
          if (Array.isArray(r) && isExpandedArray(node.right, r, ctx)) {
            results.push(...r)
          } else if (r !== DROPPED) {
            results.push(r)
          }
        }
        // mark as expanded, preserving object-sourced flag
        return markExpanded(results, wasObjectSourced, ctx)
      }

      if (leftVal === DROPPED) return DROPPED

      // scalar left — apply right once
      return evalNode(node.right, leftVal, ctx)
    }

    case "select": {
      const condVal = evalNode(node.cond, input, ctx)
      // If condition is a pipe that produced an expanded array (e.g., select(.name | contains("x"))),
      // the truthiness is based on the final scalar result (the pipe's output).
      // An expanded array here means the condition pipeline returned array results — use last item.
      if (Array.isArray(condVal) && ctx.expandedArrays.has(condVal)) {
        const last = condVal[condVal.length - 1]
        return isTruthy(last) ? input : DROPPED
      }
      return isTruthy(condVal as unknown) ? input : DROPPED
    }

    case "not": {
      return !isTruthy(input)
    }

    case "object": {
      const result: Record<string, unknown> = {}
      for (const { key, valueExpr } of node.fields) {
        let fieldVal: unknown
        if (valueExpr === null) {
          // shorthand: {name} => .name
          fieldVal = evalNode({ k: "dot", field: key }, input, ctx)
        } else {
          fieldVal = evalNode(valueExpr, input, ctx)
        }
        if (fieldVal === DROPPED) return DROPPED
        result[key] = fieldVal
      }
      return result
    }

    case "compare": {
      const lv = evalNode(node.left, input, ctx) as unknown
      const rv = evalNode(node.right, input, ctx) as unknown
      switch (node.op) {
        case "==": return lv === rv
        case "!=": return lv !== rv
        case ">":  return typeof lv === "number" && typeof rv === "number" ? lv > rv : false
        case "<":  return typeof lv === "number" && typeof rv === "number" ? lv < rv : false
        case ">=": return typeof lv === "number" && typeof rv === "number" ? lv >= rv : false
        case "<=": return typeof lv === "number" && typeof rv === "number" ? lv <= rv : false
        default:   return false
      }
    }

    case "bool": {
      const lv = evalNode(node.left, input, ctx)
      if (node.op === "and") {
        if (!isTruthy(lv as unknown)) return false
        return isTruthy(evalNode(node.right, input, ctx) as unknown)
      } else {
        if (isTruthy(lv as unknown)) return true
        return isTruthy(evalNode(node.right, input, ctx) as unknown)
      }
    }

    case "func": {
      if (typeof input !== "string") throw new Error(`${node.name}() requires a string input`)
      switch (node.name) {
        case "contains":   return input.includes(node.arg)
        case "startswith": return input.startsWith(node.arg)
        case "endswith":   return input.endsWith(node.arg)
        case "test": {
          let re = ctx.regexCache.get(node.arg)
          if (!re) {
            if (/(\([^)]*[+*][^)]*\))[+*]/.test(node.arg)) {
              throw new Error("Regex pattern too complex — avoid nested quantifiers")
            }
            re = new RegExp(node.arg)
            ctx.regexCache.set(node.arg, re)
          }
          return re.test(input.slice(0, 100000))
        }
        default: throw new Error(`Unknown function: ${node.name}`)
      }
    }

    case "literal":
      return node.value

    default: {
      const _exhaustive: never = node
      throw new Error(`Unknown AST node`)
    }
  }
}

// --- Expanded array tracking ---
// expandedArrays: arrays produced by iterate fan-out (pipe needs to fan-out over them)
// objectSourcedArrays: expanded arrays whose origin was object iteration (unwrap at output)

function markExpanded(arr: unknown[], objectSourced: boolean, ctx: EvalCtx): unknown[] {
  ctx.expandedArrays.add(arr)
  if (objectSourced) ctx.objectSourcedArrays.add(arr)
  return arr
}

function isExpandedArray(node: AstNode, val: unknown, ctx: EvalCtx): boolean {
  if (!Array.isArray(val)) return false
  // If left side is an iterate node directly, it's always expanded
  if (node.k === "iterate") return true
  // If left side is a path ending in iterate, check the last step
  if (node.k === "path") {
    const last = node.steps[node.steps.length - 1]
    if (last?.k === "iterate") return true
  }
  // If left side is a pipe that produced an expanded array
  if (node.k === "pipe") return ctx.expandedArrays.has(val as object)
  // Check WeakSet
  return ctx.expandedArrays.has(val as object)
}

// --- Public API ---

export function jsonResultToList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((v) => typeof v === "string" ? v : JSON.stringify(v))
  }
  if (value !== null && value !== undefined) {
    return [typeof value === "string" ? value : JSON.stringify(value)]
  }
  return []
}

export function evaluateJsonExpression(input: unknown, expression: string): JsonEvalResult {
  try {
    const tokens = tokenize(expression)
    const ast = new Parser(tokens).parse()
    const ctx: EvalCtx = {
      expandedArrays: new WeakSet(),
      objectSourcedArrays: new WeakSet(),
      regexCache: new Map(),
    }
    const raw = evalNode(ast, input, ctx)

    // If result is an expanded array (from iterate fan-out):
    if (Array.isArray(raw) && isExpandedArray(ast, raw, ctx)) {
      // Object-sourced: spec says treat as single-element sequence — unwrap (0 items → null, 1 → item)
      // Array-sourced: always return as array (jq model)
      const isObjSourced = ctx.objectSourcedArrays.has(raw as object)
      if (isObjSourced) {
        if (raw.length === 0) return { ok: true, value: null }
        if (raw.length === 1) return { ok: true, value: raw[0] }
      }
      if (raw.length === 0) return { ok: true, value: [] }
      return { ok: true, value: raw }
    }
    // Non-expanded: return as-is
    return { ok: true, value: raw === DROPPED ? [] : raw }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, error: msg }
  }
}
