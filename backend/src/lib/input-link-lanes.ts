/**
 * THE DECLARATIONS OF THE MEDIA-INPUT FUNNEL (`lib/input-links.ts`, decided
 * 2026-11-16): what a field's name cannot say. Every REST request with a body
 * is judged by default; the tables here say which routes are not, which field
 * names hold an address under another name, and which fields a route reads
 * whole. `__tests__/input-links-census.test.ts` boots the app and holds every
 * entry to a registered route or a field some schema declares, and every
 * address-typed field of every schema to a name the funnel judges or an entry
 * here — so the tables only list what is true of the code.
 */

/** How a reader finds the links in one value it is handed whole. */
export type InputLinkReader =
  /** A workflow node: its input media, as the workflow import reads them — never a run's result, an endpoint or a preview. */
  | "workflow-node"
  /** A list of workflow nodes, each read as `workflow-node`. */
  | "workflow-nodes"
  /** A node's settings or a workflow's (not a node): their media fields, read as a node's are. */
  | "media-fields"
  /** Taken whole: every string inside that has a fetched scheme. */
  | "subtree"

/**
 * What a lane's fields are, beyond what their names say. Paths are written as
 * the MCP census writes them: `a.b`, `a[]` (each item), `a.*` (each value of
 * a record, whatever its key).
 */
export interface InputLinkReading {
  /** Paths whose name says nothing of an address but which hold one (an address-typed field named otherwise). */
  readonly addresses?: readonly string[]
  /** Paths read whole by a reader instead of by name. */
  readonly readers?: Readonly<Record<string, InputLinkReader>>
  /** Paths never judged, with why: what they carry is not content this request takes in. */
  readonly notContent?: Readonly<Record<string, string>>
}

/**
 * Field names that hold an address although their name does not say so: each
 * value under one of them — a string, the items of a list, the values of a
 * record — is judged as an address.
 */
export const ADDRESS_NAMES: Readonly<Record<string, string>> = Object.freeze({
  src: "a render plan's, a scene graph's or an overlay's media source (render-video, scene graphs, Lottie overlays, shot sequences)",
  realLifeRefs: "the real-life reference pictures a character generation or edit takes",
  realLifeRefsByVariant: "a character's real-life reference pictures, per variant",
  referenceVideosByVariant: "a character's reference clips, per variant",
  screens: "a shot sequence blueprint's screen images",
  uploadUrlList: "the two tracks a Suno mashup uploads",
  target: "the page a background web scrape reads",
})

/**
 * Address-typed field names that are no media input: never judged, and named
 * here so the census knows they were looked at.
 */
export const NOT_MEDIA_NAMES: Readonly<Record<string, string>> = Object.freeze({
  allowedOrigins: "the web origins allowed to embed an app or use a developer app: configuration, never fetched",
  initiateUrlByHost: "the sign-in page an SSO provider starts at, per host: configuration",
  locale: "an interface language id (`en`, `pt-BR`): a short code, never fetched",
  madeFrom: "the page a trend credits, shown as a link: never fetched",
  sourceSegmentId: "a segment's id in a dub's source transcript",
  token: "a link's own capability (43 base64url characters, a workflow view link's), returned to its owner: an opaque id, never an address and never fetched",
})

const COLLECTION_RECORD =
  "a collection record keeps its link and media as data, fetched by nothing here; a run that uses them is judged at the node they reach"

/**
 * Route patterns (`METHOD /path`, or a `/path/` prefix ending in a slash for
 * every method) whose bodies are not judged, and why: what they carry is no
 * media input, or is stored and judged where it is used.
 */
