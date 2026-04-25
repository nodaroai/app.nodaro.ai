/**
 * Canonical catalog of image style presets.
 *
 * Style dimension of an image/video — the overall artistic rendering or
 * medium (anime, oil painting, photorealistic, etc.). Independent of
 * lighting (direction/color of light), color/look (post-processing grade),
 * atmosphere (environmental effects), lens (focal length distortion), and
 * framing (composition). Two shots with identical lighting, lens and
 * framing still look radically different when one is "Oil Painting" and
 * the other is "Pixel Art".
 *
 * Shared between the picker UI, the standalone Style parameter node, the
 * inline Style dropdown in image config panels (backward-compat), and the
 * prompt-hint injection on both the frontend DAG executor and the backend
 * orchestrator.
 *
 * The `id` values are kept in sync with `IMAGE_STYLE_PRESETS` in
 * `frontend/src/components/editor/config-panels/model-options.ts` so the
 * inline dropdown and the Style node resolve to the same richer promptHint
 * at execution time.
 */

export interface Style {
  readonly id: string
  readonly label: string
  readonly description: string
  readonly promptHint: string
}

export const STYLES: ReadonlyArray<Style> = [
  { id: "3d-render",       label: "3D Render",        description: "Modern CGI render with clean shading",     promptHint: "3D rendered style, modern CGI aesthetic with clean shading, subtle ambient occlusion and crisp materials" },
  { id: "anime",           label: "Anime",            description: "Japanese animation look",                  promptHint: "anime style, Japanese animation aesthetic with bold cel-shaded lines, expressive eyes and saturated colors" },
  { id: "children-book",   label: "Children's Book",  description: "Warm illustrated storybook",               promptHint: "children's book illustration style, warm hand-drawn storybook look with soft shapes, friendly characters and inviting colors" },
  { id: "cinematic",       label: "Cinematic",        description: "Film-grade dramatic image",                promptHint: "cinematic film style, dramatic lighting with cinematic color grading, widescreen aesthetic and film-like depth of field" },
  { id: "comic-book",      label: "Comic Book",       description: "Inked panels with flat color",             promptHint: "comic book style, bold inked outlines, halftone shading and flat saturated comic panel colors" },
  { id: "digital-art",     label: "Digital Art",      description: "Polished digital illustration",            promptHint: "digital art style, polished digital painting with smooth brushwork, vibrant colors and clean rendering" },
  { id: "fantasy",         label: "Fantasy",          description: "Epic high-fantasy illustration",           promptHint: "fantasy art style, epic high-fantasy illustration with painterly detail, magical atmosphere and rich lore-driven mood" },
  { id: "minimalist",      label: "Minimalist",       description: "Simple shapes, lots of whitespace",        promptHint: "minimalist style, reduced composition with simple shapes, limited palette and generous negative space" },
  { id: "noir",            label: "Noir",             description: "High-contrast B&W film noir",              promptHint: "film noir style, high-contrast black-and-white imagery, deep shadows, venetian-blind lighting and moody 1940s cinema feel" },
  { id: "oil-painting",    label: "Oil Painting",     description: "Thick brush strokes, classical canvas",    promptHint: "oil painting style, visible thick brush strokes on canvas with rich pigment, classical painterly texture and warm tonal blending" },
  { id: "pencil-sketch",   label: "Pencil Sketch",    description: "Hand-drawn graphite drawing",              promptHint: "pencil sketch style, hand-drawn graphite drawing with visible hatching, soft smudges and raw paper texture" },
  { id: "photorealistic",  label: "Photorealistic",   description: "Indistinguishable from a photograph",      promptHint: "photorealistic style, high-fidelity photographic realism with natural lighting, accurate materials and DSLR-grade detail" },
  { id: "pixel-art",       label: "Pixel Art",        description: "Retro game-style pixel grid",              promptHint: "pixel art style, retro low-resolution pixel grid aesthetic with limited palette and hard-edged chunky sprites" },
  { id: "pop-art",         label: "Pop Art",          description: "Bold colors, Warhol/Lichtenstein",         promptHint: "pop art style, bold saturated colors, Ben-Day dots and high-contrast Warhol/Lichtenstein-inspired graphic look" },
  { id: "retro-vintage",   label: "Retro / Vintage",  description: "Faded nostalgic film look",                promptHint: "retro vintage style, faded nostalgic film look with muted colors, subtle grain and old-photograph warmth" },
  { id: "watercolor",      label: "Watercolor",       description: "Soft transparent washes",                  promptHint: "watercolor style, soft transparent washes with bleeding edges, paper grain and delicate pigment pooling" },
  { id: "concept-art",     label: "Concept Art",      description: "Film/game pre-production painting",        promptHint: "concept art style, painterly film and game pre-production illustration with dramatic lighting, moody atmosphere and loose brushwork emphasizing scale and storytelling" },
  { id: "impressionism",   label: "Impressionism",    description: "Monet-style dabbed brushwork",             promptHint: "impressionist style, Monet-inspired visible dabbed brush strokes, soft natural light, pastel palette and loose color mixing that captures atmosphere over detail" },
  { id: "surrealism",      label: "Surrealism",       description: "Dreamlike Dalí-inspired",                  promptHint: "surrealist style, Dalí-inspired dreamlike imagery with impossible geometry, melting forms, floating elements and uncanny color combinations" },
  { id: "cyberpunk",       label: "Cyberpunk",        description: "Neon-lit dystopian future",                promptHint: "cyberpunk style, neon-lit dystopian future aesthetic with magenta and cyan glow, rain-slick reflections, high-tech low-life mood and dense urban detail" },
  { id: "steampunk",       label: "Steampunk",        description: "Victorian brass + machinery",              promptHint: "steampunk style, Victorian-era brass and copper machinery, exposed gears and pipes, sepia tones and retrofuturistic mechanical detail" },
  { id: "vaporwave",       label: "Vaporwave",        description: "80s pastel digital retro",                 promptHint: "vaporwave style, 1980s digital retro aesthetic with pastel pink and teal palette, chrome text, glitch artifacts, palm silhouettes and dreamlike sunset grids" },
  { id: "low-poly",        label: "Low Poly",         description: "Faceted geometric 3D",                     promptHint: "low poly style, faceted geometric 3D aesthetic with visible flat triangular faces, simplified forms and crisp shadow edges between facets" },
  { id: "ink-wash",        label: "Ink Wash",         description: "East-Asian sumi-e brush",                  promptHint: "ink wash sumi-e style, East-Asian brush painting on rice paper with bold gestural black brush strokes, soft ink bleeding and generous negative space" },
  { id: "isometric",       label: "Isometric",        description: "3/4 axonometric view",                     promptHint: "isometric style, 3/4 axonometric projection with clean geometric forms, bright saturated flat colors and uniform lighting like a tile-based game or architectural diagram" },
  { id: "flat-vector",     label: "Flat Vector",      description: "Modern flat illustration",                 promptHint: "flat vector illustration style, modern SaaS-style flat shapes with bright solid colors, no gradients or shadows, clean geometry and friendly simplified forms" },
  { id: "ukiyo-e",         label: "Ukiyo-e",          description: "Japanese woodblock print",                 promptHint: "ukiyo-e style, traditional Japanese woodblock print with bold outlined flat color planes, Hokusai-inspired palette and stylized natural elements" },
  { id: "graffiti",        label: "Graffiti",         description: "Street-art spray paint",                   promptHint: "graffiti street art style, vivid urban spray-paint aesthetic with bold tag lettering, drip textures, stencil edges and gritty wall surfaces" },
  { id: "claymation",      label: "Claymation",       description: "Tactile stop-motion clay",                 promptHint: "claymation stop-motion style, tactile handcrafted clay figures with visible fingerprints, rounded plasticine forms and warm diorama lighting reminiscent of Aardman productions" },
  { id: "glitch-art",      label: "Glitch Art",       description: "Digital corruption + datamosh",            promptHint: "glitch art style, digital corruption aesthetic with chromatic aberration, RGB channel shifts, horizontal scanline tearing, pixel sorting and datamoshed compression artifacts" },
  { id: "ascii-art",       label: "ASCII Art",        description: "Monochrome terminal characters",           promptHint: "ASCII art style, monochrome terminal aesthetic built from text characters (@ # %, . :) forming the image, green-on-black old-computer vibe, monospace typography and character-grid rendering" },
  { id: "blueprint",       label: "Blueprint",        description: "Technical drawing on blue",                promptHint: "blueprint technical drawing style, white line work on deep cyan-blue paper with dimension lines, annotations, orthographic projections and engineering-schematic precision" },
  { id: "stained-glass",   label: "Stained Glass",    description: "Leaded colored glass mosaic",              promptHint: "stained glass window style, tessellated colored glass panels separated by thick black lead lines, luminous backlit jewel tones and church-window composition" },
  { id: "chalkboard",      label: "Chalkboard",       description: "White chalk on slate",                     promptHint: "chalkboard style, white and pastel chalk on dark slate with smudged edges, visible chalk dust, hand-drawn marks and classroom-lecture feel" },
  { id: "paper-cutout",    label: "Paper Cutout",     description: "Layered cut paper + shadows",              promptHint: "paper cutout papercraft style, Matisse-inspired layered cut paper shapes with visible paper texture, clean scissor edges and soft drop shadows between layered planes" },
  { id: "illuminated",     label: "Illuminated Manuscript", description: "Gold leaf + calligraphy",            promptHint: "illuminated manuscript style, medieval parchment with gold leaf accents, ornate decorative borders with vines and creatures, calligraphic script and jewel-toned miniature paintings" },
  { id: "pixar-3d",        label: "Pixar 3D",         description: "Polished character animation CG",          promptHint: "Pixar-style 3D character animation, polished CG with appealing rounded character design, soft subsurface skin shading, cinematic key lighting and expressive animated feature-film quality" },
  { id: "caricature",      label: "Caricature",       description: "Exaggerated stylized portrait",            promptHint: "caricature illustration style, an exaggerated stylized portrait with a comically oversized head on a small body, amplified signature features — large nose, wide grin, oversized eyes — drawn with confident ink lines and watery color washes in the tradition of street-fair sketch artists" },
] as const

const styleById = new Map<string, Style>(STYLES.map((s) => [s.id, s]))

export function getStyle(id: string | undefined | null): Style | undefined {
  if (!id) return undefined
  return styleById.get(id)
}

export function getStyleLabel(id: string | undefined | null, fallback?: string): string {
  const s = getStyle(id)
  if (s) return s.label
  if (fallback !== undefined) return fallback
  return (id ?? "").replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
}

export function getStylePromptHint(id: string | undefined | null): string {
  return getStyle(id)?.promptHint ?? ""
}

export const STYLE_IDS: ReadonlyArray<string> = STYLES.map((s) => s.id)
