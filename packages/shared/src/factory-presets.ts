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
          "epic cinematic widescreen still of {subject}, anamorphic 2.39:1 framing, atmospheric haze, dramatic lighting, color graded, film grain",
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
          "stylized avatar profile picture of {subject}, centered head-and-shoulders, clean solid-color background, bold and friendly",
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
          "product packaging mockup of {product}, {box or bottle or pouch}, photorealistic printed label, studio lighting, clean background",
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
          "{smartphone or laptop or tablet} mockup displaying {screen content}, clean studio setting, slight angle, soft reflections, crisp screen",
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
          "minimalist wordmark logo for '{brand}', clean modern typography, flat vector style, centered, solid background, professional",
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
          "emblem badge logo for '{brand}', {concept}, circular composition, flat vector, limited color palette, crisp edges, white background",
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
          "mascot logo for '{brand}', friendly {character} mascot, bold flat colors, clean vector style, white background",
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
          "modern app icon for '{app}', rounded square, simple bold glyph of {concept}, subtle gradient, centered, flat design",
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
          "elegant monogram logo combining the letters '{initials}', refined geometric design, single color, white background",
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
          "vertical social story graphic about {topic}, full-bleed background, bold headline text '{TEXT}', modern design",
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
          "inspirational quote card with the text '{quote}', elegant typography, {background style}, balanced composition",
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
          "web banner for {brand or topic}, wide horizontal layout, clean modern design, headline text '{TEXT}', space for a logo",
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
          "movie poster for '{title}', cinematic key art, dramatic hero composition, atmospheric lighting, title treatment at the bottom, tagline",
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
          "event poster for '{event}', {date and venue}, bold graphic design, striking typography, eye-catching",
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
          "book cover for '{title}' by {author}, {genre} mood and imagery, title and author typography, professional cover design",
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
          "album cover art for '{title}', {genre} aesthetic, striking central image, mood-setting color palette",
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
      name: "Pixel Art",
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
          "tattoo flash design of {subject}, {traditional or fine-line or blackwork} style, bold clean linework, isolated on white",
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
          "storyboard frame: {shot description}, {wide or medium or close-up} shot, rough black-and-white sketch, clear composition, {camera angle}, arrows indicating motion",
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
  ],

  // Selective / hybrid stylization — a TRANSFORM pattern (existing photo in →
  // partially restyled out), so it lives on the modify-image node, not
  // text-to-image. The "only the X" instruction lives in the prompt because the
  // `style` field would restyle the whole frame. Editors that preserve untouched
  // regions (nano-banana-pro / gpt-image-2-i2i / Flux Kontext) work best.
  "modify-image": [
    {
      id: "modify-image/cartoon-person-real-world",
      name: "Cartoon Person, Real World",
      description: "Subject → 3D cartoon, rest stays photoreal.",
      group: "Stylized Subject",
      data: {
        provider: "nano-banana-pro",
        prompt:
          "Turn the person into a stylized 3D cartoon character (Pixar/Disney look). Important: only the person becomes a cartoon — keep the background, clothing textures, lighting, and everything else photorealistic and unchanged.",
      },
    },
    {
      id: "modify-image/caricature-real-photo",
      name: "Caricature, Real Photo",
      description: "Exaggerated cartoon head on a real scene.",
      group: "Stylized Subject",
      data: {
        provider: "nano-banana-pro",
        prompt:
          "Exaggerate the person into a caricature with an oversized head and amplified features, in a fun illustrated style. Keep the body, background, and overall scene photorealistic and unchanged.",
      },
    },
    {
      id: "modify-image/anime-person-real-bg",
      name: "Anime Person, Real Background",
      description: "Subject → 2D anime, real environment.",
      group: "Stylized Subject",
      data: {
        provider: "nano-banana-pro",
        prompt:
          "Restyle only the person as a 2D anime character with cel shading. Keep the real-world background, lighting, and environment photorealistic and untouched.",
      },
    },
    {
      id: "modify-image/real-person-cartoon-world",
      name: "Real Person, Cartoon World",
      description: "Inverse — real subject, stylized world.",
      group: "Stylized Subject",
      data: {
        provider: "nano-banana-pro",
        prompt:
          "Keep the person photorealistic and unchanged. Transform only the background and environment into a colorful stylized cartoon world.",
      },
    },
    {
      id: "modify-image/claymation-figure-real-set",
      name: "Claymation Figure, Real Set",
      description: "Subject → clay figure, real surroundings.",
      group: "Stylized Subject",
      data: {
        provider: "nano-banana-pro",
        prompt:
          "Turn the person into a tactile stop-motion claymation figure with visible fingerprints and plasticine texture. Keep the surrounding set and background photorealistic.",
      },
    },
  ],
  "generate-video": [
    {
      id: "generate-video/subtle-motion",
      name: "Subtle Motion",
      description: "Gentle, natural movement.",
      data: {
        aspectRatio: "16:9",
        prompt: "subtle natural motion, gentle camera drift, cinematic",
      },
    },
  ],
  "text-to-speech": [
    {
      id: "text-to-speech/narrator-calm",
      name: "Narrator (calm)",
      description: "Even, measured narration.",
      data: { speed: 1, stability: 0.6, similarityBoost: 0.75, style: 0 },
    },
  ],
  "generate-music": [
    {
      id: "generate-music/ambient-cinematic",
      name: "Ambient Cinematic",
      description: "Atmospheric instrumental bed.",
      data: { genre: "cinematic", mood: "atmospheric", instrumental: true },
    },
  ],
  "llm-chat": [
    {
      id: "llm-chat/concise-assistant",
      name: "Concise Assistant",
      description: "Short, direct answers.",
      data: {
        systemPrompt: "You are a concise assistant. Answer in 1-3 sentences. No preamble.",
        temperature: 0.3,
      },
    },
    {
      id: "llm-chat/json-extractor",
      name: "JSON Extractor",
      description: "Returns strict JSON only.",
      data: {
        systemPrompt:
          "Extract the requested fields and return ONLY valid minified JSON. No prose, no code fences.",
        temperature: 0,
      },
    },
  ],
}

export function getFactoryPresets(nodeType: string): readonly FactoryPreset[] {
  return FACTORY_PRESETS[nodeType] ?? []
}
