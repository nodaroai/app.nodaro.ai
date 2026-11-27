import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

vi.mock("@/lib/supabase.js", async () => ({ supabase: (await import("./editor-projects-fakes.js")).fakeSupabase }))
vi.mock("@/ee/lib/editor-projects/bucket.js", async () => ({
  editorProjectsStore: (await import("./editor-projects-fakes.js")).fakeEditorProjectsStore,
}))

import jsonpatch from "fast-json-patch"
import { db, seedProject, storage } from "./editor-projects-fakes.js"
import { MB, ME, TAB, TAB2, envelope, heldProject, json, patchFile, putFile, readBack, saveWhole, sha, startApp, stopApp } from "./editor-projects-harness.js"
import { RELEASE_HEADER } from "../../../lib/editor-project-headers.js"
import { registerUploadPolicy } from "../../../lib/upload-policy.js"
import { RELEASE_TURN_WAIT_MS } from "../editor-projects-file.js"

/**
 * A save that gives the claim up once it is stored (`x-release: 1`): what a page sends as it closes, so ONE request
 * carries both its last save and the end of its claim, and the platform orders them (a release sent beside a save can
 * land first and refuse that save `not_holder`). Released only after a save that stood; a refused one keeps the claim.
 */

beforeEach(startApp)
afterEach(stopApp)

const RELEASE = { [RELEASE_HEADER]: "1" }
const calls = () => db.rpcCalls.map((c) => c.name)

describe("x-release on a save", () => {
  it("a PUT with x-release stores the content, then gives the claim up", async () => {
    const p = heldProject()
    const e = envelope({ a: 1 })
    const res = await putFile(p.id, e.gz, e.hash, RELEASE)
    expect(res.statusCode, res.body).toBe(200)
    expect(res.json()).toEqual({ revision: 1, saved: true, released: true })
    expect(p.holder_id).toBeNull()
    expect((await readBack(p)).text).toBe(e.text)
    // Stored first, released after.
    expect(calls().filter((n) => n === "editor_project_save" || n === "editor_project_release")).toEqual(["editor_project_save", "editor_project_release"])
  })

  it("a PATCH with x-release stores the difference, then gives the claim up", async () => {
    const p = heldProject()
    const base = await saveWhole(p, { a: 1 })
    const next = envelope({ a: 2 })
    const res = await patchFile(p.id, jsonpatch.compare({ a: 1 }, { a: 2 }), base.hash, next.hash, RELEASE)
    expect(res.json()).toEqual({ revision: 2, saved: true, released: true })
    expect(p.holder_id).toBeNull()
    expect((await readBack(p)).text).toBe(next.text)
  })

  it("the same content again (a save already stored, sent once more) answers saved: false and still releases", async () => {
    const p = heldProject()
    const e = await saveWhole(p, { a: 1 })
    expect((await putFile(p.id, e.gz, e.hash, RELEASE)).json()).toEqual({ revision: 1, saved: false, released: true })
    expect(p.holder_id).toBeNull()
  })

  it("a PATCH re-sent after its first copy landed (its base gone) finds its content stored and releases", async () => {
    const p = heldProject()
    const base = await saveWhole(p, { a: 1 })
    const next = envelope({ a: 2 })
    const ops = jsonpatch.compare({ a: 1 }, { a: 2 })
    expect((await patchFile(p.id, ops, base.hash, next.hash)).json()).toEqual({ revision: 2, saved: true })
    expect((await patchFile(p.id, ops, base.hash, next.hash, RELEASE)).json()).toEqual({ revision: 2, saved: false, released: true })
    expect(p.holder_id).toBeNull()
  })

  it("an empty patch over the stored content cuts the version asked for and releases (a page closing with nothing new)", async () => {
    const p = heldProject()
    const e = await saveWhole(p, { a: 1 })
    const res = await patchFile(p.id, [], e.hash, e.hash, { ...RELEASE, "x-cut-version": "Manual%20edit" })
    expect(res.json()).toEqual({ revision: 1, saved: false, version: 1, released: true })
    expect(p.holder_id).toBeNull()
  })

  it("with x-cut-version, the version is cut before the claim is given up", async () => {
    const p = heldProject()
    const e = envelope({ a: 1 })
    // Still this tab's while the version is cut.
    let holderAtCut: string | null | undefined
    db.beforeVersionInsert = () => void (holderAtCut = p.holder_id)
    const res = await putFile(p.id, e.gz, e.hash, { ...RELEASE, "x-cut-version": "Manual%20edit" })
    expect(holderAtCut).toBe(TAB)
    expect(res.json()).toEqual({ revision: 1, saved: true, version: 1, released: true })
    expect(db.versions.map((v) => ({ number: v.number, label: v.label, content_hash: v.content_hash }))).toEqual([{ number: 1, label: "Manual edit", content_hash: e.hash }])
    expect(p.holder_id).toBeNull()
    const order = calls()
    expect(order.lastIndexOf("editor_project_release")).toBeGreaterThan(order.indexOf("editor_project_save"))
    expect(db.versionWrites.length).toBeGreaterThan(0)
  })

  it("without x-release a save keeps the claim and its answer has no `released`", async () => {
    const p = heldProject()
    const e = envelope({ a: 1 })
    expect((await putFile(p.id, e.gz, e.hash)).json()).toEqual({ revision: 1, saved: true })
    expect(p.holder_id).toBe(TAB)
    expect(calls()).not.toContain("editor_project_release")
  })

  it("x-release other than 1 is 400 validation_error, and nothing is stored or released", async () => {
    const p = heldProject()
    const e = envelope({ a: 1 })
    for (const value of ["0", "true", ""]) {
      const res = await putFile(p.id, e.gz, e.hash, { [RELEASE_HEADER]: value })
      expect(res.statusCode, value).toBe(400)
      expect(res.json()).toEqual({ error: "validation_error" })
    }
    expect(p.holder_id).toBe(TAB)
    expect(p.content_hash).toBeNull()
  })
})

