// Prose for the "One Character, Any Scene" tutorial.
//
// ONLY text that has no home in the workflow lives here. The prompts, the
// tokens they carry, the source images, every result and every count are read
// off the template snapshot at render time (one-character-recipes.ts), so
// republishing the template cannot leave this file lying. What is authored:
// the lesson each recipe teaches, a note per borrowed token, the plain-English
// name of each recipe, and the crop map — which part of a source each
// qualifier shows in the "HOW IT ADDS UP" strip. Authored content is keyed by
// the recipe's TOKEN SIGNATURE (its `recipeKey`: "1:person 2:face"), the one
// thing that IS the recipe — ids and labels may change on republish and the
// words between the tokens may be re-phrased; which parts of which numbers a
// recipe names is the lesson.
//
// The copy is the design handoff's, verbatim. It is held as dictionary keys;
// `copyFor` / `cropFor` translate at call time with the caller's `t`.

import { tx, type MessageKey, type TFunction } from "@/lib/i18n"

export const HEADLINE: MessageKey = "tut.ocHeadline"

export const SUBLINE: MessageKey = "tut.ocSubline"

/** Headline chips after the derived counts. */
export const FACTS: readonly MessageKey[] = ["tut.ocChipNoMask"]

// --- column 1: the two sources ---------------------------------------------

export const IN_COLUMN: { title: MessageKey; sub: MessageKey } = {
  title: "tut.ocInTitle",
  sub: "tut.ocInSub",
}

/** What each source is, by its `{image:N}` position. Falls back to the
 *  node's kind ("generated image" / "uploaded image") for a re-authored template. */
export const SOURCE_ROLES: Record<number, MessageKey> = {
  1: "tut.ocRoleGenerated",
  2: "tut.ocRoleUploaded",
}

export const SAME_TWO: { eyebrow: MessageKey; body: MessageKey } = {
  eyebrow: "tut.ocSameTwoEyebrow",
  body: "tut.ocSameTwoBody",
}

// --- column 2: the five recipes ---------------------------------------------

export const RECIPES_COLUMN: { title: MessageKey; sub: MessageKey; meta: MessageKey } = {
  title: "tut.ocRecipesTitle",
  sub: "tut.ocRecipesSub",
  meta: "tut.ocRecipesMeta",
}

export const TAKES_EYEBROW: MessageKey = "tut.ocTakesEyebrow"
export const NODE_EYEBROW: MessageKey = "tut.ocNodeEyebrow"

/** A recipe's prose, translated for display (what `copyFor` returns). */
export interface RecipeCopy {
  /** Plain-English name under the prompt line. */
  readonly name: string
  /** OUT column header for this recipe. */
  readonly outTitle: string
  readonly outSub: string
  /** The eyebrow of the lesson box. */
  readonly lessonKind: string
  readonly lesson: string
  /** A note per borrowed token, keyed `N:qualifier` ("2:face"). */
  readonly notes: Record<string, string>
}

/** The authored form of `RecipeCopy`: every field is a dictionary key. */
export interface RecipeCopyKeys {
  readonly name: MessageKey
  readonly outTitle: MessageKey
  readonly outSub: MessageKey
  readonly lessonKind: MessageKey
  readonly lesson: MessageKey
  readonly notes: Record<string, MessageKey>
}

/**
 * Keyed by recipe signature (see `recipeKey`). ORDER MATTERS: this is
 * the lesson sequence the design authored (recipe 2 is "the point of the whole
 * template"; 3 and 4 are deliberately adjacent mirrors; 5 stacks). The body
 * sorts the template's recipes into this order and appends any it does not know.
 */
