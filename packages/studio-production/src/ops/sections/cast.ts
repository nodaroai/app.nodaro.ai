/**
 * The CAST section — the production's role sheet as operations.
 *
 * Six ops, each the server-side twin of one studio cast reducer
 * (`production-store-cast-look.ts`): enroll a role, drop one, rename it, recast
 * it, set its role word, and mint the roles a legacy production only ever said
 * in chips. The rules they enforce are the registry's own, and none of them is
 * re-implemented here — the codec's `cast.ts`, `cast-rebind.ts`,
 * `cast-rename.ts` and `cast-merge.ts` are the one implementation, exactly as
 * the reducers use them:
 *
 *  - **INV-C** — `castSlug(kind, displayName) === key` for every row. It holds
 *    because every write goes through {@link enrollCastMember}, which decides
 *    the key, or through {@link recastActor}, which keeps the name EXACTLY so
 *    the key cannot move.
 *  - **One name is one role** (D6a) — a colliding enrollment is SUFFIXED, never
 *    an overwrite, and the receipt says what it landed as.
 *  - **A rename rewrites the prose; a recast rewrites nothing but the pins.**
 *    Identity resolves through the live cast row at submit, so a recast moves
 *    one row and every scene follows; its one legitimate loss is the scene look
 *    pins — views of the actor that just left — which are dropped and COUNTED
 *    into the receipt rather than left stale.
 *
 * Every handler is pure and copy-on-write, takes its clock and its ids from
 * `ctx`, and throws {@link OpError} rather than returning a null the caller
 * would have to notice. Where a reducer is a silent no-op on a key it does not
 * know, the operation is `op_target_missing`: an op arrives from a route or a
 * model, and "nothing happened, quietly" is the one answer neither can act on.
 */
import { z } from "zod"

import {
  enrollCastMember,
  removeCastMember as removeCastRow,
  sanitizeCastRole,
  type Cast,
  type CastKind,
  type CastMember,
} from "../../cast"
import { castFromChips } from "../../cast-merge"
import { recastActor } from "../../cast-rebind"
import { clearCastLookForRole, renameRoleInShots } from "../../cast-rename"
import type { Shot } from "../../shot"

import { opError } from "../errors"
import type { Production } from "../production"
import type { OpResult, SectionClasses, SectionHandlers } from "../types"

// ── the row shapes, as schemas ──────────────────────────────────────────────

/**
 * The kinds a role can bind to. Written out rather than derived because a zod
 * enum needs a literal tuple; the two pins below fail to compile the moment
 * {@link CastKind} and this list disagree in EITHER direction, which is the
 * same guarantee a derivation would give without the tuple gymnastics.
 */
const CAST_KINDS = [
  "character",
  "location",
  "object",
  "creature",
  "image",
] as const

type KindsCoverCastKind = CastKind extends (typeof CAST_KINDS)[number]
  ? true
  : never
type CastKindCoversKinds = (typeof CAST_KINDS)[number] extends CastKind
  ? true
  : never
const _kindPin: [KindsCoverCastKind, CastKindCoversKinds] = [true, true]
void _kindPin

const castKindSchema = z.enum(CAST_KINDS)

/** One view of the bound actor — the row's default look (D6f). */
const castLookSchema = z.object({
  url: z.string(),
  variantSlug: z.string().optional(),
  label: z.string().optional(),
})

/**
 * A cast ROW. `assetId` is optional on purpose: absent = a DESCRIBED role, a
 * name with words and no face (R5), which is what an import's triage lands and
 * what a later `recast_cast_member` binds an actor to.
 */
const castMemberSchema = z.object({
  kind: castKindSchema,
  assetId: z.string().optional(),
  displayName: z.string(),
  defaultLook: castLookSchema.optional(),
  defaultRole: z.string().optional(),
  description: z.string().optional(),
})

type MemberPinIn = z.infer<typeof castMemberSchema> extends CastMember
  ? true
  : never
type MemberPinOut = CastMember extends z.infer<typeof castMemberSchema>
  ? true
  : never
const _memberPin: [MemberPinIn, MemberPinOut] = [true, true]
void _memberPin

// ── the ops ─────────────────────────────────────────────────────────────────

export const castOpSchemas = {
  enroll_cast: z.object({
    op: z.literal("enroll_cast"),
    member: castMemberSchema,
  }),
  remove_cast_member: z.object({
    op: z.literal("remove_cast_member"),
    key: z.string(),
  }),
  rename_cast_member: z.object({
    op: z.literal("rename_cast_member"),
    key: z.string(),
    displayName: z.string(),
  }),
  recast_cast_member: z.object({
    op: z.literal("recast_cast_member"),
    key: z.string(),
    actor: z.object({ kind: castKindSchema, assetId: z.string() }),
  }),
  set_cast_role: z.object({
    op: z.literal("set_cast_role"),
    key: z.string(),
    role: z.string().nullable(),
  }),
  mint_cast_from_chips: z.object({
    op: z.literal("mint_cast_from_chips"),
  }),
} as const

