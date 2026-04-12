/**
 * Edge range utilities for resolving 1-based index expressions
 * and applying range/step slicing to output lists.
 *
 * Used by both frontend DAG executor and backend orchestrator
 * to support edge-level range, step, and item selection.
 */

/**
 * Resolves a 1-based index expression to a 0-based array index.
 *
 * Supported expressions:
 * - "1", "2", ... — absolute 1-based index
 * - "last" — last element
 * - "last-1", "last-2", ... — relative from end
 *
 * Out-of-bounds values are clamped. Malformed input falls back to `defaultExpr`.
 */
export function resolveIndex(
  expr: string,
  listLength: number,
  defaultExpr: string = "1",
): number {
  if (listLength <= 0) return 0

  const trimmed = expr.trim()
  let index: number

  if (trimmed === "last") {
    index = listLength - 1
  } else if (trimmed.startsWith("last-")) {
    const offset = parseInt(trimmed.slice(5), 10)
    if (isNaN(offset) || offset < 0) return resolveIndex(defaultExpr === expr ? "1" : defaultExpr, listLength)
    index = listLength - 1 - offset
  } else {
    const n = parseInt(trimmed, 10)
    if (isNaN(n)) return resolveIndex(defaultExpr === expr ? "1" : defaultExpr, listLength)
    index = n - 1
  }

  return Math.max(0, Math.min(index, listLength - 1))
}

/**
 * Applies range and step slicing to a list of strings.
 *
 * `from` and `to` are 1-based index expressions (see `resolveIndex`).
 * `step` controls iteration direction and stride:
 * - positive step: forward iteration (from must be <= to)
 * - negative step: reverse iteration (from must be >= to)
 * - step 0 is treated as step 1
 *
 * Returns empty array if direction mismatches (e.g., from < to with negative step).
 */
export function applyRange(
  list: string[],
  from?: string,
  to?: string,
  step?: number,
): string[] {
  if (list.length === 0) return []

  const fromIdx = resolveIndex(from ?? "1", list.length, "1")
  const toIdx = resolveIndex(to ?? "last", list.length, "last")
  const effectiveStep = step === 0 || step === undefined ? 1 : step

  if (effectiveStep > 0 && fromIdx > toIdx) return []
  if (effectiveStep < 0 && fromIdx < toIdx) return []

  const result: string[] = []
  if (effectiveStep > 0) {
    for (let i = fromIdx; i <= toIdx; i += effectiveStep) result.push(list[i])
  } else {
    for (let i = fromIdx; i >= toIdx; i += effectiveStep) result.push(list[i])
  }
  return result
}

/**
 * Migrates legacy `item:N` (0-based) outputMode to structured format.
 *
 * Legacy: `{ outputMode: "item:0" }` — 0-based index baked into mode string
 * New:    `{ outputMode: "item", itemIndex: "1" }` — 1-based expression
 *
 * Returns the data unchanged if not a legacy item mode.
 */
export function migrateEdgeOutputMode(
  data: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!data) return data

  const mode = data.outputMode as string | undefined
  if (!mode || !mode.startsWith("item:")) return data

  const idx = parseInt(mode.split(":")[1], 10)
  return {
    ...data,
    outputMode: "item",
    itemIndex: String(isNaN(idx) ? 1 : idx + 1),
  }
}

/**
 * Builds a human-readable label for edge range configuration.
 *
 * Returns `undefined` when the configuration matches defaults (no label needed).
 *
 * Examples:
 * - "2..last-1"     — range from 2 to last-1
 * - "2..last-1 +2"  — with step 2
 * - "last..1 -1"    — reversed
 * - "3"             — item mode, index 3
 */
export function buildRangeLabel(
  mode: string,
  rangeFrom?: string,
  rangeTo?: string,
  rangeStep?: number,
  itemIndex?: string,
  selectorMode?: "range" | "list",
  listExpression?: string,
): string | undefined {
  if (mode === "last") return undefined

  if ((mode === "each" || mode === "all") && selectorMode === "list") {
    const trimmed = (listExpression ?? "").trim()
    if (trimmed === "") return undefined
    return truncateLabel(trimmed, 18)
  }

  if (mode === "item") return itemIndex || undefined

  const from = rangeFrom ?? "1"
  const to = rangeTo ?? "last"
  const step = rangeStep ?? 1
  const isDefaultRange = from === "1" && to === "last"
  const isDefaultStep = step === 1
  if (isDefaultRange && isDefaultStep) return undefined

  let label = `${from}..${to}`
  if (mode === "each" && !isDefaultStep) {
    label += step > 0 ? ` +${step}` : ` ${step}`
  }
  return label
}

