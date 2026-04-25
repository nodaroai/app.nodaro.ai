/**
 * Canonical catalog of Photo Genre / Photographic Intent presets.
 *
 * Single-pick parameter node — user picks ONE photographic genre that
 * bundles a packed set of conventions: lighting, framing, wardrobe
 * implications, color grading, and tabloid/editorial/selfie context. A
 * single photo-genre selection therefore acts as a meta-preset that
 * pushes the downstream prompt toward a recognizable style of image.
 *
 * Distinct from:
 *  - Style    (artistic medium — oil painting, anime, photorealistic)
 *  - Setting  (where the photo takes place)
 *  - Framing  (shot size + angle composition)
 *  - Lighting (key/rim/fill direction and quality)
 *
 * Photo Genre is the "what kind of photograph is this trying to be"
 * dimension — paparazzi vs corporate headshot vs gym mirror selfie vs
 * Vogue editorial. Each promptHint is authored to bundle the canonical
 * markers of that genre in one descriptive clause, so connecting just
 * this node moves the image squarely into that recognizable genre.
 *
 * Applies to both image and video consumers (genre conventions cover
 * both still and motion). Not in STILL_IMAGE_EXCLUDE_TYPES.
 *
 * Shared between the picker UI, the standalone Photo Genre parameter
 * node, and the prompt-hint injection on both the frontend DAG executor
 * and the backend orchestrator.
 */

export type PhotoGenreCategory =
  | "editorial"
  | "documentary"
  | "studio-formal"
  | "selfie"
  | "print-context"

export interface PhotoGenre {
  readonly id: string
  readonly label: string
  readonly category: PhotoGenreCategory
  readonly description: string
  readonly promptHint: string
}

