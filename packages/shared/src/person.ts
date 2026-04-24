/**
 * Canonical catalog of Person / subject-appearance choices.
 *
 * Multi-dimension parameter node. Unlike Setting / Style / Camera-Motion
 * (single pick) or Framing (5 dims, all shot composition), Person describes
 * *who the subject is*. Each of the 10 dimensions is mutually exclusive
 * within itself (pick one Type, one Age, one Hair Color, etc.) and all are
 * independently optional.
 *
 *   1.  type                 — primary descriptor (Man, Beautiful Woman, Rugged Man…)
 *   2.  age                  — age range (baby, 30s, 40s, teen, elderly…)
 *   3.  ethnicity            — cultural / demographic background
 *   4.  build                — body silhouette + size (slim, athletic, curvy, tall-lean…)
 *   5.  hair-color           — natural / dyed color
 *   6.  hair-style           — length + texture combo (short, long wavy, braids…)
 *   7.  skin-tone            — skin color
 *   8.  eye-color            — iris color
 *   9.  facial-hair          — beard / mustache style
 *   10. distinctive-features — glasses, freckles, tattoos, scar, dimples, piercing
 *
 * Non-empty selections from each dimension are joined as a compound hint and
 * injected as cinematography context into downstream image/video prompts:
 *   "a beautiful woman, in her 30s, East Asian, slim build, long wavy hair,
 *    brown hair, fair skin, green eyes"
 *
 * Applies to BOTH image and video consumers (a person description is not
 * video-specific, unlike camera-motion / temporal). Not in
 * STILL_IMAGE_EXCLUDE_TYPES.
 *
 * Shared between the picker UI, the standalone Person parameter node, and
 * the prompt-hint injection on both the frontend DAG executor and the
 * backend orchestrator.
 */

export type PersonDimension =
  | "type"
  | "age"
  | "ethnicity"
  | "build"
  | "hair-color"
  | "hair-style"
  | "skin-tone"
  | "skin-texture"
  | "eye-color"
  | "facial-hair"
  | "distinctive-features"

export interface Person {
  readonly id: string
  readonly label: string
  readonly dimension: PersonDimension
  readonly description: string
  readonly promptHint: string
}

