import type { FactoryPreset } from "./types.js"
import { stylizedSubjectFor, editsFor } from "./shared-image.js"

export const GENERATE_IMAGE_PRESETS: readonly FactoryPreset[] = [
  // ── Reference Sheet ──────────────────────────────────────────────────────
  {
    id: "generate-image/character-board",
    name: "Character Board",
    description: "Connect a sharp, well-lit photo → dense character sheet; reuse it as a reference for consistent shots.",
    group: "Reference Sheet",
    data: {
      provider: "nano-banana-pro",
      aspectRatio: "16:9",
      resolution: "2K",
      prompt: `Create a single high-resolution, densely packed character reference sheet titled "CHARACTER BOARD" using the attached photo of the person as the single source of truth for face, hair, beard, eyes, skin tone and body proportions. The same person must appear in every panel — same age, same features. Outfit identical to the attached photo across all panels. All on-image labels in ENGLISH. Editorial reference-board layout with a dark near-black background, thin yellow neon accent light, faint film-grain overlay, and production-grade character-design UI. The composition should feel organized but not rigidly locked: allow the main portrait, metadata, and supporting panels to shift position naturally within the board. The panel arrangement can vary from generation to generation while remaining readable, balanced, and premium. Design the board so it works cleanly in different aspect ratios without depending on a fixed left-column structure. Include: A large hero portrait or 3/4-length character image, accompanied by a detailed metadata block: NAME · AGE · HEIGHT · BUILD · HAIR · EYES · FEATURES · OUTFIT (describe the exact clothing from the attached photo) · CHARACTER · MOOD. Also include six content groupings — render ALL six panel headings exactly as written, never merging or omitting a panel: PANEL 01 — VIEWS (5 full-body shots, neutral pose, identical outfit and lighting, neutral tan backdrop): FRONT · 3/4 LEFT · SIDE LEFT · BACK · 3/4 RIGHT. PANEL 02 — EXPRESSIONS (5 tight headshots, same lighting): CALM · LAUGHING · INTENSE · CONTEMPLATIVE · CONFIDENT. PANEL 03 — DETAILS (3 macros): face/eyes close-up · hand close-up (showing ring, watch or cuff) · distinctive outfit detail. PANEL 04 — OUTFIT FLAT-LAYS (5 isolated product shots on dark background): outerwear · top · bottom · footwear · main accessory. PANEL 05 — LIGHTING / MOOD (4 same-pose portraits under different lighting): SOFT WINDOW LIGHT · GOLDEN HOUR · COOL BLUE NIGHT · DRAMATIC RIM-LIGHT. PANEL 06 — COLOR PALETTE: 6 swatches with HEX codes derived from the outfit and skin tones. Bottom caption: "Use this character board as a visual reference for consistent depiction of the character across all generations." Bottom-right tags: STYLE · Modern · Realistic · Cinematic. Style: photorealistic, no illustration. Consistent face across every single panel. 8K, fine grain, cinematic color grading.`,
      negativePrompt:
        "illustration, cartoon, 3d render, garbled text, misspelled labels, watermark, deformed faces, blurry, low resolution",
    },
  },
  {
    id: "generate-image/pose-board",
    name: "Pose Board",
    description: "Connect a sharp photo → animation-ready pose & expression sheet; reuse it as a reference for consistent action.",
    group: "Reference Sheet",
    data: {
      provider: "nano-banana-pro",
      aspectRatio: "16:9",
      resolution: "2K",
      prompt: `Create a single high-resolution, densely packed pose reference sheet titled "POSE BOARD" using the attached photo of the person as the single source of truth for face, hair, eyes, skin tone, body proportions and outfit. The same person must appear in every panel — same age, same features, outfit identical to the attached photo across all panels. All on-image labels in ENGLISH. Editorial reference-board layout with a dark near-black background, thin yellow neon accent light, faint film-grain overlay, and production-grade animation-planning UI. The composition should feel organized but not rigidly locked: allow the hero figure, metadata, and supporting panels to shift position naturally within the board while remaining readable, balanced, and premium. Design the board to adapt cleanly to different aspect ratios without depending on a fixed left-column layout. Include a large full-body hero shot in a relaxed standing pose with a metadata block: NAME · AGE · BUILD · HEIGHT · OUTFIT · POSE LANGUAGE · CENTER OF GRAVITY · DOMINANT HAND · PURPOSE. Also include five content groupings — render ALL five panel headings exactly as written, never merging or omitting a panel: PANEL 01 — BASIC POSES (5 full-body shots, identical outfit and lighting, neutral tan backdrop): STANDING · SITTING · WALKING · RUNNING · JUMPING. PANEL 02 — ACTION POSES (5 dynamic full-body shots with clear silhouettes): FIGHT STANCE · THROW · DODGE · CLIMB · LAND. PANEL 03 — EXPRESSIONS (5 tight headshots, same lighting): NEUTRAL · LAUGHING · ANGRY · SAD · SURPRISED. PANEL 04 — ANGLE COVERAGE (4 chest-up portraits): FRONT · 3/4 · SIDE · BACK. PANEL 05 — COLOR PALETTE: 6 swatches with HEX codes derived from the outfit and skin tones. Bottom caption: "Use this pose board as a visual reference for consistent posing of the character across all generations." Bottom-right tags: STYLE · Modern · Realistic · Cinematic. Style: photorealistic, no illustration. Consistent identity across every single panel. 8K, fine grain, cinematic color grading.`,
      negativePrompt:
        "illustration, cartoon, 3d render, garbled text, misspelled labels, watermark, deformed faces, inconsistent identity between panels, extra limbs, blurry, low resolution",
    },
  },
  {
    id: "generate-image/location-board",
    name: "Location Board",
    description: "Connect a photo → dense location sheet; reuse it as a reference for consistent scenes.",
    group: "Reference Sheet",
    data: {
      provider: "nano-banana-pro",
      aspectRatio: "16:9",
      resolution: "2K",
      prompt: `Create a single high-resolution, densely packed location reference sheet titled "LOCATION BOARD" using the attached photo of the location as the single source of truth for its architecture, atmosphere, lighting, materials and color palette. The space must be identical across every panel — same place, same materials, same era. All on-image labels in ENGLISH. Editorial location-reference board layout with a dark near-black background, thin yellow neon accent light on the far left, faint film-grain overlay, subtle cinematic interface elements, and production-grade location-scout UI. The composition should feel structured but not rigidly fixed: allow the hero location view, metadata, environmental studies, and supporting panels to shift position naturally within the board. The arrangement may vary from generation to generation while remaining readable, balanced, and premium. Design the board so it adapts cleanly to different aspect ratios without depending on a fixed left-column layout. Include a prominent hero shot of the location, ideally a wide establishing or defining view, accompanied by a detailed metadata block: NAME · TYPE (street / interior / exterior / forest) · ERA · SCALE (intimate / vast) ARCHITECTURE: (key features) MATERIALS: (stone, brick, wood, glass, etc.) ATMOSPHERE: (busy / quiet / eerie / romantic) DEFAULT TIME · DEFAULT WEATHER · PURPOSE (e.g. chase sequence, dialogue scene). Also include six content groupings — render ALL six panel headings exactly as written, never merging or omitting a panel: PANEL 01 — VIEWS (5 same-location shots, identical lighting): WIDE · MID · TIGHT · ALT ANGLE · OVERHEAD. PANEL 02 — TIME OF DAY (4 same-angle shots): DAWN · NOON · DUSK · NIGHT. PANEL 03 — DETAILS (2 macros): material/texture close-up · distinctive architectural detail. PANEL 04 — SET DRESSING / PROPS (5 isolated prop or signage studies on dark background): 5 key props or signage elements from the location. PANEL 05 — WEATHER / MOOD (4 same-angle shots): CLEAR SUNNY · OVERCAST · RAIN-SOAKED · MISTY FOG. PANEL 06 — COLOR PALETTE: 6 swatches with HEX codes from the location's dominant tones. Bottom caption: "Use this location board as a visual reference for consistent depiction of the environment across all generations." Bottom-right tags: STYLE · Modern · Realistic · Cinematic. Style: photorealistic, no illustration. Consistent location across every panel. 8K, fine grain, cinematic color grading.`,
      negativePrompt:
        "illustration, cartoon, 3d render, garbled text, misspelled labels, watermark, deformed faces, blurry, low resolution",
    },
  },
  {
    id: "generate-image/product-board",
    name: "Product Board",
    description: "Connect a photo → dense product sheet; reuse it as a reference for consistent shots.",
    group: "Reference Sheet",
    data: {
      provider: "nano-banana-pro",
      aspectRatio: "16:9",
      resolution: "2K",
      prompt: `Create a single high-resolution, densely packed product reference sheet titled "PRODUCT BOARD" using the attached photo of the product as the single source of truth for its shape, materials, colorway, proportions, branding and finish. The same product must appear in every panel — identical model, identical colorway and markings. All on-image labels in ENGLISH. Editorial product-reference layout with a dark near-black background, thin yellow neon accent light, faint film-grain overlay, and production-grade industrial-design UI. The composition should feel organized but not rigidly locked: allow the hero shot, metadata, and supporting panels to shift position naturally within the board while remaining readable, balanced, and premium. Design the board to adapt cleanly to different aspect ratios without depending on a fixed left-column layout. Include a large hero product shot with a metadata block: NAME · CATEGORY · BRAND · DIMENSIONS · WEIGHT · MATERIALS · FINISH · KEY FEATURES · COLORWAY. Also include six content groupings — render ALL six panel headings exactly as written, never merging or omitting a panel: PANEL 01 — VIEWS (5 studio shots on a seamless background, identical lighting): FRONT · 3/4 · SIDE · BACK · TOP. PANEL 02 — DETAILS (3 macros): material/texture close-up · seam/joint or mechanism · logo/branding detail. PANEL 03 — COLORWAYS (4 isolated shots of the same product in alternate finishes). PANEL 04 — SCALE (the product beside a common reference object, with a dimension callout). PANEL 05 — IN USE / CONTEXT (3 lifestyle shots in a real setting). PANEL 06 — COLOR PALETTE: 6 swatches with HEX codes from the product's materials and finish. Bottom caption: "Use this product board as a visual reference for consistent depiction of the product across all generations." Bottom-right tags: STYLE · Modern · Realistic · Studio. Style: photorealistic, no illustration. Consistent product across every panel. 8K, fine grain, studio product photography, crisp reflections.`,
      negativePrompt:
        "illustration, cartoon, 3d render, garbled text, misspelled labels, watermark, deformed faces, blurry, low resolution",
    },
  },
  {
    id: "generate-image/outfit-board",
    name: "Outfit Board",
    description: "Connect a photo → dense wardrobe sheet; reuse it as a reference for consistent looks.",
    group: "Reference Sheet",
    data: {
      provider: "nano-banana-pro",
      aspectRatio: "16:9",
      resolution: "2K",
      prompt: `Create a single high-resolution, densely packed wardrobe reference sheet titled "OUTFIT BOARD" using the attached photo of the outfit as the single source of truth for its garments, fabrics, colorway, silhouette and styling. The same outfit must appear in every panel — identical garments, identical colors and trims. All on-image labels in ENGLISH. Editorial fashion-reference layout with a dark near-black background, thin yellow neon accent light, faint film-grain overlay, and production-grade stylist UI. The composition should feel organized but not rigidly locked: allow the hero look, metadata, and supporting panels to shift position naturally while remaining readable, balanced, and premium. Design the board to adapt cleanly to different aspect ratios without depending on a fixed left-column layout. Include a hero full-look shot with a metadata block: LOOK NAME · STYLE · SEASON · FABRICS · PALETTE · FIT · OCCASION. Also include six content groupings — render ALL six panel headings exactly as written, never merging or omitting a panel: PANEL 01 — ON-BODY VIEWS (5 full-length shots, identical lighting): FRONT · 3/4 LEFT · SIDE · BACK · 3/4 RIGHT. PANEL 02 — FLAT-LAYS (5 isolated garment shots on a dark surface): top · bottom · outerwear · footwear · headwear. PANEL 03 — FABRIC & DETAIL (3 macros): weave/texture close-up · stitching or hardware · print or trim detail. PANEL 04 — ACCESSORIES (4 isolated accessory studies: bag · jewelry · belt · eyewear). PANEL 05 — COLORWAYS (3 alternate colorways of the same look). PANEL 06 — COLOR PALETTE: 6 swatches with HEX codes from the garments. Bottom caption: "Use this outfit board as a visual reference for consistent depiction of the wardrobe across all generations." Bottom-right tags: STYLE · Modern · Editorial · Fashion. Style: photorealistic, no illustration. Consistent outfit across every panel. 8K, fine grain, editorial fashion photography.`,
      negativePrompt:
        "illustration, cartoon, 3d render, garbled text, misspelled labels, watermark, deformed faces, blurry, low resolution",
    },
  },
  {
    id: "generate-image/scene-board",
    name: "Scene Board",
    description: "Connect a photo → set-dressing & props study; reuse it as a reference for consistent sets.",
    group: "Reference Sheet",
    data: {
      provider: "nano-banana-pro",
      aspectRatio: "16:9",
      resolution: "2K",
      prompt: `Create a single high-resolution, densely packed set-dressing reference sheet titled "SCENE BOARD" using the attached photo of the scene as the single source of truth for its props, set dressing, materials, signage and mood. The space and its contents must be consistent across every panel — same props, same materials, same era. All on-image labels in ENGLISH. Editorial set-decoration layout with a dark near-black background, thin yellow neon accent light, faint film-grain overlay, and production-grade art-department UI. The composition should feel organized but not rigidly locked: allow the hero shot, metadata, and supporting panels to shift position naturally while remaining readable, balanced, and premium. Design the board to adapt cleanly to different aspect ratios without depending on a fixed left-column layout. Include a hero establishing shot with a metadata block: SCENE NAME · TYPE · ERA · MOOD · KEY MATERIALS · PURPOSE. Also include six content groupings — render ALL six panel headings exactly as written, never merging or omitting a panel: PANEL 01 — KEY PROPS (5 isolated prop studies on a dark background). PANEL 02 — SIGNAGE / GRAPHICS (3 readable signage or printed-graphic elements from the scene). PANEL 03 — MATERIALS & TEXTURES (3 macros: surface · fabric/wood/metal · wear/patina). PANEL 04 — LAYOUT / BLOCKING (a simple top-down or wide diagram of where key elements sit). PANEL 05 — LIGHTING STATES (3 same-angle shots: day · practical-lit night · dramatic). PANEL 06 — COLOR PALETTE: 6 swatches with HEX codes from the scene's dominant tones. Bottom caption: "Use this scene board as a visual reference for consistent set dressing across all generations." Bottom-right tags: STYLE · Modern · Realistic · Cinematic. Style: photorealistic, no illustration. Consistent scene across every panel. 8K, fine grain, cinematic color grading.`,
      negativePrompt:
        "illustration, cartoon, 3d render, garbled text, misspelled labels, watermark, deformed faces, blurry, low resolution",
    },
  },
  {
    id: "generate-image/creature-board",
    name: "Creature Board",
    description: "Connect a sharp photo → dense creature sheet; reuse it as a reference for consistent shots.",
    group: "Reference Sheet",
    data: {
      provider: "nano-banana-pro",
      aspectRatio: "16:9",
      resolution: "2K",
      prompt: `Create a single high-resolution, densely packed creature reference sheet titled "CREATURE BOARD" using the attached photo of the creature as the single source of truth for its anatomy, silhouette, coloration, textures and features. The same creature must appear in every panel — identical species, identical markings and proportions. All on-image labels in ENGLISH. Editorial creature-design layout with a dark near-black background, thin yellow neon accent light, faint film-grain overlay, and production-grade concept-design UI. The composition should feel organized but not rigidly locked: allow the hero render, metadata, and supporting panels to shift position naturally while remaining readable, balanced, and premium. Design the board to adapt cleanly to different aspect ratios without depending on a fixed left-column layout. Include a large hero full-body render with a metadata block: NAME · SPECIES · SIZE · BUILD · COLORATION · TEXTURES · TEMPERAMENT · FEATURES · MOVEMENT · VOCALIZATION. Also include six content groupings — render ALL six panel headings exactly as written, never merging or omitting a panel: PANEL 01 — VIEWS (5 full-body angles, neutral pose, identical lighting): FRONT · 3/4 · SIDE · BACK · TOP-DOWN. PANEL 02 — POSES (4 dynamic full-body poses: idle · moving · alert · aggressive). PANEL 03 — DETAILS (3 macros): head/face close-up · hide/scale/fur texture · distinctive feature (claw, horn, fin). PANEL 04 — EXPRESSIONS (4 head studies showing temperament range). PANEL 05 — SCALE (the creature beside a human silhouette for size reference). PANEL 06 — COLOR PALETTE: 6 swatches with HEX codes from the creature's coloration. Bottom caption: "Use this creature board as a visual reference for consistent depiction of the creature across all generations." Bottom-right tags: STYLE · Modern · Realistic · Cinematic. Style: photorealistic, no illustration. Consistent creature across every panel. 8K, fine grain, cinematic color grading.`,
      negativePrompt:
        "illustration, cartoon, 3d render, garbled text, misspelled labels, watermark, deformed faces, blurry, low resolution",
    },
  },
  {
    id: "generate-image/vehicle-board",
    name: "Vehicle Board",
    description: "Connect a photo → dense vehicle sheet; reuse it as a reference for consistent shots.",
    group: "Reference Sheet",
    data: {
      provider: "nano-banana-pro",
      aspectRatio: "16:9",
      resolution: "2K",
      prompt: `Create a single high-resolution, densely packed vehicle reference sheet titled "VEHICLE BOARD" using the attached photo of the vehicle as the single source of truth for its body shape, proportions, paintwork, trim, wheels and condition. The same vehicle must appear in every panel — identical model, identical colorway, markings and wear. All on-image labels in ENGLISH. Editorial vehicle-reference layout with a dark near-black background, thin yellow neon accent light, faint film-grain overlay, and production-grade transportation-design UI. The composition should feel organized but not rigidly locked: allow the hero shot, metadata, and supporting panels to shift position naturally while remaining readable, balanced, and premium. Design the board to adapt cleanly to different aspect ratios without depending on a fixed left-column layout. Include a large three-quarter hero shot with a metadata block: NAME · TYPE · ERA · SCALE · BODY & MATERIALS · FINISH · SEATS · TOP SPEED · SIGNATURE FEATURE · ROLE. Also include six content groupings — render ALL six panel headings exactly as written, never merging or omitting a panel: PANEL 01 — VIEWS (5 studio shots, identical lighting): FRONT · 3/4 · SIDE · BACK · TOP-DOWN. PANEL 02 — INTERIOR / CABIN (4 close shots): cockpit through the window · dashboard detail · seats or cargo area · driver POV. PANEL 03 — DETAIL MACROS (4): headlight or light cluster · wheel and tire · badge or panel line · paint and wear close-up. PANEL 04 — IN MOTION (4 staged frames): driving straight · cornering · parked on an incline · night with headlights on. PANEL 05 — LIGHTING / MOOD (4 same-angle hero shots): DESERT MIDDAY · GOLDEN HOUR · STORMY OVERCAST · NIGHT NEON. PANEL 06 — COLOR PALETTE: 6 swatches with HEX codes from the paintwork and trim. Bottom caption: "Use this vehicle board as a visual reference for consistent depiction of the vehicle across all generations." Bottom-right tags: STYLE · Modern · Realistic · Cinematic. Style: photorealistic, no illustration. Consistent vehicle across every panel. 8K, fine grain, cinematic color grading.`,
      negativePrompt:
        "illustration, cartoon, 3d render, garbled text, misspelled labels, watermark, warped body panels, distorted geometry, blurry, low resolution",
    },
  },
  {
    id: "generate-image/food-board",
    name: "Food Board",
    description: "Connect a photo → dense dish sheet; reuse it as a reference for consistent food shots.",
    group: "Reference Sheet",
    data: {
      provider: "nano-banana-pro",
      aspectRatio: "16:9",
      resolution: "2K",
      prompt: `Create a single high-resolution, densely packed dish reference sheet titled "FOOD BOARD" using the attached photo of the dish as the single source of truth for its ingredients, plating, colors, textures and garnish. The same dish must appear in every panel — identical recipe, identical plating, bowl or plate, and props. All on-image labels in ENGLISH. Editorial culinary-reference layout with a dark near-black background, thin yellow neon accent light, faint film-grain overlay, and production-grade food-styling UI. The composition should feel organized but not rigidly locked: allow the hero shot, metadata, and supporting panels to shift position naturally while remaining readable, balanced, and premium. Design the board to adapt cleanly to different aspect ratios without depending on a fixed left-column layout. Include a large appetizing hero shot with a metadata block: DISH NAME · CUISINE · CATEGORY · KEY INGREDIENTS · TEXTURES · GARNISH · SERVED · AUDIENCE. Also include six content groupings — render ALL six panel headings exactly as written, never merging or omitting a panel: PANEL 01 — PLATING ANGLES (5 beauty shots, identical styling): TOP-DOWN · 3/4 HERO · SIDE · EXTREME CLOSE-UP · IN HAND OR WITH UTENSIL. PANEL 02 — INGREDIENT BREAKDOWN (5 isolated ingredient studies on a dark background). PANEL 03 — DETAIL MACROS (4): surface texture · glaze or sauce sheen · steam or freshness cue · garnish detail. PANEL 04 — IN CONTEXT (4 staged frames): steam rising · utensil lifting a bite · sauce pour frozen mid-action · hands holding the dish. PANEL 05 — LIGHTING / MOOD (4 same-angle hero shots): WARM APPETIZING · COOL EDITORIAL · HARD COMMERCIAL · MOODY DRAMATIC. PANEL 06 — COLOR PALETTE: 6 swatches with HEX codes from the dish and plating. Bottom caption: "Use this food board as a visual reference for consistent depiction of the dish across all generations." Bottom-right tags: STYLE · Modern · Realistic · Commercial. Style: photorealistic, no illustration. Consistent dish across every panel. 8K, fine grain, appetizing commercial color grading.`,
      negativePrompt:
        "illustration, cartoon, 3d render, garbled text, misspelled labels, watermark, unappetizing, plastic fake food, messy spills, blurry, low resolution",
    },
  },
  {
    id: "generate-image/mascot-board",
    name: "Mascot Board",
    description: "Connect a mascot image → brand-character sheet with brand applications; reuse it for a consistent mascot.",
    group: "Reference Sheet",
    data: {
      provider: "nano-banana-pro",
      aspectRatio: "16:9",
      resolution: "2K",
      prompt: `Create a single high-resolution, densely packed mascot reference sheet titled "MASCOT BOARD" using the attached image of the mascot as the single source of truth for its design, proportions, colors, materials and personality. The same mascot must appear in every panel — identical design, identical colors and details — rendered in the mascot's native art style read from the attached image (illustrated, plush, costumed or 3D), never drifting between styles. All on-image labels in ENGLISH. Editorial brand-character layout with a dark near-black background, thin yellow neon accent light, faint film-grain overlay, and production-grade brand-design UI. The composition should feel organized but not rigidly locked: allow the hero pose, metadata, and supporting panels to shift position naturally while remaining readable, balanced, and premium. Design the board to adapt cleanly to different aspect ratios without depending on a fixed left-column layout. Include a large hero pose with a metadata block: MASCOT NAME · BRAND · CATEGORY · MATERIAL / STYLE · PERSONALITY · CATCHPHRASE · SIZE · USE CASES. Also include six content groupings — render ALL six panel headings exactly as written, never merging or omitting a panel: PANEL 01 — VIEWS (5 full-body angles, identical lighting): FRONT · 3/4 LEFT · SIDE · BACK · 3/4 RIGHT. PANEL 02 — EXPRESSIONS (6 head studies): HAPPY · WAVING · SHOCKED · WINKING · SLEEPY · CURIOUS. PANEL 03 — DETAIL MACROS (3): face detail · material or texture close-up · signature accessory. PANEL 04 — BRAND APPLICATIONS (4 mockups): on product packaging · on a storefront sign · in a print ad · on merch. PANEL 05 — POSES (4 action poses): GREETING · CELEBRATING · PRESENTING · THUMBS-UP. PANEL 06 — BRAND COLOR PALETTE: 6 swatches with HEX codes from the mascot's colors. Bottom caption: "Use this mascot board as a visual reference for consistent depiction of the mascot across all generations." Bottom-right tags: STYLE · Brand · Character · Consistent. Consistent mascot and consistent art style across every panel. 8K, fine grain, premium brand-design finish.`,
      negativePrompt:
        "inconsistent art style between panels, design drift, off-model mascot, garbled text, misspelled labels, watermark, blurry, low resolution",
    },
  },
  {
    id: "generate-image/pet-board",
    name: "Pet Board",
    description: "Connect a sharp photo → dense pet sheet; reuse it as a reference for consistent shots.",
    group: "Reference Sheet",
    data: {
      provider: "nano-banana-pro",
      aspectRatio: "16:9",
      resolution: "2K",
      prompt: `Create a single high-resolution, densely packed pet reference sheet titled "PET BOARD" using the attached photo of the pet as the single source of truth for its species, breed, coat colors, markings, eyes and build. The same animal must appear in every panel — identical markings, identical proportions, identical collar or accessories. All on-image labels in ENGLISH. Editorial reference-board layout with a dark near-black background, thin yellow neon accent light, faint film-grain overlay, and production-grade character-design UI. The composition should feel organized but not rigidly locked: allow the hero portrait, metadata, and supporting panels to shift position naturally while remaining readable, balanced, and premium. Design the board to adapt cleanly to different aspect ratios without depending on a fixed left-column layout. Include a large hero portrait with a metadata block: NAME · SPECIES · BREED · AGE · SIZE · COAT & MARKINGS · EYES · COLLAR / ACCESSORIES · TEMPERAMENT · SIGNATURE BEHAVIOR. Also include six content groupings — render ALL six panel headings exactly as written, never merging or omitting a panel: PANEL 01 — VIEWS (5 full-body angles, neutral stance, identical lighting): FRONT · 3/4 · SIDE · BACK · TOP-DOWN. PANEL 02 — EXPRESSIONS & MOODS (6 head studies): ALERT · CURIOUS · PLAYFUL · SLEEPY · GRUMPY · HAPPY. PANEL 03 — DETAIL MACROS (4): eye close-up · coat or fur texture · paw detail · collar tag or accessory. PANEL 04 — POSES (5 natural poses): SITTING · LYING DOWN · WALKING · PLAYING · CURLED ASLEEP. PANEL 05 — LIGHTING / MOOD (4 same-pose portraits): SOFT WINDOW LIGHT · GOLDEN HOUR · COOL BLUE NIGHT · DRAMATIC RIM-LIGHT. PANEL 06 — COLOR PALETTE: 6 swatches with HEX codes from the coat and accessories. Bottom caption: "Use this pet board as a visual reference for consistent depiction of the pet across all generations." Bottom-right tags: STYLE · Modern · Realistic · Cinematic. Style: photorealistic, no illustration. Consistent animal across every single panel. 8K, fine grain, cinematic color grading.`,
      negativePrompt:
        "illustration, cartoon, 3d render, garbled text, misspelled labels, watermark, deformed anatomy, inconsistent markings between panels, wrong breed, blurry, low resolution",
    },
  },
  // ── Cast & Consistency (clean grids per the multi-character workflow:
  // sterile neutral-background reference grids built to be FED BACK as identity
  // anchors — unlike the editorial boards above, decoration here is noise.
  // nano-banana-2 per the source guide: cheaper/faster per attempt with strong
  // practical consistency; 4K so panel faces stay sharp when reused as refs.) ──
  {
    id: "generate-image/character-reference-grid",
    name: "Character Reference Grid",
    description: "Connect a photo → clean 4-angle identity grid (no decorations) — the strongest consistency anchor.",
    group: "Cast & Consistency",
    data: {
      provider: "nano-banana-2",
      aspectRatio: "3:4",
      resolution: "4K",
      prompt: `Create a clean character reference grid using the attached photo of the person as the single source of truth for face, hair, eyes, skin tone, build and outfit. Four equal panels arranged in a tidy two-by-two grid on a single seamless neutral light-grey studio background: a tight front-facing portrait close-up, a 3/4-view portrait, a full-body shot from the front in a relaxed neutral stance, and a full-body shot from the back. The SAME person in every panel — identical age, features, hairstyle and outfit from the attached photo. Identical soft, even studio lighting in all four panels with no dramatic shadows. No decorations, no background props, no text, no UI elements — a sterile, production-neutral reference sheet built to be reused as an identity reference in later generations. Photorealistic, sharp focus, accurate natural skin texture, true-to-life color.`,
      negativePrompt:
        "stylization, illustration, decorative background, props, text, labels, UI elements, dramatic lighting, inconsistent face between panels, identity drift, changed outfit, deformed, blurry, watermark",
    },
  },
  {
    id: "generate-image/cast-mega-grid",
    name: "Cast Mega Grid",
    description: "Connect 2–4 character refs → one labeled cast sheet; then reference cast members by name in scenes.",
    group: "Cast & Consistency",
    data: {
      provider: "nano-banana-2",
      aspectRatio: "3:4",
      resolution: "4K",
      prompt: `Create a clean multi-character cast reference sheet composed as horizontal strips stacked vertically in one image — one strip per character from the attached reference images, in the order they are attached, using exactly as many strips as there are attached characters. Each strip shows that character in four aligned studio panels: tight front portrait close-up · 3/4 portrait · full body front · full body back, all in a relaxed neutral stance. Label each strip on the left edge with the character's name in clean bold lettering: {character names || ALEX · MAYA · SAM}. Every character must match their attached reference exactly — same face, hair, skin tone, build and outfit — with no identity blending between rows. Single seamless neutral light-grey studio background across the whole sheet, identical soft even lighting in every panel, consistent panel sizing and alignment. No decorations, no props, no UI elements beyond the row name labels. A sterile production casting sheet built to be reused as the single identity reference for this cast in later generations. Photorealistic, sharp focus, natural skin texture, true-to-life color.`,
      negativePrompt:
        "blended or swapped identities between rows, inconsistent faces, missing characters, misspelled name labels, garbled text, decorative background, props, dramatic lighting, stylization, illustration, deformed, blurry, watermark",
    },
  },
  {
    id: "generate-image/cast-scene",
    name: "Cast Scene (by name)",
    description: "Connect a cast grid → stage a scene naming the characters; never re-describe their looks.",
    group: "Cast & Consistency",
    data: {
      provider: "nano-banana-2",
      aspectRatio: "16:9",
      resolution: "2K",
      prompt: `Using the attached character reference sheet as the single source of truth for every named character's face, hair, build and outfit, generate one photorealistic scene: {scene || ALEX and MAYA share a quiet laugh at the counter of a sunlit ramen bar while SAM studies the menu}. Refer to the characters ONLY by the names labeled on the reference sheet and keep each one perfectly consistent with their reference row — do not invent new physical traits, do not blend identities, and do not alter outfits unless the scene says so. Stage them naturally in the environment with believable eye-lines, interactions and spacing. Cinematic photography, 35mm lens look with gentle depth of field, soft motivated lighting that matches the location, cohesive filmic color grade, natural skin texture, sharp detail on every character.`,
      negativePrompt:
        "identity drift, blended or swapped faces, re-invented outfits, reference-sheet grid visible in the result, panel borders, name labels in the scene, deformed, extra fingers, blurry, lowres, watermark, text",
    },
  },
  // ── Edit by Name (two-step recipe) ───────────────────────────────────────
  {
    id: "generate-image/label-elements",
    name: "Label Elements",
    description: "Step 1 · connect a photo → the same image with a numbered label on each changeable element.",
    group: "Edit by Name",
    data: {
      provider: "gpt-image-2",
      quality: "high",
      prompt: `Using the attached photo as the exact source, return the SAME image unchanged except for added annotations: overlay a small, clearly legible callout label on each distinct element a user might want to edit. Draw a thin leader line from each label to the element it names. Use short lowercase names in clear English (e.g. "drink 1", "drink 2", "flower basket", "hammock", "table", "sky", "sand", "palm tree"). Number duplicate element types ("drink 1", "drink 2"). Place labels on empty areas so they never overlap each other or hide the element they point to. Label only distinct, meaningful, editable objects — about 6 to 10 of them — and skip trivial background texture. Do NOT restyle, recolor, relight, or redraw the scene; keep every pixel of the underlying photo as close to the original as possible. The labels are an overlay on top of the otherwise-unchanged image.`,
      negativePrompt:
        "garbled text, misspelled labels, overlapping labels, illegible text, restyled scene, recolored scene, redrawn image, cartoon, illustration, watermark, blurry",
    },
  },
  {
    id: "generate-image/edit-by-name",
    name: "Apply Named Edit",
    description: "Step 2 · connect the labeled sheet → edit elements by name; the labels are removed from the result.",
    group: "Edit by Name",
    data: {
      provider: "gpt-image-2",
      quality: "high",
      prompt: `This image has callout labels naming its elements (made with the Label Elements preset). Use the labels ONLY to locate elements, then produce a clean edited photo with NO labels. Replace the next sentence with your change, referring to the labels: change "drink 1" to blue and replace the "flower basket" with a small dog. REMOVE every callout label, text box and leader line so none appear in the final image. Keep everything else exactly as it is.`,
      negativePrompt:
        "leftover callout labels, visible text labels, text boxes, leader lines, garbled text, restyled scene, recolored unrelated elements, redrawn image, cartoon, illustration, watermark, blurry",
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
        "cinematic portrait of {subject || a pensive young man with stubble}, 85mm lens at f/1.8, shallow depth of field with creamy bokeh, soft key with warm rim separation against a moody low-key background, gentle film grain, filmic teal-and-amber grade, natural skin texture, tack-sharp eyes",
      negativePrompt:
        "flat lighting, deep focus, plastic skin, blown highlights, extra fingers, lowres, deformed, watermark, text",
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
        "cinematic film still of {subject || a lone detective in a rain-slicked alley at night}, anamorphic lens at 40mm and f/2, shallow depth of field with oval bokeh and subtle horizontal flares, dramatic motivated key light with deep falloff, off-center framing with negative space, tense noir mood in a moody teal-and-amber grade, fine film grain, photoreal detail",
      negativePrompt:
        "flat lighting, deep focus, oversaturated, washed out, video-game render, lowres, deformed, watermark, text",
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
        "epic ultra-wide cinematic still of {subject || a lone traveler dwarfed by towering desert canyons}, anamorphic widescreen framing, 35mm lens at f/4 with deep focus, layered atmospheric haze catching backlight, dramatic god-ray lighting, expansive scale with the subject small against the vista, awe-struck mood in a cool cinematic grade, subtle film grain, crisp distant detail",
      negativePrompt:
        "cropped framing, cluttered composition, flat lighting, oversaturated, lowres, deformed, watermark, text",
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
        "studio portrait of {subject || a confident woman with sleek dark hair}, 85mm lens at f/2.8, shallow depth of field, soft octabox key with gentle fill and a subtle hair light, clean seamless gray backdrop, tight head-and-shoulders framing, polished editorial mood with a neutral true-to-life palette, natural skin texture, catchlights and tack-sharp eyes",
      negativePrompt:
        "harsh shadows, plastic skin, over-retouched, blown highlights, busy background, extra fingers, lowres, deformed, watermark, text",
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
        "professional corporate headshot of {subject || a friendly executive in a tailored navy blazer}, 85mm lens at f/4, soft even three-point lighting with a broad key and clean fill, smooth neutral gray-blue background, centered head-and-shoulders framing, approachable confident expression, crisp business mood with a clean neutral palette, sharp focus and natural skin texture",
      negativePrompt:
        "harsh shadows, busy background, casual snapshot, over-retouched, plastic skin, extra fingers, lowres, deformed, watermark, text",
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
        "outdoor portrait of {subject || a smiling woman with windswept hair in a field}, 85mm lens at f/1.8, shallow depth of field with creamy bokeh, low golden-hour sun as a warm backlight with a glowing rim and gentle lens flare, off-center rule-of-thirds framing, dreamy romantic mood in a warm amber grade, soft halation, natural skin texture and sharp eyes",
      negativePrompt:
        "harsh midday shadows, flat lighting, overexposed sky, plastic skin, extra fingers, lowres, deformed, watermark, text",
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
        "black and white editorial portrait of {subject || a weathered old fisherman with a lined face}, 85mm lens at f/2, shallow depth of field, dramatic single-source chiaroscuro with deep falloff, tight off-center framing, timeless brooding mood with a rich high-contrast monochrome tonal range, deep blacks and luminous highlights, fine silver grain, sharp eyes and natural skin texture",
      negativePrompt:
        "color, muddy gray tones, flat lighting, low contrast, plastic skin, extra fingers, lowres, deformed, watermark, text",
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
        "extreme macro photograph of {subject || a dew-covered bee on a flower petal}, 100mm macro lens at f/8, focus-stacked for razor-sharp life-size detail with a softly defocused background, soft diffused studio light with a subtle rim, centered close-up composition, intimate jewel-like mood with rich saturated color, glistening micro-textures and crisp surface detail",
      negativePrompt:
        "blurry, out of focus, soft detail, harsh glare, dust spots, lowres, deformed, watermark, text",
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
        "appetizing hero food photograph of {dish || a rustic bowl of ramen with a soft-boiled egg}, 50mm lens at f/2.8, shallow depth of field, soft diffused window light from the side with a gentle fill, 45-degree angle on a weathered rustic surface, props and steam fading into a clean background, warm mouth-watering mood with natural color, fresh garnish, glistening textures and crisp focus on the hero",
      negativePrompt:
        "unappetizing, plastic look, fake glossy food, messy spills, dull colors, harsh flash, lowres, deformed, watermark, text",
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
        "overhead flat-lay food photograph of {dish || a colorful brunch spread with coffee and pastries}, 35mm lens at f/5.6 with even focus, perfect top-down ninety-degree angle, soft diffused daylight casting gentle natural shadows, balanced styled arrangement with breathing room and scattered ingredients, fresh vibrant editorial mood with a clean color palette on a textured surface, crisp appetizing detail",
      negativePrompt:
        "cluttered, overcrowded, tilted angle, harsh shadows, plastic look, dull colors, lowres, deformed, watermark, text",
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
        "aerial drone photograph of {scene || a winding coastal road along turquoise cliffs}, ultra-wide 24mm lens at f/5.6 with crisp deep focus, straight-down top-down perspective from high altitude, low golden-hour sun casting long raking shadows that reveal terrain, bold graphic composition emphasizing pattern and scale, expansive serene mood with rich warm color, sharp detail across the frame",
      negativePrompt:
        "blurry, soft focus, flat midday light, tilted horizon, lens distortion, lowres, deformed, watermark, text",
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
        "sweeping ultra-wide landscape photograph of {scene || a misty mountain range over a glassy alpine lake at dawn}, 16mm lens at f/11 with edge-to-edge deep focus, layered foreground, midground and distant peaks for depth, dramatic golden-hour sky with breaking light, rule-of-thirds horizon, awe-inspiring grand mood with high dynamic range and natural color, crisp detail and a sense of vast scale",
      negativePrompt:
        "oversaturated, hdr halos, blown sky, flat lighting, soft focus, lens distortion, lowres, deformed, watermark, text",
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
        "full-body character turnaround model sheet of {character description || a rugged space mercenary with a scarred jaw and worn leather armor}, three matching views in a row — front, side profile, and back — held in a clean T-pose with a neutral expression, identical proportions and costume details across all three views, flat even studio lighting with no harsh shadows so every view reads the same, evenly spaced on a plain light-grey backdrop, crisp concept-art model-sheet style, clean line work and consistent color palette across panels",
      negativePrompt:
        "inconsistent design between views, mismatched proportions, extra limbs, deformed anatomy, dynamic pose, dramatic shadows, busy background, watermark, text",
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
        "character action model sheet of {character description || a nimble rogue archer in a hooded green cloak}, four distinct full-body dynamic action poses in a row — running, leaping, attacking, landing — strictly consistent face, character design, and outfit across every pose, full-figure framing with confident gesture and clear silhouettes, even studio lighting that stays identical across all four poses, plain neutral backdrop, energetic concept-art model sheet, clean linework and matching color palette",
      negativePrompt:
        "inconsistent design between poses, changed outfit, deformed anatomy, extra limbs, fused figures, static stiff posture, busy background, watermark, text",
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
        "character expression model sheet of {character description || a cheerful freckled teen with messy red hair}, six head-and-shoulders portraits arranged in two even rows of three, labeled emotions in order — neutral, happy, angry, surprised, sad, determined — strictly consistent face, hairstyle, and features across every panel with only the expression changing, flat even portrait lighting identical in all six panels, evenly spaced on a plain neutral backdrop, clean concept-art model sheet, natural facial detail and matching color palette",
      negativePrompt:
        "inconsistent face, drifting features, changed hairstyle, deformed, asymmetrical eyes, uneven lighting, busy background, watermark, garbled text",
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
        "16-panel character expression grid of {character description || a stoic silver-haired knight with a faint scar}, evenly spaced 4x4 layout of head-and-shoulders portraits, sixteen distinct facial emotions ranging from calm to intense, strictly consistent face, hairstyle, and design across every cell with only the expression changing, flat even portrait lighting identical in all panels, plain neutral backdrop, clean concept-art model sheet, natural facial detail and matching color palette",
      negativePrompt:
        "inconsistent face, drifting features, changed hairstyle, deformed, asymmetrical eyes, uneven panels, uneven lighting, busy background, watermark, text",
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
        "outfit variation model sheet of {character description || a confident young woman with a sleek dark bob}, the same character shown full-body in four different complete outfits side by side — casual, formal, athletic, seasonal — strictly consistent face, body, and hairstyle across all four with only the wardrobe changing, full-figure framing in a relaxed standing pose, flat even studio lighting identical across every panel, evenly spaced on a plain neutral backdrop, clean concept-art model sheet, matching color palette and crisp fabric detail",
      negativePrompt:
        "inconsistent face, changed body or hairstyle, deformed, mismatched proportions, repeated identical outfit, busy background, watermark, text",
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
        "annotated full-body character turnaround model sheet of {character description || a seasoned bounty hunter in a weathered duster and wide-brim hat}, front, side, and back views in a row with crisp legible text labels reading FRONT, SIDE, and BACK beneath each view, a vertical height reference chart with tick marks along one edge, strictly consistent design and proportions across all three views, flat even studio lighting identical across every view, neat production-reference layout on a clean light-grey backdrop, sharp typography and tidy annotations, consistent color palette",
      negativePrompt:
        "misspelled labels, garbled text, inconsistent design between views, mismatched proportions, deformed, dynamic pose, dramatic shadows, busy background, watermark",
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
        "chibi character model sheet of {character description || a tiny brave knight with oversized armor}, adorable super-deformed proportions with a big head and small body, several cute mini full-body poses arranged across the sheet, strictly consistent design and color palette across every pose, soft even flat lighting identical across all poses, evenly spaced on a plain pastel backdrop, clean bold outlines and flat cel shading, charming concept-art model sheet",
      negativePrompt:
        "realistic proportions, inconsistent design, deformed, off-model, gritty shading, busy background, watermark, text",
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
        "detailed character portrait of {character description || a battle-worn elven ranger with piercing green eyes}, painterly fantasy concept art, fine brushwork with crisp edge detail, dramatic chiaroscuro key light with a soft rim separating the subject from a moody dark background, tight three-quarter view framing the face and shoulders, expressive confident gaze, rich saturated color grade, intricate costume detail and tack-sharp eyes",
      negativePrompt:
        "flat lighting, lowres, deformed, extra fingers, asymmetrical eyes, plastic skin, blurry, washed-out colors, watermark, text",
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
        "full-body hero shot of {character description || a heroic armored warrior with a flowing crimson cape}, cinematic character key art, confident dynamic power pose, dramatic rim lighting with a warm key and cool back-light carving the silhouette, low camera angle for an imposing heroic stance, softly blurred atmospheric background, bold dramatic color grade, intricately detailed costume and crisp material textures",
      negativePrompt:
        "flat lighting, static stiff pose, lowres, deformed, extra limbs, cropped feet, cluttered background, blurry, watermark, text",
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
        "creature design model sheet of {creature description || a six-legged bioluminescent forest beast with mossy scales}, several full-body views from multiple angles plus inset anatomy and texture close-ups, strictly consistent species, markings, and proportions across every view, professional creature-concept art, flat even studio lighting identical across all views so the design reads clearly, neatly arranged on a plain neutral backdrop, detailed believable anatomy and crisp surface textures, cohesive color palette",
      negativePrompt:
        "inconsistent design between views, mismatched proportions, deformed anatomy, extra or missing limbs, dramatic shadows, busy background, watermark, text",
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
        "stylized avatar profile picture of {character or subject || a friendly fox with bright amber eyes}, clean modern character illustration, bold thick outlines with smooth flat shading, soft even front lighting with a gentle glow, perfectly centered head-and-shoulders composition with comfortable margins, vibrant punchy color palette on a clean solid-color background, crisp friendly and instantly readable as a small icon",
      negativePrompt:
        "off-center, cropped face, busy background, lowres, deformed, muddy colors, harsh shadows, watermark, text",
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
        "e-commerce studio product photograph of {product || a matte-black wireless headphone}, on a seamless pure-white background, 100mm lens at f/8 with deep focus, soft even high-key lighting from a large diffused softbox with gentle fill, perfectly centered with generous margins, clean catalog-ready mood with true-to-life color, crisp edges and accurate material texture",
      negativePrompt:
        "clutter, props, harsh shadows, blown highlights, color cast, reflections, tilted angle, lowres, deformed, watermark, text",
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
        "lifestyle product photograph of {product || a ceramic pour-over coffee set} in {setting || a sunlit minimalist kitchen}, shown naturally in use, 50mm lens at f/2.8 with shallow depth of field, soft directional window light with a warm glow, off-center rule-of-thirds framing with the product as hero, aspirational editorial mood with a warm natural palette, tactile materials and crisp focus on the product",
      negativePrompt:
        "clutter, busy background, distracting props, harsh flash, dull colors, plastic look, lowres, deformed, watermark, text",
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
        "overhead flat-lay product photograph of {product || a leather travel wallet} surrounded by complementary props, 35mm lens at f/5.6 with even focus, perfect top-down ninety-degree angle, soft diffused daylight casting gentle natural shadows, balanced styled arrangement with breathing room around the hero, clean modern editorial mood with a cohesive palette on a textured surface, crisp material detail",
      negativePrompt:
        "cluttered, overcrowded, tilted angle, harsh shadows, dull colors, plastic look, lowres, deformed, watermark, text",
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
        "photorealistic product packaging mockup of {product || an artisanal coffee brand}, presented as {format || a standing kraft pouch}, with a crisp accurately-printed label wrapping the form, 85mm lens at f/8 with deep focus, soft studio lighting with a subtle highlight and grounded contact shadow, centered hero composition on a clean seamless background, premium retail mood with true-to-life color, sharp legible label artwork and realistic material finish",
      negativePrompt:
        "distorted label, warped text, misspelled words, floating object, harsh shadows, clutter, lowres, deformed, watermark",
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
        "product mockup of {device || a modern smartphone} displaying {screen content || a clean mobile app dashboard}, crisp pixel-accurate screen with no glare obscuring the UI, 50mm lens at f/5.6 with the device tack-sharp, soft studio lighting with gentle reflections on the bezel and a subtle grounded shadow, slight three-quarter angle on a clean minimal surface, sleek premium tech mood with a neutral palette, sharp screen content and realistic device materials",
      negativePrompt:
        "distorted screen, warped UI, glare washout, off-model device, wrong proportions, clutter, lowres, deformed, watermark",
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
        "luxury beauty product hero shot of {product || a frosted-glass serum bottle with a gold dropper}, 100mm macro lens at f/8 with crisp focus, dramatic single-source key light with a soft gradient falloff and a bright specular edge, fresh water droplets beading on the surface, centered low hero angle on a premium glossy reflective surface, elegant high-end mood with a refined jewel-toned palette, immaculate detail and luminous reflections",
      negativePrompt:
        "cheap plastic look, fingerprints, dust, busy background, flat lighting, dull colors, lowres, deformed, watermark, text",
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
        "minimalist wordmark logo for '{BRAND}', clean geometric sans-serif, balanced letter-spacing, flat vector, centered on a solid background, crisp edges, professional brand identity, legible correctly-spelled text",
      negativePrompt:
        "photorealistic, 3d, gradient mesh, cluttered, misspelled letters, garbled text, extra characters, watermark",
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
        "emblem badge logo for '{BRAND}', built around {concept || a mountain peak and pine motif}, symmetrical circular composition with the brand name set cleanly along the ring, flat vector with a limited two-or-three-color palette, crisp edges and even line weights, centered on a white background, heritage brand-identity feel, legible correctly-spelled text",
      negativePrompt:
        "photorealistic, 3d, gradient mesh, cluttered, asymmetrical, misspelled letters, garbled text, watermark",
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
        "mascot logo for '{BRAND}', a friendly {character || a plucky cartoon fox} mascot with an approachable expression and a clear readable silhouette, bold flat colors with confident thick outlines, clean vector style with the brand name set neatly below, centered on a white background, playful memorable brand-identity feel, legible correctly-spelled text",
      negativePrompt:
        "photorealistic, 3d, gradient mesh, cluttered, busy detail, off-model, misspelled letters, garbled text, watermark",
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
        "modern app icon for '{APP}', rounded-square tile with a single bold simple glyph of {concept || a paper-plane}, smooth subtle gradient fill, perfectly centered with balanced padding inside the rounded square, flat clean design with crisp edges, vibrant cohesive color, instantly readable at small sizes",
      negativePrompt:
        "cluttered, intricate detail, photorealistic, harsh drop shadow, off-center, lettering, text, watermark",
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
        "elegant monogram logo gracefully interlocking the letters '{INITIALS}', refined geometric construction with balanced symmetry and even line weights, flat vector in a single sophisticated color, centered on a white background, crisp edges, timeless luxury brand-identity feel, legible correctly-spelled letters",
      negativePrompt:
        "cluttered, photorealistic, 3d, gradient mesh, extra letters, misspelled letters, garbled text, watermark",
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
        "punchy YouTube thumbnail featuring {subject || a wide-eyed creator reacting in shock}, bold expressive close-up subject cut out against a saturated high-contrast background, dramatic off-center composition with the face large and a clear focal point, large bold sans-serif headline text '{TEXT}' in a heavy outlined style with a strong drop shadow, vivid eye-catching color grade, crisp clickable poster look, legible correctly-spelled text",
      negativePrompt:
        "muddy low-contrast colors, tiny unreadable text, cluttered busy layout, misspelled text, garbled letters, lowres, blurry, watermark",
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
        "square Instagram post graphic about {topic || launching a new product}, modern branded design with a clean grid layout and generous margins, a clear visual focal point paired with bold headline text '{TEXT}', confident contemporary type hierarchy, cohesive on-brand color palette, crisp flat finish, balanced centered composition, legible correctly-spelled text",
      negativePrompt:
        "cluttered busy layout, tiny unreadable text, misspelled text, garbled letters, off-brand clashing colors, lowres, blurry, watermark",
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
        "vertical full-bleed social story graphic about {topic || a weekend flash sale}, immersive edge-to-edge background image, bold stacked headline text '{TEXT}' set high with breathing room, thumb-friendly safe margins top and bottom, modern punchy design with a vibrant cohesive palette, strong type hierarchy and a single clear focal point, crisp mobile-first finish, legible correctly-spelled text",
      negativePrompt:
        "letterboxed bars, cramped edges, tiny unreadable text, cluttered layout, misspelled text, garbled letters, lowres, blurry, watermark",
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
        "polished advertising creative for {product || a sleek wireless earbud case}, attention-grabbing hero product shot as the centerpiece, clear bold headline '{TEXT}' across the top, clean studio lighting with a soft gradient backdrop, confident brand-grade composition with deliberate negative space reserved at the bottom for a call-to-action button, premium commercial finish, vibrant on-brand color, legible correctly-spelled text",
      negativePrompt:
        "cluttered busy layout, no negative space, tiny unreadable text, misspelled text, garbled letters, amateurish, lowres, blurry, watermark",
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
        "elegant inspirational quote card centered on the text '{QUOTE}', refined typographic design as the hero with a tasteful serif-and-sans pairing and graceful line breaks, {background style || a soft minimal gradient with subtle paper texture}, generous margins and balanced symmetrical composition, calm sophisticated color palette, crisp print-ready finish, legible correctly-spelled text",
      negativePrompt:
        "cluttered layout, clashing fonts, busy distracting background, misspelled text, garbled letters, lowres, blurry, watermark",
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
        "wide web banner header for {brand or topic || a modern SaaS startup}, clean modern design with a horizontal layout, headline text '{TEXT}' set on the left with clear hierarchy, a complementary hero graphic on the right and deliberate clear space reserved for a logo, cohesive on-brand palette, crisp flat web-ready finish, balanced composition, legible correctly-spelled text",
      negativePrompt:
        "cluttered busy layout, tiny unreadable text, no clear space, misspelled text, garbled letters, lowres, blurry, watermark",
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
        "theatrical movie poster for '{TITLE}', cinematic key art in a {genre || gritty sci-fi thriller} mood, dramatic vertical hero composition with a commanding central figure, moody atmospheric lighting with strong rim light and volumetric haze, rich filmic teal-and-amber color grade, bold title treatment along the bottom with a short tagline above it and a small billing-block strip, premium high-detail finish, legible correctly-spelled text",
      negativePrompt:
        "flat lighting, cluttered composition, amateurish layout, misspelled text, garbled letters, extra limbs, deformed faces, lowres, blurry, watermark",
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
        "bold graphic event poster for '{EVENT}', with the detail line '{date and venue || Saturday Sept 14 · The Grand Hall}' set cleanly below, striking oversized display typography as the hero, dynamic eye-catching layout with strong shapes and a vivid high-energy color palette, clear type hierarchy and generous margins, crisp flat print-ready finish, balanced composition, legible correctly-spelled text",
      negativePrompt:
        "cluttered busy layout, muddy colors, tiny unreadable text, misspelled text, garbled letters, lowres, blurry, watermark",
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
        "professional book cover for '{TITLE}' by {AUTHOR}, evocative {genre || literary thriller} mood and symbolic central imagery, vertical composition with a strong focal point, bold title typography across the top and the author name along the bottom with clear hierarchy, atmospheric lighting and a cohesive genre-appropriate color palette, refined bookstore-quality finish, legible correctly-spelled text",
      negativePrompt:
        "cluttered layout, clashing fonts, generic stock look, misspelled text, garbled letters, deformed faces, lowres, blurry, watermark",
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
        "print-ready t-shirt graphic of {concept || a snarling wolf in a moonlit forest}, bold centered illustration with confident clean linework, limited flat screen-print color palette, strong silhouette that reads at a glance, crisp vector-style edges, perfectly isolated on a plain flat background as artwork only with no garment and no mockup",
      negativePrompt:
        "t-shirt mockup, person wearing shirt, photographic background, soft gradients, photorealistic, busy clutter, misspelled text, garbled letters, lowres, blurry, watermark",
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
        "die-cut sticker design of {subject || a smiling cartoon avocado}, thick clean white die-cut border hugging the silhouette, bold flat colors with a confident dark outline, cute kawaii style, subtle glossy vinyl sheen and a soft contact shadow, single centered subject isolated on a plain flat background",
      negativePrompt:
        "photographic background, scene, no white border, soft blurry edges, photorealistic, busy clutter, misspelled text, garbled letters, lowres, watermark",
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
        "striking square album cover art for '{TITLE}', bold {genre || dreamy synthwave} aesthetic, single arresting central image as the focal point, dramatic mood-setting lighting and a distinctive cohesive color palette, the title set as clean tasteful typography that complements the artwork, refined high-detail finish, balanced composition, legible correctly-spelled text",
      negativePrompt:
        "cluttered busy layout, muddy colors, weak focal point, misspelled text, garbled letters, lowres, blurry, watermark",
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
      prompt: "{scene or subject || a girl watching fireworks over a summer festival}, cel-shaded with crisp linework, expressive eyes, soft gradient sky, gentle bloom",
      negativePrompt: "photorealistic, 3d render, muddy colors, lowres, deformed, extra fingers, watermark, text",
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
      prompt: "{scene || a caped hero landing on a rooftop at dusk}, dynamic comic panel composition, bold ink outlines, motion lines, clear space for a speech bubble",
      negativePrompt: "photorealistic, muddy colors, cluttered, lowres, deformed, extra fingers, watermark",
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
      prompt: "{scene || a swordsman bracing against the wind}, black-and-white manga panel, crisp inking, screentone shading, dramatic low angle, speed lines",
      negativePrompt: "color, grayscale photo, muddy tones, lowres, deformed, extra fingers, watermark",
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
      prompt: "{subject || a quiet harbor at dawn}, loose wet-on-wet washes, soft bleeding edges, paper texture showing through, gentle pastel palette",
      negativePrompt: "hard edges, photorealistic, heavy outlines, lowres, watermark, text",
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
      prompt: "{subject || a still life of fruit on a draped table}, thick impasto brushstrokes, visible canvas texture, warm chiaroscuro light, rich classical palette",
      negativePrompt: "photorealistic, flat digital, smooth airbrush, lowres, watermark, text",
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
      prompt: "{subject or scene || a person working at a laptop in a cozy home office}, clean flat shapes, bold simple forms, limited modern palette, generous negative space",
      negativePrompt: "photorealistic, gradient mesh, heavy texture, drop shadows, lowres, watermark",
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
      prompt: "isometric {building or scene || a cozy corner coffee shop}, true 3/4 axonometric angle, clean miniature game-art forms, soft even lighting, tidy modular detail",
      negativePrompt: "perspective distortion, vanishing-point view, photorealistic, lowres, watermark",
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
      prompt: "{subject || a hero exploring a torch-lit dungeon}, retro 16-bit pixel art, crisp pixel grid, limited dithered palette, hard-edged sprite detail",
      negativePrompt: "smooth gradients, antialiasing, blur, photorealistic, vector art, watermark",
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
      prompt: "{character or subject || a curious round-cheeked kid with big expressive eyes}, polished 3D animated render, soft subsurface skin, warm key light with gentle bounce, charming appeal",
      negativePrompt: "photorealistic, uncanny, flat 2d, lowres, deformed, extra fingers, watermark, text",
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
        "black and white line-art coloring page of {subject || a friendly dinosaur in a jungle}, clean even-weight ink outlines, simple uncluttered shapes with generous open areas to fill in, pure white background, crisp vector-style edges, no shading and no color",
      negativePrompt: "color, shading, grayscale fill, gradients, sketchy hatching, photorealistic, busy background, lowres, watermark, text",
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
        "tattoo flash design of {subject || a roaring tiger with peony flowers} in {tattoo style || bold American traditional} style, confident clean linework with strong outlines, limited tattoo-ink palette, solid black fills and tasteful negative space, single centered motif isolated on a plain white sheet",
      negativePrompt: "photographic background, scene, soft gradients, photorealistic, fine grayscale shading, blurry, lowres, watermark, text",
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
      prompt: "concept art of {environment or subject || ancient ruins reclaimed by a glowing jungle}, sweeping sense of scale, atmospheric depth and haze, dramatic god-ray light",
      negativePrompt: "flat lighting, photo, cluttered, lowres, deformed, watermark, text",
    },
  },

  // ── Handmade & Stop-Motion (tactile crafted looks — the in-prompt
  // "NOT digital CG, NOT a 3D render" clause is what holds the handmade feel;
  // named quality anchors (Aardman/Laika/Henson/Gondry) pin the reference bar) ──
  {
    id: "generate-image/claymation-scene",
    name: "Claymation Scene",
    description: "Plasticine stop-motion look, thumbprints included.",
    group: "Handmade & Stop-Motion",
    data: {
      provider: "nano-banana-pro",
      aspectRatio: "16:9",
      prompt:
        "{scene || a tiny clay fisherman rowing across a stormy plasticine sea}, tactile stop-motion claymation scene — real plasticine clay characters and set with visible thumbprints, tool marks, seam lines and a soft matte sheen, miniature studio photography with shallow depth of field and warm practical lighting, handmade Aardman-quality charm. NOT digital CG, NOT a 3D render, NOT 2D illustration — a physically sculpted miniature scene photographed on a real stop-motion stage",
      negativePrompt:
        "smooth plastic CGI surface, digital 3d render, 2d illustration, cartoon shading, perfect seamless surfaces, real human actors, lowres, deformed, watermark, text",
    },
  },
  {
    id: "generate-image/needle-felt",
    name: "Needle-Felt",
    description: "Fuzzy felted-wool miniature.",
    group: "Handmade & Stop-Motion",
    data: {
      provider: "nano-banana-pro",
      aspectRatio: "1:1",
      prompt:
        "{subject || a round little fox curled in a mossy nest}, needle-felted wool sculpture — soft wool roving with visible fluffy fibers and a halo of stray strands, glass-bead eyes with a tiny sheen, embroidered nose and stitched details, handcrafted miniature photographed in a cozy diorama with soft window light, Laika-quality handmade charm. NOT digital CG, NOT a 3D render, NOT 2D illustration — real felted wool photographed up close",
      negativePrompt:
        "smooth plastic surface, digital 3d render, 2d illustration, real animal fur, photorealistic animal, hard CGI edges, lowres, deformed, watermark, text",
    },
  },
  {
    id: "generate-image/sock-puppet",
    name: "Sock Puppet",
    description: "Stitched-sock character on stage.",
    group: "Handmade & Stop-Motion",
    data: {
      provider: "nano-banana-pro",
      aspectRatio: "4:3",
      prompt:
        "{character || a cheerful sock-puppet chef holding a tiny wooden spoon}, handmade sock puppet — thick cotton knit texture, stitched felt mouth, ping-pong-ball eyes with painted pupils, yarn hair, visible seams and hot-glue details, puppet-studio photography with soft even lighting and a simple stage backdrop, Henson-style handmade charm. NOT digital CG, NOT a 3D render, NOT 2D illustration — a real fabric puppet photographed on a puppet stage",
      negativePrompt:
        "smooth CGI fabric, digital 3d render, 2d illustration, human face, realistic skin, plastic toy look, lowres, deformed, watermark, text",
    },
  },
  {
    id: "generate-image/cardboard-diorama",
    name: "Cardboard Diorama",
    description: "Cut-cardboard craft set, tape & paint.",
    group: "Handmade & Stop-Motion",
    data: {
      provider: "nano-banana-pro",
      aspectRatio: "16:9",
      prompt:
        "{scene || a rocket launching over a tiny cardboard city}, handmade cardboard-craft diorama — corrugated cardboard structures with visible cut edges, masking tape, hot-glue joints and hand-painted acrylic surfaces, hand-lettered signs, miniature set photography with warm practical lighting and gentle depth of field, Michel Gondry handmade-prop charm. NOT digital CG, NOT a 3D render, NOT 2D illustration — a real cardboard miniature set photographed in studio",
      negativePrompt:
        "clean vector shapes, digital 3d render, 2d illustration, smooth plastic surfaces, real buildings, photoreal city, lowres, deformed, watermark, garbled text",
    },
  },
  {
    id: "generate-image/embroidered-art",
    name: "Embroidered Art",
    description: "Hand-stitched thread on hooped linen.",
    group: "Handmade & Stop-Motion",
    data: {
      provider: "nano-banana-pro",
      aspectRatio: "1:1",
      prompt:
        "{subject || a songbird on a blossoming branch} rendered as fine hand embroidery — visible individual thread stitches, satin-stitch fills and chain-stitch outlines, subtle thread sheen, slight fabric pucker around dense stitching, hooped natural linen background with a few loose thread tails, soft daylight craft photography, artisan needlework quality. NOT digital CG, NOT a 3D render, NOT 2D illustration, NOT a print — real stitched thread on real fabric",
      negativePrompt:
        "printed fabric, flat digital illustration, 3d render, smooth painted texture, photorealistic subject, lowres, deformed, watermark, text",
    },
  },
  {
    id: "generate-image/faux-food-clay",
    name: "Faux-Food (Clay)",
    description: "Plasticine dish styled as a commercial.",
    group: "Handmade & Stop-Motion",
    data: {
      provider: "nano-banana-pro",
      aspectRatio: "4:5",
      prompt:
        "{dish || a steaming bowl of ramen with a soft egg and curled noodles} sculpted entirely from plasticine modeling clay and styled as a glossy food commercial — visible sculpting tool marks, clear gloss varnish standing in for broth sheen, wool-tuft steam, clay ingredients with charming hand-modeled imperfection, miniature studio food-commercial lighting with a warm appetizing key, Aardman-quality handmade charm. NOT real food photography, NOT digital CG, NOT a 3D render, NOT 2D illustration — a physically sculpted clay dish photographed like a commercial",
      negativePrompt:
        "real food, photorealistic food, digital 3d render, 2d illustration, smooth plastic CGI, melted shapeless clay, unappetizing, lowres, watermark, text",
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
        "rough storyboard frame of {shot description || a detective shouldering open a warehouse door}, loose black-and-white pencil sketch, {shot size || medium} shot framing with clear staging and readable blocking, gestural hatching for tone, {camera angle || slight low angle}, bold directional arrows indicating subject and camera motion, quick previsualization sketch — not a finished render",
      negativePrompt:
        "color, photorealistic, rendered, polished finish, fine detail, grayscale photo, lowres, watermark, garbled text",
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
        "cinematic keyframe of {scene || a weary traveler pausing at a neon-lit roadside diner}, film still, anamorphic 40mm look with shallow depth of field and gentle bokeh, {mood || tense and intimate} motivated lighting with soft key and deep falloff, off-center framing with negative space, richly color-graded teal-and-amber palette, atmospheric haze, fine film grain, photoreal detail",
      negativePrompt:
        "flat lighting, deep focus, oversaturated, washed out, video-game render, lowres, deformed, watermark, text",
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
        "epic ultra-wide matte painting of {environment || a ruined citadel half-swallowed by jungle at sunrise}, sweeping cinematic vista, painterly photoreal rendering with crisp distant detail, layered foreground, midground and background for deep atmospheric perspective, dramatic god-ray lighting breaking through haze, vast awe-inspiring scale, rich filmic color grade, fine detail",
      negativePrompt:
        "flat, low detail, shallow composition, cluttered foreground, oversaturated, lowres, watermark, text",
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
        "single cohesive mood-board tile capturing {aesthetic or theme || warm Scandinavian minimalism}, one unified evocative image — not a collage or grid, soft natural lighting with gentle texture and tactile materials, balanced editorial composition, restrained {color palette || muted oat, sage and terracotta} grade, calm atmospheric mood, crisp tasteful detail",
      negativePrompt:
        "collage, grid, split panels, multiple frames, text, labels, busy clutter, watermark, lowres",
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
        "sweeping ultra-wide establishing shot of {location || a fog-wrapped fishing village at first light}, cinematic film still, wide lens with edge-to-edge deep focus, layered foreground, midground and distant background conveying a strong sense of place and scale, soft directional dawn light with atmospheric haze, expansive epic composition, evocative filmic color grade, crisp detail across the frame",
      negativePrompt:
        "cropped framing, cluttered composition, flat lighting, oversaturated, soft focus, lowres, watermark, text",
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
        "photoreal architectural exterior visualization of {building || a glass-and-timber hillside villa}, {architectural style || warm modern minimalism}, professional architecture photography with a tilt-shift lens keeping verticals perfectly straight, warm golden-hour light raking across the facade with soft long shadows, three-quarter hero angle with clean foreground landscaping, aspirational editorial mood with natural color, accurate geometry and crisp material detail",
      negativePrompt:
        "distorted geometry, warped perspective, bent verticals, melting structure, flat lighting, lowres, watermark, text",
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
        "photoreal interior design visualization of {room || a sunlit open-plan living room}, {style || warm contemporary Scandinavian}, soft natural light pouring through large windows with gentle ambient fill, wide-angle architectural lens with straight true verticals and corrected perspective, balanced styled composition with curated furnishings and breathing room, inviting magazine-quality mood with a cohesive natural palette, accurate geometry and crisp material texture",
      negativePrompt:
        "distorted geometry, warped perspective, bent verticals, fisheye bulge, cluttered, dark, lowres, watermark, text",
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
        "professional real estate photograph of {property || a bright open-concept living room with patio doors}, wide-angle architectural lens with straight true verticals and corrected perspective, bright airy natural daylight balanced with warm interior fill for a high-dynamic-range look, clean tasteful staging with uncluttered surfaces, welcoming aspirational mood with a fresh neutral palette, accurate geometry and crisp listing-ready detail",
      negativePrompt:
        "distorted geometry, warped perspective, bent verticals, fisheye bulge, dark, dingy, cluttered, lowres, watermark, text",
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
        "photoreal architectural photograph of {tall building || a sleek glass-and-steel skyscraper}, dramatic worm's-eye upward angle exaggerating its soaring height, wide lens with controlled converging verticals, crisp midday sun glinting off the facade against a deep blue sky with wispy clouds, bold graphic composition emphasizing repeating structure, striking modern mood with clean color, accurate geometry and sharp reflective detail",
      negativePrompt:
        "distorted geometry, warped perspective, melting structure, leaning collapse, overcast haze, lowres, watermark, text",
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
        "polished RPG inventory game icon of {item || a glowing enchanted health potion in a crystal vial}, rounded glossy 3D style with smooth beveled edges and a subtle inner glow, soft studio key light with a bright specular highlight and a faint magical rim, single object perfectly centered with generous margins, isolated on a clean dark gradient background, vibrant saturated game-art palette, crisp readable silhouette at small sizes",
      negativePrompt: "flat, 2d, lowres, cluttered background, multiple objects, busy scene, harsh shadows, watermark, text",
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
        "seamless tileable PBR-style surface texture of {material || weathered mossy cobblestone}, perfectly repeating with no visible seams, dead-flat top-down orthographic view, even diffuse flat lighting across the whole frame with no shadows or hotspots, edges that wrap cleanly when tiled, fine high-resolution material detail, true-to-life color, crisp uniform grain",
      negativePrompt: "visible seams, perspective, lighting gradient, shadows, vignette, hotspots, single object, foreground subject, lowres, watermark, text",
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
        "seamless repeating decorative surface pattern of {motif || delicate botanical leaves and blossoms}, perfectly tileable with no visible seams where edges meet, flat clean vector colors, even balanced top-down composition with uniform motif spacing and consistent flat lighting, cohesive limited palette, crisp print-ready finish",
      negativePrompt: "visible seams, perspective, lighting gradient, shadows, photorealistic, 3d render, uneven spacing, single centered subject, lowres, watermark, text",
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
        "a set of glossy 3D emoji-style reaction icons of {subject || a round smiling yellow face}, several distinct expressions arranged in an even grid — happy, laughing, surprised, sad, angry, love — strictly consistent style, shading, and proportions across every icon with only the expression changing, smooth rounded inflatable forms with a candy-gloss finish, soft even studio lighting identical on each icon with a bright specular highlight, evenly spaced on a clean plain background, vibrant saturated palette, crisp and instantly readable at small sizes",
      negativePrompt: "inconsistent style, mismatched shading, off-model, realistic photo, flat 2d, muddy colors, cluttered background, lowres, watermark, text",
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
      prompt: "game-ready sprite of {character or item || a plucky knight with a tiny sword}, crisp clean pixels, bold readable silhouette, limited palette, centered on a plain background",
      negativePrompt: "smooth, antialiased, blurry, soft gradients, 3d render, cluttered background, watermark, text",
    },
  },

  // ── More Photography & Cinematic ─────────────────────────────────────────
  {
    id: "generate-image/silhouette",
    name: "Silhouette",
    description: "Backlit subject, dramatic sky.",
    group: "Photography & Cinematic",
    data: {
      provider: "nano-banana-pro",
      aspectRatio: "16:9",
      prompt:
        "dramatic silhouette of {subject || a lone figure on a hilltop with arms outstretched}, 50mm lens at f/8 with crisp deep focus, subject fully backlit against a vivid sunset sky and rendered as a clean dark shape with a glowing rim, low-angle composition with the figure off-center on the horizon, bold high-contrast mood in a fiery orange-to-purple gradient, smooth graded sky, minimal interior detail and clean recognizable outline",
      negativePrompt:
        "flat lighting, front lighting, visible face detail, washed-out sky, muddy tones, lowres, deformed, watermark, text",
    },
  },
  {
    id: "generate-image/long-exposure",
    name: "Long Exposure",
    description: "Silky motion, light trails.",
    group: "Photography & Cinematic",
    data: {
      provider: "seedream",
      aspectRatio: "16:9",
      prompt:
        "long-exposure photograph of {scene || a coastal lighthouse above mist-smoothed ocean waves}, 24mm lens at f/11 on a tripod with a multi-second shutter, silky smooth motion blur with streaking light trails and glassy water, razor-sharp stationary elements, balanced wide composition during the cool blue hour, tranquil ethereal mood with deep clean shadows and minimal noise, crisp fine detail where the frame is still",
      negativePrompt:
        "noise, harsh motion artifacts, double exposure, banding, blurry stationary objects, blown highlights, lowres, deformed, watermark, text",
    },
  },
  {
    id: "generate-image/tilt-shift",
    name: "Tilt-Shift Miniature",
    description: "Fake-miniature selective blur.",
    group: "Photography & Cinematic",
    data: {
      provider: "nano-banana-pro",
      aspectRatio: "16:9",
      prompt:
        "tilt-shift miniature photograph of {scene || a bustling city intersection with tiny cars and crowds}, tilt-shift lens with a narrow band of sharp focus and strong blur above and below, high elevated bird's-eye angle, tiny people and vehicles reading like toys, centered subject band, playful diorama mood with punchy high saturation and crisp clean detail in the focus zone",
      negativePrompt:
        "uniform sharp focus, eye-level angle, flat colors, dull lighting, realistic scale, lowres, deformed, watermark, text",
    },
  },

  // ── More Product & Commerce ──────────────────────────────────────────────
  {
    id: "generate-image/knolling",
    name: "Knolling Flat-Lay",
    description: "Objects arranged at 90°.",
    group: "Product & Commerce",
    data: {
      provider: "nano-banana-pro",
      aspectRatio: "1:1",
      prompt:
        "knolling flat-lay photograph of {items || an everyday-carry kit — knife, pen, watch, wallet and keys}, every object precisely aligned at ninety-degree right angles and evenly spaced in a tidy grid, 35mm lens at f/8 with even edge-to-edge focus, perfect top-down ninety-degree angle, soft diffused overhead light with gentle even shadows, organized symmetrical composition with consistent gaps, satisfying orderly editorial mood with a clean palette on a smooth neutral surface, crisp product detail",
      negativePrompt:
        "cluttered, messy, overlapping objects, diagonal placement, uneven spacing, tilted angle, harsh shadows, lowres, deformed, watermark, text",
    },
  },
  {
    id: "generate-image/ghost-mannequin",
    name: "Ghost-Mannequin Apparel",
    description: "Invisible-mannequin clothing shot.",
    group: "Product & Commerce",
    data: {
      provider: "nano-banana-pro",
      aspectRatio: "4:5",
      prompt:
        "ghost-mannequin apparel photograph of {garment || a tailored wool blazer}, invisible-mannequin hollow three-dimensional effect with the garment holding its worn shape and a visible hollow neckline and cuffs, 85mm lens at f/8 with deep focus, soft even studio lighting from large diffusers with a subtle grounding shadow, centered front-facing composition on a clean pure-white background, crisp commercial e-commerce mood with true-to-life color, accurate fabric texture and sharp seams",
      negativePrompt:
        "visible mannequin, body, person, neck, hands, flat lifeless shape, wrinkles, color cast, lowres, deformed, watermark, text",
    },
  },

  // ── More Illustration & Art Styles ───────────────────────────────────────
  {
    id: "generate-image/double-exposure",
    name: "Double Exposure",
    description: "Silhouette filled with a 2nd scene.",
    group: "Illustration & Art Styles",
    data: { provider: "seedream", aspectRatio: "2:3", prompt: "double-exposure portrait, the silhouette of {subject || a person's profile} cleanly filled with {secondary scene || a misty pine forest}, the second scene contained within the silhouette and fading to a clean light background at the edges, crisp high-contrast blend, fine art monochrome-to-color treatment", negativePrompt: "muddy overlap, low contrast, cluttered background, lowres, deformed, watermark, text" },
  },
  {
    id: "generate-image/vaporwave",
    name: "Vaporwave",
    description: "80s neon pastel aesthetic.",
    group: "Illustration & Art Styles",
    data: { provider: "nano-banana-pro", aspectRatio: "16:9", style: "vaporwave", prompt: "{subject || a marble bust beside a glowing palm tree}, neon pink-and-cyan glow, retro grid horizon, dreamy gradient sunset, subtle VHS haze", negativePrompt: "muted colors, photorealistic, dull, lowres, watermark, text" },
  },
  {
    id: "generate-image/cyberpunk-scene",
    name: "Cyberpunk Scene",
    description: "Neon-lit dystopian night.",
    group: "Illustration & Art Styles",
    data: { provider: "nano-banana-pro", aspectRatio: "16:9", style: "cyberpunk", prompt: "{scene || a crowded neon market street}, rain-slicked night with glowing reflections, holographic signage, dense atmospheric haze, moody teal-and-magenta glow", negativePrompt: "daylight, flat lighting, washed out, lowres, deformed, watermark, text" },
  },
  {
    id: "generate-image/pop-art",
    name: "Pop Art",
    description: "Bold Warhol/Lichtenstein graphic.",
    group: "Illustration & Art Styles",
    data: { provider: "ideogram-v3", aspectRatio: "1:1", style: "pop-art", prompt: "{subject || a woman in sunglasses blowing a bubble}, bold flat color blocks, thick black outlines, halftone Ben-Day dots, punchy primary palette", negativePrompt: "muted colors, photorealistic, soft gradients, lowres, watermark, text" },
  },
  {
    id: "generate-image/low-poly",
    name: "Low Poly",
    description: "Faceted geometric 3D.",
    group: "Illustration & Art Styles",
    data: { provider: "nano-banana-pro", aspectRatio: "1:1", style: "low-poly", prompt: "{subject || a stylized mountain fox}, faceted triangular geometry, crisp flat-shaded polygons, clean gradient color blocking, soft studio light", negativePrompt: "smooth surfaces, rounded organic detail, photorealistic, lowres, watermark, text" },
  },
  {
    id: "generate-image/paper-cut",
    name: "Paper Cut",
    description: "Layered cut-paper craft.",
    group: "Illustration & Art Styles",
    data: { provider: "nano-banana-pro", aspectRatio: "1:1", style: "paper-cutout", prompt: "{subject || a fox in a layered forest}, layered cut-paper craft, stacked depth with soft drop shadows between layers, clean torn-and-cut edges, warm tactile palette", negativePrompt: "photorealistic, flat single-layer, smooth gradients, lowres, watermark, text" },
  },
  {
    id: "generate-image/stained-glass",
    name: "Stained Glass",
    description: "Leaded colored-glass mosaic.",
    group: "Illustration & Art Styles",
    data: { provider: "nano-banana-pro", aspectRatio: "2:3", style: "stained-glass", prompt: "{subject || a phoenix rising in flames}, bold black leading lines between glowing colored glass panes, luminous backlit jewel tones, symmetrical mosaic composition", negativePrompt: "photorealistic, flat, muddy colors, broken composition, lowres, watermark, text" },
  },

  // ── Diagrams & Infographics ──────────────────────────────────────────────
  {
    id: "generate-image/blueprint",
    name: "Blueprint Schematic",
    description: "White-on-blue technical drawing.",
    group: "Diagrams & Infographics",
    data: { provider: "ideogram-v3", aspectRatio: "4:3", style: "blueprint", prompt: "technical blueprint schematic of {subject || a vintage propeller aircraft}, crisp white line work on deep blue drafting paper, dimension lines with measurements and callout labels, legible correctly-spelled labels, tidy orthographic engineering-drawing layout", negativePrompt: "photorealistic, color fill, shading, misspelled labels, garbled text, sloppy lines, lowres, watermark" },
  },
  {
    id: "generate-image/infographic",
    name: "Infographic",
    description: "Icons + labels data layout.",
    group: "Diagrams & Infographics",
    data: { provider: "ideogram-v3", aspectRatio: "4:3", prompt: "clean modern infographic about {topic || how renewable energy works}, structured data-visualization layout with simple flat icons, short labeled callouts and a few key stats, clear visual hierarchy with a strong title and numbered sections, generous spacing and aligned grid, cohesive limited palette, legible correctly-spelled text, crisp flat editorial finish", negativePrompt: "cluttered busy layout, misspelled text, gibberish labels, overlapping elements, tiny unreadable type, photorealistic, lowres, watermark" },
  },
  {
    id: "generate-image/ui-mockup",
    name: "UI / App Mockup",
    description: "Clean app/website screen design.",
    group: "Diagrams & Infographics",
    data: { provider: "gpt-image-2", aspectRatio: "16:9", prompt: "modern UI design mockup of {app or website screen || a fitness tracker dashboard}, clean polished product interface with a clear navigation bar, real cards, buttons, charts and icons, consistent spacing and alignment on a tidy grid, contemporary design-system styling with a cohesive accent color, realistic legible correctly-spelled text and labels, crisp flat high-fidelity finish", negativePrompt: "cluttered, misspelled text, gibberish labels, garbled UI text, misaligned elements, blurry, photorealistic photo, lowres, watermark" },
  },
  {
    id: "generate-image/flowchart",
    name: "Flowchart / Diagram",
    description: "Boxes, arrows, labels.",
    group: "Diagrams & Infographics",
    data: { provider: "ideogram-v3", aspectRatio: "16:9", prompt: "clean flowchart diagram of {process || a customer onboarding workflow}, clearly labeled rounded boxes connected by directional arrows, logical left-to-right flow with decision diamonds and a clear top-down hierarchy, evenly spaced nodes on a tidy grid, cohesive limited palette, legible correctly-spelled labels, crisp flat modern finish", negativePrompt: "cluttered, tangled crossing arrows, misspelled text, gibberish labels, overlapping boxes, tiny unreadable type, photorealistic, lowres, watermark" },
  },
  {
    id: "generate-image/chart-graph",
    name: "Chart / Graph",
    description: "Bar / line / pie data viz.",
    group: "Diagrams & Infographics",
    data: { provider: "ideogram-v3", aspectRatio: "4:3", prompt: "clean data-visualization chart of {data || quarterly revenue growth}, a {bar, line or pie || bar} graph with clearly labeled axes, gridlines, value labels and a legend, balanced composition with a clear title and generous margins, cohesive limited palette with one accent color, legible correctly-spelled text, crisp flat modern finish", negativePrompt: "cluttered, distorted proportions, misleading scale, misspelled text, gibberish labels, overlapping elements, tiny unreadable type, photorealistic, lowres, watermark" },
  },
  {
    id: "generate-image/timeline",
    name: "Timeline",
    description: "Milestones along an axis.",
    group: "Diagrams & Infographics",
    data: { provider: "ideogram-v3", aspectRatio: "16:9", prompt: "horizontal timeline infographic of {topic || the history of space exploration}, evenly spaced chronological milestones along a central axis, each marked with a date, a simple icon and a short labeled caption alternating above and below the line, clear left-to-right reading order with a strong title, cohesive limited palette, legible correctly-spelled text, crisp flat modern finish", negativePrompt: "cluttered, out-of-order milestones, uneven spacing, misspelled text, gibberish labels, overlapping elements, tiny unreadable type, photorealistic, lowres, watermark" },
  },
  {
    id: "generate-image/x-ray",
    name: "X-Ray / See-Through",
    description: "Internal-structure radiograph look.",
    group: "Illustration & Art Styles",
    data: { provider: "nano-banana-pro", aspectRatio: "4:3", prompt: "x-ray see-through render of {subject || a blooming flower}, translucent body revealing the internal structure and skeleton beneath, glowing luminous white-and-cyan lines on a deep black background, crisp radiograph aesthetic, centered specimen composition", negativePrompt: "opaque solid surface, full color, photorealistic skin, cluttered background, lowres, watermark, text" },
  },

  // ── More Icons, Game Assets & Textures ───────────────────────────────────
  {
    id: "generate-image/3d-icon",
    name: "3D Icon",
    description: "Glossy single 3D-rendered icon.",
    group: "Icons, Game Assets & Textures",
    data: { provider: "nano-banana-pro", aspectRatio: "1:1", prompt: "a single glossy 3D rendered icon of {subject || a friendly chat bubble}, smooth rounded clay-like form with soft beveled edges, soft studio key light with a gentle gradient falloff, a bright specular highlight and a soft contact shadow, perfectly centered with generous padding, isolated on a clean plain background, vibrant cohesive palette, crisp and readable at small sizes", negativePrompt: "flat, 2d, multiple objects, cluttered background, harsh shadows, photographic scene, lowres, watermark, text" },
  },

  // ── More Architecture & Interiors ────────────────────────────────────────
  {
    id: "generate-image/floor-plan",
    name: "Floor Plan",
    description: "Top-down labeled layout.",
    group: "Architecture & Interiors",
    data: { provider: "ideogram-v3", aspectRatio: "1:1", prompt: "clean top-down architectural floor plan of {space || a two-bedroom apartment}, precise orthographic plan view, crisp thin black line work on a white background, clearly labeled rooms with legible correctly-spelled text, dimension lines with measurements, simple furniture symbols, a north arrow and a scale bar, tidy professional blueprint style, accurate proportions", negativePrompt: "perspective, 3d view, photorealistic, misspelled labels, garbled text, sloppy lines, lowres, watermark" },
  },
  {
    id: "generate-image/aerial-site",
    name: "Aerial Site View",
    description: "Drone view of building + context.",
    group: "Architecture & Interiors",
    data: { provider: "seedream", aspectRatio: "16:9", prompt: "photoreal aerial architectural site view of {building || a modern campus among landscaped grounds}, high top-down drone perspective revealing the building footprint, surrounding context, roads and landscaping, warm golden-hour sun casting long raking shadows that define the layout, bold graphic composition emphasizing site planning and scale, expansive serene mood with natural color, accurate geometry and crisp detail across the frame", negativePrompt: "distorted geometry, warped perspective, tilted horizon, lens distortion, flat midday light, lowres, watermark, text" },
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
        "Single photorealistic studio composite of the SAME person from the reference image at five stages of life, shoulder-to-shoulder left to right in a smooth age progression: a child around 7, a teen around 15, a young adult around 27, a mature adult around 45, and an elder around 70. Editorial portrait photography, 85mm lens at f/2.8, each figure framed chest-up, all facing camera with the same calm expression. CRITICAL identity lock — same eyes, eye color, brow, nose, ears, jawline and facial bone structure across every figure, unmistakably the same person; age ONLY via skin texture, fine lines and wrinkles, hairline, hair color (darker in youth, greying with age), and a slight shift in facial fullness. Age-appropriate wardrobe per stage. Even soft cinematic studio key with gentle rim separation, clean dark-grey gradient seamless backdrop, refined neutral grade, natural skin tones, tack-sharp facial detail; the five figures fill the frame.",
      negativePrompt:
        "different person, inconsistent face between figures, distorted features, identity drift across ages, wrong eye color, plastic skin, deformed, extra fingers, blurry, lowres, watermark, text",
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
        "Single photorealistic studio composite of the SAME person from the reference image as a three-age triptych, shoulder-to-shoulder left to right: around age 10, around age 40, and around age 75. Editorial portrait photography, 85mm lens at f/2.8, each figure framed chest-up, facing camera with the same calm expression. CRITICAL identity lock — same eyes, eye color, brow, nose, ears, jawline and facial bone structure across all three, unmistakably the same person; age ONLY via skin texture, fine lines, hairline, hair color (darker in youth, greying with age), and a slight shift in facial fullness. Age-appropriate clothing per stage. Even soft cinematic studio key light with gentle rim separation, clean dark-grey gradient seamless backdrop, refined neutral grade, natural skin tones, tack-sharp facial detail; the three figures fill the frame.",
      negativePrompt:
        "different person, inconsistent face between figures, distorted features, identity drift across ages, wrong eye color, plastic skin, deformed, blurry, lowres, watermark, text",
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
        "Single black-and-white photorealistic studio composite of the SAME person from the reference image rendered at five stages of life, shoulder-to-shoulder left to right in a smooth age progression: around 7, 15, 27, 45, and 70. Fine-art monochrome portraiture, 85mm lens at f/2.8, chest-up framing, all facing camera with the same calm expression. CRITICAL identity lock — same eyes, brow, nose, ears, jawline and facial bone structure across every figure, unmistakably the same person; age ONLY via skin texture, fine lines, hairline, greying hair, and a slight shift in facial fullness. Age-appropriate clothing per stage. Even soft studio key light with gentle rim separation, clean dark-grey gradient backdrop. Deep tonal range from rich blacks to clean highlights, fine silver-gelatin film grain, tack-sharp facial detail; the five figures fill the frame.",
      negativePrompt:
        "color, color tint, different person, inconsistent face between figures, distorted features, identity drift across ages, plastic skin, deformed, blurry, lowres, watermark, text",
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
        "Single photorealistic studio composite of the SAME person from the reference image across five decades, shoulder-to-shoulder left to right with a smooth age progression and period-accurate styling: a 1980s child, a 1990s teen, a 2000s young adult, a 2010s adult, and a 2020s mature adult. Editorial portrait photography, 85mm lens at f/2.8, chest-up framing, all facing camera with the same calm expression. CRITICAL identity lock — same eyes, eye color, brow, nose, ears, jawline and facial bone structure across every figure, unmistakably the same person; age ONLY via skin texture, fine lines, hairline, hair color, and a slight shift in facial fullness. Style each to its decade in hair and wardrobe with a subtle period-accurate film treatment per decade: 1980s bold colors and big hair, 1990s casual grunge, 2000s frosted tips, 2010s clean modern, 2020s contemporary. Even soft studio key with gentle rim separation, clean dark-grey gradient seamless backdrop, natural skin tones, tack-sharp facial detail; the five figures fill the frame.",
      negativePrompt:
        "different person, inconsistent face between figures, distorted features, identity drift across decades, anachronistic styling, plastic skin, deformed, blurry, lowres, watermark, text",
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
        "Single photorealistic studio composite of the SAME person from the reference image in four seasonal looks, shoulder-to-shoulder left to right: spring, summer, autumn, and winter. Editorial portrait photography, 85mm lens at f/2.8, chest-up framing, all facing camera with the same calm expression, all at the SAME age as the reference — this is seasons, not aging. CRITICAL identity lock — same eyes, eye color, brow, nose, ears, jawline and facial bone structure across all four figures, unmistakably the same person; ONLY wardrobe, hair styling and a subtle seasonal color grade change. Spring: light pastel layers, fresh airy tone. Summer: light tee, warm sunny tone. Autumn: knit sweater, golden amber tone. Winter: coat and scarf, cool crisp tone. Even soft studio key light with a gentle seasonal color cast and rim separation per figure, clean dark-grey gradient seamless backdrop, natural skin tones, tack-sharp facial detail; the four figures fill the frame.",
      negativePrompt:
        "different person, inconsistent face between figures, distorted features, aging, age differences between figures, plastic skin, deformed, blurry, lowres, watermark, text",
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
        "Single photorealistic composite of the SAME person from the reference image across four times of day, shoulder-to-shoulder left to right: dawn, midday, golden hour, and night. Editorial portrait photography, 85mm lens at f/2.8, chest-up framing, all facing camera with the same calm expression, all at the SAME age as the reference. CRITICAL identity lock — same eyes, eye color, brow, nose, ears, jawline and facial bone structure across all four figures, unmistakably the same person; ONLY the lighting and color temperature change between figures. Dawn: soft cool blue light. Midday: bright neutral daylight. Golden hour: warm amber backlight with a gentle glow. Night: moody low light with a cool rim. Consistent chest-up framing and a clean dark-grey gradient seamless backdrop, natural skin tones, tack-sharp facial detail; the four figures fill the frame.",
      negativePrompt:
        "different person, inconsistent face between figures, distorted features, aging, age differences between figures, blown highlights, plastic skin, deformed, blurry, lowres, watermark, text",
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
        "Premium studio editorial portrait of the SAME person from the reference image wearing an oversized modern football jersey in the colors of {team || deep crimson and gold}. Sports-fashion editorial photography, 85mm lens at f/2, shallow depth of field with the subject tack-sharp against a softly blurred background. CRITICAL identity lock — same eyes, brow, nose, ears, jawline and facial bone structure, unmistakably the same person, exact skin tone preserved. Soft directional stadium-spotlight key with natural shadow depth and a subtle rim; gradient backdrop in the jersey colors with a faint geometric pattern and soft pitch markings; gentle atmospheric haze and light film grain. Confident, relaxed three-quarter pose, rich saturated grade. Crisp fabric weave and clean jersey graphics.",
      negativePrompt:
        "different person, inconsistent face, distorted features, altered skin tone, distorted or garbled logo, misspelled team name, deformed, extra fingers, blurry, lowres, watermark, text artifacts",
    },
  },
  // ── Stylized Subject + Edits (shared with the deprecating modify-image) ──
  // Transform patterns — work here when a reference image is connected
  // (nano-banana-pro edits it while preserving untouched regions). The
  // instruction lives in the prompt, not `style`.
  ...stylizedSubjectFor("generate-image"),
  ...editsFor("generate-image"),
]
