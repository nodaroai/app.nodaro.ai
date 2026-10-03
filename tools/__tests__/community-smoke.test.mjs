/**
 * Structure tests for the Scene3D half of `tools/community-smoke.mjs`.
 *
 * The probe itself only ever runs against a booted stack (community-e2e boots
 * six containers for it), so nothing checked that its ASSERTIONS are the ones
 * we think they are. A check that reads a field the server never sends, or
 * compares a substring where the contract says "exactly this code", passes on a
 * healthy install and keeps passing through the regression it exists to catch.
 *
 * So: stand up a stub that answers the shapes a keyless community install
 * answers, run the real probe against it, and assert the four Scene3D contracts
 * report PASS — then break ONE thing at a time in the ways the platform could
 * plausibly break it (the node advertised again, the Basic lane dropped with
 * it, a Pro run served by another lane, a capabilities document that claims an
 * engine) and assert the matching contract goes FAIL.
 *
 * Scope on purpose: this file asserts the Scene3D and Video Overlay contracts
 * only. The stub is faithful enough for the probe to reach them, not a second
 * implementation of the platform — the other contracts are asserted against
 * the real image by `.github/workflows/community-e2e.yml`.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { createServer } from "node:http"
import { spawn } from "node:child_process"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const PROBE = resolve(dirname(fileURLToPath(import.meta.url)), "../community-smoke.mjs")

/** The four contract names, spelled exactly as the probe records them. */
const DISCOVERY = "discovery omits 3D Render Pro where no engine can run it"
const BASIC = "the Basic 3D scene nodes stay available on community"
const REFUSAL = "a 3D Render Pro run is refused 503 SCENE_CAPABILITY_UNAVAILABLE, never a Basic fallback"
const CAPABILITIES = "the 3D capabilities document reports Pro unavailable and no authoring engine"

/** The three Video Overlay contract names, spelled exactly as the probe records them. */
const OVERLAY_RENDER = "Video Overlay renders on a keyless install — no key, no credits"
const OVERLAY_REFUSAL = "Video Overlay refuses end ≤ start with a renderable 400"
const OVERLAY_UNREACHABLE = "a Video Overlay job whose image cannot be fetched fails with a renderable message"

/** What a keyless community install answers. Each test overrides one slice. */
function communityShape() {
  return {
    nodes: [
      { type: "generate-image", label: "Generate Image", category: "media", description: "d", outputType: "image" },
      { type: "generate-3d-scene", label: "Generate 3D Scene", category: "composition", description: "d", outputType: "data" },
      { type: "edit-3d-scene", label: "Edit 3D Scene", category: "composition", description: "d", outputType: "data" },
    ],
    // type -> { status, body }. Anything not listed answers 404 not_found.
    describe: {
      "generate-3d-scene": { status: 200, body: { data: { type: "generate-3d-scene", label: "Generate 3D Scene" } } },
      "edit-3d-scene": { status: 200, body: { data: { type: "edit-3d-scene", label: "Edit 3D Scene" } } },
    },
    capabilities: {
      basic: { available: true, sceneSchemaVersions: [1] },
      advanced: null,
      pro: {
        available: false,
        engines: ["blender-cloud"],
        qualityProfiles: ["standard"],
        styles: ["clay"],
        aspectRatios: ["16:9", "9:16", "1:1", "4:5", "21:9"],
        maxRepairPasses: 2,
      },
    },
    proRun: {
      status: 503,
      body: { error: { code: "SCENE_CAPABILITY_UNAVAILABLE", message: "3D Render Pro is unavailable on this instance." } },
    },
    proQuote: {
      status: 503,
      body: { error: { code: "SCENE_CAPABILITY_UNAVAILABLE", message: "3D Render Pro is unavailable on this instance." } },
    },
    // Video Overlay — the local ffmpeg lane. The stub routes a POST by its
    // body: end <= start → `refusal`, an image on `.invalid` → `unreachable`,
    // anything else → `accept`. Job ids key `jobs`; a relative result URL is
    // served by the stub itself.
    overlay: {
      accept: { status: 200, body: { jobId: "job_overlay" } },
      unreachable: { status: 200, body: { jobId: "job_overlay_unreachable" } },
      refusal: {
        status: 400,
        body: { error: { code: "validation_error", message: "layers[0]: end (2 s) must be after start (3 s)" } },
      },
      jobs: {
        job_overlay: {
          status: "completed",
          output_data: { videoUrl: "/media/overlay.mp4", width: 1280, height: 720, durationSec: 5.08, warnings: [] },
        },
        job_overlay_unreachable: { status: "failed", error_message: "layers[0]: image could not be fetched" },
      },
      media: { status: 200, type: "video/mp4", bytes: 4096 },
    },
  }
}

