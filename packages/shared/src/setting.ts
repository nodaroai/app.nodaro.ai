/**
 * Canonical catalog of place/environment presets ("Setting").
 *
 * Setting dimension of an image/video — *where* the shot takes place (coffee
 * shop, forest clearing, cyberpunk alley, cathedral, etc.). Orthogonal to the
 * other cinematography dimensions:
 *
 *  - Style      = artistic medium (Oil Painting, Pixar 3D, Photorealistic)
 *  - Atmosphere = what's in the air (Fog, Rain, God rays, Dust)
 *  - Lighting   = direction / quality of light
 *  - Setting    = *where* (this file)
 *
 * Not to be confused with the Location **entity** node, which generates a
 * persistent reference image for a specific place via an AI provider call.
 * Setting is pure prompt text (zero credits, zero API calls), deterministic.
 *
 * Shared between the picker UI, the standalone Setting parameter node, and
 * the prompt-hint injection on both the frontend DAG executor and the
 * backend orchestrator.
 */

export type SettingCategory = "indoor" | "urban" | "nature" | "fantastical"

export interface Setting {
  readonly id: string
  readonly label: string
  readonly category: SettingCategory
  readonly description: string
  readonly promptHint: string
}

export const SETTINGS: ReadonlyArray<Setting> = [
  // -------------------- Indoor --------------------
  { id: "coffee-shop",     label: "Coffee Shop",          category: "indoor",      description: "Cozy café interior",                     promptHint: "set in a cozy coffee shop interior with warm pendant lights, exposed brick walls and steam drifting over espresso machines" },
  { id: "library",         label: "Library",              category: "indoor",      description: "Grand library with tall shelves",        promptHint: "set in a grand library interior with tall oak shelves, leather-bound books, warm reading lamps and a tall arched window" },
  { id: "office",          label: "Modern Office",        category: "indoor",      description: "Bright glassy modern office",            promptHint: "set in a bright modern office with floor-to-ceiling windows, minimalist desks, potted plants and soft ambient daylight" },
  { id: "home-office",     label: "Home Office",          category: "indoor",      description: "Cozy home workspace",                    promptHint: "set in a cozy home office with a wooden desk, laptop and monitor, warm task lamp, bookshelves, houseplants and soft daylight through a nearby window" },
  { id: "bedroom",         label: "Bedroom",              category: "indoor",      description: "Intimate bedroom",                       promptHint: "set in an intimate bedroom with soft diffused window light, rumpled linen bedding and warm wood floors" },
  { id: "living-room",     label: "Living Room",          category: "indoor",      description: "Cozy residential living room",           promptHint: "set in a cozy residential living room with a plush sofa, wooden coffee table, soft lamplight, bookshelves and a warm family-home atmosphere" },
  { id: "kitchen",         label: "Kitchen",              category: "indoor",      description: "Warm home kitchen with morning light",   promptHint: "set in a warm home kitchen with morning light, wood cabinets, a marble island with fresh produce and steam rising from a stovetop" },
  { id: "hotel-room",      label: "Hotel Room",           category: "indoor",      description: "Elegant hotel room with city view",      promptHint: "set in an elegant hotel room with a neatly made king bed, heavy drapes, a panoramic city view through the window, minimalist desk and soft warm lamplight" },
  { id: "restaurant",      label: "Restaurant",           category: "indoor",      description: "Intimate candlelit restaurant",          promptHint: "set in an intimate restaurant interior with candlelit tables, white linen, leather booths, wine glasses catching warm light and a softly bustling dining room" },
  { id: "nightclub",       label: "Nightclub",            category: "indoor",      description: "Dark club with lasers and smoke",        promptHint: "set in a dark nightclub interior with a packed dance floor, laser and strobe lighting, thumping bass energy, silhouetted bodies and hazy atmospheric smoke" },
  { id: "gym",             label: "Gym",                  category: "indoor",      description: "Modern fitness gym",                     promptHint: "set in a modern fitness gym with rubber flooring, racks of weights, mirrored walls and bright overhead lights on training equipment" },
  { id: "classroom",       label: "Classroom",            category: "indoor",      description: "Bright school classroom",                promptHint: "set in a bright school classroom with rows of wooden desks, a whiteboard covered in notes, posters on the walls and afternoon sun through tall windows" },
  { id: "hospital",        label: "Hospital",             category: "indoor",      description: "Sterile hospital corridor",              promptHint: "set in a sterile hospital corridor with polished linoleum floors, fluorescent ceiling lights, stainless-steel gurneys and softly beeping medical equipment" },
  { id: "laboratory",      label: "Laboratory",           category: "indoor",      description: "Research lab with glowing equipment",    promptHint: "set in a modern research laboratory with stainless-steel benches, glowing microscopes, racks of beakers and test tubes, overhead task lights and faint blue ambient glow from monitors" },
  { id: "courtroom",       label: "Courtroom",            category: "indoor",      description: "Wood-paneled courtroom",                 promptHint: "set in a formal wood-paneled courtroom with rows of oak benches, a raised judge's bench, a lectern, flags on either side and amber light streaming through tall windows" },
  { id: "warehouse",       label: "Industrial Warehouse", category: "indoor",      description: "Cavernous warehouse with skylights",     promptHint: "set in a cavernous industrial warehouse with steel rafters, concrete floors and dust motes in shafts of light from skylights above" },
  { id: "subway-car",      label: "Subway Car",           category: "indoor",      description: "Moving subway interior",                 promptHint: "set inside a moving subway car with fluorescent strip lights, graffiti-scarred windows and empty blue plastic seats" },
  { id: "taxi",            label: "Taxi Interior",        category: "indoor",      description: "Back seat of a city taxi at night",      promptHint: "set inside the back seat of a city taxi at night with rain-streaked windows, neon reflections sliding across the dashboard, the driver silhouetted against the windshield and the dim green glow of the fare meter" },
  { id: "cathedral",       label: "Cathedral",            category: "indoor",      description: "Gothic cathedral interior",              promptHint: "set in a vast gothic cathedral interior with vaulted stone ceilings, stained-glass kaleidoscopes and candlelit side chapels" },
  { id: "art-gallery",     label: "Art Gallery",          category: "indoor",      description: "Minimalist white-cube gallery",          promptHint: "set in a minimalist white-cube art gallery with polished concrete floor, precision track lighting and framed canvases on bare walls" },

  // -------------------- Urban --------------------
  { id: "city-street",     label: "City Street",          category: "urban",       description: "Bustling city street",                   promptHint: "set on a bustling city street with pedestrians, traffic, reflections on wet asphalt and mid-rise commercial facades" },
  { id: "rooftop",         label: "Rooftop",              category: "urban",       description: "Rooftop terrace over skyline",           promptHint: "set on a rooftop terrace overlooking a dense city skyline with string lights, distant car horns and hazy sunset light" },
  { id: "back-alley",      label: "Back Alley",           category: "urban",       description: "Gritty narrow alley",                    promptHint: "set in a narrow urban back alley with dumpsters, fire escapes, overflowing rain gutters and a single flickering wall sconce" },
  { id: "neon-alley",      label: "Neon Alley",           category: "urban",       description: "Rain-soaked neon alley",                 promptHint: "set in a rain-soaked neon-lit alley in a Tokyo-style nightlife district with glowing kanji signs, steam vents and reflective puddles" },
  { id: "park",            label: "Urban Park",           category: "urban",       description: "Leafy urban park with paths",            promptHint: "set in a leafy urban park with winding footpaths, wooden benches, tall shade trees, people lounging on grass and sunlight filtering through leaves" },
  { id: "backyard",        label: "Backyard Patio",       category: "urban",       description: "Deck patio with string lights",          promptHint: "set in a warm backyard patio with a wooden deck, string lights overhead, lounge chairs, green lawn beyond a low fence and the soft golden light of a late summer afternoon" },
  { id: "highway",         label: "Open Highway",         category: "urban",       description: "Sweeping highway to horizon",            promptHint: "set on a sweeping open highway with lane markings stretching to the horizon, rolling hills on either side, a single car on the road and a vast cinematic sky" },
  { id: "bridge",          label: "Suspension Bridge",    category: "urban",       description: "Long suspension bridge over water",      promptHint: "set on a long suspension bridge with towering steel cables, sweeping views over water, evening glow on the railings and a distant city skyline beyond" },
  { id: "train-station",   label: "Train Station",        category: "urban",       description: "Platform with waiting train",            promptHint: "set on a long urban train station platform with polished steel rails, a waiting train with warmly lit windows, overhead station signs, drifting steam and the lonely echo of footsteps on stone" },
  { id: "airport",         label: "Airport Terminal",     category: "urban",       description: "Vast terminal with curved glass",        promptHint: "set in a vast airport terminal with gleaming polished floors, flight information boards, travelers with rolling luggage, curved glass walls and the soft drone of distant announcements" },
  { id: "parking-lot",     label: "Parking Lot",          category: "urban",       description: "Suburban parking lot at dusk",           promptHint: "set in an empty suburban parking lot at dusk with sodium-vapor lamps casting orange pools, scattered shopping carts and painted lane lines" },
  { id: "penthouse",       label: "Penthouse",            category: "urban",       description: "Luxury penthouse with skyline view",     promptHint: "set in a luxury penthouse interior with panoramic skyline views, marble floors, modernist furniture and low warm ambient light" },
  { id: "gas-station",     label: "Gas Station",          category: "urban",       description: "Lonely highway gas station at night",    promptHint: "set at a lonely highway gas station at night with a fluorescent canopy, bug-swarmed sodium lamps and cracked asphalt" },

  // -------------------- Nature --------------------
  { id: "forest",          label: "Forest Clearing",      category: "nature",      description: "Sunlit mossy clearing",                  promptHint: "set in a sunlit forest clearing with moss-covered stones, dappled light through tall trees and a soft carpet of fallen leaves" },
  { id: "beach",           label: "Beach",                category: "nature",      description: "Wide sandy beach with surf",             promptHint: "set on a wide sandy beach with gentle breaking surf, footprints in wet sand and a pastel horizon" },
  { id: "mountain-peak",   label: "Mountain Peak",        category: "nature",      description: "Rocky alpine summit",                    promptHint: "set on a dramatic rocky mountain peak above the cloud line with a sweeping alpine vista, windblown snow and crisp thin-air light" },
  { id: "desert",          label: "Desert Dunes",         category: "nature",      description: "Windblown desert dunes",                 promptHint: "set among endless windblown desert dunes with rippled sand patterns, heat haze on the horizon and a merciless open sky" },
  { id: "jungle",          label: "Jungle",               category: "nature",      description: "Dense humid jungle interior",            promptHint: "set in a dense humid jungle interior with hanging vines, giant ferns, distant birdcalls and emerald light filtering through the canopy" },
  { id: "grassland",       label: "Grassland",            category: "nature",      description: "Open windswept grassland",               promptHint: "set in an open windswept grassland under a huge sky with swaying tall grass, scattered wildflowers and distant rolling hills" },
  { id: "snowy-tundra",    label: "Snowy Tundra",         category: "nature",      description: "Frozen wind-carved tundra",              promptHint: "set in a vast frozen tundra with wind-carved snow drifts, low arctic sun, long blue shadows and scattered ice-crusted stones" },
  { id: "lake-shore",      label: "Lake Shore",           category: "nature",      description: "Still mountain lake shoreline",          promptHint: "set on a still mountain-lake shoreline with mirror reflections, smooth pebbles, wispy morning mist and a line of dark conifers" },
  { id: "riverbank",       label: "Riverbank",            category: "nature",      description: "Meandering river with willow trees",     promptHint: "set on a meandering riverbank with slow flowing water, smooth pebbles along the shore, willow trees leaning over the banks and dappled sunlight rippling on the current" },
  { id: "waterfall",       label: "Waterfall",            category: "nature",      description: "Cascading falls over mossy cliffs",      promptHint: "set at a thundering waterfall cascading over mossy cliffs into a misty pool, rainbows in the spray, an emerald basin below and lush ferns clinging to wet rocks" },
  { id: "cave",            label: "Cave",                 category: "nature",      description: "Rocky cave with daylight shafts",        promptHint: "set inside a vast rocky cave with dripping stalactites, pools of still water, shafts of daylight piercing the darkness from above and dark mossy walls slick with moisture" },
  { id: "western-canyon",  label: "Western Canyon",       category: "nature",      description: "Red-rock mesa with a winding river",     promptHint: "set in a sweeping Southwestern canyon landscape with red sandstone mesas, a winding river cutting through the valley floor, cottonwood groves, open arid plains and the wide cinematic sky of a classic Western" },

  // -------------------- Fantastical --------------------
  { id: "alien-planet",    label: "Alien Planet",         category: "fantastical", description: "Otherworldly landscape with twin moons", promptHint: "set on an otherworldly alien planet landscape with bioluminescent flora, twin moons in a violet sky and iridescent rock formations" },
  { id: "spaceship-interior", label: "Spaceship Interior", category: "fantastical", description: "Sleek starship corridor",              promptHint: "set inside a sleek spaceship interior with curved corridors, illuminated control panels, softly humming machinery and a panoramic view of stars through a reinforced window" },
  { id: "underwater",      label: "Underwater",           category: "fantastical", description: "Sunlit deep-ocean scene",                promptHint: "set in a deep-ocean underwater scene with shafts of sunlight piercing blue-green water, drifting particles and dim coral shapes" },
  { id: "fantasy-castle",  label: "Fantasy Castle",       category: "fantastical", description: "Sprawling castle courtyard",             promptHint: "set in a sprawling fantasy castle courtyard with weathered stone walls, banners, torches in iron sconces and wrought-iron gates" },
  { id: "medieval-village", label: "Medieval Village",    category: "fantastical", description: "Cobblestone village square",             promptHint: "set in a cobblestone medieval village square with timber-framed houses, smoking chimneys, a stone well, market stalls and warm amber lantern light" },
  { id: "ancient-ruins",   label: "Ancient Ruins",        category: "fantastical", description: "Vine-choked stone ruins",                promptHint: "set among vine-choked ancient stone ruins with toppled pillars, weathered carvings, shafts of golden light piercing overgrown jungle and the weight of a long-forgotten civilization" },
  { id: "cyberpunk-city",  label: "Cyberpunk City",       category: "fantastical", description: "Sprawling neon megacity skyline",        promptHint: "set on an elevated walkway over a sprawling cyberpunk megacity skyline at night with towering neon-clad skyscrapers, holographic billboards, flying traffic and a pink haze blanketing the grid" },
  { id: "haunted-mansion", label: "Haunted Mansion",      category: "fantastical", description: "Decaying gothic manor",                  promptHint: "set inside a decaying gothic haunted mansion with cobwebbed chandeliers, warped wooden floors, dust-covered furniture and pale moonlight through cracked windows" },
  { id: "dreamscape",      label: "Dreamscape",           category: "fantastical", description: "Surreal floating islands",               promptHint: "set in a surreal dreamscape with floating islands, impossible architecture, pastel mist and skies that shift between day and night" },
  { id: "wasteland",       label: "Post-Apocalyptic Wasteland", category: "fantastical", description: "Rusted overcast wasteland",        promptHint: "set in a bleak post-apocalyptic wasteland with rusted vehicles, broken overpasses, grey ash drifts and a perpetually overcast sky" },
] as const

const settingById = new Map<string, Setting>(SETTINGS.map((s) => [s.id, s]))

export function getSetting(id: string | undefined | null): Setting | undefined {
  if (!id) return undefined
  return settingById.get(id)
}

export function getSettingLabel(id: string | undefined | null, fallback?: string): string {
  const s = getSetting(id)
  if (s) return s.label
  if (fallback !== undefined) return fallback
  return (id ?? "").replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
}

export function getSettingPromptHint(id: string | undefined | null): string {
  return getSetting(id)?.promptHint ?? ""
}

export const SETTING_IDS: ReadonlyArray<string> = SETTINGS.map((s) => s.id)

export const SETTING_CATEGORY_LABELS: Readonly<Record<SettingCategory, string>> = {
  indoor: "Indoor",
  urban: "Urban",
  nature: "Nature",
  fantastical: "Fantastical",
}
