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
  | "body-proportions"
  | "face-shape"
  | "jawline"
  | "eye-shape"
  | "nose"
  | "lips"
  | "lip-state"
  | "hair-color"
  | "hair-base"
  | "eyebrows"
  | "skin-tone"
  | "skin-texture"
  | "eye-color"
  | "eye-state"
  | "facial-hair"
  | "distinctive-features"

export interface Person {
  readonly id: string
  readonly label: string
  readonly dimension: PersonDimension
  readonly description: string
  readonly promptHint: string
  /** Optional sub-grouping within a dimension. Used by the picker to render
   *  two-level selection (e.g. ethnicity grouped by region → specific). */
  readonly group?: string
  /** Optional shorter label for the picker chip. When a dimension renders
   *  with group headers (e.g. ethnicity), the group name already supplies
   *  context — so a chip under the "Asian" header shows "East (any)"
   *  instead of the redundant "East Asian (any)". Node cards + tooltips
   *  keep the full `label` / `description`. */
  readonly shortLabel?: string
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
  { id: "supermodel",        label: "Supermodel",         dimension: "type", description: "Iconic, top-tier runway and cover star", promptHint: "a supermodel — iconic top-tier presence with magnetic statement features, a striking silhouette and the unmistakable runway-and-cover aura that commands attention" },
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
  // Asian (generic + East / South / Southeast breakouts + national-level splits)
  { id: "asian-any",          label: "Asian (any)",         shortLabel: "any",              group: "Asian", dimension: "ethnicity", description: "Any Asian — unspecified region", promptHint: "of Asian descent" },
  { id: "east-asian",         label: "East Asian (any)",    shortLabel: "East (any)",       group: "Asian", dimension: "ethnicity", description: "East Asian features (broad)",   promptHint: "East Asian" },
  { id: "chinese",            label: "Chinese",             group: "Asian", dimension: "ethnicity", description: "Han Chinese features",          promptHint: "of Chinese descent" },
  { id: "japanese",           label: "Japanese",            group: "Asian", dimension: "ethnicity", description: "Japanese features",             promptHint: "of Japanese descent" },
  { id: "korean",             label: "Korean",              group: "Asian", dimension: "ethnicity", description: "Korean features",               promptHint: "of Korean descent" },
  { id: "mongolian-tibetan",  label: "Mongolian / Tibetan", shortLabel: "Mongol / Tibetan", group: "Asian", dimension: "ethnicity", description: "Mongolian / Tibetan features", promptHint: "of Mongolian or Tibetan descent" },
  { id: "south-asian",        label: "South Asian / Indian", shortLabel: "South / Indian", group: "Asian", dimension: "ethnicity", description: "Indian / Pakistani / Bangladeshi / Sri Lankan", promptHint: "South Asian" },
  { id: "southeast-asian",    label: "Southeast Asian (any)", shortLabel: "Southeast (any)", group: "Asian", dimension: "ethnicity", description: "Southeast Asian (broad)",    promptHint: "Southeast Asian" },
  { id: "thai",               label: "Thai",                group: "Asian", dimension: "ethnicity", description: "Thai features",                 promptHint: "of Thai descent" },
  { id: "vietnamese",         label: "Vietnamese",          group: "Asian", dimension: "ethnicity", description: "Vietnamese features",           promptHint: "of Vietnamese descent" },
  { id: "indonesian-malay",   label: "Indonesian / Malay",  shortLabel: "Indo / Malay",     group: "Asian", dimension: "ethnicity", description: "Indonesian / Malay features",   promptHint: "of Indonesian or Malay descent" },
  { id: "khmer",              label: "Khmer / Cambodian",   shortLabel: "Khmer",            group: "Asian", dimension: "ethnicity", description: "Khmer / Cambodian features",    promptHint: "of Khmer Cambodian descent" },
  { id: "filipino",           label: "Filipino",            group: "Asian", dimension: "ethnicity", description: "Filipino features (Asian + Spanish heritage)", promptHint: "Filipino" },
  // Middle East & North Africa
  { id: "mena-any",           label: "Middle Eastern / N. African (any)", shortLabel: "any", group: "Middle East & N. Africa", dimension: "ethnicity", description: "Any MENA — unspecified", promptHint: "of Middle Eastern or North African descent" },
  { id: "middle-eastern",     label: "Middle Eastern (Arab)", shortLabel: "Arab",           group: "Middle East & N. Africa", dimension: "ethnicity", description: "Arab / Levantine / Gulf features", promptHint: "Middle Eastern" },
  { id: "turkish",            label: "Turkish",             group: "Middle East & N. Africa", dimension: "ethnicity", description: "Anatolian Turkish features",        promptHint: "of Turkish descent" },
  { id: "persian",            label: "Persian / Iranian",   shortLabel: "Persian",          group: "Middle East & N. Africa", dimension: "ethnicity", description: "Indo-Iranian features",             promptHint: "of Persian Iranian descent" },
  // African
  { id: "african",            label: "African (any)",       shortLabel: "any",              group: "African", dimension: "ethnicity", description: "Any Sub-Saharan African — unspecified region", promptHint: "of African descent" },
  { id: "west-african",       label: "West African",        shortLabel: "West",             group: "African", dimension: "ethnicity", description: "Yoruba / Igbo / Akan / Wolof",     promptHint: "of West African descent" },
  { id: "east-african",       label: "East African",        shortLabel: "East",             group: "African", dimension: "ethnicity", description: "Somali / Ethiopian / Swahili",     promptHint: "of East African descent" },
  { id: "central-african",    label: "Central African",     shortLabel: "Central",          group: "African", dimension: "ethnicity", description: "Bantu / Congolese / Angolan",       promptHint: "of Central African descent" },
  { id: "southern-african",   label: "Southern African",    shortLabel: "Southern",         group: "African", dimension: "ethnicity", description: "Zulu / Xhosa / Sotho",              promptHint: "of Southern African descent" },
  { id: "afro-caribbean",     label: "Afro-Caribbean",      group: "African", dimension: "ethnicity", description: "Anglophone Caribbean (Jamaica / Trinidad / Barbados)", promptHint: "of Afro-Caribbean descent" },
  // European
  { id: "european-any",       label: "European (any)",      shortLabel: "any",              group: "European", dimension: "ethnicity", description: "Any European — unspecified region", promptHint: "of European descent" },
  { id: "nordic",             label: "Nordic (any)",        shortLabel: "Nordic",           group: "European", dimension: "ethnicity", description: "Any Scandinavian / Northern European — unspecified region", promptHint: "of Nordic Scandinavian descent" },
  { id: "swedish",            label: "Swedish",             group: "European", dimension: "ethnicity", description: "Sweden — tall, often blonde, fine features", promptHint: "of Swedish descent" },
  { id: "norwegian",          label: "Norwegian",           group: "European", dimension: "ethnicity", description: "Norway — fair-skinned, often light-eyed",   promptHint: "of Norwegian descent" },
  { id: "danish",             label: "Danish",              group: "European", dimension: "ethnicity", description: "Denmark — soft features, ash-blonde common", promptHint: "of Danish descent" },
  { id: "finnish",            label: "Finnish",             group: "European", dimension: "ethnicity", description: "Finland — Uralic features, high cheekbones", promptHint: "of Finnish descent" },
  { id: "icelandic",          label: "Icelandic",           group: "European", dimension: "ethnicity", description: "Iceland — Norse + Celtic blend, sharp angular features", promptHint: "of Icelandic descent" },
  { id: "celtic",             label: "Celtic",              group: "European", dimension: "ethnicity", description: "British / Irish features",          promptHint: "of Celtic British descent" },
  { id: "mediterranean",      label: "Mediterranean",       shortLabel: "Mediter.",         group: "European", dimension: "ethnicity", description: "Southern European (broad)",         promptHint: "of Mediterranean descent" },
  { id: "slavic",             label: "Slavic",              group: "European", dimension: "ethnicity", description: "Eastern European features",         promptHint: "of Slavic Eastern European descent" },
  { id: "italian",            label: "Italian",             group: "European", dimension: "ethnicity", description: "Italian features",                  promptHint: "of Italian descent" },
  { id: "iberian",            label: "Iberian (Spanish / Portuguese)", shortLabel: "Iberian", group: "European", dimension: "ethnicity", description: "Spanish / Portuguese with Celtiberian + Moorish heritage", promptHint: "of Iberian Spanish or Portuguese descent" },
  { id: "french",             label: "French",              group: "European", dimension: "ethnicity", description: "French features (varies north to south)", promptHint: "of French descent" },
  { id: "germanic",           label: "Germanic",            group: "European", dimension: "ethnicity", description: "German / Austrian / Dutch / Swiss-German", promptHint: "of Germanic descent" },
  { id: "greek",              label: "Greek",               group: "European", dimension: "ethnicity", description: "Greek features",                    promptHint: "of Greek descent" },
  { id: "baltic",             label: "Baltic",              group: "European", dimension: "ethnicity", description: "Lithuanian / Latvian / Estonian",   promptHint: "of Baltic descent" },
  // Latin American
  { id: "latin-american",     label: "Latin American (any)", shortLabel: "any",             group: "Latin American", dimension: "ethnicity", description: "Any Latin American — unspecified region", promptHint: "Latin American" },
  { id: "mexican-mesoamerican", label: "Mexican / Mesoamerican", shortLabel: "Mexican",     group: "Latin American", dimension: "ethnicity", description: "Mexican / Guatemalan / Central American Mestizo", promptHint: "of Mexican or Mesoamerican heritage" },
  { id: "caribbean-latino",   label: "Caribbean Latin",     shortLabel: "Caribbean",        group: "Latin American", dimension: "ethnicity", description: "Cuban / Dominican / Puerto Rican",  promptHint: "of Caribbean Latin heritage" },
  { id: "brazilian",          label: "Brazilian",           group: "Latin American", dimension: "ethnicity", description: "Brazilian (Portuguese + African + Indigenous)", promptHint: "of Brazilian heritage" },
  { id: "andean-indigenous",  label: "Andean / Indigenous Latin", shortLabel: "Andean",     group: "Latin American", dimension: "ethnicity", description: "Quechua / Aymara / Maya / Nahua", promptHint: "of Andean or Indigenous Latin American heritage" },
  { id: "southern-cone",      label: "Southern Cone European", shortLabel: "Southern Cone", group: "Latin American", dimension: "ethnicity", description: "Argentinian / Uruguayan / Chilean (largely European descent)", promptHint: "of Southern Cone European descent" },
  // Indigenous
  { id: "indigenous-any",     label: "Indigenous (any)",    shortLabel: "any",              group: "Indigenous", dimension: "ethnicity", description: "Any Indigenous — unspecified group", promptHint: "of Indigenous descent" },
  { id: "native-american",    label: "Native American",     shortLabel: "Native American",  group: "Indigenous", dimension: "ethnicity", description: "Native American / First Nations",   promptHint: "Native American" },
  { id: "aboriginal-australian", label: "Aboriginal Australian", shortLabel: "Aboriginal",  group: "Indigenous", dimension: "ethnicity", description: "Aboriginal Australian / Torres Strait", promptHint: "Aboriginal Australian" },
  { id: "pacific-islander",   label: "Pacific Islander",    shortLabel: "Pacific Isl.",     group: "Indigenous", dimension: "ethnicity", description: "Polynesian / Maori / Samoan / Hawaiian", promptHint: "Pacific Islander" },
  { id: "inuit",              label: "Inuit / Arctic",      shortLabel: "Inuit",            group: "Indigenous", dimension: "ethnicity", description: "Inuit / Yupik / Aleut",             promptHint: "of Inuit Arctic descent" },
  // Other
  { id: "mixed",              label: "Mixed",              group: "Other", dimension: "ethnicity", description: "Mixed heritage",                    promptHint: "of mixed heritage" },

