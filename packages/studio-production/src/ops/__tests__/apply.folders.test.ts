/**
 * The `folders` section, exercised.
 *
 * The studio store has NO tests for `addFolder` / `renameFolder` /
 * `removeFolder` / `moveShotToFolder` (the only folder assertions in
 * `production-store.test.ts` belong to `appendShots`, which is the `shots`
 * lane's port), so these are written from the reducers' behaviour in
 * `production-store-shots.ts:248-297` instead of ported. Three things they pin
 * that the reducers pin too:
 *
 *  - removing a folder UNFILES its shots and never removes them;
 *  - an unfiled shot carries no `folderId` KEY at all, rather than the key with
 *    `undefined` — the serializer writes `folderId` only when truthy, so the
 *    difference is visible in the persisted document even though `toEqual`
 *    cannot see it;
 *  - a blank name is refused, exactly where the store returns `state`.
 *
 * Where the op DIVERGES from the reducer it is because a silent no-op is not
 * available to it: a missing folder, a missing shot and a `folderId` naming no
 * folder are all `op_target_missing` here, where the store just returns the
 * state it was handed.
 */
import { describe, expect, it } from "vitest"

import { isOpError } from "../errors"
import type { Production } from "../production"
import type { OpContext } from "../types"
import { foldersHandlers, foldersOpClasses, foldersOpSchemas } from "../sections/folders"

const ctx: OpContext = { now: "2026-09-06T12:00:00.000Z", mintId: () => "id-1" }

/** Three shots: the middle one filed under "act-1", the others unfiled. */
function base(): Production {
  return {
    shots: [
      { id: "shot-1", name: "Opening" },
      { id: "shot-2", folderId: "act-1" },
      { id: "shot-3" },
    ],
    folders: [
      { id: "act-1", name: "Act I" },
      { id: "act-2", name: "Act II" },
    ],
  }
}

/** The `OpError` a call threw, or a failure if it threw something else. */
function refusal(run: () => unknown) {
  try {
    run()
  } catch (error) {
    if (!isOpError(error)) throw error
    return error
  }
  throw new Error("expected the handler to refuse this op")
}

describe("add_folder", () => {
  it("appends the folder under the id the caller minted", () => {
    const before = base()
    const result = foldersHandlers.add_folder(
      before,
      { op: "add_folder", id: "act-3", name: "Act III" },
      ctx,
    )

    expect(result.production.folders).toEqual([
      { id: "act-1", name: "Act I" },
      { id: "act-2", name: "Act II" },
      { id: "act-3", name: "Act III" },
    ])
    expect(result.production).not.toBe(before)
    expect(before.folders).toHaveLength(2)
    expect(result.receipt).toEqual({
      op: "add_folder",
      summary: "Added the folder “Act III”.",
    })
  })

  it("creates the folder list on a production that has none", () => {
    const result = foldersHandlers.add_folder(
      { shots: [] },
      { op: "add_folder", id: "act-1", name: "Act I" },
      ctx,
    )

    expect(result.production.folders).toEqual([{ id: "act-1", name: "Act I" }])
  })

  it("trims the name, and refuses one that is blank", () => {
    const named = foldersHandlers.add_folder(
      base(),
      { op: "add_folder", id: "act-3", name: "  Act III  " },
      ctx,
    )
    expect(named.production.folders?.[2]).toEqual({
      id: "act-3",
      name: "Act III",
    })

    const error = refusal(() =>
      foldersHandlers.add_folder(
        base(),
        { op: "add_folder", id: "act-3", name: "   " },
        ctx,
      ),
    )
    expect(error.code).toBe("op_invalid")
  })

  it("refuses an id the production already uses", () => {
    const error = refusal(() =>
      foldersHandlers.add_folder(
        base(),
        { op: "add_folder", id: "act-1", name: "Act I again" },
        ctx,
      ),
    )
    expect(error.code).toBe("op_invalid")
  })
})

describe("rename_folder", () => {
  it("renames just that folder", () => {
    const before = base()
    const result = foldersHandlers.rename_folder(
      before,
      { op: "rename_folder", id: "act-1", name: "Act One" },
      ctx,
    )

    expect(result.production.folders).toEqual([
      { id: "act-1", name: "Act One" },
      { id: "act-2", name: "Act II" },
    ])
    expect(before.folders?.[0]).toEqual({ id: "act-1", name: "Act I" })
    expect(result.receipt.summary).toBe(
      "Renamed the folder “Act I” to “Act One”.",
    )
  })

  it("trims the name, and refuses one that is blank", () => {
    const result = foldersHandlers.rename_folder(
      base(),
      { op: "rename_folder", id: "act-1", name: "  Act One  " },
      ctx,
    )
    expect(result.production.folders?.[0]?.name).toBe("Act One")

    const error = refusal(() =>
      foldersHandlers.rename_folder(
        base(),
        { op: "rename_folder", id: "act-1", name: " " },
        ctx,
      ),
    )
    expect(error.code).toBe("op_invalid")
  })

  it("refuses a folder that is not in the production", () => {
    const error = refusal(() =>
      foldersHandlers.rename_folder(
        base(),
        { op: "rename_folder", id: "nope", name: "Act One" },
        ctx,
      ),
    )
    expect(error.code).toBe("op_target_missing")
  })
})

