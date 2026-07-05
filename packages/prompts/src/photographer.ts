/**
 * Canonical catalog of Photographer / Artist Style choices.
 *
 * Single-pick parameter node — user picks ONE photographer or illustrator
 * whose visual signature should drive the look. Each promptHint pairs the
 * artist's name with a couple of distinguishing visual cues, because
 * generative models recognise both the name token and the descriptive
 * vocabulary that surrounds it. Names alone tend to be too vague.
 *
 * Categories:
 *   - editorial: fashion / editorial photographers (dreamy painterly look)
 *   - documentary: documentary, street, photojournalism
 *   - cinematographer: working DPs whose work translates well to stills
 *   - concept: digital painters, concept artists, fantasy illustrators
 *   - illustrator: illustrators, animators, art-nouveau / classical artists
 *
 * Shared between the picker UI, the standalone Photographer parameter node,
 * and the prompt-hint injection on both the frontend DAG executor and the
 * backend orchestrator.
 */

export type PhotographerCategory =
  | "editorial"
  | "documentary"
  | "cinematographer"
  | "concept"
  | "illustrator"

export interface Photographer {
  readonly id: string
  readonly label: string
  readonly category: PhotographerCategory
  readonly description: string
  readonly promptHint: string
}

export const PHOTOGRAPHERS: ReadonlyArray<Photographer> = [
  // -------------------- Editorial / Fashion --------------------
  {
    id: "tim-walker",
    label: "Tim Walker",
    category: "editorial",
    description: "Painterly fairytale fashion",
    promptHint:
      "in the style of Tim Walker, painterly fairytale fashion staging with elaborate hand-built sets and a soft pastel palette",
  },
  {
    id: "paolo-roversi",
    label: "Paolo Roversi",
    category: "editorial",
    description: "Soft, ethereal Polaroid glow",
    promptHint:
      "in the style of Paolo Roversi, soft ethereal Polaroid glow with diffused window light and a warm milky bath",
  },
  {
    id: "marta-bevacqua",
    label: "Marta Bevacqua",
    category: "editorial",
    description: "Dreamy painterly portraiture",
    promptHint:
      "in the style of Marta Bevacqua, dreamy painterly portraiture with hushed natural light and faintly desaturated skin tones",
  },
  {
    id: "patrick-demarchelier",
    label: "Patrick Demarchelier",
    category: "editorial",
    description: "Refined classic fashion portrait",
    promptHint:
      "in the style of Patrick Demarchelier, refined classic fashion portraiture with crisp catchlights and timeless restraint",
  },
  {
    id: "nick-knight",
    label: "Nick Knight",
    category: "editorial",
    description: "High-gloss avant-garde fashion",
    promptHint:
      "in the style of Nick Knight, high-gloss avant-garde fashion with saturated color, precision sharpness and surreal staging",
  },
  {
    id: "mario-testino",
    label: "Mario Testino",
    category: "editorial",
    description: "Glamorous, sun-soaked fashion",
    promptHint:
      "in the style of Mario Testino, glamorous sun-soaked fashion energy with confident posing and bright editorial color",
  },
  {
    id: "steven-meisel",
    label: "Steven Meisel",
    category: "editorial",
    description: "Polished mid-century editorial",
    promptHint:
      "in the style of Steven Meisel, polished mid-century editorial portraiture with controlled studio light and meticulous styling",
  },
  {
    id: "helmut-newton",
    label: "Helmut Newton",
    category: "editorial",
    description: "Bold black-and-white provocation",
    promptHint:
      "in the style of Helmut Newton, bold black-and-white provocation with hard flash, deep shadows and architectural composition",
  },
  {
    id: "mario-sorrenti",
    label: "Mario Sorrenti",
    category: "editorial",
    description: "Intimate, grainy fashion",
    promptHint:
      "in the style of Mario Sorrenti, intimate grainy fashion photography with raw natural light and confessional closeness",
  },
  {
    id: "annie-leibovitz",
    label: "Annie Leibovitz",
    category: "editorial",
    description: "Cinematic celebrity portrait",
    promptHint:
      "in the style of Annie Leibovitz, cinematic celebrity portraiture with theatrical staging and warm dimensional lighting",
  },
  {
    id: "felicia-simion",
    label: "Felicia Simion",
    category: "editorial",
    description: "Surreal pastoral fine art",
    promptHint:
      "in the style of Felicia Simion, surreal pastoral fine-art photography with quiet symbolism and a muted earthy palette",
  },
  {
    id: "oleg-oprisco",
    label: "Oleg Oprisco",
    category: "editorial",
    description: "Cinematic film-grain storytelling",
    promptHint:
      "in the style of Oleg Oprisco, cinematic film-grain storytelling with painterly costuming and analogue color casts",
  },
  {
    id: "bella-kotak",
    label: "Bella Kotak",
    category: "editorial",
    description: "Magical, fantasy-folkloric portraiture",
    promptHint:
      "in the style of Bella Kotak, magical fantasy-folkloric portraiture with golden light, florals and rich painterly grading",
  },
  {
    id: "yigal-ozeri",
    label: "Yigal Ozeri",
    category: "editorial",
    description: "Hyperreal painted portrait",
    promptHint:
      "in the style of Yigal Ozeri, hyperreal painted portraiture with luminous skin and dappled forest light",
  },
  {
    id: "jimmy-marble",
    label: "Jimmy Marble",
    category: "editorial",
    description: "Pastel, candy-bright editorial",
    promptHint:
      "in the style of Jimmy Marble, pastel candy-bright editorial photography with playful color blocking and clean studio shapes",
  },
  {
    id: "rinko-kawauchi",
    label: "Rinko Kawauchi",
    category: "editorial",
    description: "Quiet, light-suffused everyday",
    promptHint:
      "in the style of Rinko Kawauchi, quiet light-suffused everyday photography with a dreamy pastel haze and gentle overexposure",
  },
  {
    id: "ellen-von-unwerth",
    label: "Ellen von Unwerth",
    category: "editorial",
    description: "Playful retro pin-up energy",
    promptHint:
      "in the style of Ellen von Unwerth, playful retro pin-up energy with monochrome flash and mischievous body language",
  },
  {
    id: "mapplethorpe",
    label: "Robert Mapplethorpe",
    category: "editorial",
    description: "Formalist B&W studio nudes and flowers",
    promptHint:
      "in the style of Robert Mapplethorpe, strict formalist black-and-white studio portraiture with dramatic chiaroscuro lighting, sculpted classical nudes and tightly controlled lily and orchid still lifes",
  },
  {
    id: "sherman",
    label: "Cindy Sherman",
    category: "editorial",
    description: "Conceptual self-portrait character study",
    promptHint:
      "in the style of Cindy Sherman, staged conceptual self-portraiture with costumed character studies, film-still references and a dispassionate often unsettling gaze",
  },
  {
    id: "crewdson",
    label: "Gregory Crewdson",
    category: "editorial",
    description: "Cinematic suburban dread tableau",
    promptHint:
      "in the style of Gregory Crewdson, large-format staged tableau of suburban dread with hyper-cinematic twilight blue-hour lighting and every detail meticulously composed",
  },
  {
    id: "lachapelle",
    label: "David LaChapelle",
    category: "editorial",
    description: "Surreal hyper-saturated celebrity camp",
    promptHint:
      "in the style of David LaChapelle, hyper-saturated surrealist celebrity tableau with religious iconography, candy-gloss color and theatrical excess",
  },
  {
    id: "klein",
    label: "Steven Klein",
    category: "editorial",
    description: "Hard-edged glamour and controlled aggression",
    promptHint:
      "in the style of Steven Klein, hard-edged high-fashion glamour with leather and latex wardrobe, dramatic shadowed lighting and a charge of controlled aggression",
  },
  {
    id: "lindbergh",
    label: "Peter Lindbergh",
    category: "editorial",
    description: "Minimalist B&W natural-light fashion",
    promptHint:
      "in the style of Peter Lindbergh, minimalist black-and-white fashion in natural light with bare makeup, supermodel-era documentary feel, windswept beach settings and untouched skin",
  },
  {
    id: "tillmans",
    label: "Wolfgang Tillmans",
    category: "editorial",
    description: "Candid queer intimacy and casual flash",
    promptHint:
      "in the style of Wolfgang Tillmans, democratic mix of intimate snapshot portraiture and abstract still life with casual on-camera flash and party, club and nightlife candor",
  },
  {
    id: "teller",
    label: "Juergen Teller",
    category: "editorial",
    description: "Anti-glamour direct-flash snapshot",
    promptHint:
      "in the style of Juergen Teller, direct on-camera flash snapshot fashion with deadpan unfiltered models, anti-airbrush rawness and an awkward off-kilter staging",
  },
  {
    id: "penn",
    label: "Irving Penn",
    category: "editorial",
    description: "Austere mid-century studio portrait",
    promptHint:
      "in the style of Irving Penn, austere mid-century studio portraiture against a commanding gray seamless backdrop with controlled grace, sculptural fashion staging and refined still-life precision",
  },
  {
    id: "mcginley",
    label: "Ryan McGinley",
    category: "editorial",
    description: "Naturalistic youth + nudity in landscape, sun-flared candid",
    promptHint:
      "shot in the language of Ryan McGinley, naturalistic youth and nudity roaming through open landscape, sun-flared candid 35mm with euphoric movement and unposed freedom",
  },
  {
    id: "mitchell",
    label: "Tyler Mitchell",
    category: "editorial",
    description: "Contemporary Black portraiture, soft natural light, fashion-meets-documentary",
    promptHint:
      "shot in the language of Tyler Mitchell, contemporary Black portraiture in soft natural light with a fashion-meets-documentary tenderness, pastel wardrobe and sun-warmed skin",
  },
  {
    id: "collins",
    label: "Petra Collins",
    category: "editorial",
    description: "Pink-saturated dreamy female-gaze fashion, hazy 35mm",
    promptHint:
      "shot in the language of Petra Collins, dreamy pink-saturated female-gaze fashion, hazy 35mm grain, soft window light",
  },
  {
    id: "weston",
    label: "Edward Weston",
    category: "editorial",
    description: "Modernist B&W still life, sculptural nudes, sharp formalism",
    promptHint:
      "in the style of Edward Weston, modernist black-and-white still life and sculptural nudes with sharp formalism, large-format clarity and sensuous tonal gradation",
  },
  {
    id: "beaton",
    label: "Cecil Beaton",
    category: "editorial",
    description: "Classical Hollywood-era portraiture, theatrical staging, opulent backdrops",
    promptHint:
      "in the style of Cecil Beaton, classical Hollywood-era portraiture with theatrical staging, opulent painted backdrops and elegant silver-screen glamour",
  },

  // -------------------- Documentary / Street --------------------
  {
    id: "henri-cartier-bresson",
    label: "Henri Cartier-Bresson",
    category: "documentary",
    description: "Decisive-moment street photography",
    promptHint:
      "in the style of Henri Cartier-Bresson, decisive-moment black-and-white street photography with geometric framing and natural light",
  },
  {
    id: "vivian-maier",
    label: "Vivian Maier",
    category: "documentary",
    description: "Mid-century American street",
    promptHint:
      "in the style of Vivian Maier, mid-century American street photography with square format, observed candor and silver-rich blacks",
  },
  {
    id: "saul-leiter",
    label: "Saul Leiter",
    category: "documentary",
    description: "Painterly color street through glass",
    promptHint:
      "in the style of Saul Leiter, painterly color street photography seen through fogged glass and rain, with abstract layered framing",
  },
  {
    id: "daido-moriyama",
    label: "Daido Moriyama",
    category: "documentary",
    description: "Grainy, high-contrast Tokyo street",
    promptHint:
      "in the style of Daido Moriyama, grainy high-contrast Tokyo street photography with blown highlights and a restless handheld feel",
  },
  {
    id: "robert-capa",
    label: "Robert Capa",
    category: "documentary",
    description: "Visceral combat photojournalism",
    promptHint:
      "in the style of Robert Capa, visceral combat photojournalism with motion blur, gritty grain and an immediate handheld viewpoint",
  },
  {
    id: "sebastiao-salgado",
    label: "Sebastiao Salgado",
    category: "documentary",
    description: "Epic monochrome social documentary",
    promptHint:
      "in the style of Sebastiao Salgado, epic monochrome social documentary with sweeping landscape scale and chiaroscuro tonality",
  },
  {
    id: "diane-arbus",
    label: "Diane Arbus",
    category: "documentary",
    description: "Stark, confrontational portrait",
    promptHint:
      "in the style of Diane Arbus, stark confrontational portraiture with direct gaze, square format and unflinching daylight",
  },

  // -------------------- Cinematographers --------------------
  {
    id: "roger-deakins",
    label: "Roger Deakins",
    category: "cinematographer",
    description: "Painterly cinematic naturalism",
    promptHint:
      "in the cinematic style of Roger Deakins, painterly natural light with carved silhouettes, deep negative space and restrained color",
  },
  {
    id: "emmanuel-lubezki",
    label: "Emmanuel Lubezki",
    category: "cinematographer",
    description: "Floating natural-light cinematography",
    promptHint:
      "in the cinematic style of Emmanuel Lubezki, floating handheld natural-light cinematography with golden-hour glow and wide-lens immersion",
  },
  {
    id: "greig-fraser",
    label: "Greig Fraser",
    category: "cinematographer",
    description: "Rich tactile genre cinematography",
    promptHint:
      "in the cinematic style of Greig Fraser, rich tactile genre cinematography with anamorphic flares, deep blacks and atmospheric haze",
  },
  {
    id: "christopher-doyle",
    label: "Christopher Doyle",
    category: "cinematographer",
    description: "Saturated handheld neon mood",
    promptHint:
      "in the cinematic style of Christopher Doyle, saturated handheld neon mood with smeared light trails and dreamy slow-shutter blur",
  },

  // -------------------- Concept / Digital Painters --------------------
  {
    id: "greg-rutkowski",
    label: "Greg Rutkowski",
    category: "concept",
    description: "Epic painterly fantasy concept",
    promptHint:
      "in the style of Greg Rutkowski, epic painterly fantasy concept art with sweeping composition, dramatic god-rays and oil-painting brushwork",
  },
  {
    id: "magali-villeneuve",
    label: "Magali Villeneuve",
    category: "concept",
    description: "Heroic fantasy character art",
    promptHint:
      "in the style of Magali Villeneuve, heroic fantasy character art with detailed armor, painterly skin and warm golden lighting",
  },
  {
    id: "charlie-bowater",
    label: "Charlie Bowater",
    category: "concept",
    description: "Atmospheric digital portraiture",
    promptHint:
      "in the style of Charlie Bowater, atmospheric digital portraiture with painterly textures, moody color and intimate close framing",
  },
  {
    id: "sam-spratt",
    label: "Sam Spratt",
    category: "concept",
    description: "Allegorical hyperreal portrait",
    promptHint:
      "in the style of Sam Spratt, allegorical hyperreal portraiture with sculpted lighting, symbolic detail and old-master tonal depth",
  },
  {
    id: "ruan-jia",
    label: "Ruan Jia",
    category: "concept",
    description: "Lush painterly fantasy portrait",
    promptHint:
      "in the style of Ruan Jia, lush painterly fantasy portraiture with rich fabrics, gilded accents and warm directional light",
  },
  {
    id: "ilya-kuvshinov",
    label: "Ilya Kuvshinov",
    category: "concept",
    description: "Anime-inflected stylized portrait",
    promptHint:
      "in the style of Ilya Kuvshinov, anime-inflected stylized portraiture with soft cell-shading, oversized eyes and pastel rim light",
  },
  {
    id: "wlop",
    label: "WLOP",
    category: "concept",
    description: "Ethereal painterly fantasy",
    promptHint:
      "in the style of WLOP, ethereal painterly fantasy portraiture with flowing hair, glowing rim light and a cool monochromatic palette",
  },
  {
    id: "artgerm",
    label: "Artgerm",
    category: "concept",
    description: "Polished comic-book-inspired pinup",
    promptHint:
      "in the style of Artgerm, polished comic-book-inspired pinup illustration with smooth gradients and crisp graphic edge highlights",
  },

  // -------------------- Illustrators / Animators --------------------
  {
    id: "makoto-shinkai",
    label: "Makoto Shinkai",
    category: "illustrator",
    description: "Cinematic anime sky and light",
    promptHint:
      "in the style of Makoto Shinkai, cinematic anime sky and light with luminous clouds, lens-flared sun and saturated dusk gradients",
  },
  {
    id: "studio-ghibli",
    label: "Studio Ghibli",
    category: "illustrator",
    description: "Hand-painted Ghibli warmth",
    promptHint:
      "in the style of Studio Ghibli, hand-painted animation warmth with soft pastel skies, lush vegetation and gentle character expressions",
  },
  {
    id: "alphonse-mucha",
    label: "Alphonse Mucha",
    category: "illustrator",
    description: "Art-nouveau decorative panel",
    promptHint:
      "in the style of Alphonse Mucha, art-nouveau decorative panel with ornamental floral borders, flowing hair and warm gilded tones",
  },
  {
    id: "carne-griffiths",
    label: "Carne Griffiths",
    category: "illustrator",
    description: "Ink-bleed botanical portrait",
    promptHint:
      "in the style of Carne Griffiths, ink-bleed botanical portraiture with calligraphic linework, splashed tea washes and tangled florals",
  },
  {
    id: "conrad-roset",
    label: "Conrad Roset",
    category: "illustrator",
    description: "Gentle watercolor figure",
    promptHint:
      "in the style of Conrad Roset, gentle watercolor figure illustration with soft graphite line, blooming pigment and pale skin tones",
  },
  {
    id: "akihito-yoshida",
    label: "Akihito Yoshida",
    category: "illustrator",
    description: "Quiet ink-and-grain monochrome",
    promptHint:
      "in the style of Akihito Yoshida, quiet ink-and-grain monochrome portraiture with sketchy line and contemplative negative space",
  },
  {
    id: "karol-bak",
    label: "Karol Bak",
    category: "illustrator",
    description: "Symbolist painted muse",
    promptHint:
      "in the style of Karol Bak, symbolist painted muse with gilded-leaf accents, art-nouveau ornament and warm earthen pigment",
  },
  {
    id: "ismail-inceoglu",
    label: "Ismail Inceoglu",
    category: "illustrator",
    description: "Mythic painterly landscape",
    promptHint:
      "in the style of Ismail Inceoglu, mythic painterly landscape with monumental scale, layered atmospheric haze and storybook lighting",
  },
  {
    id: "stefan-gesell",
    label: "Stefan Gesell",
    category: "illustrator",
    description: "Dark surreal portraiture",
    promptHint:
      "in the style of Stefan Gesell, dark surreal portraiture with high-contrast monochrome, masked figures and uneasy theatrical lighting",
  },
  {
    id: "andrew-atroshenko",
    label: "Andrew Atroshenko",
    category: "illustrator",
    description: "Romantic impressionist figure",
    promptHint:
      "in the style of Andrew Atroshenko, romantic impressionist figure painting with loose visible brushwork and shimmering candlelight",
  },
  {
    id: "peter-gric",
    label: "Peter Gric",
    category: "illustrator",
    description: "Architectural surrealist landscape",
    promptHint:
      "in the style of Peter Gric, architectural surrealist landscape with crystalline geometric structures and a cool muted palette",
  },
  {
    id: "ingrid-baars",
    label: "Ingrid Baars",
    category: "illustrator",
    description: "Sculptural fashion-art collage",
    promptHint:
      "in the style of Ingrid Baars, sculptural fashion-art collage with elongated forms, smooth painted skin and ornate textile drapery",
  },
  {
    id: "guido-van-helten",
    label: "Guido van Helten",
    category: "illustrator",
    description: "Monumental muralist portrait",
    promptHint:
      "in the style of Guido van Helten, monumental muralist portraiture with weathered concrete texture and quiet grayscale tonality",
  },
] as const