  // -------------------- Build (silhouette + height) --------------------
  { id: "petite",        label: "Petite",         dimension: "build", description: "Short and small-framed", promptHint: "petite" },
  { id: "slim",          label: "Slim",           dimension: "build", description: "Thin, slender build",    promptHint: "slim build" },
  { id: "average-build", label: "Average",        dimension: "build", description: "Average build",          promptHint: "of average build" },
  { id: "athletic",      label: "Athletic",       dimension: "build", description: "Toned, athletic",        promptHint: "athletic build" },
  { id: "muscular",      label: "Muscular",       dimension: "build", description: "Muscular, powerful",     promptHint: "muscular build" },
  { id: "curvy",         label: "Curvy",          dimension: "build", description: "Curvy figure",           promptHint: "curvy figure" },
  { id: "heavy-set",     label: "Heavy-set",      dimension: "build", description: "Large, heavy-set",       promptHint: "heavy-set build" },
  { id: "tall-lean",     label: "Tall & Lean",    dimension: "build", description: "Tall, lean frame",       promptHint: "tall and lean" },
  { id: "voluptuous",    label: "Voluptuous",     dimension: "build", description: "Full-figured, curvy",    promptHint: "voluptuous, full-figured curvy build" },
  { id: "hourglass",     label: "Hourglass",      dimension: "build", description: "Narrow waist, full bust + hips", promptHint: "an hourglass build with a narrow waist and full hips and bust" },
  { id: "pear-build",    label: "Pear",           dimension: "build", description: "Narrower upper body, fuller hips", promptHint: "a pear-shaped build with a narrower upper body and fuller hips" },
  { id: "apple-build",   label: "Apple",          dimension: "build", description: "Fuller midsection, slimmer legs", promptHint: "an apple-shaped build with a fuller midsection and slimmer legs" },
  { id: "rectangular",   label: "Rectangular / Boyish", dimension: "build", description: "Straight up-and-down silhouette", promptHint: "a rectangular boyish build with a straight up-and-down silhouette" },
  { id: "plus-size",     label: "Plus-size",      dimension: "build", description: "Plus-size body type",    promptHint: "a plus-size build" },
  { id: "lanky",         label: "Lanky",          dimension: "build", description: "Tall and thin, long limbs", promptHint: "a lanky build, tall and thin with long limbs" },