export const RECIPE_COPY: ReadonlyArray<readonly [signature: string, copy: RecipeCopyKeys]> = [
  [
    "1:person 2:face",
    {
      name: "tut.ocR1Name",
      outTitle: "tut.ocR1OutTitle",
      outSub: "tut.ocR1OutSub",
      lessonKind: "tut.ocR1LessonKind",
      lesson: "tut.ocR1Lesson",
      notes: {
        "1:person": "tut.ocR1Note1",
        "2:face": "tut.ocR1Note2",
      },
    },
  ],
  [
    "2:person 1:face",
    {
      name: "tut.ocR2Name",
      outTitle: "tut.ocR2OutTitle",
      outSub: "tut.ocR2OutSub",
      lessonKind: "tut.ocR2LessonKind",
      lesson: "tut.ocR2Lesson",
      notes: {
        "2:person": "tut.ocR2Note1",
        "1:face": "tut.ocR2Note2",
      },
    },
  ],
  [
    "1:background 2:person",
    {
      name: "tut.ocR3Name",
      outTitle: "tut.ocR3OutTitle",
      outSub: "tut.ocR3OutSub",
      lessonKind: "tut.ocR3LessonKind",
      lesson: "tut.ocR3Lesson",
      notes: {
        "1:background": "tut.ocR3Note1",
        "2:person": "tut.ocR3Note2",
      },
    },
  ],
  [
    "1:person 2:settings",
    {
      name: "tut.ocR4Name",
      outTitle: "tut.ocR4OutTitle",
      outSub: "tut.ocR4OutSub",
      lessonKind: "tut.ocR4LessonKind",
      lesson: "tut.ocR4Lesson",
      notes: {
        "1:person": "tut.ocR4Note1",
        "2:settings": "tut.ocR4Note2",
      },
    },
  ],
  [
    "1:person 2:jacket 2:settings",
    {
      name: "tut.ocR5Name",
      outTitle: "tut.ocR5OutTitle",
      outSub: "tut.ocR5OutSub",
      lessonKind: "tut.ocR5LessonKind",
      lesson: "tut.ocR5Lesson",
      notes: {
        "1:person": "tut.ocR5Note1",
        "2:jacket": "tut.ocR5Note2",
        "2:settings": "tut.ocR5Note3",
      },
    },
  ],
]

/** The lesson order as recipe signatures — what `deriveOneCharacterGraph` sorts by. */
export const RECIPE_ORDER: readonly string[] = RECIPE_COPY.map(([signature]) => signature)

/** Prose for a recipe, translated. A recipe the template carries but this file
 *  does not know still renders, honestly labelled. `t` defaults to the live
 *  locale for non-render callers. */
export function copyFor(key: string, index: number, t: TFunction = tx): RecipeCopy {
  const hit = RECIPE_COPY.find(([signature]) => signature === key)
  if (hit) {
    const copy = hit[1]
    return {
      name: t(copy.name),
      outTitle: t(copy.outTitle),
      outSub: t(copy.outSub),
      lessonKind: t(copy.lessonKind),
      lesson: t(copy.lesson),
      notes: Object.fromEntries(Object.entries(copy.notes).map(([token, note]) => [token, t(note)])),
    }
  }
  return {
    name: t("tut.recipeN", { n: index }),
    outTitle: t("tut.recipeN", { n: index }),
    outSub: t("tut.ocRecipeAsWritten", { n: index }),
    lessonKind: t("tut.ocLessonKindOther"),
    lesson: t("tut.ocLessonOther"),
    notes: {},
  }
}

// --- column 3: the result and the breakdown ---------------------------------

export const ADDS_UP_EYEBROW: MessageKey = "tut.ocAddsUpEyebrow"
export const RESULT_CHIP: MessageKey = "tut.ocResultChip"
export const RESULT_CAPTION: MessageKey = "tut.ocResultCaption"
export const NOT_RUN: MessageKey = "tut.ocNotRun"

/**
 * The crop map: which window into its source each qualifier shows in the
 * breakdown strip, so a tile shows ONLY what that qualifier borrows. Per
 * template, not global — it depends on what is actually visible in THESE two
 * sources. `settings` is deliberately blank: the uploaded studio portrait is a
 * waist-up shot on a tight backdrop with no person-free region large enough
 * to crop, and every attempt at a crop showed a face in a tile captioned "the
 * backdrop" — teaching the inverse of recipe 4. A blank, honestly-labelled
 * panel is correct here.
 */
export interface CropWindow {
  readonly size: string
  readonly position: string
  readonly caption: string
  /** Render a flat, labelled panel instead of an image. */
  readonly blank?: boolean
}

/** The authored crop map; `caption` is a dictionary key (`cropFor` translates it). */
export const CROPS: Record<string, Omit<CropWindow, "caption"> & { readonly caption: MessageKey }> = {
  face: { size: "300%", position: "52% 6%", caption: "tut.ocCropFace" },
  person: { size: "cover", position: "center top", caption: "tut.ocCropPerson" },
  background: { size: "230%", position: "6% 62%", caption: "tut.ocCropBackground" },
  jacket: { size: "260%", position: "6% 82%", caption: "tut.ocCropJacket" },
  settings: { size: "cover", position: "center top", caption: "tut.ocCropSettings", blank: true },
}

export const BLANK_TILE_LABEL: MessageKey = "tut.ocBlankTile"

/** A qualifier this map does not know shows the whole source, honestly captioned.
 *  `t` defaults to the live locale for non-render callers. */
export function cropFor(qualifier: string, t: TFunction = tx): CropWindow {
  const crop = CROPS[qualifier]
  if (crop) return { ...crop, caption: t(crop.caption) }
  return {
    size: "cover",
    position: "center top",
    caption: qualifier ? t("tut.ocCropPart", { part: qualifier }) : t("tut.ocCropSource"),
  }
}