function truncateLabel(s: string, maxLen: number): string {
  if (s.length <= maxLen) return s
  return s.slice(0, maxLen) + "…"
}

/**
 * Validates a list expression without resolving indices.
 * Used for live UI validation in the List tab input.
 *
 * Returns { ok: true } for empty/whitespace input — matches the
 * "empty = all items" runtime semantics.
 */
export function parseListExpression(
  expr: string,
): { ok: true } | { ok: false; error: string } {
  const trimmed = expr.trim()
  if (trimmed === "") return { ok: true }

  const terms = trimmed.split(",")
  for (const rawTerm of terms) {
    const term = rawTerm.trim()
    if (term === "") return { ok: false, error: "Empty item between commas" }

    const rangeIdx = term.indexOf("..")
    if (rangeIdx !== -1) {
      const left = term.slice(0, rangeIdx).trim()
      const rightWithStep = term.slice(rangeIdx + 2).trim()

      if (left === "" || rightWithStep === "") {
        return { ok: false, error: `Range missing endpoint: ${term}` }
      }

      const colonIdx = rightWithStep.indexOf(":")
      const right = colonIdx === -1 ? rightWithStep : rightWithStep.slice(0, colonIdx).trim()
      const stepStr = colonIdx === -1 ? null : rightWithStep.slice(colonIdx + 1).trim()

      if (right === "") {
        return { ok: false, error: `Range missing endpoint: ${term}` }
      }

      if (!isValidIndexToken(left)) return { ok: false, error: `Invalid index: ${left}` }
      if (!isValidIndexToken(right)) return { ok: false, error: `Invalid index: ${right}` }

      if (stepStr !== null) {
        if (!/^-?\d+$/.test(stepStr)) {
          return { ok: false, error: "Step must be an integer" }
        }
      }
      continue
    }

    if (!isValidIndexToken(term)) {
      return { ok: false, error: `Invalid index: ${term}` }
    }
  }
  return { ok: true }
}

/** Internal: validates a single index token ("1", "last", "last-3"). */
function isValidIndexToken(token: string): boolean {
  if (token === "last") return true
  if (/^[1-9]\d*$/.test(token)) return true
  const m = /^last-(\d+)$/.exec(token)
  if (m) return !isNaN(parseInt(m[1], 10))
  return false
}

/**
 * Parses a list expression and returns 0-based indices into the list,
 * in user-specified order. Preserves duplicates.
 *
 * Supported syntax:
 *   <expr>  := <term> ("," <term>)*
 *   <term>  := <index> | <index> ".." <index> (":" <step>)?
 *   <index> := <number> | "last" | "last-" <number>
 *   <step>  := integer (0 coerced to 1)
 *
 * Clamps out-of-bounds indices. Malformed input logs a warning and
 * returns [0..listLength-1] (matches applyRange leniency).
 */
export function resolveListExpression(expr: string, listLength: number): number[] {
  if (listLength <= 0) return []
  const trimmed = expr.trim()
  if (trimmed === "") return indexRange(0, listLength - 1, 1)

  const result: number[] = []
  const terms = trimmed.split(",")
  for (const rawTerm of terms) {
    const term = rawTerm.trim()
    if (term === "") {
      console.warn("[edge-range] empty token in list expression:", expr)
      return indexRange(0, listLength - 1, 1)
    }

    const rangeIdx = term.indexOf("..")
    if (rangeIdx === -1) {
      if (!isValidIndexToken(term)) {
        console.warn("[edge-range] invalid index token:", term)
        return indexRange(0, listLength - 1, 1)
      }
      result.push(resolveIndex(term, listLength))
      continue
    }

    const left = term.slice(0, rangeIdx).trim()
    const rightWithStep = term.slice(rangeIdx + 2).trim()
    const colonIdx = rightWithStep.indexOf(":")
    const right = colonIdx === -1 ? rightWithStep : rightWithStep.slice(0, colonIdx).trim()
    const stepStr = colonIdx === -1 ? null : rightWithStep.slice(colonIdx + 1).trim()

    if (left === "" || right === "") {
      console.warn("[edge-range] range missing endpoint:", term)
      return indexRange(0, listLength - 1, 1)
    }
    if (!isValidIndexToken(left) || !isValidIndexToken(right)) {
      console.warn("[edge-range] invalid range endpoint:", term)
      return indexRange(0, listLength - 1, 1)
    }

    let step = 1
    if (stepStr !== null) {
      if (!/^-?\d+$/.test(stepStr)) {
        console.warn("[edge-range] non-integer step:", stepStr)
        return indexRange(0, listLength - 1, 1)
      }
      const parsed = parseInt(stepStr, 10)
      step = parsed === 0 ? 1 : parsed
    }

    const from = resolveIndex(left, listLength)
    const to = resolveIndex(right, listLength)
    for (const idx of indexRange(from, to, step)) result.push(idx)
  }
  return result
}

