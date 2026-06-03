/**
 * Featured entity starter catalog (north-star §6 ③ — the "Featured" tab of each
 * entity Library).
 *
 * These are app-provided starter presets: a curated visual description per
 * archetype that the user can drop into an entity's Generate field as a
 * head-start, instead of writing one from scratch. They are intentionally
 * ASSETLESS — they seed generation (the user still generates the image with
 * their chosen model + style), so no hosted sample images are required. The
 * "Mine" tab (reuse an already-saved image) and "+ New" (Upload / write your
 * own) cover the other two on-ramps.
 */
export interface FeaturedEntity {
  /** Stable id (unique within its type). */
  id: string
  /** Short name shown on the chip. */
  label: string
  /** Curated visual description dropped into the Generate field. */
  description: string
}

export const FEATURED_ENTITIES: Record<string, readonly FeaturedEntity[]> = {
  character: [
    {
      id: "detective",
      label: "Grizzled Detective",
      description:
        "A weathered private detective in his 50s, stubble, rumpled trench coat, tired but sharp eyes, film-noir presence",
    },
    {
      id: "barista",
      label: "Cheerful Barista",
      description:
        "A cheerful young barista with curly hair, apron over a casual shirt, warm welcoming smile, energetic and approachable",
    },
    {
      id: "elder",
      label: "Wise Elder",
      description:
        "A wise elderly mentor with long grey hair and beard, flowing robes, calm knowing expression, gentle authority",
    },
    {
      id: "adventurer",
      label: "Young Adventurer",
      description:
        "A young adventurer in practical travel gear with a worn backpack, determined expression, sun-weathered skin",
    },
    {
      id: "scientist",
      label: "Focused Scientist",
      description:
        "A focused scientist in a white lab coat, glasses, hair tied back, intelligent and intense demeanor",
    },
    {
      id: "child",
      label: "Curious Kid",
      description:
        "A curious 8-year-old child with bright eyes and colorful casual clothes, playful and full of wonder",
    },
  ],
  location: [
    {
      id: "alley",
      label: "Cyberpunk Alley",
      description:
        "A neon-lit cyberpunk alley at night, wet pavement reflecting signs, drifting steam, dense layered urban detail",
    },
    {
      id: "cafe",
      label: "Cozy Café",
      description:
        "A cozy coffee shop interior, warm wood surfaces, soft pendant lighting, hanging plants, a few relaxed patrons",
    },
    {
      id: "forest",
      label: "Misty Forest",
      description:
        "A misty ancient forest at dawn, tall trees, shafts of light through fog, ferns underfoot, ethereal stillness",
    },
    {
      id: "office",
      label: "Modern Office",
      description:
        "A sleek modern office with glass walls, a city skyline view, minimal furniture, bright natural daylight",
    },
    {
      id: "beach",
      label: "Golden Beach",
      description:
        "A tranquil tropical beach at golden hour, soft rolling waves, leaning palm trees, warm low sun",
    },
    {
      id: "bridge",
      label: "Spaceship Bridge",
      description:
        "A futuristic spaceship bridge, glowing control panels, a vast viewport onto a star field, cool blue light",
    },
  ],
  object: [
    {
      id: "watch",
      label: "Vintage Pocket Watch",
      description:
        "An ornate vintage gold pocket watch, intricate engraving, slightly worn, on a fine chain",
    },
    {
      id: "sword",
      label: "Enchanted Sword",
      description:
        "A glowing enchanted sword, faint runes etched along the blade, ornate hilt wrapped in leather",
    },
    {
      id: "robot",
      label: "Retro Robot",
      description:
        "A friendly retro-futuristic robot companion, rounded brushed-metal chassis, a single expressive lens eye",
    },
    {
      id: "book",
      label: "Ancient Spellbook",
      description:
        "An ancient leather-bound spellbook, gilded page edges, embossed cover, a faint mysterious glow",
    },
    {
      id: "car",
      label: "Classic Convertible",
      description:
        "A sleek classic convertible sports car, polished chrome trim, vivid glossy paint, whitewall tires",
    },
  ],
}

/** Featured presets for an entity type ("character" | "location" | "object"). */
export function getFeaturedEntities(type: string): readonly FeaturedEntity[] {
  return FEATURED_ENTITIES[type] ?? []
}
