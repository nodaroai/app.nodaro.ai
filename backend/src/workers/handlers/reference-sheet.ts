import type { Job } from "bullmq"
import { supabase } from "../../lib/supabase.js"
import { safeFetch } from "../../lib/safe-fetch.js"
import sharp from "sharp"
import { uploadBufferToR2 } from "../../lib/storage.js"
import { composeSheet, sheetSlots, extractPalette } from "../../services/reference-sheet/index.js"
import type { ComposeInput } from "../../services/reference-sheet/index.js"
import { resolvePanels, type EntityBuckets } from "../../services/reference-sheet/resolve-panels.js"
import { resolveMotionPanels } from "../../services/reference-sheet/resolve-motion-panels.js"
import { composeMotionSheet } from "../../services/reference-sheet/motion-compositor.js"
import { buildResolvedSections, buildMotionBackgroundSections } from "../../services/reference-sheet/build-sections.js"
import { buildSheetMetadata } from "../../services/reference-sheet/sheet-text.js"
import { attachAssetToCharacter, type CharacterAssetItem } from "../../lib/character-auto-attach.js"
import { autoAttachObjectAsset } from "../../lib/object-auto-attach.js"
import { autoAttachLocationAsset } from "../../lib/location-auto-attach.js"
import { MOTION_COLUMN, resolveSheetSections } from "@nodaro/shared"
import type { SheetSection, SheetFlavour, SheetSkin, SheetType, EntityKind } from "@nodaro/shared"
import { shouldSaveJobResult, markJobCompleted, commitJobCredits, type HandlerFn, type JobContext } from "../shared.js"

const TABLE: Record<EntityKind, string> = { character: "characters", object: "objects", location: "locations" }

/** A sheet record appended to an entity's `sheets` bucket. `name` + `url` are
 *  the minimum every attach helper requires; the rest is descriptive metadata
 *  stored verbatim as JSONB by the RPC. */
type SheetItem = CharacterAssetItem & Record<string, unknown>

async function fetchBuffer(url: string): Promise<Buffer> {
  const res = await safeFetch(url)
  if (!res.ok) throw new Error(`reference-sheet panel fetch ${res.status}: ${url}`)
  const buf = Buffer.from(await res.arrayBuffer())
  // Decode-validate: a 200 can still carry non-image bytes (an expired signed
  // URL serving HTML, a truncated object). Probe with Sharp so a corrupt panel
  // is dropped by the allSettled caller and a corrupt hero degrades to "no
  // thumbnail" — instead of throwing deep inside composeSheet and failing the
  // whole sheet (spec §13: one bad panel must not sink the entire compose).
  await sharp(buf).metadata()
  return buf
}

async function attachSheet(kind: EntityKind, id: string, userId: string, item: SheetItem): Promise<void> {
  if (kind === "character") await attachAssetToCharacter({ characterId: id, userId, column: "sheets", item })
  else if (kind === "object") await autoAttachObjectAsset({ objectId: id, userId, column: "sheets", name: item.name, url: item.url, item })
  else await autoAttachLocationAsset({ locationId: id, userId, column: "sheets", name: item.name, url: item.url, item })
}