/** Internal: inclusive index range with step. Returns [] if direction mismatches. */
function indexRange(from: number, to: number, step: number): number[] {
  const out: number[] = []
  if (step > 0) {
    if (from > to) return []
    for (let i = from; i <= to; i += step) out.push(i)
  } else {
    if (from < to) return []
    for (let i = from; i >= to; i += step) out.push(i)
  }
  return out
}

/**
 * Dispatches to either applyRange() or resolveListExpression() based on
 * edgeData.selectorMode. Returns a new string[] containing the selected
 * subset of items.
 *
 * NOTE: this is a drop-in replacement for applyRange only for `each`-mode
 * callsites. Callers in `all` mode must scrub `rangeStep` from edgeData
 * before calling (construct `effectiveEdgeData` per the resolver
 * integration notes) to preserve the pre-existing "step ignored in all"
 * behavior.
 */
export function selectListItems(
  items: string[],
  edgeData:
    | {
        selectorMode?: "range" | "list"
        listExpression?: string
        rangeFrom?: string
        rangeTo?: string
        rangeStep?: number
        useAllResults?: boolean
      }
    | undefined,
): string[] {
  if (items.length === 0) return []
  if (edgeData?.selectorMode === "list") {
    const indices = resolveListExpression(edgeData.listExpression ?? "", items.length)
    return indices.map((i) => items[i])
  }
  return applyRange(items, edgeData?.rangeFrom, edgeData?.rangeTo, edgeData?.rangeStep)
}

export function describeEdgeBehavior(
  edgeData:
    | {
        outputMode?: string
        selectorMode?: "range" | "list"
        listExpression?: string
        rangeFrom?: string
        rangeTo?: string
        rangeStep?: number
        itemIndex?: string
        useAllResults?: boolean
      }
    | undefined,
): string {
  const mode = edgeData?.outputMode
  const sentence = buildBaseSentence(edgeData, mode)
  return applyUseAllResultsSuffix(sentence, edgeData, mode)
}

function buildBaseSentence(
  edgeData: Parameters<typeof describeEdgeBehavior>[0],
  mode: string | undefined,
): string {
  if (mode === "last") return "Passes only the most recent result."
  if (mode === "item") return buildItemSentence(edgeData)
  if (mode === "each") return buildEachSentence(edgeData)
  if (mode === "all") return buildAllSentence(edgeData)
  return "Passes all items together as a list."
}

function buildItemSentence(
  edgeData: Parameters<typeof describeEdgeBehavior>[0],
): string {
  const canonical = canonicalItemIndex(edgeData?.itemIndex)
  return `Passes only ${itemModeForm(canonical)}.`
}

function buildEachSentence(
  edgeData: Parameters<typeof describeEdgeBehavior>[0],
): string {
  if (isDefaultConfig(edgeData)) return "Runs the downstream node once per item."
  if (edgeData?.selectorMode === "list") {
    const terms = parseListTerms((edgeData.listExpression ?? "").trim())
    if (terms === null) return "Runs the downstream node once per item."
  }
  const phrase = buildSelectionPhrase(edgeData)
  if (phrase.kind === "empty-result") {
    return "Selects no items — downstream node will not run."
  }
  if (phrase.kind === "single-index") {
    return `Runs the downstream node only on ${phrase.itemModeForm}.`
  }
  return `Fans out over ${phrase.text}.`
}

function buildAllSentence(
  edgeData: Parameters<typeof describeEdgeBehavior>[0],
): string {
  if (isDefaultConfig(edgeData)) return "Passes all items together as a list."
  if (edgeData?.selectorMode === "list") {
    const terms = parseListTerms((edgeData.listExpression ?? "").trim())
    if (terms === null) return "Passes all items together as a list."
  }
  const phrase = buildSelectionPhrase(edgeData)
  if (phrase.kind === "empty-result") {
    return "Selects no items — downstream node will receive an empty list."
  }
  if (phrase.kind === "single-index") {
    return `Passes only ${phrase.itemModeForm} as a list.`
  }
  return `Passes ${phrase.text} as a list.`
}