  // -------------------- Body Proportions (ratio, distinct from Build's silhouette+size) --------------------
  { id: "proportions-balanced",     label: "Balanced",       dimension: "body-proportions", description: "Even legs-to-torso ratio",   promptHint: "balanced body proportions, even legs-to-torso ratio" },
  { id: "proportions-long-legged",  label: "Long-Legged",    dimension: "body-proportions", description: "Notably long legs",           promptHint: "long legs in proportion to a shorter torso" },
  { id: "proportions-short-legged", label: "Short-Legged",   dimension: "body-proportions", description: "Shorter legs, longer torso",  promptHint: "shorter legs in proportion to a longer torso" },
  { id: "proportions-long-torso",   label: "Long Torso",     dimension: "body-proportions", description: "Notably long torso",          promptHint: "a notably long torso" },
  { id: "proportions-hourglass",    label: "Hourglass",      dimension: "body-proportions", description: "Defined waist, balanced bust + hips", promptHint: "an hourglass figure with a defined waist and balanced bust and hips" },
  { id: "proportions-pear",         label: "Pear",           dimension: "body-proportions", description: "Wider hips than shoulders",   promptHint: "a pear-shaped figure with hips wider than shoulders" },
  { id: "proportions-apple",        label: "Apple",          dimension: "body-proportions", description: "Fuller midsection",           promptHint: "an apple-shaped figure carrying weight in the midsection" },
  { id: "proportions-inverted",     label: "Inverted Triangle", dimension: "body-proportions", description: "Broad shoulders, narrow hips", promptHint: "an inverted triangle figure with broad shoulders and narrow hips" },

  // -------------------- Face Shape --------------------
  { id: "face-oval",       label: "Oval",       dimension: "face-shape", description: "Slightly longer than wide, soft curves",     promptHint: "an oval face shape" },
  { id: "face-round",      label: "Round",      dimension: "face-shape", description: "Soft circular face",                         promptHint: "a round face shape" },
  { id: "face-square",     label: "Square",     dimension: "face-shape", description: "Strong jaw, equal width forehead and jaw",   promptHint: "a square face shape with a strong jaw" },
  { id: "face-heart",      label: "Heart",      dimension: "face-shape", description: "Wider forehead, pointed chin",               promptHint: "a heart-shaped face with a wide forehead and pointed chin" },
  { id: "face-diamond",    label: "Diamond",    dimension: "face-shape", description: "Narrow forehead and chin, wide cheekbones",  promptHint: "a diamond face shape with a narrow forehead and chin and wide cheekbones" },
  { id: "face-oblong",     label: "Oblong",     dimension: "face-shape", description: "Long and narrow",                            promptHint: "an oblong face shape, long and narrow" },
  { id: "face-triangular", label: "Triangular", dimension: "face-shape", description: "Narrow forehead, wide jaw",                  promptHint: "a triangular face shape with a narrow forehead and wide jaw" },

  // -------------------- Jawline --------------------
  { id: "jaw-strong",  label: "Strong",  dimension: "jawline", description: "Sharp, defined jawline",     promptHint: "a strong, sharply defined jawline" },
  { id: "jaw-soft",    label: "Soft",    dimension: "jawline", description: "Soft, rounded jaw",          promptHint: "a soft rounded jawline" },
  { id: "jaw-pointed", label: "Pointed", dimension: "jawline", description: "Pointed chin, narrow jaw",   promptHint: "a pointed chin with a narrow jawline" },
  { id: "jaw-wide",    label: "Wide",    dimension: "jawline", description: "Wide, broad jaw",            promptHint: "a wide broad jaw" },
  { id: "jaw-double",  label: "Double Chin", dimension: "jawline", description: "Visible double chin",    promptHint: "a visible double chin" },

  // -------------------- Eye Shape --------------------
  { id: "eye-almond",      label: "Almond",     dimension: "eye-shape", description: "Almond-shaped, slightly upturned",  promptHint: "almond-shaped eyes" },
  { id: "eye-round",       label: "Round",      dimension: "eye-shape", description: "Wide, round eyes",                  promptHint: "wide round eyes" },
  { id: "eye-hooded",      label: "Hooded",     dimension: "eye-shape", description: "Upper lid partially covers crease", promptHint: "hooded eyes with the upper lid partially covering the crease" },
  { id: "eye-monolid",     label: "Monolid",    dimension: "eye-shape", description: "No visible crease, smooth lid",     promptHint: "monolid eyes with no visible crease" },
  { id: "eye-deep-set",    label: "Deep-set",   dimension: "eye-shape", description: "Set deeper into the socket",        promptHint: "deep-set eyes" },
  { id: "eye-downturned",  label: "Downturned", dimension: "eye-shape", description: "Outer corners angle down",          promptHint: "downturned eyes with outer corners angled down" },
  { id: "eye-upturned",    label: "Upturned",   dimension: "eye-shape", description: "Outer corners lift up",             promptHint: "upturned eyes with outer corners lifted" },
  { id: "eye-wide-set",    label: "Wide-set",   dimension: "eye-shape", description: "Eyes spaced widely apart",          promptHint: "wide-set eyes" },
  { id: "eye-close-set",   label: "Close-set",  dimension: "eye-shape", description: "Eyes set close together",           promptHint: "close-set eyes" },

