import {
  composeCharacterFxHintFromConnections,
  getCharacterFxLabel,
  getCharacterFxPromptHint,
  getPickerCatalog,
  type CharacterFxTiming,
  type PickerDimension,
} from "@nodaro/prompts"

import type { ShotCharacterFx } from "./shot"
import {
  CHARACTER_FX_KEY,
  characterFxPicker,
  modeForPicker,
  type LookHintMode,
} from "./look-pickers"

/**
 * The CHARACTER FX node — an effect on a shot's subject (a werewolf
 * transformation, a lightning aura…) with three timing levers, the same shape
 * the platform's `character-fx` node carries: `characterFx` + `position` /
 * `duration` / `intensity`.
 *
 * THE EFFECT IS CATALOG-DRIVEN like every other cinematic dimension: we store
 * the id and let the catalog say the words, through the platform's OWN
 * composer (`composeCharacterFxHintFromConnections`), so a shot's effect
 * reaches the model byte-identical to the canvas node's.
 *
 * THE LEVERS ARE CATALOG DIMENSIONS, not an app-owned list. The platform
 * publishes the three scales as `getPickerCatalog("character-fx").dimensions`
 * (position · duration · intensity, each row an id + label + hint); studio
 * renders whatever rows arrive and stores the ids (`start`, `short`, `crazy`).
 * FEATURE-DETECTED: the installed `@nodaro/prompts` may publish no dimensions
 * yet (1.8.x does not) — then the menus don't render and a stored lever folds
 * nothing. The bump that brings them lights the menus up with no code here.
 *
 * Because the scales and the composer ship in ONE package, a lever id the
 * catalog offers is one the composer can clause — that lock is what keeps an
 * "undefined" out of the prompt, and `character-fx.test.ts` pins it.
 *
 * The transition node's levers are the deliberate exception (app-owned words
 * over the handoff's vocabulary — see `lib/transition`); this node is the
 * first to take the catalog's. TODO(nodaro): with dimensions published for
 * `transition` too, its levers can migrate onto {@link characterFxDimensions}'
 * generic reader once stored `"On cut"`-style values have a read-side map.
 */

/** The picker key of the effect itself — the derived picker lives in
 *  `look-pickers` beside Camera Movement (outside LOOK_PICKERS). */
export const CHARACTER_FX_DIMENSION = CHARACTER_FX_KEY

/** Nothing chosen — the label, and the catalog's own no-op row id. */
export const CHARACTER_FX_AUTO = "Auto"
const AUTO_ID = "auto"

/**
 * Whether the node actually says anything. The catalog's own first rows are
 * `auto` and `none` — real, reachable picks that inject nothing — so they must
 * read as UNSET everywhere, exactly as an absent node does. One predicate, so
 * the pill, the dialog's levers and the fold can never disagree about it.
 */
export function characterFxIsSet(fx: ShotCharacterFx | undefined): boolean {
  return !!fx?.id && getCharacterFxPromptHint(fx.id) !== ""
}

/** The chosen effect's display name, or Auto. Display only — never folded. */
export function characterFxLabel(fx: ShotCharacterFx | undefined): string {
  return characterFxIsSet(fx) ? getCharacterFxLabel(fx!.id!) : CHARACTER_FX_AUTO
}

/** The timing scales the installed catalog publishes — possibly none. */
export function characterFxDimensions(): ReadonlyArray<PickerDimension> {
  return getPickerCatalog("character-fx")?.dimensions ?? []
}

/**
 * The levers in effect: each dimension's stored id, kept only when that scale
 * publishes it and it isn't the no-op `auto`. A scale that isn't published
 * (no dimensions installed) folds nothing — the rollback story and the
 * no-"undefined" guard in one predicate.
 */
export function characterFxLevers(
  fx: ShotCharacterFx | undefined,
  dimensions: ReadonlyArray<PickerDimension> = characterFxDimensions(),
): Readonly<Record<string, string>> {
  const stored = (fx ?? {}) as Readonly<Record<string, string | undefined>>
  const out: Record<string, string> = {}
  for (const dim of dimensions) {
    const id = stored[dim.field]
    if (id && id !== AUTO_ID && dim.options.some((o) => o.id === id)) out[dim.field] = id
  }
  return out
}