function applyUseAllResultsSuffix(
  sentence: string,
  edgeData: Parameters<typeof describeEdgeBehavior>[0],
  mode: string | undefined,
): string {
  if (!edgeData?.useAllResults) return sentence
  if (mode === "last") return sentence
  if (!sentence.endsWith(".")) return sentence
  return sentence.slice(0, -1) + " (across all accumulated results)."
}

type CanonicalRange = { from: string; to: string; step: number }

function canonicalItemIndex(raw: string | undefined): string {
  const trimmed = (raw ?? "").trim()
  if (trimmed === "") return "1"
  if (!isValidIndexToken(trimmed)) return "1"
  return trimmed
}

function canonicalRange(
  edgeData: Parameters<typeof describeEdgeBehavior>[0],
): CanonicalRange {
  const from = ((edgeData?.rangeFrom ?? "").trim() || "1")
  const to = ((edgeData?.rangeTo ?? "").trim() || "last")
  const rawStep = edgeData?.rangeStep
  const step = rawStep === undefined || rawStep === 0 ? 1 : rawStep
  return { from, to, step }
}

function isDefaultConfig(
  edgeData: Parameters<typeof describeEdgeBehavior>[0],
): boolean {
  if (edgeData?.selectorMode === "list") {
    return ((edgeData.listExpression ?? "").trim()) === ""
  }
  const { from, to, step } = canonicalRange(edgeData)
  return from === "1" && to === "last" && step === 1
}

function itemModeForm(canonical: string): string {
  if (canonical === "1") return "the first item"
  if (/^\d+$/.test(canonical)) return `item ${canonical}`
  if (canonical === "last" || canonical === "last-0") return "the last item"
  const m = /^last-(\d+)$/.exec(canonical)
  if (m) {
    const n = parseInt(m[1], 10)
    if (n === 1) return "the second-to-last item"
    if (n === 2) return "the third-to-last item"
    if (n === 3) return "the fourth-to-last item"
    return `the ${ordinal(n + 1)}-from-last item`
  }
  return "the first item"
}

function compactForm(canonical: string): string {
  if (/^\d+$/.test(canonical)) return canonical
  if (canonical === "last" || canonical === "last-0") return "the last one"
  const m = /^last-(\d+)$/.exec(canonical)
  if (m) {
    const n = parseInt(m[1], 10)
    if (n === 1) return "the second-to-last"
    if (n === 2) return "the third-to-last"
    if (n === 3) return "the fourth-to-last"
    return `the ${ordinal(n + 1)}-from-last`
  }
  return canonical
}

function ordinal(n: number): string {
  const absN = Math.abs(n)
  const lastTwo = absN % 100
  if (lastTwo >= 11 && lastTwo <= 13) return `${n}th`
  switch (absN % 10) {
    case 1: return `${n}st`
    case 2: return `${n}nd`
    case 3: return `${n}rd`
    default: return `${n}th`
  }
}

type SelectionPhrase =
  | { kind: "items"; text: string }
  | { kind: "single-index"; itemModeForm: string }
  | { kind: "empty-result" }

function buildSelectionPhrase(
  edgeData: Parameters<typeof describeEdgeBehavior>[0],
): SelectionPhrase {
  if (edgeData?.selectorMode === "list") {
    return buildListSelectionPhrase((edgeData.listExpression ?? "").trim())
  }
  return buildRangeSelectionPhrase(canonicalRange(edgeData))
}

function indexKind(token: string): "concrete" | "relative" | "invalid" {
  if (/^[1-9]\d*$/.test(token)) return "concrete"
  if (token === "last" || /^last-\d+$/.test(token)) return "relative"
  return "invalid"
}

function relativeOffset(token: string): number {
  if (token === "last") return 0
  const m = /^last-(\d+)$/.exec(token)
  return m ? parseInt(m[1], 10) : 0
}

