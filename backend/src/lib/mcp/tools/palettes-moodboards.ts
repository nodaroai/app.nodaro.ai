import { z } from "zod"
import { nearestColorName } from "@nodaro/prompts/prompt-builder"
import { passesGate, type ToolGate } from "../tool-schemas.js"
import { mcpInject } from "../internal-request.js"
import { resolveAssetId } from "../asset-resolver.js"
import type { RegisterOpts } from "./verbs-image.js"
import { errorResult } from "./_verb-helpers.js"

const readGate: ToolGate = { required: ["assets:read"] }
const writeGate: ToolGate = { required: ["assets:write"] }

type ToolText = { content: Array<{ type: "text"; text: string }>; isError?: true }

interface PaletteView { id: string; name: string; colors: string[]; description: string | null }
interface MoodboardView { id: string; name: string; description: string | null; images: Array<{ url: string; caption?: string }> }
interface Page<T> { data: T[]; nextCursor: string | null }

function text(value: string): ToolText {
  return { content: [{ type: "text" as const, text: value }] }
}

function fail(value: string): ToolText {
  return { content: [{ type: "text" as const, text: value }], isError: true as const }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** The refusal for an id that is not one (a uuid): the id goes into a route
 *  path, so nothing else may ever reach it (`../api-tokens`). Null when fine. */
function badId(id: string | undefined, list: "list_palettes" | "list_moodboards"): ToolText | null {
  return id !== undefined && !UUID_RE.test(id) ? fail(`id must be an id from ${list}.`) : null
}

/** One palette for the model: its colours named (the words the prompt gets), and its id. */
export function paletteLine(p: PaletteView): string {
  const colors = p.colors.map((c) => `${nearestColorName(c)} ${c}`).join(", ")
  return `- ${p.name} — ${colors}${p.description ? ` · ${p.description}` : ""} (id ${p.id})`
}

/** One moodboard for the model: name, size, description, id. */
export function moodboardLine(m: MoodboardView): string {
  const images = m.images.length === 1 ? "1 image" : `${m.images.length} images`
  return `- ${m.name} — ${images}${m.description ? ` · ${m.description}` : ""} (id ${m.id})`
}

type CallResult = { ok: false; error: ToolText } | { ok: true; body: unknown }

/** One route call. The request is an object literal at every call site, so the
 *  surface checker reads each call's method beside its url. */
async function call(opts: RegisterOpts, request: { method: "GET" | "POST" | "PATCH"; url: string; query?: Record<string, string>; payload?: object }): Promise<CallResult> {
  const res = await mcpInject(opts.fastify, opts.session, request)
  if (res.statusCode >= 400) return { ok: false, error: errorResult(res.statusCode, res.body) }
  return { ok: true, body: JSON.parse(res.body) as unknown }
}

const more = (cursor: string | null) => (cursor ? `\n\nMore: call again with cursor "${cursor}".` : "")
const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/)

/** Only the fields the caller gave, so an update leaves the rest alone. */
function given<T extends Record<string, unknown>>(fields: T): Partial<T> {
  return Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined)) as Partial<T>
}

/**
 * Colour palettes and moodboards over MCP (`/v1/palettes`, `/v1/moodboards`):
 * every edition. Reads under assets:read, writes under assets:write — the
 * scopes the REST routes ask an OAuth app for. A palette or moodboard steers
 * generate_image through its `palette_id` / `moodboard_id`. No delete here: a
 * person deletes in the app, the CLI or the API.
 */