  // -------------------- Nose --------------------
  { id: "nose-straight",  label: "Straight",  dimension: "nose", description: "Straight bridge",                 promptHint: "a straight nose" },
  { id: "nose-aquiline",  label: "Aquiline",  dimension: "nose", description: "Curved hooked bridge",            promptHint: "an aquiline nose with a curved bridge" },
  { id: "nose-roman",     label: "Roman",     dimension: "nose", description: "Prominent bridge with slight bump", promptHint: "a Roman nose with a prominent bridge" },
  { id: "nose-snub",      label: "Snub",      dimension: "nose", description: "Short, slightly upturned",        promptHint: "a snub nose, short and slightly upturned" },
  { id: "nose-button",    label: "Button",    dimension: "nose", description: "Small, rounded tip",              promptHint: "a small button nose with a rounded tip" },
  { id: "nose-broad",     label: "Broad",     dimension: "nose", description: "Wide nostrils, broad bridge",     promptHint: "a broad nose with wide nostrils" },
  { id: "nose-narrow",    label: "Narrow",    dimension: "nose", description: "Thin, narrow",                    promptHint: "a narrow thin nose" },
  { id: "nose-hooked",    label: "Hooked",    dimension: "nose", description: "Strongly curved hooked tip",      promptHint: "a hooked nose with a strongly curved tip" },

  // -------------------- Lips --------------------
  { id: "lips-thin",       label: "Thin",        dimension: "lips", description: "Thin lips",                         promptHint: "thin lips" },
  { id: "lips-medium",     label: "Medium",      dimension: "lips", description: "Average fullness",                  promptHint: "medium lips of average fullness" },
  { id: "lips-full",       label: "Full",        dimension: "lips", description: "Full plump lips",                   promptHint: "full plump lips" },
  { id: "lips-wide",       label: "Wide",        dimension: "lips", description: "Wide mouth shape",                  promptHint: "a wide mouth" },
  { id: "lips-cupids-bow", label: "Cupid's Bow", dimension: "lips", description: "Pronounced cupid's bow on upper lip", promptHint: "a pronounced cupid's bow on the upper lip" },
  { id: "lips-small",      label: "Small",       dimension: "lips", description: "Petite mouth",                      promptHint: "a small petite mouth" },

  // -------------------- Lip State (what the lips are doing / wearing) --------------------
  { id: "lip-state-chapped",   label: "Chapped",   dimension: "lip-state", description: "Cracked, dry, weather-worn lips", promptHint: "with chapped, cracked, weather-worn dry lips" },
  { id: "lip-state-glossy",    label: "Glossy",    dimension: "lip-state", description: "High-shine, wet-look lips",       promptHint: "with high-shine glossy wet-look lips" },
  { id: "lip-state-bare",      label: "Bare",      dimension: "lip-state", description: "Natural, untreated, no makeup",   promptHint: "with bare, natural, untreated lips" },
  { id: "lip-state-bold-red",  label: "Bold Red",  dimension: "lip-state", description: "Saturated red lipstick statement", promptHint: "with a bold, saturated red lipstick statement" },
  { id: "lip-state-bitten",    label: "Bitten",    dimension: "lip-state", description: "Slight playful lip-bite, lower lip caught", promptHint: "playfully biting the lower lip" },
  { id: "lip-state-parted",    label: "Parted",    dimension: "lip-state", description: "Lips slightly parted, breath of air", promptHint: "with lips slightly parted, taking a soft breath" },
  { id: "lip-state-pursed",    label: "Pursed",    dimension: "lip-state", description: "Lips pressed and pushed forward", promptHint: "with lips pursed, pressed and pushed forward" },
  { id: "lip-state-pouting",   label: "Pouting",   dimension: "lip-state", description: "Full pout",                       promptHint: "with a full pouting expression" },

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
  // Silver / Metallic
  { id: "hair-silver",      label: "Silver",       dimension: "hair-color", description: "Bright metallic silver",     promptHint: "bright metallic silver hair with a clean reflective sheen" },
  { id: "hair-rose-gold",   label: "Rose Gold",    dimension: "hair-color", description: "Soft pink-gold metallic",    promptHint: "rose gold hair, soft pink-gold metallic warmth" },
  // Dyed (catch-all + specific fantasy / cosplay colors)
  { id: "hair-dyed",        label: "Colorful (any)", dimension: "hair-color", description: "Dyed vibrant colors — unspecified", promptHint: "vibrantly dyed colorful hair" },
  { id: "hair-blue",        label: "Blue",         dimension: "hair-color", description: "Bold blue dyed hair",        promptHint: "bold blue dyed hair" },
  { id: "hair-pastel-blue", label: "Pastel Blue",  dimension: "hair-color", description: "Soft pastel sky-blue",       promptHint: "soft pastel sky-blue hair" },
  { id: "hair-teal",        label: "Teal",         dimension: "hair-color", description: "Saturated teal blue-green",  promptHint: "saturated teal blue-green hair" },
  { id: "hair-mint",        label: "Mint",         dimension: "hair-color", description: "Pale mint green",            promptHint: "pale mint-green hair" },
  { id: "hair-green",       label: "Green",        dimension: "hair-color", description: "Bold green dyed hair",       promptHint: "bold green dyed hair" },
  { id: "hair-lavender",    label: "Lavender",     dimension: "hair-color", description: "Soft lavender violet",       promptHint: "soft lavender violet hair" },
  { id: "hair-purple",      label: "Purple",       dimension: "hair-color", description: "Bold deep purple",           promptHint: "bold deep purple dyed hair" },
  { id: "hair-magenta",     label: "Magenta",      dimension: "hair-color", description: "Vivid magenta pink-purple",  promptHint: "vivid magenta pink-purple hair" },
  { id: "hair-pink",        label: "Pink",         dimension: "hair-color", description: "Bold pink dyed hair",        promptHint: "bold pink dyed hair" },
  { id: "hair-pastel-pink", label: "Pastel Pink",  dimension: "hair-color", description: "Soft pastel cotton-candy pink", promptHint: "soft pastel cotton-candy pink hair" },
  { id: "hair-peach",       label: "Peach",        dimension: "hair-color", description: "Warm peach blonde-pink",     promptHint: "warm peach hair, blonde-pink with soft warmth" },
  { id: "hair-mermaid",     label: "Mermaid",      dimension: "hair-color", description: "Blue-green-purple ocean blend", promptHint: "mermaid hair blending blue, green, and purple in flowing waves" },
  { id: "hair-rainbow",     label: "Rainbow",      dimension: "hair-color", description: "Multi-color rainbow streaks", promptHint: "rainbow hair with streaks of multiple bright dyed colors" },

