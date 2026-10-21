// @test-watches backend/src/**/*.ts backend/scripts/**/*.ts
/**
 * R33's gate wiring:
 *  1. the service-role client registers itself with the gate when it is
 *     created (`lib/supabase.ts`) — with no client the gate never probes and
 *     stays on the rollback's tier path in every process;
 *  2. `assumeLlmMeteredSchemaReadyForDocs()` — "the schema is there, don't
 *     ask" — is for the doc GENERATORS only (`backend/scripts/`): called from a
 *     serving process it would price metered before migrations 551, 552 and 554 exist.
 */
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { describe, expect, it, vi } from "vitest"

const h = vi.hoisted(() => ({ client: { tag: "service-role-client" }, register: vi.fn() }))
vi.mock("@supabase/supabase-js", () => ({ createClient: vi.fn(() => h.client) }))
vi.mock("../llm-metered-schema-gate.js", () => ({ registerLlmMeteredSchemaClient: h.register }))

const BACKEND = join(__dirname, "..", "..", "..")

function tsFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "__tests__" || name === "dist") continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) tsFiles(p, out)
    else if (/\.(?:ts|mts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p)
  }
  return out
}

describe("the R33 schema gate's wiring", () => {
  it("lib/supabase.ts hands the gate the service-role client it creates", async () => {
    const { supabase } = await import("../supabase.js")
    expect(supabase).toBe(h.client)
    expect(h.register).toHaveBeenCalledTimes(1)
    expect(h.register).toHaveBeenCalledWith(h.client)
  })

  it("only the doc generators (backend/scripts/) call assumeLlmMeteredSchemaReadyForDocs()", () => {
    const callers = [...tsFiles(join(BACKEND, "src")), ...tsFiles(join(BACKEND, "scripts"))]
      .filter((f) => /\bassumeLlmMeteredSchemaReadyForDocs\s*\(/.test(readFileSync(f, "utf8").replace(/export function assumeLlmMeteredSchemaReadyForDocs\s*\(/, "")))
      .map((f) => relative(BACKEND, f).split("\\").join("/"))
      .sort()
    const outsideScripts = callers.filter((f) => !f.startsWith("scripts/"))
    expect(
      outsideScripts,
      "assumeLlmMeteredSchemaReadyForDocs() pins the gate ready without asking the database — generators only. A serving process must let the gate probe.",
    ).toEqual([])
    // The generators that need it still call it (their docs describe the hosted, metered deployment).
    expect(callers).toEqual(expect.arrayContaining(["scripts/gen-skills.ts", "scripts/docs-prices.ts"]))
  })
})
