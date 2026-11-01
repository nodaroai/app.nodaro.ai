// @test-watches backend/src/lib/job-status.ts
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import {
  ADMIN_JOB_STATUSES,
  DEFAULT_JOB_FILTERS,
  LIST_ITEM,
  LIST_MAX,
  MODEL_PICK_MAX,
  jobFiltersKey,
  parseJobFilters,
  serializeJobFilters,
  serverParams,
  type AdminJobFilters,
} from "../jobs-filters"
import { otherJobTypes, typesOfKind, type JobKind } from "../job-kinds"
import { MODEL_EXTRA_VALUES, modelLines, modelValuesOf, modelsOfLine } from "../model-lines"

const parse = (search: string) => parseJobFilters(new URLSearchParams(search))
const filters = (over: Partial<AdminJobFilters>): AdminJobFilters => ({ ...DEFAULT_JOB_FILTERS, ...over })
const TODAY = new Date("2026-11-01T10:30:00Z")

describe("admin jobs filters in the URL", () => {
  it("round-trips every field", () => {
    const line = modelLines()[0]!.line
    const f = filters({
      view: "gallery",
      status: "pending_review",
      userEmail: "dana@example.com",
      kind: "video",
      types: ["generate-video", "image-to-video"],
      line,
      models: ["kling-3.0", "veo-3"],
      minCredits: 25,
      sources: ["app:abc", "web:studio"],
      from: "2026-10-01",
      to: "2026-10-31",
      q: "a red fox",
    })
    const search = serializeJobFilters(f).toString()
    expect(parse(search)).toEqual(f)
    expect([...serializeJobFilters(f).keys()]).toEqual([
      "view", "status", "user", "kind", "types", "line", "models", "minCredits", "sources", "from", "to", "q",
    ])
  })

  it("writes nothing for the defaults and reads the defaults from nothing", () => {
    expect(serializeJobFilters(DEFAULT_JOB_FILTERS).toString()).toBe("")
    expect(parse("")).toEqual(DEFAULT_JOB_FILTERS)
  })

  it("drops an invalid minCredits", () => {
    for (const bad of ["-5", "abc", "1.5", "1e3", ""]) expect(parse(`minCredits=${bad}`).minCredits).toBeUndefined()
    expect(parse("minCredits=0").minCredits).toBe(0)
    expect(parse("minCredits=40").minCredits).toBe(40)
  })

  it("drops every other value the server would refuse", () => {
    const f = parse(
      "view=grid&status=done&user=not-an-email&kind=sculpture&line=No+Such+Line&from=2026-02-30&to=11/01/2026" +
        `&q=${"x".repeat(201)}&types=generate-video,bad%20type&sources=web:studio,a/b`,
    )
    expect(f).toEqual(filters({ types: ["generate-video"], sources: ["web:studio"] }))
  })

  it("user=admins-hidden sets excludeAdmins", () => {
    expect(parse("user=admins-hidden")).toEqual(filters({ excludeAdmins: true }))
    expect(serializeJobFilters(filters({ excludeAdmins: true })).toString()).toBe("user=admins-hidden")
  })

  it("a malformed address is dropped, never sent for the server to refuse", () => {
    for (const bad of ["a@b..c", "a@b", "a b@c.de", "@b.co"]) expect(parse(`user=${encodeURIComponent(bad)}`).userEmail, bad).toBeUndefined()
    expect(parse("user=a_b%2Btag@example.co.uk").userEmail).toBe("a_b+tag@example.co.uk")
  })

  it("the user is an address, lowercased, never an id", () => {
    expect(parse("user=Dana@Example.com").userEmail).toBe("dana@example.com")
    expect(parse("user=0b7e7c4e-0000-4000-8000-000000000001").userEmail).toBeUndefined()
    // One user wins over hiding the admins: the URL holds one `user`.
    expect(serializeJobFilters(filters({ userEmail: "a@b.co", excludeAdmins: true })).get("user")).toBe("a@b.co")
  })

  it("kind=other parses", () => expect(parse("kind=other").kind).toBe("other"))
})

