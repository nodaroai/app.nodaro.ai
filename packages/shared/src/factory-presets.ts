export interface FactoryPreset {
  /** Stable slug "<nodeType>/<kebab-name>" — used as a React key and in exports. */
  readonly id: string
  readonly name: string
  readonly description?: string
  /** Optional folder/section label this preset is grouped under in the picker.
   *  Presets sharing a `group` render together; "variants of one idea" (e.g. the
   *  character-sheet family) are simply siblings in the same group. */
  readonly group?: string
  /** How the group renders: a collapsible "folder" (default) or a flat "section"
   *  label. Taken from the first preset that opens the group. */
  readonly groupKind?: "folder" | "section"
  /** Capture-shaped config (no label / fieldMappings / runtime keys). */
  readonly data: Readonly<Record<string, unknown>>
}

/** A render-ready bucket of factory presets sharing one `group` (or the leading
 *  ungrouped bucket, `group: null`). Produced by {@link groupFactoryPresets}. */
export interface FactoryPresetGroup<T> {
  /** Stable key for React + collapse state ("__root__" for the ungrouped bucket). */
  readonly key: string
  /** Group label, or null for the ungrouped bucket. */
  readonly group: string | null
  readonly groupKind: "folder" | "section"
  readonly presets: T[]
}

/**
 * Bucket an ordered list of presets by their `group` field for rendering. Groups
 * appear in first-appearance order; presets keep their array order within a
 * group; ungrouped presets collect into a single leading `null` bucket. Pure and
 * UI-agnostic (operates on anything carrying `group`/`groupKind`) so the config
 * panel dropdown reuses it and it stays unit-testable.
 */
export function groupFactoryPresets<
  T extends { group?: string; groupKind?: "folder" | "section" },
>(presets: readonly T[]): FactoryPresetGroup<T>[] {
  const buckets: FactoryPresetGroup<T>[] = []
  const byKey = new Map<string, FactoryPresetGroup<T>>()
  for (const p of presets) {
    const key = p.group ?? "__root__"
    let bucket = byKey.get(key)
    if (!bucket) {
      bucket = { key, group: p.group ?? null, groupKind: p.groupKind ?? "folder", presets: [] }
      byKey.set(key, bucket)
      buckets.push(bucket)
    }
    bucket.presets.push(p)
  }
  return buckets
}

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
        "Turn the person into a stylized 3D cartoon character (Pixar/Disney look). Important: only the person becomes a cartoon — keep the background, clothing textures, lighting, and everything else photorealistic and unchanged.",
    },
  },
  {
    slug: "caricature-real-photo",
    name: "Caricature, Real Photo",
    description: "Exaggerated cartoon head on a real scene.",
    data: {
      provider: "nano-banana-pro",
      prompt:
        "Exaggerate the person into a caricature with an oversized head and amplified features, in a fun illustrated style. Keep the body, background, and overall scene photorealistic and unchanged.",
    },
  },
  {
    slug: "anime-person-real-bg",
    name: "Anime Person, Real Background",
    description: "Subject → 2D anime, real environment.",
    data: {
      provider: "nano-banana-pro",
      prompt:
        "Restyle only the person as a 2D anime character with cel shading. Keep the real-world background, lighting, and environment photorealistic and untouched.",
    },
  },
  {
    slug: "real-person-cartoon-world",
    name: "Real Person, Cartoon World",
    description: "Inverse — real subject, stylized world.",
    data: {
      provider: "nano-banana-pro",
      prompt:
        "Keep the person photorealistic and unchanged. Transform only the background and environment into a colorful stylized cartoon world.",
    },
  },
  {
    slug: "claymation-figure-real-set",
    name: "Claymation Figure, Real Set",
    description: "Subject → clay figure, real surroundings.",
    data: {
      provider: "nano-banana-pro",
      prompt:
        "Turn the person into a tactile stop-motion claymation figure with visible fingerprints and plasticine texture. Keep the surrounding set and background photorealistic.",
    },
  },
]

/** Build the Stylized Subject presets for a node type (id = `<nodeType>/<slug>`). */
function stylizedSubjectFor(nodeType: string): FactoryPreset[] {
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
        "Remove the background completely and place the subject on a clean solid white background. Keep the subject sharp, complete and unchanged.",
    },
  },
  {
    slug: "background-replace",
    name: "Replace Background",
    description: "Swap in a new scene.",
    data: {
      provider: "nano-banana-pro",
      prompt:
        "Replace the background with {scene}. Keep the subject unchanged and blend the lighting and shadows naturally.",
    },
  },
  {
    slug: "colorize",
    name: "Colorize B&W Photo",
    description: "Natural color from grayscale.",
    data: {
      provider: "nano-banana-pro",
      prompt:
        "Colorize this black-and-white photo with natural, realistic colors. Preserve all original detail and composition.",
    },
  },
  {
    slug: "restore-photo",
    name: "Restore Old Photo",
    description: "Repair scratches, denoise, sharpen.",
    data: {
      provider: "nano-banana-pro",
      prompt:
        "Restore and enhance this old photo: remove scratches, dust and noise, repair damage, and sharpen detail while keeping it authentic.",
    },
  },
  {
    slug: "relight",
    name: "Relight Scene",
    description: "New lighting, same subject.",
    data: {
      provider: "nano-banana-pro",
      prompt:
        "Relight the scene with {lighting style}. Keep the subject, pose and composition unchanged.",
    },
  },
  {
    slug: "restyle-whole",
    name: "Restyle (whole image)",
    description: "Apply an art style to everything.",
    data: {
      provider: "nano-banana-pro",
      prompt:
        "Restyle the entire image in a {art style} look while keeping the composition and subject recognizable.",
    },
  },
]

/** Build the Edits presets for a node type (id = `<nodeType>/<slug>`). */
function editsFor(nodeType: string): FactoryPreset[] {
  return IMAGE_EDITS.map((p) => ({
    id: `${nodeType}/${p.slug}`,
    name: p.name,
    description: p.description,
    group: "Edits",
    data: p.data,
  }))
}

/**
 * System/factory presets shipped with the app. Code-defined (like the picker catalogs) so they are
 * typed, testable, versioned with the app, and available in every edition without a DB seed.
 *
 * Additive: the preset system works for ALL node types; these are curated starting points for the
 * highest-traffic nodes. Each preset's `data` uses only fields that exist on that node and values
 * valid for the node's route Zod schema (verified against `model-options.ts` / route schemas).
 * Presets set `provider` plus a few high-signal knobs; the config panel's provider-change fail-safe
 * derives any provider-dependent field (e.g. `model`) on apply.
 */
