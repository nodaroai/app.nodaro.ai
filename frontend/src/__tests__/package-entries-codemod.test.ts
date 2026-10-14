import { describe, expect, it } from "vitest"
import { loadEntryMaps, transformFile } from "../../../tools/package-entries/codemod.mjs"

/**
 * The import codemod (`tools/package-entries/codemod.mjs`) is meant to be
 * re-run — after the entries change, or on a branch that conflicted with the
 * subpath move — so its rewrites are pinned here on scratch sources against
 * the REAL entry map. The two mock hazards matter most: a split that compiles
 * but mocks the wrong entry silently runs a test against the real module.
 */
const maps = loadEntryMaps() as Record<"@nodaro/shared" | "@nodaro/prompts", { entries: string[] }>
const run = (src: string, file = "fixture.ts") => transformFile(file, src, maps) as {
  text: string
  changed: boolean
  notes: Array<{ kind: string; line: number; detail: string }>
}
const SHARED_ENTRIES = maps["@nodaro/shared"].entries

describe("package-entries codemod", () => {
  it("splits a named import per entry; a group of only `type` names becomes `import type`", () => {
    expect(run(`import { renderNodeOf, type SpeakerViewPriceTier } from "@nodaro/shared"\n`).text).toBe(
      `import { renderNodeOf } from "@nodaro/shared/nodes"\nimport type { SpeakerViewPriceTier } from "@nodaro/shared/credits"\n`,
    )
  })

  it("keeps aliases and only rewrites the specifier when one entry owns every name", () => {
    expect(run(`import { MODEL_CATALOG as MC, LLM_MODELS } from "@nodaro/shared";\n`).text).toBe(
      `import { MODEL_CATALOG as MC } from "@nodaro/shared/model-catalog";\nimport { LLM_MODELS } from "@nodaro/shared/llm-models";\n`,
    )
    expect(run(`import { MODEL_CATALOG as MC, type ModelCatalogEntry } from '@nodaro/shared'\n`).text).toBe(
      `import { MODEL_CATALOG as MC, type ModelCatalogEntry } from '@nodaro/shared/model-catalog'\n`,
    )
  })

  it("splits export-from re-exports", () => {
    expect(run(`export { MODEL_CATALOG, type GenericNode } from "@nodaro/shared"\n`).text).toBe(
      `export { MODEL_CATALOG } from "@nodaro/shared/model-catalog"\nexport type { GenericNode } from "@nodaro/shared/types"\n`,
    )
  })

  it("points an import() type query at the entry of its name", () => {
    expect(run(`type T = import("@nodaro/shared").GenericNode[]\n`).text).toBe(`type T = import("@nodaro/shared/types").GenericNode[]\n`)
  })

  it("moves a namespace import only when every use is in one entry", () => {
    expect(run(`import * as S from "@nodaro/shared"\nconst a = S.MODEL_CATALOG\ntype E = S.ModelCatalogEntry\n`).text).toBe(
      `import * as S from "@nodaro/shared/model-catalog"\nconst a = S.MODEL_CATALOG\ntype E = S.ModelCatalogEntry\n`,
    )
    const two = run(`import * as S from "@nodaro/shared"\nconst a = [S.MODEL_CATALOG, S.LLM_MODELS]\n`)
    expect(two.changed).toBe(false)
    expect(two.notes.map((n) => n.kind)).toEqual(["namespace-split"])
    const whole = run(`import * as S from "@nodaro/shared"\nconst all = { ...S }\n`)
    expect(whole.changed).toBe(false)
    expect(whole.notes.map((n) => n.kind)).toEqual(["namespace-whole"])
  })

  it("splits a destructured dynamic import into one await per entry", () => {
    expect(run(`async function f() {\n  const { MODEL_CATALOG, LLM_MODELS: L } = await import("@nodaro/shared")\n}\n`).text).toBe(
      `async function f() {\n  const { MODEL_CATALOG } = await import("@nodaro/shared/model-catalog")\n  const { LLM_MODELS: L } = await import("@nodaro/shared/llm-models")\n}\n`,
    )
  })

  it("splits a partial mock into one partial mock per overriding entry", () => {
    const out = run(
      `vi.mock("@nodaro/shared", async (importOriginal) => ({\n  ...(await importOriginal<typeof import("@nodaro/shared")>()),\n  MODEL_CATALOG: [],\n  LLM_MODELS: [],\n}))\n`,
    ).text
    expect(out).toBe(
      `vi.mock("@nodaro/shared/model-catalog", async (importOriginal) => ({\n  ...(await importOriginal<typeof import("@nodaro/shared/model-catalog")>()),\n  MODEL_CATALOG: [],\n}))\n` +
        `vi.mock("@nodaro/shared/llm-models", async (importOriginal) => ({\n  ...(await importOriginal<typeof import("@nodaro/shared/llm-models")>()),\n  LLM_MODELS: [],\n}))\n`,
    )
  })

  it("REFUSES a mock whose override reads the real module from another entry", () => {
    const src = `vi.mock("@nodaro/shared", async (importOriginal) => {\n  const actual = await importOriginal<typeof import("@nodaro/shared")>()\n  return { ...actual, MODEL_CATALOG: actual.LLM_MODELS }\n})\n`
    const r = run(src)
    expect(r.text).toBe(src)
    expect(r.notes.map((n) => n.kind)).toEqual(["mock-refused"])
    expect(r.notes[0].detail).toContain("LLM_MODELS")
  })

  it("REFUSES a mock whose statements before `return` would run once per entry or read the real module", () => {
    const shared = `vi.mock("@nodaro/shared", async (importOriginal) => {\n  const actual = await importOriginal<typeof import("@nodaro/shared")>()\n  const spy = vi.fn()\n  return { ...actual, MODEL_CATALOG: spy, LLM_MODELS: spy }\n})\n`
    expect(run(shared).text).toBe(shared)
    expect(run(shared).notes.map((n) => n.kind)).toEqual(["mock-refused"])
    const reads = `vi.mock("@nodaro/shared", async (importOriginal) => {\n  const actual = await importOriginal<typeof import("@nodaro/shared")>()\n  const real = actual.MODEL_CATALOG\n  return { ...actual, MODEL_CATALOG: real }\n})\n`
    expect(run(reads).text).toBe(reads)
    expect(run(reads).notes.map((n) => n.kind)).toEqual(["mock-refused"])
    // Its own entry, with nothing before `return` but the original: splits.
    const ok = `vi.mock("@nodaro/shared", async (importOriginal) => {\n  const actual = await importOriginal<typeof import("@nodaro/shared")>()\n  return { ...actual, MODEL_CATALOG: vi.fn(actual.MODEL_CATALOG) }\n})\n`
    expect(run(ok).text).toBe(ok.replaceAll(`"@nodaro/shared"`, `"@nodaro/shared/model-catalog"`))
  })

  it("REFUSES a mock that reads the real module inline or through a destructure", () => {
    const probes = [
      // importOriginal() read inline, in the override itself
      `vi.mock("@nodaro/shared", async (importOriginal) => ({ ...(await importOriginal()), MODEL_CATALOG: (await importOriginal<any>()).LLM_MODELS }))\n`,
      // the same through vi.importActual (whose root literal must not be rewritten either)
      `vi.mock("@nodaro/shared", async (importOriginal) => ({ ...(await importOriginal()), MODEL_CATALOG: (await vi.importActual<any>("@nodaro/shared")).LLM_MODELS }))\n`,
      // a destructure of the real module before return
      `vi.mock("@nodaro/shared", async (importOriginal) => {\n  const { LLM_MODELS } = await importOriginal<any>()\n  return { ...(await importOriginal()), MODEL_CATALOG: LLM_MODELS }\n})\n`,
    ]
    for (const src of probes) {
      const r = run(src)
      expect(r.text).toBe(src)
      expect(r.notes.map((n) => n.kind)).toEqual(["mock-refused"])
    }
    // An inline read of the override's OWN entry still splits.
    const own = `vi.mock("@nodaro/shared", async (importOriginal) => ({ ...(await importOriginal()), MODEL_CATALOG: vi.fn((await importOriginal<any>()).MODEL_CATALOG) }))\n`
    expect(run(own).text).toBe(own.replace(`"@nodaro/shared"`, `"@nodaro/shared/model-catalog"`))
  })

  it("REFUSES a mock that passes its importOriginal on instead of calling it", () => {
    const probes = [
      `vi.mock("@nodaro/shared", async (importOriginal) => ({ ...(await importOriginal()), MODEL_CATALOG: await pick(importOriginal, "LLM_MODELS") }))\n`,
      `vi.mock("@nodaro/shared", async (importOriginal) => {\n  const io = importOriginal\n  return { ...(await importOriginal()), MODEL_CATALOG: (await io<any>()).LLM_MODELS }\n})\n`,
    ]
    for (const src of probes) {
      const r = run(src)
      expect(r.text).toBe(src)
      expect(r.notes.map((n) => n.kind)).toEqual(["mock-refused"])
    }
  })

  it("counts vi.importActual as the real module only for the mocked package root", () => {
    // Another module's importActual is an ordinary value: a FULL replacement, spread into every entry.
    for (const loader of [`vi.importActual("./shared-fixture")`, `vi.importActual(("./shared-fixture") as string)`, `import(\`./shared-fixture\`)`]) {
      const r = run(`vi.mock("@nodaro/shared", async () => ({ ...(await ${loader}), MODEL_CATALOG: [] }))\n`)
      const mocks = r.text.split("\n").filter((l) => l.startsWith("vi.mock("))
      expect(mocks, loader).toHaveLength(SHARED_ENTRIES.length)
      for (const m of mocks) expect(m).toContain(`...(await ${loader})`)
      expect(mocks.filter((m) => m.includes("MODEL_CATALOG"))).toHaveLength(1)
    }
  })

  it("counts every loader of the root as the real module, however it is spelled", () => {
    // Each override reads LLM_MODELS (llm-models) into MODEL_CATALOG (model-catalog):
    // splitting would leave it undefined, so every spelling must be refused untouched.
    const reads = [
      `(await vi.importActual<any>(("@nodaro/shared"))).LLM_MODELS`,
      `(await vi.importActual<any>("@nodaro/shared" as string)).LLM_MODELS`,
      `(await vi.importActual<any>("@nodaro/" + "shared")).LLM_MODELS`,
      `(await import("@nodaro/shared")).LLM_MODELS`,
      `require("@nodaro/shared").LLM_MODELS`,
      `(await vi.importActual<any>(ROOT)).LLM_MODELS`,
    ]
    for (const read of reads) {
      const src = `vi.mock("@nodaro/shared", async (importOriginal) => ({ ...(await importOriginal()), MODEL_CATALOG: ${read} }))\n`
      const r = run(src)
      expect(r.text, read).toBe(src)
      expect(r.notes.map((n) => n.kind), read).toEqual(["mock-refused"])
    }
  })

  it("refuses a real-module loader it cannot point at an entry, even for an own-entry read", () => {
    const probes = [
      `vi.mock("@nodaro/shared", async () => ({ ...(await vi.importActual<any>(ROOT)), MODEL_CATALOG: [] }))\n`,
      `vi.mock("@nodaro/shared", async (importOriginal) => ({ ...(await importOriginal()), MODEL_CATALOG: vi.fn((await vi.importActual<any>(\`@nodaro/\${"shared"}\`)).MODEL_CATALOG) }))\n`,
      // A root literal the codemod cannot classify (a helper may load it): not silently renamed.
      `vi.mock("@nodaro/shared", async (importOriginal) => ({ ...(await importOriginal()), MODEL_CATALOG: (await load("@nodaro/shared")).MODEL_CATALOG }))\n`,
      `vi.mock("@nodaro/shared", () => ({ MODEL_CATALOG: [{ id: "@nodaro/shared" }] }))\n`,
    ]
    for (const src of probes) {
      const r = run(src)
      expect(r.text, src).toBe(src)
      expect(r.notes.map((n) => n.kind), src).toEqual(["mock-refused"])
    }
  })

  it("renames a root loader the split keeps, in any literal spelling", () => {
    const own = [
      [`vi.importActual<any>(("@nodaro/shared") as string)`, `vi.importActual<any>(("@nodaro/shared/model-catalog") as string)`],
      [`require("@nodaro/shared")`, `require("@nodaro/shared/model-catalog")`],
      [`await import(\`@nodaro/shared\`)`, `await import(\`@nodaro/shared/model-catalog\`)`],
    ]
    const mock = (id: string, loader: string) =>
      `vi.mock("${id}", async (importOriginal) => ({ ...(await importOriginal()), MODEL_CATALOG: vi.fn((${loader}).MODEL_CATALOG) }))\n`
    for (const [loader, renamed] of own) {
      const r = run(mock("@nodaro/shared", loader))
      expect(r.notes, loader).toEqual([])
      expect(r.text, loader).toBe(mock("@nodaro/shared/model-catalog", renamed))
    }
  })

  it("treats a spread of anything but the real module as part of a FULL replacement", () => {
    const r = run(`vi.mock("@nodaro/shared", () => ({ ...fixture, MODEL_CATALOG: [] }))\n`)
    const mocks = r.text.split("\n").filter((l) => l.startsWith("vi.mock("))
    // Every entry stays mocked (the root mock kept the whole real package out), each with the fixture.
    expect(mocks).toHaveLength(SHARED_ENTRIES.length)
    for (const m of mocks) expect(m).toContain("...fixture")
    expect(mocks.find((m) => m.includes(`"@nodaro/shared/model-catalog"`))).toContain("MODEL_CATALOG: []")
    expect(mocks.filter((m) => m.includes("MODEL_CATALOG"))).toHaveLength(1)
  })

  it("REFUSES every mock of a root the file mocks (or unmocks) more than once", () => {
    // For one id the later registration replaces the earlier; split, the two
    // would target different entry ids and both stay active.
    const pm = (key: string, fn = "vi.mock") =>
      `${fn}("@nodaro/shared", async (importOriginal) => ({ ...(await importOriginal()), ${key}: [] }))\n`
    const probes: Array<[string, number, string[]?]> = [
      [pm("MODEL_CATALOG") + pm("LLM_MODELS"), 2],
      [pm("MODEL_CATALOG") + `it("x", async () => {\n  ${pm("MODEL_CATALOG", "vi.doMock")}})\n`, 2],
      [pm("MODEL_CATALOG") + `afterAll(() => {\n  vi.unmock("@nodaro/shared")\n})\n`, 1],
      [pm("MODEL_CATALOG") + `it("x", () => {\n  vi.doUnmock("@nodaro/shared")\n})\n`, 1],
      // An existing mock of an entry the split would emit: the two would collide on one id.
      [`vi.mock("@nodaro/shared/model-catalog", () => ({ MODEL_CATALOG: [1] }))\n` + pm("MODEL_CATALOG"), 1],
      // A second registration the codemod would not split itself still counts.
      [`import { vi as v } from "vitest"\n` + pm("MODEL_CATALOG") + `it("x", () => {\n  ${pm("LLM_MODELS", "v.doMock")}})\n`, 1],
      [pm("MODEL_CATALOG") + `vi["doMock"]("@nodaro/shared", () => ({}))\n`, 1],
      // (its `import()` id is also reported on its own, as any unbound root import())
      [pm("MODEL_CATALOG") + `vi.mock(import("@nodaro/shared"), () => ({}))\n`, 1, ["dynamic-shape"]],
      [pm("MODEL_CATALOG") + `vi.doUnmock(("@nodaro/shared") as string)\n`, 1],
      // A registration whose id the codemod cannot read may be this root.
      [pm("MODEL_CATALOG") + `vi.doUnmock(ROOT)\n`, 1],
    ]
    for (const [src, refusals, other = []] of probes) {
      const r = run(src)
      expect(r.text, src).toBe(src)
      expect(r.notes.map((n) => n.kind), src).toEqual([...other, ...Array(refusals).fill("mock-refused")])
    }
    // Per root: prompts mocked twice is refused, shared mocked once still splits,
    // and a mock of an entry the split does not emit does not stand in its way.
    const prompts = `vi.mock("@nodaro/prompts", async (importOriginal) => ({ ...(await importOriginal()), PEOPLE: [] }))\n`
    const llm = `vi.mock("@nodaro/shared/llm-models", () => ({ LLM_MODELS: [] }))\n`
    const r = run(prompts + prompts + llm + pm("MODEL_CATALOG"))
    expect(r.notes.map((n) => n.kind)).toEqual(["mock-refused", "mock-refused"])
    expect(r.text).toBe(prompts + prompts + llm + pm("MODEL_CATALOG").replaceAll(`"@nodaro/shared"`, `"@nodaro/shared/model-catalog"`))
  })

  it("REFUSES a mock whose factory reaches a module loader through an unusual spelling", () => {
    // Each override reads LLM_MODELS (llm-models) into MODEL_CATALOG (model-catalog),
    // or spreads what the loader returns: a split would change either.
    const mock = (expr: string, fn = "vi.mock") =>
      `${fn}("@nodaro/shared", async (importOriginal) => ({ ...(await importOriginal()), MODEL_CATALOG: ${expr} }))\n`
    const probes = [
      // element access on vi
      mock(`(await vi["importActual"]<any>(ROOT)).LLM_MODELS`),
      mock(`(await vi["importActual"]<any>("@nodaro/shared")).LLM_MODELS`),
      `vi.mock("@nodaro/shared", async () => ({ ...(await vi["importActual"]<any>(ROOT)), MODEL_CATALOG: [] }))\n`,
      // a loader aliased, destructured or called indirectly inside the factory
      `vi.mock("@nodaro/shared", async (importOriginal) => {\n  const ia = vi.importActual\n  return { ...(await importOriginal()), MODEL_CATALOG: (await ia<any>(ROOT)).LLM_MODELS }\n})\n`,
      `vi.mock("@nodaro/shared", async (importOriginal) => {\n  const { importActual } = vi\n  return { ...(await importOriginal()), MODEL_CATALOG: (await importActual<any>(ROOT)).LLM_MODELS }\n})\n`,
      mock(`(await (0, vi.importActual)<any>(ROOT)).LLM_MODELS`),
      mock(`(await vi.importActual.call(vi, ROOT)).LLM_MODELS`),
      mock(`(await load(vi, ROOT)).LLM_MODELS`),
      // a loader bound outside the factory (a doMock factory may read file-level bindings; vi.hoisted for vi.mock)
      `const ia = vi.importActual\nit("x", () => {\n  ${mock(`(await ia<any>(ROOT)).LLM_MODELS`, "vi.doMock")}})\n`,
      `const { importActual: ia } = vi.hoisted(() => vi)\n${mock(`(await ia<any>(ROOT)).LLM_MODELS`)}`,
      `const req = require\n${mock(`req(ROOT).LLM_MODELS`)}`,
      // vi imported under another name
      `import { vi as v } from "vitest"\n${mock(`(await v.importActual<any>(ROOT)).LLM_MODELS`)}`,
      `import * as vitest from "vitest"\n${mock(`(await vitest.vi.importActual<any>(ROOT)).LLM_MODELS`)}`,
      // a factory whose loader parameter is not a plain name
      `vi.mock("@nodaro/shared", async (...args: any[]) => ({ ...(await args[0]()), MODEL_CATALOG: [] }))\n`,
      `vi.mock("@nodaro/shared", async function () { return { ...(await arguments[0]()), MODEL_CATALOG: [] } })\n`,
    ]
    for (const src of probes) {
      const r = run(src)
      expect(r.text, src).toBe(src)
      expect(r.notes.map((n) => n.kind), src).toEqual(["mock-refused"])
    }
    // An ordinary vi call (vi.fn, also through a renamed import) still splits.
    const fine = `import { vi as v } from "vitest"\nvi.mock("@nodaro/shared", async (importOriginal) => ({ ...(await importOriginal()), MODEL_CATALOG: v.fn(), LLM_MODELS: vi.fn() }))\n`
    const r = run(fine)
    expect(r.notes).toEqual([])
    expect(r.text).toContain(`vi.mock("@nodaro/shared/model-catalog", async (importOriginal) => ({ ...(await importOriginal()), MODEL_CATALOG: v.fn() }))`)
  })

  it("points a qualified import() type inside a mock at the entry that exports the name", () => {
    const src = `vi.mock("@nodaro/shared", async (importOriginal) => ({\n  ...(await importOriginal<typeof import("@nodaro/shared")>()),\n  MODEL_CATALOG: [] as import("@nodaro/shared").GenericNode[],\n}))\n`
    expect(run(src).text).toBe(
      `vi.mock("@nodaro/shared/model-catalog", async (importOriginal) => ({\n  ...(await importOriginal<typeof import("@nodaro/shared/model-catalog")>()),\n  MODEL_CATALOG: [] as import("@nodaro/shared/types").GenericNode[],\n}))\n`,
    )
    // In a FULL replacement too, and through `typeof import(root).X`.
    const full = run(`vi.mock("@nodaro/shared", () => ({ MODEL_CATALOG: [] as unknown as typeof import("@nodaro/shared").LLM_MODELS }))\n`)
    expect(full.text.split("\n").find((l) => l.includes("MODEL_CATALOG"))).toBe(
      `vi.mock("@nodaro/shared/model-catalog", () => ({ MODEL_CATALOG: [] as unknown as typeof import("@nodaro/shared/llm-models").LLM_MODELS }))`,
    )
    // A name the package does not export cannot be pointed anywhere: refused.
    const unknown = src.replace("GenericNode", "NoSuchExport")
    const r = run(unknown)
    expect(r.text).toBe(unknown)
    expect(r.notes.map((n) => n.kind)).toEqual(["mock-refused"])
  })

  it("keeps a comment that heads the next name with that name", () => {
    expect(run(`import {\n  MODEL_CATALOG, // llm-models — the table\n  LLM_MODELS,\n} from "@nodaro/shared"\n`).text).toBe(
      `import {\n  MODEL_CATALOG,\n} from "@nodaro/shared/model-catalog"\nimport {\n  // llm-models — the table\n  LLM_MODELS,\n} from "@nodaro/shared/llm-models"\n`,
    )
  })

  it("merges imports of the same entry, keeping `type` on names from an `import type`", () => {
    expect(run(`import { MODEL_CATALOG } from "@nodaro/shared/model-catalog"\nimport type { ModelCatalogEntry } from "@nodaro/shared/model-catalog"\n`).text).toBe(
      `import { MODEL_CATALOG, type ModelCatalogEntry } from "@nodaro/shared/model-catalog"\n`,
    )
    expect(run(`import { LLM_MODELS } from "@nodaro/shared"\nimport { MODEL_CATALOG } from "@nodaro/shared/model-catalog"\nimport { DEFAULT_MODEL_CATALOG_PLACEHOLDER as X } from "./local"\nimport { type ModelCatalogEntry } from "@nodaro/shared"\n`).text).toBe(
      `import { LLM_MODELS } from "@nodaro/shared/llm-models"\nimport { MODEL_CATALOG, type ModelCatalogEntry } from "@nodaro/shared/model-catalog"\nimport { DEFAULT_MODEL_CATALOG_PLACEHOLDER as X } from "./local"\n`,
    )
  })

  it("is idempotent", () => {
    const sources = [
      `import { renderNodeOf, type SpeakerViewPriceTier } from "@nodaro/shared"\nexport { MODEL_CATALOG, type GenericNode } from "@nodaro/shared"\n`,
      `import * as S from "@nodaro/shared"\nconst a = S.MODEL_CATALOG\ntype T = import("@nodaro/shared").GenericNode\n`,
      `vi.mock("@nodaro/shared", () => ({ ...fixture, MODEL_CATALOG: [] }))\n`,
      `vi.mock("@nodaro/prompts", async (importOriginal) => ({ ...(await importOriginal()), PEOPLE: [] }))\nimport { PEOPLE } from "@nodaro/prompts"\n`,
      `import { MODEL_CATALOG } from "@nodaro/shared/model-catalog"\nimport type { ModelCatalogEntry } from "@nodaro/shared/model-catalog"\n`,
    ]
    for (const src of sources) {
      const once = run(src).text
      expect(once).not.toBe(src)
      expect(run(once).text).toBe(once)
    }
  })
})
