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

import { resolveTerm, type PickerHintMode } from "./term.js"
import { overlayEntry } from "./catalog-overlay.js"

export type PhotographerCategory =
  | "editorial"
  | "documentary"
  | "cinematographer"
  | "director"
  | "concept"
  | "illustrator"

export interface Photographer {
  readonly id: string
  readonly label: string
  readonly category: PhotographerCategory
  readonly description: string
  readonly promptHint: string
  /**
   * Compact-mode term (see `term.ts`). Authored on EVERY entry here, which is
   * the exception rather than the rule for a catalog — two reasons specific to
   * artist styles:
   *
   *  1. The derived term would be a bare person's name. Injected raw into a
   *     generation prompt, "annie leibovitz" reads as the SUBJECT to render,
   *     not as an attribution — it asks for a picture OF the photographer.
   *     Consumers inject `term` verbatim (they render `label` and inject
   *     `term`), so the framing has to live in the term itself.
   *  2. Per this file's own premise, the name token alone is too vague; the
   *     model needs a little of the surrounding visual vocabulary to lock onto
   *     the signature. So each term is `by <name>, <2-3 signature cues>` — a
   *     compression of the promptHint's own shape, never a copy of it.
   *     Cinematographers take the DP credit "shot by" instead.
   *
   * Optional per the `term.ts` convention, but in THIS catalog a new entry
   * that omits it falls back to the bare-name derivation described above —
   * author one alongside the promptHint.
   */
  readonly term?: string
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
    term: "by tim walker, painterly fairytale fashion",
  },
  {
    id: "paolo-roversi",
    label: "Paolo Roversi",
    category: "editorial",
    description: "Soft, ethereal Polaroid glow",
    promptHint:
      "in the style of Paolo Roversi, soft ethereal Polaroid glow with diffused window light and a warm milky bath",
    term: "by paolo roversi, soft ethereal polaroid glow",
  },
  {
    id: "marta-bevacqua",
    label: "Marta Bevacqua",
    category: "editorial",
    description: "Dreamy painterly portraiture",
    promptHint:
      "in the style of Marta Bevacqua, dreamy painterly portraiture with hushed natural light and faintly desaturated skin tones",
    term: "by marta bevacqua, dreamy painterly portraiture",
  },
  {
    id: "patrick-demarchelier",
    label: "Patrick Demarchelier",
    category: "editorial",
    description: "Refined classic fashion portrait",
    promptHint:
      "in the style of Patrick Demarchelier, refined classic fashion portraiture with crisp catchlights and timeless restraint",
    term: "by patrick demarchelier, refined classic fashion",
  },
  {
    id: "nick-knight",
    label: "Nick Knight",
    category: "editorial",
    description: "High-gloss avant-garde fashion",
    promptHint:
      "in the style of Nick Knight, high-gloss avant-garde fashion with saturated color, precision sharpness and surreal staging",
    term: "by nick knight, high-gloss avant-garde fashion",
  },
  {
    id: "mario-testino",
    label: "Mario Testino",
    category: "editorial",
    description: "Glamorous, sun-soaked fashion",
    promptHint:
      "in the style of Mario Testino, glamorous sun-soaked fashion energy with confident posing and bright editorial color",
    term: "by mario testino, glamorous sun-soaked fashion",
  },
  {
    id: "steven-meisel",
    label: "Steven Meisel",
    category: "editorial",
    description: "Polished mid-century editorial",
    promptHint:
      "in the style of Steven Meisel, polished mid-century editorial portraiture with controlled studio light and meticulous styling",
    term: "by steven meisel, polished mid-century editorial",
  },
  {
    id: "helmut-newton",
    label: "Helmut Newton",
    category: "editorial",
    description: "Bold black-and-white provocation",
    promptHint:
      "in the style of Helmut Newton, bold black-and-white provocation with hard flash, deep shadows and architectural composition",
    term: "by helmut newton, hard-flash monochrome glamour",
  },
  {
    id: "mario-sorrenti",
    label: "Mario Sorrenti",
    category: "editorial",
    description: "Intimate, grainy fashion",
    promptHint:
      "in the style of Mario Sorrenti, intimate grainy fashion photography with raw natural light and confessional closeness",
    term: "by mario sorrenti, intimate grainy fashion",
  },
  {
    id: "annie-leibovitz",
    label: "Annie Leibovitz",
    category: "editorial",
    description: "Cinematic celebrity portrait",
    promptHint:
      "in the style of Annie Leibovitz, cinematic celebrity portraiture with theatrical staging and warm dimensional lighting",
    term: "by annie leibovitz, cinematic celebrity portraiture",
  },
  {
    id: "felicia-simion",
    label: "Felicia Simion",
    category: "editorial",
    description: "Surreal pastoral fine art",
    promptHint:
      "in the style of Felicia Simion, surreal pastoral fine-art photography with quiet symbolism and a muted earthy palette",
    term: "by felicia simion, surreal pastoral fine art",
  },
  {
    id: "oleg-oprisco",
    label: "Oleg Oprisco",
    category: "editorial",
    description: "Cinematic film-grain storytelling",
    promptHint:
      "in the style of Oleg Oprisco, cinematic film-grain storytelling with painterly costuming and analogue color casts",
    term: "by oleg oprisco, cinematic film-grain storytelling",
  },
  {
    id: "bella-kotak",
    label: "Bella Kotak",
    category: "editorial",
    description: "Magical, fantasy-folkloric portraiture",
    promptHint:
      "in the style of Bella Kotak, magical fantasy-folkloric portraiture with golden light, florals and rich painterly grading",
    term: "by bella kotak, fantasy-folkloric portraiture",
  },
  {
    id: "yigal-ozeri",
    label: "Yigal Ozeri",
    category: "editorial",
    description: "Hyperreal painted portrait",
    promptHint:
      "in the style of Yigal Ozeri, hyperreal painted portraiture with luminous skin and dappled forest light",
    term: "by yigal ozeri, hyperreal painted portraiture",
  },
  {
    id: "jimmy-marble",
    label: "Jimmy Marble",
    category: "editorial",
    description: "Pastel, candy-bright editorial",
    promptHint:
      "in the style of Jimmy Marble, pastel candy-bright editorial photography with playful color blocking and clean studio shapes",
    term: "by jimmy marble, pastel candy-bright editorial",
  },
  {
    id: "rinko-kawauchi",
    label: "Rinko Kawauchi",
    category: "editorial",
    description: "Quiet, light-suffused everyday",
    promptHint:
      "in the style of Rinko Kawauchi, quiet light-suffused everyday photography with a dreamy pastel haze and gentle overexposure",
    term: "by rinko kawauchi, quiet light-suffused everyday",
  },
  {
    id: "ellen-von-unwerth",
    label: "Ellen von Unwerth",
    category: "editorial",
    description: "Playful retro pin-up energy",
    promptHint:
      "in the style of Ellen von Unwerth, playful retro pin-up energy with monochrome flash and mischievous body language",
    term: "by ellen von unwerth, playful retro pin-up",
  },
  {
    id: "mapplethorpe",
    label: "Robert Mapplethorpe",
    category: "editorial",
    description: "Formalist B&W studio nudes and flowers",
    promptHint:
      "in the style of Robert Mapplethorpe, strict formalist black-and-white studio portraiture with dramatic chiaroscuro lighting, sculpted classical nudes and tightly controlled lily and orchid still lifes",
    term: "by robert mapplethorpe, formalist studio monochrome",
  },
  {
    id: "sherman",
    label: "Cindy Sherman",
    category: "editorial",
    description: "Conceptual self-portrait character study",
    promptHint:
      "in the style of Cindy Sherman, staged conceptual self-portraiture with costumed character studies, film-still references and a dispassionate often unsettling gaze",
    term: "by cindy sherman, staged conceptual film-still portraiture",
  },
  {
    id: "crewdson",
    label: "Gregory Crewdson",
    category: "editorial",
    description: "Cinematic suburban dread tableau",
    promptHint:
      "in the style of Gregory Crewdson, large-format staged tableau of suburban dread with hyper-cinematic twilight blue-hour lighting and every detail meticulously composed",
    term: "by gregory crewdson, cinematic suburban tableau",
  },
  {
    id: "lachapelle",
    label: "David LaChapelle",
    category: "editorial",
    description: "Surreal hyper-saturated celebrity camp",
    promptHint:
      "in the style of David LaChapelle, hyper-saturated surrealist celebrity tableau with religious iconography, candy-gloss color and theatrical excess",
    term: "by david lachapelle, hyper-saturated surrealist camp",
  },
  {
    id: "klein",
    label: "Steven Klein",
    category: "editorial",
    description: "Hard-edged glamour and controlled aggression",
    promptHint:
      "in the style of Steven Klein, hard-edged high-fashion glamour with leather and latex wardrobe, dramatic shadowed lighting and a charge of controlled aggression",
    term: "by steven klein, hard-edged fashion glamour",
  },
  {
    id: "lindbergh",
    label: "Peter Lindbergh",
    category: "editorial",
    description: "Minimalist B&W natural-light fashion",
    promptHint:
      "in the style of Peter Lindbergh, minimalist black-and-white fashion in natural light with bare makeup, supermodel-era documentary feel, windswept beach settings and untouched skin",
    term: "by peter lindbergh, minimalist monochrome fashion",
  },
  {
    id: "tillmans",
    label: "Wolfgang Tillmans",
    category: "editorial",
    description: "Candid queer intimacy and casual flash",
    promptHint:
      "in the style of Wolfgang Tillmans, democratic mix of intimate snapshot portraiture and abstract still life with casual on-camera flash and party, club and nightlife candor",
    term: "by wolfgang tillmans, candid on-camera-flash snapshot",
  },
  {
    id: "teller",
    label: "Juergen Teller",
    category: "editorial",
    description: "Anti-glamour direct-flash snapshot",
    promptHint:
      "in the style of Juergen Teller, direct on-camera flash snapshot fashion with deadpan unfiltered models, anti-airbrush rawness and an awkward off-kilter staging",
    term: "by juergen teller, deadpan direct-flash snapshot",
  },
  {
    id: "penn",
    label: "Irving Penn",
    category: "editorial",
    description: "Austere mid-century studio portrait",
    promptHint:
      "in the style of Irving Penn, austere mid-century studio portraiture against a commanding gray seamless backdrop with controlled grace, sculptural fashion staging and refined still-life precision",
    term: "by irving penn, austere mid-century studio portraiture",
  },
  {
    id: "mcginley",
    label: "Ryan McGinley",
    category: "editorial",
    description: "Naturalistic youth + nudity in landscape, sun-flared candid",
    promptHint:
      "shot in the language of Ryan McGinley, naturalistic youth and nudity roaming through open landscape, sun-flared candid 35mm with euphoric movement and unposed freedom",
    term: "by ryan mcginley, sun-flared candid youth",
  },
  {
    id: "mitchell",
    label: "Tyler Mitchell",
    category: "editorial",
    description: "Contemporary Black portraiture, soft natural light, fashion-meets-documentary",
    promptHint:
      "shot in the language of Tyler Mitchell, contemporary Black portraiture in soft natural light with a fashion-meets-documentary tenderness, pastel wardrobe and sun-warmed skin",
    term: "by tyler mitchell, soft-light contemporary portraiture",
  },
  {
    id: "collins",
    label: "Petra Collins",
    category: "editorial",
    description: "Pink-saturated dreamy female-gaze fashion, hazy 35mm",
    promptHint:
      "shot in the language of Petra Collins, dreamy pink-saturated female-gaze fashion, hazy 35mm grain, soft window light",
    term: "by petra collins, dreamy pink-saturated 35mm",
  },
  {
    id: "weston",
    label: "Edward Weston",
    category: "editorial",
    description: "Modernist B&W still life, sculptural nudes, sharp formalism",
    promptHint:
      "in the style of Edward Weston, modernist black-and-white still life and sculptural nudes with sharp formalism, large-format clarity and sensuous tonal gradation",
    term: "by edward weston, modernist monochrome still life",
  },
  {
    id: "beaton",
    label: "Cecil Beaton",
    category: "editorial",
    description: "Classical Hollywood-era portraiture, theatrical staging, opulent backdrops",
    promptHint:
      "in the style of Cecil Beaton, classical Hollywood-era portraiture with theatrical staging, opulent painted backdrops and elegant silver-screen glamour",
    term: "by cecil beaton, theatrical hollywood-era portraiture",
  },

  // -------------------- Documentary / Street --------------------
  {
    id: "henri-cartier-bresson",
    label: "Henri Cartier-Bresson",
    category: "documentary",
    description: "Decisive-moment street photography",
    promptHint:
      "in the style of Henri Cartier-Bresson, decisive-moment black-and-white street photography with geometric framing and natural light",
    term: "by henri cartier-bresson, decisive-moment street",
  },
  {
    id: "vivian-maier",
    label: "Vivian Maier",
    category: "documentary",
    description: "Mid-century American street",
    promptHint:
      "in the style of Vivian Maier, mid-century American street photography with square format, observed candor and silver-rich blacks",
    term: "by vivian maier, mid-century american street",
  },
  {
    id: "saul-leiter",
    label: "Saul Leiter",
    category: "documentary",
    description: "Painterly color street through glass",
    promptHint:
      "in the style of Saul Leiter, painterly color street photography seen through fogged glass and rain, with abstract layered framing",
    term: "by saul leiter, painterly color street",
  },
  {
    id: "daido-moriyama",
    label: "Daido Moriyama",
    category: "documentary",
    description: "Grainy, high-contrast Tokyo street",
    promptHint:
      "in the style of Daido Moriyama, grainy high-contrast Tokyo street photography with blown highlights and a restless handheld feel",
    term: "by daido moriyama, grainy high-contrast street",
  },
  {
    id: "robert-capa",
    label: "Robert Capa",
    category: "documentary",
    description: "Visceral combat photojournalism",
    promptHint:
      "in the style of Robert Capa, visceral combat photojournalism with motion blur, gritty grain and an immediate handheld viewpoint",
    term: "by robert capa, visceral combat photojournalism",
  },
  {
    id: "sebastiao-salgado",
    label: "Sebastiao Salgado",
    category: "documentary",
    description: "Epic monochrome social documentary",
    promptHint:
      "in the style of Sebastiao Salgado, epic monochrome social documentary with sweeping landscape scale and chiaroscuro tonality",
    term: "by sebastiao salgado, epic monochrome documentary",
  },
  {
    id: "diane-arbus",
    label: "Diane Arbus",
    category: "documentary",
    description: "Stark, confrontational portrait",
    promptHint:
      "in the style of Diane Arbus, stark confrontational portraiture with direct gaze, square format and unflinching daylight",
    term: "by diane arbus, stark confrontational portraiture",
  },

  // -------------------- Cinematographers --------------------
  {
    id: "roger-deakins",
    label: "Roger Deakins",
    category: "cinematographer",
    description: "Painterly cinematic naturalism",
    promptHint:
      "in the cinematic style of Roger Deakins, painterly natural light with carved silhouettes, deep negative space and restrained color",
    term: "shot by roger deakins, painterly natural light",
  },
  {
    id: "emmanuel-lubezki",
    label: "Emmanuel Lubezki",
    category: "cinematographer",
    description: "Floating natural-light cinematography",
    promptHint:
      "in the cinematic style of Emmanuel Lubezki, floating handheld natural-light cinematography with golden-hour glow and wide-lens immersion",
    term: "shot by emmanuel lubezki, floating natural-light immersion",
  },
  {
    id: "greig-fraser",
    label: "Greig Fraser",
    category: "cinematographer",
    description: "Rich tactile genre cinematography",
    promptHint:
      "in the cinematic style of Greig Fraser, rich tactile genre cinematography with anamorphic flares, deep blacks and atmospheric haze",
    term: "shot by greig fraser, tactile anamorphic cinematography",
  },
  {
    id: "christopher-doyle",
    label: "Christopher Doyle",
    category: "cinematographer",
    description: "Saturated handheld neon mood",
    promptHint:
      "in the cinematic style of Christopher Doyle, saturated handheld neon mood with smeared light trails and dreamy slow-shutter blur",
    term: "shot by christopher doyle, saturated handheld neon",
  },

  // -------------------- Concept / Digital Painters --------------------
  {
    id: "greg-rutkowski",
    label: "Greg Rutkowski",
    category: "concept",
    description: "Epic painterly fantasy concept",
    promptHint:
      "in the style of Greg Rutkowski, epic painterly fantasy concept art with sweeping composition, dramatic god-rays and oil-painting brushwork",
    term: "by greg rutkowski, epic painterly fantasy concept art",
  },
  {
    id: "magali-villeneuve",
    label: "Magali Villeneuve",
    category: "concept",
    description: "Heroic fantasy character art",
    promptHint:
      "in the style of Magali Villeneuve, heroic fantasy character art with detailed armor, painterly skin and warm golden lighting",
    term: "by magali villeneuve, heroic fantasy character art",
  },
  {
    id: "charlie-bowater",
    label: "Charlie Bowater",
    category: "concept",
    description: "Atmospheric digital portraiture",
    promptHint:
      "in the style of Charlie Bowater, atmospheric digital portraiture with painterly textures, moody color and intimate close framing",
    term: "by charlie bowater, atmospheric digital portraiture",
  },
  {
    id: "sam-spratt",
    label: "Sam Spratt",
    category: "concept",
    description: "Allegorical hyperreal portrait",
    promptHint:
      "in the style of Sam Spratt, allegorical hyperreal portraiture with sculpted lighting, symbolic detail and old-master tonal depth",
    term: "by sam spratt, allegorical hyperreal portraiture",
  },
  {
    id: "ruan-jia",
    label: "Ruan Jia",
    category: "concept",
    description: "Lush painterly fantasy portrait",
    promptHint:
      "in the style of Ruan Jia, lush painterly fantasy portraiture with rich fabrics, gilded accents and warm directional light",
    term: "by ruan jia, lush painterly fantasy portraiture",
  },
  {
    id: "ilya-kuvshinov",
    label: "Ilya Kuvshinov",
    category: "concept",
    description: "Anime-inflected stylized portrait",
    promptHint:
      "in the style of Ilya Kuvshinov, anime-inflected stylized portraiture with soft cell-shading, oversized eyes and pastel rim light",
    term: "by ilya kuvshinov, anime-inflected stylized portrait",
  },
  {
    id: "wlop",
    label: "WLOP",
    category: "concept",
    description: "Ethereal painterly fantasy",
    promptHint:
      "in the style of WLOP, ethereal painterly fantasy portraiture with flowing hair, glowing rim light and a cool monochromatic palette",
    term: "by wlop, ethereal painterly fantasy portraiture",
  },
  {
    id: "artgerm",
    label: "Artgerm",
    category: "concept",
    description: "Polished comic-book-inspired pinup",
    promptHint:
      "in the style of Artgerm, polished comic-book-inspired pinup illustration with smooth gradients and crisp graphic edge highlights",
    term: "by artgerm, polished comic-book pinup illustration",
  },

  // -------------------- Illustrators / Animators --------------------
  {
    id: "makoto-shinkai",
    label: "Makoto Shinkai",
    category: "illustrator",
    description: "Cinematic anime sky and light",
    promptHint:
      "in the style of Makoto Shinkai, cinematic anime sky and light with luminous clouds, lens-flared sun and saturated dusk gradients",
    term: "by makoto shinkai, luminous cinematic anime skies",
  },
  {
    id: "studio-ghibli",
    label: "Studio Ghibli",
    category: "illustrator",
    description: "Hand-painted Ghibli warmth",
    promptHint:
      "in the style of Studio Ghibli, hand-painted animation warmth with soft pastel skies, lush vegetation and gentle character expressions",
    term: "by studio ghibli, hand-painted animation warmth",
  },
  {
    id: "alphonse-mucha",
    label: "Alphonse Mucha",
    category: "illustrator",
    description: "Art-nouveau decorative panel",
    promptHint:
      "in the style of Alphonse Mucha, art-nouveau decorative panel with ornamental floral borders, flowing hair and warm gilded tones",
    term: "by alphonse mucha, art-nouveau decorative panel",
  },
  {
    id: "carne-griffiths",
    label: "Carne Griffiths",
    category: "illustrator",
    description: "Ink-bleed botanical portrait",
    promptHint:
      "in the style of Carne Griffiths, ink-bleed botanical portraiture with calligraphic linework, splashed tea washes and tangled florals",
    term: "by carne griffiths, ink-bleed botanical portraiture",
  },
  {
    id: "conrad-roset",
    label: "Conrad Roset",
    category: "illustrator",
    description: "Gentle watercolor figure",
    promptHint:
      "in the style of Conrad Roset, gentle watercolor figure illustration with soft graphite line, blooming pigment and pale skin tones",
    term: "by conrad roset, gentle watercolor figure",
  },
  {
    id: "akihito-yoshida",
    label: "Akihito Yoshida",
    category: "illustrator",
    description: "Quiet ink-and-grain monochrome",
    promptHint:
      "in the style of Akihito Yoshida, quiet ink-and-grain monochrome portraiture with sketchy line and contemplative negative space",
    term: "by akihito yoshida, quiet ink-and-grain monochrome",
  },
  {
    id: "karol-bak",
    label: "Karol Bak",
    category: "illustrator",
    description: "Symbolist painted muse",
    promptHint:
      "in the style of Karol Bak, symbolist painted muse with gilded-leaf accents, art-nouveau ornament and warm earthen pigment",
    term: "by karol bak, symbolist gilded muse",
  },
  {
    id: "ismail-inceoglu",
    label: "Ismail Inceoglu",
    category: "illustrator",
    description: "Mythic painterly landscape",
    promptHint:
      "in the style of Ismail Inceoglu, mythic painterly landscape with monumental scale, layered atmospheric haze and storybook lighting",
    term: "by ismail inceoglu, mythic painterly landscape",
  },
  {
    id: "stefan-gesell",
    label: "Stefan Gesell",
    category: "illustrator",
    description: "Dark surreal portraiture",
    promptHint:
      "in the style of Stefan Gesell, dark surreal portraiture with high-contrast monochrome, masked figures and uneasy theatrical lighting",
    term: "by stefan gesell, dark surreal portraiture",
  },
  {
    id: "andrew-atroshenko",
    label: "Andrew Atroshenko",
    category: "illustrator",
    description: "Romantic impressionist figure",
    promptHint:
      "in the style of Andrew Atroshenko, romantic impressionist figure painting with loose visible brushwork and shimmering candlelight",
    term: "by andrew atroshenko, romantic impressionist figure",
  },
  {
    id: "peter-gric",
    label: "Peter Gric",
    category: "illustrator",
    description: "Architectural surrealist landscape",
    promptHint:
      "in the style of Peter Gric, architectural surrealist landscape with crystalline geometric structures and a cool muted palette",
    term: "by peter gric, architectural surrealist landscape",
  },
  {
    id: "ingrid-baars",
    label: "Ingrid Baars",
    category: "illustrator",
    description: "Sculptural fashion-art collage",
    promptHint:
      "in the style of Ingrid Baars, sculptural fashion-art collage with elongated forms, smooth painted skin and ornate textile drapery",
    term: "by ingrid baars, sculptural fashion-art collage",
  },
  {
    id: "guido-van-helten",
    label: "Guido van Helten",
    category: "illustrator",
    description: "Monumental muralist portrait",
    promptHint:
      "in the style of Guido van Helten, monumental muralist portraiture with weathered concrete texture and quiet grayscale tonality",
    term: "by guido van helten, monumental muralist portraiture",
  },

  // ── Cinematographers (wave 2, 2026-10-26: each rendered on the one shared scene) ──
  {
    id: "hoyte-van-hoytema",
    label: "Hoyte van Hoytema",
    category: "cinematographer",
    description: "Large-format natural clarity",
    promptHint:
      "in the cinematic style of Hoyte van Hoytema, large-format 65mm clarity with shallow depth, natural available light, cool desaturated tones with soft warm skin and grounded understated grandeur",
    term: "shot by hoyte van hoytema, large-format natural clarity",
  },
  {
    id: "gordon-willis",
    label: "Gordon Willis",
    category: "cinematographer",
    description: "Underexposed amber New Hollywood",
    promptHint:
      "in the cinematic style of Gordon Willis, 1970s underexposed low-key lighting, deep warm amber tones, top-lit faces with shadows that hide the eyes and rich golden-brown darkness",
    term: "shot by gordon willis, underexposed amber low-key",
  },
  {
    id: "bradford-young",
    label: "Bradford Young",
    category: "cinematographer",
    description: "Soft low-contrast naturalism",
    promptHint:
      "in the cinematic style of Bradford Young, soft low-contrast naturalism, deep rich dark skin tones with gentle shadow detail, muted desaturated color and diffused window-like light",
    term: "shot by bradford young, soft low-contrast naturalism",
  },
  {
    id: "robert-richardson",
    label: "Robert Richardson",
    category: "cinematographer",
    description: "Hot white top-light halos",
    promptHint:
      "in the cinematic style of Robert Richardson, a hard hot white top-light halo blooming on hair and surfaces, high-contrast glowing highlights against deep shadows and saturated theatrical color",
    term: "shot by robert richardson, hot top-light halos",
  },
  {
    id: "janusz-kaminski",
    label: "Janusz Kaminski",
    category: "cinematographer",
    description: "Diffused bleach-bypass backlight",
    promptHint:
      "in the cinematic style of Janusz Kaminski, heavy diffused backlight blooming through haze, desaturated bleach-bypass tones with silvery highlights, smoke in the air and luminous overexposed windows",
    term: "shot by janusz kaminski, diffused bleach-bypass backlight",
  },
  {
    id: "vittorio-storaro",
    label: "Vittorio Storaro",
    category: "cinematographer",
    description: "Painterly symbolic warm-cool color",
    promptHint:
      "in the cinematic style of Vittorio Storaro, painterly symbolic color with warm oranges against cool blues divided across the frame, bold saturated theatrical light and sculpted shadows",
    term: "shot by vittorio storaro, painterly symbolic color",
  },
  {
    id: "linus-sandgren",
    label: "Linus Sandgren",
    category: "cinematographer",
    description: "Candy-colored romantic 35mm",
    promptHint:
      "in the cinematic style of Linus Sandgren, vivid candy-colored Technicolor-inspired palette, magic-hour glow, glossy romantic 35mm film with saturated magenta and teal skies",
    term: "shot by linus sandgren, candy-colored romantic 35mm",
  },
  {
    id: "darius-khondji",
    label: "Darius Khondji",
    category: "cinematographer",
    description: "Rain-soaked bleach-bypass noir",
    promptHint:
      "in the cinematic style of Darius Khondji, moody rain-soaked darkness, sickly green-and-sepia bleach-bypass tones with silver-retained shadows, grimy urban texture and a single cold practical light",
    term: "shot by darius khondji, rain-soaked bleach-bypass noir",
  },

  // ── Directors (2026-10-26: the signature look of a filmmaker, rendered on the one shared scene) ──
  {
    id: "wes-anderson",
    label: "Wes Anderson",
    category: "director",
    description: "Symmetrical pastel storybook",
    promptHint:
      "in the style of Wes Anderson, perfectly centered symmetrical composition, flat frontal framing, a pastel palette of pink, mustard and mint, meticulously arranged vintage props and deadpan storybook precision",
    term: "by wes anderson, symmetrical pastel storybook",
  },
  {
    id: "wong-kar-wai",
    label: "Wong Kar-wai",
    category: "director",
    description: "Neon longing with smeared motion",
    promptHint:
      "in the style of Wong Kar-wai, saturated neon greens and reds, smeared slow-shutter motion blur, rain-slick surfaces, handheld intimacy and a step-printed dreamy texture of longing",
    term: "by wong kar-wai, neon smeared longing",
  },
  {
    id: "christopher-nolan",
    label: "Christopher Nolan",
    category: "director",
    description: "IMAX clarity, steel-blue and amber",
    promptHint:
      "in the style of Christopher Nolan, large-format IMAX clarity, a cool desaturated steel-blue and amber palette, monumental scale, practical realism, crisp deep focus and a ticking tense atmosphere",
    term: "by christopher nolan, IMAX steel-blue and amber",
  },
  {
    id: "denis-villeneuve",
    label: "Denis Villeneuve",
    category: "director",
    description: "Vast minimalist dread",
    promptHint:
      "in the style of Denis Villeneuve, vast minimalist scale with the figure small against a huge empty space, muted monochrome earth tones with one soft light source, heavy atmospheric haze and slow meditative dread",
    term: "by denis villeneuve, vast minimalist dread",
  },
  {
    id: "stanley-kubrick",
    label: "Stanley Kubrick",
    category: "director",
    description: "One-point clinical symmetry",
    promptHint:
      "in the style of Stanley Kubrick, rigid one-point perspective, cold clinical symmetry, a wide-angle lens, eerie stillness, stark practical lighting and unsettling precision",
    term: "by stanley kubrick, one-point clinical symmetry",
  },
  {
    id: "quentin-tarantino",
    label: "Quentin Tarantino",
    category: "director",
    description: "Grindhouse 35mm swagger",
    promptHint:
      "in the style of Quentin Tarantino, punchy saturated 1970s grindhouse color, a low trunk-shot angle looking up, bold pulpy framing, warm grainy 35mm film and a cool swaggering attitude",
    term: "by quentin tarantino, grindhouse 35mm swagger",
  },
  {
    id: "david-fincher",
    label: "David Fincher",
    category: "director",
    description: "Cold green-yellow clinical menace",
    promptHint:
      "in the style of David Fincher, a cold sickly green-yellow grade, immaculate controlled composition, low-key shadows with crushed blacks, digital sharpness and clinical detached menace",
    term: "by david fincher, cold green-yellow menace",
  },
  {
    id: "tim-burton",
    label: "Tim Burton",
    category: "director",
    description: "Gothic whimsy with stripes",
    promptHint:
      "in the style of Tim Burton, gothic whimsy, exaggerated crooked architecture, pale skin with dark circles, a swirling grey sky, black-and-white stripes, a touch of purple and a playful macabre fairy tale",
    term: "by tim burton, gothic striped whimsy",
  },
  {
    id: "ridley-scott",
    label: "Ridley Scott",
    category: "director",
    description: "Hazy backlit painterly epic",
    promptHint:
      "in the style of Ridley Scott, dense atmospheric haze cut by shafts of hard backlight, smoke and steam, rich textured production design, rain, deep blue and amber contrast and epic painterly grandeur",
    term: "by ridley scott, hazy backlit epic",
  },
  {
    id: "david-lynch",
    label: "David Lynch",
    category: "director",
    description: "Uncanny velvet-red Americana",
    promptHint:
      "in the style of David Lynch, uncanny dreamlike unease, deep velvet reds and inky shadows, a single flickering fluorescent light, 1950s Americana details slightly wrong, surreal stillness and heavy grain",
    term: "by david lynch, uncanny velvet-red Americana",
  },
  {
    id: "terrence-malick",
    label: "Terrence Malick",
    category: "director",
    description: "Magic-hour floating poetry",
    promptHint:
      "in the style of Terrence Malick, natural magic-hour backlight, a wide-angle lens close to the subject, wind in the grass and hair, lens flare, floating handheld poetry and a warm reverent golden haze",
    term: "by terrence malick, magic-hour floating poetry",
  },
  {
    id: "hayao-miyazaki",
    label: "Hayao Miyazaki",
    category: "director",
    description: "Hand-painted Ghibli-like warmth",
    promptHint:
      "in the style of Hayao Miyazaki, a hand-painted anime animation frame, lush watercolor clouds in a vast sky, soft gouache greens, gentle nostalgic light and a quiet contemplative Studio-Ghibli-like warmth",
    term: "by hayao miyazaki, hand-painted anime warmth",
  },
  {
    id: "bong-joon-ho",
    label: "Bong Joon-ho",
    category: "director",
    description: "Layered social-realist calm",
    promptHint:
      "in the style of Bong Joon-ho, precise social-realist staging, clean wide compositions with layered depth, cool rainy greys and greens, understated naturalistic light and a quiet tension between calm and chaos",
    term: "by bong joon-ho, layered social-realist calm",
  },
  {
    id: "park-chan-wook",
    label: "Park Chan-wook",
    category: "director",
    description: "Baroque crimson and emerald",
    promptHint:
      "in the style of Park Chan-wook, lush baroque color with deep crimson and emerald, ornate symmetrical framing, elegant camera precision, polished glossy surfaces and sensual operatic intensity",
    term: "by park chan-wook, baroque crimson and emerald",
  },
  {
    id: "paul-thomas-anderson",
    label: "Paul Thomas Anderson",
    category: "director",
    description: "Warm 1970s anamorphic nostalgia",
    promptHint:
      "in the style of Paul Thomas Anderson, a warm 1970s anamorphic film look with soft halation, long-lens compression, naturalistic tungsten and sodium light, rich skin tones and melancholy Californian nostalgia",
    term: "by paul thomas anderson, warm 70s anamorphic nostalgia",
  },
  {
    id: "coen-brothers",
    label: "Coen Brothers",
    category: "director",
    description: "Deadpan bleak Americana",
    promptHint:
      "in the style of the Coen Brothers, dry deadpan Americana, a wide-angle lens with slightly comic framing, bleak flat winter light, muted browns and greys with snow, odd telling details and quiet absurdity",
    term: "by the coen brothers, deadpan bleak Americana",
  },
  {
    id: "nicolas-winding-refn",
    label: "Nicolas Winding Refn",
    category: "director",
    description: "Neon pink synth-noir stillness",
    promptHint:
      "in the style of Nicolas Winding Refn, hyper-stylized neon pink and electric blue light, slow hypnotic stillness, a glossy synth-noir mood, hard fluorescent practicals and deep black shadows",
    term: "by nicolas winding refn, neon synth-noir stillness",
  },
  {
    id: "baz-luhrmann",
    label: "Baz Luhrmann",
    category: "director",
    description: "Maximalist theatrical glamour",
    promptHint:
      "in the style of Baz Luhrmann, maximalist theatrical glamour, glittering lights and confetti, saturated jewel colors, a dynamic tilted camera, lavish costume detail and operatic romantic energy",
    term: "by baz luhrmann, maximalist theatrical glamour",
  },
  {
    id: "alfred-hitchcock",
    label: "Alfred Hitchcock",
    category: "director",
    description: "Technicolor suspense, high vantage",
    promptHint:
      "in the style of Alfred Hitchcock, classic 1950s Technicolor suspense, a high ominous vantage point, elegant restrained composition, a glance toward something unseen off-frame and tense stillness",
    term: "by alfred hitchcock, Technicolor suspense",
  },
  {
    id: "yorgos-lanthimos",
    label: "Yorgos Lanthimos",
    category: "director",
    description: "Fisheye deadpan absurdism",
    promptHint:
      "in the style of Yorgos Lanthimos, a distorted ultra-wide fisheye lens, cold symmetrical formality, natural pale light, an unnervingly blank deadpan stare, sterile absurdist detachment and washed muted color",
    term: "by yorgos lanthimos, fisheye deadpan absurdism",
  },
  {
    id: "guillermo-del-toro",
    label: "Guillermo del Toro",
    category: "director",
    description: "Dark fairy-tale amber and teal",
    promptHint:
      "in the style of Guillermo del Toro, dark fairy-tale gothic, a rich amber and teal palette, ornate insect-and-clockwork production details, rain and lantern light and a sense of something magical lurking in the shadows",
    term: "by guillermo del toro, dark fairy-tale amber",
  },
  {
    id: "sofia-coppola",
    label: "Sofia Coppola",
    category: "director",
    description: "Hazy pastel melancholy",
    promptHint:
      "in the style of Sofia Coppola, soft hazy pastel light, dreamy feminine melancholy, shallow focus, gentle film grain, a lonely contemplative mood, muted pinks and creams and quiet intimacy",
    term: "by sofia coppola, hazy pastel melancholy",
  },
] as const

