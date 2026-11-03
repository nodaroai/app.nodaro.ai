import { beforeEach, describe, expect, it, vi } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

/**
 * `/v1/admin/nodaro-motion/motion` — the admin's Motion setting per Nodaro
 * Motion engine (direct runs with `style: "motion"`): its masking (a face
 * mask or full depth with its scene) and its prompt style. Admin-only; a save
 * is strict, written whole under the current keys, clears the settings cache
 * and leaves an `admin_actions` row. The stored row's read is tolerant.
 */
const h = vi.hoisted(() => ({
  row: null as { value: unknown; updated_at: string } | null,
  upserts: [] as unknown[],
  audits: [] as Record<string, unknown>[],
  admin: true,
  invalidated: 0,
  /** The recorded engine environments (`listEngineEnvironments`). */
  envs: [] as {
    env: string
    pluginBuildId: string | null
    supports: Record<string, unknown>
    updatedAt: string
    platformClaim?: { supports: Record<string, unknown>; at: string }
  }[],
}))

vi.mock("@/lib/supabase.js", () => ({
  supabase: {
    from: (table: string) => {
      if (table === "admin_actions") {
        return { insert: async (row: Record<string, unknown>) => (h.audits.push(row), { error: null }) }
      }
      if (table !== "app_settings") throw new Error(`unexpected table ${table}`)
      const chain = {
        select: () => chain,
        eq: (_c: string, key: string) => (expect(key).toBe("nodaro_motion_motion"), chain),
        maybeSingle: async () => ({ data: h.row, error: null }),
        upsert: async (row: { key: string; value: unknown; updated_at: string }, opts: unknown) => {
          expect(opts).toEqual({ onConflict: "key" })
          h.upserts.push(row)
          h.row = { value: row.value, updated_at: row.updated_at }
          return { error: null }
        },
      }
      return chain
    },
  },
}))
vi.mock("@/lib/app-settings.js", () => ({ invalidateSettingsCache: () => void h.invalidated++ }))
vi.mock("@/lib/admin-check.js", () => ({ warmAdminCache: vi.fn(), checkIsAdmin: async () => h.admin }))
vi.mock("../../lib/engine-environments.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/engine-environments.js")>()),
  listEngineEnvironments: async () => h.envs,
}))

/** When every engine record here was written: its boot, weeks ago (a claim's own time, not this, is what counts). */
const ENV_BOOT = "2026-10-20T00:00:00.000Z"
/**
 * An environment's row as `listEngineEnvironments` reads it: its engine's `castSwap` declaration, written at boot
 * (`ENV_BOOT`), and, from a platform that claims it, `platform` (what the app itself takes) claimed `claimedAt` (now
 * by default: a claim counts only while its own time is fresh).
 */
const envRow = (env: string, castSwap: Record<string, unknown>, platform?: Record<string, unknown>, claimedAt = new Date().toISOString()) => ({
  env,
  pluginBuildId: null,
  supports: { castSwap },
  updatedAt: ENV_BOOT,
  ...(platform ? { platformClaim: { supports: platform, at: claimedAt } } : {}),
})
/** A platform that takes Full depth's smallest face with mesh lines. */
const TAKES_MIN_FACE = { faceMeshMinFaceHeightPct: true }
const HIDES = { faceMaskTargets: ["face", "head", "body"], faceMaskHideTargets: ["face", "head", "body"] }

const { adminNodaroMotionRoutes } = await import("../admin-nodaro-motion.js")
const { NODARO_MOTION_MOTION_AUDIT_TARGET } = await import("../admin-nodaro-motion-motion.js")
const { NODARO_MOTION_MASKING_AUDIT_TARGET } = await import("../admin-nodaro-motion.js")
const { NODARO_MOTION_PROMPT_PARTS_AUDIT_TARGET } = await import("../admin-nodaro-motion-prompt-parts.js")
const { directRunPromptShape, parseNodaroMotionMotion, withEarlierMotionKeys } = await import("../../../lib/nodaro-motion-motion.js")

let app: FastifyInstance