describe("a refused save with x-release keeps the claim", () => {
  it("not_holder: another tab holds it, and keeps holding it", async () => {
    const p = seedProject({ user_id: ME, holder_id: TAB2, holder_seen_at: new Date().toISOString() })
    const e = envelope({ a: 1 })
    const res = await putFile(p.id, e.gz, e.hash, RELEASE)
    expect(res.json()).toEqual({ error: "not_holder" })
    expect(p.holder_id).toBe(TAB2)
    expect(calls()).not.toContain("editor_project_release")
  })

  it("base_mismatch: the saved content moved since the patch's base; the claim stays this tab's", async () => {
    const p = heldProject()
    const first = await saveWhole(p, { a: 1 })
    await saveWhole(p, { a: 9 })
    const next = envelope({ a: 2 })
    const res = await patchFile(p.id, jsonpatch.compare({ a: 1 }, { a: 2 }), first.hash, next.hash, RELEASE)
    expect(res.statusCode).toBe(409)
    expect(res.json()).toEqual({ error: "base_mismatch" })
    expect(p.holder_id).toBe(TAB)
    expect(calls()).not.toContain("editor_project_release")
  })

  it("an empty patch over a base that is no longer stored (the save it waited for never landed) is refused and releases nothing", async () => {
    const p = heldProject()
    await saveWhole(p, { a: 1 })
    const never = envelope({ a: 2 })
    const res = await patchFile(p.id, [], never.hash, never.hash, RELEASE)
    expect(res.json()).toEqual({ error: "base_mismatch" })
    expect(p.holder_id).toBe(TAB)
  })

  it("too_large: a body over the limit; the claim stays", async () => {
    const p = heldProject()
    const res = await putFile(p.id, Buffer.alloc(5 * MB + 1), sha("x"), RELEASE)
    expect(res.statusCode).toBe(413)
    expect(p.holder_id).toBe(TAB)
  })

  it("hash_mismatch: content that is not the hash named; the claim stays", async () => {
    const p = heldProject()
    const e = envelope({ a: 1 })
    const res = await putFile(p.id, e.gz, sha("another"), RELEASE)
    expect(res.json()).toEqual({ error: "hash_mismatch" })
    expect(p.holder_id).toBe(TAB)
  })

  it("a release that fails after the save stood answers the save, released: false", async () => {
    const p = heldProject()
    const e = envelope({ a: 1 })
    // The project deleted between the save and its release: the save's own answer stands.
    db.afterSave = () => void (p.deleted_at = new Date().toISOString())
    const res = await putFile(p.id, e.gz, e.hash, RELEASE)
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ revision: 1, saved: true, released: false })
  })
})