describe("admin jobs server params", () => {
  it("kind without types expands", () => {
    expect(serverParams(filters({ kind: "video" }), TODAY).get("types")).toBe(typesOfKind("video").join(","))
    expect(serverParams(filters({ kind: "other" }), TODAY).get("types")).toBe(otherJobTypes().join(","))
    expect(serverParams(filters({ kind: "video", types: ["generate-video"] }), TODAY).get("types")).toBe("generate-video")
  })

  it("line without models expands", () => {
    const line = modelLines()[0]!.line
    expect(serverParams(filters({ line }), TODAY).get("models")).toBe(modelsOfLine(line).join(","))
    expect(serverParams(filters({ line, models: ["x-1"] }), TODAY).get("models")).toBe("x-1")
  })

  it("an exact model pick sends every value a row stores for it (Suno's V5)", () => {
    const models = serverParams(filters({ models: ["suno-v5", "kling-3.0"] }), TODAY).get("models")!.split(",")
    expect(new Set(models)).toEqual(new Set(["suno-v5", "V5", "kling-3.0"]))
  })

  it("a full model pick still fits the server's list once its stored values are added", () => {
    expect(MODEL_PICK_MAX).toBe(LIST_MAX - MODEL_EXTRA_VALUES)
    const ids = Object.keys(Object.fromEntries(modelLines().flatMap((l) => l.models.map((m) => [m.id, true]))))
    // The worst case: every id with extra values, then any others up to the cap.
    const worst = [...ids.filter((id) => modelValuesOf(id).length > 1), ...ids.filter((id) => modelValuesOf(id).length === 1)]
      .slice(0, MODEL_PICK_MAX)
    const sent = serverParams(filters({ models: worst }), TODAY).get("models")!.split(",")
    expect(sent.length).toBeLessThanOrEqual(LIST_MAX)
    const tooMany = Array.from({ length: MODEL_PICK_MAX + 1 }, (_, i) => `m-${i}`).join(",")
    expect(parse(`models=${tooMany}`).models).toEqual([])
  })

  it("q without from fills the 7-day range", () => {
    const p = serverParams(filters({ q: "fox" }), TODAY)
    expect(p.get("from")).toBe("2026-10-25")
    expect(p.get("to")).toBeNull()
    expect(p.get("q")).toBe("fox")
  })

  it("the 7-day range ends at `to`, so it never starts after it", () => {
    const p = serverParams(filters({ q: "fox", to: "2026-03-10" }), TODAY)
    expect(p.get("from")).toBe("2026-03-03")
    expect(p.get("to")).toBe("2026-03-10")
  })

  it("a given from is kept", () => {
    expect(serverParams(filters({ q: "fox", from: "2026-01-01" }), TODAY).get("from")).toBe("2026-01-01")
  })

  it("uuid q adds no date", () => {
    const p = serverParams(filters({ q: "0B7E7C4E-0000-4000-8000-000000000001" }), TODAY)
    expect(p.get("from")).toBeNull()
    expect(p.get("q")).toBe("0B7E7C4E-0000-4000-8000-000000000001")
  })

  it("sends the address and never the view or the admins flag", () => {
    const p = serverParams(filters({ view: "gallery", userEmail: "dana@example.com", excludeAdmins: true, status: "failed", minCredits: 0 }), TODAY)
    expect(Object.fromEntries(p)).toEqual({ status: "failed", userEmail: "dana@example.com", minCredits: "0" })
  })

  it("same filters → same query key", () => {
    const a = filters({ types: ["b", "a"], sources: ["web:x", "app:y"], status: "failed" })
    const b = filters({ status: "failed", sources: ["app:y", "web:x"], types: ["a", "b", "a"] })
    expect(jobFiltersKey(a)).toBe(jobFiltersKey(b))
    expect(jobFiltersKey({ ...a, view: "gallery" })).toBe(jobFiltersKey(a))
    expect(jobFiltersKey(filters({ status: "completed" }))).not.toBe(jobFiltersKey(a))
  })

  it("every expansion fits the server's list filter", () => {
    const lists: Array<[string, string[]]> = [
      ...(["video", "image", "audio", "music", "text"] as JobKind[]).map((k): [string, string[]] => [`kind ${k}`, typesOfKind(k)]),
      ["kind other", otherJobTypes()],
      ...modelLines().map((l): [string, string[]] => [`line ${l.line}`, modelsOfLine(l.line)]),
    ]
    for (const [name, items] of lists) {
      expect(items.length, `${name} has more items than the server takes`).toBeLessThanOrEqual(LIST_MAX)
      for (const item of items) expect(item, `${name}: ${item}`).toMatch(LIST_ITEM)
    }
  })

  it("the statuses are the server's", () => {
    const here = dirname(fileURLToPath(import.meta.url))
    const src = readFileSync(join(here, "../../../../../../../../backend/src/lib/job-status.ts"), "utf8")
    const literal = /export const JOB_STATUSES = \[([^\]]*)\]/.exec(src)?.[1]
    expect(literal, "JOB_STATUSES not found").toBeDefined()
    const server = [...literal!.matchAll(/"([^"]+)"/g)].map((m) => m[1])
    expect([...ADMIN_JOB_STATUSES]).toEqual(server)
  })
})
