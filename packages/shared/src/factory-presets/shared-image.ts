import type { FactoryPreset } from "./types.js"

/**
 * Selective-stylization presets shared by `modify-image` (transform an input photo) and
 * `generate-image` (use a connected reference image). `modify-image` is slated for deprecation in
 * favor of `generate-image`, so the catalog lives in ONE place to prevent the two from drifting —
 * when `modify-image` is removed, just drop its key from `FACTORY_PRESETS` below. `nano-banana-pro`
 * is a valid provider for both nodes' enums (IMAGE_GEN_PROVIDERS and MODIFY_IMAGE_PROVIDERS).
 */
const STYLIZED_SUBJECT: ReadonlyArray<{
  readonly slug: string
  readonly name: string
  readonly description: string
  readonly data: Readonly<Record<string, unknown>>
}> = [
  {
    slug: "cartoon-person-real-world",
    name: "Cartoon Person, Real World",
    description: "Subject → 3D cartoon, rest stays photoreal.",
    data: {
      provider: "nano-banana-pro",
      prompt:
        "Restyle ONLY the person in the reference image into a polished 3D animated character — Pixar/Disney sensibility: soft subsurface skin shading, expressive oversized eyes, smoothly stylized hair, clean rounded forms. Preserve their identity, exact pose, expression, and framing. Everything else stays untouched and fully photorealistic: keep the original background, props, clothing fabric and texture, and the scene's real lighting, shadows, and color grade. Composite the stylized figure into the real plate so it sits naturally — matched light direction, contact shadows, and depth.",
      negativePrompt:
        "changing the background, altering the unstylized parts, restyling clothing fabric or props, relighting the scene, distorting the subject, changing identity or pose, flat 2D look, extra limbs, deformed hands, warped face",
    },
  },
  {
    slug: "caricature-real-photo",
    name: "Caricature, Real Photo",
    description: "Exaggerated cartoon head on a real scene.",
    data: {
      provider: "nano-banana-pro",
      prompt:
        "Turn ONLY the person into a playful hand-illustrated caricature: enlarge the head, exaggerate their most recognizable features, and amplify expression with bold, confident linework and clean cel-style shading — while keeping them clearly identifiable. Leave everything else exactly as shot and photorealistic: the body proportions below the neck, the clothing, the background, props, and the scene's real lighting and shadows remain unchanged. Blend the caricature head onto the real photo seamlessly with matched lighting and a believable neckline.",
      negativePrompt:
        "changing the background, altering the unstylized parts, restyling the body or clothing, relighting the scene, distorting the subject beyond intent, losing likeness, photorealistic head, harsh seam at the neck, deformed features",
    },
  },
  {
    slug: "anime-person-real-bg",
    name: "Anime Person, Real Background",
    description: "Subject → 2D anime, real environment.",
    data: {
      provider: "nano-banana-pro",
      prompt:
        "Restyle ONLY the person as a crisp 2D anime character — clean ink outlines, flat cel shading with sharp shadow shapes, glossy stylized hair, and expressive anime eyes — while preserving their identity, pose, expression, and framing. Keep the real-world background, environment, props, and the original photographic lighting, shadows, and color completely untouched and photorealistic. Integrate the 2D figure into the live-action plate so the light direction and contact shadows read naturally.",
      negativePrompt:
        "changing the background, altering the unstylized parts, restyling the environment or props, relighting the scene, distorting the subject, 3D render look, photorealistic skin on the subject, extra fingers, warped anatomy, broken outlines",
    },
  },
  {
    slug: "real-person-cartoon-world",
    name: "Real Person, Cartoon World",
    description: "Inverse — real subject, stylized world.",
    data: {
      provider: "nano-banana-pro",
      prompt:
        "Inverse stylization: keep the PERSON completely photorealistic and unchanged — real skin, hair, clothing, identity, pose, and framing all preserved exactly. Restyle ONLY the surrounding world into a vibrant, hand-crafted cartoon environment: simplified painterly shapes, bold saturated colors, soft graphic shading, and whimsical stylized props and scenery. Light the real person to match the cartoon world's color and direction so they sit convincingly inside it, with believable contact shadows.",
      negativePrompt:
        "stylizing or cartoonifying the person, altering the subject's skin, face, hair or clothing, distorting the subject, changing the subject's pose, photorealistic background, flat lifeless scene, harsh cut-out edges around the person",
    },
  },
  {
    slug: "claymation-figure-real-set",
    name: "Claymation Figure, Real Set",
    description: "Subject → clay figure, real surroundings.",
    data: {
      provider: "nano-banana-pro",
      prompt:
        "Restyle ONLY the person into a tactile stop-motion claymation figure — molded plasticine surface with visible fingerprints, tool marks, subtle seams, and a soft matte sheen, in the handmade spirit of Aardman puppets — while keeping their identity, pose, expression, and framing. Everything else stays exactly as shot and photorealistic: the real background, set, props, and the scene's natural lighting and shadows are unchanged. Seat the clay figure into the real plate with matched light direction and grounded contact shadows.",
      negativePrompt:
        "changing the background or set, altering the unstylized parts, restyling props, relighting the scene, distorting the subject, smooth plastic toy look, glossy CGI surface, melted or deformed figure, missing fingerprints, extra limbs",
    },
  },
]