/**
 * A keyless community install, in as much detail as the probe reads.
 *
 * The two checks the probe marks `required` (setup/status and signup) must
 * answer honestly or every later check records "skip" instead of running —
 * which would make this whole file green for the wrong reason. The assertions
 * below demand PASS, never "not FAIL", so that failure mode is caught.
 */
function stubServer(shape) {
  const state = { hasUsers: false, heygenKey: false }
  const keylessMessage = "Add a KIE_API_KEY on /setup, or connect to nodaro.ai, to generate images."

  const server = createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1")
    const path = url.pathname
    const send = (status, body, type = "application/json") => {
      res.writeHead(status, { "content-type": type })
      res.end(typeof body === "string" ? body : JSON.stringify(body))
    }
    const setupStatus = () => ({
      edition: "community",
      hasUsers: state.hasUsers,
      checks: {
        database: { ok: true },
        redis: { ok: true },
        storage: { ok: true },
        encryption: { ok: true },
        providers: { ok: false, nodaroCloud: false, keys: { heygen: state.heygenKey }, sources: { heygen: state.heygenKey ? "app" : null } },
      },
    })

    // Collect the body — only the Video Overlay route reads it.
    let raw = ""
    req.setEncoding("latin1")
    req.on("data", (chunk) => { raw += chunk })
    req.on("end", () => {
      if (path === "/v1/setup/status") return send(200, setupStatus())
      if (path === "/config.js") return send(200, 'window.__NODARO_RUNTIME__ = {"apiUrl":"http://127.0.0.1"};\n', "text/javascript")
      if (path === "/supabase/auth/v1/signup") {
        state.hasUsers = true
        return send(200, { access_token: "stub-session-token", user: { id: "u_1" } })
      }
      if (path === "/v1/workflows" && req.method === "POST") return send(201, { id: "wf_1" })
      if (path === "/v1/generate-image") return send(200, { jobId: "job_image" })
      if (path === "/v1/text-to-dialogue") return send(200, { jobId: "job_dialogue" })
      if (/^\/v1\/jobs\/[^/]+\/status$/.test(path)) {
        const jobId = decodeURIComponent(path.split("/")[3])
        const overlayJob = shape.overlay.jobs[jobId]
        if (overlayJob) {
          const out = overlayJob.output_data
          const videoUrl = out?.videoUrl ? new URL(out.videoUrl, `http://${req.headers.host}`).href : undefined
          return send(200, { data: { ...overlayJob, ...(out ? { output_data: { ...out, videoUrl } } : {}) } })
        }
        return send(200, { data: { status: "failed", error_message: keylessMessage } })
      }
      if (path === "/v1/voices") {
        return send(200, {
          voices: [{ id: "rachel", name: "Rachel" }],
          keyMissing: true,
          hint: "Add an ELEVENLABS_API_KEY on /setup to load your own voices.",
        })
      }
      if (path === "/v1/ai-writer/generate") {
        return send(503, { error: { code: "provider_unavailable", message: "No LLM provider is configured. Add an API key on /setup." } })
      }
      if (path === "/v1/nodaro-connect/start") {
        return send(503, { error: { code: "cloud_unreachable", message: "Could not reach nodaro.ai. Check the network, or add a provider API key." } })
      }
      if (path === "/v1/tutorials") return send(200, { categories: [{ name: "Basics", flows: [{ id: "t_1", name: "First render" }] }] })
      if (path === "/v1/setup/provider-keys" && req.method === "GET") {
        return send(200, { providers: [{ id: "heygen", set: state.heygenKey, source: state.heygenKey ? "app" : null }] })
      }
      if (path.startsWith("/v1/setup/provider-keys/")) {
        if (req.method === "PUT") {
          state.heygenKey = true
          return send(200, { set: true, source: "app" })
        }
        if (req.method === "DELETE") {
          state.heygenKey = false
          return send(200, { set: false })
        }
      }
      if (path === "/v1/billing/surface") return send(200, { data: { providerId: "none", mountCostTab: false } })

      // ── Video Overlay ─────────────────────────────────────────────────────
      if (path === "/v1/upload" && req.method === "POST") {
        const kind = raw.includes("video/mp4") ? "videos/base.mp4" : "images/card.jpg"
        return send(200, { data: { url: `http://${req.headers.host}/storage/uploads/${kind}`, assetId: "a_1" } })
      }
      if (path === "/v1/video-overlay" && req.method === "POST") {
        let body = {}
        try { body = JSON.parse(raw) } catch { /* not JSON — answered as accept */ }
        const layers = Array.isArray(body.layers) ? body.layers : []
        const pick = layers.some((l) => typeof l.end === "number" && l.end <= l.start)
          ? shape.overlay.refusal
          : layers.some((l) => String(l.imageUrl ?? "").includes(".invalid/"))
            ? shape.overlay.unreachable
            : shape.overlay.accept
        return send(pick.status, pick.body)
      }
      if (path === "/media/overlay.mp4") {
        res.writeHead(shape.overlay.media.status, { "content-type": shape.overlay.media.type })
        return res.end(Buffer.alloc(shape.overlay.media.bytes))
      }

      // ── the Scene3D slice ─────────────────────────────────────────────────
      if (path === "/v1/nodes") return send(200, { data: shape.nodes })
      if (path.startsWith("/v1/nodes/")) {
        const type = decodeURIComponent(path.slice("/v1/nodes/".length))
        const hit = shape.describe[type]
        if (hit) return send(hit.status, hit.body)
        return send(404, { error: { code: "not_found", message: `Node type not found: ${type}` } })
      }
      if (path === "/v1/3d-scene/capabilities") return send(200, shape.capabilities)
      if (path === "/v1/pro-3d-render/quote") return send(shape.proQuote.status, shape.proQuote.body)
      if (path === "/v1/pro-3d-render") return send(shape.proRun.status, shape.proRun.body)

      // Everything else — including the ee billing routes the probe expects to
      // be absent on this edition.
      return send(404, { error: { code: "not_found", message: "not found" } })
    })
  })

  return new Promise((ready) => {
    server.listen(0, "127.0.0.1", () => {
      ready({ url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((done) => server.close(done)) })
    })
  })
}