export const PEOPLE: ReadonlyArray<Person> = [
  // -------------------- Type (primary subject descriptor) --------------------
  { id: "man",               label: "Man",                dimension: "type", description: "Adult man",                     promptHint: "a man" },
  { id: "woman",             label: "Woman",              dimension: "type", description: "Adult woman",                   promptHint: "a woman" },
  { id: "teen-boy",          label: "Teen Boy",           dimension: "type", description: "Teenage boy",                   promptHint: "a teenage boy" },
  { id: "teen-girl",         label: "Teen Girl",          dimension: "type", description: "Teenage girl",                  promptHint: "a teenage girl" },
  { id: "baby",              label: "Baby",               dimension: "type", description: "Infant under 2",                promptHint: "a baby" },
  { id: "child",             label: "Child",              dimension: "type", description: "Young child",                   promptHint: "a child" },
  { id: "non-binary",        label: "Non-binary Person",  dimension: "type", description: "Non-binary person",             promptHint: "a non-binary person" },
  { id: "beautiful-woman",   label: "Beautiful Woman",    dimension: "type", description: "Classically beautiful woman",   promptHint: "a beautiful woman" },
  { id: "girl-next-door",    label: "Girl Next Door",     dimension: "type", description: "Friendly, approachable, wholesome", promptHint: "a girl-next-door type — friendly, approachable, natural beauty with wholesome charm" },
  { id: "handsome-man",      label: "Handsome Man",       dimension: "type", description: "Classically handsome man",      promptHint: "a handsome man" },
  { id: "boy-next-door",     label: "Boy Next Door",      dimension: "type", description: "Friendly, approachable, wholesome", promptHint: "a boy-next-door type — friendly, approachable, with wholesome charm" },
  { id: "gentleman",         label: "Gentleman",          dimension: "type", description: "Refined, classic, polished man", promptHint: "a refined gentleman with classic elegance and polished presence" },
  { id: "elegant-woman",     label: "Elegant Woman",      dimension: "type", description: "Poised, refined woman",         promptHint: "an elegant, poised woman" },
  { id: "rugged-man",        label: "Rugged Man",         dimension: "type", description: "Weathered, rugged man",         promptHint: "a rugged, weathered man" },
  { id: "bad-boy",           label: "Bad Boy",            dimension: "type", description: "Rebellious, edgy masculine",    promptHint: "a bad boy with rebellious, edgy attitude and a dangerous charm" },
  { id: "graceful-woman",    label: "Graceful Woman",     dimension: "type", description: "Gentle, graceful woman",        promptHint: "a graceful woman" },
  { id: "baddie",            label: "Baddie",             dimension: "type", description: "Confident, trendy, styled woman", promptHint: "a baddie — a confident, trendy woman with styled makeup and a fashion-forward look" },
  { id: "stunning-model",    label: "Stunning Model",     dimension: "type", description: "Fashion-model aesthetic",         promptHint: "a stunning fashion model with editorial poise, refined features, and high-fashion presence" },
  { id: "femme-fatale",      label: "Femme Fatale",       dimension: "type", description: "Alluring, dangerous noir seductress", promptHint: "a femme fatale — alluring, mysterious, and dangerous with classic noir seduction" },
  { id: "tough-guy",         label: "Tough Guy",          dimension: "type", description: "Hardened, tough man",           promptHint: "a tough, hardened man" },
  { id: "wise-elder",        label: "Wise Elder",         dimension: "type", description: "Aged, knowing elder",           promptHint: "a wise elder" },
  { id: "silver-fox",        label: "Silver Fox",         dimension: "type", description: "Distinguished attractive older man", promptHint: "a silver fox — a distinguished, attractive older man with silver-gray hair and a confident magnetism" },
  { id: "mysterious-figure", label: "Mysterious Figure",  dimension: "type", description: "Enigmatic figure",              promptHint: "a mysterious figure" },

  // -------------------- Age --------------------
  { id: "age-baby",     label: "Baby",         dimension: "age", description: "Under 2 years old",       promptHint: "a baby under 2 years old" },
  { id: "age-child",    label: "Child",        dimension: "age", description: "Around 5-12 years old",   promptHint: "around 8 years old" },
  { id: "age-teen",     label: "Teenager",     dimension: "age", description: "13-19 years old",         promptHint: "in their late teens" },
  { id: "age-20s",      label: "20s",          dimension: "age", description: "Twenties",                promptHint: "in their 20s" },
  { id: "age-30s",      label: "30s",          dimension: "age", description: "Thirties",                promptHint: "in their 30s" },
  { id: "age-40s",      label: "40s",          dimension: "age", description: "Forties",                 promptHint: "in their 40s" },
  { id: "age-50s",      label: "50s",          dimension: "age", description: "Fifties",                 promptHint: "in their 50s" },
  { id: "age-60s",      label: "60s",          dimension: "age", description: "Sixties",                 promptHint: "in their 60s" },
  { id: "age-elderly",  label: "Elderly",      dimension: "age", description: "70 and older",            promptHint: "elderly, in their 70s or older" },

  // -------------------- Ethnicity --------------------
  { id: "east-asian",      label: "East Asian",      dimension: "ethnicity", description: "East Asian features",      promptHint: "East Asian" },
  { id: "south-asian",     label: "South Asian",     dimension: "ethnicity", description: "South Asian features",     promptHint: "South Asian" },
  { id: "southeast-asian", label: "Southeast Asian", dimension: "ethnicity", description: "Southeast Asian features", promptHint: "Southeast Asian" },
  { id: "middle-eastern",  label: "Middle Eastern",  dimension: "ethnicity", description: "Middle Eastern features",  promptHint: "Middle Eastern" },
  { id: "african",         label: "African",         dimension: "ethnicity", description: "African features",                  promptHint: "of African descent" },
  { id: "nordic",          label: "Nordic",          dimension: "ethnicity", description: "Scandinavian / Northern European",  promptHint: "of Nordic Scandinavian descent" },
  { id: "celtic",          label: "Celtic",          dimension: "ethnicity", description: "British / Irish features",          promptHint: "of Celtic British descent" },
  { id: "mediterranean",   label: "Mediterranean",   dimension: "ethnicity", description: "Southern European features",        promptHint: "of Mediterranean descent" },
  { id: "slavic",          label: "Slavic",          dimension: "ethnicity", description: "Eastern European features",         promptHint: "of Slavic Eastern European descent" },
  { id: "latin-american",  label: "Latin American",  dimension: "ethnicity", description: "Latin American features",           promptHint: "Latin American" },
  { id: "indigenous",      label: "Indigenous",      dimension: "ethnicity", description: "Indigenous features",      promptHint: "Indigenous" },
  { id: "mixed",           label: "Mixed",           dimension: "ethnicity", description: "Mixed heritage",           promptHint: "of mixed heritage" },

  // -------------------- Build (silhouette + height) --------------------
  { id: "petite",        label: "Petite",         dimension: "build", description: "Short and small-framed", promptHint: "petite" },
  { id: "slim",          label: "Slim",           dimension: "build", description: "Thin, slender build",    promptHint: "slim build" },
  { id: "average-build", label: "Average",        dimension: "build", description: "Average build",          promptHint: "of average build" },
  { id: "athletic",      label: "Athletic",       dimension: "build", description: "Toned, athletic",        promptHint: "athletic build" },
  { id: "muscular",      label: "Muscular",       dimension: "build", description: "Muscular, powerful",     promptHint: "muscular build" },
  { id: "curvy",         label: "Curvy",          dimension: "build", description: "Curvy figure",           promptHint: "curvy figure" },
  { id: "heavy-set",     label: "Heavy-set",      dimension: "build", description: "Large, heavy-set",       promptHint: "heavy-set build" },
  { id: "tall-lean",     label: "Tall & Lean",    dimension: "build", description: "Tall, lean frame",       promptHint: "tall and lean" },

  // -------------------- Hair Color --------------------
  // Blonde family (light → warm → cool)
  { id: "hair-platinum",    label: "Platinum",     dimension: "hair-color", description: "Very pale, icy platinum",   promptHint: "platinum blonde hair, very pale and icy" },
  { id: "hair-creamy",      label: "Creamy",       dimension: "hair-color", description: "Warm creamy / vanilla blonde", promptHint: "creamy vanilla blonde hair" },
  { id: "hair-blonde",      label: "Blonde",       dimension: "hair-color", description: "Classic blonde hair",       promptHint: "blonde hair" },
  { id: "hair-honey",       label: "Honey",        dimension: "hair-color", description: "Warm honey-gold blonde",    promptHint: "honey-gold blonde hair with warm golden tones" },
  { id: "hair-strawberry",  label: "Strawberry Blonde", dimension: "hair-color", description: "Blonde with pinkish-red tone", promptHint: "strawberry blonde hair with a pinkish-red tint" },
  { id: "hair-ash-blonde",  label: "Ash Blonde",   dimension: "hair-color", description: "Cool, ashy blonde",         promptHint: "ash blonde hair with cool, muted tones" },
  // Red / warm family
  { id: "hair-ginger",      label: "Ginger",       dimension: "hair-color", description: "Bright ginger (reddish-orange)", promptHint: "bright ginger hair, reddish-orange" },
  { id: "hair-copper",      label: "Copper",       dimension: "hair-color", description: "Vibrant copper orange-red", promptHint: "vibrant copper hair with orange-red metallic shine" },
  { id: "hair-red",         label: "Red",          dimension: "hair-color", description: "Classic red hair",          promptHint: "red hair" },
  { id: "hair-auburn",      label: "Auburn",       dimension: "hair-color", description: "Rich reddish-brown",        promptHint: "auburn hair, rich reddish-brown" },
  { id: "hair-burgundy",    label: "Burgundy",     dimension: "hair-color", description: "Dark wine-red",             promptHint: "burgundy hair, deep wine-red" },
  // Brown family (light → dark)
  { id: "hair-light-brown", label: "Light Brown",  dimension: "hair-color", description: "Light brown hair",          promptHint: "light brown hair" },
  { id: "hair-caramel",     label: "Caramel",      dimension: "hair-color", description: "Warm caramel brown",        promptHint: "caramel brown hair with warm golden undertones" },
  { id: "hair-brown",       label: "Brown",        dimension: "hair-color", description: "Medium brown hair",         promptHint: "brown hair" },
  { id: "hair-chestnut",    label: "Chestnut",     dimension: "hair-color", description: "Warm reddish-brown chestnut", promptHint: "chestnut brown hair with warm reddish undertones" },
  { id: "hair-chocolate",   label: "Chocolate",    dimension: "hair-color", description: "Rich dark chocolate brown",  promptHint: "rich chocolate brown hair" },
  { id: "hair-dark-brown",  label: "Dark Brown",   dimension: "hair-color", description: "Dark brown hair",           promptHint: "dark brown hair" },
  // Black family
  { id: "hair-black",       label: "Black",        dimension: "hair-color", description: "Classic black hair",        promptHint: "black hair" },
  { id: "hair-jet-black",   label: "Jet Black",    dimension: "hair-color", description: "Deep black with blue undertones", promptHint: "jet black hair with deep blue-black undertones and glossy shine" },
  // Gray / neutral
  { id: "hair-gray",        label: "Gray",         dimension: "hair-color", description: "Gray hair",                 promptHint: "gray hair" },
  { id: "hair-salt-pepper", label: "Salt & Pepper", dimension: "hair-color", description: "Mixed black and gray hair", promptHint: "salt-and-pepper hair" },
  { id: "hair-white",       label: "White",        dimension: "hair-color", description: "White hair",                promptHint: "white hair" },
  // Dyed
  { id: "hair-dyed",        label: "Colorful",     dimension: "hair-color", description: "Dyed vibrant colors",       promptHint: "vibrantly dyed colorful hair" },

  // -------------------- Hair Style (length + texture) --------------------
  { id: "style-pixie",         label: "Pixie",        dimension: "hair-style", description: "Short, cropped pixie cut",  promptHint: "a short pixie cut" },
  { id: "style-short",         label: "Short",        dimension: "hair-style", description: "Short hair",                promptHint: "short hair" },
  { id: "style-bob",           label: "Bob",          dimension: "hair-style", description: "Chin-length bob cut",       promptHint: "a chin-length bob cut" },
  { id: "style-medium",        label: "Medium",       dimension: "hair-style", description: "Shoulder-length hair",      promptHint: "medium-length hair" },
  { id: "style-long-straight", label: "Long Straight", dimension: "hair-style", description: "Long straight hair",       promptHint: "long straight hair" },
  { id: "style-long-wavy",     label: "Long Wavy",    dimension: "hair-style", description: "Long wavy hair",            promptHint: "long wavy hair" },
  { id: "style-long-curly",    label: "Long Curly",   dimension: "hair-style", description: "Long curly hair",           promptHint: "long curly hair" },
  { id: "style-short-curly",   label: "Short Curly",  dimension: "hair-style", description: "Short curly hair",          promptHint: "short curly hair" },
  { id: "style-afro",          label: "Afro",         dimension: "hair-style", description: "Rounded afro",              promptHint: "an afro" },
  { id: "style-braids",        label: "Braids / Locs", dimension: "hair-style", description: "Braids or dreadlocks",       promptHint: "hair in braids" },
  { id: "style-cornrows",      label: "Cornrows",     dimension: "hair-style", description: "Braided cornrow pattern",     promptHint: "hair in tight cornrows" },
  { id: "style-ponytail",      label: "Ponytail",     dimension: "hair-style", description: "Pulled-back ponytail",        promptHint: "hair in a ponytail" },
  { id: "style-bun",           label: "Bun",          dimension: "hair-style", description: "Hair in a bun",               promptHint: "hair in a bun" },
  { id: "style-buzz-cut",      label: "Buzz Cut",     dimension: "hair-style", description: "Very short buzz cut",         promptHint: "a buzz cut" },
  { id: "style-undercut",      label: "Undercut",     dimension: "hair-style", description: "Short sides, longer top",     promptHint: "an undercut with short sides and longer hair on top" },
  { id: "style-shaved",        label: "Shaved / Bald", dimension: "hair-style", description: "Shaved head or bald",        promptHint: "a shaved head" },
  { id: "style-bangs",         label: "Bangs",        dimension: "hair-style", description: "Hair across forehead",        promptHint: "hair with bangs across the forehead" },
  { id: "style-side-swept",    label: "Side-Swept",   dimension: "hair-style", description: "Falls across face over one eye", promptHint: "hair side-swept across the face with strands falling over one eye" },
  { id: "style-slicked-back",  label: "Slicked Back", dimension: "hair-style", description: "Pulled back, polished",       promptHint: "hair slicked back with a polished finish" },

  // -------------------- Skin Tone --------------------
  { id: "skin-very-fair", label: "Very Fair", dimension: "skin-tone", description: "Very fair / pale skin", promptHint: "very fair pale skin" },
  { id: "skin-fair",      label: "Fair",      dimension: "skin-tone", description: "Fair skin",             promptHint: "fair skin" },
  { id: "skin-medium",    label: "Medium",    dimension: "skin-tone", description: "Medium skin tone",      promptHint: "medium skin tone" },
  { id: "skin-olive",     label: "Olive",     dimension: "skin-tone", description: "Olive skin",            promptHint: "olive skin" },
  { id: "skin-tan",       label: "Tan",       dimension: "skin-tone", description: "Tan skin",              promptHint: "tan skin" },
  { id: "skin-brown",     label: "Brown",     dimension: "skin-tone", description: "Brown skin",            promptHint: "brown skin" },
  { id: "skin-dark",      label: "Dark",      dimension: "skin-tone", description: "Dark skin",             promptHint: "dark skin" },

  // -------------------- Eye Color --------------------
  { id: "eyes-brown",  label: "Brown",  dimension: "eye-color", description: "Brown eyes",  promptHint: "brown eyes" },
  { id: "eyes-blue",   label: "Blue",   dimension: "eye-color", description: "Blue eyes",   promptHint: "blue eyes" },
  { id: "eyes-green",  label: "Green",  dimension: "eye-color", description: "Green eyes",  promptHint: "green eyes" },
  { id: "eyes-hazel",  label: "Hazel",  dimension: "eye-color", description: "Hazel eyes",  promptHint: "hazel eyes" },
  { id: "eyes-gray",   label: "Gray",   dimension: "eye-color", description: "Gray eyes",   promptHint: "gray eyes" },
  { id: "eyes-amber",  label: "Amber",  dimension: "eye-color", description: "Amber eyes",  promptHint: "amber eyes" },

  // -------------------- Facial Hair --------------------
  { id: "face-clean-shaven", label: "Clean-shaven", dimension: "facial-hair", description: "Clean-shaven face", promptHint: "clean-shaven" },
  { id: "face-stubble",      label: "Stubble",      dimension: "facial-hair", description: "Light stubble",     promptHint: "light stubble" },
  { id: "face-mustache",     label: "Mustache",     dimension: "facial-hair", description: "Mustache",          promptHint: "a mustache" },
  { id: "face-goatee",       label: "Goatee",       dimension: "facial-hair", description: "Goatee",            promptHint: "a goatee" },
  { id: "face-short-beard",  label: "Short Beard",  dimension: "facial-hair", description: "Short trimmed beard", promptHint: "a short trimmed beard" },
  { id: "face-full-beard",   label: "Full Beard",   dimension: "facial-hair", description: "Thick full beard",  promptHint: "a full beard" },

  // -------------------- Skin Texture --------------------
  { id: "texture-smooth",     label: "Smooth",      dimension: "skin-texture", description: "Flawless, silky smooth skin", promptHint: "with flawless, silky smooth skin" },
  { id: "texture-wrinkled",   label: "Wrinkled",    dimension: "skin-texture", description: "Aged, deeply lined skin",     promptHint: "with deep wrinkles and aged skin texture" },
  { id: "texture-goosebumps", label: "Goosebumps",  dimension: "skin-texture", description: "Raised goosebumps on skin",   promptHint: "with goosebumps raised on the skin" },
  { id: "texture-dewy",       label: "Dewy",        dimension: "skin-texture", description: "Glowing, dewy fresh skin",    promptHint: "with dewy, glowing skin and a fresh sheen" },
  { id: "texture-glistening", label: "Glistening",  dimension: "skin-texture", description: "Sweat or oil sheen",          promptHint: "with glistening skin, sweat or oil catching the light" },
  { id: "texture-weathered",  label: "Weathered",   dimension: "skin-texture", description: "Sun-aged rough skin",         promptHint: "with weathered, sun-worn rough skin" },

  // -------------------- Distinctive Features --------------------
  { id: "feature-glasses",   label: "Glasses",      dimension: "distinctive-features", description: "Wears glasses",        promptHint: "wearing glasses" },
  { id: "feature-freckles",  label: "Freckles",     dimension: "distinctive-features", description: "Visible freckles",     promptHint: "with freckles" },
  { id: "feature-tattoos",   label: "Tattoos",      dimension: "distinctive-features", description: "Visible tattoos",      promptHint: "with visible tattoos" },
  { id: "feature-scar",      label: "Scar",         dimension: "distinctive-features", description: "Facial scar",          promptHint: "with a facial scar" },
  { id: "feature-dimples",   label: "Dimples",      dimension: "distinctive-features", description: "Dimpled cheeks",       promptHint: "with dimples" },
  { id: "feature-piercing",  label: "Piercing",     dimension: "distinctive-features", description: "Visible piercing",     promptHint: "with a visible piercing" },
] as const