  // -------------------- Hair Style (length + texture) --------------------
  // -------------------- Hair Base (natural texture + length) --------------------
  // Cut/styling choices live in Styling.hair-cut (separate dimension); this is
  // about what hair the character has, not what was done to it today.
  { id: "base-bald",             label: "Bald / Shaved",   dimension: "hair-base", description: "Bald or fully shaved head",        promptHint: "a shaved bald head" },
  { id: "base-buzz",             label: "Buzz",            dimension: "hair-base", description: "Very short cropped hair",          promptHint: "very short buzzed hair" },
  { id: "base-short-straight",   label: "Short Straight",  dimension: "hair-base", description: "Short, straight texture",          promptHint: "short straight hair" },
  { id: "base-short-wavy",       label: "Short Wavy",      dimension: "hair-base", description: "Short, wavy texture",              promptHint: "short wavy hair" },
  { id: "base-short-curly",      label: "Short Curly",     dimension: "hair-base", description: "Short, curly texture",             promptHint: "short curly hair" },
  { id: "base-short-coily",      label: "Short Coily",     dimension: "hair-base", description: "Short, tightly coiled texture",    promptHint: "short tightly coiled hair" },
  { id: "base-medium-straight",  label: "Medium Straight", dimension: "hair-base", description: "Shoulder-length, straight",        promptHint: "medium-length straight hair" },
  { id: "base-medium-wavy",      label: "Medium Wavy",     dimension: "hair-base", description: "Shoulder-length, wavy",            promptHint: "medium-length wavy hair" },
  { id: "base-medium-curly",     label: "Medium Curly",    dimension: "hair-base", description: "Shoulder-length, curly",           promptHint: "medium-length curly hair" },
  { id: "base-medium-coily",     label: "Medium Coily",    dimension: "hair-base", description: "Shoulder-length, tightly coiled",  promptHint: "medium-length tightly coiled hair" },
  { id: "base-long-straight",    label: "Long Straight",   dimension: "hair-base", description: "Mid-back, straight",               promptHint: "long straight hair" },
  { id: "base-long-wavy",        label: "Long Wavy",       dimension: "hair-base", description: "Mid-back, wavy",                   promptHint: "long wavy hair" },
  { id: "base-long-curly",       label: "Long Curly",      dimension: "hair-base", description: "Mid-back, curly",                  promptHint: "long curly hair" },
  { id: "base-long-coily",       label: "Long Coily",      dimension: "hair-base", description: "Mid-back, tightly coiled",         promptHint: "long tightly coiled hair" },
  { id: "base-very-long-straight", label: "Very Long Straight", dimension: "hair-base", description: "Waist-length, straight",      promptHint: "very long straight hair down to the waist" },
  { id: "base-very-long-wavy",   label: "Very Long Wavy",  dimension: "hair-base", description: "Waist-length, wavy",               promptHint: "very long wavy hair down to the waist" },
  { id: "base-very-long-curly",  label: "Very Long Curly", dimension: "hair-base", description: "Waist-length, curly",              promptHint: "very long curly hair down to the waist" },
  { id: "base-afro",             label: "Afro",            dimension: "hair-base", description: "Voluminous rounded afro",          promptHint: "voluminous afro hair" },
  { id: "base-thinning",         label: "Thinning / Receding", dimension: "hair-base", description: "Visibly thinning or receding hairline", promptHint: "thinning hair with a receding hairline" },
  { id: "base-wet",              label: "Wet",             dimension: "hair-base", description: "Wet, slick hair",                  promptHint: "wet, slick hair" },

  // -------------------- Eyebrows --------------------
  { id: "brows-natural",         label: "Natural",         dimension: "eyebrows", description: "Natural, untouched brows",          promptHint: "natural eyebrows" },
  { id: "brows-thick",           label: "Thick / Bushy",   dimension: "eyebrows", description: "Thick, bushy brows",                promptHint: "thick bushy eyebrows" },
  { id: "brows-thin",            label: "Thin / Pencil",   dimension: "eyebrows", description: "Thin, pencil-shaped brows",         promptHint: "thin pencil-shaped eyebrows" },
  { id: "brows-arched",          label: "Arched",          dimension: "eyebrows", description: "Strongly arched, dramatic curve",   promptHint: "strongly arched eyebrows with a dramatic curve" },
  { id: "brows-straight",        label: "Straight",        dimension: "eyebrows", description: "Flat, horizontal brows",            promptHint: "flat straight eyebrows" },
  { id: "brows-bold",            label: "Bold",            dimension: "eyebrows", description: "Defined, dark, full brows",         promptHint: "bold defined dark full eyebrows" },
  { id: "brows-soft",            label: "Soft / Faded",    dimension: "eyebrows", description: "Soft, light, faded brows",          promptHint: "soft, light, faded eyebrows" },
  { id: "brows-microbladed",     label: "Microbladed",     dimension: "eyebrows", description: "Drawn / microbladed crisp shape",   promptHint: "microbladed crisply drawn eyebrows" },
  { id: "brows-tinted",          label: "Tinted",          dimension: "eyebrows", description: "Tinted a different color than hair", promptHint: "eyebrows tinted a different color from the hair" },
  { id: "brows-unibrow",         label: "Unibrow",         dimension: "eyebrows", description: "Connected unibrow",                 promptHint: "a connected unibrow" },

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
  { id: "eyes-amber",     label: "Amber",     dimension: "eye-color", description: "Amber eyes",                          promptHint: "amber eyes" },
  { id: "eyes-violet",    label: "Violet",    dimension: "eye-color", description: "Rare violet eyes (Liz Taylor)",       promptHint: "rare violet eyes with a deep purple iris" },
  { id: "eyes-gold",      label: "Gold",      dimension: "eye-color", description: "Bright gold iris",                    promptHint: "bright gold eyes with luminous metallic warmth" },
  { id: "eyes-silver",    label: "Silver",    dimension: "eye-color", description: "Pale silver-gray iris",               promptHint: "pale silver eyes with a luminous reflective sheen" },
  { id: "eyes-red",       label: "Red",       dimension: "eye-color", description: "Red iris (albinism / fantasy)",       promptHint: "red eyes, albinism or fantasy red iris" },
  { id: "eyes-pink",      label: "Pink",      dimension: "eye-color", description: "Soft pink iris (albino / fantasy)",   promptHint: "soft pink eyes, albino or fantasy pink iris" },
  { id: "eyes-turquoise", label: "Turquoise", dimension: "eye-color", description: "Vivid turquoise blue-green iris",     promptHint: "vivid turquoise blue-green eyes" },

