// @vitest-environment node
// @test-watches supabase/tests/fixtures/admin-job-output-preview-cases.json
/**
 * The admin Jobs list returns each job's output as a PREVIEW
 * (`public.admin_job_output_preview`, migration 584): its web addresses where
 * they sit, `thumbnailUrl` / `imageUrl`, and the start of its text. The SQL is
 * proved against the case table below (supabase/tests/admin-job-page.behavior.sql);
 * this holds the other half: for every case, the gallery tile the preview makes
 * is the tile the whole output makes.
 *
 * Both values reach the browser as Postgres prints `jsonb`: an object's keys
 * shortest first, then by their bytes — the order `extractAssets` walks them
 * in. `asServed` puts each case in that order before the tile reads it.
 */
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { tileMedia } from "../jobs-gallery-grouping"
import type { AdminJob } from "@/ee/hooks/queries/use-admin-queries"

interface PreviewCase {
  label: string
  output: unknown
  expected: unknown
}

const CASES = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("../../../../../../../../supabase/tests/fixtures/admin-job-output-preview-cases.json", import.meta.url)),
    "utf8",
  ),
) as PreviewCase[]

const bytes = new TextEncoder()
/** `jsonb`'s key order: shorter keys first, then byte by byte. */
function jsonbKeyOrder(a: string, b: string): number {
  const x = bytes.encode(a)
  const y = bytes.encode(b)
  if (x.length !== y.length) return x.length - y.length
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i]! - y[i]!
  return 0
}

/** A JSON value as Postgres serves it from a `jsonb` column. */
function asServed(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(asServed)
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => jsonbKeyOrder(a, b))
    return Object.fromEntries(entries.map(([k, v]) => [k, asServed(v)]))
  }
  return value
}

const tileOf = (output: unknown) =>
  tileMedia({ id: "j", status: "completed", job_type: null, input_data: null, output_data: asServed(output) } as unknown as AdminJob)

describe("a job's output preview makes the tile its whole output makes", () => {
  it("reads the shared case table", () => {
    expect(CASES.length).toBeGreaterThanOrEqual(10)
    // The table covers every kind of tile, so the parity below is not vacuous.
    expect(new Set(CASES.map((c) => tileOf(c.output).kind))).toEqual(new Set(["video", "image", "audio", "text", "none"]))
  })

  it.each(CASES.map((c) => [c.label, c] as const))("%s", (_label, c) => {
    expect(tileOf(c.expected)).toEqual(tileOf(c.output))
  })

  it("a long text cut to its first 1000 characters after its leading whitespace makes the same tile", () => {
    const text = `${" ".repeat(1500)}\n${"word ".repeat(2000)}`
    expect(tileOf({ text: text.trimStart().slice(0, 1000) })).toEqual(tileOf({ text, usage: { input: 4 } }))
    expect(tileOf({ text }).kind).toBe("text")
  })
})