describe("a save with x-release meeting the user's heavy turn", () => {
  it("waits for the running save and then stands and releases, while a plain save meanwhile is still 429 busy", async () => {
    const p = heldProject()
    const base = await saveWhole(p, { v: 1 })
    const running = envelope({ v: 2 })
    const last = envelope({ v: 3 })
    let waiting: ReturnType<typeof putFile> | null = null
    let plain: Awaited<ReturnType<typeof putFile>> | null = null
    db.beforeSave = async () => {
      // Started while the save below holds the turn: it waits (never awaited here, which would hold the turn forever).
      waiting = patchFile(p.id, jsonpatch.compare({ v: 2 }, { v: 3 }), running.hash, last.hash, RELEASE)
      plain = await putFile(p.id, envelope({ v: 4 }).gz, envelope({ v: 4 }).hash)
    }
    const res = await patchFile(p.id, jsonpatch.compare({ v: 1 }, { v: 2 }), base.hash, running.hash)
    expect(res.json()).toEqual({ revision: 2, saved: true })
    expect(plain!.statusCode).toBe(429)
    expect(plain!.json()).toEqual({ error: "busy" })
    const after = await waiting!
    expect(after.json()).toEqual({ revision: 3, saved: true, released: true })
    expect((await readBack(p)).text).toBe(last.text)
    expect(p.holder_id).toBeNull()
  })

  it("a save the platform reads after the claim was given up is refused not_holder (an older save never lands over the last one)", async () => {
    const p = heldProject()
    const base = await saveWhole(p, { v: 1 })
    const last = envelope({ v: 3 })
    expect((await patchFile(p.id, jsonpatch.compare({ v: 1 }, { v: 3 }), base.hash, last.hash, RELEASE)).json()).toEqual({ revision: 2, saved: true, released: true })
    const older = envelope({ v: 2 })
    const late = await patchFile(p.id, jsonpatch.compare({ v: 1 }, { v: 2 }), base.hash, older.hash)
    expect(late.json()).toEqual({ error: "not_holder" })
    expect((await readBack(p)).text).toBe(last.text)
  })
})

