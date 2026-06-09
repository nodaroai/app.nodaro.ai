import type { FactoryPreset } from "./types.js"
import { stylizedSubjectFor, editsFor } from "./shared-image.js"

export const GENERATE_IMAGE_PRESETS: readonly FactoryPreset[] = [
  // ── Reference Sheet ──────────────────────────────────────────────────────
  {
    id: "generate-image/character-board",
    name: "Character Board",
    description: "Connect a photo → dense character reference sheet.",
    group: "Reference Sheet",
    data: {
      provider: "nano-banana-pro",
      aspectRatio: "16:9",
      resolution: "2K",
      prompt: `Create a single high-resolution, densely packed character reference sheet titled "CHARACTER BOARD" using the attached photo of the person as the single source of truth for face, hair, beard, eyes, skin tone and body proportions. The same person must appear in every panel — same age, same features. Outfit identical to the attached photo across all panels. All on-image labels in ENGLISH. Editorial reference-board layout with a dark near-black background, thin yellow neon accent light, faint film-grain overlay, and production-grade character-design UI. The composition should feel organized but not rigidly locked: allow the main portrait, metadata, and supporting panels to shift position naturally within the board. The panel arrangement can vary from generation to generation while remaining readable, balanced, and premium. Design the board so it works cleanly in different aspect ratios without depending on a fixed left-column structure. Include: A large hero portrait or 3/4-length character image, accompanied by a detailed metadata block: NAME · AGE · HEIGHT · BUILD · HAIR · EYES · FEATURES · OUTFIT (describe the exact clothing from the attached photo) · CHARACTER · MOOD. Also include six content groupings: PANEL 01 — VIEWS (4 full-body angles, neutral pose, identical lighting): FRONT · 3/4 LEFT · SIDE LEFT · BACK. PANEL 02 — EXPRESSIONS (5 tight headshots, same lighting): CALM · LAUGHING · INTENSE · CONTEMPLATIVE · CONFIDENT. PANEL 03 — DETAILS (3 macros): face/eyes close-up · hand close-up (showing ring, watch or cuff) · distinctive outfit detail. PANEL 04 — OUTFIT FLAT-LAYS (5 isolated product shots on dark background): outerwear · top · bottom · footwear · main accessory. PANEL 05 — LIGHTING / MOOD (4 same-pose portraits under different lighting): SOFT WINDOW LIGHT · GOLDEN HOUR · COOL BLUE NIGHT · DRAMATIC RIM-LIGHT. PANEL 06 — COLOR PALETTE: 6 swatches with HEX codes derived from the outfit and skin tones. Bottom caption: "Use this character board as a visual reference for consistent depiction of the character across all generations." Bottom-right tags: STYLE · Modern · Realistic · Cinematic. Style: photorealistic, no illustration. Consistent face across every single panel. 8K, fine grain, cinematic color grading.`,
      negativePrompt:
        "illustration, cartoon, 3d render, garbled text, misspelled labels, watermark, deformed faces, blurry, low resolution",
    },
  },
  {
    id: "generate-image/location-board",
    name: "Location Board",
    description: "Connect a photo → dense location reference sheet.",
    group: "Reference Sheet",
    data: {
      provider: "nano-banana-pro",
      aspectRatio: "16:9",
      resolution: "2K",
      prompt: `Create a single high-resolution, densely packed location reference sheet titled "LOCATION BOARD" using the attached photo of the location as the single source of truth for its architecture, atmosphere, lighting, materials and color palette. The space must be identical across every panel — same place, same materials, same era. All on-image labels in ENGLISH. Editorial location-reference board layout with a dark near-black background, thin yellow neon accent light on the far left, faint film-grain overlay, subtle cinematic interface elements, and production-grade location-scout UI. The composition should feel structured but not rigidly fixed: allow the hero location view, metadata, environmental studies, and supporting panels to shift position naturally within the board. The arrangement may vary from generation to generation while remaining readable, balanced, and premium. Design the board so it adapts cleanly to different aspect ratios without depending on a fixed left-column layout. Include a prominent hero shot of the location, ideally a wide establishing or defining view, accompanied by a detailed metadata block: NAME · TYPE (street / interior / exterior / forest) · ERA · SCALE (intimate / vast) ARCHITECTURE: (key features) MATERIALS: (stone, brick, wood, glass, etc.) ATMOSPHERE: (busy / quiet / eerie / romantic) DEFAULT TIME · DEFAULT WEATHER · PURPOSE (e.g. chase sequence, dialogue scene). Also include six content groupings: PANEL 01 — VIEWS (5 same-location shots, identical lighting): WIDE · MID · TIGHT · ALT ANGLE · OVERHEAD. PANEL 02 — TIME OF DAY (4 same-angle shots): DAWN · NOON · DUSK · NIGHT. PANEL 03 — DETAILS (2 macros): material/texture close-up · distinctive architectural detail. PANEL 04 — SET DRESSING / PROPS (5 isolated prop or signage studies on dark background): 5 key props or signage elements from the location. PANEL 05 — WEATHER / MOOD (4 same-angle shots): CLEAR SUNNY · OVERCAST · RAIN-SOAKED · MISTY FOG. PANEL 06 — COLOR PALETTE: 6 swatches with HEX codes from the location's dominant tones. Bottom caption: "Use this location board as a visual reference for consistent depiction of the environment across all generations." Bottom-right tags: STYLE · Modern · Realistic · Cinematic. Style: photorealistic, no illustration. Consistent location across every panel. 8K, fine grain, cinematic color grading.`,
      negativePrompt:
        "illustration, cartoon, 3d render, garbled text, misspelled labels, watermark, deformed faces, blurry, low resolution",
    },
  },
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
  {
    id: "generate-image/sports-jersey-portrait",
    name: "Sports Jersey Portrait",
    description: "You in an oversized team jersey, studio editorial. Needs a reference photo.",
    group: "Portrait Transformations",
    data: {
      provider: "nano-banana-pro",
      aspectRatio: "4:5",
      prompt:
        "Premium studio portrait of the person in the reference image wearing an oversized modern football jersey in the colors of {team}. Strictly preserve identity — exact face, bone structure, skin tone, and all unique features. Soft directional stadium-spotlight lighting with natural shadow depth; a monochrome or gradient backdrop in the team colors with a subtle geometric pattern and faint pitch markings; gentle atmospheric haze and light film grain. Confident, relaxed pose, sharp focus on the subject against a softly blurred background. High-end sports-fashion editorial, 8K, cinematic framing.",
      negativePrompt: "different face, inconsistent identity, deformed, distorted logo, watermark, text artifacts",
    },
  },
  // ── Stylized Subject + Edits (shared with the deprecating modify-image) ──
  // Transform patterns — work here when a reference image is connected
  // (nano-banana-pro edits it while preserving untouched regions). The
  // instruction lives in the prompt, not `style`.
  ...stylizedSubjectFor("generate-image"),
  ...editsFor("generate-image"),
]