/** Run the real probe against the stub and return its stdout plus exit code. */
function runProbe(baseUrl) {
  return new Promise((done) => {
    const child = spawn(process.execPath, [PROBE, baseUrl, "--strict-keyless"], {
      // CI is emptied so the connect-start check keeps its "would register a
      // real client" skip — the stub is not the cloud and that check is not
      // what this file is about.
      env: { ...process.env, CI: "" },
      stdio: ["ignore", "pipe", "pipe"],
    })
    let out = ""
    child.stdout.on("data", (b) => { out += b })
    child.stderr.on("data", (b) => { out += b })
    child.on("close", (code) => done({ out, code }))
  })
}

/** PASS / FAIL / SKIP for one contract, or null when it never ran. */
function statusOf(out, name) {
  for (const line of out.split("\n")) {
    const m = line.match(/^(PASS|FAIL|SKIP) {2}(.*)$/)
    if (!m) continue
    const rest = m[2]
    if (rest === name || rest.startsWith(`${name} — `)) return m[1]
  }
  return null
}

/** Assert one contract's outcome, printing the whole run when it disagrees. */
function assertContract(out, name, expected) {
  const actual = statusOf(out, name)
  assert.equal(actual, expected, `expected "${name}" to be ${expected}, got ${actual}\n\n--- probe output ---\n${out}`)
}

async function probeWith(mutate) {
  const shape = communityShape()
  mutate?.(shape)
  const stub = await stubServer(shape)
  try {
    return await runProbe(stub.url)
  } finally {
    await stub.close()
  }
}

test("the keyless community shape passes all four Scene3D contracts", async () => {
  const { out } = await probeWith()
  assertContract(out, DISCOVERY, "PASS")
  assertContract(out, BASIC, "PASS")
  assertContract(out, REFUSAL, "PASS")
  assertContract(out, CAPABILITIES, "PASS")
})

test("advertising pro-3d-render again fails the discovery contract", async () => {
  const { out, code } = await probeWith((shape) => {
    shape.nodes.push({ type: "pro-3d-render", label: "3D Render Pro", category: "composition", description: "d", outputType: "video" })
    shape.describe["pro-3d-render"] = { status: 200, body: { data: { type: "pro-3d-render" } } }
  })
  assertContract(out, DISCOVERY, "FAIL")
  assert.notEqual(code, 0, "the probe must exit non-zero when a contract fails")
})

test("a describable pro-3d-render (200 instead of 404) fails the discovery contract", async () => {
  // The subtler half: omitted from the LIST, still describable by type — which
  // is all an agent that hardcodes the type needs to build a call.
  const { out } = await probeWith((shape) => {
    shape.describe["pro-3d-render"] = { status: 200, body: { data: { type: "pro-3d-render" } } }
  })
  assertContract(out, DISCOVERY, "FAIL")
  assertContract(out, BASIC, "PASS")
})

