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
      id: "generate-video/pan-reveal",
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
        prompt: "vertical cinematic hero shot of {subject}, dynamic motion, punchy and eye-catching, optimized for social reels",
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
        prompt: "vertical talking-head shot of {subject} speaking to the camera, clean background, natural movement and expression",
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
        prompt: "vertical product reveal of {product}, dynamic rotation and pop, eye-catching, social-ready",
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
        prompt: "energetic vertical clip of {subject}, fast dynamic motion, trendy and high-energy social video",
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
        prompt: "vertical POV shot walking through {location}, immersive first-person, handheld feel",
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
        prompt: "animated logo sting: {brand} logo assembles with light streaks and a clean reveal, short and punchy, on a solid background",
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
        aspectRatio: "16:9",
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
      name: "Funk",
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
      name: "House / EDM",
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
      name: "Rock Anthem",
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
