// tools/test-select/mocks.mjs
// Mock-aware edges (§5.8 A4, decided 2026-10-15): a test that replaces a module
// with `vi.mock("<module>", factory)` never loads the real module, so the
// module (and whatever is reachable only through it) is not one of the test's
// inputs. This finds those specifiers in a test's own source. Pure; built-ins
// only. Every form it cannot read with certainty keeps the edge (today's rule):
// an automock or a `__mocks__` file (one argument), `{ spy: true }`, a factory
// that is not an inline function, a factory that reaches the real module
// (`importOriginal`, `vi.importActual`, `vi.importMock`, `requireActual`,
// `import(` of anything), `vi.doMock` (not hoisted — the real module may load
// first), and a specifier the test also un-mocks.

const CALL = /\bvi\s*\.\s*mock\s*\(/g
const REACHES_REAL = /\b(?:importOriginal|importActual|importMock|requireActual)\b|\bimport\s*\(|\brequire\s*\(/

// The text of the call's arguments, from just after "(" to its matching ")",
// skipping strings, template literals and comments. null when unbalanced.
function callArguments(source, start) {
  let depth = 1
  for (let i = start; i < source.length; i++) {
    const ch = source[i]
    if (ch === "/" && source[i + 1] === "/") { i = source.indexOf("\n", i); if (i < 0) return null; continue }
    if (ch === "/" && source[i + 1] === "*") { i = source.indexOf("*/", i + 2); if (i < 0) return null; i++; continue }
    if (ch === '"' || ch === "'" || ch === "`") {
      for (i++; i < source.length && source[i] !== ch; i++) if (source[i] === "\\") i++
      continue
    }
    if (ch === "(" || ch === "[" || ch === "{") depth++
    else if (ch === ")" || ch === "]" || ch === "}") {
      depth--
      if (depth === 0) return source.slice(start, i)
    }
  }
  return null
}

// Split the top-level arguments on commas.
function topLevelArgs(text) {
  const args = []
  let depth = 0
  let from = 0
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === '"' || ch === "'" || ch === "`") {
      for (i++; i < text.length && text[i] !== ch; i++) if (text[i] === "\\") i++
      continue
    }
    if (ch === "(" || ch === "[" || ch === "{") depth++
    else if (ch === ")" || ch === "]" || ch === "}") depth--
    else if (ch === "," && depth === 0) { args.push(text.slice(from, i).trim()); from = i + 1 }
  }
  const last = text.slice(from).trim()
  if (last) args.push(last)
  return args
}

const LITERAL = /^(["'])([^"'`$\\]+)\1$|^`([^`$\\]+)`$/
const INLINE_FUNCTION = /^(?:async\s+)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>|^(?:async\s+)?function\b/

// The specifiers a test's own source replaces wholesale with a factory mock.
export function factoryMockedSpecifiers(source) {
  const out = new Set()
  const unsafe = new Set()
  for (const m of source.matchAll(CALL)) {
    const text = callArguments(source, m.index + m[0].length)
    if (text === null) continue
    const [first, factory, ...rest] = topLevelArgs(text)
    const lit = first?.match(LITERAL)
    if (!lit) continue
    const spec = lit[2] ?? lit[3]
    if (!factory || rest.length > 0 || !INLINE_FUNCTION.test(factory) || REACHES_REAL.test(factory)) { unsafe.add(spec); continue }
    out.add(spec)
  }
  // un-mocked, or mocked again some other way, anywhere in the file: keep the edge
  for (const m of source.matchAll(/\bvi\s*\.\s*(?:doMock|unmock|doUnmock)\s*\(\s*(["'`])([^"'`]+)\1/g)) unsafe.add(m[2])
  for (const spec of unsafe) out.delete(spec)
  return [...out].sort()
}