export const PERSON_DIMENSION_ORDER: ReadonlyArray<PersonDimension> = [
  "type",
  "age",
  "ethnicity",
  "build",
  "hair-style",
  "hair-color",
  "skin-tone",
  "skin-texture",
  "eye-color",
  "facial-hair",
  "distinctive-features",
]

export const PERSON_DIMENSION_LABELS: Readonly<Record<PersonDimension, string>> = {
  type: "Type",
  age: "Age",
  ethnicity: "Ethnicity",
  build: "Build",
  "hair-color": "Hair Color",
  "hair-style": "Hair Style",
  "skin-tone": "Skin Tone",
  "skin-texture": "Skin Texture",
  "eye-color": "Eye Color",
  "facial-hair": "Facial Hair",
  "distinctive-features": "Distinctive Features",
}

/**
 * Maps each PersonDimension to the consumer data field name holding the
 * selected entry id. Multi-dimension model: a consumer (PersonData) may
 * independently set a value in each of the 9 dimensions.
 */
export const PERSON_FIELD_BY_DIMENSION: Record<
  PersonDimension,
  "type" | "age" | "ethnicity" | "build" | "hairColor" | "hairStyle" | "skinTone" | "skinTexture" | "eyeColor" | "facialHair" | "distinctiveFeature"