describe("remove_folder", () => {
  it("removes the folder and UNFILES its shots, keeping every shot", () => {
    const before = base()
    const result = foldersHandlers.remove_folder(
      before,
      { op: "remove_folder", id: "act-1" },
      ctx,
    )

    expect(result.production.folders).toEqual([{ id: "act-2", name: "Act II" }])
    expect(result.production.shots).toHaveLength(3)
    expect(result.production.shots.map((s) => s.id)).toEqual([
      "shot-1",
      "shot-2",
      "shot-3",
    ])
    // The unfiled shot carries no `folderId` KEY — not the key set to undefined.
    expect("folderId" in result.production.shots[1]!).toBe(false)
    expect(before.shots[1]?.folderId).toBe("act-1")
    expect(result.receipt.summary).toBe(
      "Removed the folder “Act I” (1 shot unfiled).",
    )
  })

  it("leaves the shots of every other folder alone", () => {
    const result = foldersHandlers.remove_folder(
      base(),
      { op: "remove_folder", id: "act-2" },
      ctx,
    )

    expect(result.production.shots[1]?.folderId).toBe("act-1")
    expect(result.receipt.summary).toBe("Removed the folder “Act II”.")
  })

  it("refuses a folder that is not in the production", () => {
    const error = refusal(() =>
      foldersHandlers.remove_folder(base(), { op: "remove_folder", id: "nope" }, ctx),
    )
    expect(error.code).toBe("op_target_missing")
  })
})

describe("move_shot_to_folder", () => {
  it("files a shot under a folder", () => {
    const before = base()
    const result = foldersHandlers.move_shot_to_folder(
      before,
      { op: "move_shot_to_folder", shotId: "shot-3", folderId: "act-2" },
      ctx,
    )

    expect(result.production.shots[2]?.folderId).toBe("act-2")
    expect(result.production.shots[0]).toBe(before.shots[0])
    expect(before.shots[2]?.folderId).toBeUndefined()
    expect(result.receipt.summary).toBe("Moved Shot 3 into “Act II”.")
    expect(result.warnings).toBeUndefined()
  })

  it("names a shot by its own name when it has one", () => {
    const result = foldersHandlers.move_shot_to_folder(
      base(),
      { op: "move_shot_to_folder", shotId: "shot-1", folderId: "act-1" },
      ctx,
    )
    expect(result.receipt.summary).toBe("Moved Opening into “Act I”.")
  })

  it("moves a shot out of every folder on null, dropping the key", () => {
    const result = foldersHandlers.move_shot_to_folder(
      base(),
      { op: "move_shot_to_folder", shotId: "shot-2", folderId: null },
      ctx,
    )

    expect("folderId" in result.production.shots[1]!).toBe(false)
    expect(result.receipt.summary).toBe("Moved Shot 2 out of its folder.")
  })

  it("warns instead of failing when the shot is already there", () => {
    const before = base()
    const filed = foldersHandlers.move_shot_to_folder(
      before,
      { op: "move_shot_to_folder", shotId: "shot-2", folderId: "act-1" },
      ctx,
    )
    expect(filed.production).toBe(before)
    expect(filed.warnings).toEqual(["Shot 2 was already in that folder."])

    const unfiled = foldersHandlers.move_shot_to_folder(
      before,
      { op: "move_shot_to_folder", shotId: "shot-3", folderId: null },
      ctx,
    )
    expect(unfiled.production).toBe(before)
    expect(unfiled.warnings).toEqual(["Shot 3 was already out of every folder."])
  })

  it("refuses a shot that is not in the production", () => {
    const error = refusal(() =>
      foldersHandlers.move_shot_to_folder(
        base(),
        { op: "move_shot_to_folder", shotId: "nope", folderId: "act-1" },
        ctx,
      ),
    )
    expect(error.code).toBe("op_target_missing")
  })

  it("refuses a folder that is not in the production", () => {
    const error = refusal(() =>
      foldersHandlers.move_shot_to_folder(
        base(),
        { op: "move_shot_to_folder", shotId: "shot-1", folderId: "nope" },
        ctx,
      ),
    )
    expect(error.code).toBe("op_target_missing")
  })
})

describe("the section's tables", () => {
  it("declares a schema, a handler and a class for the same four ops", () => {
    const ops = ["add_folder", "rename_folder", "remove_folder", "move_shot_to_folder"]
    expect(Object.keys(foldersOpSchemas)).toEqual(ops)
    expect(Object.keys(foldersHandlers)).toEqual(ops)
    expect(Object.keys(foldersOpClasses)).toEqual(ops)
    expect(Object.values(foldersOpClasses)).toEqual(["S", "S", "S", "S"])
  })

  it("parses its ops through its own schemas", () => {
    expect(
      foldersOpSchemas.move_shot_to_folder.parse({
        op: "move_shot_to_folder",
        shotId: "shot-1",
        folderId: null,
      }),
    ).toEqual({ op: "move_shot_to_folder", shotId: "shot-1", folderId: null })

    expect(
      foldersOpSchemas.add_folder.safeParse({ op: "add_folder", id: "a" }).success,
    ).toBe(false)
  })
})
