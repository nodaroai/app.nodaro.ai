// @test-reads-for-caller reads only the source files the guard passes it
/**
 * One read and one parse of each source file per guard, however many of the
 * guard's tests ask about it — for the structural guards that walk the
 * `frontend/src` tree with the TypeScript parser.
 *
 * Measured 2026-10-14: `paid-run-mark-guard` parsed every one of the
 * ~2,000 source files three times (one full scan per test), and
 * `no-hardcoded-copy` parsed its ~1,300 files twice (once per test) — 31–35 s
 * and 16–17 s of a CI shard. A full parse of the tree takes ~8 s on a loaded
 * machine, so the repeats were most of their time.
 *
 * What is cached is the guard's DERIVED, plain result per file (its hits, the
 * calls it found), never the `ts.SourceFile`: holding the whole tree's ASTs
 * with parent pointers measured ~460 MB, against a few MB for what the guards
 * read back. A guard that needs a second answer from a file computes it in the
 * same `derive` pass instead of parsing again.
 *
 * An entry is keyed by the file's path and its mtime + size, and by a
 * `guardKey`: the guard's own file and ITS stamp (so an edit to the guard's
 * rules drops what it cached) plus anything else the result depends on (the
 * set of names it looks for). A stale result is never served.
 *
 * The cache lives on `globalThis`, so it lasts as long as the worker. Under
 * Vitest's default isolation each test file runs in a worker of its own
 * (probed: three files, three pids), so the saving is within one guard file;
 * a project run with `isolate: false` also shares it between runs of a guard
 * in that worker.
 */
import fs from "node:fs"

interface Entry {
  readonly stamp: string
  readonly value: unknown
}

const CACHE = Symbol.for("nodaro.test.source-index")

function cache(): Map<string, Entry> {
  const holder = globalThis as { [CACHE]?: Map<string, Entry> }
  return (holder[CACHE] ??= new Map())
}

function stampOf(file: string): string {
  const stat = fs.statSync(file)
  return `${stat.mtimeMs}:${stat.size}`
}

/**
 * The key a guard caches under: its own file at its current stamp, and every
 * other input its per-file result depends on besides the file's text.
 */
export function guardKey(guardFile: string, ...dependsOn: readonly string[]): string {
  return [guardFile, stampOf(guardFile), ...dependsOn].join("\0")
}

/**
 * `derive(text)` for `file`, computed once per (key, file, file stamp) in this
 * worker. `derive` must depend on nothing but the file's text and what `key`
 * names, and its result must be plain data that no caller mutates.
 */
export function perSourceFile<T>(key: string, file: string, derive: (text: string) => T): T {
  const stamp = stampOf(file)
  const id = `${key}\0${file}`
  const hit = cache().get(id)
  if (hit && hit.stamp === stamp) return hit.value as T
  const value = derive(fs.readFileSync(file, "utf8"))
  cache().set(id, { stamp, value })
  return value
}
