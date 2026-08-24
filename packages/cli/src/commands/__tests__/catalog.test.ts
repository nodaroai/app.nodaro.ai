import { describe, it, expect, vi } from "vitest"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { catalogCommand } from "../catalog.js"

/** Attach a fresh `catalog` command tree, dispatch argv, and return captured stdout. */
async function runCatalog(...args: string[]): Promise<string> {
  let out = ""
  const spy = vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
    out += typeof chunk === "string" ? chunk : String(chunk)
    return true
  })
  try {
    await catalogCommand().exitOverride().parseAsync(["node", "test", ...args])
  } finally {
    spy.mockRestore()
  }
  return out
}

describe("catalogCommand", () => {
  it("registers diff-upstream, validate, snapshot subcommands", () => {
    const names = catalogCommand()
      .commands.map((c) => c.name())
      .sort()
    expect(names).toEqual(["diff-upstream", "snapshot", "validate"])
  })

  it("snapshot converts a detail=full projection + sidecars into the CatalogSnapshot shape diff-upstream/validate consume", async () => {
    const inFile = join(mkdtempSync(join(tmpdir(), "catalog-snap-")), "in.json")
    writeFileSync(
      inFile,
      JSON.stringify({
        // a detail=full /v1/catalogs projection (has `options`, not `entries`)
        projected: {
          catalogId: "setting",
          kind: "single",
          options: [
            { id: "forest", label: "Forest", promptHint: "in a forest" },
            { id: "beach", label: "Beach", promptHint: "on a beach" },
          ],
        },
        sidecars: { he: { forest: { label: "יער" }, beach: { label: "חוף" } } },
      }),
    )

    const snap = JSON.parse(await runCatalog("snapshot", "--in", inFile))

    // It is the CatalogSnapshot shape ({ catalogId, kind, entries[], sidecars }),
    // NOT a pass-through of the input (which had `projected`/`sidecars` keys).
    expect(Object.keys(snap).sort()).toEqual(["catalogId", "entries", "kind", "sidecars"])
    expect(snap).toMatchObject({ catalogId: "setting", kind: "single" })
    expect(snap.entries.map((e: { id: string }) => e.id)).toEqual(["beach", "forest"]) // id-sorted
    expect(snap.sidecars.he.forest.label).toBe("יער") // sidecars carried through
  })

  it("snapshot flattens multi-dim dimensions into a single de-duped entry list", async () => {
    const inFile = join(mkdtempSync(join(tmpdir(), "catalog-snap-")), "in.json")
    writeFileSync(
      inFile,
      JSON.stringify({
        projected: {
          catalogId: "person",
          kind: "multi",
          dimensions: [
            { options: [{ id: "type-woman", label: "Woman", promptHint: "a woman" }] },
            { options: [{ id: "age-30s", label: "30s", promptHint: "in their 30s" }] },
          ],
        },
      }),
    )

    const snap = JSON.parse(await runCatalog("snapshot", "--in", inFile))
    expect(snap.kind).toBe("multi")
    expect(snap.entries.map((e: { id: string }) => e.id).sort()).toEqual(["age-30s", "type-woman"])
    expect(snap.sidecars).toEqual({}) // sidecars default to {} when omitted
  })
})