  // -------------------- Eye State (what the eyes are doing / where they look) --------------------
  { id: "eye-state-closed",         label: "Closed",            dimension: "eye-state", description: "Eyes fully closed, peaceful",       promptHint: "with eyes fully closed in a peaceful expression" },
  { id: "eye-state-half-lidded",    label: "Half-lidded",       dimension: "eye-state", description: "Heavy-lidded sleepy gaze",          promptHint: "with heavy half-lidded sleepy eyes" },
  { id: "eye-state-wide-eyed",      label: "Wide-eyed",         dimension: "eye-state", description: "Eyes wide open, alert / surprised", promptHint: "with eyes wide open, alert and surprised" },
  { id: "eye-state-staring-camera", label: "Staring at Camera", dimension: "eye-state", description: "Direct unbroken eye contact with the lens", promptHint: "staring directly at the camera with unbroken eye contact" },
  { id: "eye-state-gazing-away",    label: "Gazing Away",       dimension: "eye-state", description: "Looking off-camera, contemplative", promptHint: "gazing off-camera with a contemplative expression" },
  { id: "eye-state-gazing-up",      label: "Gazing Up",         dimension: "eye-state", description: "Eyes raised toward something above", promptHint: "with eyes gazing upward toward something above" },
  { id: "eye-state-gazing-down",    label: "Gazing Down",       dimension: "eye-state", description: "Eyes downcast",                     promptHint: "with eyes downcast, gazing softly downward" },
  { id: "eye-state-glassy",         label: "Glassy",            dimension: "eye-state", description: "Eyes wet / tear-glazed",            promptHint: "with glassy, tear-glazed wet eyes" },

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
  { id: "texture-porcelain",  label: "Porcelain",   dimension: "skin-texture", description: "Flawless near-translucent porcelain", promptHint: "with flawless, near-translucent porcelain skin" },
  { id: "texture-sun-kissed", label: "Sun-kissed",  dimension: "skin-texture", description: "Warm tan with healthy glow",  promptHint: "with sun-kissed skin, warmly tanned with a healthy glow" },
  { id: "texture-tanned",     label: "Tanned",      dimension: "skin-texture", description: "Deeply, evenly tanned skin",  promptHint: "with deeply, evenly bronzed tanned skin" },
  { id: "texture-tan-lines",  label: "Tan Lines",   dimension: "skin-texture", description: "Visible tan lines from swimwear", promptHint: "with visible swimwear tan lines on the skin" },
  { id: "texture-freckled",   label: "Freckled",    dimension: "skin-texture", description: "Freckles across cheeks and nose", promptHint: "with visible freckles scattered across cheeks and the bridge of the nose" },
  { id: "texture-ruddy",      label: "Ruddy",       dimension: "skin-texture", description: "Pink-flushed cheeks and nose", promptHint: "with ruddy, warm pink-flushed cheeks and nose" },
  { id: "texture-ashen",      label: "Ashen / Pale", dimension: "skin-texture", description: "Cool pale, near-bloodless undertone", promptHint: "with ashen, cool pale, near-bloodless skin" },
  { id: "texture-oily",       label: "Oily / Shiny", dimension: "skin-texture", description: "Slight oil sheen on T-zone", promptHint: "with a slight oily sheen across the T-zone" },
  { id: "texture-matte",      label: "Matte",       dimension: "skin-texture", description: "Poreless matte finish",       promptHint: "with a poreless, matte skin finish" },
  { id: "texture-blemished",  label: "Blemished",   dimension: "skin-texture", description: "Visible blemishes, real-skin imperfections", promptHint: "with visible blemishes and natural real-skin imperfections" },
  { id: "texture-baby-soft",  label: "Baby-soft",   dimension: "skin-texture", description: "Smooth, fine-pored youthful skin", promptHint: "with baby-soft, fine-pored, youthful smooth skin" },
  { id: "texture-shower-fresh-wet", label: "Shower-Fresh Wet", dimension: "skin-texture", description: "Just-out-of-shower wet skin with water beads", promptHint: "with just-out-of-the-shower wet skin, water beading on the surface and rolling in slow droplets down the curves of the body" },

