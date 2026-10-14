// tools/__tests__/test-select-changes.test.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import { parseNameStatus, parsePrFilesJson, fetchPrChanges, mergeChanges } from "../test-select/changes.mjs"

test("git name-status lines become changes", () => {
  assert.deepEqual(parseNameStatus("M\tfrontend/a.ts\nA\tbackend/b.ts\nD\tc.ts\nT\td.ts\n"), [
    { status: "M", path: "frontend/a.ts" },
    { status: "A", path: "backend/b.ts" },
    { status: "D", path: "c.ts" },
    { status: "M", path: "d.ts" },
  ])
})

test("PR files (GitHub API JSON): a rename is a removal of the old path plus an add", () => {
  assert.deepEqual(parsePrFilesJson([
    { status: "modified", filename: "frontend/a.ts" },
    { status: "removed", filename: "frontend/old.ts" },
    { status: "renamed", filename: "frontend/new.ts", previous_filename: "frontend/was.ts" },
    { status: "added", filename: "x.ts" },
    { status: "copied", filename: "y.ts" },
    { status: "changed", filename: "z.ts" },
    { status: "unchanged", filename: "w.ts" },
  ]), [
    { status: "M", path: "frontend/a.ts" },
    { status: "D", path: "frontend/old.ts" },
    { status: "D", path: "frontend/was.ts" },
    { status: "A", path: "frontend/new.ts" },
    { status: "A", path: "x.ts" },
    { status: "A", path: "y.ts" },
    { status: "M", path: "z.ts" },
    { status: "M", path: "w.ts" },
  ])
})

const page = (n, from = 0) => Array.from({ length: n }, (_, i) => ({ status: "modified", filename: `f${from + i}.ts` }))
const fakeFetch = (pages, calls, status = 200) => async (url, init) => {
  calls.push({ url, init })
  const n = Number(new URL(url).searchParams.get("page"))
  return { ok: status === 200, status, statusText: "X", json: async () => pages[n - 1] ?? [] }
}

test("PR files are fetched page by page until a page is short, with the token", async () => {
  const calls = []
  const changes = await fetchPrChanges({ repo: "o/r", pr: "7", token: "t0k", fetchImpl: fakeFetch([page(100), page(5, 100)], calls) })
  assert.equal(changes.length, 105)
  assert.equal(calls.length, 2)
  assert.equal(calls[0].url, "https://api.github.com/repos/o/r/pulls/7/files?per_page=100&page=1")
  assert.equal(calls[1].url, "https://api.github.com/repos/o/r/pulls/7/files?per_page=100&page=2")
  const h = calls[0].init.headers
  assert.equal(h.Authorization, "Bearer t0k")
  assert.equal(h.Accept, "application/vnd.github+json")
  assert.equal(h["X-GitHub-Api-Version"], "2022-11-28")
  assert.ok(h["User-Agent"])
  assert.ok(calls[0].init.signal, "a hung request is aborted")
})

test("PR files: an exact multiple of 100 stops at the empty page; the API's 3000-file cap ends the loop", async () => {
  const calls = []
  assert.equal((await fetchPrChanges({ repo: "o/r", pr: "7", token: "t", fetchImpl: fakeFetch([page(100)], calls) })).length, 100)
  assert.equal(calls.length, 2)
  const many = []
  const all = await fetchPrChanges({ repo: "o/r", pr: "7", token: "t", fetchImpl: fakeFetch(Array.from({ length: 40 }, (_, i) => page(100, i * 100)), many) })
  assert.ok(many.length <= 31)
  assert.ok(all.length >= 3000)
})

test("PR files: an HTTP error, a non-array body or a missing repo/token throws (the engine then runs everything)", async () => {
  await assert.rejects(fetchPrChanges({ repo: "o/r", pr: "7", token: "t", fetchImpl: fakeFetch([], [], 502) }), /HTTP 502/)
  const notArray = async () => ({ ok: true, status: 200, json: async () => ({ message: "Not Found" }) })
  await assert.rejects(fetchPrChanges({ repo: "o/r", pr: "7", token: "t", fetchImpl: notArray }), /not a list/)
  await assert.rejects(fetchPrChanges({ repo: "", pr: "7", token: "t", fetchImpl: fakeFetch([], []) }), /--repo/)
  await assert.rejects(fetchPrChanges({ repo: "o/r", pr: "7", token: "", fetchImpl: fakeFetch([], []) }), /GH_TOKEN/)
})

test("merge: one entry per path; conflicting statuses become a modification, a later delete wins", () => {
  assert.deepEqual(mergeChanges([
    { status: "A", path: "a" }, { status: "M", path: "a" },
    { status: "D", path: "b" }, { status: "A", path: "b" },
    { status: "D", path: "c" },
    { status: "M", path: "d" }, { status: "D", path: "d" },
    { status: "A", path: "e" }, { status: "D", path: "e" },
  ]), [
    { status: "M", path: "a" }, { status: "M", path: "b" }, { status: "D", path: "c" },
    { status: "D", path: "d" }, { status: "D", path: "e" },
  ])
  // a committed modification then a working-tree delete: the module is gone now
  assert.deepEqual(mergeChanges([{ status: "M", path: "a" }, { status: "D", path: "a" }]), [{ status: "D", path: "a" }])
})