export const EXEMPT_ROUTES: Readonly<Record<string, string>> = Object.freeze({
  "/v1/admin/": "an administrator's configuration and tests of this deployment, not a person's input",
  // Calls from outside systems, about their own state.
  "POST /v1/webhooks/:token": "a webhook trigger's payload, as the sender wrote it (it may name anything); the run it starts is judged at each node",
  "POST /v1/webhooks/replicate-training": "a provider's callback about its own training job",
  "POST /v1/billing/stripe-webhook": "the payment provider's event",
  "POST /v1/telegram/webhook/:webhookToken": "a messaging platform's update about its own channel",
  // Configuration: addresses this deployment posts to or allows, never media it takes in.
  "POST /v1/webhook-endpoints": "an endpoint this deployment posts events to",
  "PATCH /v1/webhook-endpoints/:id": "an endpoint this deployment posts events to",
  "POST /v1/webhook-output/send": "posts a run's result to the caller's own webhook: outbound",
  "POST /v1/workflow-triggers": "a trigger's configuration",
  "PATCH /v1/workflow-triggers/:id": "a trigger's configuration",
  "POST /v1/developer-apps": "a developer app's registration (redirect addresses, homepage, logo shown as given)",
  "PATCH /v1/developer-apps/:id": "a developer app's registration (redirect addresses, homepage, logo shown as given)",
  "POST /v1/oauth/register": "an OAuth client's registration",
  "POST /v1/oauth/authorize": "an OAuth redirect address",
  "POST /v1/oauth/token": "an OAuth redirect address",
  "POST /v1/http-credentials": "the address a stored credential is bound to",
  "PATCH /v1/http-credentials/:id": "the address a stored credential is bound to",
  "POST /v1/content-rights/confirm": "records a rights confirmation for a link; the import that reads it asks the link-import switch",
  "POST /v1/content-rights/authorization": "records a rights confirmation for a link; the import that reads it asks the link-import switch",
  "POST /v1/content-complaints": "a complaint names the work it is about: evidence, never fetched",
  // Deleting or looking up the caller's own files and records.
  "POST /v1/media/delete": "deletes the caller's own files by their address; nothing is fetched",
  "POST /v1/media/discard": "discards this deployment's own uploaded files by their address",
  // A video-editor project's content: a gzip body (a Buffer, not fields), stored
  // for its owner and never fetched; a run that takes the media it names judges them then.
  "PUT /v1/editor-projects/:id/file": "a video-editor project's saved content, stored for its owner; nothing is fetched",
  "PATCH /v1/editor-projects/:id/file": "a patch to a video-editor project's saved content, stored for its owner; nothing is fetched",
  "POST /v1/saved-posts/lookup": "looks up the caller's own saved posts by their address; nothing is fetched",
  "POST /v1/collection-read": "reads the caller's own collection records",
  // Records kept as data: their links and media are judged where a run uses them.
  "POST /v1/collection-write": COLLECTION_RECORD,
  "POST /v1/collections/:id/records": COLLECTION_RECORD,
  "POST /v1/collections/:id/records/bulk": COLLECTION_RECORD,
  "PATCH /v1/collections/:id/records/:recordId": COLLECTION_RECORD,
  // Stored graphs, listings and prices: judged where they run.
  "POST /v1/workflows": "a workflow's graph, stored; its nodes are judged when it runs, each before its reservation",
  "PATCH /v1/workflows/:id": "a workflow's graph, stored; its nodes are judged when it runs, each before its reservation",
  "POST /v1/projects/:projectId/workflows": "a workflow's graph, stored; its nodes are judged when it runs, each before its reservation",
  "POST /v1/workflows/:parentId/sub-workflows": "a workflow's graph, stored; its nodes are judged when it runs, each before its reservation",
  "POST /v1/workflows/import": "a workflow bundle: the media it would copy in asks the link-import switch (lib/media-portability.ts), and its nodes are judged when it runs",
  "POST /v1/templates/publish": "a template's graph and listing, stored; judged when a copy runs",
  "PATCH /v1/templates/:templateId": "a template's graph and listing, stored; judged when a copy runs",
  "POST /v1/apps/publish": "an app's listing (its icon and preview shown as given); its runs are judged when they run",
  "PATCH /v1/apps/:appId": "an app's listing (its icon and preview shown as given); its runs are judged when they run",
  "POST /v1/workflows/:id/share": "a share link's settings",
  "POST /v1/projects": "a project's settings, stored",
  "PATCH /v1/projects/:id": "a project's settings, stored",
  "PUT /v1/voices/favorites/:voiceId": "a favourite voice with its preview, played by the browser and never fetched by the server",
  "POST /v1/library/save-generated": "records a library row for a generated file, as given; nothing is fetched",
  "POST /v1/freecut-export": "names the rendered scene files in an export document; nothing is fetched",
  "POST /v1/credits/estimate-workflow": "prices a graph from its settings: nothing is fetched (an estimate probes no media), and its run is judged at each node",
  "POST /v1/component/estimate-credits": "prices a component from its settings: nothing is fetched, and its run is judged at each node",
  "POST /v1/workflows/:id/render-final/estimate": "prices a final render from a finished run: nothing is fetched",
  "POST /v1/api-tokens": "an API token's limits",
  "PATCH /v1/api-tokens/:id": "an API token's limits",
})

/** A post's link a recipe cites in what it writes: never fetched. */
const CITED_LINK = "the post's link the recipe cites in what it writes, never fetched"

/** A voice's sample on an entity: played by the browser, never fetched by the server (and often on the voice provider's host). */
const VOICE_PREVIEW = { "voice.previewUrl": "a voice's sample, played by the browser and never fetched by the server" }

/** What a node preset's data is: a node's settings, read as a node's are; its preview is no input. */
const NODE_PRESET: InputLinkReading = {
  readers: { data: "media-fields", "presets[].data": "media-fields" },
  notContent: { previewUrl: "the preset's preview picture, shown as given", "presets[].previewUrl": "the preset's preview picture, shown as given" },
}

/**
 * Judged routes whose fields need more than their names: a reader for a
 * value taken whole, a path that is not content.
 */