  // -------------------- Distinctive Features --------------------
  { id: "feature-glasses",   label: "Glasses",      dimension: "distinctive-features", description: "Wears glasses",        promptHint: "wearing glasses" },
  { id: "feature-freckles",  label: "Freckles",     dimension: "distinctive-features", description: "Visible freckles",     promptHint: "with freckles" },
  { id: "feature-tattoos",   label: "Tattoos",      dimension: "distinctive-features", description: "Visible tattoos",      promptHint: "with visible tattoos" },
  { id: "feature-scar",      label: "Scar",         dimension: "distinctive-features", description: "Facial scar",          promptHint: "with a facial scar" },
  { id: "feature-dimples",   label: "Dimples",      dimension: "distinctive-features", description: "Dimpled cheeks",       promptHint: "with dimples" },
  { id: "feature-piercing",  label: "Piercing",     dimension: "distinctive-features", description: "Visible piercing",     promptHint: "with a visible piercing" },
  { id: "feature-birthmark", label: "Birthmark",    dimension: "distinctive-features", description: "Visible birthmark on face or shoulder", promptHint: "with a visible birthmark on the face or shoulder" },
  { id: "feature-mole",      label: "Mole / Beauty Mark", dimension: "distinctive-features", description: "One prominent mole, often near upper lip", promptHint: "with a prominent beauty mark mole near the upper lip" },
  { id: "feature-gap-teeth", label: "Gap Teeth",    dimension: "distinctive-features", description: "Gap between front teeth", promptHint: "with a gap between the front teeth" },
  { id: "feature-monolids",  label: "Monolids",     dimension: "distinctive-features", description: "Single-fold eyelid", promptHint: "with monolid single-fold eyelids" },
  { id: "feature-double-eyelid", label: "Double Eyelid", dimension: "distinctive-features", description: "Defined upper-eyelid crease", promptHint: "with clearly defined double eyelid creases" },
  { id: "feature-aegyo-sal", label: "Aegyo Sal",    dimension: "distinctive-features", description: "Puffy under-eye fold prized in K-beauty", promptHint: "with aegyo sal, the soft puffy under-eye fold" },
  { id: "feature-eye-bags",  label: "Eye Bags",     dimension: "distinctive-features", description: "Mild dark under-eye circles", promptHint: "with mild dark circles and under-eye bags" },
  { id: "feature-dimpled-chin", label: "Dimpled Chin", dimension: "distinctive-features", description: "Soft dimple in the chin", promptHint: "with a soft dimple in the chin" },
  { id: "feature-cleft-chin", label: "Cleft Chin",  dimension: "distinctive-features", description: "Defined vertical chin cleft", promptHint: "with a defined vertical cleft chin" },
  { id: "feature-heterochromia", label: "Heterochromia", dimension: "distinctive-features", description: "Each iris a different color", promptHint: "with heterochromia, each iris a different color" },
  { id: "feature-vitiligo",  label: "Vitiligo",     dimension: "distinctive-features", description: "Patches of depigmented skin", promptHint: "with vitiligo, visible patches of depigmented skin" },
  { id: "feature-sleeve-tattoo", label: "Sleeve Tattoo", dimension: "distinctive-features", description: "Full one-arm tattoo sleeve", promptHint: "with a full tattoo sleeve covering one arm in intricate ink" },
  { id: "feature-face-tattoo", label: "Face Tattoo", dimension: "distinctive-features", description: "Small face tattoo near eye or cheekbone", promptHint: "with a small face tattoo near the eye or cheekbone" },
  { id: "feature-hand-tattoos", label: "Hand Tattoos", dimension: "distinctive-features", description: "Knuckle / finger tattoos", promptHint: "with hand tattoos across knuckles and fingers" },
  { id: "feature-visible-piercings", label: "Visible Piercings", dimension: "distinctive-features", description: "Multiple visible piercings (septum, nose, lip, multi-ear)", promptHint: "with multiple visible piercings — septum, nose, lip, and multi-ear" },
  { id: "feature-bare-shoulders", label: "Bare Shoulders", dimension: "distinctive-features", description: "Bare shoulders exposed", promptHint: "with bare shoulders exposed, the line of the collarbone and shoulder muscles uncovered" },
  { id: "feature-collarbone-visible", label: "Collarbone Visible", dimension: "distinctive-features", description: "Prominent collarbone catching light", promptHint: "with a prominent collarbone clearly defined and catching the light" },
  { id: "feature-midriff-visible", label: "Midriff Visible", dimension: "distinctive-features", description: "Exposed midriff between top and bottom", promptHint: "with the midriff exposed, a strip of bare stomach visible between the top and the bottom" },
  { id: "feature-navel-visible", label: "Navel Visible", dimension: "distinctive-features", description: "Visible navel on bare stomach", promptHint: "with a visible navel on a bare stomach" },
  { id: "feature-elongated-neck", label: "Elongated Neck", dimension: "distinctive-features", description: "Long swan-like neck", promptHint: "with an elongated, swan-like neck, long and gracefully extended" },
] as const

export const PERSON_DIMENSION_ORDER: ReadonlyArray<PersonDimension> = [
  // Identity
  "type",
  "age",
  "ethnicity",
  // Body
  "build",
  "body-proportions",
  // Face structure
  "face-shape",
  "jawline",
  "eye-shape",
  "nose",
  "lips",
  "lip-state",
  // Hair
  "hair-base",
  "hair-color",
  "eyebrows",
  // Skin & eyes
  "skin-tone",
  "skin-texture",
  "eye-color",
  "eye-state",
  "facial-hair",
  "distinctive-features",
]

export const PERSON_DIMENSION_LABELS: Readonly<Record<PersonDimension, string>> = {
  type: "Type",
  age: "Age",
  ethnicity: "Ethnicity",
  build: "Build",
  "body-proportions": "Body Proportions",
  "face-shape": "Face Shape",
  jawline: "Jawline",
  "eye-shape": "Eye Shape",
  nose: "Nose",
  lips: "Lips",
  "lip-state": "Lip State",
  "hair-color": "Hair Color",
  "hair-base": "Hair (Texture & Length)",
  eyebrows: "Eyebrows",
  "skin-tone": "Skin Tone",
  "skin-texture": "Skin Texture",
  "eye-color": "Eye Color",
  "eye-state": "Eye State",
  "facial-hair": "Facial Hair",
  "distinctive-features": "Distinctive Features",
}

/**
 * Maps each PersonDimension to the consumer data field name holding the
 * selected entry id. Multi-dimension model: a consumer (PersonData) may
 * independently set a value in each of the dimensions.
 */
export const PERSON_FIELD_BY_DIMENSION: Record<
  PersonDimension,
  | "type" | "age" | "ethnicity" | "build" | "bodyProportions"
  | "faceShape" | "jawline" | "eyeShape" | "nose" | "lips" | "lipState"
  | "hairColor" | "hairBase" | "eyebrows"
  | "skinTone" | "skinTexture" | "eyeColor" | "eyeState" | "facialHair" | "distinctiveFeature"
