import { describe, expect, it, vi } from "vitest"
import Fastify from "fastify"

/**
 * The Video Remake settings sections (`NODARO_MOTION_SETTINGS_SECTIONS`,
 * admin-nodaro-motion.ts) are every setting the Admin → Video Remake page
 * edits: a stored settings set, an exported file and a loaded draft hold
 * exactly these, so a setting missing here would be silently left out of all
 * three.
 *
 * What must hold:
 *  - every PUT the Video Remake admin routes register saves a section, and
 *    every section is a PUT and a GET they register;
 *  - every other route they register is named below as not a setting (a new
 *    one has to be classified, never just left out);
 *  - each section's key is unique, and its stored form (`prepare`) is stable:
 *    what a set stores is what its route would store again (a sample per
 *    section — a new section must bring one).
 */
vi.mock("@/lib/supabase.js", () => ({
  supabase: {
    from: () => {
      throw new Error("no database in this test")
    },
  },
}))
vi.mock("@/lib/admin-check.js", () => ({ warmAdminCache: vi.fn(), checkIsAdmin: async () => true }))

const { adminNodaroMotionRoutes, NODARO_MOTION_SETTINGS_SECTIONS } = await import("../admin-nodaro-motion.js")

const PREFIX = "/v1/admin/video-remake/"

/** The routes under the prefix that save no setting, and why. */
const NOT_SETTINGS: Readonly<Record<string, string>> = {
  "POST /v1/admin/video-remake/prompt-parts/preview": "asks the engine for a sample prompt; writes nothing",
  "GET /v1/admin/video-remake/steps/defaults": "the engine's defaults for the steps editor",
  "POST /v1/admin/video-remake/steps/check": "asks the engine to check a steps draft; writes nothing",
  "GET /v1/admin/video-remake/custom-style/defaults": "the engine's defaults for the custom style's two steps",
  "POST /v1/admin/video-remake/custom-style/check": "asks the engine to check a custom style draft; writes nothing",
  "GET /v1/admin/video-remake/plan-roles/defaults": "the engine's defaults for the planning step of roles from the prompt",
  "POST /v1/admin/video-remake/plan-roles/check": "asks the engine to check a plan-roles draft; writes nothing",
  "GET /v1/admin/video-remake/flash-model": "a test switch, kept out of the stored sets: loading a set must never turn a test on",
  "PUT /v1/admin/video-remake/flash-model": "a test switch, kept out of the stored sets: loading a set must never turn a test on",
  "GET /v1/admin/video-remake/settings-sets": "the stored sets themselves",
  "POST /v1/admin/video-remake/settings-sets": "the stored sets themselves",
  "PUT /v1/admin/video-remake/settings-sets/:id": "the stored sets themselves",
  "DELETE /v1/admin/video-remake/settings-sets/:id": "the stored sets themselves",
  "POST /v1/admin/video-remake/settings-sets/:id/live": "the stored sets themselves",
  "POST /v1/admin/video-remake/settings-sets/check": "checks an imported file; writes nothing",
  "POST /v1/admin/video-remake/settings-sets/export": "writes the file of a set; writes nothing",
}