/**
 * `remove_cast_member` is the only DELETE here: it drops a row the prose still
 * says, so the scenes that named the role stop resolving to an actor. Nothing
 * in this section destroys media, so none of it is trash-backed.
 */
export const castOpClasses: SectionClasses<typeof castOpSchemas> = {
  enroll_cast: "S",
  remove_cast_member: "D",
  rename_cast_member: "S",
  recast_cast_member: "S",
  set_cast_role: "S",
  mint_cast_from_chips: "S",
}

// ── local helpers (pure, and private to this section) ───────────────────────

/** The cast a document carries; an absent one reads as the empty sheet. */
const castOf = (production: Production): Cast => production.cast ?? {}

/**
 * The role as a person sees it — `@Abi (character)`, the display name and the
 * kind, never the key. Receipts carry no ids (`SECTIONS.md`, "How a receipt
 * reads"); the minted key rides `receipt.ids`.
 */
const role = (member: CastMember): string =>
  `@${member.displayName} (${member.kind})`

/** `1 pin` / `3 pins` — the receipts count in words, not in numerals alone. */
const plural = (count: number, one: string, many = `${one}s`): string =>
  `${count} ${count === 1 ? one : many}`

/** The row a key names, or the refusal the caller can act on. */
function requireMember(cast: Cast, key: string, op: string): CastMember {
  const member = cast[key]
  if (!member) {
    throw opError(
      "op_target_missing",
      `No cast member “${key}” in this production (${op}).`,
    )
  }
  return member
}

/**
 * The shot array a rewrite produced, as the document holds it.
 *
 * `renameRoleInShots` / `clearCastLookForRole` hand back the SAME array when
 * they touched nothing, and that identity is load-bearing — a fresh array marks
 * the production dirty for a save that changed nothing. So the copy happens
 * only where there is something to copy.
 */
const shotsOf = (
  production: Production,
  next: ReadonlyArray<Shot>,
): Shot[] => (next === production.shots ? production.shots : [...next])

// ── the handlers ────────────────────────────────────────────────────────────

