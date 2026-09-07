/**
 * Section 1 — `production`: the document's own settings.
 *
 * Nine operations, each the server-side twin of one studio store reducer (spec
 * §6): the production's name and thumbnail, its soft-hide flag, the selected
 * shot, the production-wide film look, the soundtrack and its plan, and the
 * storyboard's merge.
 *
 * Two of them address the workflow ROW rather than `settings.studio` —
 * `set_name` and `set_thumbnail` write `name` / `thumbnailUrl`, columns that
 * are not part of a {@link Production}. Their handlers return the production
 * untouched and put the intended column value on the receipt's `row` field; the
 * route applies it in the same CAS write (`SECTIONS.md` §1).
 *
 * The copy discipline mirrors the store's exactly: the film map goes through a
 * key-by-key copy (the store's `copyLook`) and the soundtrack plan through
 * {@link copyMusicPlan}, so neither the document nor a later save can alias a
 * caller's object. Clearing REMOVES the key rather than setting `undefined`, so
 * a cleared soundtrack serializes the way an absent one does.
 */
import { z } from "zod"

import { copyMusicPlan } from "../../shot"
import { copyLookMap } from "../../shot-graph-wire"
import { opError } from "../errors"
import type { Production } from "../production"
import type { SectionClasses, SectionHandlers } from "../types"

// ── the argument shapes (§6, verbatim) ──────────────────────────────────────

/** A cinematic selection: `pickerKey → catalog id(s)` (`LookSelectionMap`). */
const lookSelectionMapSchema = z.record(
  z.string(),
  z.union([z.string(), z.array(z.string())]),
)

/** The Soundtrack picker selections (`MusicSelections`). */
const musicSelectionsSchema = z.object({
  vocals: z.enum(["instrumental", "vocals"]),
  vocalGender: z.enum(["any", "male", "female"]),
  genre: z.string().optional(),
  mood: z.string().optional(),
  instruments: z.array(z.string()),
  singingStyle: z.string().optional(),
  language: z.string().optional(),
})

/** A generated soundtrack (`ProductionMusic`). */
const productionMusicSchema = z.object({
  url: z.string(),
  prompt: z.string(),
  duration: z.number().optional(),
  provider: z.string().optional(),
})

/** The soundtrack PLAN — authoring intent, kept beside a generated track. */
const planMusicSchema = z.object({
  prompt: z.string(),
  duration: z.number().optional(),
  selections: musicSelectionsSchema.optional(),
})

/** A storyboard patch (`Partial<StoryboardSettings>`; `brief` lives here). */
const storyboardPatchSchema = z.object({
  on: z.boolean().optional(),
  brief: z.string().optional(),
  filmLength: z.number().optional(),
  scripts: z.record(z.string(), z.string()).optional(),
  breakdowns: z.record(z.string(), z.string()).optional(),
  seconds: z.record(z.string(), z.number()).optional(),
})

export const productionOpSchemas = {
  set_name: z.object({ op: z.literal("set_name"), name: z.string() }),
  set_thumbnail: z.object({
    op: z.literal("set_thumbnail"),
    url: z.string().nullable(),
  }),
  set_archived: z.object({
    op: z.literal("set_archived"),
    archived: z.boolean(),
  }),
  select_shot: z.object({ op: z.literal("select_shot"), shotId: z.string() }),
  set_film: z.object({ op: z.literal("set_film"), film: lookSelectionMapSchema }),
  set_music_plan: z.object({
    op: z.literal("set_music_plan"),
    plan: planMusicSchema.nullable(),
  }),
  set_music: z.object({ op: z.literal("set_music"), music: productionMusicSchema }),
  clear_music: z.object({ op: z.literal("clear_music") }),
  set_storyboard: z.object({
    op: z.literal("set_storyboard"),
    patch: storyboardPatchSchema,
  }),
} as const

// ── receipt helpers ─────────────────────────────────────────────────────────

/**
 * A shot the way the user sees it: its own name when it has one, otherwise
 * `Shot <n>` by its 1-based timeline position (`SECTIONS.md`, "How a receipt
 * reads"). Never an id — minted ids ride `receipt.ids`.
 */
function shotLabel(production: Production, shotId: string): string {
  const index = production.shots.findIndex((shot) => shot.id === shotId)
  const name = production.shots[index]?.name?.trim()
  return name ? `“${name}”` : `Shot ${index + 1}`
}

/** `1 pick` / `3 picks` — the trailing parenthetical of a look receipt. */
function pickCount(count: number): string {
  return count === 1 ? "1 pick" : `${count} picks`
}

/** Drop one optional key from a production, copy-on-write. */
function without<K extends "music" | "musicPlan">(
  production: Production,
  key: K,
): Production {
  const next: Production = { ...production }
  delete next[key]
  return next
}

// ── the handlers ────────────────────────────────────────────────────────────

