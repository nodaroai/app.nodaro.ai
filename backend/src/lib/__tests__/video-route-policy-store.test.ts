import { afterEach, beforeEach, expect, it, vi } from "vitest"

const h = vi.hoisted(() => ({
  row: null as { key: string; value: unknown; updated_at: string | null } | null,
  insertError: null as { code: string; message: string } | null,
}))
vi.mock("../app-settings.js", () => ({ invalidateSettingsCache: vi.fn() }))
vi.mock("../runtime-env.js", () => ({ getRuntimeEnv: () => "test" }))
vi.mock("../supabase.js", () => ({
  supabase: { from: () => ({
    select: () => ({
      eq: () => ({ maybeSingle: async () => ({ data: h.row && { ...h.row }, error: null }) }),
    }),
    insert: async (row: NonNullable<typeof h.row>) => {
      if (h.insertError) return { error: h.insertError }
      if (h.row) return { error: { code: "23505", message: "duplicate" } }
      h.row = row
      return { error: null }
    },
    update: (patch: Partial<NonNullable<typeof h.row>>) => {
      const predicates: Array<[string, unknown]> = []
      const query = {
        eq: (key: string, value: unknown) => { predicates.push([key, value]); return query },
        is: (key: string, value: unknown) => { predicates.push([key, value]); return query },
        select: async () => {
          if (!h.row || predicates.some(([key, value]) => h.row![key as keyof typeof h.row] !== value)) {
            return { data: [], error: null }
          }
          h.row = { ...h.row, ...patch }
          return { data: [{ key: h.row.key }], error: null }
        },
      }
      return query
    },
  }) },
}))

const { updateSettingsRow } = await import("../video-route-policy-store.js")
beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date("2026-11-26T10:00:00.000Z"))
  h.row = { key: "alerts", value: [], updated_at: "2026-11-26T10:00:00.000Z" }
  h.insertError = null
})
afterEach(() => vi.useRealTimers())

it("retains both concurrent changes even when the clock has not advanced", async () => {
  await Promise.all([
    updateSettingsRow("alerts", raw => [...raw as string[], "first"]),
    updateSettingsRow("alerts", raw => [...raw as string[], "second"]),
  ])
  expect(h.row?.value).toEqual(["first", "second"])
})

it("advances beyond a database timestamp with sub-millisecond precision", async () => {
  h.row!.updated_at = "2026-11-26T10:00:00.000999+00:00"
  await updateSettingsRow("alerts", () => ["new"])
  expect(h.row?.updated_at).toBe("2026-11-26T10:00:00.001Z")
})

it("preserves the cause when a new row cannot be inserted", async () => {
  h.row = null
  h.insertError = { code: "42501", message: "permission denied" }
  await expect(updateSettingsRow("alerts", () => ["new"])).rejects.toThrow("permission denied")
})