function compareTokens(a: string, b: string): -1 | 0 | 1 | "indeterminate" {
  const ka = indexKind(a)
  const kb = indexKind(b)
  if (ka !== kb) return "indeterminate"
  if (ka === "concrete") {
    const na = parseInt(a, 10)
    const nb = parseInt(b, 10)
    return na < nb ? -1 : na > nb ? 1 : 0
  }
  if (ka === "relative") {
    const oa = relativeOffset(a)
    const ob = relativeOffset(b)
    return oa < ob ? 1 : oa > ob ? -1 : 0
  }
  return "indeterminate"
}

function buildRangeSelectionPhrase(r: CanonicalRange): SelectionPhrase {
  const { from, to, step } = r

  const cmp = compareTokens(from, to)
  if (cmp !== "indeterminate") {
    if (step > 0 && cmp === 1) return { kind: "empty-result" }
    if (step < 0 && cmp === -1) return { kind: "empty-result" }
  }

  if (cmp === 0) {
    return { kind: "single-index", itemModeForm: itemModeForm(from) }
  }

  const absStep = Math.abs(step)
  if (step === -1 && from === "last" && to === "1") {
    return { kind: "items", text: "all items in reverse order" }
  }

  let text = `items ${compactForm(from)} through ${compactForm(to)}`
  if (absStep === 1 && step < 0) {
    text += " in reverse order"
  } else if (absStep > 1 && step > 0) {
    text += ` (every ${ordinal(absStep)} item)`
  } else if (absStep > 1 && step < 0) {
    text += ` (every ${ordinal(absStep)} item, in reverse)`
  }
  return { kind: "items", text }
}

type ListTerm =
  | { kind: "index"; token: string }
  | { kind: "range"; from: string; to: string; step: number }

function parseListTerms(expr: string): ListTerm[] | null {
  if (expr === "") return []
  const terms: ListTerm[] = []
  const raw = expr.split(",")
  for (const rawTerm of raw) {
    const term = rawTerm.trim()
    if (term === "") return null
    const rangeIdx = term.indexOf("..")
    if (rangeIdx === -1) {
      if (!isValidIndexToken(term)) return null
      terms.push({ kind: "index", token: term })
      continue
    }
    const left = term.slice(0, rangeIdx).trim()
    const rightWithStep = term.slice(rangeIdx + 2).trim()
    const colonIdx = rightWithStep.indexOf(":")
    const right = colonIdx === -1 ? rightWithStep : rightWithStep.slice(0, colonIdx).trim()
    const stepStr = colonIdx === -1 ? null : rightWithStep.slice(colonIdx + 1).trim()
    if (left === "" || right === "") return null
    if (!isValidIndexToken(left) || !isValidIndexToken(right)) return null
    let step = 1
    if (stepStr !== null) {
      if (!/^-?\d+$/.test(stepStr)) return null
      const parsed = parseInt(stepStr, 10)
      step = parsed === 0 ? 1 : parsed
    }
    terms.push({ kind: "range", from: left, to: right, step })
  }
  return terms
}

function buildListSelectionPhrase(expr: string): SelectionPhrase {
  const terms = parseListTerms(expr)
  if (terms === null) return { kind: "empty-result" }
  if (terms.length === 0) return { kind: "items", text: "items" } // unreachable via callers; default-config catches empty

  const normalized = terms.map<ListTerm>((t) => {
    if (t.kind === "range") {
      const cmp = compareTokens(t.from, t.to)
      if (cmp === 0) return { kind: "index", token: t.from }
    }
    return t
  })

  if (normalized.length === 1 && normalized[0].kind === "index") {
    return { kind: "single-index", itemModeForm: itemModeForm(normalized[0].token) }
  }

  const rendered = normalized.map((t) => {
    if (t.kind === "index") return compactForm(t.token)
    let text = `${compactForm(t.from)} through ${compactForm(t.to)}`
    const absStep = Math.abs(t.step)
    if (absStep === 1 && t.step < 0) {
      if (t.from === "last" && t.to === "1") return "all items in reverse"
      text += " in reverse"
    } else if (absStep > 1 && t.step > 0) {
      text += ` (every ${ordinal(absStep)})`
    } else if (absStep > 1 && t.step < 0) {
      text += ` (every ${ordinal(absStep)}, in reverse)`
    }
    return text
  })

  let joined: string
  if (rendered.length === 1) {
    joined = rendered[0]
  } else if (rendered.length === 2) {
    joined = `${rendered[0]} and ${rendered[1]}`
  } else {
    const head = rendered.slice(0, -1).join(", ")
    joined = `${head}, and ${rendered[rendered.length - 1]}`
  }
  return { kind: "items", text: `items ${joined}` }
}