beforeEach(async () => {
  h.row = null
  h.upserts = []
  h.audits = []
  h.admin = true
  h.invalidated = 0
  h.envs = [envRow("production", HIDES), envRow("staging", HIDES)]
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    if (req.headers["x-user"]) req.userId = String(req.headers["x-user"])
  })
  await app.register(adminNodaroMotionRoutes)
  await app.ready()
})

const as = { "x-user": "00000000-0000-4000-8000-0000000000ad" }
const URL = "/v1/admin/nodaro-motion/motion"
const ENGINES = [
  { id: "motion-prism", name: "Nodaro Motion Prism", internal: "seedance-2-5" },
  { id: "motion-pulse", name: "Nodaro Motion Pulse", internal: "kling-4" },
]
const MOTION = {
  "motion-prism": { masking: { mode: "always", source: "full-depth", scene: "original" }, promptStyle: "flexible" },
  "motion-pulse": { promptStyle: "precise" },
}
const put = (motion: unknown, headers: Record<string, string> = as) => app.inject({ method: "PUT", url: URL, headers, payload: { motion } })

describe("GET /v1/admin/nodaro-motion/motion", () => {
  it("is admin-only", async () => {
    expect((await app.inject({ method: "GET", url: URL })).statusCode).toBe(401)
    h.admin = false
    expect((await app.inject({ method: "GET", url: URL, headers: as })).statusCode).toBe(403)
  })

  it("answers null until it is saved, with the engines and the prompt styles", async () => {
    const res = await app.inject({ method: "GET", url: URL, headers: as })
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toEqual({ motion: null, updatedAt: null, engines: ENGINES, promptStyles: ["precise", "flexible"], supports: {} })
  })

  it("answers the stored setting: an earlier engine id read as the current one, an invalid entry left out", async () => {
    h.row = { value: { "motion-pro": { promptStyle: "precise" }, "motion-pulse": { masking: { mode: "always", source: "keep-people" } } }, updated_at: "2026-10-27T10:00:00.000Z" }
    const res = await app.inject({ method: "GET", url: URL, headers: as })
    expect(res.json().data.motion).toEqual({ "motion-prism": { promptStyle: "precise" } })
  })
})

