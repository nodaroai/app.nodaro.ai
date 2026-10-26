// tools/test-select/source-memo.mjs
// One analysis per distinct source text. The graph (graph.mjs) summarizes
// every test file against every module it loads, and the tests share their
// modules: ~2.7k distinct sources stand behind ~250k (test, module) pairs in
// frontend/ alone. The parsers here are pure functions of the text, so each
// source is parsed once and every later test reads the result — the same
// answer, without parsing the same module again for each test that loads it.
//
// A cached value is shared by every caller, so an object or array result is
// frozen: a caller that tried to change it would throw instead of silently
// changing another test's summary. The cache is bounded: past MAX_ENTRIES
// distinct sources it starts over (a long-lived process — the self-tests —
// never grows without end).
export const MAX_ENTRIES = 20_000

// Per memo: how often it was asked and how often it computed. The complexity
// guard in tools/__tests__/test-select-source-memo.test.mjs reads these.
export const memoCounters = new Map()

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const v of Object.values(value)) deepFreeze(v)
  }
  return value
}

// `fn(source)` → its value, computed once per distinct `source` string.
// `freeze: false` for a value only this module's own code sees (a Set, which
// Object.freeze cannot make read-only).
export function memoBySource(name, fn, { freeze = true } = {}) {
  const cache = new Map()
  const counter = { calls: 0, misses: 0 }
  memoCounters.set(name, counter)
  return (source) => {
    counter.calls++
    if (cache.has(source)) return cache.get(source)
    counter.misses++
    if (cache.size >= MAX_ENTRIES) cache.clear()
    const value = fn(source)
    cache.set(source, freeze ? deepFreeze(value) : value)
    return value
  }
}
