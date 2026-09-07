/**
 * `RequestContext` — what the request builders need that the DOCUMENT does not
 * hold.
 *
 * `buildFramingRequest` / `buildDirectingRequest` / `planExport` are the one
 * assembly of a generation's structured inputs, used by the studio's hooks and
 * by the platform's generation routes (D6). A production says what to make; the
 * context says everything else the browser knew and the server must be handed:
 * which directing mode the Input control is on, which chips the Composer has
 * bound, what the model catalog allows, and what things cost.
 *
 * The catalog gates are INJECTABLE and default to the package's own
 * `model-menu` readers. They are catalog-derived by construction (never a
 * hardcoded provider list — CLAUDE.md), so the default is the right answer
 * everywhere; the seam exists so a builder test can pin the matrix without
 * pinning today's catalog.
 *
 * Nothing here is a lever the caller may invent: a value the document owns
 * (the prompt, the frames, the look) is read from the production, and a value
 * the CALL owns (provider, aspect, count) rides the builder's `overrides`
 * argument. Browser-free — no React, no `import.meta.env`.
 */
import type { ConnectedReference, DescribedReference } from "@nodaro/shared"

import {
  allowlistedModelsWithFeature,
  negativePromptSupported,
  videoAudioField,
} from "../model-menu"
import type { DirectingMode } from "../model-menu"

/**
 * The catalog questions the studio hooks ask before they put a field on the
 * wire.
 *
 * Each one exists so a stale value cannot reach a model that would refuse it:
 * a negative prompt after a model switch, an end frame on a model with no
 * end-frame feature, an audio toggle on a model whose sound is always on.
 */
export interface CatalogGates {
  /** Does this model NATIVELY accept a negative prompt? (`useStartFraming`,
   *  `useStartDirecting` — the same gate the UI field shows on.) */
  readonly negativePromptSupported: typeof negativePromptSupported
  /** The allowlisted models carrying a catalog feature — `"end-frame"` is the
   *  one the directing builder gates on. (`useStartDirecting`.) */
  readonly allowlistedModelsWithFeature: typeof allowlistedModelsWithFeature
  /** This model's TOGGLEABLE native-audio field, or `undefined` when it has no
   *  toggle (always-on or silent). (`useStartDirecting`.) */
  readonly videoAudioField: typeof videoAudioField
}

/** The package's own catalog readers — the default for every gate. */
export const DEFAULT_CATALOG_GATES: CatalogGates = {
  negativePromptSupported,
  allowlistedModelsWithFeature,
  videoAudioField,
}

/**
 * What a builder is handed alongside the production.
 *
 * `mode` is the Input control's directing mode. In Phase 3 the Composer's draft
 * becomes plan writes (D13) and the bound chips live on the shot's plan, at
 * which point `chips` goes away and the context shrinks to `{ mode }`.
 */
export interface RequestContext {
  /** The directing mode this animate belongs to; absent ⇒ derived from inputs. */
  readonly mode?: DirectingMode
  /**
   * The chips the Composer has bound for this shot — the STORED array, as the
   * shot's plan carries them, and the prose the builder is given is the RAW,
   * persisted prose beside them.
   *
   * The builder does the binding: it is the one place that decides which chips
   * ride the wire and what the prose says about them, and those are ONE
   * decision (a mention-bound image chip's wire shape drops `isExtraRef`, so
   * the list and the prompt come back together from `bindMentionTokens`). So a
   * caller hands over what it HAS and reads the wire shapes off the built
   * request — it must not pre-bind the prose and pass that as
   * `overrides.prompt`, which would fold the binding twice (the D1 restore
   * bug). Read-only either way: no builder writes into this array.
   */
  readonly chips?: ReadonlyArray<ConnectedReference>
  /**
   * The DESCRIBED roles the prose names — a name with words and no face. Their
   * own channel, alongside {@link chips}: they carry no url, so they attach
   * nothing and claim no `@image_N` seat, and the route renders each as an
   * identity line correlated with the name the prose says.
   *
   * UNFILTERED, wordless roles included — the builder owns both halves of R7
   * and they disagree about a role with nothing to say: the wire CHANNEL drops
   * it (`wireDescribedReferences`, a small pure helper each builder carries
   * because the studio's did not move with the codec), while the PROSE still
   * gives its `@<role-slug>` token the human word back, because a raw token is
   * a raw token whether or not anyone described its owner.
   *
   * Like {@link chips}, this goes away in Phase 3 when the roles live on the
   * shot's plan.
   */
  readonly describedReferences?: ReadonlyArray<DescribedReference>
  /** Catalog gates; every unset one falls back to {@link DEFAULT_CATALOG_GATES}. */
  readonly gates?: Partial<CatalogGates>
  /**
   * Credit cost per model identifier, as `client.credits.modelCosts` returns
   * it — `planExport` prices its steps from this. Absent ⇒ the plan carries
   * steps with no estimate rather than a guessed one.
   */
  readonly modelCosts?: Readonly<Record<string, number>>
}

/**
 * The gates this call should use — the caller's overrides over the defaults.
 *
 * Copy-on-write: a new object every time, so a builder can never write a gate
 * back onto a shared context.
 */
export function resolveCatalogGates(ctx?: RequestContext): CatalogGates {
  return { ...DEFAULT_CATALOG_GATES, ...(ctx?.gates ?? {}) }
}