> = {
  type: "type",
  age: "age",
  ethnicity: "ethnicity",
  build: "build",
  "hair-color": "hairColor",
  "hair-style": "hairStyle",
  "skin-tone": "skinTone",
  "skin-texture": "skinTexture",
  "eye-color": "eyeColor",
  "facial-hair": "facialHair",
  "distinctive-features": "distinctiveFeature",
}

/**
 * Shape of the per-dimension person fields. All optional — user may set
 * zero, one, or all ten dimensions.
 */
export interface PersonValue {
  type?: string
  age?: string
  ethnicity?: string
  build?: string
  hairColor?: string
  hairStyle?: string
  skinTone?: string
  skinTexture?: string
  eyeColor?: string
  facialHair?: string
  distinctiveFeature?: string
  /** Free-text appended BEFORE the dimension compound. Use when you want
   * context/framing to come first (e.g. "wet-haired" or "covered in paint"). */
  preText?: string
  /** Free-text appended AFTER the dimension compound. Use for extra
   * specifics that dimensions can't capture (e.g. "wearing a leather
   * jacket", "with a silver necklace"). */
  postText?: string
}

const personById = new Map<string, Person>(PEOPLE.map((p) => [p.id, p]))

export function getPerson(id: string | undefined | null): Person | undefined {
  if (!id) return undefined
  return personById.get(id)
}