describe("PUT /v1/admin/nodaro-motion/motion", () => {
  it("is admin-only, and writes nothing for a non-admin", async () => {
    h.admin = false
    expect((await put(MOTION)).statusCode).toBe(403)
    expect(h.upserts).toEqual([])
  })

  it("saves the whole setting under the current keys, clears the cache and audits before and after", async () => {
    h.row = { value: { "motion-pulse": { promptStyle: "flexible" } }, updated_at: "2026-10-24T10:00:00.000Z" }
    const res = await put(MOTION)
    expect(res.statusCode).toBe(200)
    expect(h.upserts).toEqual([{ key: "nodaro_motion_motion", value: MOTION, updated_at: expect.any(String), updated_by: as["x-user"] }])
    expect(h.invalidated).toBe(1)
    expect(res.json().data).toMatchObject({ motion: MOTION, engines: ENGINES })
    expect(h.audits).toEqual([
      {
        admin_user_id: as["x-user"],
        action: "update_nodaro_motion_motion",
        target_type: "app_setting",
        target_id: NODARO_MOTION_MOTION_AUDIT_TARGET,
        payload: { key: "nodaro_motion_motion", before: { "motion-pulse": { promptStyle: "flexible" } }, after: MOTION },
      },
    ])
  })

  it("files its audit rows under an id of its own", () => {
    expect(new Set([NODARO_MOTION_MOTION_AUDIT_TARGET, NODARO_MOTION_MASKING_AUDIT_TARGET, NODARO_MOTION_PROMPT_PARTS_AUDIT_TARGET]).size).toBe(3)
  })

  it("takes one engine alone, or none (every engine on the defaults)", async () => {
    for (const m of [{ "motion-pulse": { masking: { mode: "auto", target: "face" } } }, { "motion-prism": {} }, {}]) {
      expect((await put(m)).statusCode, JSON.stringify(m)).toBe(200)
    }
  })

  it("takes a masking that hides whole people only while every environment's engine can (the row is shared)", async () => {
    const motion = { "motion-prism": { masking: { mode: "always", target: "body" } } }
    expect((await app.inject({ method: "PUT", url: URL, headers: as, payload: { motion } })).statusCode).toBe(200)
    h.envs = [envRow("production", { faceMaskTargets: ["face", "head", "body"] }), envRow("staging", HIDES)]
    const res = await app.inject({ method: "PUT", url: URL, headers: as, payload: { motion } })
    expect(res.statusCode).toBe(409)
    expect(res.json().error).toMatchObject({ code: "engine_unsupported", envs: ["production"] })
    expect(h.upserts).toHaveLength(1)
  })

  it("takes a masking that draws the face mesh (faces or full depth) only while every environment's engine draws it", async () => {
    const MESH = { ...HIDES, faceMesh: true }
    h.envs = [envRow("production", MESH), envRow("staging", MESH)]
    const motion = {
      "motion-prism": { masking: { mode: "always", source: "full-depth", faceMesh: true } },
      "motion-pulse": { masking: { mode: "auto", faceMesh: true } },
    }
    expect((await app.inject({ method: "PUT", url: URL, headers: as, payload: { motion } })).statusCode).toBe(200)
    h.envs = [envRow("production", MESH), envRow("staging", HIDES)]
    const res = await app.inject({ method: "PUT", url: URL, headers: as, payload: { motion } })
    expect(res.statusCode).toBe(409)
    expect(res.json().error).toMatchObject({ code: "engine_unsupported", envs: ["staging"], message: expect.stringMatching(/cannot draw the face mesh/) })
    expect(h.upserts).toHaveLength(1)
  })

  it("takes a masking that names a depth colormap only while every environment's engine draws that map", async () => {
    const MAPS = { ...HIDES, depthColormaps: ["grayscale", "turbo", "inferno", "magma", "viridis"] }
    h.envs = [envRow("production", MAPS), envRow("staging", MAPS)]
    const motion = {
      "motion-prism": { masking: { mode: "always", source: "full-depth", depthColormap: "inferno" } },
      "motion-pulse": { masking: { mode: "always", fill: "depth", depthColormap: "viridis" } },
    }
    expect((await app.inject({ method: "PUT", url: URL, headers: as, payload: { motion } })).statusCode).toBe(200)
    h.envs = [envRow("production", MAPS), envRow("staging", { ...HIDES, depthColormaps: ["inferno"] })]
    const res = await app.inject({ method: "PUT", url: URL, headers: as, payload: { motion } })
    expect(res.statusCode).toBe(409)
    expect(res.json().error).toMatchObject({ code: "engine_unsupported", envs: ["staging"], message: expect.stringMatching(/cannot draw the depth in inferno or viridis/) })
    expect(h.upserts).toHaveLength(1)
    // A colormap that changes nothing drawn (the source's default, a blur fill) asks no engine.
    h.envs = []
    const same = { "motion-prism": { masking: { mode: "always", source: "full-depth", depthColormap: "grayscale" } }, "motion-pulse": { masking: { mode: "always", depthColormap: "magma" } } }
    expect((await app.inject({ method: "PUT", url: URL, headers: as, payload: { motion: same } })).statusCode).toBe(200)
  })

  it("takes a Full depth's depth blur only while every environment's engine blurs (a Cast Swap engine from 0.430.0); 0 asks no engine", async () => {
    const BLURS = { ...HIDES, depthBlur: true }
    h.envs = [envRow("production", BLURS), envRow("staging", BLURS)]
    const motion = { "motion-prism": { masking: { mode: "always", source: "full-depth", depthBlur: 28 } } }
    expect((await app.inject({ method: "PUT", url: URL, headers: as, payload: { motion } })).statusCode).toBe(200)
    expect(h.upserts.at(-1)).toMatchObject({ value: { "motion-prism": { masking: { depthBlur: 28 } } } })
    h.envs = [envRow("production", BLURS), envRow("staging", HIDES)]
    const res = await app.inject({ method: "PUT", url: URL, headers: as, payload: { motion } })
    expect(res.statusCode).toBe(409)
    expect(res.json().error).toMatchObject({ code: "engine_unsupported", envs: ["staging"], message: expect.stringMatching(/cannot blur the depth map/) })
    expect(h.upserts).toHaveLength(1)
    // 0 (off) asks no engine.
    h.envs = []
    expect((await put({ "motion-prism": { masking: { mode: "always", source: "full-depth", depthBlur: 0 } } })).statusCode).toBe(200)
  })

  it("takes face mesh parts other than the full mesh only while every environment's engine lists them; the full mesh asks no engine", async () => {
    const PARTS = { ...HIDES, faceMesh: true, faceMeshParts: ["full", "features", "mouth"] }
    h.envs = [envRow("production", PARTS), envRow("staging", PARTS)]
    const motion = {
      "motion-prism": { masking: { mode: "always", source: "full-depth", faceMesh: true, faceMeshParts: "features" } },
      "motion-pulse": { masking: { mode: "always", source: "full-depth", faceMesh: true, faceMeshParts: "mouth" } },
    }
    expect((await app.inject({ method: "PUT", url: URL, headers: as, payload: { motion } })).statusCode).toBe(200)
    h.envs = [envRow("production", { ...PARTS, faceMeshParts: ["full", "features"] }), envRow("staging", PARTS)]
    const res = await app.inject({ method: "PUT", url: URL, headers: as, payload: { motion } })
    expect(res.statusCode).toBe(409)
    expect(res.json().error).toMatchObject({ code: "engine_unsupported", envs: ["production"], message: expect.stringMatching(/cannot draw only the eyes and mouth or only the mouth of the face mesh/) })
    expect(h.upserts).toHaveLength(1)
    // The full mesh asks only for the mesh itself.
    h.envs = [envRow("production", { ...HIDES, faceMesh: true }), envRow("staging", { ...HIDES, faceMesh: true })]
    expect((await put({ "motion-prism": { masking: { mode: "always", source: "full-depth", faceMesh: true, faceMeshParts: "full" } } })).statusCode).toBe(200)
  })

  it("takes Full depth's smallest face with mesh lines only while every environment's engine declares it; none set asks no engine", async () => {
    const MIN = { ...HIDES, faceMesh: true, faceMeshMinFaceHeightPct: true }
    // Every environment's platform takes it (the hold below), so only the engines decide here.
    h.envs = [envRow("production", MIN, TAKES_MIN_FACE), envRow("staging", MIN, TAKES_MIN_FACE)]
    const motion = { "motion-prism": { masking: { mode: "always", source: "full-depth", faceMesh: true, faceMeshMinFaceHeightPct: 20 } } }
    expect((await put(motion)).statusCode).toBe(200)
    expect(h.upserts.at(-1)).toMatchObject({ value: { "motion-prism": { masking: { faceMeshMinFaceHeightPct: 20 } } } })
    h.envs = [envRow("production", MIN, TAKES_MIN_FACE), envRow("staging", { ...HIDES, faceMesh: true }, TAKES_MIN_FACE)]
    const res = await put(motion)
    expect(res.statusCode).toBe(409)
    expect(res.json().error).toMatchObject({ code: "engine_unsupported", envs: ["staging"], message: expect.stringMatching(/cannot set the smallest face with mesh lines/) })
    // 0 (no size minimum) is a value set too.
    expect((await put({ "motion-pulse": { masking: { mode: "always", source: "full-depth", faceMesh: true, faceMeshMinFaceHeightPct: 0 } } })).statusCode).toBe(409)
    expect(h.upserts).toHaveLength(1)
    // Left out it asks for the face mesh alone, whatever the platforms say.
    h.envs = [envRow("production", { ...HIDES, faceMesh: true }), envRow("staging", { ...HIDES, faceMesh: true })]
    expect((await put({ "motion-prism": { masking: { mode: "always", source: "full-depth", faceMesh: true } } })).statusCode).toBe(200)
    // With the face mesh off it draws nothing and asks no engine, but an older platform would still refuse the key:
    // held while one has not said it takes it (none recorded here).
    h.envs = []
    const unread = await put({ "motion-prism": { masking: { mode: "always", source: "full-depth", faceMeshMinFaceHeightPct: 20 } } })
    expect(unread.statusCode).toBe(422)
    expect(unread.json().error).toMatchObject({ code: "platform_unsupported", envs: ["staging", "production"] })
  })

  it("holds a value while any environment's platform does not take it (one shared database), naming it; never an absent one", async () => {
    const MIN = { ...HIDES, faceMesh: true, faceMeshMinFaceHeightPct: true }
    const motion = { "motion-prism": { masking: { mode: "always", source: "full-depth", faceMesh: true, faceMeshMinFaceHeightPct: 20 } } }
    // Production's engine declares it, but its platform is older (claims nothing): production would drop the entry.
    h.envs = [envRow("production", MIN), envRow("staging", MIN, TAKES_MIN_FACE)]
    const held = await put(motion)
    expect(held.statusCode).toBe(422)
    expect(held.json().error).toEqual({
      code: "platform_unsupported",
      envs: ["production"],
      message:
        "The platform in production does not take the smallest face with mesh lines yet, and this setting is shared by every environment: empty it, or wait until production is updated.",
    })
    expect(h.upserts).toEqual([])
    // Held before the engines are asked: a platform hold wins over an engine gap.
    h.envs = [envRow("production", { ...HIDES, faceMesh: true }), envRow("staging", MIN, TAKES_MIN_FACE)]
    expect((await put(motion)).json().error.code).toBe("platform_unsupported")
    // An absent field is never held, whatever the platforms record.
    h.envs = [envRow("production", MIN), envRow("staging", MIN)]
    expect((await put({ "motion-prism": { masking: { mode: "always", source: "full-depth", faceMesh: true }, promptStyle: "precise" } })).statusCode).toBe(200)
    // Once every platform takes it, it is saved.
    h.envs = [envRow("production", MIN, TAKES_MIN_FACE), envRow("staging", MIN, TAKES_MIN_FACE)]
    expect((await put(motion)).statusCode).toBe(200)
    expect(h.upserts.at(-1)).toMatchObject({ value: motion })
  })

  it("a stale platform claim is no claim: held as if that platform never took it (its heartbeat stopped)", async () => {
    const MIN = { ...HIDES, faceMesh: true, faceMeshMinFaceHeightPct: true }
    const motion = { "motion-prism": { masking: { mode: "always", source: "full-depth", faceMesh: true, faceMeshMinFaceHeightPct: 20 } } }
    // Production said so 20 minutes ago and has not since (a failed deploy, a crash, a rollback to a build without the heartbeat).
    const stale = new Date(Date.now() - 20 * 60_000).toISOString()
    h.envs = [envRow("production", MIN, TAKES_MIN_FACE, stale), envRow("staging", MIN, TAKES_MIN_FACE)]
    const held = await put(motion)
    expect(held.statusCode).toBe(422)
    expect(held.json().error).toMatchObject({ code: "platform_unsupported", envs: ["production"] })
    expect(h.upserts).toEqual([])
    // A boot a minute ago (its engine record new) does not freshen that claim: held still.
    h.envs = [{ ...envRow("production", MIN, TAKES_MIN_FACE, stale), updatedAt: new Date(Date.now() - 60_000).toISOString() }, envRow("staging", MIN, TAKES_MIN_FACE)]
    expect((await put(motion)).json().error).toMatchObject({ code: "platform_unsupported", envs: ["production"] })
    expect(h.upserts).toEqual([])
    // Said again since (fresh), its engine record as old as ever: saved.
    h.envs = [envRow("production", MIN, TAKES_MIN_FACE, new Date(Date.now() - 4 * 60_000).toISOString()), envRow("staging", MIN, TAKES_MIN_FACE)]
    expect((await put(motion)).statusCode).toBe(200)
  })

  it("a setting saved before stays readable while a platform does not take it", async () => {
    const stored = { "motion-prism": { masking: { mode: "always", source: "full-depth", faceMesh: true, faceMeshMinFaceHeightPct: 20 } } }
    h.row = { value: stored, updated_at: "2026-11-03T10:00:00.000Z" }
    h.envs = [envRow("production", HIDES), envRow("staging", HIDES)]
    const res = await app.inject({ method: "GET", url: URL, headers: as })
    expect(res.statusCode).toBe(200)
    expect(res.json().data.motion).toEqual(stored)
  })

  it("refuses the smallest face with mesh lines outside 0–100, or anywhere but Full depth, writing nothing", async () => {
    const MIN = { ...HIDES, faceMesh: true, faceMeshMinFaceHeightPct: true }
    h.envs = [envRow("production", MIN, TAKES_MIN_FACE), envRow("staging", MIN, TAKES_MIN_FACE)]
    for (const masking of [
      { mode: "always", source: "full-depth", faceMesh: true, faceMeshMinFaceHeightPct: 101 },
      { mode: "always", source: "full-depth", faceMesh: true, faceMeshMinFaceHeightPct: -1 },
      { mode: "always", source: "full-depth", faceMesh: true, faceMeshMinFaceHeightPct: "20" },
      { mode: "always", faceMesh: true, faceMeshMinFaceHeightPct: 20 },
    ]) {
      const res = await put({ "motion-prism": { masking } })
      expect(res.statusCode, JSON.stringify(masking)).toBe(400)
    }
    expect(h.upserts).toEqual([])
  })

  it("refuses the fill none and a depth fill's blur on Faces hidden (the Precise setting's alone), writing nothing", async () => {
    h.envs = [envRow("production", { ...HIDES, faceMesh: true, maskFillNone: true, depthFillBlur: true }), envRow("staging", { ...HIDES, faceMesh: true, maskFillNone: true, depthFillBlur: true })]
    const none = await put({ "motion-pulse": { masking: { mode: "auto", fill: "none", faceMesh: true } } })
    expect(none.statusCode).toBe(400)
    expect(none.json().error).toMatchObject({ code: "validation_error", message: expect.stringMatching(/^motion\.motion-pulse\.masking\.fill: The fill "none" .* is the Precise setting's alone/) })
    const blur = await put({ "motion-prism": { masking: { mode: "always", fill: "depth", depthBlur: 12 } } })
    expect(blur.statusCode).toBe(400)
    expect(blur.json().error).toMatchObject({ code: "validation_error", message: expect.stringMatching(/depthBlur: A blur on the depth fill is the Precise setting's alone/) })
    expect(h.upserts).toEqual([])
    // Not refused where nothing is read: a blur of 0 on a depth fill, a "none" left under Full depth, a Full depth blur.
    for (const masking of [
      { mode: "always", fill: "depth", depthBlur: 0 },
      { mode: "always", source: "full-depth", fill: "none" },
      { mode: "always", fill: "blur", depthBlur: 12 },
    ]) {
      expect((await put({ "motion-prism": { masking } })).statusCode, JSON.stringify(masking)).toBe(200)
    }
  })

  it("refuses a depth blur past 40, below 0 or not whole, and an unknown part, writing nothing", async () => {
    for (const masking of [
      { mode: "always", source: "full-depth", depthBlur: 41 },
      { mode: "always", source: "full-depth", depthBlur: -1 },
      { mode: "always", source: "full-depth", depthBlur: 28.5 },
      { mode: "always", source: "full-depth", faceMesh: true, faceMeshParts: "eyes" },
    ]) {
      const res = await put({ "motion-prism": { masking } })
      expect(res.statusCode, JSON.stringify(masking)).toBe(400)
    }
    expect(h.upserts).toEqual([])
  })

  it("takes a masking that names a depth model size only while every environment's engine draws with that size", async () => {
    const SIZES = { ...HIDES, depthModelSizes: ["small", "base", "large"] }
    h.envs = [envRow("production", SIZES), envRow("staging", SIZES)]
    const motion = {
      "motion-prism": { masking: { mode: "always", source: "full-depth", depthModelSize: "small" } },
      "motion-pulse": { masking: { mode: "always", fill: "depth", depthModelSize: "base" } },
    }
    expect((await app.inject({ method: "PUT", url: URL, headers: as, payload: { motion } })).statusCode).toBe(200)
    h.envs = [envRow("production", SIZES), envRow("staging", { ...HIDES, depthModelSizes: ["small"] })]
    const res = await app.inject({ method: "PUT", url: URL, headers: as, payload: { motion } })
    expect(res.statusCode).toBe(409)
    expect(res.json().error).toMatchObject({ code: "engine_unsupported", envs: ["staging"], message: expect.stringMatching(/small or base depth model/) })
    expect(h.upserts).toHaveLength(1)
    // A size that changes no render (large, a blur fill) asks no engine.
    h.envs = []
    const same = { "motion-prism": { masking: { mode: "always", source: "full-depth", depthModelSize: "large" } }, "motion-pulse": { masking: { mode: "always", depthModelSize: "small" } } }
    expect((await app.inject({ method: "PUT", url: URL, headers: as, payload: { motion: same } })).statusCode).toBe(200)
  })

  it("takes Full depth's description + original scene only while every environment's engine lists it", async () => {
    const BOTH = { ...HIDES, fullDepthScenes: ["description", "original", "none", "description-and-original"] }
    const motion = { "motion-pulse": { masking: { mode: "always", source: "full-depth", scene: "description-and-original" } } }
    h.envs = [envRow("production", HIDES), envRow("staging", BOTH)]
    const res = await app.inject({ method: "PUT", url: URL, headers: as, payload: { motion } })
    expect(res.statusCode).toBe(409)
    expect(res.json().error).toMatchObject({ code: "engine_unsupported", envs: ["production"], message: expect.stringMatching(/description-and-original/) })
    expect(h.upserts).toHaveLength(0)
    // The scenes from before it save whatever the environments list (as they always did).
    expect((await put({ "motion-pulse": { masking: { mode: "always", source: "full-depth", scene: "original" } } })).statusCode).toBe(200)
    h.envs = [envRow("production", BOTH), envRow("staging", BOTH)]
    expect((await app.inject({ method: "PUT", url: URL, headers: as, payload: { motion } })).statusCode).toBe(200)
  })

  it("refuses what a Motion run cannot take, writing nothing", async () => {
    for (const bad of [
      // Keep people is a trend's alone.
      { "motion-prism": { masking: { mode: "always", source: "keep-people" } } },
      // Full depth is made once per run in mode "always".
      { "motion-prism": { masking: { mode: "auto", source: "full-depth" } } },
      // A scene is full depth's alone.
      { "motion-prism": { masking: { mode: "always", scene: "none" } } },
      { "motion-prism": { masking: { mode: "always", source: "full-depth", scene: "video" } } },
      // Marks are a trend's stored mask's alone.
      { "motion-prism": { masking: { mode: "always", marks: [] } } },
      { "motion-prism": { promptStyle: "motion" } },
      { "motion-prism": { style: "flexible" } },
      { "motion-pro": { promptStyle: "precise" } },
    ]) {
      const res = await put(bad)
      expect(res.statusCode, JSON.stringify(bad)).toBe(400)
      expect(res.json().error.code).toBe("validation_error")
    }
    expect(h.upserts).toEqual([])
    expect(h.audits).toEqual([])
  })
})

describe("the setting, as the engine reads it", () => {
  it("answers each entry under its current and its earlier key (a copy)", () => {
    const got = withEarlierMotionKeys(structuredClone(MOTION) as never)
    expect(got).toEqual({ ...MOTION, "motion-pro": MOTION["motion-prism"], "motion-lite": MOTION["motion-pulse"] })
    got["motion-prism"]!.promptStyle = "precise"
    expect(got["motion-pro"]!.promptStyle).toBe("flexible")
  })

  it("reads a value that is not an object as never saved", () => {
    expect(parseNodaroMotionMotion("x", () => {})).toBeNull()
    expect(parseNodaroMotionMotion(null, () => {})).toBeNull()
  })

  it("a direct run's prompt shape: Precise on a face mask; Motion as saved, else the Flexible prompt on a face mask", () => {
    expect(directRunPromptShape("precise", { promptStyle: "flexible", masking: { mode: "always", source: "full-depth" } })).toEqual({ promptStyle: "precise", source: "faces" })
    expect(directRunPromptShape("motion", undefined)).toEqual({ promptStyle: "flexible", source: "faces" })
    expect(directRunPromptShape("motion", { masking: { mode: "auto" } })).toEqual({ promptStyle: "flexible", source: "faces" })
    expect(directRunPromptShape("motion", { masking: { mode: "always", source: "full-depth" }, promptStyle: "precise" })).toEqual({
      promptStyle: "precise",
      source: "full-depth",
      scene: "description",
    })
  })
})