/**
 * What the node contributes to its shot's window — the platform's composition
 * of the effect (its short term under the video policy, its full hint
 * otherwise) with the timing clauses of the levers in effect appended. Empty
 * for an unset node, so an untouched shot folds byte-identically.
 */
export function characterFxClause(
  fx: ShotCharacterFx | undefined,
  mode: LookHintMode,
  dimensions: ReadonlyArray<PickerDimension> = characterFxDimensions(),
): string {
  if (!characterFxIsSet(fx)) return ""
  return composeCharacterFxHintFromConnections(
    fx!.id,
    [],
    characterFxLevers(fx, dimensions) as CharacterFxTiming,
    modeForPicker(characterFxPicker(), mode),
  )
}

/**
 * THE EFFECT TOKEN — an effect chip's place in the prose.
 *
 * "Type / where it happens": the chip is a word inside the sentence, at the
 * moment the effect happens, so the shot's text has to remember WHERE. It
 * renders into the text as the neutral `[fx:<id>]` — the same move the `/`
 * voice directions make with `[whisper]`: the token persists (a restore
 * rebuilds the chip from it, see `prompt-doc`), and only the fold turns it
 * into what the model reads. Strict on purpose (`[fx:` + a catalog id): a
 * user's own brackets are never eaten, and the direction recovery in
 * `voice-direction` only claims its preset texts, so the two never collide.
 */
const EFFECT_TOKEN_SOURCE = String.raw`\[fx:([a-z0-9-]+)\]`

export function effectToken(id: string): string {
  return `[fx:${id}]`
}

/** Every token in the text, in order, with its span. */
export function matchEffectTokens(
  text: string,
): ReadonlyArray<{ readonly start: number; readonly end: number; readonly id: string }> {
  return [...text.matchAll(new RegExp(EFFECT_TOKEN_SOURCE, "g"))].map((m) => ({
    start: m.index ?? 0,
    end: (m.index ?? 0) + m[0].length,
    id: m[1],
  }))
}

export function parseEffectTokens(text: string): ReadonlyArray<string> {
  return matchEffectTokens(text).map((m) => m.id)
}

export function hasEffectToken(text: string): boolean {
  return matchEffectTokens(text).length > 0
}

/** Runs of spaces a removed or replaced token leaves behind, closed up. */
function tidyAfterTokens(text: string): string {
  return text
    .replace(/[^\S\n]{2,}/g, " ")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
}

/**
 * The prose with every effect token resolved IN PLACE to the platform's
 * composition of that effect — the effect lands where the chip sat. The
 * node's levers ride along only for the node's OWN effect (`fx.id`): they
 * tune that effect, not whatever the text happens to name. An unset or
 * unknown id resolves to nothing and closes up cleanly.
 */
export function resolveEffectTokens(
  text: string,
  mode: LookHintMode,
  fx?: ShotCharacterFx,
  dimensions: ReadonlyArray<PickerDimension> = characterFxDimensions(),
): string {
  if (!hasEffectToken(text)) return text
  const resolved = text.replace(new RegExp(EFFECT_TOKEN_SOURCE, "g"), (_m, id: string) =>
    characterFxClause(fx?.id === id ? fx : { id }, mode, dimensions),
  )
  return tidyAfterTokens(resolved)
}

/** The prose with every effect token removed — for a surface that can't carry
 *  an effect (the Framing mirror of a Directing prompt). */
export function stripEffectTokens(text: string): string {
  if (!hasEffectToken(text)) return text
  return tidyAfterTokens(text.replace(new RegExp(EFFECT_TOKEN_SOURCE, "g"), ""))
}

/**
 * The node after an edit of the shot's prose — THE CHIP IS THE NODE'S ID.
 * A chip in the text sets it (a swapped chip swaps it, levers kept); a text
 * that has just lost its chip clears the node. A node whose text never carried
 * a chip — authored from the pill before the `/` command existed — is left
 * alone by typing; only the dialog's clear removes it.
 */
export function characterFxAfterEdit(
  previous: { readonly text: string; readonly characterFx?: ShotCharacterFx },
  effectId: string | undefined,
): ShotCharacterFx | undefined {
  if (effectId) return { ...previous.characterFx, id: effectId }
  return hasEffectToken(previous.text) ? undefined : previous.characterFx
}