const handleReferenceSheet: HandlerFn = async function handleReferenceSheet(job: Job, ctx: JobContext) {
  const data = job.data as {
    jobId: string; userId: string; type: SheetType; skin: SheetSkin; flavour: SheetFlavour
    entityKind?: EntityKind; entityDbId?: string; imageUrl?: string
  }
  const flavour = data.flavour
  const entityKind: EntityKind = data.entityKind ?? "character"
  // The Studio "Sheet" tab sends an explicit section stack in `flavour.sections`;
  // the canvas node, workflow runs, and API/MCP callers send only `type`. Expand
  // it into the default stack for (entityKind, type) — otherwise the sheet
  // composes with zero bands (a blank image). Shared single source of truth.
  const sections: SheetSection[] = resolveSheetSections(entityKind, data.type, flavour.sections)

  // Load the owned entity row + buckets (entity mode).
  let heroUrl = data.imageUrl
  let buckets: EntityBuckets = {}
  let title: string | undefined
  let notes: string | undefined
  let metadata: Record<string, string> | undefined
  if (data.entityKind && data.entityDbId) {
    const { data: row } = await supabase
      .from(TABLE[data.entityKind]).select("*")
      .eq("id", data.entityDbId).eq("user_id", ctx.jobUserId).is("deleted_at", null).single()
    if (!row) throw new Error("entity_not_found")
    heroUrl = (row.source_image_url as string | null) ?? heroUrl
    buckets = row as EntityBuckets
    title = (row.name as string | undefined) ?? undefined
    notes = (row.description as string | undefined) ?? undefined
    metadata = buildSheetMetadata(data.entityKind, row as Record<string, unknown>)
  }

  // Hero buffer + palette are needed by BOTH branches (header thumbnail + the
  // color-palette section). Both are best-effort: a corrupt/expired hero or a
  // palette-extraction failure must NOT fail the whole sheet (spec §13 — "palette
  // failure → neutral default; sheet still composes"). On failure the header just
  // omits its thumbnail and the palette band renders empty.
  let heroBuf: Buffer | undefined
  if (heroUrl) {
    try { heroBuf = await fetchBuffer(heroUrl) } catch { heroBuf = undefined }
  }
  let palette: Awaited<ReturnType<typeof extractPalette>> = []
  if (heroBuf) {
    try { palette = await extractPalette(heroBuf, 5) } catch { palette = [] }
  }

  // ── Motion sheets: render the chrome as a background PNG (empty slots) then
  // overlay the entity's motion clips into the slot rectangles via FFmpeg → MP4.
  // Compose-only: uses clips already present in the entity's flat motion bucket;
  // missing clips are simply absent (their slot stays the static background).
  if (flavour.outputFormat === "motion") {
    const motionBucket = (buckets[MOTION_COLUMN[entityKind]] ?? []) as Array<{ name?: string; url?: string }>
    const { present: motionPresent } = resolveMotionPanels(entityKind, sections, flavour, motionBucket)
    // Charge-for-nothing guard (spec §13): with zero present clips a motion sheet
    // is just the static chrome rendered as a video, yet commit would still bill
    // the 6cr assembly fee. Fail BEFORE markJobCompleted so the worker's refund
    // path returns the fee (covers raw-image + workflow-run on an empty entity).
    if (motionPresent.length === 0) {
      throw new Error("no_panels: the connected entity has no motion clips for this sheet")
    }
    const motionUrls = motionPresent.map((p) => p.url)
    // Background chrome PNG with one EMPTY slot per PRESENT motion clip (NOT the
    // still `resolved`, whose slots track still-panel presence — they can diverge
    // from motion presence). `buildMotionBackgroundSections` re-resolves the same
    // motion bucket per section in the same order as `motionPresent`, so
    // `sheetSlots(bgInput)` yields exactly `motionUrls.length` slots in the SAME
    // order → the Nth clip overlays into the Nth slot.
    const bgSections = buildMotionBackgroundSections(sections, flavour, entityKind, { title, metadata, notes, heroBuf, palette, motionBucket })
    const bgInput: ComposeInput = { skin: data.skin, aspect: flavour.aspect, sections: bgSections, withText: flavour.withText, showLabels: flavour.showLabels, slotsMode: "background" }
    const backgroundPng = await composeSheet(bgInput)
    const slots = sheetSlots(bgInput)
    const videoUrl = await composeMotionSheet({ jobId: ctx.jobId, userId: ctx.jobUserId, backgroundPng, slots, clipUrls: motionUrls })

    if (!(await shouldSaveJobResult(ctx.jobId))) return

    if (data.entityDbId && data.entityKind && ctx.jobUserId) {
      const item: SheetItem = {
        name: `${data.type} · ${data.skin} (motion)`, url: videoUrl, type: data.type, skin: data.skin, flavour, source: "node", panelUrls: motionUrls,
      }
      await attachSheet(data.entityKind, data.entityDbId, ctx.jobUserId, item)
    }

    // Emit both videoUrl (for video consumers / the node) AND imageUrl (same MP4
    // URL) so getPrimaryOutput's `videoUrl ?? imageUrl` resolves on either handle.
    const okMotion = await markJobCompleted(ctx.jobId, { output_data: { videoUrl, imageUrl: videoUrl, panelUrls: motionUrls } })
    if (!okMotion) return
    await commitJobCredits(ctx.usageLogId, ctx.jobId)
    return
  }

  // ── Still sheets: resolve panels, fetch every panel buffer once, build the
  // resolved sections, then composite the panel images into the slots → PNG.
  // (The motion branch above never uses any of these, so this work is skipped
  // entirely in motion mode — up to 24 wasted R2 fetches avoided.)
  const { present } = resolvePanels(entityKind, sections, flavour, buckets)
  const panelUrls = present.map((p) => p.url)
  const uniqueUrls = [...new Set(panelUrls)]
  // allSettled, not all: one unreachable/expired panel URL must not fail the
  // whole sheet. A dropped URL is simply absent from panelBufByUrl, and
  // buildResolvedSections filters slots whose buffer isn't a Buffer (§13).
  const fetched = await Promise.allSettled(uniqueUrls.map(fetchBuffer))
  const panelBufByUrl: Record<string, Buffer> = {}
  uniqueUrls.forEach((u, i) => {
    const r = fetched[i]
    if (r.status === "fulfilled") panelBufByUrl[u] = r.value
  })
  // Charge-for-nothing guard (spec §13): with zero usable panel buffers the sheet
  // is just header/palette/notes chrome — raw-image mode, a workflow-run on an
  // entity with no generated panels, or every panel failing to fetch/decode — yet
  // commit would still bill the 4cr assembly fee. Fail BEFORE markJobCompleted so
  // the worker's refund path returns it. (Single-node Run generates panels in
  // Stage A first, so this only fires when there genuinely are none.)
  if (Object.keys(panelBufByUrl).length === 0) {
    throw new Error(
      "no_panels: no usable panels for this sheet — generate panels in the entity's Studio, or run the node directly to auto-generate them",
    )
  }
  const resolved = buildResolvedSections(sections, flavour, entityKind, { title, metadata, notes, heroBuf, palette, buckets, panelBufByUrl })
  const input: ComposeInput = { skin: data.skin, aspect: flavour.aspect, sections: resolved, withText: flavour.withText, showLabels: flavour.showLabels }
  const png = await composeSheet(input)
  const url = await uploadBufferToR2(png, `reference-sheets/${ctx.jobId}.png`, "image/png", ctx.jobUserId)

  if (!(await shouldSaveJobResult(ctx.jobId))) return

  if (data.entityDbId && data.entityKind && ctx.jobUserId) {
    const item: SheetItem = {
      name: `${data.type} · ${data.skin}`, url, type: data.type, skin: data.skin, flavour, source: "node", panelUrls,
    }
    await attachSheet(data.entityKind, data.entityDbId, ctx.jobUserId, item)
  }

  const ok = await markJobCompleted(ctx.jobId, { output_data: { imageUrl: url, panelUrls } })
  if (!ok) return
  await commitJobCredits(ctx.usageLogId, ctx.jobId)
}

export const referenceSheetHandlers: Record<string, HandlerFn> = { "reference-sheet": handleReferenceSheet }