test("dropping the Basic 3D nodes fails the Basic contract", async () => {
  const { out } = await probeWith((shape) => {
    shape.nodes = shape.nodes.filter((n) => !n.type.endsWith("-3d-scene"))
  })
  assertContract(out, BASIC, "FAIL")
  // Removing Basic does not make Pro's absence wrong — the two are independent
  // promises and must fail independently.
  assertContract(out, DISCOVERY, "PASS")
})

test("a Pro run answered with a job handle fails the refusal contract", async () => {
  const { out } = await probeWith((shape) => {
    shape.proRun = { status: 200, body: { jobId: "job_pro" } }
    shape.proQuote = { status: 200, body: { quoteId: "q_1", maxCredits: 900 } }
  })
  assertContract(out, REFUSAL, "FAIL")
})

test("a Pro run refused with the BASIC lane's code fails the refusal contract", async () => {
  // The fallback shape this contract exists for: still a 503, still honest
  // looking, but it is the Basic lane's keyless refusal — meaning the Pro
  // request reached a different operation. A status-only or substring check
  // would call this a pass.
  const { out } = await probeWith((shape) => {
    shape.proRun = { status: 503, body: { error: { code: "provider_unavailable", message: "LLM API key not configured" } } }
  })
  assertContract(out, REFUSAL, "FAIL")
})

test("a quote endpoint that still mints a quoteId fails the refusal contract", async () => {
  const { out } = await probeWith((shape) => {
    shape.proQuote = { status: 200, body: { quoteId: "q_1", maxCredits: 900, breakdown: [] } }
  })
  assertContract(out, REFUSAL, "FAIL")
})

test("a capabilities document that claims Pro is available fails its contract", async () => {
  const { out } = await probeWith((shape) => {
    shape.capabilities.pro.available = true
  })
  assertContract(out, CAPABILITIES, "FAIL")
})

test("an advanced engine document on community fails the capabilities contract", async () => {
  const { out } = await probeWith((shape) => {
    shape.capabilities.advanced = { engines: ["blender-cloud"], sceneSchemaVersions: [1, 2] }
  })
  assertContract(out, CAPABILITIES, "FAIL")
})

test("offering blender-local without SCENE3D_LOCAL_ENABLED fails the capabilities contract", async () => {
  const { out } = await probeWith((shape) => {
    shape.capabilities.pro.engines = ["blender-cloud", "blender-local"]
  })
  assertContract(out, CAPABILITIES, "FAIL")
})

test("the keyless community shape passes the three Video Overlay contracts", async () => {
  const { out } = await probeWith()
  assertContract(out, OVERLAY_RENDER, "PASS")
  assertContract(out, OVERLAY_REFUSAL, "PASS")
  assertContract(out, OVERLAY_UNREACHABLE, "PASS")
})

test("a render that fails on a keyless install fails the render contract", async () => {
  // The local lane needs no key — a failed job here is a broken install, not
  // an honest keyless refusal.
  const { out } = await probeWith((shape) => {
    shape.overlay.jobs.job_overlay = { status: "failed", error_message: "Video Overlay render failed" }
  })
  assertContract(out, OVERLAY_RENDER, "FAIL")
})

test("a completed render whose file is not a video fails the render contract", async () => {
  const { out } = await probeWith((shape) => {
    shape.overlay.media = { status: 200, type: "text/html", bytes: 4096 }
  })
  assertContract(out, OVERLAY_RENDER, "FAIL")
})

test("end <= start accepted as a job fails the refusal contract", async () => {
  const { out } = await probeWith((shape) => {
    shape.overlay.refusal = { status: 200, body: { jobId: "job_overlay" } }
  })
  assertContract(out, OVERLAY_REFUSAL, "FAIL")
})

test("a raw fetch error in the failed job fails the unreachable-image contract", async () => {
  const { out } = await probeWith((shape) => {
    shape.overlay.jobs.job_overlay_unreachable = {
      status: "failed",
      error_message: "fetch failed: getaddrinfo ENOTFOUND overlay-smoke.invalid",
    }
  })
  assertContract(out, OVERLAY_UNREACHABLE, "FAIL")
})

test("an unfetchable image rendered anyway fails the unreachable-image contract", async () => {
  const { out } = await probeWith((shape) => {
    shape.overlay.jobs.job_overlay_unreachable = { status: "completed", output_data: { videoUrl: "/media/overlay.mp4" } }
  })
  assertContract(out, OVERLAY_UNREACHABLE, "FAIL")
})