export function registerPaletteMoodboardTools(opts: RegisterOpts): void {
  const { server, session } = opts

  if (passesGate(session, readGate)) {
    server.registerTool(
      "list_palettes",
      {
        title: "List Palettes",
        description: "The user's colour palettes, newest first: name, colours (named, with hex), id. Pass one to generate_image as palette_id.",
        inputSchema: { cursor: z.string().max(512).optional().describe("nextCursor from the previous call.") },
        annotations: { readOnlyHint: true },
      },
      async (args) => {
        const got = await call(opts, { method: "GET", url: "/v1/palettes", ...(args.cursor ? { query: { cursor: args.cursor } } : {}) })
        if (!got.ok) return got.error
        const page = got.body as Page<PaletteView>
        if (page.data.length === 0) return text("No palettes.")
        return text(page.data.map(paletteLine).join("\n") + more(page.nextCursor))
      },
    )

    server.registerTool(
      "list_moodboards",
      {
        title: "List Moodboards",
        description: "The user's moodboards, newest first: name, image count, description, id — or one in full (image links, captions) by id. Pass one to generate_image as moodboard_id.",
        inputSchema: {
          id: z.string().max(36).optional().describe("Read this moodboard in full."),
          cursor: z.string().max(512).optional().describe("nextCursor from the previous call."),
        },
        annotations: { readOnlyHint: true },
      },
      async (args) => {
        const refused = badId(args.id, "list_moodboards")
        if (refused) return refused
        if (args.id) {
          const got = await call(opts, { method: "GET", url: `/v1/moodboards/${encodeURIComponent(args.id)}` })
          if (!got.ok) return got.error
          const m = got.body as MoodboardView
          const images = m.images.map((img, i) => `${i + 1}. ${img.url}${img.caption ? ` — ${img.caption}` : ""}`).join("\n")
          return text(`${moodboardLine(m)}\n${images}`)
        }
        const got = await call(opts, { method: "GET", url: "/v1/moodboards", ...(args.cursor ? { query: { cursor: args.cursor } } : {}) })
        if (!got.ok) return got.error
        const page = got.body as Page<MoodboardView>
        if (page.data.length === 0) return text("No moodboards.")
        return text(page.data.map(moodboardLine).join("\n") + more(page.nextCursor))
      },
    )
  }

  if (passesGate(session, writeGate)) {
    server.registerTool(
      "save_palette",
      {
        title: "Save Palette",
        description: "Create a colour palette (name + 2–12 #RRGGBB colours), or change one by id. Returns its id.",
        inputSchema: {
          id: z.string().max(36).optional().describe("Change this palette; omit to create."),
          name: z.string().min(1).max(80).optional(),
          colors: z.array(hex).min(2).max(12).optional(),
          description: z.string().max(500).optional(),
        },
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
      },
      async (args) => {
        const refused = badId(args.id, "list_palettes")
        if (refused) return refused
        const fields = given({ name: args.name, colors: args.colors, description: args.description })
        if (!args.id && (!fields.name || !fields.colors)) return fail("A new palette needs a name and 2–12 colours.")
        const got = args.id
          ? await call(opts, { method: "PATCH", url: `/v1/palettes/${encodeURIComponent(args.id)}`, payload: fields })
          : await call(opts, { method: "POST", url: "/v1/palettes", payload: fields })
        if (!got.ok) return got.error
        const p = got.body as PaletteView
        return text(`Palette ${args.id ? "saved" : "created"}: ${paletteLine(p).slice(2)}`)
      },
    )

    server.registerTool(
      "save_moodboard",
      {
        title: "Save Moodboard",
        description:
          "Create a moodboard (name, 1–12 images, optional description = the words the prompt gets), or change one by id (images replace all). Returns its id.",
        inputSchema: {
          id: z.string().max(36).optional().describe("Change this moodboard; omit to create."),
          name: z.string().min(1).max(80).optional(),
          description: z.string().max(1000).optional(),
          images: z
            .array(z.object({ url: z.string().min(1).describe("Image URL or Nodaro asset id."), caption: z.string().max(200).optional() }))
            .min(1)
            .max(12)
            .optional(),
        },
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
      },
      async (args) => {
        const refused = badId(args.id, "list_moodboards")
        if (refused) return refused
        let images: Array<{ url: string; caption?: string }> | undefined
        if (args.images) {
          images = []
          for (const image of args.images) {
            let url = image.url
            if (!/^https?:\/\//i.test(url)) {
              try {
                url = (await resolveAssetId({ assetId: url, userId: session.userId, expectedKind: "image" })) ?? ""
              } catch {
                url = ""
              }
              if (!url) return fail(`Image "${image.url}" is neither a URL nor one of the user's image assets.`)
            }
            images.push(image.caption ? { url, caption: image.caption } : { url })
          }
        }
        const fields = given({ name: args.name, description: args.description, images })
        if (!args.id && (!fields.name || !fields.images)) return fail("A new moodboard needs a name and 1–12 images.")
        const got = args.id
          ? await call(opts, { method: "PATCH", url: `/v1/moodboards/${encodeURIComponent(args.id)}`, payload: fields })
          : await call(opts, { method: "POST", url: "/v1/moodboards", payload: fields })
        if (!got.ok) return got.error
        const m = got.body as MoodboardView
        return text(`Moodboard ${args.id ? "saved" : "created"}: ${moodboardLine(m).slice(2)}`)
      },
    )
  }
}