export const castHandlers: SectionHandlers<typeof castOpSchemas> = {
  /**
   * ENROLL a role. The key is decided against the document's freshest cast, so
   * two enrollments in one batch cannot both claim the same slug — the second
   * reads the first's landing, which is what applying ops in order means.
   */
  enroll_cast: (production, op): OpResult => {
    const enrolled = enrollCastMember(castOf(production), op.member)
    if (!enrolled) {
      // An unsluggable name (emoji, a script with no latin fold) could never be
      // addressed by name, which is the only thing a cast row is for.
      throw opError(
        "op_invalid",
        `“${op.member.displayName}” has no addressable name — nothing to enroll.`,
      )
    }
    const landed = enrolled.cast[enrolled.key]!
    const renamed = landed.displayName !== op.member.displayName
    return {
      production: { ...production, cast: enrolled.cast },
      receipt: {
        op: "enroll_cast",
        summary: `Bound ${role(landed)}.`,
        ids: [enrolled.key],
      },
      ...(renamed
        ? {
            warnings: [
              `“${op.member.displayName}” was already cast — bound as “${landed.displayName}”.`,
            ],
          }
        : {}),
    }
  },

  /**
   * DROP a role. The prose that named it keeps its words — they simply stop
   * resolving to an actor, exactly as the reducer leaves them.
   */
  remove_cast_member: (production, op): OpResult => {
    const cast = castOf(production)
    const member = requireMember(cast, op.key, "remove_cast_member")
    return {
      production: { ...production, cast: removeCastRow(cast, op.key) },
      receipt: {
        op: "remove_cast_member",
        summary: `Removed ${role(member)} from the cast.`,
      },
    }
  },

  /**
   * RENAME a role: keep the actor, move the key, rewrite the prose everywhere.
   *
   * The renamed row is enrolled into the cast MINUS the old one, so renaming a
   * role to a spelling of its own name ("abi" → "Abi") lands back on its own
   * key instead of being suffixed away from itself. `reservedNames` is every
   * OTHER role's display name (R75b): whole words this rewrite must leave
   * alone.
   */
  rename_cast_member: (production, op): OpResult => {
    const cast = castOf(production)
    const member = requireMember(cast, op.key, "rename_cast_member")
    const without = removeCastRow(cast, op.key)
    const enrolled = enrollCastMember(without, {
      ...member,
      displayName: op.displayName,
    })
    if (!enrolled) {
      throw opError(
        "op_invalid",
        `“${op.displayName}” has no addressable name — the role was not renamed.`,
      )
    }
    const landed = enrolled.cast[enrolled.key]!
    const { shots, report } = renameRoleInShots(production.shots, {
      kind: member.kind,
      oldKey: op.key,
      newKey: enrolled.key,
      oldName: member.displayName,
      newName: landed.displayName,
      reservedNames: Object.values(without).map((m) => m.displayName),
    })
    const warnings: string[] = []
    if (landed.displayName !== op.displayName) {
      warnings.push(
        `“${op.displayName}” was already cast — the role is now “${landed.displayName}”.`,
      )
    }
    if (report.rewrites > 0) {
      warnings.push(`Renamed the role in ${plural(report.rewrites, "prompt")}.`)
    }
    return {
      production: {
        ...production,
        cast: enrolled.cast,
        shots: shotsOf(production, shots),
      },
      receipt: {
        op: "rename_cast_member",
        summary: `Renamed @${member.displayName} to ${role(landed)}.`,
        ids: [enrolled.key],
      },
      ...(warnings.length > 0 ? { warnings } : {}),
    }
  },

  /**
   * RECAST a role: keep the name, swap the actor, rewrite nothing.
   *
   * The ROW is `recastActor`'s — the one rule — so the name is kept exactly
   * (the key cannot move, INV-C holds without re-keying), the role word and the
   * hand-written description ride along, and the row's `defaultLook` goes with
   * the actor that left. What the operation ADDS is the same effect the reducer
   * does: the scene look pins, views of that same departed actor, are dropped
   * and COUNTED into the receipt.
   */
  recast_cast_member: (production, op): OpResult => {
    const cast = castOf(production)
    const member = requireMember(cast, op.key, "recast_cast_member")
    const next = recastActor(member, op.actor)
    const { shots, pinsReset } = clearCastLookForRole(production.shots, op.key)
    return {
      production: {
        ...production,
        cast: { ...cast, [op.key]: next },
        shots: shotsOf(production, shots),
      },
      receipt: {
        op: "recast_cast_member",
        summary:
          pinsReset > 0
            ? `Recast ${role(next)} (reset ${plural(pinsReset, "pin")}).`
            : `Recast ${role(next)}.`,
      },
    }
  },

  /**
   * The role WORD (D6p) — what the reference is called in the prompt ("panda",
   * "background"), stored as typed and bounded here because nothing downstream
   * bounds it. Clearing is the ABSENCE of the key, never `defaultRole: ""`: a
   * cleared row must serialize exactly as a never-set one.
   */
  set_cast_role: (production, op): OpResult => {
    const cast = castOf(production)
    const member = requireMember(cast, op.key, "set_cast_role")
    const next = sanitizeCastRole(op.role ?? "")
    if ((member.defaultRole ?? "") === next) {
      // The SAME document back — copy-on-write is load-bearing for the studio's
      // re-render, and a fresh cast would mark the production dirty for a save
      // that changed nothing.
      return {
        production,
        receipt: {
          op: "set_cast_role",
          summary: next
            ? `${role(member)} was already the “${next}”.`
            : `${role(member)} had no role word.`,
        },
        warnings: [`${role(member)}'s role word did not change.`],
      }
    }
    // Rebuilt WITHOUT the field first, so clearing leaves nothing behind.
    const { defaultRole: _cleared, ...rest } = member
    return {
      production: {
        ...production,
        cast: {
          ...cast,
          [op.key]: next ? { ...rest, defaultRole: next } : rest,
        },
      },
      receipt: {
        op: "set_cast_role",
        summary: next
          ? `${role(member)} is now the “${next}”.`
          : `Cleared ${role(member)}'s role word.`,
      },
    }
  },

  /**
   * MINT the roles a legacy production only ever said in CHIPS (C5, D6g).
   *
   * The sweep is `castFromChips`' — every bound reference in every still, clip,
   * beat and imported plan, in the order the production reads. Idempotent by
   * construction: a name already cast is that role (D6a), so a second run has
   * nothing to mint and hands the same document back.
   */
  mint_cast_from_chips: (production): OpResult => {
    const minted = castFromChips(castOf(production), production.shots)
    if (minted.enrolled.length === 0) {
      return {
        production,
        receipt: {
          op: "mint_cast_from_chips",
          summary: "No new roles to mint from the scenes’ chips.",
        },
        warnings: ["Every chipped role is already cast."],
      }
    }
    const names = minted.enrolled.map((e) => `@${e.displayName}`)
    const warnings = minted.enrolled
      .filter((e) => e.renamedFrom)
      .map(
        (e) =>
          `“${e.renamedFrom}” was already cast — minted as “${e.displayName}”.`,
      )
    return {
      production: {
        ...production,
        cast: minted.cast,
        shots: shotsOf(production, minted.shots),
      },
      receipt: {
        op: "mint_cast_from_chips",
        summary:
          names.length === 1
            ? `Minted ${names[0]} from the scenes’ chips.`
            : `Minted ${plural(names.length, "role")} from the scenes’ chips.`,
        ids: minted.enrolled.map((e) => e.key),
      },
      ...(warnings.length > 0 ? { warnings } : {}),
    }
  },
}