const photographerById = new Map<string, Photographer>(
  PHOTOGRAPHERS.map((p) => [p.id, p]),
)

export function getPhotographer(id: string | undefined | null): Photographer | undefined {
  if (!id) return undefined
  return overlayEntry("photographer", id, photographerById.get(id))
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
 * Compact-mode sibling of `getPhotographerPromptHint` — same arity, same
 * lookup, same empty-string-on-miss behavior, so the two can never disagree
 * about which entry they are describing.
 */
export function getPhotographerTerm(id: string | undefined | null): string {
  return resolveTerm(getPhotographer(id))
}

/**
 * Multi-pick variant: 1-2 photographer ids → blended hint. Single → entry's
 * own promptHint. Two → "shot in the blended language of {A} and {B}" — the
 * model interprets this as referencing both creators' visual signatures.
 */
export function buildPhotographerHints(value: unknown, mode: PickerHintMode = "full"): string {
  if (mode === "compact") return buildPhotographerTerms(value)
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

/**
 * The 1-2 ids a photographer value carries, de-duplicated, in pick order —
 * the same shapes `buildPhotographerHints` accepts (a bare id string, or an
 * array of them).
 */
function photographerIds(value: unknown): string[] {
  const ids: string[] = []
  if (typeof value === "string" && value) ids.push(value)
  else if (Array.isArray(value)) {
    for (const v of value) {
      if (typeof v === "string" && v && !ids.includes(v)) ids.push(v)
    }
  }
  return ids
}

/** The credit an authored term opens with — "by ", or a DP's "shot by ". */
const TERM_CREDIT_PREFIX = /^(?:shot\s+)?by\s+/

/**
 * Compact-mode sibling of `buildPhotographerHints`, mirroring its structure:
 * one id → that entry's term, two → a blend. The blend drops the per-entry
 * signature cues and keeps only the credited names, because stacking two
 * `by <name>, <cues>` fragments is longer than the compact mode exists to be.
 *
 * The credit verb is READ OFF the resolved terms rather than hardcoded, so a
 * cinematographer's "shot by" survives the blend and the one-pick and two-pick
 * paths can never disagree about how the same entry is credited.
 */
export function buildPhotographerTerms(value: unknown): string {
  const ids = photographerIds(value)
  if (ids.length === 0) return ""
  if (ids.length === 1) return getPhotographerTerm(ids[0])
  const credits = ids
    .slice(0, 2)
    .map((id) => getPhotographerTerm(id).split(",")[0].trim())
    .filter((s): s is string => Boolean(s))
  if (credits.length < 2) return getPhotographerTerm(ids[0])
  return `${credits[0]} and ${credits[1].replace(TERM_CREDIT_PREFIX, "")}`
}

export const PHOTOGRAPHER_IDS: ReadonlyArray<string> = PHOTOGRAPHERS.map((p) => p.id)

export const PHOTOGRAPHER_CATEGORY_LABELS: Readonly<Record<PhotographerCategory, string>> = {
  editorial: "Editorial / Fashion",
  documentary: "Documentary / Street",
  cinematographer: "Cinematographer",
  director: "Film Director",
  concept: "Concept / Digital",
  illustrator: "Illustrator / Animator",
}

export const PHOTOGRAPHER_CATEGORY_ORDER: ReadonlyArray<PhotographerCategory> = [
  "editorial",
  "documentary",
  "cinematographer",
  "director",
  "concept",
  "illustrator",
]