const photographerById = new Map<string, Photographer>(
  PHOTOGRAPHERS.map((p) => [p.id, p]),
)

export function getPhotographer(id: string | undefined | null): Photographer | undefined {
  if (!id) return undefined
  return photographerById.get(id)
}

export function getPhotographerLabel(id: string | undefined | null, fallback?: string): string {
  const p = getPhotographer(id)
  if (p) return p.label
  if (fallback !== undefined) return fallback
  return (id ?? "").replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
}

export function getPhotographerPromptHint(id: string | undefined | null): string {
  return getPhotographer(id)?.promptHint ?? ""
}

/**
 * Multi-pick variant: 1-2 photographer ids → blended hint. Single → entry's
 * own promptHint. Two → "shot in the blended language of {A} and {B}" — the
 * model interprets this as referencing both creators' visual signatures.
 */
export function buildPhotographerHints(value: unknown): string {
  const ids: string[] = []
  if (typeof value === "string" && value) ids.push(value)
  else if (Array.isArray(value)) {
    for (const v of value) {
      if (typeof v === "string" && v && !ids.includes(v)) ids.push(v)
    }
  }
  if (ids.length === 0) return ""
  if (ids.length === 1) return getPhotographerPromptHint(ids[0])
  const labels = ids
    .slice(0, 2)
    .map((id) => getPhotographer(id)?.label ?? "")
    .filter((s): s is string => Boolean(s))
  if (labels.length < 2) return getPhotographerPromptHint(ids[0])
  return `shot in the blended visual language of ${labels[0]} and ${labels[1]}`
}

export const PHOTOGRAPHER_IDS: ReadonlyArray<string> = PHOTOGRAPHERS.map((p) => p.id)

export const PHOTOGRAPHER_CATEGORY_LABELS: Readonly<Record<PhotographerCategory, string>> = {
  editorial: "Editorial / Fashion",
  documentary: "Documentary / Street",
  cinematographer: "Cinematographer",
  concept: "Concept / Digital",
  illustrator: "Illustrator / Animator",
}

export const PHOTOGRAPHER_CATEGORY_ORDER: ReadonlyArray<PhotographerCategory> = [
  "editorial",
  "documentary",
  "cinematographer",
  "concept",
  "illustrator",
]