export const PHOTO_GENRES: ReadonlyArray<PhotoGenre> = [
  // -------------------- Editorial / Fashion --------------------
  { id: "fashion-editorial",      label: "Fashion Editorial",      category: "editorial",      description: "High-fashion magazine spread",      promptHint: "shot as a high-fashion magazine editorial, polished studio lighting, deliberate posing, designer wardrobe, full-bleed composition with strong color blocking and a glossy print-ready finish" },
  { id: "vogue-editorial",        label: "Vogue Editorial",        category: "editorial",      description: "Vogue-style cover editorial",       promptHint: "shot in the language of a Vogue editorial cover, dramatic single-source lighting, couture wardrobe, confident direct-camera gaze and clean negative space sized for a glossy magazine cover" },
  { id: "magazine-cover",         label: "Magazine Cover",         category: "editorial",      description: "Tightly framed cover composition",  promptHint: "framed as a magazine cover with a tight head-and-shoulders composition, strong eye contact with the lens, generous headroom for a masthead and a saturated punchy color grade" },
  { id: "lookbook",               label: "Lookbook",               category: "editorial",      description: "Clean lookbook outfit shot",        promptHint: "shot as a brand lookbook image, full-body framing, neutral seamless backdrop, soft even studio lighting and subdued styling that lets the wardrobe read clearly" },
  { id: "ecommerce-flatlay",      label: "E-commerce Flat Lay",    category: "editorial",      description: "Overhead product flat lay",         promptHint: "composed as a top-down e-commerce flat lay with even shadowless studio lighting, a clean white surface and the subject arranged neatly within the frame for catalog use" },
  { id: "beauty-editorial",       label: "Beauty Editorial",       category: "editorial",      description: "Macro beauty / skincare close-up",  promptHint: "shot as a beauty editorial close-up, ring-lit with a soft glowing key, hyper-detailed skin texture, glossy lips, defined brows and a clean cosmetic palette" },
  { id: "campaign-advertising",   label: "Campaign / Ad",          category: "editorial",      description: "Polished brand campaign image",     promptHint: "shot as a polished brand campaign image, bold visual hook, strong product or wardrobe presence and an aspirational lighting setup designed to read on a billboard" },

  // -------------------- Brand / Editorial Reference --------------------
  { id: "brand-vogue",            label: "Vogue Signature",        category: "editorial",      description: "Vogue magazine editorial signature",     promptHint: "shot in the signature language of a Vogue magazine editorial, clean polished beauty lighting, glossy makeup, sculpted hair and a wardrobe of polished glamour, with the controlled high-fashion sheen unique to Vogue's print pages" },
  { id: "brand-dior",             label: "Dior Signature",         category: "editorial",      description: "Dior editorial — chiaroscuro and silhouette", promptHint: "shot in the signature language of a Dior editorial, dramatic chiaroscuro carving the subject from deep shadow, a sculptural couture silhouette and the brand's restrained Parisian elegance" },
  { id: "brand-jil-sander",       label: "Jil Sander Minimalism",  category: "editorial",      description: "Jil Sander — minimalist architectural muted", promptHint: "shot in the language of a Jil Sander editorial, minimalist composition, muted ecru and stone palette, architectural wardrobe with clean unbroken lines and the brand's quiet austere mood" },
  { id: "brand-vivienne-tam",     label: "Vivienne Tam Style",     category: "editorial",      description: "Vivienne Tam — orientalist ornate fashion", promptHint: "shot in the language of a Vivienne Tam editorial, orientalist motifs and dragon embroidery, ornate East-Asian fashion detailing and a saturated jewel-toned palette" },
  { id: "brand-jacquemus",        label: "Jacquemus Style",        category: "editorial",      description: "Jacquemus — sun-soaked surrealist playful", promptHint: "shot in the language of a Jacquemus campaign, sun-soaked Mediterranean light, surrealist scale play with oversized hats and miniature bags, terracotta and ochre palette and a playful French Riviera mood" },
  { id: "brand-helmut-newton",    label: "Helmut Newton Style",    category: "editorial",      description: "Helmut Newton — high-contrast B&W provocation", promptHint: "shot in the signature language of Helmut Newton, high-contrast black-and-white, hard direct flash carving every line, statuesque pose, glamorous wardrobe and the cool confrontational eroticism of his 1970s editorial work" },
  { id: "brand-harpers-bazaar",   label: "Harper's Bazaar Style",  category: "editorial",      description: "Harper's Bazaar — high-fashion glossy",  promptHint: "shot in the signature language of a Harper's Bazaar editorial, high-fashion glossy production, bold graphic backdrops, dramatic single-source key light and the brand's distinctively confident composition" },

  // -------------------- Documentary / Candid --------------------
  { id: "paparazzi",              label: "Paparazzi",              category: "documentary",    description: "Flash-blown tabloid candid",        promptHint: "shot as a paparazzi tabloid candid, harsh on-camera flash blowing out the highlights, slight motion blur, low candid angle, blurred crowd in the background and grainy cropped tabloid framing" },
  { id: "street-photography",     label: "Street Photography",     category: "documentary",    description: "Unposed urban street frame",        promptHint: "shot in a street-photography idiom, available light, mid-stride candid moment, busy city background slightly out of focus and a grainy 35mm reportage feel" },
  { id: "candid-journalism",      label: "Candid Journalism",      category: "documentary",    description: "Unposed photojournalist moment",    promptHint: "captured as candid photojournalism, unposed expression, naturalistic available light, slightly off-balance composition and a documentary honesty rather than glamour" },
  { id: "photojournalism",        label: "Photojournalism",        category: "documentary",    description: "Editorial news-grade reportage",    promptHint: "shot as editorial photojournalism with a 35mm reportage lens, faithful natural lighting, the subject reacting to events outside the frame and a wire-service caption-ready composition" },
  { id: "documentary",            label: "Documentary",            category: "documentary",    description: "Long-form documentary portrait",    promptHint: "shot in a long-form documentary portrait style, soft window light, subject lightly aware of the camera, environmental context behind them and an unhurried observational tone" },
  { id: "snapshot",               label: "Snapshot",               category: "documentary",    description: "Casual amateur snapshot",           promptHint: "shot as a casual amateur snapshot with on-camera flash, slightly wonky framing, ordinary domestic background and the warmth of an unposed personal moment" },

  // -------------------- Studio / Formal --------------------
  { id: "corporate-headshot",     label: "Corporate Headshot",     category: "studio-formal",  description: "Linkedin-style headshot",           promptHint: "shot as a polished corporate headshot, soft three-point studio lighting, blurred neutral office or grey backdrop, professional wardrobe and a confident closed-mouth smile" },
  { id: "personal-branding",      label: "Personal Branding",      category: "studio-formal",  description: "Modern personal-brand portrait",    promptHint: "shot as a modern personal-branding portrait, warm soft key light, lifestyle environment lightly blurred behind the subject and a relaxed open expression" },
  { id: "yearbook",               label: "Yearbook",               category: "studio-formal",  description: "School yearbook portrait",          promptHint: "shot as a school yearbook portrait with even soft front lighting, a graduated grey or marbled studio backdrop and a closed-mouth posed smile centered in the frame" },
  { id: "id-passport",            label: "ID / Passport",          category: "studio-formal",  description: "Regulation passport photo",         promptHint: "shot as a regulation passport photograph, dead-center face, neutral expression, plain off-white backdrop, even flat front lighting and no shadows under the chin" },
  { id: "mugshot",                label: "Mugshot",                category: "studio-formal",  description: "Police booking-style portrait",     promptHint: "shot as a police booking mugshot, harsh fluorescent overhead lighting, height chart on the wall behind, dead-square frontal framing and a flat institutional color cast" },
  { id: "wedding-portrait",       label: "Wedding Portrait",       category: "studio-formal",  description: "Romantic bridal-style portrait",    promptHint: "shot as a wedding portrait, soft golden-hour backlight, romantic shallow depth of field, dreamy pastel color grade and an intimate posed embrace or solo bridal stance" },
  { id: "family-portrait",        label: "Family Portrait",        category: "studio-formal",  description: "Posed family group shot",           promptHint: "shot as a posed family portrait, warm even studio lighting, neutral backdrop, coordinated wardrobe and the group arranged in a balanced pyramid composition" },
  { id: "glamour-portrait",       label: "Glamour Portrait",       category: "studio-formal",  description: "Soft-focus glamour portrait",       promptHint: "shot as a glamour portrait with soft diffused beauty lighting, a high-key warm tone, gentle skin retouch, voluminous hair and a sultry over-the-shoulder pose" },
  { id: "film-noir",              label: "Film Noir",              category: "studio-formal",  description: "Hard-shadow noir portrait",         promptHint: "shot in a film-noir portrait idiom, hard single-source key light casting deep shadows, venetian-blind shadow patterns, monochrome high-contrast palette and a brooding closed-off pose" },

  // -------------------- Selfie sub-types --------------------
  { id: "mirror-selfie",          label: "Mirror Selfie",          category: "selfie",         description: "Phone-in-mirror full-body selfie",  promptHint: "shot as a smartphone mirror selfie, the phone visible in one raised hand reflected in the mirror, full or three-quarter body framing, a domestic bedroom or bathroom background and natural ambient light" },
  { id: "gym-mirror-selfie",      label: "Gym Mirror Selfie",      category: "selfie",         description: "Locker-room gym mirror selfie",     promptHint: "shot as a gym mirror selfie, three-quarter side-back angle reflected in a wall-length gym mirror, phone clearly raised in one hand, fitness wardrobe, busy weight-rack background and bright overhead gym lighting" },
  { id: "front-cam-selfie",       label: "Front Cam Selfie",       category: "selfie",         description: "Arm-extended front camera selfie",  promptHint: "shot as a front-camera selfie taken at arm's length, the lens slightly above the subject's eye line, soft ambient lighting, natural skin texture and the casual intimacy of a phone-held self portrait" },
  { id: "bathroom-mirror-selfie", label: "Bathroom Mirror Selfie", category: "selfie",         description: "Bathroom-mirror selfie with flash", promptHint: "shot as a bathroom mirror selfie with a small on-phone flash kicking off the glass, tiled walls and a sink or shelf in frame, casual outfit and the slightly unfocused intimacy of a private moment" },
  { id: "bereal-dual",            label: "BeReal Dual",            category: "selfie",         description: "Front+back simultaneous dual frame", promptHint: "framed as a BeReal-style dual capture with a small inset front-camera selfie tucked in the corner of a wider rear-camera environmental shot, casual unstaged moment and slightly soft phone-camera quality" },
  { id: "flip-cam-selfie",        label: "Flip-Cam Selfie",        category: "selfie",         description: "Accidental low-quality flip cam",   promptHint: "shot as an accidental flip-cam selfie, low-resolution camcorder feel, harsh on-board video light, off-center framing and a candid ordinary expression caught mid-thought" },
  { id: "group-selfie",           label: "Group Selfie",           category: "selfie",         description: "Multiple-subject phone selfie",     promptHint: "shot as a group phone selfie taken at arm's length, several faces clustered into the frame, one arm visibly extended holding the phone and a bright shared moment with cheerful expressions" },
  { id: "lofi-baddie-selfie",     label: "Lo-Fi 2010s Selfie",     category: "selfie",         description: "Early-iPhone low-light selfie",     promptHint: "shot as a lo-fi 2010s iPhone selfie with grainy low-light noise, slight green-yellow color cast, mirror reflection of an early-era phone and the unpolished aesthetic of an early-Instagram baddie post" },

  // -------------------- Print / Context --------------------
  { id: "album-cover",            label: "Album Cover",            category: "print-context",  description: "Square album cover composition",    promptHint: "composed as a square album cover, bold central subject, dramatic single-color or saturated graphic backdrop, deliberate negative space for an artist title and a stylized lighting setup" },
  { id: "movie-poster",           label: "Movie Poster",           category: "print-context",  description: "Cinematic theatrical poster",       promptHint: "composed as a theatrical movie poster, dramatic key art lighting, layered subjects in a dynamic composition, a cinematic teal-and-orange color grade and clear space along the bottom for credits" },
  { id: "advertising",            label: "Advertising",            category: "print-context",  description: "Glossy ad-campaign photograph",     promptHint: "shot as a glossy advertising photograph, hyper-clean studio lighting, idealized colors, the product or wardrobe positioned as the visual hero and a print-ready composition with copy space" },
  { id: "food-photography",       label: "Food Photography",       category: "print-context",  description: "Overhead or 45-degree food shot",   promptHint: "shot as professional food photography, soft window-style key light, a 45-degree or overhead angle, glossy fresh ingredients in shallow focus and a styled rustic surface beneath" },
  { id: "real-estate",            label: "Real Estate",            category: "print-context",  description: "Wide architectural interior",       promptHint: "shot as a wide-angle real-estate listing photograph, ultra-wide lens emphasizing space, neutral white-balanced light, all rooms tidied to perfection and clean horizontal/vertical lines" },
  { id: "sports-action",          label: "Sports Action",          category: "print-context",  description: "Telephoto frozen sports moment",    promptHint: "shot as a telephoto sports-action photograph, frozen peak-action moment, blurred crowd background, dramatic stadium lighting and a slightly desaturated press-photo grade" },
] as const