describe("a newer edit sent as two fenced differences while a PATCH is on its way", () => {
  /**
   * A project saved at A, a PATCH A→W on its way (`flight`), and the newer N sent at close as N-from-A (`fromStored`,
   * first) and N-from-W (`fromFlight`), each with x-release. `run` reads them in the order given.
   */
  async function onItsWay() {
    const p = heldProject()
    const a = await saveWhole(p, { v: 1 })
    const w = envelope({ v: 2 })
    const n = envelope({ v: 3 })
    const requests = {
      flight: () => patchFile(p.id, jsonpatch.compare({ v: 1 }, { v: 2 }), a.hash, w.hash),
      fromStored: () => patchFile(p.id, jsonpatch.compare({ v: 1 }, { v: 3 }), a.hash, n.hash, RELEASE),
      fromFlight: () => patchFile(p.id, jsonpatch.compare({ v: 2 }, { v: 3 }), w.hash, n.hash, RELEASE),
    }
    const run = async (order: ReadonlyArray<keyof typeof requests>) => {
      const answers: Record<string, { saved?: boolean; error?: string }> = {}
      for (const name of order) answers[name] = (await requests[name]()).json()
      return answers
    }
    return { p, n, w, run, requests }
  }
  const accepted = (answers: Record<string, { saved?: boolean }>) => ["fromStored", "fromFlight"].filter((name) => answers[name]?.saved === true)

  const orders: Array<[string, ReadonlyArray<"flight" | "fromStored" | "fromFlight">, "fromStored" | "fromFlight"]> = [
    ["the flight landing before both", ["flight", "fromStored", "fromFlight"], "fromFlight"],
    ["the flight landing between the two", ["fromStored", "flight", "fromFlight"], "fromStored"],
    ["the flight landing after both", ["fromStored", "fromFlight", "flight"], "fromStored"],
    ["the flight never landing", ["fromStored", "fromFlight"], "fromStored"],
  ]
  for (const [name, order, applies] of orders) {
    it(`${name}: exactly one applies (${applies}), N is stored, the claim is given up, and a late flight is refused`, async () => {
      const { p, n, run } = await onItsWay()
      const answers = await run(order)
      expect(accepted(answers)).toEqual([applies])
      if (order.indexOf("flight") > order.indexOf("fromStored")) expect(answers.flight).toEqual({ error: "not_holder" })
      expect((await readBack(p)).text).toBe(n.text)
      expect(p.holder_id).toBeNull()
    })
  }

  it("the flight holding the user's turn as both arrive: they wait, the stored-base one is refused once it lands, the other applies", async () => {
    const { p, n, w, requests } = await onItsWay()
    let waiting: Array<ReturnType<typeof patchFile>> = []
    db.beforeSave = async () => {
      waiting = [requests.fromStored(), requests.fromFlight()]
    }
    expect((await requests.flight()).json()).toEqual({ revision: 2, saved: true })
    const [fromStored, fromFlight] = await Promise.all(waiting)
    expect(fromStored!.json()).toEqual({ error: "base_mismatch" })
    expect(fromFlight!.json()).toEqual({ revision: 3, saved: true, released: true })
    expect((await readBack(p)).text).toBe(n.text)
    expect(p.holder_id).toBeNull()
    void w
  })

  it("why the stored-base one goes first: read the other way round, with the flight landing between, both are refused", async () => {
    const { p, w, run } = await onItsWay()
    const answers = await run(["fromFlight", "flight", "fromStored"])
    expect(accepted(answers)).toEqual([])
    expect((await readBack(p)).text).toBe(w.text)
    expect(p.holder_id).toBe(TAB)
  })
})

describe("a release-carrying save whose turn never comes", () => {
  afterEach(() => vi.useRealTimers())

  it(`is refused 429 busy after waiting ${RELEASE_TURN_WAIT_MS} ms, and releases nothing`, async () => {
    const p = heldProject()
    await saveWhole(p, { v: 1 })
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
    let hold!: () => void
    let entered!: () => void
    const inSave = new Promise<void>((resolve) => (entered = resolve))
    // The save below holds the user's turn until the test lets it go.
    db.beforeSave = () => {
      entered()
      return new Promise<void>((resolve) => (hold = resolve))
    }
    const running = putFile(p.id, envelope({ v: 2 }).gz, envelope({ v: 2 }).hash)
    await inSave
    const timers = vi.getTimerCount()
    const last = envelope({ v: 3 })
    const late = putFile(p.id, last.gz, last.hash, RELEASE)
    // Until it is waiting for the turn (its timer set).
    for (let i = 0; i < 200 && vi.getTimerCount() === timers; i += 1) await new Promise((resolve) => setImmediate(resolve))
    expect(vi.getTimerCount()).toBeGreaterThan(timers)
    await vi.advanceTimersByTimeAsync(RELEASE_TURN_WAIT_MS)
    const res = await late
    expect(res.statusCode).toBe(429)
    expect(res.json()).toEqual({ error: "busy" })
    hold()
    expect((await running).statusCode).toBe(200)
    expect(p.holder_id).toBe(TAB)
    expect(p.content_hash).toBe(envelope({ v: 2 }).hash)
    expect(calls()).not.toContain("editor_project_release")
  })
})

