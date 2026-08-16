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
// The copy is the design handoff's, verbatim.

export const HEADLINE = "Two images. Five recipes. No masks, no layers."

export const SUBLINE =
  "Every recipe below reads the same two sources. What changes is which part of each one you name, and which number you name it on. That is the entire technique."

/** Headline chips after the derived counts. */
export const FACTS = ["nothing is masked"] as const

// --- column 1: the two sources ---------------------------------------------

export const IN_COLUMN = {
  title: "Two sources",
  sub: "One generated, one uploaded",
} as const

/** What each source is, by its `{image:N}` position. Falls back to the
 *  node's kind ("generated image" / "uploaded image") for a re-authored template. */
export const SOURCE_ROLES: Record<number, string> = {
  1: "generated runway shot",
  2: "uploaded studio shot",
}

export const SAME_TWO = {
  eyebrow: "SAME TWO, EVERY TIME",
  body: "All five recipes are wired to these two images. Nothing is re-uploaded and nothing is edited between runs.",
} as const

// --- column 2: the five recipes ---------------------------------------------

export const RECIPES_COLUMN = {
  title: "Five recipes",
  sub: "One line of prompt each",
  meta: "CLICK ONE",
} as const

export const TAKES_EYEBROW = "WHAT THIS RECIPE TAKES"
export const NODE_EYEBROW = "NODE"

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

/**
 * Keyed by recipe signature (see `recipeKey`). ORDER MATTERS: this is
 * the lesson sequence the design authored (recipe 2 is "the point of the whole
 * template"; 3 and 4 are deliberately adjacent mirrors; 5 stacks). The body
 * sorts the template's recipes into this order and appends any it does not know.
 */
export const RECIPE_COPY: ReadonlyArray<readonly [signature: string, copy: RecipeCopy]> = [
  [
    "1:person 2:face",
    {
      name: "Face from one, body from the other",
      outTitle: "One body, another face",
      outSub: "Recipe 1 · both references qualified",
      lessonKind: "THE BASELINE",
      lesson: "Two qualified references build a single person out of two images. Neither one arrives whole.",
      notes: {
        "1:person": "Pose, build and framing. Its face is not used.",
        "2:face": "Only the face crosses over.",
      },
    },
  ],
  [
    "2:person 1:face",
    {
      name: "Swap the order, swap the result",
      outTitle: "The same recipe, reversed",
      outSub: "Recipe 2 · numbers exchanged",
      lessonKind: "THE POINT OF THE WHOLE TEMPLATE",
      lesson: "Identical qualifiers, swapped numbers. Which image is 1 and which is 2 decides who ends up in the picture.",
      notes: {
        "2:person": "Now the second source supplies the body.",
        "1:face": "And the first supplies only the face.",
      },
    },
  ],
  [
    "1:background 2:person",
    {
      name: "Keep the stage, change the star",
      outTitle: "Same place, different person",
      outSub: "Recipe 3 · background qualifier",
      lessonKind: "A DIFFERENT QUALIFIER",
      lesson: "background asks for the place without its occupant. Useful when the location is the thing you want to keep.",
      notes: {
        "1:background": "The runway and its lighting, without the model.",
        "2:person": "The person who now stands in it.",
      },
    },
  ],
  [
    "1:person 2:settings",
    {
      name: "Off the runway, into the studio",
      outTitle: "Same person, different place",
      outSub: "Recipe 4 · the mirror of recipe 3",
      lessonKind: "READ THE PREPOSITION",
      lesson: "settings is the inverse of the recipe above it: keep the person, move them somewhere else. The word in does the placing.",
      notes: {
        "1:person": "The subject, carried across whole.",
        "2:settings": "The studio backdrop and its light.",
      },
    },
  ],
  [
    "1:person 2:jacket 2:settings",
    {
      name: "Her jacket, her studio, your model",
      outTitle: "Three parts, two images",
      outSub: "Recipe 5 · two qualifiers off one source",
      lessonKind: "STACKING",
      lesson: "The same source can be named twice with different qualifiers. Here image 2 gives up both a garment and a location, in one line.",
      notes: {
        "1:person": "The subject.",
        "2:jacket": "One garment, pulled out on its own.",
        "2:settings": "And the room it was photographed in.",
      },
    },
  ],
]

/** The lesson order as recipe signatures — what `deriveOneCharacterGraph` sorts by. */
export const RECIPE_ORDER: readonly string[] = RECIPE_COPY.map(([signature]) => signature)

/** Prose for a recipe the template carries but this file does not know:
 *  the body still renders it, honestly labelled. */
export function copyFor(key: string, index: number): RecipeCopy {
  const hit = RECIPE_COPY.find(([signature]) => signature === key)
  if (hit) return hit[1]
  return {
    name: `Recipe ${index}`,
    outTitle: `Recipe ${index}`,
    outSub: `Recipe ${index} · as written on the node`,
    lessonKind: "ANOTHER COMBINATION",
    lesson: "Read the prompt: which source is named, which part of it, and on which number.",
    notes: {},
  }
}

// --- column 3: the result and the breakdown ---------------------------------

export const ADDS_UP_EYEBROW = "HOW IT ADDS UP"
export const RESULT_CHIP = "THE RESULT"
export const RESULT_CAPTION = "one image, no masks"
export const NOT_RUN = "Not generated yet"

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

export const CROPS: Record<string, CropWindow> = {
  face: { size: "300%", position: "52% 6%", caption: "just the face" },
  person: { size: "cover", position: "center top", caption: "the whole figure" },
  background: { size: "230%", position: "6% 62%", caption: "the runway around her" },
  jacket: { size: "260%", position: "6% 82%", caption: "one garment" },
  settings: { size: "cover", position: "center top", caption: "the room only", blank: true },
}

export const BLANK_TILE_LABEL = "NO PERSON, JUST THE ROOM"

/** A qualifier this map does not know shows the whole source, honestly captioned. */
export function cropFor(qualifier: string): CropWindow {
  return CROPS[qualifier] ?? { size: "cover", position: "center top", caption: `the ${qualifier || "source"}` }
}
