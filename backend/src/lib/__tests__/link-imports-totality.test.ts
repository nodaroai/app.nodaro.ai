// @test-watches backend/src/**/*.ts
/**
 * THE DEPLOYMENT'S SWITCH FOR LINKS — TOTALITY (`imports.links` on the surface
 * profile, `lib/link-imports.ts`). A deployment that turns link imports off
 * refuses a link to outside content; a new route that takes such a link
 * without saying what it does about it fails this build.
 *
 * Two nets, both textual like the import-gate totality test:
 *  1. the IMPORT GATE: all three funnels ask the switch before anything else,
 *     so every engine behind them (`import-gate-totality.test.ts` keeps those
 *     honest) is covered without a route edit;
 *  2. the ROUTES: every file under `routes/`, `ee/routes/` or `nodes/` that
 *     declares a URL field (`safeUrlSchema`, `z.string().url()`) is classified
 *     below, with what it does about an outside URL and why. A new file is
 *     not classified, so it fails until someone writes down what happens to an
 *     outside link there: it asks the switch, it is own-media only, the URL is
 *     no media fetch at all, or the question is open.
 *
 * The `open` lanes are the ones still awaiting a product decision (generation
 * references and processing inputs, listed for it in the PR that added this
 * guard): `open` is an explicit "not yet" with its reason, not a pass.
 */
import { describe, it, expect } from "vitest"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { dirname, join, relative } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC_DIR = join(HERE, "..", "..")

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist" || entry === "__tests__" || entry === "__characterization__") continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (entry.endsWith(".ts") && !entry.endsWith(".test.ts") && !entry.endsWith(".d.ts")) out.push(full)
  }
  return out
}

const withoutComments = (source: string): string => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")

const read = (rel: string): string => withoutComments(readFileSync(join(SRC_DIR, rel), "utf8"))