describe("an empty patch over the saved hash (a closing page's carrier for its version and release)", () => {
  it("never releases over a heavy request of the user's still running: it waits its turn, then finds that save landed", async () => {
    const p = heldProject()
    const e = await saveWhole(p, { v: 1 })
    let waiting: ReturnType<typeof patchFile> | null = null
    let plain: Awaited<ReturnType<typeof patchFile>> | null = null
    db.beforeSave = async () => {
      waiting = patchFile(p.id, [], e.hash, e.hash, RELEASE)
      // Without x-release, any save while another runs: busy.
      plain = await patchFile(p.id, [], e.hash, e.hash)
    }
    const next = envelope({ v: 2 })
    const res = await patchFile(p.id, jsonpatch.compare({ v: 1 }, { v: 2 }), e.hash, next.hash)
    // The running save stood; the empty patch over what it replaced is refused, and releases nothing.
    expect(res.json()).toEqual({ revision: 2, saved: true })
    expect((await waiting!).json()).toEqual({ error: "base_mismatch" })
    expect(plain!.json()).toEqual({ error: "busy" })
    expect(p.holder_id).toBe(TAB)
  })

  it("never reads the stored file: one missing from storage still answers and releases", async () => {
    const p = heldProject()
    const e = await saveWhole(p, { v: 1 })
    storage.objects.delete(p.blob_key!)
    const res = await patchFile(p.id, [], e.hash, e.hash, RELEASE)
    expect(res.json()).toEqual({ revision: 1, saved: false, released: true })
    expect(p.holder_id).toBeNull()
  })

  it("is not held to the upload policy (nothing new is stored)", async () => {
    const p = heldProject()
    const e = await saveWhole(p, { v: 1 })
    registerUploadPolicy({ id: "no", check: () => ({ allow: false }) })
    const res = await patchFile(p.id, [], e.hash, e.hash, RELEASE)
    expect(res.json()).toEqual({ revision: 1, saved: false, released: true })
  })

  it("over a hash not saved yet waits its turn like any save: answered once that save lands, refused base_mismatch otherwise", async () => {
    const p = heldProject()
    const base = await saveWhole(p, { v: 1 })
    const landing = envelope({ v: 2 })
    let waiting: ReturnType<typeof patchFile> | null = null
    db.beforeSave = async () => {
      // Sent while the save of v2 runs: it waits for the turn, and finds v2 saved.
      waiting = patchFile(p.id, [], landing.hash, landing.hash, RELEASE)
    }
    expect((await patchFile(p.id, jsonpatch.compare({ v: 1 }, { v: 2 }), base.hash, landing.hash)).json()).toEqual({ revision: 2, saved: true })
    expect((await waiting!).json()).toEqual({ revision: 2, saved: false, released: true })
    // Over a hash that the save it waits for does not land: refused once that save is done, releasing nothing.
    const p2 = heldProject()
    const base2 = await saveWhole(p2, { v: 1 })
    const other = envelope({ v: 8 })
    const never = envelope({ v: 9 })
    let refused: ReturnType<typeof patchFile> | null = null
    db.beforeSave = async () => {
      refused = patchFile(p2.id, [], never.hash, never.hash, RELEASE)
    }
    expect((await patchFile(p2.id, jsonpatch.compare({ v: 1 }, { v: 8 }), base2.hash, other.hash)).json()).toEqual({ revision: 2, saved: true })
    expect((await refused!).json()).toEqual({ error: "base_mismatch" })
    expect(p2.holder_id).toBe(TAB)
  })

  it("a patch that is not empty, or a base other than its hash, is any save", async () => {
    const p = heldProject()
    const e = await saveWhole(p, { v: 1 })
    expect((await patchFile(p.id, [{ op: "replace", path: "/v", value: 2 }], e.hash, e.hash)).json()).toEqual({ error: "hash_mismatch" })
    expect((await patchFile(p.id, [], e.hash, sha("other"))).json()).toEqual({ error: "hash_mismatch" })
  })
})

describe("the claim answer says a save may carry x-release", () => {
  it("POST /:id/claim answers release_on_save: true", async () => {
    const p = seedProject({ user_id: ME })
    expect((await json("POST", `/v1/editor-projects/${p.id}/claim`, { holder: TAB })).json()).toEqual({ held: true, release_on_save: true })
  })
})