export const ROUTE_READINGS: Readonly<Record<string, InputLinkReading>> = Object.freeze({
  // A Cloud plugin's route (lib/route-node-gate.ts PLUGIN_CREDIT_GUARDED_ROUTES): its body as the plugin reads it.
  "POST /v1/content-recipe": { notContent: { sourceUrl: CITED_LINK } },
  "POST /v1/characters": { notContent: VOICE_PREVIEW },
  "POST /v1/creatures": { notContent: VOICE_PREVIEW },
  "POST /v1/node-presets": NODE_PRESET,
  "PATCH /v1/node-presets/:id": NODE_PRESET,
  "POST /v1/node-presets/import": NODE_PRESET,
})

/** Whether an exemption names this route: its exact pattern, or a prefix of its path. */
export function exemptionOf(route: string): string | undefined {
  if (Object.hasOwn(EXEMPT_ROUTES, route)) return route
  const path = route.slice(route.indexOf(" ") + 1)
  return Object.keys(EXEMPT_ROUTES).find((key) => key.startsWith("/") && key.endsWith("/") && path.startsWith(key))
}

const EMPTY: InputLinkReading = Object.freeze({})

/** The reading of a route's body (`METHOD /pattern`), or null when its body is not judged. */
export function inputLinkReadingForRoute(route: string): InputLinkReading | null {
  if (exemptionOf(route) !== undefined) return null
  return Object.hasOwn(ROUTE_READINGS, route) ? ROUTE_READINGS[route]! : EMPTY
}

// ── The workflow lane ──────────────────────────────────────────────────────

const RESULT = "a result this node produced on an earlier run, not an input it takes"
const SOURCE = "a source node's own file: the node is never executed; the node it feeds judges what it hands on"
const VIDEO_LINK = "the Video URL node: its link is judged before the run starts, by the link-import switch itself (workers/orchestrator-video-links.ts)"

/** A node setting named `generated…` (`generatedVideoUrl`, `generatedLayerUrls`) is a result a run wrote, never an input: by its name, on every node type. */
export function isNodeResultField(key: string): boolean {
  return /^generated[A-Z]/.test(key)
}

/**
 * Settings a node's data holds under a media name that are no input of the
 * node itself: its own results, an endpoint it posts to, a source node's
 * file. The workflow lane leaves them out of the node's reading
 * (`services/workflow-engine/node-input-links.ts`); every other setting the
 * workflow import reads as media is judged. The census holds the list to the
 * settings every node type declares, both ways.
 */
export const NODE_DATA_NOT_INPUT: Readonly<Record<string, Readonly<Record<string, string>>>> = Object.freeze({
  "audio-separation": { bassUrl: RESULT, drumsUrl: RESULT, guitarUrl: RESULT, instrumentalUrl: RESULT, otherUrl: RESULT, pianoUrl: RESULT, vocalUrl: RESULT },
  "save-to-storage": { savedUrl: RESULT },
  "reference-sheet": { panelUrls: "the panels of the sheet the node composes, made from its entity's own pictures (judged where they were set)" },
  "webhook-output": { url: "the caller's own webhook the node posts the run's result to: outbound" },
  "youtube-video": { youtubeUrl: VIDEO_LINK, downloadIdUrl: VIDEO_LINK, downloadedFromUrl: VIDEO_LINK, downloadedVideoUrl: VIDEO_LINK, downloadedAudioUrl: VIDEO_LINK },
  "reference-audio": { directUrl: SOURCE, extractedAudioUrl: SOURCE, uploadedFileUrl: SOURCE, youtubeUrl: SOURCE },
  "upload-audio": { externalUrl: SOURCE, r2Url: SOURCE, url: SOURCE },
  "upload-image": { externalUrl: SOURCE, r2Url: SOURCE, url: SOURCE },
  "upload-video": { externalUrl: SOURCE, r2Url: SOURCE, url: SOURCE },
  "paint-mask": { maskUrl: SOURCE },
  "suno-voice": { sourceAudioUrl: SOURCE, verifyAudioUrl: SOURCE },
  "content-recipe": { sourceUrl: CITED_LINK },
})

/**
 * What a node's wires hand it, and what its build sends, that is no media it
 * takes in, by node type: `inputs` names keys of its resolved inputs,
 * `payload` keys of its built payload (a worker's job, a route's body).
 */
export const NODE_IO_NOT_CONTENT: Readonly<Record<string, { readonly inputs?: Readonly<Record<string, string>>; readonly payload?: Readonly<Record<string, string>> }>> = Object.freeze({
  "content-recipe": { inputs: { sourceLink: CITED_LINK }, payload: { sourceUrl: CITED_LINK } },
})

/**
 * Node types whose run is not judged at all, and why: what they take is kept
 * as data, and judged where a run uses it.
 */
export const NODE_TYPES_NOT_JUDGED: Readonly<Record<string, string>> = Object.freeze({
  "collection-write": COLLECTION_RECORD,
})
