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
 * Scope on purpose: this file asserts the Scene3D, Video Overlay, Site Capture,
 * Tighten Episode, Chapters and Trailer contracts only. The stub is faithful enough for the
 * probe to reach them, not a second implementation of the platform — the
 * other contracts are asserted against the real image by
 * `.github/workflows/community-e2e.yml`.
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

/** The Site Capture contract name, spelled exactly as the probe records it. */
const CAPTURE = "a keyless Site Capture answers with a job id, then fails honestly"

/** The Tighten Episode contract name, spelled exactly as the probe records it. */
const TIGHTEN = "Tighten Episode on an unconnected install: hidden from discovery, refused 503 before any job"

/** The Chapters contract name, spelled exactly as the probe records it. */
const CHAPTERS = "Chapters on an unconnected install: hidden from discovery, refused 503 before any job"

/** The Trailer contract name, spelled exactly as the probe records it. */
const TRAILER = "Trailer on an unconnected install: hidden from discovery, refused 503 before any job"

/** The entity search contract name, spelled exactly as the probe records it. */
const ENTITY_SEARCH = "a character search (?q=) matches every word literally, in any order and any case"

/**
 * The platform's `?q=` rule (backend/src/lib/text-search.ts), restated for the
 * stub: blank = everything; otherwise the first five whitespace words, each of
 * which must occur — as written, ignoring case — in the name or the description.
 */
function wordSearch(rows, q) {
  const words = q.trim().split(/\s+/).filter(Boolean).slice(0, 5)
  return rows.filter((row) =>
    words.every((word) => [row.name, row.description ?? ""].some((field) => field.toLowerCase().includes(word.toLowerCase()))),
  )
}

