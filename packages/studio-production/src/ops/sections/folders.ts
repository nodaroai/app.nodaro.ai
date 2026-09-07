/**
 * The `folders` section — the production's named timeline groups.
 *
 * Four operations, the server-side twins of `addFolder` / `renameFolder` /
 * `removeFolder` / `moveShotToFolder` in the studio store
 * (`production-store-shots.ts`). A folder is a `{ id, name }` row in
 * `production.folders`; a shot joins one by carrying its id in `shot.folderId`,
 * and the default unfiled group is the ABSENCE of that key — never the key set
 * to `undefined`. The serializer writes `folderId` only when it is truthy, so
 * that distinction is visible in the persisted document; every handler here
 * deletes the key rather than blanking it, exactly as the reducers do.
 *
 * Two places these ops deliberately part company with the reducers, both for
 * the same reason — the store can afford to return the state it was handed
 * when a UI action addresses nothing, and an operation cannot (a caller that
 * asked to rename a folder that does not exist has made a mistake worth
 * reporting, and `applyOps` is atomic so the mistake must reject the batch):
 *
 *  - a folder id, or a shot id, that names nothing is `op_target_missing`,
 *    including `move_shot_to_folder`'s destination — which the store does not
 *    validate at all, because its dropdown can only offer folders that exist;
 *  - a name that is blank once trimmed is `op_invalid`, where `renameFolder`
 *    returns `state`.
 *
 * A no-op that names real things is not an error: filing a shot into the folder
 * it is already in returns the document untouched with a warning, which is what
 * the warnings channel is for.
 */
import { z } from "zod"

import type { Shot } from "../../shot"
import { opError } from "../errors"
import type { Production } from "../production"
import type { SectionClasses, SectionHandlers } from "../types"

// ── schemas (SECTIONS.md §2) ────────────────────────────────────────────────

export const foldersOpSchemas = {
  add_folder: z.object({
    op: z.literal("add_folder"),
    id: z.string(),
    name: z.string(),
  }),
  rename_folder: z.object({
    op: z.literal("rename_folder"),
    id: z.string(),
    name: z.string(),
  }),
  remove_folder: z.object({
    op: z.literal("remove_folder"),
    id: z.string(),
  }),
  move_shot_to_folder: z.object({
    op: z.literal("move_shot_to_folder"),
    shotId: z.string(),
    /** `null` = out of every folder (the store's `undefined`). */
    folderId: z.string().nullable(),
  }),
} as const

// ── local helpers ───────────────────────────────────────────────────────────
//
// Both are small and pure and live here because the codec has no equivalent:
// it labels shots only for node titles (`shot-graph-write.ts`), which is a
// different string with a different audience. Reported under rule 7.

/** The folder with this id, or a refusal naming it. */
function requireFolder(production: Production, id: string) {
  const folder = production.folders?.find((f) => f.id === id)
  if (!folder) {
    throw opError("op_target_missing", `No folder ${id} in this production.`)
  }
  return folder
}

/**
 * How a shot is named to a person: its own name when it has one, otherwise its
 * 1-based position in the timeline. Never its id — receipts carry no ids.
 */
function shotLabel(shot: Shot, index: number): string {
  return shot.name ?? `Shot ${index + 1}`
}

/** A copy of `shot` with no folder assignment — the KEY dropped, not blanked. */
function unfiled(shot: Shot): Shot {
  const next = { ...shot }
  delete (next as { folderId?: string }).folderId
  return next
}

/** A trimmed name, or a refusal — a blank folder name is not a name. */
function requireName(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) throw opError("op_invalid", "A folder needs a name.")
  return trimmed
}

// ── handlers ────────────────────────────────────────────────────────────────

export const foldersHandlers: SectionHandlers<typeof foldersOpSchemas> = {
  add_folder: (production, op) => {
    const name = requireName(op.name)
    const folders = production.folders ?? []
    if (folders.some((f) => f.id === op.id)) {
      throw opError("op_invalid", `This production already has a folder ${op.id}.`)
    }
    return {
      production: { ...production, folders: [...folders, { id: op.id, name }] },
      receipt: { op: "add_folder", summary: `Added the folder “${name}”.` },
    }
  },

  rename_folder: (production, op) => {
    const folder = requireFolder(production, op.id)
    const name = requireName(op.name)
    return {
      production: {
        ...production,
        folders: (production.folders ?? []).map((f) =>
          f.id === op.id ? { ...f, name } : f,
        ),
      },
      receipt: {
        op: "rename_folder",
        summary: `Renamed the folder “${folder.name}” to “${name}”.`,
      },
    }
  },

  remove_folder: (production, op) => {
    const folder = requireFolder(production, op.id)
    // The folder goes; its shots stay and fall back to the unfiled group.
    const shots = production.shots.map((shot) =>
      shot.folderId === op.id ? unfiled(shot) : shot,
    )
    const orphans = production.shots.filter((s) => s.folderId === op.id).length
    return {
      production: {
        ...production,
        folders: (production.folders ?? []).filter((f) => f.id !== op.id),
        shots,
      },
      receipt: {
        op: "remove_folder",
        summary: orphans
          ? `Removed the folder “${folder.name}” (${orphans} shot${
              orphans === 1 ? "" : "s"
            } unfiled).`
          : `Removed the folder “${folder.name}”.`,
      },
    }
  },

  move_shot_to_folder: (production, op) => {
    const index = production.shots.findIndex((s) => s.id === op.shotId)
    const shot = production.shots[index]
    if (!shot) {
      throw opError(
        "op_target_missing",
        `No shot ${op.shotId} in this production.`,
      )
    }
    const folder = op.folderId ? requireFolder(production, op.folderId) : null
    const label = shotLabel(shot, index)

    if ((shot.folderId ?? null) === (op.folderId ?? null)) {
      return {
        production,
        receipt: {
          op: "move_shot_to_folder",
          summary: folder
            ? `Moved ${label} into “${folder.name}”.`
            : `Moved ${label} out of its folder.`,
        },
        warnings: [
          folder
            ? `${label} was already in that folder.`
            : `${label} was already out of every folder.`,
        ],
      }
    }

    const shots = production.shots.map((s, i) => {
      if (i !== index) return s
      return folder ? { ...s, folderId: folder.id } : unfiled(s)
    })
    return {
      production: { ...production, shots },
      receipt: {
        op: "move_shot_to_folder",
        summary: folder
          ? `Moved ${label} into “${folder.name}”.`
          : `Moved ${label} out of its folder.`,
      },
    }
  },
}

// ── classes ─────────────────────────────────────────────────────────────────
//
// All four are safe: a folder is a grouping, and removing one moves no media
// and destroys nothing — its shots survive it, unfiled.

export const foldersOpClasses: SectionClasses<typeof foldersOpSchemas> = {
  add_folder: "S",
  rename_folder: "S",
  remove_folder: "S",
  move_shot_to_folder: "S",
}
