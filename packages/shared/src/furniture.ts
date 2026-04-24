/**
 * Canonical catalog of furniture presets for the Object entity node.
 *
 * When the Object category is "furniture", users pick a specific furniture
 * piece from this catalog. The picker auto-fills the object's `objectName`
 * and `description` so the existing `buildObjectPrompt` pipeline just works
 * — no backend prompt changes needed.
 *
 * Organized into everyday sub-categories: seating, tables, beds, storage,
 * lighting, kitchen & dining, outdoor, decorative, and bath.
 */

export type FurnitureSubcategory =
  | "seating"
  | "tables"
  | "beds"
  | "storage"
  | "lighting"
  | "kitchen-dining"
  | "outdoor"
  | "decorative"
  | "bath"

export interface Furniture {
  readonly id: string
  readonly label: string
  readonly subcategory: FurnitureSubcategory
  readonly description: string
}

export const FURNITURE: ReadonlyArray<Furniture> = [
  // -------------------- Seating --------------------
  { id: "sofa",                 label: "Sofa",                subcategory: "seating", description: "Three-seater sofa with plush cushioned back and seat, low armrests and upholstery in a neutral tone" },
  { id: "sectional-sofa",       label: "Sectional Sofa",      subcategory: "seating", description: "L-shaped sectional sofa with deep seats, soft cushions, a chaise end and hidden storage or recline mechanisms" },
  { id: "loveseat",             label: "Loveseat",            subcategory: "seating", description: "Compact two-seat loveseat with rolled arms, tufted back and tapered wooden legs" },
  { id: "armchair",             label: "Armchair",            subcategory: "seating", description: "Upholstered armchair with a tall padded back, curved armrests and four slim wooden legs" },
  { id: "recliner",             label: "Recliner",            subcategory: "seating", description: "Padded recliner chair with a pull lever, extending footrest, thick leather upholstery and a reclined backrest" },
  { id: "office-chair",         label: "Office Chair",        subcategory: "seating", description: "Ergonomic office chair with a mesh back, adjustable armrests, gas-lift height and a five-point caster base" },
  { id: "rocking-chair",        label: "Rocking Chair",       subcategory: "seating", description: "Wooden rocking chair with curved rockers, a woven cane back and a padded seat cushion" },
  { id: "throne",               label: "Throne",              subcategory: "seating", description: "Ornate royal throne with a towering carved back, gilded trim, jeweled accents and a plush velvet cushion" },
  { id: "bean-bag",             label: "Bean Bag",            subcategory: "seating", description: "Oversized slouchy bean bag chair with soft fabric exterior and a pillowy squishy shape that molds to the body" },
  { id: "stool",                label: "Stool",               subcategory: "seating", description: "Simple backless stool with a round wooden seat, four splayed turned legs and a worn comfortable patina" },
  { id: "bench",                label: "Bench",               subcategory: "seating", description: "Long wooden bench with a flat seat, open slatted back and sturdy planked legs" },
  { id: "chaise-lounge",        label: "Chaise Lounge",       subcategory: "seating", description: "Elegant chaise lounge with a sloped headrest, elongated upholstered seat and turned wooden legs" },
  { id: "dining-chair",         label: "Dining Chair",        subcategory: "seating", description: "Formal dining chair with a high slatted back, upholstered seat cushion and tapered wooden legs" },

  // -------------------- Tables --------------------
  { id: "dining-table",         label: "Dining Table",        subcategory: "tables", description: "Large rectangular dining table with a polished wooden top, thick trestle base and seating for six to eight" },
  { id: "coffee-table",         label: "Coffee Table",        subcategory: "tables", description: "Low rectangular coffee table with a glass or wooden top, clean minimalist legs and a lower shelf for magazines" },
  { id: "side-table",           label: "Side Table",          subcategory: "tables", description: "Petite side table with a round top, single drawer and slim tapered legs" },
  { id: "console-table",        label: "Console Table",       subcategory: "tables", description: "Narrow console table with a long slim top, delicate legs and decorative scrollwork along the apron" },
  { id: "desk",                 label: "Desk",                subcategory: "tables", description: "Writing desk with a flat work surface, drawer bank on the side and a cable management cutout at the back" },
  { id: "workbench",            label: "Workbench",           subcategory: "tables", description: "Heavy-duty workbench with a thick butcher-block top, pegboard back panel and a vice clamped to one edge" },
  { id: "vanity-table",         label: "Vanity Table",        subcategory: "tables", description: "Dressing vanity with a wide tri-fold mirror, small drawers on each side and a cushioned bench tucked underneath" },
  { id: "nightstand",           label: "Nightstand",          subcategory: "tables", description: "Small bedside nightstand with a single drawer, open lower shelf and a lamp-ready top surface" },
  { id: "picnic-table",         label: "Picnic Table",        subcategory: "tables", description: "Classic wooden picnic table with a plank top, attached bench seats and weathered outdoor finish" },

  // -------------------- Beds --------------------
  { id: "bed-single",           label: "Single Bed",          subcategory: "beds", description: "Narrow single bed with a padded headboard, tailored fitted sheet and a folded throw blanket at the foot" },
  { id: "bed-queen",            label: "Queen Bed",           subcategory: "beds", description: "Queen-size bed with a tall upholstered headboard, layered pillows, a crisp duvet and a runner across the foot" },
  { id: "bed-king",             label: "King Bed",            subcategory: "beds", description: "Grand king-size bed with a tufted headboard, multiple plush pillows, crisp white linens and a thick quilted duvet" },
  { id: "bunk-bed",             label: "Bunk Bed",            subcategory: "beds", description: "Sturdy wooden bunk bed with two stacked mattresses, side ladder, safety rails and matching kid-friendly bedding" },
  { id: "canopy-bed",           label: "Canopy Bed",          subcategory: "beds", description: "Four-poster canopy bed with tall carved posts, a fabric canopy draped overhead and flowing curtains at each corner" },
  { id: "four-poster-bed",      label: "Four-Poster Bed",     subcategory: "beds", description: "Four-poster bed with turned wooden columns at each corner rising unadorned to match the headboard's carved profile" },
  { id: "daybed",               label: "Daybed",              subcategory: "beds", description: "Daybed with a low frame, three upholstered sides acting as back and armrests and bolster cushions along the wall" },
  { id: "crib",                 label: "Baby Crib",           subcategory: "beds", description: "Wooden baby crib with vertical slatted sides, a small fitted mattress and soft plush toys tucked inside" },
  { id: "futon",                label: "Futon",               subcategory: "beds", description: "Convertible futon with a slim padded mattress over a folding metal frame that converts from sofa to bed" },
  { id: "hammock",              label: "Hammock",             subcategory: "beds", description: "Woven rope hammock slung between two supports, gently sagging with an inviting curve and colorful tassels at each end" },

  // -------------------- Storage --------------------
  { id: "bookshelf",            label: "Bookshelf",           subcategory: "storage", description: "Tall freestanding bookshelf with multiple horizontal shelves, wooden sides and rows of neatly stacked books" },
  { id: "wardrobe",             label: "Wardrobe",            subcategory: "storage", description: "Large double-door wardrobe with a full-length hanging section, drawer bank and decorative paneled doors" },
  { id: "dresser",              label: "Dresser",             subcategory: "storage", description: "Wooden dresser with a wide top, six deep drawers in two columns, brass pull handles and short tapered legs" },
  { id: "cabinet",              label: "Cabinet",             subcategory: "storage", description: "Storage cabinet with paneled doors, interior adjustable shelves and brass hardware" },
  { id: "chest",                label: "Storage Chest",       subcategory: "storage", description: "Weathered wooden storage chest with iron banding, a hinged domed lid and a heavy clasp latch at the front" },
  { id: "trunk",                label: "Steamer Trunk",       subcategory: "storage", description: "Vintage steamer trunk with leather straps, brass corners, travel stickers and a latched lid revealing tray inserts" },
  { id: "filing-cabinet",       label: "Filing Cabinet",      subcategory: "storage", description: "Four-drawer metal filing cabinet with label slots on each drawer, recessed pull handles and a key lock at the top" },
  { id: "tv-stand",             label: "TV Stand",            subcategory: "storage", description: "Low entertainment TV stand with open shelves, glass-fronted cabinet doors and cable pass-throughs" },
  { id: "display-case",         label: "Display Case",        subcategory: "storage", description: "Tall glass display case with interior lighting, glass shelves and a lockable framed door" },
  { id: "hutch",                label: "China Hutch",         subcategory: "storage", description: "Two-part china hutch with a glass-fronted upper cabinet showing plates on edge and a buffet base with drawers and doors" },
  { id: "toy-chest",            label: "Toy Chest",           subcategory: "storage", description: "Painted wooden toy chest with cheerful decals, a soft-close hinged lid and stickers accumulated on the sides" },

  // -------------------- Lighting --------------------
  { id: "floor-lamp",           label: "Floor Lamp",          subcategory: "lighting", description: "Tall floor lamp with a slim metal stand, weighted base, pull-chain switch and a drum fabric shade at the top" },
  { id: "table-lamp",           label: "Table Lamp",          subcategory: "lighting", description: "Classic table lamp with a ceramic base, pleated fabric shade and a small pull-chain switch" },
  { id: "desk-lamp",            label: "Desk Lamp",           subcategory: "lighting", description: "Articulating desk lamp with an adjustable arm, hinged head and a small cone-shaped metal shade" },
  { id: "chandelier",           label: "Chandelier",          subcategory: "lighting", description: "Grand crystal chandelier with tiered cascading crystals, curved golden arms and multiple flame-shaped bulbs" },
  { id: "pendant-light",        label: "Pendant Light",       subcategory: "lighting", description: "Modern pendant light hanging from a long cord with a minimalist metal or glass shade" },
  { id: "sconce",               label: "Wall Sconce",         subcategory: "lighting", description: "Wall-mounted sconce with a decorative backplate, curved arm and a fabric or glass shade pointing upward" },
  { id: "lantern",              label: "Lantern",             subcategory: "lighting", description: "Classic lantern with a metal frame, glass panels, a candle or flickering bulb inside and a carrying ring on top" },
  { id: "candelabra",           label: "Candelabra",          subcategory: "lighting", description: "Ornate silver candelabra with multiple curved branching arms each holding a tall taper candle" },
  { id: "neon-sign",            label: "Neon Sign",           subcategory: "lighting", description: "Glowing neon sign with bent glass tubes shaped into cursive lettering or a retro icon, casting colored light on the wall" },

  // -------------------- Kitchen & Dining --------------------
  { id: "kitchen-island",       label: "Kitchen Island",      subcategory: "kitchen-dining", description: "Freestanding kitchen island with a thick butcher-block top, cabinet storage below, bar stool overhang and a rack above" },
  { id: "bar-counter",          label: "Bar Counter",         subcategory: "kitchen-dining", description: "Home bar counter with a polished wooden top, brass footrail, backlit glass shelving and rows of bottles displayed behind" },
  { id: "bar-stool",            label: "Bar Stool",           subcategory: "kitchen-dining", description: "Tall bar stool with a round swiveling seat, footrest ring, metal frame and an optional low backrest" },
  { id: "pot-rack",             label: "Pot Rack",            subcategory: "kitchen-dining", description: "Overhead hanging pot rack with a wrought-iron frame, S-hooks dangling pots and pans and shelving for spices on top" },
  { id: "spice-rack",           label: "Spice Rack",          subcategory: "kitchen-dining", description: "Wall-mounted spice rack with rows of small labeled glass jars, wooden shelves and a cheerful cluttered charm" },
  { id: "buffet",               label: "Buffet",              subcategory: "kitchen-dining", description: "Long dining-room buffet with a flat top for serving platters, drawers for linens and cabinet doors for dishware below" },

  // -------------------- Outdoor --------------------
  { id: "patio-chair",          label: "Patio Chair",         subcategory: "outdoor", description: "Outdoor patio chair with a weather-resistant woven wicker seat, aluminum frame and a weatherproof cushion" },
  { id: "adirondack-chair",     label: "Adirondack Chair",    subcategory: "outdoor", description: "Classic wooden Adirondack chair with a slanted slatted back, wide flat armrests and a seat that scoops gently back" },
  { id: "porch-swing",          label: "Porch Swing",         subcategory: "outdoor", description: "Wooden porch swing suspended on chains from the ceiling with a slatted seat and a row of colorful outdoor cushions" },
  { id: "gazebo",               label: "Gazebo",              subcategory: "outdoor", description: "Freestanding outdoor gazebo with a peaked shingled roof, six open wooden columns, railings and a raised wooden floor" },
  { id: "bistro-set",           label: "Bistro Set",          subcategory: "outdoor", description: "Compact outdoor bistro set with a round wrought-iron table and two matching chairs in a glossy weather-resistant finish" },
  { id: "sun-lounger",          label: "Sun Lounger",         subcategory: "outdoor", description: "Poolside sun lounger with an adjustable reclining back, white vinyl straps and a matching side table" },
  { id: "fire-pit",             label: "Fire Pit",            subcategory: "outdoor", description: "Round outdoor fire pit bowl with a rough-iron exterior, flickering flames and glowing embers beneath a protective mesh screen" },

  // -------------------- Decorative --------------------
  { id: "mirror",               label: "Mirror",              subcategory: "decorative", description: "Large wall mirror with an ornate gilded frame, carved scrollwork and slightly aged silvering in the glass" },
  { id: "rug",                  label: "Rug",                 subcategory: "decorative", description: "Large patterned area rug with intricate woven motifs, tasseled ends and a soft plush pile" },
  { id: "vase",                 label: "Vase",                subcategory: "decorative", description: "Tall ceramic vase with a rounded body, narrow neck, glazed finish and a fresh bouquet of flowers arranged inside" },
  { id: "grandfather-clock",    label: "Grandfather Clock",   subcategory: "decorative", description: "Tall wooden grandfather clock with a glass pendulum door, brass clock face, roman numerals and a chime mechanism" },
  { id: "wall-art",             label: "Framed Wall Art",     subcategory: "decorative", description: "Large framed artwork in a gilded or minimalist frame with a gallery-style matte border and a single focal painting" },
  { id: "pillow",               label: "Throw Pillow",        subcategory: "decorative", description: "Decorative throw pillow with a patterned cover, piped edges, plush fill and an invisible zipper closure" },
  { id: "curtains",             label: "Curtains",            subcategory: "decorative", description: "Full-length curtains with thick draping fabric, pleated tops hanging from a metal rod and tie-backs on each side" },
  { id: "sculpture",            label: "Sculpture",           subcategory: "decorative", description: "Abstract sculpture on a pedestal with flowing organic forms in bronze or marble catching the light from multiple angles" },

  // -------------------- Bath --------------------
  { id: "bathtub",              label: "Bathtub",             subcategory: "bath", description: "Freestanding clawfoot bathtub with rolled rim, polished white enamel interior and four ornate cast-iron feet" },
  { id: "shower",               label: "Walk-In Shower",      subcategory: "bath", description: "Walk-in shower with frameless glass panels, tiled walls, a rainfall showerhead and a linear floor drain" },
  { id: "toilet",               label: "Toilet",              subcategory: "bath", description: "Standard white ceramic toilet with an oval bowl, elongated seat and a tank with a chrome flush handle" },
  { id: "sink-vanity",          label: "Sink Vanity",         subcategory: "bath", description: "Bathroom sink vanity with a stone countertop, undermount basin, wide mirror above and paneled cabinet doors below" },
  { id: "towel-rack",           label: "Towel Rack",          subcategory: "bath", description: "Wall-mounted heated towel rack with multiple horizontal bars and fluffy folded towels draped over each bar" },
] as const

const furnitureById = new Map<string, Furniture>(FURNITURE.map((f) => [f.id, f]))

export function getFurniture(id: string | undefined | null): Furniture | undefined {
  if (!id) return undefined
  return furnitureById.get(id)
}

export function getFurnitureLabel(id: string | undefined | null, fallback?: string): string {
  const f = getFurniture(id)
  if (f) return f.label
  if (fallback !== undefined) return fallback
  return (id ?? "").replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
}

export const FURNITURE_IDS: ReadonlyArray<string> = FURNITURE.map((f) => f.id)

export const FURNITURE_SUBCATEGORY_LABELS: Readonly<Record<FurnitureSubcategory, string>> = {
  seating: "Seating",
  tables: "Tables",
  beds: "Beds",
  storage: "Storage",
  lighting: "Lighting",
  "kitchen-dining": "Kitchen & Dining",
  outdoor: "Outdoor",
  decorative: "Decorative",
  bath: "Bath",
}

export const FURNITURE_SUBCATEGORY_ORDER: ReadonlyArray<FurnitureSubcategory> = [
  "seating",
  "tables",
  "beds",
  "storage",
  "lighting",
  "kitchen-dining",
  "outdoor",
  "decorative",
  "bath",
]