export function getPersonLabel(id: string | undefined | null, fallback?: string): string {
  const p = getPerson(id)
  if (p) return p.label
  if (fallback !== undefined) return fallback
  return (id ?? "").replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
}

export function getPersonPromptHint(id: string | undefined | null): string {
  return getPerson(id)?.promptHint ?? ""
}

export const PERSON_IDS: ReadonlyArray<string> = PEOPLE.map((p) => p.id)

/**
 * Aggregate all enabled per-dimension person prompt hints from a consumer's
 * data, in canonical dimension order (type, age, ethnicity, build, hair
 * style, hair color, skin tone, eye color, facial hair, distinctive
 * features).
 *
 * Accepts a loosely typed record (the helper is shared between strongly
 * typed frontend node data and the backend's `Record<string, unknown>`
 * workflow data). Non-string values are ignored.
 *
 * Returns array of fragment strings — caller joins on ", " for the
 * compound description ("a beautiful woman, in their 30s, East Asian, slim
 * build, long wavy hair, brown hair, fair skin, green eyes, wearing
 * glasses").
 */
export function buildPersonHints(
  data: Record<string, unknown> & PersonValue,
): string[] {
  const hints: string[] = []

  const pre = typeof data.preText === "string" ? data.preText.trim() : ""
  if (pre) hints.push(pre)

  for (const dimension of PERSON_DIMENSION_ORDER) {
    const field = PERSON_FIELD_BY_DIMENSION[dimension]
    const id = data[field]
    if (typeof id !== "string" || id.length === 0) continue
    const hint = getPersonPromptHint(id)
    if (hint) hints.push(hint)
  }

  const post = typeof data.postText === "string" ? data.postText.trim() : ""
  if (post) hints.push(post)

  return hints
}