/** Build the Stylized Subject presets for a node type (id = `<nodeType>/<slug>`). */
export function stylizedSubjectFor(nodeType: string): FactoryPreset[] {
  return STYLIZED_SUBJECT.map((p) => ({
    id: `${nodeType}/${p.slug}`,
    name: p.name,
    description: p.description,
    group: "Stylized Subject",
    data: p.data,
  }))
}

/**
 * Image-edit presets shared by `modify-image` and `generate-image` (with a connected reference
 * image) — common photo-edit operations where the instruction lives in the prompt. Same
 * single-source rationale as STYLIZED_SUBJECT; when modify-image is removed, generate-image keeps them.
 */
const IMAGE_EDITS: ReadonlyArray<{
  readonly slug: string
  readonly name: string
  readonly description: string
  readonly data: Readonly<Record<string, unknown>>
}> = [
  {
    slug: "background-remove",
    name: "Remove Background",
    description: "Cut out the subject on white.",
    data: {
      provider: "nano-banana-pro",
      prompt:
        "Cleanly cut the main subject out of the reference image and place it on a pure, solid white background. Trace a crisp, accurate edge — preserve fine detail like hair strands, fur, and translucent or wispy edges — with no leftover background pixels and no color fringing. Keep the subject itself completely unchanged: same pose, lighting, color, and full silhouette, nothing cropped.",
      negativePrompt:
        "fringing, color halo, cut-off subject, leftover background, jagged or rough edges, missing hair detail, semi-transparent matte, drop shadow, gray or off-white background, altering the subject",
    },
  },
  {
    slug: "background-replace",
    name: "Replace Background",
    description: "Swap in a new scene.",
    data: {
      provider: "nano-banana-pro",
      prompt:
        "Replace the background behind the subject with {scene || a sunlit Mediterranean terrace}. Keep the subject perfectly unchanged — identity, pose, edges, and proportions intact — and composite it into the new scene so it looks truly photographed there: relight the subject's rim and ambient tones to match the new environment, cast believable contact shadows, and match perspective, depth of field, and color grade.",
      negativePrompt:
        "altering the subject, changing the subject's pose or proportions, fringing, halo, floating subject, missing or wrong-direction shadows, mismatched lighting, flat composite, harsh cut-out edges, perspective mismatch",
    },
  },
  {
    slug: "colorize",
    name: "Colorize B&W Photo",
    description: "Natural color from grayscale.",
    data: {
      provider: "nano-banana-pro",
      prompt:
        "Colorize this black-and-white photograph with natural, historically plausible color. Give skin realistic, even tones, and assign believable hues to clothing, foliage, sky, and materials. Preserve every original detail, grain, contrast, and the exact composition — add color only, never invent or remove content.",
      negativePrompt:
        "oversaturated, anachronistic colors, neon or cartoon tones, color bleeding outside edges, blotchy or uneven skin, lost detail, altered composition, added or hallucinated objects, washed-out contrast",
    },
  },
  {
    slug: "restore-photo",
    name: "Restore Old Photo",
    description: "Repair scratches, denoise, sharpen.",
    data: {
      provider: "nano-banana-pro",
      prompt:
        "Restore this old, damaged photograph: remove scratches, dust, creases, stains, and noise, repair torn or missing areas by reconstructing what is plainly there, and gently recover sharpness and tonal detail. Keep the result authentic and true to the original — preserve identity, era, natural film grain, and composition. Repair only; do not beautify, restyle, or invent new features.",
      negativePrompt:
        "over-smoothed, plastic skin, waxy or airbrushed look, hallucinated details, invented faces or objects, changing identity or age, removing authentic grain, modern restyling, oversharpening halos, altered composition",
    },
  },
  {
    slug: "relight",
    name: "Relight Scene",
    description: "New lighting, same subject.",
    data: {
      provider: "nano-banana-pro",
      prompt:
        "Relight the image with {lighting style || soft golden-hour key light from the left}. Re-derive highlights, shadows, ambient fill, and color temperature consistently across the whole frame for a believable, physically plausible result. Keep the subject, pose, expression, materials, and composition completely unchanged — only the lighting changes.",
      negativePrompt:
        "changing the subject, pose, expression, or composition, altering materials or clothing, flat or inconsistent lighting, blown-out highlights, crushed shadows, color casts on skin, double or contradictory light directions, repositioning anything",
    },
  },
  {
    slug: "restyle-whole",
    name: "Restyle (whole image)",
    description: "Apply an art style to everything.",
    data: {
      provider: "nano-banana-pro",
      prompt:
        "Restyle the entire image in a {art style || soft watercolor illustration} look, applying the style consistently to the subject, background, and every element. Keep the composition, subject placement, and the subject clearly recognizable — reinterpret texture, color, and rendering, not the underlying content or layout.",
      negativePrompt:
        "changing the composition or layout, moving or removing the subject, losing recognizability, applying the style to only part of the image, photorealistic patches, added or hallucinated objects, distorted anatomy, inconsistent style across the frame",
    },
  },
  {
    slug: "doodle-overlay",
    name: "Doodle Overlay",
    description: "Hand-drawn marker doodles on top — photo stays untouched.",
    data: {
      provider: "nano-banana-pro",
      prompt:
        "Layer playful hand-drawn doodles ON TOP of the reference photo while keeping every pixel of the underlying photograph completely unchanged — same people, same colors, same lighting, same crop. Doodle style: wobbly hand-drawn felt-tip marker lines in white with a few yellow accents, like quick sketches on a printed photo. Add: loose outline traces hugging one or two key shapes, small sparkles and stars, a hand-drawn thought cloud or speech bubble with a short witty handwritten phrase that reacts to what is actually happening in the photo, and simple arrows or underlines pointing at fun details. Outlines only — never fill shapes with color. Never cover faces or the main focal point; place doodles in empty areas like sky, walls or margins. Keep it balanced: four to seven doodle elements total, charming and confident, not cluttered. The photo is the hero — the doodles are the seasoning.",
      negativePrompt:
        "altered photo, restyled or recolored scene, redrawn subject, covered faces, filled color shapes, digital sticker or emoji look, vector clipart, cluttered doodles, garbled or misspelled handwriting, watermark, blurry",
    },
  },
  {
    slug: "doodle-overlay-expressive",
    name: "Doodle Overlay · Expressive",
    description: "Looser free-form doodles — the model improvises.",
    data: {
      provider: "nano-banana-pro",
      prompt:
        "Decorate the reference photo with expressive hand-drawn doodles layered on top, keeping the underlying photograph itself completely unchanged. Free, confident hand-drawn marker linework — wobbly outlines, sparkles, squiggles, little flames or hearts where they fit the mood, and a short handwritten phrase that responds cleverly to the content of the photo (never a generic cliché). Mix of white and one or two bright accent colors. Outline style only, no filled shapes. Compose the doodles around the subject — never on top of faces or the focal point — using empty areas and edges. Loose, playful, zine-like energy: it should feel like a bored genius doodled on a printed photo. Keep the original image pixels intact beneath the doodle layer.",
      negativePrompt:
        "altered photo, restyled or recolored scene, covered faces, filled color blocks, sticker or clipart look, cliché phrases, garbled or misspelled handwriting, cluttered composition, watermark, blurry",
    },
  },
]

/** Build the Edits presets for a node type (id = `<nodeType>/<slug>`). */
export function editsFor(nodeType: string): FactoryPreset[] {
  return IMAGE_EDITS.map((p) => ({
    id: `${nodeType}/${p.slug}`,
    name: p.name,
    description: p.description,
    group: "Edits",
    data: p.data,
  }))
}