/** A search where `*` is a wildcard — what `ilike` through PostgREST would do. */
function starWildcardSearch(rows, q) {
  const words = q.trim().split(/\s+/).filter(Boolean).slice(0, 5)
  const patterns = words.map((w) => new RegExp(w.split("*").map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*"), "i"))
  return rows.filter((row) => patterns.every((p) => p.test(row.name) || p.test(row.description ?? "")))
}

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
    // Site Capture: the route answers job-id-first; the job then fails with the keyless message.
    capture: { status: 200, body: { jobId: "job_capture", status: "pending" } },
    // Tighten Episode, unconnected: refused before any job. `createsJob` puts a
    // row in the job list (what a wrapper inserted before the refusal leaves).
    tighten: {
      status: 503,
      body: {
        error: {
          code: "nodaro_connection_required",
          message: "This node runs on nodaro.ai. Connect your install (Integrations → nodaro.ai, or paste an API key from app.nodaro.ai → Settings → API) and run again.",
        },
      },
      createsJob: false,
    },
    // Trailer, unconnected: the same refusal, before any job.
    trailer: {
      status: 503,
      body: {
        error: {
          code: "nodaro_connection_required",
          message: "This node runs on nodaro.ai. Connect your install (Integrations → nodaro.ai, or paste an API key from app.nodaro.ai → Settings → API) and run again.",
        },
      },
      createsJob: false,
    },
    // Chapters, unconnected: the same refusal, before any job.
    chapters: {
      status: 503,
      body: {
        error: {
          code: "nodaro_connection_required",
          message: "This node runs on nodaro.ai. Connect your install (Integrations → nodaro.ai, or paste an API key from app.nodaro.ai → Settings → API) and run again.",
        },
      },
      createsJob: false,
    },
    // GET /v1/characters?q= — (rows, q) => the rows the list answers with, or
    // { status, body } for a refusal.
    characterSearch: wordSearch,
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
  const state = {
    hasUsers: false,
    heygenKey: false,
    jobs: [{ id: "job_earlier", status: "failed", input_data: { type: "generate-image" } }],
    characters: [],
  }
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

      // ── the saved-entity search ───────────────────────────────────────────
      if (path === "/v1/projects" && req.method === "POST") return send(201, { data: { id: "proj_1" } })
      if (path === "/v1/characters" && req.method === "POST") {
        let body = {}
        try { body = JSON.parse(raw) } catch { /* answered as a refusal below */ }
        if (typeof body.name !== "string" || !body.nodeId) {
          return send(400, { error: { code: "validation_error", message: "name and nodeId are required" } })
        }
        // A database built from the migrations has characters.project_id NOT
        // NULL (migration 001), so a create without a project is a 500 there —
        // the shape the real community stack answered before the probe sent one.
        if (!body.projectId) {
          return send(500, { error: { code: "internal_error", message: "Failed to save character" } })
        }
        const row = { id: `char_${state.characters.length + 1}`, name: body.name, description: body.description ?? null }
        state.characters.push(row)
        return send(200, { id: row.id, name: row.name })
      }
      if (path === "/v1/characters" && req.method === "GET") {
        const q = url.searchParams.get("q") ?? ""
        const answer = shape.characterSearch(state.characters, q)
        if (!Array.isArray(answer)) return send(answer.status, answer.body)
        return send(200, { characters: answer, nextCursor: null })
      }
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
        if (jobId === "job_capture" && shape.captureJob) return send(200, { data: shape.captureJob })
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

      if (path === "/v1/site-capture" && req.method === "POST") return send(shape.capture.status, shape.capture.body)

      // ── Tighten Episode ───────────────────────────────────────────────────
      if (path === "/v1/jobs" && req.method === "GET") return send(200, { data: state.jobs, nextCursor: null })
      if (path === "/v1/tighten-episode" && req.method === "POST") {
        if (shape.tighten.createsJob) {
          state.jobs = [{ id: "job_tighten", status: "processing", input_data: { type: "tighten-episode" } }, ...state.jobs]
        }
        return send(shape.tighten.status, shape.tighten.body)
      }
      if (path === "/v1/episode-chapters" && req.method === "POST") {
        if (shape.chapters.createsJob) {
          state.jobs = [{ id: "job_chapters", status: "processing", input_data: { type: "episode-chapters" } }, ...state.jobs]
        }
        return send(shape.chapters.status, shape.chapters.body)
      }
      if (path === "/v1/episode-trailer" && req.method === "POST") {
        if (shape.trailer.createsJob) {
          state.jobs = [{ id: "job_trailer", status: "processing", input_data: { type: "episode-trailer" } }, ...state.jobs]
        }
        return send(shape.trailer.status, shape.trailer.body)
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

test("the keyless community shape passes the Site Capture contract", async () => {
  const { out } = await probeWith()
  assertContract(out, CAPTURE, "PASS")
})

test("a held capture answer (no pending status) fails the Site Capture contract", async () => {
  const { out } = await probeWith((shape) => {
    shape.capture = { status: 200, body: { jobId: "job_capture", stills: [] } }
  })
  assertContract(out, CAPTURE, "FAIL")
})

test("a 500 from the route fails the Site Capture contract", async () => {
  const { out } = await probeWith((shape) => {
    shape.capture = { status: 500, body: { error: { code: "internal_error", message: "boom" } } }
  })
  assertContract(out, CAPTURE, "FAIL")
})

test("a raw vendor error in the failed capture job fails the Site Capture contract", async () => {
  const { out } = await probeWith((shape) => {
    shape.captureJob = { status: "failed", error_message: "ApifyClientError: 401 Unauthorized" }
  })
  assertContract(out, CAPTURE, "FAIL")
})

test("the keyless community shape passes the Tighten Episode contract", async () => {
  const { out } = await probeWith()
  assertContract(out, TIGHTEN, "PASS")
})

test("advertising tighten-episode on an unconnected install fails the Tighten Episode contract", async () => {
  const { out } = await probeWith((shape) => {
    shape.nodes.push({ type: "tighten-episode", label: "Tighten Episode", category: "processing", description: "d", outputType: "video" })
  })
  assertContract(out, TIGHTEN, "FAIL")
})

test("a Tighten Episode run accepted with a job handle fails the Tighten Episode contract", async () => {
  const { out } = await probeWith((shape) => {
    shape.tighten = { status: 202, body: { jobId: "job_tighten", executionId: "exec_1" }, createsJob: true }
  })
  assertContract(out, TIGHTEN, "FAIL")
})

test("a refusal that left a job row behind fails the Tighten Episode contract", async () => {
  // The honest-looking answer the job count exists for: the right status and
  // code, no handle in the body — but the wrapper was inserted before the
  // refusal and is still there.
  const { out } = await probeWith((shape) => {
    shape.tighten = { ...shape.tighten, createsJob: true }
  })
  assertContract(out, TIGHTEN, "FAIL")
})

test("the keyless community shape passes the Chapters contract", async () => {
  const { out } = await probeWith()
  assertContract(out, CHAPTERS, "PASS")
})

test("advertising episode-chapters on an unconnected install fails the Chapters contract (and only it)", async () => {
  const { out } = await probeWith((shape) => {
    shape.nodes.push({ type: "episode-chapters", label: "Chapters", category: "processing", description: "d", outputType: "text" })
  })
  assertContract(out, CHAPTERS, "FAIL")
  assertContract(out, TIGHTEN, "PASS")
})

test("a Chapters run accepted with a job handle fails the Chapters contract", async () => {
  const { out } = await probeWith((shape) => {
    shape.chapters = { status: 202, body: { jobId: "job_chapters", executionId: "exec_1" }, createsJob: true }
  })
  assertContract(out, CHAPTERS, "FAIL")
})

test("a Chapters refusal that left a job row behind fails the Chapters contract", async () => {
  const { out } = await probeWith((shape) => {
    shape.chapters = { ...shape.chapters, createsJob: true }
  })
  assertContract(out, CHAPTERS, "FAIL")
})

test("the keyless community shape passes the Trailer contract", async () => {
  const { out } = await probeWith()
  assertContract(out, TRAILER, "PASS")
})

test("advertising episode-trailer on an unconnected install fails the Trailer contract (and only it)", async () => {
  const { out } = await probeWith((shape) => {
    shape.nodes.push({ type: "episode-trailer", label: "Trailer", category: "processing", description: "d", outputType: "video" })
  })
  assertContract(out, TRAILER, "FAIL")
  assertContract(out, CHAPTERS, "PASS")
  assertContract(out, TIGHTEN, "PASS")
})

test("a Trailer run accepted with a job handle fails the Trailer contract", async () => {
  const { out } = await probeWith((shape) => {
    shape.trailer = { status: 202, body: { jobId: "job_trailer", executionId: "exec_1" }, createsJob: true }
  })
  assertContract(out, TRAILER, "FAIL")
})

test("a Trailer refusal that left a job row behind fails the Trailer contract", async () => {
  const { out } = await probeWith((shape) => {
    shape.trailer = { ...shape.trailer, createsJob: true }
  })
  assertContract(out, TRAILER, "FAIL")
})

test("a refusal with another code fails the Tighten Episode contract", async () => {
  // A 503 from the wrong gate (the snapshot columns missing, say) is not the
  // connection refusal the self-hoster can act on.
  const { out } = await probeWith((shape) => {
    shape.tighten = {
      status: 503,
      body: { error: { code: "use_case_unavailable", message: "Tighten Episode is unavailable right now. Try again later." } },
      createsJob: false,
    }
  })
  assertContract(out, TIGHTEN, "FAIL")
})

test("the platform's word search passes the entity search contract", async () => {
  const { out } = await probeWith()
  assertContract(out, ENTITY_SEARCH, "PASS")
})

test("a search where * is a wildcard fails the entity search contract", async () => {
  // What `ilike` through PostgREST would do: it rewrites `*` to `%`, so "a*b"
  // also finds "aXb" — the reason the platform's filter is a regex.
  const { out } = await probeWith((shape) => {
    shape.characterSearch = starWildcardSearch
  })
  assertContract(out, ENTITY_SEARCH, "FAIL")
})

test("a list that ignores q fails the entity search contract", async () => {
  const { out } = await probeWith((shape) => {
    shape.characterSearch = (rows) => rows
  })
  assertContract(out, ENTITY_SEARCH, "FAIL")
})

test("a search that reads q as one phrase fails the entity search contract", async () => {
  // The rule is words in any order: "CAR red" must find "Red car, fast".
  const { out } = await probeWith((shape) => {
    shape.characterSearch = (rows, q) => {
      const phrase = q.trim().toLowerCase()
      return rows.filter((row) => !phrase || [row.name, row.description ?? ""].some((f) => f.toLowerCase().includes(phrase)))
    }
  })
  assertContract(out, ENTITY_SEARCH, "FAIL")
})

test("a comma that breaks the filter fails the entity search contract", async () => {
  // An unquoted value in PostgREST's or=(…) ends at a comma: the request
  // errors instead of finding "Smith, John".
  const { out } = await probeWith((shape) => {
    shape.characterSearch = (rows, q) =>
      q.includes(",") ? { status: 500, body: { error: { code: "internal_error", message: "Failed to list characters" } } } : wordSearch(rows, q)
  })
  assertContract(out, ENTITY_SEARCH, "FAIL")
})
