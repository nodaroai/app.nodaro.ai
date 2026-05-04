import { getVehicle, type VehicleSubcategory } from "@nodaro/shared"

const VEHICLE_EMOJI: Record<string, string> = {
  // classic
  "muscle-car": "🏎️", "car-57-chevy": "🚗💎", "hot-rod": "🚗🔥", "vintage-roadster": "🚗🎩",
  "model-t": "🚗⚙️", "vw-beetle": "🪲🚗", "checker-cab": "🚕", "woody-wagon": "🚙🌴", lowrider: "🚗⬇️",
  // everyday
  sedan: "🚗", suv: "🚙", hatchback: "🚗📦", minivan: "🚐", "station-wagon": "🚙📦",
  crossover: "🚙🛣️", "electric-car": "🚗⚡", "hatchback-econobox": "🚗💰",
  // performance
  "sports-car": "🏎️🔥", supercar: "🏎️💎", convertible: "🚗☀️", "grand-tourer": "🏎️🛣️",
  roadster: "🚗💨", "racing-car": "🏁🏎️", "rally-car": "🏎️🌲", "drift-car": "🏎️💨",
  // motorcycles
  sportbike: "🏍️", cruiser: "🏍️🛣️", chopper: "🏍️🔥", "dirt-bike": "🏍️⛰️",
  scooter: "🛵", moped: "🛵💨", "cafe-racer": "🏍️☕",
  // bicycles
  "road-bike": "🚴", "mountain-bike": "🚵", bmx: "🚲", "cruiser-bike": "🚲🌴",
  "penny-farthing": "🚲🎩", unicycle: "🎪", skateboard: "🛹", "kick-scooter": "🛴",
  // trucks
  "pickup-truck": "🛻", "semi-truck": "🚛", "dump-truck": "🚚", "tow-truck": "🚛🪝",
  "delivery-van": "🚐📦", "ice-cream-truck": "🍦", "food-truck": "🌮", "box-truck": "🚚📦",
  // transit
  "city-bus": "🚌", "school-bus": "🚌🎒", "double-decker": "🚌🇬🇧", "coach-bus": "🚌🛣️",
  train: "🚆", "steam-locomotive": "🚂", "bullet-train": "🚄", subway: "🚇",
  tram: "🚋", stagecoach: "🐎🚪", "horse-carriage": "🐎🎩",
  // aircraft
  airliner: "✈️", biplane: "🛩️", "propeller-plane": "🛩️💨", helicopter: "🚁",
  seaplane: "🛩️🌊", "hot-air-balloon": "🎈", blimp: "🎈✈️", glider: "🛩️🪶", drone: "🚁🔋",
  // watercraft
  yacht: "🛥️", sailboat: "⛵", speedboat: "🚤", "cruise-ship": "🛳️",
  "cargo-ship": "🚢", canoe: "🛶", kayak: "🛶🌊", rowboat: "🛶🪵", "jet-ski": "🚤💨",
  submarine: "🚢🌊", "pirate-ship": "🏴‍☠️",
  // military
  tank: "🪖", humvee: "🚙🪖", "armored-personnel-carrier": "🪖🚛",
  "fighter-jet": "✈️🪖", "stealth-bomber": "✈️🌑", destroyer: "🚢🪖", "aircraft-carrier": "🚢✈️",
  // construction
  bulldozer: "🚜", excavator: "🚜⛏️", "crane-truck": "🏗️", "cement-mixer": "🚚🏗️",
  forklift: "🚜📦", backhoe: "🚜🪣", tractor: "🚜🌾",
  // sci-fi
  spaceship: "🚀", starfighter: "🚀⭐", hovercar: "🛸🚗", mech: "🤖",
  "flying-saucer": "🛸", "space-shuttle": "🚀🌌", rocket: "🚀🔥", hoverboard: "🛹✨",
}

const SUBCATEGORY_FALLBACK_EMOJI: Record<VehicleSubcategory, string> = {
  "cars-classic": "🚗",
  "cars-everyday": "🚗",
  "cars-performance": "🏎️",
  motorcycles: "🏍️",
  bicycles: "🚲",
  trucks: "🚚",
  transit: "🚌",
  aircraft: "✈️",
  watercraft: "⛵",
  military: "🪖",
  construction: "🚜",
  "sci-fi": "🚀",
}

export function VEHICLE_ICON_FOR(id: string): string {
  if (VEHICLE_EMOJI[id]) return VEHICLE_EMOJI[id]
  const v = getVehicle(id)
  return v ? SUBCATEGORY_FALLBACK_EMOJI[v.subcategory] ?? "🚗" : "🚗"
}