> = {
  type: "type",
  age: "age",
  ethnicity: "ethnicity",
  build: "build",
  "body-proportions": "bodyProportions",
  "face-shape": "faceShape",
  jawline: "jawline",
  "eye-shape": "eyeShape",
  nose: "nose",
  lips: "lips",
  "lip-state": "lipState",
  "hair-color": "hairColor",
  "hair-base": "hairBase",
  eyebrows: "eyebrows",
  "skin-tone": "skinTone",
  "skin-texture": "skinTexture",
  "eye-color": "eyeColor",
  "eye-state": "eyeState",
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
  /** Single id, or an array of up to 2 ids for mixed heritage (e.g.
   *  ["slavic","mediterranean"] → "of mixed Slavic and Mediterranean heritage"). */
  ethnicity?: string | ReadonlyArray<string>
  build?: string
  /** Body shape ratio (long-legged, hourglass, pear…). Independent from
   *  Build, which describes silhouette + size. */
  bodyProportions?: string
  /** Face silhouette (oval, round, square, heart…). */
  faceShape?: string
  /** Jaw shape (strong, soft, pointed, wide). */
  jawline?: string
  /** Eye shape (almond, hooded, monolid, deep-set…). */
  eyeShape?: string
  /** Nose shape (straight, aquiline, snub, broad…). */
  nose?: string
  /** Lip fullness / shape (thin, full, wide, cupid's bow…). */
  lips?: string
  /** Lip state — what the lips are doing right now (chapped, glossy,
   *  parted, biting, pursed, bold-red…). Distinct from `lips` which is
   *  anatomical shape. Single id or up to 2 (e.g. glossy + parted). */
  lipState?: string | ReadonlyArray<string>
  /** Single id or up to 2 ids for two-tone / ombre / highlighted hair
   *  (e.g. ["hair-black","hair-platinum"]). */
  hairColor?: string | ReadonlyArray<string>
  /** Natural hair texture + length (texture×length combos). The actual cut
   *  / styling choice (bob, wolf cut, braids…) lives in Styling.hair-cut. */
  hairBase?: string
  eyebrows?: string
  skinTone?: string
  /** Skin texture (smooth, porcelain, freckled, …). Single id or up to 2
   *  combined (e.g. porcelain + freckled, sun-kissed + dewy). */
  skinTexture?: string | ReadonlyArray<string>
  /** Single id or up to 2 ids for heterochromia (e.g.
   *  ["eyes-blue","eyes-green"]). */
  eyeColor?: string | ReadonlyArray<string>
  /** Eye state — what the eyes are doing (closed, half-lidded, wide-eyed,
   *  staring at camera, gazing away/up/down, glassy). Distinct from
   *  `eyeShape` (anatomy) and `eyeColor`. Single id or up to 2 (e.g.
   *  half-lidded + glassy). */
  eyeState?: string | ReadonlyArray<string>
  facialHair?: string
  /** Single id or up to 3 ids for combined features (e.g. freckles +
   *  glasses + sleeve tattoo). */
  distinctiveFeature?: string | ReadonlyArray<string>
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
/**
 * Build the ethnicity hint clause. Single pick → "of {Group} descent"
 * (the entry's own promptHint). Two picks → mixed-heritage clause that
 * names both backgrounds. We use the entry label rather than re-running
 * promptHint, since "of mixed X and Y heritage" is a different grammar
 * from concatenating two "of X descent" / "of Y descent" sentences.
 */
function normalizePickIds(value: unknown): string[] {
  if (typeof value === "string") return value ? [value] : []
  if (!Array.isArray(value)) return []
  const out: string[] = []
  for (const v of value) {
    if (typeof v === "string" && v && !out.includes(v)) out.push(v)
  }
  return out
}

function buildEthnicityHint(value: unknown): string {
  const ids = normalizePickIds(value)
  if (ids.length === 0) return ""
  if (ids.length === 1) return getPersonPromptHint(ids[0])
  const labels = ids
    .slice(0, 2)
    .map((id) => getPerson(id)?.shortLabel ?? getPerson(id)?.label ?? "")
    .filter((s): s is string => Boolean(s))
  if (labels.length < 2) return getPersonPromptHint(ids[0])
  return `of mixed ${labels[0]} and ${labels[1]} heritage`
}

/**
 * Hair color: single → entry's hint ("blonde hair", "auburn hair"). Two →
 * "two-tone X and Y hair" using lowercased entry labels (covers ombre,
 * balayage, highlights, dyed two-tone styles).
 */
function buildHairColorHint(value: unknown): string {
  const ids = normalizePickIds(value)
  if (ids.length === 0) return ""
  if (ids.length === 1) return getPersonPromptHint(ids[0])
  const labels = ids
    .slice(0, 2)
    .map((id) => getPerson(id)?.label?.toLowerCase() ?? "")
    .filter((s): s is string => Boolean(s))
  if (labels.length < 2) return getPersonPromptHint(ids[0])
  return `two-tone ${labels[0]} and ${labels[1]} hair`
}

/**
 * Eye color: single → entry's hint ("blue eyes"). Two → independent emit
 * like distinctive-features. We deliberately avoid hard-coding a
 * heterochromia interpretation because users also pick two colors to
 * mean "natural eye color + tinted contacts" or "sectoral / mixed iris".
 * Letting both hints stand side-by-side lets the diffusion model
 * resolve from the rest of the prompt context. Users wanting an explicit
 * heterochromia look should add the `feature-heterochromia` distinctive
 * feature alongside the two color picks.
 */
function buildEyeColorHints(value: unknown): string[] {
  return emitIndependentHints(value)
}

/**
 * Multi-pick "state" dims (distinctive-features, lip-state, eye-state,
 * skin-texture) — independent flags rather than mutually exclusive. Each
 * entry's promptHint is a standalone "with X" / "wearing X" / "staring X"
 * clause, so we emit them all separately and let buildPersonHints'
 * comma-join read naturally.
 */
function emitIndependentHints(value: unknown): string[] {
  const ids = normalizePickIds(value)
  const out: string[] = []
  for (const id of ids) {
    const hint = getPersonPromptHint(id)
    if (hint) out.push(hint)
  }
  return out
}

export function buildPersonHints(
  data: Record<string, unknown> & PersonValue,
): string[] {
  const hints: string[] = []

  const pre = typeof data.preText === "string" ? data.preText.trim() : ""
  if (pre) hints.push(pre)

  for (const dimension of PERSON_DIMENSION_ORDER) {
    const field = PERSON_FIELD_BY_DIMENSION[dimension]
    const raw = data[field]
    if (dimension === "ethnicity") {
      const h = buildEthnicityHint(raw)
      if (h) hints.push(h)
      continue
    }
    if (dimension === "hair-color") {
      const h = buildHairColorHint(raw)
      if (h) hints.push(h)
      continue
    }
    if (dimension === "eye-color") {
      for (const h of buildEyeColorHints(raw)) hints.push(h)
      continue
    }
    if (
      dimension === "distinctive-features" ||
      dimension === "lip-state" ||
      dimension === "eye-state" ||
      dimension === "skin-texture"
    ) {
      for (const h of emitIndependentHints(raw)) hints.push(h)
      continue
    }
    if (typeof raw !== "string" || raw.length === 0) continue
    const hint = getPersonPromptHint(raw)
    if (hint) hints.push(hint)
  }

  const post = typeof data.postText === "string" ? data.postText.trim() : ""
  if (post) hints.push(post)

  return hints
}