export const FACTORY_PRESETS: Readonly<Record<string, readonly FactoryPreset[]>> = {
  "generate-image": [
    // ── Photography & Cinematic ──────────────────────────────────────────────
    {
      id: "generate-image/cinematic-portrait",
      name: "Cinematic Portrait",
      description: "Moody, shallow-depth portrait look.",
      group: "Photography & Cinematic",
      data: {
        provider: "nano-banana-pro",
        aspectRatio: "9:16",
        prompt:
          "cinematic portrait, shallow depth of field, soft rim lighting, film grain, 85mm lens",
        negativePrompt: "lowres, deformed, extra fingers, watermark, text",
      },
    },
    {
      id: "generate-image/cinematic-still",
      name: "Cinematic Still",
      description: "Film-grade scene, dramatic lighting.",
      group: "Photography & Cinematic",
      data: {
        provider: "nano-banana-pro",
        aspectRatio: "16:9",
        prompt:
          "cinematic film still of {subject}, dramatic three-point lighting, shallow depth of field, anamorphic lens, subtle film grain, professional color grade",
        negativePrompt: "lowres, deformed, watermark, text, oversaturated",
      },
    },
    {
      id: "generate-image/cinematic-widescreen",
      name: "Cinematic Widescreen (21:9)",
      description: "Epic anamorphic 2.39:1 frame.",
      group: "Photography & Cinematic",
      data: {
        provider: "seedream",
        aspectRatio: "21:9",
        prompt:
          "epic cinematic still of {subject}, anamorphic framing, atmospheric haze, dramatic lighting, color graded, film grain",
        negativePrompt: "lowres, deformed, watermark, text",
      },
    },
    {
      id: "generate-image/studio-portrait",
      name: "Studio Portrait",
      description: "Soft-lit 85mm studio headshot.",
      group: "Photography & Cinematic",
      data: {
        provider: "nano-banana-pro",
        aspectRatio: "4:5",
        prompt:
          "studio portrait of {subject}, 85mm lens, soft key light with gentle fill, seamless backdrop, sharp focus on the eyes, natural skin texture",
        negativePrompt: "lowres, deformed, extra fingers, watermark, text, plastic skin",
      },
    },
    {
      id: "generate-image/corporate-headshot",
      name: "Corporate Headshot",
      description: "Clean professional headshot.",
      group: "Photography & Cinematic",
      data: {
        provider: "nano-banana-pro",
        aspectRatio: "1:1",
        prompt:
          "professional corporate headshot of {subject}, clean neutral background, soft even lighting, confident friendly expression, sharp focus",
        negativePrompt: "lowres, deformed, watermark, text, busy background",
      },
    },
    {
      id: "generate-image/golden-hour-portrait",
      name: "Golden Hour Portrait",
      description: "Warm backlit outdoor portrait.",
      group: "Photography & Cinematic",
      data: {
        provider: "seedream",
        aspectRatio: "2:3",
        prompt:
          "outdoor portrait of {subject} at golden hour, warm backlight, gentle lens flare, creamy bokeh, 85mm lens",
        negativePrompt: "lowres, deformed, watermark, text, harsh shadows",
      },
    },
    {
      id: "generate-image/bw-portrait",
      name: "Black & White Portrait",
      description: "High-contrast editorial mono.",
      group: "Photography & Cinematic",
      data: {
        provider: "nano-banana-pro",
        aspectRatio: "4:5",
        prompt:
          "black and white portrait of {subject}, high-contrast dramatic lighting, deep shadows, fine grain, timeless editorial mood",
        negativePrompt: "color, lowres, deformed, watermark, text",
      },
    },
    {
      id: "generate-image/macro-shot",
      name: "Macro Close-Up",
      description: "Extreme detail, focus-stacked.",
      group: "Photography & Cinematic",
      data: {
        provider: "seedream",
        aspectRatio: "1:1",
        prompt:
          "extreme macro photograph of {subject}, ultra close-up, focus stacking, crisp detail, soft studio lighting, shallow depth of field",
        negativePrompt: "lowres, blurry, watermark, text",
      },
    },
    {
      id: "generate-image/food-photography",
      name: "Food Photography",
      description: "Appetizing 45° hero shot.",
      group: "Photography & Cinematic",
      data: {
        provider: "nano-banana-pro",
        aspectRatio: "4:5",
        prompt:
          "appetizing food photograph of {dish}, 45-degree angle, soft natural window light, shallow depth of field, fresh garnish, styled on a rustic surface",
        negativePrompt: "lowres, unappetizing, watermark, text, plastic look",
      },
    },
    {
      id: "generate-image/food-flatlay",
      name: "Food Flat-Lay",
      description: "Overhead styled food spread.",
      group: "Photography & Cinematic",
      data: {
        provider: "nano-banana-pro",
        aspectRatio: "1:1",
        prompt:
          "overhead flat-lay food photograph of {dish}, top-down, styled props, soft shadows, vibrant fresh ingredients",
        negativePrompt: "lowres, cluttered, watermark, text",
      },
    },
    {
      id: "generate-image/aerial-drone",
      name: "Aerial / Drone",
      description: "Top-down golden-hour aerial.",
      group: "Photography & Cinematic",
      data: {
        provider: "seedream",
        aspectRatio: "16:9",
        prompt:
          "aerial drone photograph of {scene}, top-down perspective, golden hour, high altitude, crisp detail",
        negativePrompt: "lowres, blurry, watermark, text",
      },
    },
    {
      id: "generate-image/landscape-vista",
      name: "Landscape Vista (21:9)",
      description: "Ultra-wide dramatic scenery.",
      group: "Photography & Cinematic",
      data: {
        provider: "seedream",
        aspectRatio: "21:9",
        prompt:
          "sweeping landscape photograph of {scene}, ultra-wide vista, dramatic sky, golden hour, high dynamic range, depth and scale",
        negativePrompt: "lowres, watermark, text, oversaturated",
      },
    },

    // ── Characters (incl. the character-sheet family) ────────────────────────
    {
      id: "generate-image/character-turnaround",
      name: "Character Sheet · Turnaround (3-view)",
      description: "Front / side / back, T-pose.",
      group: "Characters",
      data: {
        provider: "nano-banana-pro",
        aspectRatio: "16:9",
        prompt:
          "full-body character reference sheet of {character description}, three views in a row: front, side profile, and back, T-pose, neutral expression, consistent design, plain grey background, concept art model sheet",
        negativePrompt: "inconsistent design, extra limbs, deformed, watermark, busy background",
      },
    },
    {
      id: "generate-image/character-action-4",
      name: "Character Sheet · Action Poses ×4",
      description: "Four dynamic full-body poses.",
      group: "Characters",
      data: {
        provider: "nano-banana-pro",
        aspectRatio: "16:9",
        prompt:
          "character model sheet of {character description}, four dynamic full-body action poses in a row, consistent character design and outfit, plain background",
        negativePrompt: "inconsistent design, deformed, extra limbs, watermark",
      },
    },
    {
      id: "generate-image/character-expressions-6",
      name: "Character Sheet · Expressions ×6",
      description: "6 emotions, 2 rows of 3.",
      group: "Characters",
      data: {
        provider: "nano-banana-pro",
        aspectRatio: "4:3",
        prompt:
          "character expression sheet of {character description}, six head-and-shoulders portraits arranged in two rows of three, emotions: neutral, happy, angry, surprised, sad, determined, highly consistent face",
        negativePrompt: "inconsistent face, deformed, watermark, text",
      },
    },
    {
      id: "generate-image/character-expressions-16",
      name: "Character Sheet · Expression Grid ×16",
      description: "4×4 emotion grid, one face.",
      group: "Characters",
      data: {
        provider: "nano-banana-pro",
        aspectRatio: "1:1",
        prompt:
          "16-panel expression grid of {character description}, 4x4 layout, varied facial emotions, highly consistent face and design, model sheet",
        negativePrompt: "inconsistent face, deformed, watermark",
      },
    },
    {
      id: "generate-image/character-outfits",
      name: "Character Sheet · Outfit Variations",
      description: "Same character, 4 outfits.",
      group: "Characters",
      data: {
        provider: "nano-banana-pro",
        aspectRatio: "16:9",
        prompt:
          "outfit variation sheet of {character description}, the same character shown in four different outfits, full body, consistent face, plain background",
        negativePrompt: "inconsistent face, deformed, watermark",
      },
    },
    {
      id: "generate-image/character-turnaround-labeled",
      name: "Character Sheet · With Text Labels",
      description: "Turnaround + labels + height chart.",
      group: "Characters",
      data: {
        provider: "gpt-image-2",
        aspectRatio: "16:9",
        prompt:
          "character model sheet of {character description}: front, side, and back turnaround with clear text labels under each view and a height reference chart, production reference, neat annotations",
        negativePrompt: "inconsistent design, deformed, misspelled labels",
      },
    },
    {
      id: "generate-image/character-chibi",
      name: "Character Sheet · Chibi",
      description: "Cute super-deformed poses.",
      group: "Characters",
      data: {
        provider: "nano-banana-pro",
        aspectRatio: "1:1",
        prompt:
          "chibi character sheet of {character description}, super-deformed cute proportions, multiple small poses, consistent design, plain background",
        negativePrompt: "inconsistent design, deformed, watermark",
      },
    },
    {
      id: "generate-image/character-portrait",
      name: "Character Portrait",
      description: "Single expressive hero portrait.",
      group: "Characters",
      data: {
        provider: "seedream",
        aspectRatio: "2:3",
        prompt:
          "detailed character portrait of {character description}, expressive, dramatic lighting, rich detail",
        negativePrompt: "lowres, deformed, extra fingers, watermark, text",
      },
    },
    {
      id: "generate-image/character-fullbody-hero",
      name: "Character Full-Body Hero",
      description: "Dynamic full-body hero shot.",
      group: "Characters",
      data: {
        provider: "nano-banana-pro",
        aspectRatio: "2:3",
        prompt:
          "full-body hero shot of {character description}, confident dynamic pose, dramatic rim lighting, detailed costume, subtle background",
        negativePrompt: "lowres, deformed, extra limbs, watermark, text",
      },
    },
    {
      id: "generate-image/creature-design",
      name: "Creature Design Sheet",
      description: "Concept creature, multi-angle.",
      group: "Characters",
      data: {
        provider: "nano-banana-pro",
        aspectRatio: "16:9",
        prompt:
          "creature design sheet of {creature description}, multiple angles, anatomy details, concept art, neutral background",
        negativePrompt: "inconsistent design, deformed, watermark",
      },
    },
    {
      id: "generate-image/avatar-pfp",
      name: "Avatar / Profile Picture",
      description: "Centered, bold, clean bg.",
      group: "Characters",
      data: {
        provider: "nano-banana-pro",
        aspectRatio: "1:1",
        prompt:
          "stylized avatar profile picture of {character or subject}, centered head-and-shoulders, clean solid-color background, bold and friendly",
        negativePrompt: "lowres, deformed, watermark, text, busy background",
      },
    },

    // ── Product & Commerce ───────────────────────────────────────────────────
    {
      id: "generate-image/product-shot",
      name: "Product Shot (white bg)",
      description: "Clean e-commerce product photo on white.",
      group: "Product & Commerce",
      data: {
        provider: "nano-banana-pro",
        aspectRatio: "1:1",
        prompt:
          "studio product photograph on seamless white background, soft even lighting, high detail, centered",
        negativePrompt: "clutter, shadow, reflection, text, watermark",
      },
    },
    {
      id: "generate-image/product-lifestyle",
      name: "Product Lifestyle",
      description: "Product in-use, editorial.",
      group: "Product & Commerce",
      data: {
        provider: "seedream",
        aspectRatio: "4:3",
        prompt:
          "lifestyle product photograph of {product} in {setting}, in use, natural light, editorial styling, shallow depth of field",
        negativePrompt: "clutter, lowres, watermark, text",
      },
    },
    {
      id: "generate-image/product-flatlay",
      name: "Product Flat-Lay",
      description: "Overhead styled arrangement.",
      group: "Product & Commerce",
      data: {
        provider: "nano-banana-pro",
        aspectRatio: "1:1",
        prompt:
          "overhead flat-lay of {product} with complementary props, styled arrangement, soft shadows, clean background",
        negativePrompt: "clutter, lowres, watermark, text",
      },
    },
    {
      id: "generate-image/packaging-mockup",
      name: "Packaging Mockup",
      description: "Box / bottle / pouch render.",
      group: "Product & Commerce",
      data: {
        provider: "nano-banana-pro",
        aspectRatio: "1:1",
        prompt:
          "product packaging mockup of {product}, {format}, photorealistic printed label, studio lighting, clean background",
        negativePrompt: "lowres, distorted label, watermark, clutter",
      },
    },
    {
      id: "generate-image/device-mockup",
      name: "Device / Screen Mockup",
      description: "Phone / laptop showing a screen.",
      group: "Product & Commerce",
      data: {
        provider: "gpt-image-2",
        aspectRatio: "16:9",
        prompt:
          "{device} mockup displaying {screen content}, clean studio setting, slight angle, soft reflections, crisp screen",
        negativePrompt: "lowres, distorted screen, watermark, clutter",
      },
    },
    {
      id: "generate-image/beauty-hero",
      name: "Beauty Product Hero",
      description: "Premium cosmetic hero shot.",
      group: "Product & Commerce",
      data: {
        provider: "nano-banana-pro",
        aspectRatio: "4:5",
        prompt:
          "luxury beauty product hero shot of {product}, dramatic lighting, water droplets, premium reflective surface, elegant composition",
        negativePrompt: "lowres, clutter, watermark, text",
      },
    },

    // ── Branding & Logos (text-strong providers) ─────────────────────────────
    {
      id: "generate-image/logo-wordmark",
      name: "Logo · Wordmark",
      description: "Clean typographic brand name.",
      group: "Branding & Logos",
      data: {
        provider: "ideogram-v3",
        aspectRatio: "1:1",
        prompt:
          "minimalist wordmark logo for '{BRAND}', clean modern typography, flat vector style, centered, solid background, professional",
        negativePrompt: "photorealistic, cluttered, gradient mesh, watermark",
      },
    },
    {
      id: "generate-image/logo-emblem",
      name: "Logo · Emblem / Badge",
      description: "Circular badge emblem.",
      group: "Branding & Logos",
      data: {
        provider: "ideogram-v3",
        aspectRatio: "1:1",
        prompt:
          "emblem badge logo for '{BRAND}', {concept}, circular composition, flat vector, limited color palette, crisp edges, white background",
        negativePrompt: "photorealistic, cluttered, watermark",
      },
    },
    {
      id: "generate-image/logo-mascot",
      name: "Logo · Mascot",
      description: "Friendly mascot character logo.",
      group: "Branding & Logos",
      data: {
        provider: "ideogram-v3",
        aspectRatio: "1:1",
        prompt:
          "mascot logo for '{BRAND}', friendly {character} mascot, bold flat colors, clean vector style, white background",
        negativePrompt: "photorealistic, cluttered, watermark",
      },
    },
    {
      id: "generate-image/app-icon",
      name: "App Icon",
      description: "Rounded-square app glyph.",
      group: "Branding & Logos",
      data: {
        provider: "gpt-image-2",
        aspectRatio: "1:1",
        prompt:
          "modern app icon for '{APP}', rounded square, simple bold glyph of {concept}, subtle gradient, centered, flat design",
        negativePrompt: "cluttered, photorealistic, watermark, text",
      },
    },
    {
      id: "generate-image/monogram",
      name: "Monogram",
      description: "Elegant initials mark.",
      group: "Branding & Logos",
      data: {
        provider: "ideogram-v3",
        aspectRatio: "1:1",
        prompt:
          "elegant monogram logo combining the letters '{INITIALS}', refined geometric design, single color, white background",
        negativePrompt: "cluttered, photorealistic, watermark",
      },
    },

    // ── Marketing & Social ───────────────────────────────────────────────────
    {
      id: "generate-image/youtube-thumbnail",
      name: "YouTube Thumbnail",
      description: "Bold, punchy, big text.",
      group: "Marketing & Social",
      data: {
        provider: "ideogram-v3",
        aspectRatio: "16:9",
        prompt:
          "YouTube thumbnail: {subject}, bold expressive subject, high-contrast punchy colors, dramatic composition, large bold readable text '{TEXT}'",
        negativePrompt: "lowres, cluttered, tiny text, watermark",
      },
    },
    {
      id: "generate-image/instagram-post",
      name: "Instagram Post (1:1)",
      description: "Square branded social graphic.",
      group: "Marketing & Social",
      data: {
        provider: "ideogram-v3",
        aspectRatio: "1:1",
        prompt:
          "Instagram post graphic about {topic}, modern branded design, clean layout, bold text '{TEXT}'",
        negativePrompt: "lowres, cluttered, tiny text, watermark",
      },
    },
    {
      id: "generate-image/story-vertical",
      name: "Story / Reel (9:16)",
      description: "Vertical full-bleed promo.",
      group: "Marketing & Social",
      data: {
        provider: "ideogram-v3",
        aspectRatio: "9:16",
        prompt:
          "social story graphic about {topic}, full-bleed background, bold headline text '{TEXT}', modern design",
        negativePrompt: "lowres, cluttered, tiny text, watermark",
      },
    },
    {
      id: "generate-image/ad-creative",
      name: "Ad Creative",
      description: "Headline + hero, CTA space.",
      group: "Marketing & Social",
      data: {
        provider: "gpt-image-2",
        aspectRatio: "3:4",
        prompt:
          "advertising creative for {product}, attention-grabbing hero composition, clear headline '{TEXT}', professional, open space for a call to action",
        negativePrompt: "lowres, cluttered, misspelled text, watermark",
      },
    },
    {
      id: "generate-image/quote-card",
      name: "Quote Card",
      description: "Typographic quote graphic.",
      group: "Marketing & Social",
      data: {
        provider: "ideogram-v3",
        aspectRatio: "1:1",
        prompt:
          "inspirational quote card with the text '{QUOTE}', elegant typography, {background style}, balanced composition",
        negativePrompt: "lowres, cluttered, misspelled text, watermark",
      },
    },
    {
      id: "generate-image/web-banner",
      name: "Web Banner / Header",
      description: "Wide site header with text.",
      group: "Marketing & Social",
      data: {
        provider: "ideogram-v3",
        aspectRatio: "16:9",
        prompt:
          "web banner for {brand or topic}, clean modern design, headline text '{TEXT}', space for a logo",
        negativePrompt: "lowres, cluttered, tiny text, watermark",
      },
    },

    // ── Print & Posters ──────────────────────────────────────────────────────
    {
      id: "generate-image/movie-poster",
      name: "Movie Poster",
      description: "Cinematic key art, title + tagline.",
      group: "Print & Posters",
      data: {
        provider: "nano-banana-pro",
        aspectRatio: "2:3",
        prompt:
          "movie poster for '{TITLE}', cinematic key art, dramatic hero composition, atmospheric lighting, title treatment at the bottom, tagline",
        negativePrompt: "lowres, cluttered, misspelled text, watermark",
      },
    },
    {
      id: "generate-image/event-poster",
      name: "Event Poster",
      description: "Bold graphic event flyer.",
      group: "Print & Posters",
      data: {
        provider: "ideogram-v3",
        aspectRatio: "3:4",
        prompt:
          "event poster for '{EVENT}', {date and venue}, bold graphic design, striking typography, eye-catching",
        negativePrompt: "lowres, cluttered, misspelled text, watermark",
      },
    },
    {
      id: "generate-image/book-cover",
      name: "Book Cover",
      description: "Genre cover, title + author.",
      group: "Print & Posters",
      data: {
        provider: "nano-banana-pro",
        aspectRatio: "2:3",
        prompt:
          "book cover for '{TITLE}' by {AUTHOR}, {genre} mood and imagery, title and author typography, professional cover design",
        negativePrompt: "lowres, cluttered, misspelled text, watermark",
      },
    },
    {
      id: "generate-image/tshirt-design",
      name: "T-Shirt / POD Design",
      description: "Print-ready isolated graphic.",
      group: "Print & Posters",
      data: {
        provider: "ideogram-v3",
        aspectRatio: "1:1",
        prompt:
          "t-shirt graphic design: {concept}, bold centered illustration, limited color palette, isolated on a plain background, print-ready, no mockup",
        negativePrompt: "photo background, mockup, lowres, watermark",
      },
    },
    {
      id: "generate-image/sticker-diecut",
      name: "Die-Cut Sticker",
      description: "White-border glossy sticker.",
      group: "Print & Posters",
      data: {
        provider: "ideogram-v3",
        aspectRatio: "1:1",
        prompt:
          "die-cut sticker design of {subject}, thick white border, bold flat colors, glossy, cute, isolated on a plain background",
        negativePrompt: "photo background, lowres, watermark",
      },
    },
    {
      id: "generate-image/album-cover",
      name: "Album Cover",
      description: "Square cover art, mood-driven.",
      group: "Print & Posters",
      data: {
        provider: "seedream",
        aspectRatio: "1:1",
        prompt:
          "album cover art for '{TITLE}', {genre} aesthetic, striking central image, mood-setting color palette",
        negativePrompt: "lowres, cluttered, watermark",
      },
    },

    // ── Illustration & Art Styles (pin the global `style` look) ───────────────
    {
      id: "generate-image/anime-scene",
      name: "Anime Scene",
      description: "Cel-shaded anime look.",
      group: "Illustration & Art Styles",
      data: {
        provider: "nano-banana-pro",
        aspectRatio: "16:9",
        style: "anime",
        prompt: "{scene or subject}",
        negativePrompt: "lowres, deformed, watermark, text",
      },
    },
    {
      id: "generate-image/comic-panel",
      name: "Comic Panel",
      description: "Inked panel with action.",
      group: "Illustration & Art Styles",
      data: {
        provider: "nano-banana-pro",
        aspectRatio: "4:3",
        style: "comic-book",
        prompt: "{scene}, dynamic comic book panel composition, action lines, space for a speech bubble",
        negativePrompt: "lowres, deformed, watermark",
      },
    },
    {
      id: "generate-image/manga-bw",
      name: "Manga Panel (B&W)",
      description: "Screentone black-and-white.",
      group: "Illustration & Art Styles",
      data: {
        provider: "nano-banana-pro",
        aspectRatio: "3:4",
        style: "manga",
        prompt: "{scene}, manga panel, screentone shading, dramatic angle",
        negativePrompt: "color, lowres, deformed, watermark",
      },
    },
    {
      id: "generate-image/watercolor",
      name: "Watercolor",
      description: "Soft transparent washes.",
      group: "Illustration & Art Styles",
      data: {
        provider: "flux",
        aspectRatio: "4:3",
        style: "watercolor",
        prompt: "{subject}",
        negativePrompt: "lowres, harsh edges, watermark, text",
      },
    },
    {
      id: "generate-image/oil-painting",
      name: "Oil Painting",
      description: "Classical canvas brushwork.",
      group: "Illustration & Art Styles",
      data: {
        provider: "flux",
        aspectRatio: "4:3",
        style: "oil-painting",
        prompt: "{subject}",
        negativePrompt: "lowres, flat, watermark, text",
      },
    },
    {
      id: "generate-image/flat-vector-illustration",
      name: "Flat Vector Illustration",
      description: "Modern flat SaaS-style art.",
      group: "Illustration & Art Styles",
      data: {
        provider: "ideogram-v3",
        aspectRatio: "16:9",
        style: "flat-vector",
        prompt: "{subject or scene}, clean flat illustration",
        negativePrompt: "photorealistic, gradient mesh, lowres, watermark",
      },
    },
    {
      id: "generate-image/isometric-illustration",
      name: "Isometric Illustration",
      description: "3/4 axonometric scene.",
      group: "Illustration & Art Styles",
      data: {
        provider: "nano-banana-pro",
        aspectRatio: "1:1",
        style: "isometric",
        prompt: "isometric {building or scene}, clean game-art style",
        negativePrompt: "perspective distortion, lowres, watermark",
      },
    },
    {
      id: "generate-image/pixel-art",
      name: "Pixel Art Scene",
      description: "Retro low-res pixel grid.",
      group: "Illustration & Art Styles",
      data: {
        provider: "nano-banana-pro",
        aspectRatio: "1:1",
        style: "pixel-art",
        prompt: "{subject}, retro pixel art",
        negativePrompt: "smooth, antialiased, lowres blur, watermark",
      },
    },
    {
      id: "generate-image/pixar-3d",
      name: "3D Animated (Pixar-style)",
      description: "Polished CG character look.",
      group: "Illustration & Art Styles",
      data: {
        provider: "nano-banana-pro",
        aspectRatio: "1:1",
        style: "pixar-3d",
        prompt: "{character or subject}, polished 3D animated character render",
        negativePrompt: "lowres, deformed, watermark, text",
      },
    },
    {
      id: "generate-image/line-art-coloring",
      name: "Coloring Page (line art)",
      description: "Clean B&W outlines, no shading.",
      group: "Illustration & Art Styles",
      data: {
        provider: "ideogram-v3",
        aspectRatio: "1:1",
        prompt:
          "black and white line art coloring page of {subject}, clean bold outlines, no shading, no color, white background",
        negativePrompt: "color, shading, grayscale fill, watermark",
      },
    },
    {
      id: "generate-image/tattoo-flash",
      name: "Tattoo Flash",
      description: "Bold linework, isolated.",
      group: "Illustration & Art Styles",
      data: {
        provider: "nano-banana-pro",
        aspectRatio: "2:3",
        prompt:
          "tattoo flash design of {subject}, {tattoo style} style, bold clean linework, isolated on white",
        negativePrompt: "photo background, lowres, watermark",
      },
    },
    {
      id: "generate-image/concept-art-env",
      name: "Concept Art (environment)",
      description: "Painterly pre-production art.",
      group: "Illustration & Art Styles",
      data: {
        provider: "nano-banana-pro",
        aspectRatio: "16:9",
        style: "concept-art",
        prompt: "concept art of {environment or subject}, painterly, dramatic lighting, sense of scale, mood",
        negativePrompt: "lowres, flat, watermark, text",
      },
    },

    // ── Film & Storyboard ────────────────────────────────────────────────────
    {
      id: "generate-image/storyboard-frame",
      name: "Storyboard Frame",
      description: "Rough B&W shot sketch.",
      group: "Film & Storyboard",
      data: {
        provider: "nano-banana",
        aspectRatio: "16:9",
        prompt:
          "storyboard frame: {shot description}, {shot size} shot, rough black-and-white sketch, clear composition, {camera angle}, arrows indicating motion",
        negativePrompt: "color, photorealistic, lowres, watermark",
      },
    },
    {
      id: "generate-image/cinematic-keyframe",
      name: "Cinematic Keyframe",
      description: "Graded film-still keyframe.",
      group: "Film & Storyboard",
      data: {
        provider: "seedream",
        aspectRatio: "16:9",
        prompt:
          "cinematic keyframe: {scene}, film still, {mood} lighting, color graded, atmospheric",
        negativePrompt: "lowres, watermark, text",
      },
    },
    {
      id: "generate-image/matte-painting",
      name: "Matte Painting (21:9)",
      description: "Epic environment establishing.",
      group: "Film & Storyboard",
      data: {
        provider: "seedream",
        aspectRatio: "21:9",
        prompt:
          "matte painting of {environment}, epic scale, cinematic, atmospheric depth, photorealistic detail",
        negativePrompt: "lowres, flat, watermark, text",
      },
    },
    {
      id: "generate-image/moodboard-tile",
      name: "Mood Board Tile",
      description: "Single cohesive aesthetic tile.",
      group: "Film & Storyboard",
      data: {
        provider: "nano-banana-pro",
        aspectRatio: "1:1",
        prompt:
          "mood board reference image capturing {aesthetic or theme}, {color palette}, evocative, single cohesive image",
        negativePrompt: "collage, text, watermark, lowres",
      },
    },
    {
      id: "generate-image/establishing-shot",
      name: "Establishing Shot (21:9)",
      description: "Wide sense-of-place opener.",
      group: "Film & Storyboard",
      data: {
        provider: "seedream",
        aspectRatio: "21:9",
        prompt:
          "establishing wide shot of {location}, cinematic, atmospheric, sense of place and scale",
        negativePrompt: "lowres, watermark, text",
      },
    },

    // ── Architecture & Interiors ─────────────────────────────────────────────
    {
      id: "generate-image/exterior-render",
      name: "Architecture · Exterior",
      description: "Photoreal building, golden hour.",
      group: "Architecture & Interiors",
      data: {
        provider: "seedream",
        aspectRatio: "16:9",
        prompt:
          "architectural exterior visualization of {building}, {architectural style}, photorealistic, golden hour, professional architecture photography",
        negativePrompt: "lowres, distorted geometry, watermark, text",
      },
    },
    {
      id: "generate-image/interior-design",
      name: "Architecture · Interior",
      description: "Magazine-quality room render.",
      group: "Architecture & Interiors",
      data: {
        provider: "seedream",
        aspectRatio: "4:3",
        prompt:
          "interior design of {room}, {style}, natural light, photorealistic, wide angle, magazine quality",
        negativePrompt: "lowres, distorted, clutter, watermark, text",
      },
    },
    {
      id: "generate-image/real-estate-hero",
      name: "Real Estate Hero",
      description: "Bright, inviting listing shot.",
      group: "Architecture & Interiors",
      data: {
        provider: "nano-banana-pro",
        aspectRatio: "16:9",
        prompt:
          "real estate photograph of {property}, bright and inviting, wide angle, high dynamic range, clean staging",
        negativePrompt: "lowres, dark, clutter, watermark, text",
      },
    },
    {
      id: "generate-image/building-tall",
      name: "Skyscraper / Tall Building",
      description: "Dramatic upward portrait view.",
      group: "Architecture & Interiors",
      data: {
        provider: "seedream",
        aspectRatio: "2:3",
        prompt:
          "architectural photograph of {tall building}, dramatic upward angle, blue sky, modern design",
        negativePrompt: "lowres, distorted geometry, watermark, text",
      },
    },

    // ── Icons, Game Assets & Textures ────────────────────────────────────────
    {
      id: "generate-image/game-icon",
      name: "Game Icon",
      description: "Glossy RPG inventory icon.",
      group: "Icons, Game Assets & Textures",
      data: {
        provider: "nano-banana-pro",
        aspectRatio: "1:1",
        prompt:
          "polished game UI icon of {item}, rounded, glossy, vibrant, isolated on a dark background, RPG inventory style",
        negativePrompt: "lowres, cluttered background, watermark, text",
      },
    },
    {
      id: "generate-image/seamless-texture",
      name: "Seamless Texture",
      description: "Tileable PBR-style material.",
      group: "Icons, Game Assets & Textures",
      data: {
        provider: "nano-banana-pro",
        aspectRatio: "1:1",
        prompt:
          "seamless tileable texture of {material}, top-down flat view, repeating pattern, even lighting, high detail, no visible seams",
        negativePrompt: "perspective, seams, lighting gradient, watermark, text",
      },
    },
    {
      id: "generate-image/seamless-pattern",
      name: "Seamless Pattern",
      description: "Tileable decorative motif.",
      group: "Icons, Game Assets & Textures",
      data: {
        provider: "ideogram-v3",
        aspectRatio: "1:1",
        prompt:
          "seamless repeating decorative pattern with {motif}, flat colors, tileable, balanced composition",
        negativePrompt: "seams, photorealistic, watermark, text",
      },
    },
    {
      id: "generate-image/emoji-set",
      name: "Emoji / Reaction Set",
      description: "Glossy 3D emoji variations.",
      group: "Icons, Game Assets & Textures",
      data: {
        provider: "nano-banana-pro",
        aspectRatio: "1:1",
        prompt:
          "set of glossy 3D emoji-style icons of {subject}, multiple expressions, consistent style, plain background",
        negativePrompt: "inconsistent style, lowres, watermark, text",
      },
    },
    {
      id: "generate-image/pixel-sprite",
      name: "Pixel Sprite",
      description: "Game-ready pixel sprite.",
      group: "Icons, Game Assets & Textures",
      data: {
        provider: "nano-banana-pro",
        aspectRatio: "1:1",
        style: "pixel-art",
        prompt: "pixel art game sprite of {character or item}, clean pixels, game asset, plain background",
        negativePrompt: "smooth, antialiased, blur, watermark",
      },
    },

    // ── More Photography & Cinematic ─────────────────────────────────────────
    {
      id: "generate-image/silhouette",
      name: "Silhouette",
      description: "Backlit subject, dramatic sky.",
      group: "Photography & Cinematic",
      data: { provider: "nano-banana-pro", aspectRatio: "16:9", prompt: "dramatic silhouette of {subject} backlit against a vivid sunset sky, high contrast, minimal detail, glowing rim light", negativePrompt: "flat lighting, lowres, watermark" },
    },
    {
      id: "generate-image/long-exposure",
      name: "Long Exposure",
      description: "Silky motion, light trails.",
      group: "Photography & Cinematic",
      data: { provider: "seedream", aspectRatio: "16:9", prompt: "long-exposure photograph of {scene}, silky smooth motion blur, light trails, glassy water, tripod-steady, blue hour", negativePrompt: "noise, lowres, watermark" },
    },
    {
      id: "generate-image/tilt-shift",
      name: "Tilt-Shift Miniature",
      description: "Fake-miniature selective blur.",
      group: "Photography & Cinematic",
      data: { provider: "nano-banana-pro", aspectRatio: "16:9", prompt: "tilt-shift miniature photograph of {scene}, selective focus, toy-like miniature effect, high saturation, elevated angle", negativePrompt: "lowres, watermark" },
    },

    // ── More Product & Commerce ──────────────────────────────────────────────
    {
      id: "generate-image/knolling",
      name: "Knolling Flat-Lay",
      description: "Objects arranged at 90°.",
      group: "Product & Commerce",
      data: { provider: "nano-banana-pro", aspectRatio: "1:1", prompt: "knolling flat-lay of {items}, objects neatly arranged at 90-degree angles, evenly spaced, top-down, clean background, soft shadows", negativePrompt: "cluttered, messy, watermark" },
    },
    {
      id: "generate-image/ghost-mannequin",
      name: "Ghost-Mannequin Apparel",
      description: "Invisible-mannequin clothing shot.",
      group: "Product & Commerce",
      data: { provider: "nano-banana-pro", aspectRatio: "4:5", prompt: "ghost mannequin product photo of {garment}, invisible-mannequin hollow 3D effect, clean white background, even studio lighting, e-commerce", negativePrompt: "visible mannequin, person, wrinkles, watermark" },
    },

    // ── More Illustration & Art Styles ───────────────────────────────────────
    {
      id: "generate-image/double-exposure",
      name: "Double Exposure",
      description: "Silhouette filled with a 2nd scene.",
      group: "Illustration & Art Styles",
      data: { provider: "seedream", aspectRatio: "2:3", prompt: "double exposure of {subject} silhouette blended with {secondary scene}, artistic overlay, high contrast", negativePrompt: "muddy, lowres, watermark" },
    },
    {
      id: "generate-image/vaporwave",
      name: "Vaporwave",
      description: "80s neon pastel aesthetic.",
      group: "Illustration & Art Styles",
      data: { provider: "nano-banana-pro", aspectRatio: "16:9", style: "vaporwave", prompt: "{subject}", negativePrompt: "lowres, watermark" },
    },
    {
      id: "generate-image/cyberpunk-scene",
      name: "Cyberpunk Scene",
      description: "Neon-lit dystopian night.",
      group: "Illustration & Art Styles",
      data: { provider: "nano-banana-pro", aspectRatio: "16:9", style: "cyberpunk", prompt: "{scene}, neon-lit rainy night", negativePrompt: "lowres, watermark" },
    },
    {
      id: "generate-image/pop-art",
      name: "Pop Art",
      description: "Bold Warhol/Lichtenstein graphic.",
      group: "Illustration & Art Styles",
      data: { provider: "ideogram-v3", aspectRatio: "1:1", style: "pop-art", prompt: "{subject}", negativePrompt: "muted colors, lowres, watermark" },
    },
    {
      id: "generate-image/low-poly",
      name: "Low Poly",
      description: "Faceted geometric 3D.",
      group: "Illustration & Art Styles",
      data: { provider: "nano-banana-pro", aspectRatio: "1:1", style: "low-poly", prompt: "{subject}", negativePrompt: "smooth, lowres, watermark" },
    },
    {
      id: "generate-image/paper-cut",
      name: "Paper Cut",
      description: "Layered cut-paper craft.",
      group: "Illustration & Art Styles",
      data: { provider: "nano-banana-pro", aspectRatio: "1:1", style: "paper-cutout", prompt: "{subject}", negativePrompt: "flat, lowres, watermark" },
    },
    {
      id: "generate-image/stained-glass",
      name: "Stained Glass",
      description: "Leaded colored-glass mosaic.",
      group: "Illustration & Art Styles",
      data: { provider: "nano-banana-pro", aspectRatio: "2:3", style: "stained-glass", prompt: "{subject}", negativePrompt: "lowres, watermark" },
    },

    // ── Diagrams & Infographics ──────────────────────────────────────────────
    {
      id: "generate-image/blueprint",
      name: "Blueprint Schematic",
      description: "White-on-blue technical drawing.",
      group: "Diagrams & Infographics",
      data: { provider: "ideogram-v3", aspectRatio: "4:3", style: "blueprint", prompt: "technical blueprint schematic of {subject}, white line work on blue paper, dimension lines and callout labels", negativePrompt: "photorealistic, lowres, watermark" },
    },
    {
      id: "generate-image/infographic",
      name: "Infographic",
      description: "Icons + labels data layout.",
      group: "Diagrams & Infographics",
      data: { provider: "ideogram-v3", aspectRatio: "4:3", prompt: "clean modern infographic about {topic}, simple icons, short labels, data-visualization layout, flat design, clear hierarchy", negativePrompt: "cluttered, misspelled text, lowres, watermark" },
    },
    {
      id: "generate-image/ui-mockup",
      name: "UI / App Mockup",
      description: "Clean app/website screen design.",
      group: "Diagrams & Infographics",
      data: { provider: "gpt-image-2", aspectRatio: "16:9", prompt: "modern UI design mockup of {app or website screen}, clean interface, cards and buttons, realistic legible text, polished product design", negativePrompt: "cluttered, gibberish text, lowres, watermark" },
    },
    {
      id: "generate-image/flowchart",
      name: "Flowchart / Diagram",
      description: "Boxes, arrows, labels.",
      group: "Diagrams & Infographics",
      data: { provider: "ideogram-v3", aspectRatio: "16:9", prompt: "clean flowchart diagram of {process}, labeled boxes connected by arrows, clear hierarchy, flat modern design", negativePrompt: "cluttered, misspelled text, lowres, watermark" },
    },
    {
      id: "generate-image/chart-graph",
      name: "Chart / Graph",
      description: "Bar / line / pie data viz.",
      group: "Diagrams & Infographics",
      data: { provider: "ideogram-v3", aspectRatio: "4:3", prompt: "clean data-visualization chart of {data}, {bar, line or pie} graph, labeled axes and legend, flat modern design", negativePrompt: "cluttered, misspelled text, lowres, watermark" },
    },
    {
      id: "generate-image/timeline",
      name: "Timeline",
      description: "Milestones along an axis.",
      group: "Diagrams & Infographics",
      data: { provider: "ideogram-v3", aspectRatio: "16:9", prompt: "timeline infographic of {topic}, milestones along a line with dates, icons and short labels, flat modern design", negativePrompt: "cluttered, misspelled text, lowres, watermark" },
    },
    {
      id: "generate-image/x-ray",
      name: "X-Ray / See-Through",
      description: "Internal-structure radiograph look.",
      group: "Illustration & Art Styles",
      data: { provider: "nano-banana-pro", aspectRatio: "4:3", prompt: "x-ray style see-through render of {subject}, internal structure visible, glowing white-on-dark radiograph aesthetic", negativePrompt: "opaque, lowres, watermark" },
    },

    // ── More Icons, Game Assets & Textures ───────────────────────────────────
    {
      id: "generate-image/3d-icon",
      name: "3D Icon",
      description: "Glossy single 3D-rendered icon.",
      group: "Icons, Game Assets & Textures",
      data: { provider: "nano-banana-pro", aspectRatio: "1:1", prompt: "single glossy 3D rendered icon of {subject}, soft studio lighting, rounded clay-like form, vibrant, isolated on a plain background", negativePrompt: "flat, 2d, cluttered, watermark" },
    },

    // ── More Architecture & Interiors ────────────────────────────────────────
    {
      id: "generate-image/floor-plan",
      name: "Floor Plan",
      description: "Top-down labeled layout.",
      group: "Architecture & Interiors",
      data: { provider: "ideogram-v3", aspectRatio: "1:1", prompt: "top-down architectural floor plan of {space}, clean line work, room labels, furniture layout, scale bar, blueprint style", negativePrompt: "perspective, photorealistic, lowres, watermark" },
    },
    {
      id: "generate-image/aerial-site",
      name: "Aerial Site View",
      description: "Drone view of building + context.",
      group: "Architecture & Interiors",
      data: { provider: "seedream", aspectRatio: "16:9", prompt: "aerial architectural site view of {building}, drone perspective showing surrounding context and landscaping, photorealistic, golden hour", negativePrompt: "distorted geometry, lowres, watermark" },
    },

    // ── Portrait Transformations (identity-locked, from a connected reference photo) ──
    // Like Stylized Subject, these are TRANSFORM presets: connect a clean front-facing
    // reference portrait and nano-banana-pro rebuilds it. The "Timeless Soul" age
    // progression renders ONE person at several ages in a single studio composite — the
    // whole effect rides on the identity-lock clause (same eyes/brow/nose/ears/bone
    // structure), so it stays one person aging rather than several different people.
    {
      id: "generate-image/age-progression-5",
      name: "Five Ages (Timeless Soul)",
      description: "One person at 5 ages, studio line-up. Needs a reference photo.",
      group: "Portrait Transformations",
      data: {
        provider: "nano-banana-pro",
        aspectRatio: "3:4",
        prompt:
          "Generate a single photorealistic studio composite of the person in the reference image at five stages of life, lined up shoulder-to-shoulder from left to right in a smooth age progression: a child around 7, a teenager around 15, a young adult around 27, a mature adult around 45, and an elder around 70. Frame each figure from the chest up, all facing the camera with the same calm expression. Strictly preserve identity across all five figures — identical eye shape, eye color, brow line, nose, ear shape, and facial bone structure from the reference — aged ONLY via skin texture, fine lines and wrinkles, hairline, hair color (darker in youth, gradually greying with age), and slight changes in facial fullness. Dress each figure for its age: striped tee for the child, hoodie or denim jacket for the teen, casual shirt for the young adult, blazer or button-up for the mature adult, soft cardigan for the elder. Even soft cinematic studio key light hitting all five consistently, gentle rim separation from the background, clean dark-grey gradient seamless backdrop (slightly darker at the edges, softly lit toward the center). High-end editorial portrait photography, sharp facial detail, natural skin tones; the five figures fill the frame.",
        negativePrompt: "five different people, inconsistent identity, deformed, extra fingers, watermark, text",
      },
    },
    {
      id: "generate-image/age-progression-3",
      name: "Three-Age Triptych",
      description: "Same person at 3 ages (~10 / 40 / 75). Needs a reference photo.",
      group: "Portrait Transformations",
      data: {
        provider: "nano-banana-pro",
        aspectRatio: "3:4",
        prompt:
          "Generate a single photorealistic studio composite of the person in the reference image at three stages of life, shoulder-to-shoulder from left to right: around age 10, around age 40, and around age 75. Frame each figure from the chest up, facing the camera with the same calm expression. Strictly preserve identity across all three — identical eye shape, eye color, brow line, nose, ear shape, and facial bone structure from the reference — aged ONLY via skin texture, fine lines, hairline, hair color (darker in youth, greying with age), and slight facial fullness. Age-appropriate clothing for each stage. Even soft cinematic studio key light, clean dark-grey gradient seamless backdrop, high-end editorial portrait photography, sharp facial detail, natural skin tones; the three figures fill the frame.",
        negativePrompt: "three different people, inconsistent identity, deformed, watermark, text",
      },
    },
    {
      id: "generate-image/age-progression-bw",
      name: "Five Ages — B&W",
      description: "Monochrome age line-up. Needs a reference photo.",
      group: "Portrait Transformations",
      data: {
        provider: "nano-banana-pro",
        aspectRatio: "3:4",
        prompt:
          "Generate a single black-and-white photorealistic studio composite of the person in the reference image at five stages of life, shoulder-to-shoulder from left to right in a smooth age progression: around 7, 15, 27, 45, and 70. Chest-up framing, all facing the camera with the same calm expression. Strictly preserve identity across all five figures — identical eye shape, eye color, brow line, nose, ear shape, and facial bone structure from the reference — aged ONLY via skin texture, fine lines, hairline, greying hair, and slight facial fullness. Age-appropriate clothing per stage. Even soft studio key light, clean dark-grey gradient backdrop. Monochrome high-end black-and-white studio portrait, deep tonal range, fine film grain, sharp facial detail; the five figures fill the frame.",
        negativePrompt: "color, five different people, inconsistent identity, deformed, watermark, text",
      },
    },
    {
      id: "generate-image/decade-timeline",
      name: "Decade Timeline",
      description: "Same person across the '80s–2020s. Needs a reference photo.",
      group: "Portrait Transformations",
      data: {
        provider: "nano-banana-pro",
        aspectRatio: "3:4",
        prompt:
          "Generate a single photorealistic studio composite of the person in the reference image across five decades, shoulder-to-shoulder from left to right with a smooth age progression and period-accurate styling: a 1980s child, a 1990s teenager, a 2000s young adult, a 2010s adult, and a 2020s mature adult. Chest-up framing, all facing the camera with the same calm expression. Strictly preserve identity across all five figures — identical eye shape, eye color, brow line, nose, ear shape, and facial bone structure from the reference — aged ONLY via skin texture, fine lines, hairline, hair color, and slight facial fullness. Style each figure to its decade in hair and wardrobe: 1980s bright bold colors and big hair, 1990s casual grunge, 2000s frosted-tips and low-rise era, 2010s clean modern, 2020s contemporary. Subtle period-accurate photo treatment per decade. Even soft studio key light, clean dark-grey gradient seamless backdrop. High-end editorial portrait photography, sharp facial detail, natural skin tones; the five figures fill the frame.",
        negativePrompt: "different people, inconsistent identity, deformed, watermark, text",
      },
    },
    {
      id: "generate-image/four-seasons",
      name: "Four Seasons",
      description: "Same person in spring / summer / autumn / winter. Needs a reference photo.",
      group: "Portrait Transformations",
      data: {
        provider: "nano-banana-pro",
        aspectRatio: "3:4",
        prompt:
          "Generate a single photorealistic studio composite of the person in the reference image in four seasonal looks, shoulder-to-shoulder from left to right: spring, summer, autumn, and winter. Chest-up framing, all facing the camera with the same calm expression, all at the SAME age as the reference (this is seasons, not aging). Strictly preserve identity across all four figures — identical face, eye shape, eye color, brow, nose, ear shape, and bone structure from the reference; only wardrobe, hair styling, and a subtle seasonal color grade change. Spring: light pastel layers, fresh airy tone. Summer: light tee, warm sunny tone. Autumn: knit sweater, golden amber tone. Winter: coat and scarf, cool crisp tone. Even soft studio key light with a gentle seasonal color cast per figure, clean dark-grey gradient seamless backdrop. High-end editorial portrait photography, sharp facial detail, natural skin tones; the four figures fill the frame.",
        negativePrompt: "different people, inconsistent identity, aging, deformed, watermark, text",
      },
    },
    {
      id: "generate-image/times-of-day",
      name: "Times of Day",
      description: "Same person at dawn / midday / golden hour / night. Needs a reference photo.",
      group: "Portrait Transformations",
      data: {
        provider: "nano-banana-pro",
        aspectRatio: "3:4",
        prompt:
          "Generate a single photorealistic composite of the person in the reference image across four times of day, shoulder-to-shoulder from left to right: dawn, midday, golden hour, and night. Chest-up framing, all facing the camera with the same calm expression, all at the SAME age as the reference. Strictly preserve identity across all four figures — identical face, eye shape, eye color, brow, nose, ear shape, and bone structure from the reference; only the lighting and color temperature change between figures. Dawn: soft cool blue light. Midday: bright neutral daylight. Golden hour: warm amber backlight with a gentle glow. Night: moody low light with a cool rim. Consistent chest-up framing and a clean dark-grey gradient seamless backdrop. High-end editorial portrait photography, sharp facial detail, natural skin tones; the four figures fill the frame.",
        negativePrompt: "different people, inconsistent identity, aging, deformed, watermark, text",
      },
    },
    // ── Stylized Subject + Edits (shared with the deprecating modify-image) ──
    // Transform patterns — work here when a reference image is connected
    // (nano-banana-pro edits it while preserving untouched regions). The
    // instruction lives in the prompt, not `style`.
    ...stylizedSubjectFor("generate-image"),
    ...editsFor("generate-image"),
  ],

  // modify-image shares the Stylized Subject + Edits catalogs with generate-image
  // (single source of truth in STYLIZED_SUBJECT / IMAGE_EDITS). modify-image is
  // slated for deprecation in favor of generate-image — when removed, drop this key.
  "modify-image": [...stylizedSubjectFor("modify-image"), ...editsFor("modify-image")],
  "generate-video": [
    // ── Camera Moves (composable cinematography fragments) ───────────────────
    {
      id: "generate-video/slow-push-in",
      name: "Slow Push-In",
      description: "Gradual dolly toward the subject.",
      group: "Camera Moves",
      data: {
        provider: "veo3.1",
        aspectRatio: "16:9",
        duration: 8,
        prompt: "slow cinematic push-in toward {subject}, gradual forward dolly, shallow depth of field, smooth steady motion",
      },
    },
    {
      id: "generate-video/dolly-out",
      name: "Dolly Out (reveal)",
      description: "Pull back to reveal the scene.",
      group: "Camera Moves",
      data: {
        provider: "veo3.1",
        aspectRatio: "16:9",
        duration: 8,
        prompt: "smooth dolly-out pulling back from {subject}, revealing the surrounding {environment}, cinematic reveal",
      },
    },
    {
      id: "generate-video/orbit-360",
      name: "360° Orbit",
      description: "Camera circles the subject.",
      group: "Camera Moves",
      data: {
        provider: "kling-3.0",
        aspectRatio: "16:9",
        duration: 5,
        prompt: "camera orbits 360 degrees around {subject}, smooth circular tracking shot, dynamic parallax reveal, cinematic",
      },
    },
    {
      id: "generate-video/arc-shot",
      name: "Arc Shot",
      description: "Sweeping lateral arc.",
      group: "Camera Moves",
      data: {
        provider: "kling-3.0",
        aspectRatio: "16:9",
        duration: 5,
        prompt: "sweeping arc shot moving laterally around {subject}, smooth parallax, cinematic",
      },
    },
    {
      id: "generate-video/crane-up",
      name: "Crane Up",
      description: "Rise up and over to reveal scale.",
      group: "Camera Moves",
      data: {
        provider: "veo3.1",
        aspectRatio: "16:9",
        duration: 8,
        prompt: "cinematic crane shot rising up and over {subject}, revealing the wider {scene}, smooth vertical motion",
      },
    },
    {
      id: "generate-video/tracking-follow",
      name: "Tracking Follow",
      description: "Follow the subject from behind.",
      group: "Camera Moves",
      data: {
        provider: "kling-3.0",
        aspectRatio: "16:9",
        duration: 5,
        prompt: "tracking shot following {subject} from behind, steady gimbal motion, immersive",
      },
    },
    {
      id: "generate-video/slow-pan",
      name: "Slow Pan",
      description: "Horizontal sweep across the scene.",
      group: "Camera Moves",
      data: {
        provider: "veo3.1",
        aspectRatio: "16:9",
        duration: 8,
        prompt: "slow cinematic pan across {scene}, smooth horizontal sweep, gradually revealing detail",
      },
    },
    {
      id: "generate-video/tilt-reveal",
      name: "Tilt-Up Reveal",
      description: "Vertical reveal from base to top.",
      group: "Camera Moves",
      data: {
        provider: "veo3.1",
        aspectRatio: "16:9",
        duration: 8,
        prompt: "vertical tilt-up reveal of {subject}, from base to top, dramatic sense of scale, cinematic",
      },
    },
    {
      id: "generate-video/whip-pan",
      name: "Whip Pan",
      description: "Fast energetic transition.",
      group: "Camera Moves",
      data: {
        provider: "kling-3.0",
        aspectRatio: "16:9",
        duration: 5,
        prompt: "fast whip pan revealing {subject}, heavy motion blur, energetic transition",
      },
    },
    {
      id: "generate-video/dolly-zoom",
      name: "Dolly Zoom (Vertigo)",
      description: "Background warps, subject fixed.",
      group: "Camera Moves",
      data: {
        provider: "kling-3.0",
        aspectRatio: "16:9",
        duration: 5,
        prompt: "dolly zoom Vertigo effect on {subject}, background warps while the subject stays fixed, unsettling cinematic tension",
      },
    },

    // ── Shot Types & Angles ──────────────────────────────────────────────────
    {
      id: "generate-video/establishing-wide",
      name: "Establishing Wide",
      description: "Vast opening shot with scale.",
      group: "Shot Types & Angles",
      data: {
        provider: "veo3.1",
        aspectRatio: "16:9",
        duration: 8,
        prompt: "establishing wide shot of {location}, vast sense of scale, slow gentle camera drift, cinematic",
      },
    },
    {
      id: "generate-video/medium-shot",
      name: "Medium Shot",
      description: "Balanced waist-up framing.",
      group: "Shot Types & Angles",
      data: {
        provider: "veo3.1",
        aspectRatio: "16:9",
        duration: 8,
        prompt: "medium shot of {subject}, balanced framing, natural subtle movement, cinematic",
      },
    },
    {
      id: "generate-video/close-up",
      name: "Close-Up",
      description: "Intimate, shallow focus.",
      group: "Shot Types & Angles",
      data: {
        provider: "veo3.1",
        aspectRatio: "16:9",
        duration: 8,
        prompt: "intimate close-up of {subject}, shallow depth of field, subtle motion, emotional",
      },
    },
    {
      id: "generate-video/macro-detail",
      name: "Macro Detail",
      description: "Extreme close-up reveal.",
      group: "Shot Types & Angles",
      data: {
        provider: "kling-3.0",
        aspectRatio: "16:9",
        duration: 5,
        prompt: "extreme macro shot of {subject}, ultra-close detail, slow reveal, shallow focus",
      },
    },
    {
      id: "generate-video/low-angle-hero",
      name: "Low-Angle Hero",
      description: "Looking up — powerful, imposing.",
      group: "Shot Types & Angles",
      data: {
        provider: "veo3.1",
        aspectRatio: "16:9",
        duration: 8,
        prompt: "dramatic low-angle hero shot of {subject}, camera looking up, powerful and imposing, cinematic",
      },
    },
    {
      id: "generate-video/overhead-topdown",
      name: "Overhead Top-Down",
      description: "Bird's-eye with slow rotation.",
      group: "Shot Types & Angles",
      data: {
        provider: "kling-3.0",
        aspectRatio: "16:9",
        duration: 5,
        prompt: "overhead top-down shot of {scene}, bird's-eye perspective, slow rotation",
      },
    },
    {
      id: "generate-video/fpv-drone",
      name: "FPV Drone Flythrough",
      description: "Immersive first-person flight.",
      group: "Shot Types & Angles",
      data: {
        provider: "kling-3.0",
        aspectRatio: "16:9",
        duration: 5,
        prompt: "fast FPV drone flythrough of {location}, immersive first-person flight, dynamic and smooth",
      },
    },

    // ── Cinematic & Specialty ────────────────────────────────────────────────
    {
      id: "generate-video/handheld-doc",
      name: "Handheld Documentary",
      description: "Raw, realistic camera shake.",
      group: "Cinematic & Specialty",
      data: {
        provider: "wan-2.7-t2v",
        aspectRatio: "16:9",
        duration: 5,
        prompt: "handheld documentary shot of {subject}, natural camera shake, realistic and raw, available light",
      },
    },
    {
      id: "generate-video/slow-motion",
      name: "Slow Motion",
      description: "High-frame-rate dramatic movement.",
      group: "Cinematic & Specialty",
      data: {
        provider: "kling-3.0",
        aspectRatio: "16:9",
        duration: 5,
        prompt: "epic slow-motion shot of {subject}, high frame rate, fluid dramatic movement",
      },
    },
    {
      id: "generate-video/timelapse",
      name: "Timelapse",
      description: "Fast passage of time.",
      group: "Cinematic & Specialty",
      data: {
        provider: "kling-3.0",
        aspectRatio: "16:9",
        duration: 5,
        prompt: "timelapse of {scene}, fast-moving clouds and shifting light, dynamic passage of time",
      },
    },
    {
      id: "generate-video/hyperlapse",
      name: "Hyperlapse",
      description: "Moving timelapse through space.",
      group: "Cinematic & Specialty",
      data: {
        provider: "kling-3.0",
        aspectRatio: "16:9",
        duration: 5,
        prompt: "hyperlapse moving through {location}, fast smooth motion, dynamic perspective shift",
      },
    },
    {
      id: "generate-video/bullet-time",
      name: "Bullet Time",
      description: "Frozen moment, camera rotates.",
      group: "Cinematic & Specialty",
      data: {
        provider: "kling-3.0",
        aspectRatio: "16:9",
        duration: 5,
        prompt: "bullet-time effect, frozen moment around {subject} while the camera rotates, action suspended in mid-air",
      },
    },
    {
      id: "generate-video/rack-focus",
      name: "Rack Focus",
      description: "Shift focus between planes.",
      group: "Cinematic & Specialty",
      data: {
        provider: "veo3.1",
        aspectRatio: "16:9",
        duration: 8,
        prompt: "rack focus shifting from a foreground {subject} to the background {target}, cinematic depth, shallow focus",
      },
    },

    // ── Social & Reels (9:16) ────────────────────────────────────────────────
    {
      id: "generate-video/vertical-hero",
      name: "Vertical Hero",
      description: "Punchy 9:16 hero clip.",
      group: "Social & Reels",
      data: {
        provider: "veo3.1",
        aspectRatio: "9:16",
        duration: 8,
        prompt: "cinematic hero shot of {subject}, dynamic motion, punchy and eye-catching, optimized for social reels",
      },
    },
    {
      id: "generate-video/talking-head",
      name: "Talking Head",
      description: "Vertical creator-to-camera.",
      group: "Social & Reels",
      data: {
        provider: "veo3.1",
        aspectRatio: "9:16",
        duration: 8,
        prompt: "talking-head shot of {subject} speaking to the camera, clean background, natural movement and expression",
      },
    },
    {
      id: "generate-video/product-reveal-vertical",
      name: "Product Reveal (vertical)",
      description: "9:16 product show-off.",
      group: "Social & Reels",
      data: {
        provider: "seedance-2-fast",
        aspectRatio: "9:16",
        duration: 5,
        prompt: "product reveal of {product}, dynamic rotation and pop, eye-catching, social-ready",
      },
    },
    {
      id: "generate-video/trend-quickcut",
      name: "Trend Quick-Cut",
      description: "Energetic vertical clip.",
      group: "Social & Reels",
      data: {
        provider: "seedance-2-fast",
        aspectRatio: "9:16",
        duration: 5,
        prompt: "energetic clip of {subject}, fast dynamic motion, trendy and high-energy social video",
      },
    },
    {
      id: "generate-video/pov-vertical",
      name: "POV Walk (vertical)",
      description: "Immersive first-person reel.",
      group: "Social & Reels",
      data: {
        provider: "kling-3.0",
        aspectRatio: "9:16",
        duration: 5,
        prompt: "POV shot walking through {location}, immersive first-person, handheld feel",
      },
    },

    // ── Product & Ads ────────────────────────────────────────────────────────
    {
      id: "generate-video/product-hero",
      name: "Product Hero",
      description: "Filmic handheld ad close-up.",
      group: "Product & Ads",
      data: {
        provider: "veo3.1",
        aspectRatio: "16:9",
        duration: 8,
        prompt: "slow handheld close-up of {product} on {surface}, soft window light, shallow depth of field, soft filmic grade, subtle motion — product hero shot for an ad",
      },
    },
    {
      id: "generate-video/product-spin",
      name: "Product 360 Spin",
      description: "Clean rotating studio loop.",
      group: "Product & Ads",
      data: {
        provider: "seedance-2-fast",
        aspectRatio: "1:1",
        duration: 5,
        prompt: "{product} slowly rotating 360 degrees on a clean studio surface, even lighting, seamless spin",
      },
    },
    {
      id: "generate-video/liquid-splash",
      name: "Liquid Splash",
      description: "Slow-mo commercial splash.",
      group: "Product & Ads",
      data: {
        provider: "kling-3.0",
        aspectRatio: "16:9",
        duration: 5,
        prompt: "dramatic slow-motion liquid splash around {product}, dynamic droplets frozen in motion, premium commercial look",
      },
    },
    {
      id: "generate-video/unboxing",
      name: "Unboxing",
      description: "Cinematic reveal of the package.",
      group: "Product & Ads",
      data: {
        provider: "veo3.1",
        aspectRatio: "16:9",
        duration: 8,
        prompt: "cinematic unboxing of {product}, hands opening the package, soft light, sense of anticipation",
      },
    },
    {
      id: "generate-video/lifestyle-ad",
      name: "Lifestyle Ad",
      description: "Aspirational product-in-use.",
      group: "Product & Ads",
      data: {
        provider: "veo3.1",
        aspectRatio: "9:16",
        duration: 8,
        prompt: "lifestyle ad clip: {subject} using {product} in {setting}, natural light, aspirational and warm, social-ready",
      },
    },

    // ── Motion Graphics & Logo ───────────────────────────────────────────────
    {
      id: "generate-video/logo-sting",
      name: "Logo Sting",
      description: "Short punchy brand reveal.",
      group: "Motion Graphics & Logo",
      data: {
        provider: "kling-3.0",
        aspectRatio: "16:9",
        duration: 5,
        prompt: "animated logo sting: {BRAND} logo assembles with light streaks and a clean reveal, short and punchy, on a solid background",
      },
    },
    {
      id: "generate-video/title-reveal",
      name: "Title Reveal",
      description: "Cinematic text reveal.",
      group: "Motion Graphics & Logo",
      data: {
        provider: "veo3.1",
        aspectRatio: "16:9",
        duration: 8,
        prompt: "cinematic title reveal: the text '{TITLE}' emerges with dramatic lighting, particles and depth",
      },
    },
    {
      id: "generate-video/particle-bg",
      name: "Particle Background",
      description: "Abstract drifting overlay.",
      group: "Motion Graphics & Logo",
      data: {
        provider: "runway-kie",
        aspectRatio: "16:9",
        duration: 5,
        prompt: "abstract flowing particle background, {color} gradient, gentle drifting motion, seamless, for overlays",
      },
    },
    {
      id: "generate-video/loop-background",
      name: "Loop Background",
      description: "Seamless looping motion bg.",
      group: "Motion Graphics & Logo",
      data: {
        provider: "runway-kie",
        aspectRatio: "16:9",
        duration: 5,
        prompt: "seamless looping abstract background, {color} gradient waves, slow hypnotic motion that returns to the start",
      },
    },

    // ── B-Roll & Nature ──────────────────────────────────────────────────────
    {
      id: "generate-video/clouds-timelapse",
      name: "Clouds Timelapse",
      description: "Dramatic rolling sky.",
      group: "B-Roll & Nature",
      data: {
        provider: "runway-kie",
        aspectRatio: "16:9",
        duration: 5,
        prompt: "timelapse of dramatic clouds rolling over {landscape}, golden light, dynamic sky",
      },
    },
    {
      id: "generate-video/water-slowmo",
      name: "Water Slow-Mo",
      description: "Glistening water in slow motion.",
      group: "B-Roll & Nature",
      data: {
        provider: "kling-3.0",
        aspectRatio: "16:9",
        duration: 5,
        prompt: "slow-motion close-up of {water}, glistening droplets, serene and mesmerizing",
      },
    },
    {
      id: "generate-video/forest-drift",
      name: "Forest Drift",
      description: "Peaceful sunlit drift.",
      group: "B-Roll & Nature",
      data: {
        provider: "runway-kie",
        aspectRatio: "16:9",
        duration: 5,
        prompt: "gentle drift through a sunlit forest, light rays streaming through the trees, peaceful b-roll",
      },
    },
    {
      id: "generate-video/aerial-landscape",
      name: "Aerial Landscape",
      description: "Sweeping drone vista.",
      group: "B-Roll & Nature",
      data: {
        provider: "veo3.1",
        aspectRatio: "16:9",
        duration: 8,
        prompt: "sweeping aerial shot over {landscape}, vast cinematic vista, smooth drone motion",
      },
    },
    {
      id: "generate-video/ocean-loop",
      name: "Ocean Loop",
      description: "Calm seamless waves.",
      group: "B-Roll & Nature",
      data: {
        provider: "runway-kie",
        aspectRatio: "16:9",
        duration: 5,
        prompt: "calm ocean waves rolling gently toward shore, seamless loop, serene ambient b-roll",
      },
    },

    // ── Animation & Style ────────────────────────────────────────────────────
    {
      id: "generate-video/anime-motion",
      name: "Anime Motion",
      description: "Cel-shaded animated scene.",
      group: "Animation & Style",
      data: {
        provider: "kling-3.0",
        aspectRatio: "16:9",
        duration: 5,
        prompt: "anime-style animated scene of {subject}, cel-shaded, dynamic motion, vibrant colors",
      },
    },
    {
      id: "generate-video/cartoon-3d",
      name: "3D Cartoon",
      description: "Playful Pixar-like motion.",
      group: "Animation & Style",
      data: {
        provider: "kling-3.0",
        aspectRatio: "16:9",
        duration: 5,
        prompt: "3D animated cartoon scene of {subject}, polished Pixar-like rendering, playful motion",
      },
    },
    {
      id: "generate-video/claymation-move",
      name: "Claymation",
      description: "Tactile stop-motion feel.",
      group: "Animation & Style",
      data: {
        provider: "kling-3.0",
        aspectRatio: "16:9",
        duration: 5,
        prompt: "claymation stop-motion style animation of {subject}, tactile clay texture, charming handcrafted motion",
      },
    },
    {
      id: "generate-video/watercolor-motion",
      name: "Living Watercolor",
      description: "Flowing painterly motion.",
      group: "Animation & Style",
      data: {
        provider: "kling-3.0",
        aspectRatio: "16:9",
        duration: 5,
        prompt: "living watercolor painting of {scene}, flowing painterly motion, soft bleeding colors",
      },
    },

    // ── Looping & Backgrounds ────────────────────────────────────────────────
    {
      id: "generate-video/subtle-motion",
      name: "Subtle Motion",
      description: "Gentle, natural movement (great for animating a still).",
      group: "Looping & Backgrounds",
      data: {
        provider: "seedance-2-fast",
        aspectRatio: "16:9",
        duration: 5,
        prompt: "subtle natural motion, gentle camera drift, cinematic",
      },
    },
    {
      id: "generate-video/living-wallpaper",
      name: "Living Wallpaper",
      description: "Ambient looping scene.",
      group: "Looping & Backgrounds",
      data: {
        provider: "runway-kie",
        aspectRatio: "16:9",
        duration: 5,
        prompt: "living wallpaper: {scene} with subtle ambient motion, calm and hypnotic, seamless loop",
      },
    },
    {
      id: "generate-video/parallax",
      name: "Parallax (2.5D)",
      description: "Depth move over a still.",
      group: "Looping & Backgrounds",
      data: { provider: "kling-3.0", aspectRatio: "16:9", duration: 5, prompt: "2.5D parallax camera move over {scene}, layered depth, subtle motion bringing a still image to life" },
    },
    {
      id: "generate-video/cinemagraph",
      name: "Cinemagraph",
      description: "Mostly still, one moving element.",
      group: "Looping & Backgrounds",
      data: { provider: "kling-3.0", aspectRatio: "16:9", duration: 5, prompt: "cinemagraph of {scene}, mostly frozen with one element in subtle motion ({moving element}), seamless loop" },
    },
    {
      id: "generate-video/fire-smoke-loop",
      name: "Fire & Smoke FX",
      description: "Looping embers and smoke.",
      group: "Looping & Backgrounds",
      data: { provider: "kling-3.0", aspectRatio: "16:9", duration: 5, prompt: "looping fire and smoke FX over a dark background, drifting embers, slow rolling smoke, seamless" },
    },
    // additional Camera Moves / Cinematic / Social / Product / Motion-graphics / B-roll
    {
      id: "generate-video/crash-zoom",
      name: "Crash Zoom",
      description: "Sudden energetic punch-in.",
      group: "Camera Moves",
      data: { provider: "kling-3.0", aspectRatio: "16:9", duration: 5, prompt: "rapid crash zoom punching in toward {subject}, sudden energetic push-in, motion blur" },
    },
    {
      id: "generate-video/slowmo-reveal",
      name: "Slow-Mo Reveal",
      description: "Speed-ramped hero slowdown.",
      group: "Cinematic & Specialty",
      data: { provider: "kling-3.0", aspectRatio: "16:9", duration: 5, prompt: "dramatic slow-motion hero reveal of {subject}, speed ramp into smooth slow motion, cinematic" },
    },
    {
      id: "generate-video/match-cut",
      name: "Match Cut / Morph",
      description: "Object A morphs into B.",
      group: "Cinematic & Specialty",
      data: { provider: "kling-3.0", aspectRatio: "16:9", duration: 5, prompt: "seamless match cut morphing {subject A} into {subject B}, smooth transformation transition" },
    },
    {
      id: "generate-video/before-after",
      name: "Before / After Reveal",
      description: "Wipe between two states.",
      group: "Product & Ads",
      data: { provider: "kling-3.0", aspectRatio: "16:9", duration: 5, prompt: "before and after reveal of {subject}, smooth wipe transition from the 'before' state to the 'after' state" },
    },
    {
      id: "generate-video/kinetic-typography",
      name: "Kinetic Typography",
      description: "Words animate in with rhythm.",
      group: "Motion Graphics & Logo",
      data: { provider: "veo3.1", aspectRatio: "16:9", duration: 8, prompt: "kinetic typography animation: the words '{TEXT}' animate in dynamically with motion, rhythm and depth on a clean background" },
    },
    {
      id: "generate-video/fashion-walk",
      name: "Fashion Walk",
      description: "Runway stride, fabric in motion.",
      group: "Social & Reels",
      data: { provider: "kling-3.0", aspectRatio: "9:16", duration: 5, prompt: "fashion runway walk, {model} striding confidently toward camera, fabric flowing in motion, editorial lighting" },
    },
    {
      id: "generate-video/weather-atmosphere",
      name: "Weather Atmosphere",
      description: "Rain / snow / fog rolling in.",
      group: "B-Roll & Nature",
      data: { provider: "runway-kie", aspectRatio: "16:9", duration: 5, prompt: "atmospheric weather rolling into {scene}: {weather}, moody and cinematic" },
    },
  ],
  // Voice-delivery profiles — knob-only (stability / similarityBoost / style in
  // 0-1, speed in 0.7-1.2). They deliberately do NOT pin a voiceId so they layer
  // on top of whatever voice the user picked. ElevenLabs semantics: lower
  // stability = more expressive/variable, higher style = more stylized.
  "text-to-speech": [
    // ── Narration ────────────────────────────────────────────────────────────
    {
      id: "text-to-speech/narrator-calm",
      name: "Calm Narrator",
      description: "Even, measured narration.",
      group: "Narration",
      data: { speed: 1, stability: 0.6, similarityBoost: 0.75, style: 0 },
    },
    {
      id: "text-to-speech/audiobook",
      name: "Audiobook",
      description: "Warm, steady, slightly slower.",
      group: "Narration",
      data: { speed: 0.95, stability: 0.75, similarityBoost: 0.8, style: 0.1 },
    },
    {
      id: "text-to-speech/documentary",
      name: "Documentary",
      description: "Measured delivery with gravitas.",
      group: "Narration",
      data: { speed: 0.95, stability: 0.78, similarityBoost: 0.85, style: 0.25 },
    },
    {
      id: "text-to-speech/news-anchor",
      name: "News Anchor",
      description: "Neutral, authoritative, even pace.",
      group: "Narration",
      data: { speed: 1, stability: 0.7, similarityBoost: 0.8, style: 0.2 },
    },
    {
      id: "text-to-speech/explainer",
      name: "Explainer / Tutorial",
      description: "Clear, friendly, mid-pace.",
      group: "Narration",
      data: { speed: 1, stability: 0.55, similarityBoost: 0.75, style: 0.3 },
    },

    // ── Advertising & Hype ───────────────────────────────────────────────────
    {
      id: "text-to-speech/commercial",
      name: "Commercial Read",
      description: "Energetic, persuasive, punchy.",
      group: "Advertising & Hype",
      data: { speed: 1.05, stability: 0.48, similarityBoost: 0.75, style: 0.6 },
    },
    {
      id: "text-to-speech/hype",
      name: "Hype / High-Energy",
      description: "Fast, excited, dynamic.",
      group: "Advertising & Hype",
      data: { speed: 1.15, stability: 0.25, similarityBoost: 0.7, style: 0.8 },
    },

    // ── Conversational & Calm ────────────────────────────────────────────────
    {
      id: "text-to-speech/podcast-host",
      name: "Podcast Host",
      description: "Natural, casual, conversational.",
      group: "Conversational & Calm",
      data: { speed: 1.05, stability: 0.45, similarityBoost: 0.75, style: 0.4 },
    },
    {
      id: "text-to-speech/character",
      name: "Character / Storyteller",
      description: "Expressive, dramatic range.",
      group: "Conversational & Calm",
      data: { speed: 1, stability: 0.3, similarityBoost: 0.7, style: 0.7 },
    },
    {
      id: "text-to-speech/meditation",
      name: "Meditation / ASMR",
      description: "Very slow, soft, soothing.",
      group: "Conversational & Calm",
      data: { speed: 0.8, stability: 0.85, similarityBoost: 0.75, style: 0 },
    },
  ],

  // Sound-effect / ambience prompts — provider elevenlabs-sfx. Loopable ambiences
  // set loop:true; short one-shots leave it off. duration in 0.5-30, promptInfluence
  // in 0-1 (higher = follow the prompt more literally).
  "text-to-audio": [
    // ── Transitions & Impacts ────────────────────────────────────────────────
    {
      id: "text-to-audio/whoosh",
      name: "Whoosh Transition",
      description: "Fast clean swoosh.",
      group: "Transitions & Impacts",
      data: { provider: "elevenlabs-sfx", duration: 1, promptInfluence: 0.7, prompt: "fast clean whoosh transition swoosh, smooth air movement" },
    },
    {
      id: "text-to-audio/impact-boom",
      name: "Impact / Boom",
      description: "Deep cinematic hit.",
      group: "Transitions & Impacts",
      data: { provider: "elevenlabs-sfx", duration: 2, promptInfluence: 0.7, prompt: "deep cinematic impact boom, powerful sub hit with tail" },
    },
    {
      id: "text-to-audio/riser",
      name: "Riser / Build-Up",
      description: "Rising tension sweep.",
      group: "Transitions & Impacts",
      data: { provider: "elevenlabs-sfx", duration: 4, promptInfluence: 0.6, prompt: "tension riser build-up sweep rising to a peak" },
    },

    // ── Ambiences (loopable) ─────────────────────────────────────────────────
    {
      id: "text-to-audio/rain-ambience",
      name: "Rain Ambience",
      description: "Steady gentle rain.",
      group: "Ambiences (loopable)",
      data: { provider: "elevenlabs-sfx", duration: 22, loop: true, promptInfluence: 0.4, prompt: "steady gentle rain ambience with distant soft thunder" },
    },
    {
      id: "text-to-audio/forest-ambience",
      name: "Forest Ambience",
      description: "Birds and rustling leaves.",
      group: "Ambiences (loopable)",
      data: { provider: "elevenlabs-sfx", duration: 22, loop: true, promptInfluence: 0.4, prompt: "calm forest ambience, birdsong, gentle wind through leaves" },
    },
    {
      id: "text-to-audio/fire-crackle",
      name: "Fire Crackle",
      description: "Cozy fireplace loop.",
      group: "Ambiences (loopable)",
      data: { provider: "elevenlabs-sfx", duration: 22, loop: true, promptInfluence: 0.4, prompt: "cozy fireplace crackling, warm popping embers" },
    },
    {
      id: "text-to-audio/scifi-drone",
      name: "Sci-Fi Drone",
      description: "Ominous ambient hum.",
      group: "Ambiences (loopable)",
      data: { provider: "elevenlabs-sfx", duration: 22, loop: true, promptInfluence: 0.5, prompt: "low sci-fi ambient drone, ominous spaceship hum" },
    },

    // ── UI & Stingers ────────────────────────────────────────────────────────
    {
      id: "text-to-audio/ui-click",
      name: "UI Click / Pop",
      description: "Crisp interface tap.",
      group: "UI & Stingers",
      data: { provider: "elevenlabs-sfx", duration: 1, promptInfluence: 0.8, prompt: "crisp UI click pop, clean modern interface tap" },
    },
    {
      id: "text-to-audio/notification",
      name: "Notification Chime",
      description: "Bright pleasant alert.",
      group: "UI & Stingers",
      data: { provider: "elevenlabs-sfx", duration: 2, promptInfluence: 0.8, prompt: "pleasant bright notification chime, short and clean" },
    },
    {
      id: "text-to-audio/applause",
      name: "Applause / Crowd",
      description: "Enthusiastic cheering.",
      group: "UI & Stingers",
      data: { provider: "elevenlabs-sfx", duration: 5, promptInfluence: 0.6, prompt: "enthusiastic crowd applause and cheering" },
    },
    // ── Foley & Action ───────────────────────────────────────────────────────
    {
      id: "text-to-audio/footsteps",
      name: "Footsteps",
      description: "Walking on a hard floor.",
      group: "Foley & Action",
      data: { provider: "elevenlabs-sfx", duration: 4, promptInfluence: 0.6, prompt: "footsteps walking on a hard wooden floor, steady pace" },
    },
    {
      id: "text-to-audio/door",
      name: "Door Open / Close",
      description: "Creak then shut.",
      group: "Foley & Action",
      data: { provider: "elevenlabs-sfx", duration: 3, promptInfluence: 0.7, prompt: "wooden door slowly creaking open then closing with a soft latch" },
    },
    {
      id: "text-to-audio/glass-break",
      name: "Glass Break",
      description: "Sharp shatter.",
      group: "Foley & Action",
      data: { provider: "elevenlabs-sfx", duration: 2, promptInfluence: 0.8, prompt: "glass shattering, sharp break with falling shards" },
    },
    {
      id: "text-to-audio/keyboard-typing",
      name: "Keyboard Typing",
      description: "Mechanical key clicks.",
      group: "Foley & Action",
      data: { provider: "elevenlabs-sfx", duration: 5, promptInfluence: 0.6, prompt: "fast mechanical keyboard typing, crisp key clicks" },
    },
    {
      id: "text-to-audio/explosion",
      name: "Explosion",
      description: "Deep boom + debris.",
      group: "Foley & Action",
      data: { provider: "elevenlabs-sfx", duration: 3, promptInfluence: 0.7, prompt: "large explosion, deep boom with rumbling debris and tail" },
    },
    {
      id: "text-to-audio/magic-sparkle",
      name: "Magic Sparkle",
      description: "Shimmering chime FX.",
      group: "Foley & Action",
      data: { provider: "elevenlabs-sfx", duration: 2, promptInfluence: 0.7, prompt: "magical sparkle shimmer, twinkling fairy-dust chimes" },
    },
    {
      id: "text-to-audio/camera-shutter",
      name: "Camera Shutter",
      description: "DSLR click.",
      group: "Foley & Action",
      data: { provider: "elevenlabs-sfx", duration: 1, promptInfluence: 0.8, prompt: "DSLR camera shutter click, single crisp photo snap" },
    },
    {
      id: "text-to-audio/error-buzzer",
      name: "Error Buzzer",
      description: "Wrong / fail tone.",
      group: "Foley & Action",
      data: { provider: "elevenlabs-sfx", duration: 1, promptInfluence: 0.8, prompt: "short error buzzer, negative fail tone" },
    },
  ],
  "generate-music": [
    // ── By Use-Case ──────────────────────────────────────────────────────────
    {
      id: "generate-music/lofi-study",
      name: "Lo-fi Study Beat",
      description: "Mellow focus beat.",
      group: "By Use-Case",
      data: {
        genre: "lofi",
        mood: "chill, relaxed, nostalgic",
        instrumental: true,
        duration: 30,
        prompt: "lo-fi hip-hop study beat, mellow Rhodes piano, vinyl crackle, soft boom-bap drums, around 75 BPM",
      },
    },
    {
      id: "generate-music/podcast-intro",
      name: "Podcast Intro",
      description: "Short energetic opener.",
      group: "By Use-Case",
      data: {
        genre: "electronic",
        mood: "upbeat, confident",
        instrumental: true,
        duration: 15,
        prompt: "short energetic podcast intro, modern and catchy synth hook, clean punchy beat",
      },
    },
    {
      id: "generate-music/cinematic-trailer",
      name: "Cinematic Trailer",
      description: "Epic orchestral build.",
      group: "By Use-Case",
      data: {
        genre: "cinematic",
        mood: "epic, dramatic, intense",
        instrumental: true,
        duration: 30,
        prompt: "epic cinematic trailer cue, full orchestra, taiko drums, brass swells, rising tension into a powerful hit",
      },
    },
    {
      id: "generate-music/corporate-upbeat",
      name: "Corporate Upbeat",
      description: "Bright, motivational bed.",
      group: "By Use-Case",
      data: {
        genre: "pop",
        mood: "uplifting, optimistic, motivational",
        instrumental: true,
        duration: 30,
        prompt: "upbeat corporate background music, bright piano, claps, positive and clean, around 120 BPM",
      },
    },
    {
      id: "generate-music/vlog-background",
      name: "Vlog Background",
      description: "Feel-good, unobtrusive.",
      group: "By Use-Case",
      data: {
        genre: "pop",
        mood: "happy, light, breezy",
        instrumental: true,
        duration: 30,
        prompt: "light feel-good vlog background, acoustic guitar, claps, warm and unobtrusive",
      },
    },
    {
      id: "generate-music/ambient-loop",
      name: "Ambient Loop",
      description: "Calm evolving soundscape.",
      group: "By Use-Case",
      data: {
        genre: "ambient-genre",
        mood: "calm, peaceful, serene",
        instrumental: true,
        duration: 30,
        prompt: "ambient soundscape, soft evolving synth pads, gentle textures, meditative and seamless",
      },
    },
    {
      id: "generate-music/edm-drop",
      name: "EDM Drop",
      description: "Festival build and drop.",
      group: "By Use-Case",
      data: {
        genre: "electronic",
        mood: "euphoric, energetic",
        instrumental: true,
        duration: 30,
        prompt: "festival EDM, big synth leads, sidechain bass, build-up and a powerful drop, around 128 BPM",
      },
    },
    {
      id: "generate-music/game-loop",
      name: "Game Loop",
      description: "Catchy adventurous loop.",
      group: "By Use-Case",
      data: {
        genre: "video-game",
        mood: "playful, adventurous",
        instrumental: true,
        duration: 30,
        prompt: "looping video game background music, chiptune-inspired, catchy melody, energetic",
      },
    },

    // ── By Mood / Score (instrumental scoring beds) ──────────────────────────
    {
      id: "generate-music/score-uplifting",
      name: "Uplifting",
      description: "Hopeful, building score.",
      group: "By Mood / Score",
      data: {
        genre: "cinematic",
        mood: "uplifting, hopeful, inspiring",
        instrumental: true,
        duration: 30,
        prompt: "uplifting inspirational orchestral score, building piano and strings, hopeful crescendo",
      },
    },
    {
      id: "generate-music/score-emotional",
      name: "Emotional",
      description: "Tender, moving piano.",
      group: "By Mood / Score",
      data: {
        genre: "cinematic",
        mood: "emotional, melancholic, tender",
        instrumental: true,
        duration: 30,
        prompt: "emotional piano score, soft strings, intimate and moving, slow tempo",
      },
    },
    {
      id: "generate-music/score-tense",
      name: "Tense / Suspense",
      description: "Pulsing underscore.",
      group: "By Mood / Score",
      data: {
        genre: "cinematic",
        mood: "tense, suspenseful, dark",
        instrumental: true,
        duration: 30,
        prompt: "suspenseful underscore, pulsing low strings, ticking tension, ominous and building",
      },
    },
    {
      id: "generate-music/score-epic",
      name: "Epic / Heroic",
      description: "Triumphant, powerful.",
      group: "By Mood / Score",
      data: {
        genre: "cinematic",
        mood: "epic, heroic, powerful",
        instrumental: true,
        duration: 30,
        prompt: "epic heroic orchestral score, soaring brass, pounding drums, triumphant",
      },
    },
    {
      id: "generate-music/score-happy",
      name: "Happy / Playful",
      description: "Cheerful and light.",
      group: "By Mood / Score",
      data: {
        genre: "pop",
        mood: "happy, playful, quirky",
        instrumental: true,
        duration: 30,
        prompt: "happy playful tune, ukulele, whistling, claps, cheerful and bouncy",
      },
    },
    {
      id: "generate-music/score-dark",
      name: "Dark / Brooding",
      description: "Ominous atmosphere.",
      group: "By Mood / Score",
      data: {
        genre: "electronic",
        mood: "dark, brooding, ominous",
        instrumental: true,
        duration: 30,
        prompt: "dark brooding atmosphere, deep drones, distant percussion, cinematic dread",
      },
    },
    {
      id: "generate-music/score-romantic",
      name: "Romantic",
      description: "Warm, heartfelt.",
      group: "By Mood / Score",
      data: {
        genre: "classical",
        mood: "romantic, warm, tender",
        instrumental: true,
        duration: 30,
        prompt: "romantic score, warm strings and piano, gentle and heartfelt",
      },
    },

    // ── By Genre (starting points) ───────────────────────────────────────────
    {
      id: "generate-music/ambient-cinematic",
      name: "Ambient Cinematic",
      description: "Atmospheric instrumental bed.",
      group: "By Genre",
      data: {
        genre: "cinematic",
        mood: "atmospheric",
        instrumental: true,
        duration: 30,
        prompt: "atmospheric cinematic ambient bed, evolving pads, subtle swells",
      },
    },
    {
      id: "generate-music/genre-lofi",
      name: "Lo-fi Hip-Hop",
      description: "Laid-back jazzy beat.",
      group: "By Genre",
      data: {
        genre: "lofi",
        mood: "chill, mellow",
        instrumental: true,
        duration: 30,
        prompt: "lo-fi hip-hop, jazzy chords, vinyl warmth, laid-back groove",
      },
    },
    {
      id: "generate-music/genre-edm",
      name: "EDM / House",
      description: "Club-energy four-on-the-floor.",
      group: "By Genre",
      data: {
        genre: "electronic",
        mood: "energetic, euphoric",
        instrumental: true,
        duration: 30,
        prompt: "house / EDM, four-on-the-floor beat, catchy plucky synths, club energy",
      },
    },
    {
      id: "generate-music/genre-rock",
      name: "Rock",
      description: "Driving electric guitars.",
      group: "By Genre",
      data: {
        genre: "rock",
        mood: "energetic, driving",
        instrumental: true,
        duration: 30,
        prompt: "energetic rock instrumental, distorted electric guitars, driving drums, powerful",
      },
    },
    {
      id: "generate-music/genre-jazz",
      name: "Smooth Jazz",
      description: "Late-night sax and brushes.",
      group: "By Genre",
      data: {
        genre: "jazz",
        mood: "smooth, relaxed, sophisticated",
        instrumental: true,
        duration: 30,
        prompt: "smooth jazz, warm saxophone, brushed drums, walking bass, late-night mood",
      },
    },
    {
      id: "generate-music/genre-orchestral",
      name: "Orchestral",
      description: "Grand cinematic ensemble.",
      group: "By Genre",
      data: {
        genre: "classical",
        mood: "grand, cinematic",
        instrumental: true,
        duration: 30,
        prompt: "full orchestral piece, sweeping strings, brass and woodwinds, dramatic and rich",
      },
    },
    {
      id: "generate-music/genre-synthwave",
      name: "Synthwave / Retro",
      description: "80s neon nostalgia.",
      group: "By Genre",
      data: {
        genre: "electronic",
        mood: "nostalgic, retro, cool",
        instrumental: true,
        duration: 30,
        prompt: "80s synthwave, retro analog synths, pulsing bass, neon nostalgia, around 110 BPM",
      },
    },
    {
      id: "generate-music/genre-funk",
      name: "Funk / Soul",
      description: "Groovy, danceable.",
      group: "By Genre",
      data: {
        genre: "funk",
        mood: "groovy, fun",
        instrumental: true,
        duration: 30,
        prompt: "funky groove, slap bass, wah guitar, tight horns, danceable",
      },
    },
    // ── More By Use-Case ─────────────────────────────────────────────────────
    {
      id: "generate-music/trailer-riser",
      name: "Trailer Riser / Braam",
      description: "Pure rising tension hit.",
      group: "By Use-Case",
      data: { genre: "cinematic", mood: "tense, building", instrumental: true, duration: 15, prompt: "cinematic trailer riser and braam hit, rising tension whoosh into a deep impact, no melody" },
    },
    {
      id: "generate-music/calm-corporate",
      name: "Calm Corporate / Tech",
      description: "Soft, professional bed.",
      group: "By Use-Case",
      data: { genre: "electronic", mood: "calm, professional", instrumental: true, duration: 30, prompt: "calm corporate tech bed, soft synth pads, gentle pulse, steady and unobtrusive" },
    },
    {
      id: "generate-music/holiday",
      name: "Holiday / Festive",
      description: "Warm seasonal cheer.",
      group: "By Use-Case",
      data: { genre: "holiday", mood: "festive, warm, cheerful", instrumental: true, duration: 30, prompt: "festive holiday music, sleigh bells, warm orchestration, cheerful and cozy" },
    },
    {
      id: "generate-music/kids",
      name: "Kids / Children's",
      description: "Playful and simple.",
      group: "By Use-Case",
      data: { genre: "children", mood: "playful, happy", instrumental: true, duration: 30, prompt: "playful children's music, simple cheerful melody, xylophone and ukulele, bouncy and friendly" },
    },
    {
      id: "generate-music/meditation-spa",
      name: "Meditation / Spa",
      description: "Healing singing bowls.",
      group: "By Use-Case",
      data: { genre: "ambient-genre", mood: "serene, healing", instrumental: true, duration: 30, prompt: "meditation and spa music, singing bowls, soft drones, gentle and calming, very slow" },
    },
    {
      id: "generate-music/workout",
      name: "Workout / Gym",
      description: "High-energy motivation.",
      group: "By Use-Case",
      data: { genre: "electronic", mood: "energetic, motivational", instrumental: true, duration: 30, prompt: "high-energy workout music, driving beat, motivational synths, around 140 BPM" },
    },
    // ── More By Genre ────────────────────────────────────────────────────────
    {
      id: "generate-music/trap",
      name: "Trap Beat",
      description: "Booming 808s, dark.",
      group: "By Genre",
      data: { genre: "hip-hop", mood: "dark, hard", instrumental: true, duration: 30, prompt: "trap beat, booming 808s, crisp rapid hi-hats, dark and moody" },
    },
    {
      id: "generate-music/dnb",
      name: "Drum & Bass",
      description: "Fast breakbeats, deep bass.",
      group: "By Genre",
      data: { genre: "electronic", mood: "fast, energetic", instrumental: true, duration: 30, prompt: "drum and bass, fast breakbeats, deep rolling bassline, energetic, around 174 BPM" },
    },
    {
      id: "generate-music/afrobeats",
      name: "Afrobeats",
      description: "Warm syncopated groove.",
      group: "By Genre",
      data: { genre: "afrobeats", mood: "groovy, warm", instrumental: true, duration: 30, prompt: "afrobeats, syncopated percussion, warm bass groove, bright melodies, danceable" },
    },
    {
      id: "generate-music/country",
      name: "Country / Americana",
      description: "Acoustic, heartfelt.",
      group: "By Genre",
      data: { genre: "country", mood: "warm, heartfelt", instrumental: true, duration: 30, prompt: "country americana, acoustic and slide guitar, warm storytelling feel" },
    },
    {
      id: "generate-music/phonk",
      name: "Phonk",
      description: "Dark drift-phonk for reels.",
      group: "By Genre",
      data: { genre: "hip-hop", mood: "dark, aggressive", instrumental: true, duration: 30, prompt: "drift phonk, distorted 808 cowbell, dark menacing beat, lo-fi grit" },
    },
    {
      id: "generate-music/reggae",
      name: "Reggae / Dub",
      description: "Laid-back island groove.",
      group: "By Genre",
      data: { genre: "reggae", mood: "laid-back, sunny", instrumental: true, duration: 30, prompt: "reggae dub, off-beat skank guitar, deep dub bassline, relaxed island groove" },
    },
  ],

  // Suno style-prompt presets — the advanced Suno node uses a free-text `style`
  // box (genre + mood + instrumentation + tempo/BPM + structure, per Suno's
  // glossary). Setting `style` auto-enables Suno custom mode
  // (getEffectiveSunoCustomMode), so instrumental beds run as-is; "Vocals &
  // Songs" presets set instrumental:false and invite the user to add lyrics.
  "suno-generate": [
    // ── By Use-Case ──────────────────────────────────────────────────────────
    {
      id: "suno-generate/lofi-study",
      name: "Lo-fi Study",
      description: "Mellow focus beat.",
      group: "By Use-Case",
      data: {
        model: "V5_5",
        instrumental: true,
        style: "lo-fi hip-hop, chill and mellow, jazzy Rhodes chords, vinyl crackle, soft boom-bap drums, Andante 80 BPM, instrumental",
      },
    },
    {
      id: "suno-generate/podcast-intro",
      name: "Podcast Intro",
      description: "Short confident opener.",
      group: "By Use-Case",
      data: {
        model: "V5_5",
        instrumental: true,
        style: "modern podcast intro, upbeat and confident, catchy synth hook, punchy beat, Allegro, instrumental",
      },
    },
    {
      id: "suno-generate/cinematic-trailer",
      name: "Cinematic Trailer",
      description: "Epic orchestral build.",
      group: "By Use-Case",
      data: {
        model: "V5_5",
        instrumental: true,
        style: "epic cinematic trailer, dramatic and intense, full orchestra, taiko drums, brass swells, crescendo into a powerful hit, instrumental",
      },
    },
    {
      id: "suno-generate/corporate-upbeat",
      name: "Corporate Upbeat",
      description: "Bright, motivational.",
      group: "By Use-Case",
      data: {
        model: "V5_5",
        instrumental: true,
        style: "upbeat corporate, optimistic and motivational, bright piano, claps, clean electronic beat, Allegro 120 BPM, instrumental",
      },
    },
    {
      id: "suno-generate/vlog-background",
      name: "Vlog Background",
      description: "Feel-good acoustic bed.",
      group: "By Use-Case",
      data: {
        model: "V5_5",
        instrumental: true,
        style: "feel-good vlog background, light and breezy, acoustic guitar, claps, warm and unobtrusive, Andante, instrumental",
      },
    },
    {
      id: "suno-generate/ambient-loop",
      name: "Ambient Loop",
      description: "Calm meditative pads.",
      group: "By Use-Case",
      data: {
        model: "V5_5",
        instrumental: true,
        style: "ambient soundscape, calm and meditative, soft evolving synth pads, gentle textures, reverb-heavy, Adagio, instrumental",
      },
    },
    {
      id: "suno-generate/edm-drop",
      name: "EDM Drop",
      description: "Festival build and drop.",
      group: "By Use-Case",
      data: {
        model: "V5_5",
        instrumental: true,
        style: "festival EDM, euphoric and energetic, big supersaw leads, sidechain bass, build-up and powerful drop, Allegro 128 BPM, instrumental",
      },
    },
    {
      id: "suno-generate/game-chiptune",
      name: "Game Chiptune",
      description: "Playful 8-bit loop.",
      group: "By Use-Case",
      data: {
        model: "V5_5",
        instrumental: true,
        style: "video game chiptune, playful and adventurous, 8-bit synths, catchy melody, energetic, instrumental",
      },
    },

    // ── By Genre ─────────────────────────────────────────────────────────────
    {
      id: "suno-generate/genre-lofi",
      name: "Lo-fi Hip-Hop",
      description: "Dusty laid-back groove.",
      group: "By Genre",
      data: {
        model: "V5_5",
        instrumental: true,
        style: "lo-fi hip-hop, jazzy and mellow, dusty Rhodes chords, vinyl warmth, laid-back boom-bap groove, instrumental",
      },
    },
    {
      id: "suno-generate/genre-house",
      name: "EDM / House",
      description: "Club-energy four-on-the-floor.",
      group: "By Genre",
      data: {
        model: "V5_5",
        instrumental: true,
        style: "house EDM, energetic and euphoric, four-on-the-floor beat, catchy plucky synths, club energy, Allegro 124 BPM, instrumental",
      },
    },
    {
      id: "suno-generate/genre-rock",
      name: "Rock",
      description: "Driving anthemic guitars.",
      group: "By Genre",
      data: {
        model: "V5_5",
        instrumental: true,
        style: "rock anthem, energetic and driving, distorted electric guitars, pounding drums, anthemic, instrumental",
      },
    },
    {
      id: "suno-generate/genre-jazz",
      name: "Smooth Jazz",
      description: "Late-night sophistication.",
      group: "By Genre",
      data: {
        model: "V5_5",
        instrumental: true,
        style: "smooth jazz, relaxed and sophisticated, warm saxophone, brushed drums, walking bass, late-night, instrumental",
      },
    },
    {
      id: "suno-generate/genre-ambient",
      name: "Ambient",
      description: "Spacious and serene.",
      group: "By Genre",
      data: {
        model: "V5_5",
        instrumental: true,
        style: "ambient, serene and spacious, lush synth pads, field-recording textures, slow and meditative, instrumental",
      },
    },
    {
      id: "suno-generate/genre-orchestral",
      name: "Orchestral",
      description: "Grand cinematic ensemble.",
      group: "By Genre",
      data: {
        model: "V5_5",
        instrumental: true,
        style: "epic orchestral, grand and cinematic, sweeping strings, brass, woodwinds, timpani, dramatic, instrumental",
      },
    },
    {
      id: "suno-generate/genre-synthwave",
      name: "Synthwave / Retro",
      description: "80s neon nostalgia.",
      group: "By Genre",
      data: {
        model: "V5_5",
        instrumental: true,
        style: "80s synthwave, nostalgic and cool, retro analog synths, pulsing bass, gated drums, neon, Andante 110 BPM, instrumental",
      },
    },
    {
      id: "suno-generate/genre-funk",
      name: "Funk / Soul",
      description: "Groovy and danceable.",
      group: "By Genre",
      data: {
        model: "V5_5",
        instrumental: true,
        style: "funk and soul, groovy and fun, slap bass, wah guitar, tight horn section, danceable, instrumental",
      },
    },

    // ── Vocals & Songs (add your lyrics) ─────────────────────────────────────
    {
      id: "suno-generate/song-pop",
      name: "Pop Song",
      description: "Catchy vocal pop — add lyrics.",
      group: "Vocals & Songs",
      data: {
        model: "V5_5",
        instrumental: false,
        style: "upbeat pop, catchy and bright, shimmering synths, four-on-the-floor, female vocals, Allegro 120 BPM, verse-chorus-verse with bridge",
      },
    },
    {
      id: "suno-generate/song-rap",
      name: "Rap / Hip-Hop",
      description: "Hard-hitting verses — add bars.",
      group: "Vocals & Songs",
      data: {
        model: "V5_5",
        instrumental: false,
        style: "modern hip-hop, confident, hard-hitting 808s, trap hi-hats, male rap vocals, verse-hook-verse",
      },
    },
    {
      id: "suno-generate/song-ballad",
      name: "Emotional Ballad",
      description: "Heartfelt vocals — add lyrics.",
      group: "Vocals & Songs",
      data: {
        model: "V5_5",
        instrumental: false,
        style: "emotional ballad, tender and heartfelt, piano and strings, soulful vocals, Adagio, verse-chorus with a big bridge",
      },
    },
    {
      id: "suno-generate/song-rock",
      name: "Rock Anthem (vocal)",
      description: "Soaring chorus — add lyrics.",
      group: "Vocals & Songs",
      data: {
        model: "V5_5",
        instrumental: false,
        style: "anthemic rock, powerful, driving guitars, big drums, male vocals, soaring chorus, verse-pre-chorus-chorus",
      },
    },
    {
      id: "suno-generate/song-acoustic",
      name: "Acoustic Singer-Songwriter",
      description: "Warm and intimate — add lyrics.",
      group: "Vocals & Songs",
      data: {
        model: "V5_5",
        instrumental: false,
        style: "acoustic singer-songwriter, warm and intimate, fingerpicked guitar, soft vocals, Andante, verse-chorus",
      },
    },
    // ── More By Use-Case ─────────────────────────────────────────────────────
    {
      id: "suno-generate/trailer-riser",
      name: "Trailer Riser / Braam",
      description: "Pure rising tension hit.",
      group: "By Use-Case",
      data: { model: "V5_5", instrumental: true, style: "cinematic trailer riser and braam, tense and building, rising whoosh into a deep brass impact, no melody, instrumental" },
    },
    {
      id: "suno-generate/calm-corporate",
      name: "Calm Corporate / Tech",
      description: "Soft, professional bed.",
      group: "By Use-Case",
      data: { model: "V5_5", instrumental: true, style: "calm corporate tech, professional and clean, soft synth pads, gentle pulse, Andante, instrumental" },
    },
    {
      id: "suno-generate/holiday",
      name: "Holiday / Festive",
      description: "Warm seasonal cheer.",
      group: "By Use-Case",
      data: { model: "V5_5", instrumental: true, style: "festive holiday music, warm and cheerful, sleigh bells, warm orchestration, cozy, instrumental" },
    },
    {
      id: "suno-generate/kids",
      name: "Kids / Children's",
      description: "Playful and simple.",
      group: "By Use-Case",
      data: { model: "V5_5", instrumental: true, style: "children's music, playful and happy, simple cheerful melody, xylophone and ukulele, bouncy, instrumental" },
    },
    {
      id: "suno-generate/meditation-spa",
      name: "Meditation / Spa",
      description: "Healing singing bowls.",
      group: "By Use-Case",
      data: { model: "V5_5", instrumental: true, style: "meditation and spa, serene and healing, singing bowls, soft drones, Adagio, reverb-heavy, instrumental" },
    },
    {
      id: "suno-generate/workout",
      name: "Workout / Gym",
      description: "High-energy motivation.",
      group: "By Use-Case",
      data: { model: "V5_5", instrumental: true, style: "high-energy workout, motivational and driving, pumping electronic beat, big synths, Allegro 140 BPM, instrumental" },
    },
    // ── More By Genre ────────────────────────────────────────────────────────
    {
      id: "suno-generate/trap",
      name: "Trap Beat",
      description: "Booming 808s, dark.",
      group: "By Genre",
      data: { model: "V5_5", instrumental: true, style: "trap beat, dark and hard, booming 808s, crisp rapid hi-hats, moody, instrumental" },
    },
    {
      id: "suno-generate/dnb",
      name: "Drum & Bass",
      description: "Fast breakbeats, deep bass.",
      group: "By Genre",
      data: { model: "V5_5", instrumental: true, style: "drum and bass, fast and energetic, breakbeats, deep rolling bassline, Presto 174 BPM, instrumental" },
    },
    {
      id: "suno-generate/afrobeats",
      name: "Afrobeats",
      description: "Warm syncopated groove.",
      group: "By Genre",
      data: { model: "V5_5", instrumental: true, style: "afrobeats, groovy and warm, syncopated percussion, warm bass, bright melodies, danceable, instrumental" },
    },
    {
      id: "suno-generate/country",
      name: "Country / Americana",
      description: "Acoustic, heartfelt.",
      group: "By Genre",
      data: { model: "V5_5", instrumental: true, style: "country americana, warm and heartfelt, acoustic and slide guitar, storytelling feel, instrumental" },
    },
    {
      id: "suno-generate/phonk",
      name: "Phonk",
      description: "Dark drift-phonk for reels.",
      group: "By Genre",
      data: { model: "V5_5", instrumental: true, style: "drift phonk, dark and aggressive, distorted 808 cowbell, menacing beat, lo-fi grit, instrumental" },
    },
    {
      id: "suno-generate/reggae",
      name: "Reggae / Dub",
      description: "Laid-back island groove.",
      group: "By Genre",
      data: { model: "V5_5", instrumental: true, style: "reggae dub, laid-back and sunny, off-beat skank guitar, deep dub bassline, relaxed island groove, instrumental" },
    },
    // ── More Vocals & Songs ──────────────────────────────────────────────────
    {
      id: "suno-generate/song-rnb",
      name: "R&B / Soul (vocal)",
      description: "Smooth soulful vocals — add lyrics.",
      group: "Vocals & Songs",
      data: { model: "V5_5", instrumental: false, style: "smooth R&B soul, sensual and warm, lush chords, soft drums, soulful vocals, Andante, verse-chorus with ad-libs" },
    },
    {
      id: "suno-generate/song-kpop",
      name: "K-Pop (vocal)",
      description: "Polished hook — add lyrics.",
      group: "Vocals & Songs",
      data: { model: "V5_5", instrumental: false, style: "K-pop, polished and energetic, bright synths, punchy drums, layered vocals, Allegro 120 BPM, verse-pre-chorus-chorus" },
    },
  ],
  "llm-chat": [
    // ── Assistants ───────────────────────────────────────────────────────────
    {
      id: "llm-chat/concise-assistant",
      name: "Concise Assistant",
      description: "Short, direct answers.",
      group: "Assistants",
      data: {
        systemPrompt: "You are a concise assistant. Answer in 1-3 sentences. No preamble.",
        temperature: 0.3,
      },
    },
    {
      id: "llm-chat/brainstorm",
      name: "Brainstorm / Ideas",
      description: "10 diverse ideas, high variety.",
      group: "Assistants",
      data: {
        systemPrompt:
          "You are a creative brainstorming partner. Given a topic, return a numbered list of 10 diverse, original ideas. No preamble, no explanations.",
        temperature: 1,
      },
    },

    // ── Writing & Marketing ──────────────────────────────────────────────────
    {
      id: "llm-chat/copywriter",
      name: "Copywriter / Headlines",
      description: "Punchy marketing copy.",
      group: "Writing & Marketing",
      data: {
        systemPrompt:
          "You are an expert direct-response copywriter. Write punchy, persuasive, benefit-led copy. When asked for headlines, return 5 distinct options as a list.",
        temperature: 0.8,
      },
    },
    {
      id: "llm-chat/social-caption",
      name: "Social Caption + Hashtags",
      description: "Caption then hashtags.",
      group: "Writing & Marketing",
      data: {
        systemPrompt:
          "Write one engaging social-media caption for the user's topic, then on a new line add 8-12 relevant hashtags. Match a modern, friendly tone.",
        temperature: 0.8,
      },
    },
    {
      id: "llm-chat/seo-metadata",
      name: "SEO Metadata",
      description: "Title, meta, keywords.",
      group: "Writing & Marketing",
      data: {
        systemPrompt:
          "Generate SEO metadata for the user's topic: a title (<=60 chars), a meta description (<=155 chars), and 8 keywords. Label each section.",
        temperature: 0.4,
      },
    },
    {
      id: "llm-chat/rewrite-tone",
      name: "Rewrite / Tone Shifter",
      description: "Restyle text, keep meaning.",
      group: "Writing & Marketing",
      data: {
        systemPrompt:
          "Rewrite the user's text in the requested tone (e.g. formal, casual, friendly, confident). Preserve the meaning. Return only the rewrite.",
        temperature: 0.5,
      },
    },
    {
      id: "llm-chat/script-writer",
      name: "Script / Storyboard Writer",
      description: "Shot-by-shot video script.",
      group: "Writing & Marketing",
      data: {
        systemPrompt:
          "You are a short-form video scriptwriter. Turn the user's idea into a shot-by-shot script. For each shot give: Scene, Visual, Voiceover. Keep it tight and production-ready.",
        temperature: 0.7,
      },
    },

    // ── Utility ──────────────────────────────────────────────────────────────
    {
      id: "llm-chat/prompt-enhancer",
      name: "Prompt Enhancer",
      description: "Idea → rich image prompt.",
      group: "Utility",
      data: {
        systemPrompt:
          "Expand the user's short idea into a single rich, vivid image-generation prompt covering subject, setting, lighting, composition, lens and style. Return only the prompt, no preamble.",
        temperature: 0.8,
      },
    },
    {
      id: "llm-chat/translator",
      name: "Translator",
      description: "Translate, preserve tone.",
      group: "Utility",
      data: {
        systemPrompt:
          "Translate the user's text into the requested target language, preserving tone and meaning. Return only the translation.",
        temperature: 0.2,
      },
    },
    {
      id: "llm-chat/summarizer",
      name: "Summarizer (TL;DR)",
      description: "3-5 bullet summary.",
      group: "Utility",
      data: {
        systemPrompt: "Summarize the user's text into 3-5 concise bullet points capturing the key takeaways. No preamble.",
        temperature: 0.2,
      },
    },
    {
      id: "llm-chat/qa-context",
      name: "Q&A over Context",
      description: "Grounded answers only.",
      group: "Utility",
      data: {
        systemPrompt:
          "Answer the user's question using ONLY the provided context. If the answer is not in the context, say you don't know rather than guessing.",
        temperature: 0.1,
      },
    },

    // ── Structured Output ────────────────────────────────────────────────────
    {
      id: "llm-chat/json-extractor",
      name: "JSON Extractor",
      description: "Returns strict JSON only.",
      group: "Structured Output",
      data: {
        systemPrompt:
          "Extract the requested fields and return ONLY valid minified JSON. No prose, no code fences.",
        temperature: 0,
      },
    },
    {
      id: "llm-chat/classifier",
      name: "Classifier / Sentiment",
      description: "Returns one label.",
      group: "Structured Output",
      data: {
        systemPrompt:
          "Classify the user's input. Return ONLY a single label from the allowed set (default: positive / neutral / negative). No explanation.",
        temperature: 0,
      },
    },
  ],

  // Generate Script — set the format config (tone / sceneCount / targetLength /
  // structure); the topic is the user's prompt. tone <=200, sceneCount 1-20,
  // structure ∈ freeform|8-step|custom.
  "generate-script": [
    // ── By Format ────────────────────────────────────────────────────────────
    {
      id: "generate-script/yt-short",
      name: "YouTube Short / Hook",
      description: "Punchy, hook-first, ~30s.",
      group: "By Format",
      data: { tone: "energetic, punchy, hook-first", sceneCount: 5, targetLength: 30, structure: "freeform" },
    },
    {
      id: "generate-script/explainer",
      name: "Explainer (how-to)",
      description: "Clear 8-step walkthrough.",
      group: "By Format",
      data: { tone: "clear, friendly, educational", sceneCount: 8, targetLength: 90, structure: "8-step" },
    },
    {
      id: "generate-script/ad-spot",
      name: "Ad / Commercial Spot",
      description: "Persuasive 30s spot.",
      group: "By Format",
      data: { tone: "persuasive, upbeat, benefit-led", sceneCount: 4, targetLength: 30, structure: "freeform" },
    },
    {
      id: "generate-script/product-demo",
      name: "Product Demo VO",
      description: "Confident feature walkthrough.",
      group: "By Format",
      data: { tone: "confident, informative", sceneCount: 6, targetLength: 60, structure: "freeform" },
    },
    {
      id: "generate-script/listicle",
      name: "Listicle (Top 5)",
      description: "Snappy countdown.",
      group: "By Format",
      data: { tone: "engaging, energetic", sceneCount: 6, targetLength: 60, structure: "freeform" },
    },

    // ── Long-Form & Narrative ────────────────────────────────────────────────
    {
      id: "generate-script/podcast-outline",
      name: "Podcast Outline",
      description: "Conversational episode beats.",
      group: "Long-Form & Narrative",
      data: { tone: "conversational, curious", sceneCount: 10, targetLength: 600, structure: "freeform" },
    },
    {
      id: "generate-script/trailer-narration",
      name: "Trailer Narration",
      description: "Dramatic voiceover beats.",
      group: "Long-Form & Narrative",
      data: { tone: "dramatic, epic", sceneCount: 6, targetLength: 60, structure: "freeform" },
    },
    {
      id: "generate-script/story-beats",
      name: "Story Beats",
      description: "Emotional narrative arc.",
      group: "Long-Form & Narrative",
      data: { tone: "narrative, emotional", sceneCount: 8, targetLength: 120, structure: "8-step" },
    },
  ],

  // Image to Text — set detailLevel + a customPrompt instruction (<=2000).
  "image-to-text": [
    // ── Accessibility & SEO ──────────────────────────────────────────────────
    {
      id: "image-to-text/alt-text",
      name: "Alt Text",
      description: "Accessible, ≤125 chars.",
      group: "Accessibility & SEO",
      data: { detailLevel: "brief", customPrompt: "Write concise alt text for this image for accessibility, under 125 characters. Describe only what is essential." },
    },
    {
      id: "image-to-text/seo-caption",
      name: "SEO Caption",
      description: "Caption + keywords.",
      group: "Accessibility & SEO",
      data: { detailLevel: "detailed", customPrompt: "Write an SEO-friendly caption for this image, then list 8 relevant keywords." },
    },
    {
      id: "image-to-text/social-caption",
      name: "Social Caption",
      description: "Caption + hashtags.",
      group: "Accessibility & SEO",
      data: { detailLevel: "detailed", customPrompt: "Write an engaging social-media caption for this image, then 8-12 relevant hashtags." },
    },

    // ── Extraction ───────────────────────────────────────────────────────────
    {
      id: "image-to-text/ocr",
      name: "Extract Text (OCR)",
      description: "Return only visible text.",
      group: "Extraction",
      data: { detailLevel: "structured", customPrompt: "Extract and return ONLY the text visible in this image, preserving line breaks. No commentary." },
    },
    {
      id: "image-to-text/tags",
      name: "Tags / Keywords",
      description: "Comma-separated tags.",
      group: "Extraction",
      data: { detailLevel: "brief", customPrompt: "List 10-15 descriptive tags for this image, comma-separated. No sentences." },
    },
    {
      id: "image-to-text/product-desc",
      name: "Product Description",
      description: "E-commerce copy from a photo.",
      group: "Extraction",
      data: { detailLevel: "detailed", customPrompt: "Write a compelling e-commerce product description based on this product image." },
    },

    // ── Creative ─────────────────────────────────────────────────────────────
    {
      id: "image-to-text/scene-description",
      name: "Detailed Description",
      description: "Vivid prose description.",
      group: "Creative",
      data: { detailLevel: "detailed", customPrompt: "Provide a vivid, comprehensive description of this image: subjects, setting, lighting, mood and composition, in flowing prose." },
    },
    {
      id: "image-to-text/reverse-prompt",
      name: "Reverse Prompt",
      description: "Image → text-to-image prompt.",
      group: "Creative",
      data: { detailLevel: "detailed", customPrompt: "Describe this image as a detailed text-to-image generation prompt: subject, style, lighting, composition and lens. Return only the prompt." },
    },
  ],

  // Voice Design — describe the voice to create (voiceDescription <=1000). The
  // sample `text` is left for the user.
  "voice-design": [
    // ── Narration & Character ────────────────────────────────────────────────
    {
      id: "voice-design/trailer-narrator",
      name: "Movie-Trailer Narrator",
      description: "Deep, dramatic, commanding.",
      group: "Narration & Character",
      data: { voiceDescription: "A deep, powerful male movie-trailer narrator with dramatic gravitas and a slow, commanding delivery." },
    },
    {
      id: "voice-design/audiobook-female",
      name: "Warm Female Audiobook",
      description: "Soothing, clear, intimate.",
      group: "Narration & Character",
      data: { voiceDescription: "A warm, soothing female audiobook narrator with clear articulation and a gentle, intimate tone." },
    },
    {
      id: "voice-design/old-wizard",
      name: "Old Wizard",
      description: "Gravelly, wise, theatrical.",
      group: "Narration & Character",
      data: { voiceDescription: "A gravelly, wise old wizard with a deep raspy voice and a slow, theatrical cadence." },
    },
    {
      id: "voice-design/noir-detective",
      name: "Noir Detective",
      description: "Raspy, smoky, brooding.",
      group: "Narration & Character",
      data: { voiceDescription: "A raspy, world-weary noir detective with a low, smoky, brooding voice." },
    },
    {
      id: "voice-design/meditation-guide",
      name: "Meditation Guide",
      description: "Calm, soft, breathy.",
      group: "Narration & Character",
      data: { voiceDescription: "A calm, soft-spoken meditation guide with a slow, breathy, reassuring delivery." },
    },

    // ── Professional & Assistant ─────────────────────────────────────────────
    {
      id: "voice-design/hype-announcer",
      name: "Energetic Hype",
      description: "Fast, excited, punchy.",
      group: "Professional & Assistant",
      data: { voiceDescription: "An energetic young hype announcer: fast-paced, excited and punchy." },
    },
    {
      id: "voice-design/friendly-assistant",
      name: "Friendly Assistant",
      description: "Bright, clear, approachable.",
      group: "Professional & Assistant",
      data: { voiceDescription: "A bright, friendly, professional virtual-assistant voice, clear and approachable." },
    },
    {
      id: "voice-design/corporate-ivr",
      name: "Corporate IVR",
      description: "Neutral, articulate, pro.",
      group: "Professional & Assistant",
      data: { voiceDescription: "A neutral, clear corporate phone-system voice, articulate and professional." },
    },
  ],
  // video-to-video RESTYLE looks. provider "wan" is the general video restyle; the
  // prompt carries the target style + an instruction to preserve the original motion.
  "video-to-video": [
    {
      id: "video-to-video/anime",
      name: "Anime Restyle",
      description: "2D cel-shaded anime look.",
      group: "Restyle Looks",
      data: { provider: "wan", prompt: "Restyle this video as a 2D cel-shaded anime: vibrant colors, clean linework, expressive cel shading. Preserve the original motion, composition, and timing.", negativePrompt: "photorealistic, blurry, distorted, flickering" },
    },
    {
      id: "video-to-video/claymation",
      name: "Claymation",
      description: "Tactile stop-motion clay.",
      group: "Restyle Looks",
      data: { provider: "wan", prompt: "Restyle as tactile stop-motion claymation with plasticine textures and subtle fingerprints. Keep the original motion and framing.", negativePrompt: "photorealistic, smooth, flickering" },
    },
    {
      id: "video-to-video/cyberpunk-neon",
      name: "Cyberpunk Neon",
      description: "Rain-slicked neon city look.",
      group: "Restyle Looks",
      data: { provider: "wan", prompt: "Restyle with a neon cyberpunk aesthetic: rain-slicked surfaces, glowing magenta and cyan lighting, moody atmosphere. Preserve the original motion.", negativePrompt: "daylight, flat lighting, blurry, distorted" },
    },
    {
      id: "video-to-video/oil-painting",
      name: "Oil Painting",
      description: "Moving painterly brushwork.",
      group: "Restyle Looks",
      data: { provider: "wan", prompt: "Restyle as a moving oil painting with visible brushstrokes, rich impasto texture, and painterly color. Keep the original motion and composition.", negativePrompt: "photorealistic, flat, blurry, flickering" },
    },
    {
      id: "video-to-video/pixar-3d",
      name: "3D Animated",
      description: "Polished CG film look.",
      group: "Restyle Looks",
      data: { provider: "wan", prompt: "Restyle as a polished 3D animated film: soft global illumination, expressive characters, clean stylized surfaces. Preserve the original motion and timing.", negativePrompt: "photorealistic, lowres, distorted, flickering" },
    },
    {
      id: "video-to-video/watercolor",
      name: "Watercolor",
      description: "Flowing washes on paper.",
      group: "Restyle Looks",
      data: { provider: "wan", prompt: "Restyle as a flowing watercolor animation with soft washes, bleeding edges, and visible paper texture. Keep the original motion and composition.", negativePrompt: "photorealistic, harsh edges, blurry, flickering" },
    },
  ],
  // voice-changer DELIVERY presets — reshape the revoice without touching the target
  // voice the user picked. stability/similarityBoost/style 0-1; removeBackgroundNoise cleans the source.
  "voice-changer": [
    {
      id: "voice-changer/faithful",
      name: "Faithful (Natural)",
      description: "Preserves original delivery.",
      group: "Revoice Styles",
      data: { stability: 0.4, similarityBoost: 0.85, style: 0, removeBackgroundNoise: false },
    },
    {
      id: "voice-changer/clean-stable",
      name: "Clean & Stable",
      description: "Smooth, consistent, denoised.",
      group: "Revoice Styles",
      data: { stability: 0.8, similarityBoost: 0.8, style: 0, removeBackgroundNoise: true },
    },
    {
      id: "voice-changer/expressive",
      name: "Expressive",
      description: "Amplifies the delivery.",
      group: "Revoice Styles",
      data: { stability: 0.3, similarityBoost: 0.7, style: 0.45, removeBackgroundNoise: false },
    },
    {
      id: "voice-changer/studio-clean",
      name: "Studio Clean",
      description: "Broadcast-ready, denoised.",
      group: "Revoice Styles",
      data: { stability: 0.65, similarityBoost: 0.85, style: 0, removeBackgroundNoise: true },
    },
  ],
  // add-captions STYLE presets. style in ALL_CAPTION_STYLES (subtitle is static FFmpeg;
  // the rest are kinetic Remotion overlays); position bottom|top|center; fontSize 12-200.
  "add-captions": [
    {
      id: "add-captions/clean-subtitles",
      name: "Clean Subtitles",
      description: "Classic bottom subtitles.",
      group: "Caption Styles",
      data: { style: "subtitle", position: "bottom", fontSize: 32, color: "#FFFFFF", autoTranscribe: true },
    },
    {
      id: "add-captions/tiktok-bold",
      name: "TikTok Bold",
      description: "Big centered word-by-word.",
      group: "Caption Styles",
      data: { style: "tiktok-words", position: "center", fontSize: 72, color: "#FFFFFF", autoTranscribe: true },
    },
    {
      id: "add-captions/karaoke",
      name: "Karaoke Highlight",
      description: "Words fill as spoken.",
      group: "Caption Styles",
      data: { style: "karaoke", position: "bottom", fontSize: 56, color: "#FFFFFF", autoTranscribe: true },
    },
    {
      id: "add-captions/word-pop",
      name: "Word Pop",
      description: "Each word pops in.",
      group: "Caption Styles",
      data: { style: "word-pop", position: "center", fontSize: 64, color: "#FFE600", autoTranscribe: true },
    },
    {
      id: "add-captions/bouncy",
      name: "Bouncy Captions",
      description: "Energetic bouncing words.",
      group: "Caption Styles",
      data: { style: "bouncy", position: "bottom", fontSize: 64, color: "#FFFFFF", autoTranscribe: true },
    },
    {
      id: "add-captions/word-highlight",
      name: "Word Highlight",
      description: "Active word highlighted.",
      group: "Caption Styles",
      data: { style: "word-highlight", position: "bottom", fontSize: 48, color: "#00E5FF", autoTranscribe: true },
    },
    {
      id: "add-captions/top-banner",
      name: "Top Banner",
      description: "Subtitles along the top.",
      group: "Caption Styles",
      data: { style: "subtitle", position: "top", fontSize: 36, color: "#FFFFFF", autoTranscribe: true },
    },
  ],
  // combine-videos JOIN/TRANSITION presets. "Seamless Join" is the proven recipe for
  // jump-free joins of CONTINUOUS shots (start/end-frame storyboards, Seedance-2 scene
  // extension): keep a hard CUT so the shot stays one continuous take, trim the artifact
  // boundary frames (end 4, start 3), and equal-power crossfade ONLY the audio.
  "combine-videos": [
    {
      id: "combine-videos/seamless-join",
      name: "Seamless Join (One-Shot)",
      description: "Jump-free join for scene-extension / start-end-frame clips.",
      group: "Joins & Transitions",
      data: { transition: "cut", transitionDuration: 0.5, audioMode: "crossfade", audioCrossfadeCurve: "equal-power", trimEndFrames: 4, trimStartFrames: 3 },
    },
    {
      id: "combine-videos/hard-cut",
      name: "Hard Cut",
      description: "Instant switch, no blend. Fastest.",
      group: "Joins & Transitions",
      data: { transition: "cut", audioMode: "keep", trimStartFrames: 0, trimEndFrames: 0 },
    },
    {
      id: "combine-videos/crossfade",
      name: "Crossfade",
      description: "Smooth alpha cross-fade between clips.",
      group: "Joins & Transitions",
      data: { transition: "fade", transitionDuration: 0.7, audioMode: "crossfade", audioCrossfadeCurve: "equal-power" },
    },
    {
      id: "combine-videos/dissolve",
      name: "Dissolve",
      description: "Grainy organic blend for memory beats.",
      group: "Joins & Transitions",
      data: { transition: "dissolve", transitionDuration: 1, audioMode: "crossfade", audioCrossfadeCurve: "equal-power" },
    },
    {
      id: "combine-videos/fade-through-black",
      name: "Fade Through Black",
      description: "Dip to black between scenes.",
      group: "Joins & Transitions",
      data: { transition: "dip-to-black", transitionDuration: 1, audioMode: "crossfade", audioCrossfadeCurve: "equal-power" },
    },
  ],
}