/** A body each section's route takes, away from its defaults where it has any. */
const SAMPLES: Readonly<Record<string, unknown>> = {
  masking: { masking: { "nodaro-prism": { mode: "auto" }, "nodaro-pulse": { mode: "always", fill: "none", faceMesh: true } } },
  motion: { motion: { "nodaro-prism": { promptStyle: "precise" } } },
  steps: { steps: {} },
  style: { style: { "nodaro-prism": "precise", "nodaro-pulse": "user" } },
  "prompt-wording": { promptWording: { "nodaro-prism": "new", "nodaro-pulse": "current" } },
  "pulse-audio": { pulseAudio: "generated" },
  "pulse-reference-audio": { pulseReferenceAudio: { "720p": { mode: "voice", semitones: 4 }, "1080p": { mode: "none" } } },
  "prism-reference-audio": { prismReferenceAudio: { "720p": "voice" } },
  "style-only": { styleOnly: {} },
  "precise-art-style": { preciseArtStyle: { "nodaro-prism": { opener: "edit" } } },
  "no-person": { noPerson: {} },
  "precise-style-route": { preciseStyleRoute: { routing: "off", bypassEmails: [" Tester@Example.com ", "tester@example.com"] } },
  "precise-upscale": { preciseUpscale: { "480p": "off", "720p": "4k", "1080p": "1080p" } },
  advanced: { show: true },
  "custom-style": { customStyle: { enabled: false, medium: { instructions: "Read the words.", model: " some-model " }, describe: { instructions: "  " } } },
  "plan-roles": { planRoles: { enabled: false, plan: { instructions: "Place each image.", model: " some-model " } } },
  previz: { previz: { enabled: false } },
  "shot-lock": { shotLock: { "nodaro-prism": "on", "nodaro-pulse": "off" } },
  "shot-list-fps": { shotListFps: { fps: 4 } },
  "prompt-parts": { promptParts: { "nodaro-prism": { precise: { face: "Keep the faces.", avoid: "" } } } },
}

async function registeredRoutes(): Promise<string[]> {
  const app = Fastify({ logger: false })
  const routes: string[] = []
  app.addHook("onRoute", (r) => {
    const methods = Array.isArray(r.method) ? r.method : [r.method]
    for (const m of methods) if (m !== "HEAD") routes.push(`${m} ${r.url}`)
  })
  await app.register(adminNodaroMotionRoutes)
  await app.ready()
  await app.close()
  return routes.filter((r) => r.split(" ")[1]!.startsWith(PREFIX))
}

describe("the Video Remake settings sections", () => {
  it("cover every PUT of the Video Remake admin routes, and each is a PUT and a GET they register", async () => {
    const routes = await registeredRoutes()
    const sectionRoutes = new Set(NODARO_MOTION_SETTINGS_SECTIONS.flatMap((s) => [`PUT ${s.path}`, `GET ${s.path}`]))
    const unclassified = routes.filter((r) => !sectionRoutes.has(r) && !Object.hasOwn(NOT_SETTINGS, r))
    // A route listed here saves (or reads) something the stored sets do not know: give it a section, or say why not.
    expect(unclassified).toEqual([])
    for (const r of sectionRoutes) expect(routes, `${r} is registered`).toContain(r)
    for (const r of Object.keys(NOT_SETTINGS)) expect(routes, `${r} is registered`).toContain(r)
  })

  it("have unique keys, and a sample each", () => {
    const keys = NODARO_MOTION_SETTINGS_SECTIONS.map((s) => s.key)
    expect(new Set(keys).size).toBe(keys.length)
    expect(Object.keys(SAMPLES).sort()).toEqual([...keys].sort())
  })

  it("store a body as their route would store it again", () => {
    for (const section of NODARO_MOTION_SETTINGS_SECTIONS) {
      const parsed = section.body.safeParse(SAMPLES[section.key])
      expect(parsed.success, `${section.key}: ${parsed.success ? "" : JSON.stringify(parsed.error.issues)}`).toBe(true)
      const once = section.prepare(parsed.data)
      expect("value" in once, section.key).toBe(true)
      const stored = (once as { value: unknown }).value
      const again = section.prepare(section.body.parse(JSON.parse(JSON.stringify(stored))))
      expect(again, section.key).toEqual({ value: stored })
    }
  })

  it("keep the accounts that skip the Precise art-style route out of an exported file", () => {
    const route = NODARO_MOTION_SETTINGS_SECTIONS.find((s) => s.key === "precise-style-route")!
    expect(route.privateFields).toEqual(["preciseStyleRoute.bypassEmails"])
    expect(NODARO_MOTION_SETTINGS_SECTIONS.filter((s) => (s.privateFields ?? []).length > 0).map((s) => s.key)).toEqual(["precise-style-route"])
  })
})