export const productionHandlers: SectionHandlers<typeof productionOpSchemas> = {
  // The workflow ROW's `name`: the production is handed back untouched and the
  // column rides the receipt (`SECTIONS.md` §1).
  set_name: (production, op) => ({
    production,
    receipt: {
      op: "set_name",
      summary: `Renamed the production to “${op.name}”.`,
      row: { name: op.name },
    },
  }),

  // The workflow ROW's `thumbnailUrl`; `null` clears the dashboard card image.
  set_thumbnail: (production, op) => ({
    production,
    receipt: {
      op: "set_thumbnail",
      summary:
        op.url === null
          ? "Cleared the production thumbnail."
          : "Set the production thumbnail.",
      row: { thumbnailUrl: op.url },
    },
  }),

  // The dashboard SOFT-hide (`setArchived`): the workflow and its graph stay.
  set_archived: (production, op) => {
    const already = production.archived === op.archived
    return {
      production: { ...production, archived: op.archived },
      receipt: {
        op: "set_archived",
        summary: op.archived
          ? "Archived the production."
          : "Restored the production from the archive.",
      },
      ...(already
        ? {
            warnings: [
              op.archived
                ? "The production was already archived."
                : "The production was not archived.",
            ],
          }
        : {}),
    }
  },

  // `selectShot`, generalised: an operation addresses by stable key, so a shot
  // that is not in the document is refused rather than parked in the selection.
  select_shot: (production, op) => {
    if (!production.shots.some((shot) => shot.id === op.shotId)) {
      throw opError(
        "op_target_missing",
        `No shot ${op.shotId} in this production.`,
      )
    }
    return {
      production: { ...production, selectedShotId: op.shotId },
      receipt: {
        op: "select_shot",
        summary: `Selected ${shotLabel(production, op.shotId)}.`,
      },
    }
  },

  // `setProductionFilm` — a REPLACE, copied key by key (the store's `copyLook`).
  set_film: (production, op) => {
    const film = copyLookMap(op.film)
    const count = Object.keys(film).length
    return {
      production: { ...production, film },
      receipt: {
        op: "set_film",
        summary: count
          ? `Set the film look (${pickCount(count)}).`
          : "Cleared the film look.",
      },
    }
  },

  // `setMusicPlan` — a REPLACE through {@link copyMusicPlan}; `null` clears it.
  set_music_plan: (production, op) => {
    if (op.plan === null) {
      return {
        production: without(production, "musicPlan"),
        receipt: {
          op: "set_music_plan",
          summary: "Cleared the soundtrack plan.",
        },
      }
    }
    const plan = copyMusicPlan(op.plan)
    return {
      production: { ...production, musicPlan: plan },
      receipt: {
        op: "set_music_plan",
        summary: `Set the soundtrack plan to “${plan.prompt}”.`,
      },
    }
  },

  // `setMusic` — the one production soundtrack, muxed over the export.
  set_music: (production, op) => {
    const prompt = op.music.prompt.trim()
    return {
      production: { ...production, music: { ...op.music } },
      receipt: {
        op: "set_music",
        summary: prompt
          ? `Set the soundtrack to “${prompt}”.`
          : "Set the soundtrack.",
      },
    }
  },

  // `setMusic(undefined)` — the key goes away, so a cleared soundtrack
  // serializes exactly the way an absent one does.
  clear_music: (production) => ({
    production: without(production, "music"),
    receipt: { op: "clear_music", summary: "Removed the soundtrack." },
    ...(production.music
      ? {}
      : { warnings: ["There was no soundtrack to remove."] }),
  }),

  // `setStoryboard` — a MERGE, never a replace: a patch cannot drop a key (the
  // studio's `resetStoryboard` is the only way one goes away, and it is a
  // hydrate concern with no operation of its own).
  set_storyboard: (production, op) => {
    const keys = Object.keys(op.patch)
    return {
      production: {
        ...production,
        storyboard: { ...production.storyboard, ...op.patch },
      },
      receipt: {
        op: "set_storyboard",
        summary: keys.length
          ? `Updated the storyboard (${keys.join(", ")}).`
          : "Left the storyboard unchanged.",
      },
      ...(keys.length
        ? {}
        : {
            warnings: ["The storyboard patch was empty; nothing changed."],
          }),
    }
  },
}

// ── the confirmation classes (spec §6) ──────────────────────────────────────

export const productionOpClasses: SectionClasses<typeof productionOpSchemas> = {
  set_name: "S",
  set_thumbnail: "S",
  // Hiding a production from the dashboard reads as a delete to the person
  // doing it, so it confirms like one (§6: "D when true").
  set_archived: "D",
  select_shot: "S",
  set_film: "S",
  set_music_plan: "S",
  set_music: "S",
  clear_music: "D",
  set_storyboard: "S",
}