export function getFactoryPresets(nodeType: string): readonly FactoryPreset[] {
  return FACTORY_PRESETS[nodeType] ?? []
}

/**
 * Curated "most commonly used" factory presets per node, in popularity order. The preset dropdown
 * surfaces these in a "Popular" quick-pick band at the top of the Factory section so the highest-
 * traffic presets are reachable without expanding folders. Every id MUST exist in
 * {@link FACTORY_PRESETS} for its node (guarded by a test). Nodes absent here show no Popular band.
 */
export const FACTORY_POPULAR_IDS: Readonly<Record<string, readonly string[]>> = {
  "generate-image": [
    "generate-image/cinematic-portrait",
    "generate-image/product-shot",
    "generate-image/youtube-thumbnail",
    "generate-image/logo-wordmark",
    "generate-image/instagram-post",
    "generate-image/character-portrait",
  ],
  "generate-video": [
    "generate-video/slow-push-in",
    "generate-video/orbit-360",
    "generate-video/vertical-hero",
    "generate-video/product-hero",
    "generate-video/slow-motion",
    "generate-video/establishing-wide",
  ],
  "text-to-speech": [
    "text-to-speech/narrator-calm",
    "text-to-speech/audiobook",
    "text-to-speech/news-anchor",
    "text-to-speech/podcast-host",
    "text-to-speech/commercial",
  ],
  "text-to-audio": [
    "text-to-audio/whoosh",
    "text-to-audio/impact-boom",
    "text-to-audio/riser",
    "text-to-audio/rain-ambience",
    "text-to-audio/notification",
  ],
  "generate-music": [
    "generate-music/lofi-study",
    "generate-music/cinematic-trailer",
    "generate-music/corporate-upbeat",
    "generate-music/vlog-background",
    "generate-music/edm-drop",
  ],
  "suno-generate": [
    "suno-generate/song-pop",
    "suno-generate/lofi-study",
    "suno-generate/cinematic-trailer",
    "suno-generate/song-rap",
    "suno-generate/edm-drop",
  ],
  "llm-chat": [
    "llm-chat/concise-assistant",
    "llm-chat/copywriter",
    "llm-chat/summarizer",
    "llm-chat/rewrite-tone",
    "llm-chat/json-extractor",
  ],
  "generate-script": [
    "generate-script/yt-short",
    "generate-script/explainer",
    "generate-script/ad-spot",
    "generate-script/product-demo",
  ],
  "image-to-text": [
    "image-to-text/alt-text",
    "image-to-text/social-caption",
    "image-to-text/ocr",
    "image-to-text/tags",
  ],
  "voice-design": [
    "voice-design/trailer-narrator",
    "voice-design/audiobook-female",
    "voice-design/friendly-assistant",
    "voice-design/hype-announcer",
  ],
  "video-to-video": [
    "video-to-video/anime",
    "video-to-video/cyberpunk-neon",
    "video-to-video/claymation",
    "video-to-video/pixar-3d",
  ],
  "voice-changer": [
    "voice-changer/faithful",
    "voice-changer/clean-stable",
    "voice-changer/studio-clean",
  ],
  "add-captions": [
    "add-captions/tiktok-bold",
    "add-captions/clean-subtitles",
    "add-captions/karaoke",
    "add-captions/word-pop",
  ],
  "combine-videos": [
    "combine-videos/seamless-join",
    "combine-videos/crossfade",
    "combine-videos/hard-cut",
  ],
}

/**
 * The curated popular presets for a node, resolved to {@link FactoryPreset} objects in popularity
 * order. Ids with no matching preset are skipped (robust against catalog edits).
 */
export function getPopularFactoryPresets(nodeType: string): FactoryPreset[] {
  const ids = FACTORY_POPULAR_IDS[nodeType]
  if (!ids) return []
  const byId = new Map(getFactoryPresets(nodeType).map((p) => [p.id, p]))
  return ids.map((id) => byId.get(id)).filter((p): p is FactoryPreset => p !== undefined)
}