/** A field that takes a URL, however it is spelled in the schema. */
const URL_FIELD = /\bsafeUrlSchema\b|z\.string\(\)\.url\(/
/** Asking the switch: through the import gate, directly, or through the outside-input copy (`lib/outside-input-copy.ts` asks it before any fetch). */
const ASKS_THE_SWITCH = /\b(?:requireImportAllowed|requireAccountlessImportAllowed|spendImportConfirmation|assertLinkImportAllowed|linkImportRefusal|copyOutsideInput|inspectOutsideInput)\s*\(/
/** Refusing or never fetching anything but this deployment's own storage. */
const OWN_MEDIA_ONLY = /\b(?:isOurCdnUrl|isOwnMediaUrl|isOwnStoredFileUrl|r2KeyFromOurUrl)\s*\(/
/** A direct fetch of a URL in a route (workers fetch job payloads; their routes are counted here). */
const FETCH_PRIMITIVE = /\b(?:safeFetch|downloadFile|uploadToR2)\s*\(/

interface Lane {
  /**
   * `asks`: the file asks the switch, directly or through the gate (verified).
   * `own`: the file only ever fetches this deployment's own storage (verified).
   * `none`: no media is fetched from the URL (stored as given, or not media at all).
   * `open`: an outside URL still reaches a fetch or a provider, awaiting a decision.
   */
  readonly kind: "asks" | "own" | "none" | "open"
  readonly why: string
}

const asks = (why: string): Lane => ({ kind: "asks", why })
const own = (why: string): Lane => ({ kind: "own", why })
const none = (why: string): Lane => ({ kind: "none", why })
const open = (why: string): Lane => ({ kind: "open", why })

const GATE = asks("asks the import gate (lib/import-gate.ts), which asks the switch first")
const SWITCH = asks("a link to outside content is refused here directly (lib/link-imports.ts)")
const GENERATION_REFERENCE = open(
  "a generation's reference media, which the server or the provider fetches; refusing an outside URL here changes what a generation accepts, so it awaits a product decision",
)
const PROCESSING_INPUT = open("a node's input media, fetched to be processed; whether an outside URL may be processed awaits a product decision")
const ENTITY_REFERENCE = open("a reference URL stored on the entity and read by later generations; awaits the same decision as a generation's reference")
const PROBE = open("the server reads an outside link's length without storing it; awaits a product decision")
const STORED_ONLY = none("recorded as given; nothing fetches it here")
const NOT_MEDIA = none("not media: a page, a redirect or an account configuration, never fetched as an import")

/** Routes whose URL field lives in a shared schema module, so the URL-field scan cannot see them. They are counted by name. */
const SHARED_SCHEMA_LINK_ROUTES = ["routes/web-scrape.ts", "routes/site-capture.ts", "routes/meta-ads-scrape.ts", "routes/instagram-scrape.ts"]

/**
 * Every route-like file that declares a URL field, and what it does about a
 * link to outside content.
 */
const LANES: Readonly<Record<string, Lane>> = {
  // Asks the switch.
  "routes/download-video.ts": GATE,
  "routes/dubbing.ts": asks("the sourceUrl lane asks the gate (lib/dubbing-source.ts); its audioUrl/videoUrl upload fields are the processing-input question"),
  "routes/extract-youtube-audio.ts": GATE,
  "routes/media-import-url.ts": GATE,
  "routes/media-url-import.ts": GATE,
  "routes/media-process.ts": SWITCH,
  "routes/save-to-storage.ts": SWITCH,
  "routes/suno.ts": asks("cover and upload-extend ask the switch for any link and the gate for a social one; mashup, add-vocals and voice-sample audio are the processing-input question"),
  "routes/transcribe.ts": SWITCH,
  "routes/trim-audio.ts": SWITCH,
  "routes/video-metadata.ts": SWITCH,
  "routes/youtube-audio.ts": GATE,

  // Only ever serves or fetches this deployment's own storage.
  "routes/download.ts": own("only files of this deployment's storage (isOurCdnUrl): 403 for anything else"),
  "routes/media-discard.ts": own("discards this deployment's own uploaded files, by their URL"),

  // Not a media fetch at all.
  "ee/routes/admin-hosted-deployments.ts": none("the URL an administrator registers for a hosted deployment: configuration, not media"),
  "ee/routes/admin-locations.ts": none("an administrator's curated location image, not a person's import"),
  "ee/routes/admin-tutorials.ts": none("an administrator's tutorial thumbnail and video links, stored and shown as given"),
  "ee/routes/freecut-export.ts": none("names the rendered scene files in an export document; nothing fetches them here"),
  "routes/content-rights.ts": none("records a rights confirmation for a link; the gate reads it at the import"),
  "routes/developer-apps.ts": NOT_MEDIA,
  "routes/library.ts": none("records a library row for a URL it does not own as given; nothing fetches it (key-ownership judges own files)"),
  "routes/media-delete.ts": none("deletes the caller's own files by URL; nothing is fetched"),
  "routes/node-presets.ts": STORED_ONLY,
  "routes/oauth-register.ts": NOT_MEDIA,
  "routes/oauth.ts": NOT_MEDIA,
  "routes/pipelines.ts": ENTITY_REFERENCE,
  "routes/published-apps.ts": STORED_ONLY,
  "routes/social-auth.ts": NOT_MEDIA,
  "routes/voice-favorites.ts": STORED_ONLY,
  "routes/webhook-output.ts": none("posts a run's result to the caller's own webhook: outbound, no media comes in"),
  "routes/workflow-templates.ts": STORED_ONLY,
  "routes/workflows.ts": STORED_ONLY,

  // Open: outside media still reaches a fetch or a provider, awaiting a decision.
  "routes/web-scrape.ts": open("hands the page a caller names to the scraping service and keeps its text and images; awaits a product decision"),
  "routes/site-capture.ts": open("hands the site a caller names to the capture service and stores its screenshots; awaits a product decision"),
  "routes/meta-ads-scrape.ts": open("hands the ad page a caller names to the scraping service and copies its media; awaits a product decision"),
  "routes/instagram-scrape.ts": open("hands the account a caller names to the scraping service and copies its media; awaits a product decision"),
  "ee/routes/seedance-ref-estimate.ts": PROBE,
  "nodes/episode-trailer/use-case.ts": PROCESSING_INPUT,
  "nodes/gif-to-video/route.ts": PROCESSING_INPUT,
  "nodes/remove-audio/route.ts": PROCESSING_INPUT,
  "nodes/shot-cuts/route.ts": PROCESSING_INPUT,
  "nodes/speaker-map/payload.ts": PROCESSING_INPUT,
  "nodes/speaker-map/route.ts": PROCESSING_INPUT,
  "nodes/tighten-episode/use-case.ts": PROCESSING_INPUT,
  "routes/3d-scene.ts": GENERATION_REFERENCE,
  "routes/add-captions.ts": PROCESSING_INPUT,
  "routes/adjust-volume.ts": PROCESSING_INPUT,
  "routes/after-effects-ai.ts": PROCESSING_INPUT,
  "routes/ai-avatar.ts": GENERATION_REFERENCE,
  "routes/apply-edl.ts": PROCESSING_INPUT,
  "routes/assemble-narrated-video.ts": PROCESSING_INPUT,
  "routes/audio-fx.ts": PROCESSING_INPUT,
  "routes/audio-isolation.ts": PROCESSING_INPUT,
  "routes/audio-separation.ts": PROCESSING_INPUT,
  "routes/audio-sync.ts": PROCESSING_INPUT,
  "routes/character-training.ts": GENERATION_REFERENCE,
  "routes/characters.ts": ENTITY_REFERENCE,
  "routes/cinematic-avatar.ts": GENERATION_REFERENCE,
  "routes/clip-length.ts": PROBE,
  "routes/combine-audio.ts": PROCESSING_INPUT,
  "routes/combine-videos.ts": PROCESSING_INPUT,
  "routes/creatures.ts": ENTITY_REFERENCE,
  "routes/describe-to-picker.ts": GENERATION_REFERENCE,
  "routes/edit-image.ts": asks(
    "Nodaro Image Upscale's image goes through the outside-input copy (lib/nodaro-image-upscale-lane.ts), which asks the switch before any fetch; the other edit models' images await the generation-reference decision",
  ),
  "routes/extend-video.ts": GENERATION_REFERENCE,
  "routes/extract-audio.ts": PROCESSING_INPUT,
  "routes/extract-frame.ts": PROCESSING_INPUT,
  "routes/face-swap.ts": GENERATION_REFERENCE,
  "routes/faces.ts": ENTITY_REFERENCE,
  "routes/fade-video.ts": PROCESSING_INPUT,
  "routes/forced-alignment.ts": PROCESSING_INPUT,
  "routes/generate-character-asset.ts": GENERATION_REFERENCE,
  "routes/generate-character-motion.ts": GENERATION_REFERENCE,
  "routes/generate-character.ts": GENERATION_REFERENCE,
  "routes/generate-creature-asset.ts": GENERATION_REFERENCE,
  "routes/generate-creature-motion.ts": GENERATION_REFERENCE,
  "routes/generate-creature.ts": GENERATION_REFERENCE,
  "routes/generate-face.ts": GENERATION_REFERENCE,
  "routes/generate-image-body.ts": GENERATION_REFERENCE,
  "routes/generate-location-asset.ts": GENERATION_REFERENCE,
  "routes/generate-location-motion.ts": GENERATION_REFERENCE,
  "routes/generate-location.ts": GENERATION_REFERENCE,
  "routes/generate-mask.ts": GENERATION_REFERENCE,
  "routes/generate-music.ts": GENERATION_REFERENCE,
  "routes/generate-object-asset.ts": GENERATION_REFERENCE,
  "routes/generate-object-motion.ts": GENERATION_REFERENCE,
  "routes/generate-object.ts": GENERATION_REFERENCE,
  "routes/generate-surround-continuation.ts": GENERATION_REFERENCE,
  "routes/generate-video.ts": GENERATION_REFERENCE,
  "routes/image-collage.ts": PROCESSING_INPUT,
  "routes/image-critic.ts": GENERATION_REFERENCE,
  "routes/image-overlay-placement.ts": PROCESSING_INPUT,
  "routes/image-overlay.ts": PROCESSING_INPUT,
  "routes/image-proxy.ts": open("streams an outside image or video to the viewer's browser (display only, nothing stored); whether a deployment refuses it awaits a product decision"),
  "routes/image-to-image.ts": GENERATION_REFERENCE,
  "routes/image-to-text.ts": GENERATION_REFERENCE,
  "routes/lip-sync.ts": GENERATION_REFERENCE,
  "routes/llm-chat.ts": GENERATION_REFERENCE,
  "routes/llm-structured-jobs.ts": GENERATION_REFERENCE,
  "routes/locations.ts": ENTITY_REFERENCE,
  "routes/loop-video.ts": PROCESSING_INPUT,
  "routes/lottie-overlay-ai.ts": PROCESSING_INPUT,
  "routes/mask-composite.ts": PROCESSING_INPUT,
  "routes/mask-erase.ts": PROCESSING_INPUT,
  "routes/mask-outline.ts": PROCESSING_INPUT,
  "routes/merge-video-audio.ts": PROCESSING_INPUT,
  "routes/mix-audio.ts": PROCESSING_INPUT,
  "routes/motion-transfer.ts": GENERATION_REFERENCE,
  "routes/nodaro-exclusive.ts": open("a self-hosted install's relay to the cloud: the URL is passed on for the far end to read; awaits the same decision as the routes it relays"),
  "routes/objects.ts": ENTITY_REFERENCE,
  "routes/pitch-tempo.ts": PROCESSING_INPUT,
  "routes/pro-3d-render.ts": GENERATION_REFERENCE,
  "routes/prompt-helper.ts": GENERATION_REFERENCE,
  "routes/reference-board.ts": GENERATION_REFERENCE,
  "routes/reference-sheet.schema.ts": GENERATION_REFERENCE,
  "routes/render-video.ts": PROCESSING_INPUT,
  "routes/resize-video.ts": PROCESSING_INPUT,
  "routes/scheduled-posts.ts": open("a post's media, read at publish time: outbound, and normally this deployment's own file; awaits a product decision"),
  "routes/shot-sequence.ts": PROCESSING_INPUT,
  "routes/silence-detect.ts": PROCESSING_INPUT,
  "routes/slideshow.ts": PROCESSING_INPUT,
  "routes/social-media-format.ts": PROCESSING_INPUT,
  "routes/social-publish.ts": open("a post's media, fetched to publish it: outbound, and normally this deployment's own file; awaits a product decision"),
  "routes/speech-to-video.ts": GENERATION_REFERENCE,
  "routes/speed-ramp.ts": PROCESSING_INPUT,
  "routes/split-image.ts": PROCESSING_INPUT,
  "routes/split-media.ts": PROCESSING_INPUT,
  "routes/still-to-video.ts": GENERATION_REFERENCE,
  "routes/switchx.ts": GENERATION_REFERENCE,
  "routes/text-to-video.ts": GENERATION_REFERENCE,
  "routes/three-d-title-ai.ts": PROCESSING_INPUT,
  "routes/transcode-video.ts": PROCESSING_INPUT,
  "routes/trim-video.ts": PROCESSING_INPUT,
  "routes/video-depth.ts": PROCESSING_INPUT,
  "routes/video-face-mesh.ts": PROCESSING_INPUT,
  "routes/video-mask.ts": PROCESSING_INPUT,
  "routes/video-overlay.ts": PROCESSING_INPUT,
  "routes/video-retake.ts": GENERATION_REFERENCE,
  "routes/video-scene-cuts.ts": PROCESSING_INPUT,
  "routes/video-sfx.ts": GENERATION_REFERENCE,
  "routes/video-to-video.ts": GENERATION_REFERENCE,
  "routes/video-upscale.ts": PROCESSING_INPUT,
  "routes/voice-changer.ts": GENERATION_REFERENCE,
}

const routeLike = ["routes", "ee/routes", "nodes"].flatMap((dir) => walk(join(SRC_DIR, dir)))
const files = routeLike.map((file) => ({ rel: relative(SRC_DIR, file).split("\\").join("/"), source: withoutComments(readFileSync(file, "utf8")) }))
const urlFieldFiles = files.filter((f) => URL_FIELD.test(f.source)).map((f) => f.rel).sort()

describe("the switch is asked first, in all three funnels of the import gate", () => {
  const gate = read("lib/import-gate.ts")
  const funnels = ["requireImportAllowed", "spendImportConfirmation", "requireAccountlessImportAllowed"] as const
  for (const fn of funnels) {
    it(`${fn} asks it before anything else`, () => {
      const match = new RegExp(`export async function ${fn}\\([^)]*\\)(?::[^{]+)?\\{\\s*([^\\n]*)`).exec(gate)
      expect(match, `${fn} is not found in the gate`).not.toBeNull()
      expect(match![1], `${fn} no longer asks the switch first`).toBe("assertLinkImportAllowed(url)")
    })
  }

  it("a refusal of the switch is an import refusal, so every route already maps it to its 403", () => {
    expect(gate).toMatch(/e instanceof LinkImportsDisabledError/)
  })

  it("the toolkit hands a plugin its probes through the switch, and offers it the member its own fetches need", () => {
    const toolkit = read("lib/private-plugins/toolkit.ts")
    expect(toolkit).toMatch(/ytMetadataProbe: pluginYtMetadataProbe/)
    expect(toolkit).toMatch(/probeSocialPostVideo: pluginProbeSocialPostVideo/)
    expect(toolkit).toMatch(/imports:\s*\{[\s\S]*?linksAllowed: \(\) => surfaceAllowsLinkImports\(\)[\s\S]*?assertLinkAllowed: assertPluginLinkAllowed/)
    const downloads = read("lib/private-plugins/toolkit-downloads.ts")
    expect(downloads).toMatch(/pluginYtMetadataProbe[\s\S]*assertPluginLinkAllowed\(args\[0\]\)/)
    expect(downloads).toMatch(/pluginProbeSocialPostVideo[\s\S]*assertPluginLinkAllowed\(args\[0\]\)/)
    expect(downloads).toMatch(/new PluginHttpError\(403, \{ error: refusal \}/)
  })

  it("a run's Video URL fetch is bound to the switch before it probes or fetches", () => {
    const deps = read("services/workflow-engine/video-link-fetch-deps.ts")
    expect(deps).toMatch(/linkRefusal:/)
    const fetch = read("services/workflow-engine/video-link-fetch.ts")
    // What the run's readers receive is what is judged: the stored file when there is one, else the link.
    expect(fetch).toMatch(/const read = stored \?\? link/)
    const refuse = fetch.search(/deps\.linkRefusal\?\.\(read\)/)
    const socialGate = fetch.search(/!isSocialVideoUrl\(link\)\) continue/)
    const fetchWorker = fetch.search(/const worker = async/)
    expect(refuse, "the switch is no longer asked for a run's link").toBeGreaterThan(0)
    expect(refuse, "the switch must be asked before a direct link passes through untouched").toBeLessThan(socialGate)
    expect(socialGate).toBeLessThan(fetchWorker)
    expect(read("workers/orchestrator-video-links.ts")).toMatch(/holdsRefusedLink\(args\.nodes\)/)
  })

  it("the workflow bundle import reports an outside link instead of copying it", () => {
    const portability = read("lib/media-portability.ts")
    expect(portability).toMatch(/linkImportRefusal\(url\)/)
  })
})

describe("every route that takes a URL is counted", () => {
  it("recognizes the shapes it counts", () => {
    expect(URL_FIELD.test(`z.object({ videoUrl: safeUrlSchema })`)).toBe(true)
    expect(URL_FIELD.test(`z.object({ url: z.string().url() })`)).toBe(true)
    expect(URL_FIELD.test(`z.object({ url: z.string() })`)).toBe(false)
    expect(URL_FIELD.test(withoutComments("// safeUrlSchema in a comment is not a field"))).toBe(false)
    expect(ASKS_THE_SWITCH.test("if (linkImportRefusal(url)) return")).toBe(true)
    expect(ASKS_THE_SWITCH.test("await requireImportAllowed(url, rights)")).toBe(true)
    expect(OWN_MEDIA_ONLY.test("isOurCdnUrl(url, a, b)")).toBe(true)
    expect(FETCH_PRIMITIVE.test("await safeFetch(url)")).toBe(true)
  })

  it("every route-like file with a URL field is classified", () => {
    expect(urlFieldFiles.length, "found no route that takes a URL: the scan is wired to nothing").toBeGreaterThan(100)
    const unclassified = urlFieldFiles.filter((rel) => !(rel in LANES))
    expect(
      unclassified,
      "a route takes a URL but is not classified in LANES: decide what happens to a link to outside content here. " +
        "Ask the switch (lib/link-imports.ts, or the import gate) before any job, reservation or fetch, or classify it with why.",
    ).toEqual([])
  })

  it("every route-like file that fetches a URL itself is classified", () => {
    const strays = files.filter((f) => FETCH_PRIMITIVE.test(f.source) && !f.rel.endsWith("/worker.ts") && !(f.rel in LANES)).map((f) => f.rel)
    expect(strays, "a route fetches a URL itself but is not classified in LANES").toEqual([])
  })

  it("no classified file is stale, and each lane says why", () => {
    const stale = Object.keys(LANES).filter((rel) => !urlFieldFiles.includes(rel) && !SHARED_SCHEMA_LINK_ROUTES.includes(rel))
    expect(stale, "LANES lists files that no longer declare a URL field: remove them").toEqual([])
    const missing = SHARED_SCHEMA_LINK_ROUTES.filter((rel) => !files.some((f) => f.rel === rel))
    expect(missing, "a shared-schema link route no longer exists: remove it from SHARED_SCHEMA_LINK_ROUTES and LANES").toEqual([])
    for (const [rel, lane] of Object.entries(LANES)) expect(lane.why.length, `${rel}: say why`).toBeGreaterThan(20)
  })

  it("a lane marked `asks` really asks the switch, and a lane marked `own` really is own-media only", () => {
    for (const [rel, lane] of Object.entries(LANES)) {
      const source = files.find((f) => f.rel === rel)!.source
      if (lane.kind === "asks") expect(ASKS_THE_SWITCH.test(source), `${rel} is marked asks but never asks the switch`).toBe(true)
      if (lane.kind === "own") expect(OWN_MEDIA_ONLY.test(source), `${rel} is marked own but holds no own-media check`).toBe(true)
    }
  })

  it("a lane that starts asking the switch moves off `open`/`none`, so the census never claims less than the code does", () => {
    for (const [rel, lane] of Object.entries(LANES)) {
      if (lane.kind !== "open" && lane.kind !== "none") continue
      const source = files.find((f) => f.rel === rel)!.source
      expect(ASKS_THE_SWITCH.test(source), `${rel} now asks the switch: classify it as asks`).toBe(false)
    }
  })
})