const photoGenreById = new Map<string, PhotoGenre>(
  PHOTO_GENRES.map((p) => [p.id, p]),
)

export function getPhotoGenre(id: string | undefined | null): PhotoGenre | undefined {
  if (!id) return undefined
  return photoGenreById.get(id)
}

export function getPhotoGenreLabel(id: string | undefined | null, fallback?: string): string {
  const g = getPhotoGenre(id)
  if (g) return g.label
  if (fallback !== undefined) return fallback
  return (id ?? "").replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
}

export function getPhotoGenrePromptHint(id: string | undefined | null): string {
  return getPhotoGenre(id)?.promptHint ?? ""
}

export const PHOTO_GENRE_IDS: ReadonlyArray<string> = PHOTO_GENRES.map((p) => p.id)

export const PHOTO_GENRE_CATEGORY_LABELS: Readonly<Record<PhotoGenreCategory, string>> = {
  editorial: "Editorial / Fashion",
  documentary: "Documentary / Candid",
  "studio-formal": "Studio / Formal",
  selfie: "Selfie",
  "print-context": "Print / Context",
}

export const PHOTO_GENRE_CATEGORY_ORDER: ReadonlyArray<PhotoGenreCategory> = [
  "editorial",
  "documentary",
  "studio-formal",
  "selfie",
  "print-context",
]
