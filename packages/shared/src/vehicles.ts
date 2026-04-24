/**
 * Canonical catalog of vehicle presets for the Object entity node.
 *
 * When the Object category is "vehicle", users pick a specific vehicle from
 * this catalog. The picker auto-fills the object's `objectName` and
 * `description` so the existing `buildObjectPrompt` pipeline just works — no
 * backend prompt changes needed.
 *
 * Organized into everyday sub-categories: classic cars, everyday cars,
 * performance cars, motorcycles, bicycles (human-powered), trucks, transit
 * (buses + rail + horse-drawn), aircraft, watercraft, military, construction,
 * and sci-fi.
 */

export type VehicleSubcategory =
  | "cars-classic"
  | "cars-everyday"
  | "cars-performance"
  | "motorcycles"
  | "bicycles"
  | "trucks"
  | "transit"
  | "aircraft"
  | "watercraft"
  | "military"
  | "construction"
  | "sci-fi"

export interface Vehicle {
  readonly id: string
  readonly label: string
  readonly subcategory: VehicleSubcategory
  readonly description: string
}

export const VEHICLES: ReadonlyArray<Vehicle> = [
  // -------------------- Classic Cars --------------------
  { id: "muscle-car",            label: "Muscle Car",            subcategory: "cars-classic", description: "Aggressive American muscle car with a long hood, wide stance, dual chrome exhausts and a deep throaty V8 presence" },
  { id: "car-57-chevy",          label: "'57 Chevy",             subcategory: "cars-classic", description: "Iconic 1957 Chevrolet Bel Air with tail fins, chrome bumpers, two-tone paint and whitewall tires" },
  { id: "hot-rod",               label: "Hot Rod",               subcategory: "cars-classic", description: "Chopped and channeled hot rod with flame paint job, exposed chrome engine, fat rear tires and skinny fronts" },
  { id: "vintage-roadster",      label: "Vintage Roadster",      subcategory: "cars-classic", description: "Pre-war open-top roadster with sweeping fenders, running boards, wire-spoke wheels and a long polished hood" },
  { id: "model-t",               label: "Ford Model T",          subcategory: "cars-classic", description: "Early 20th-century black Model T with boxy upright body, brass headlamps, spoked wheels and a cranked engine" },
  { id: "vw-beetle",             label: "VW Beetle",             subcategory: "cars-classic", description: "Rounded pastel-colored Volkswagen Beetle with a curved hood, air-cooled rear engine and cheerful bug-like face" },
  { id: "checker-cab",           label: "Checker Cab",           subcategory: "cars-classic", description: "Classic yellow New York checker taxi with a boxy body, black-and-white checker band and roof light" },
  { id: "woody-wagon",           label: "Woody Wagon",           subcategory: "cars-classic", description: "Surf-era station wagon with wood-paneled side doors, chrome bumpers and a long tailgate" },
  { id: "lowrider",              label: "Lowrider",              subcategory: "cars-classic", description: "Candy-painted lowrider with hydraulic suspension, chrome spoke wheels, whitewall tires and airbrushed murals" },

  // -------------------- Everyday Cars --------------------
  { id: "sedan",                 label: "Sedan",                 subcategory: "cars-everyday", description: "Four-door midsize sedan with a streamlined silhouette, chrome accents and modern LED headlights" },
  { id: "suv",                   label: "SUV",                   subcategory: "cars-everyday", description: "Large sport utility vehicle with a tall stance, roof rails, big alloy wheels and a muscular squared-off body" },
  { id: "hatchback",             label: "Hatchback",             subcategory: "cars-everyday", description: "Compact hatchback with a short rear, lift-up tailgate, nimble proportions and bright paint" },
  { id: "minivan",               label: "Minivan",               subcategory: "cars-everyday", description: "Family minivan with sliding side doors, a tall spacious cabin, tinted rear windows and a roomy rear hatch" },
  { id: "station-wagon",         label: "Station Wagon",         subcategory: "cars-everyday", description: "Long-roof station wagon with extended cargo area, rear quarter windows and a family-oriented silhouette" },
  { id: "crossover",             label: "Crossover",             subcategory: "cars-everyday", description: "Mid-sized crossover SUV with a raised ride height, car-like styling and aerodynamic LED accents" },
  { id: "electric-car",          label: "Electric Car",          subcategory: "cars-everyday", description: "Sleek modern electric car with a smooth grille-less front, flush door handles and aerodynamic clean lines" },
  { id: "hatchback-econobox",    label: "Econobox",              subcategory: "cars-everyday", description: "Tiny affordable two-door city car with a stubby hood, small wheels and simple compact styling" },

  // -------------------- Performance / Exotic --------------------
  { id: "sports-car",            label: "Sports Car",            subcategory: "cars-performance", description: "Low-slung two-door sports car with a wide aggressive stance, aerodynamic bodywork and bright glossy paint" },
  { id: "supercar",              label: "Supercar",              subcategory: "cars-performance", description: "Exotic mid-engined supercar with scissor doors, an ultra-low hood, huge rear intakes and a carbon-fiber rear wing" },
  { id: "convertible",           label: "Convertible",           subcategory: "cars-performance", description: "Two-seat convertible with the soft top down, a long sculpted hood and wind streaming past low-cut doors" },
  { id: "grand-tourer",          label: "Grand Tourer",          subcategory: "cars-performance", description: "Elegant grand-touring coupe with a long flowing hood, four exhausts and luxurious proportions" },
  { id: "roadster",              label: "Roadster",              subcategory: "cars-performance", description: "Compact two-seat roadster with a wraparound windshield, soft top tucked away and classic top-down silhouette" },
  { id: "racing-car",            label: "Racing Car",            subcategory: "cars-performance", description: "Open-wheel formula racing car with slick tires, a large rear wing, halo cockpit and aerodynamic sidepods covered in sponsor logos" },
  { id: "rally-car",             label: "Rally Car",             subcategory: "cars-performance", description: "Dirt-splattered rally hatchback with knobby tires, huge mud flaps, roof-mounted lights and race liveries" },
  { id: "drift-car",             label: "Drift Car",             subcategory: "cars-performance", description: "Aggressive drift-tuned coupe with a wide body kit, oversized rear wing, neon underglow and tire smoke trailing behind" },

  // -------------------- Motorcycles --------------------
  { id: "sportbike",             label: "Sportbike",             subcategory: "motorcycles", description: "Aerodynamic sport motorcycle with a crouched riding stance, full fairings, sticky tires and bright race-style graphics" },
  { id: "cruiser",               label: "Cruiser",               subcategory: "motorcycles", description: "Low-slung cruiser motorcycle with a long teardrop tank, swept-back handlebars, chrome exhausts and fat rear tire" },
  { id: "chopper",               label: "Chopper",               subcategory: "motorcycles", description: "Stretched custom chopper with a raked-out front end, tall ape-hanger handlebars, skinny front wheel and chrome everywhere" },
  { id: "dirt-bike",             label: "Dirt Bike",             subcategory: "motorcycles", description: "Off-road dirt bike with knobby tires, tall suspension, plastic fairings in bright colors and high handlebars" },
  { id: "scooter",               label: "Scooter",               subcategory: "motorcycles", description: "Compact step-through scooter with a smooth body shell, small wheels, a flat footrest and an under-seat storage bump" },
  { id: "moped",                 label: "Moped",                 subcategory: "motorcycles", description: "Small pedal-start moped with a simple steel frame, basket up front and a tiny gas engine under the seat" },
  { id: "cafe-racer",            label: "Cafe Racer",            subcategory: "motorcycles", description: "Stripped-down cafe racer motorcycle with clip-on bars, a humped solo seat, exposed frame and minimalist tank" },

  // -------------------- Bicycles & Human-Powered --------------------
  { id: "road-bike",             label: "Road Bike",             subcategory: "bicycles", description: "Lightweight road bike with drop handlebars, skinny high-pressure tires and an aerodynamic carbon frame" },
  { id: "mountain-bike",         label: "Mountain Bike",         subcategory: "bicycles", description: "Rugged mountain bike with knobby tires, front suspension fork, flat handlebars and a mud-splattered frame" },
  { id: "bmx",                   label: "BMX Bike",              subcategory: "bicycles", description: "Stunt BMX bike with a small frame, pegs on the axles, chunky tires and a cross-brace handlebar" },
  { id: "cruiser-bike",          label: "Beach Cruiser",         subcategory: "bicycles", description: "Relaxed beach cruiser bicycle with a curved frame, swept-back handlebars, wide seat and balloon tires" },
  { id: "penny-farthing",        label: "Penny Farthing",        subcategory: "bicycles", description: "Victorian penny-farthing bicycle with an enormous front wheel, tiny rear wheel and a perched leather saddle high above" },
  { id: "unicycle",              label: "Unicycle",              subcategory: "bicycles", description: "Single-wheeled unicycle with a tall seat post, simple pedals on the hub and a minimalist circus look" },
  { id: "skateboard",            label: "Skateboard",            subcategory: "bicycles", description: "Wooden skateboard deck with grip tape on top, four polyurethane wheels and colorful graphic art on the underside" },
  { id: "kick-scooter",          label: "Kick Scooter",          subcategory: "bicycles", description: "Two-wheeled kick scooter with a tall T-handle, narrow deck and small hard wheels" },

  // -------------------- Trucks --------------------
  { id: "pickup-truck",          label: "Pickup Truck",          subcategory: "trucks", description: "Full-size pickup truck with a tall crew cab, open rear bed, chrome grille and aggressive off-road tires" },
  { id: "semi-truck",            label: "Semi Truck",            subcategory: "trucks", description: "Long-haul semi truck with a sleeper cab, tall chrome exhaust stacks and a massive articulated trailer behind" },
  { id: "dump-truck",            label: "Dump Truck",            subcategory: "trucks", description: "Heavy-duty dump truck with a raised tipping bed, massive off-road tires and yellow construction livery" },
  { id: "tow-truck",             label: "Tow Truck",             subcategory: "trucks", description: "Tow truck with a hydraulic boom, hook and flat recovery bed, rotating amber warning lights and bold signage" },
  { id: "delivery-van",          label: "Delivery Van",          subcategory: "trucks", description: "White delivery van with a boxy cargo hold, sliding side door, roof racks and corporate livery decals" },
  { id: "ice-cream-truck",       label: "Ice Cream Truck",       subcategory: "trucks", description: "Cheerful ice cream truck with pastel paint, a window counter displaying treats, colorful decals and a cone-shaped rooftop ornament" },
  { id: "food-truck",            label: "Food Truck",            subcategory: "trucks", description: "Stylized food truck with a folding service window, chalkboard menu, string lights and a bright custom wrap" },
  { id: "box-truck",             label: "Box Truck",             subcategory: "trucks", description: "Medium box truck with a plain rectangular cargo box, roll-up rear door and a forward cab" },

  // -------------------- Transit (Bus / Rail / Horse-Drawn) --------------------
  { id: "city-bus",              label: "City Bus",              subcategory: "transit", description: "Modern articulated city bus with a low floor, sliding doors, destination sign up front and an advertising wrap" },
  { id: "school-bus",            label: "School Bus",            subcategory: "transit", description: "Classic yellow American school bus with black trim, flashing red stop signs, stop-arm out and black stenciled numbers" },
  { id: "double-decker",         label: "Double-Decker Bus",     subcategory: "transit", description: "Iconic red double-decker bus with a rounded roof, open staircase inside and destination scroll up front" },
  { id: "coach-bus",             label: "Coach Bus",             subcategory: "transit", description: "Long-distance coach bus with tinted panoramic windows, luggage bays underneath and streamlined bodywork" },
  { id: "train",                 label: "Train",                 subcategory: "transit", description: "Modern passenger train with a sleek streamlined nose, panoramic windows and a line of gleaming cars" },
  { id: "steam-locomotive",      label: "Steam Locomotive",      subcategory: "transit", description: "Black steam locomotive with a tall smokestack puffing steam, a boiler, connecting rods and a coal tender behind" },
  { id: "bullet-train",          label: "Bullet Train",          subcategory: "transit", description: "High-speed bullet train with an aerodynamic pointed nose, smooth white-and-blue livery and narrow windows" },
  { id: "subway",                label: "Subway Train",          subcategory: "transit", description: "Stainless-steel subway car with graffiti-resistant panels, sliding doors and rows of fluorescent lights inside" },
  { id: "tram",                  label: "Tram",                  subcategory: "transit", description: "Classic city tram car with a boxy wooden-framed body, overhead pantograph and rails running beneath" },
  { id: "stagecoach",            label: "Stagecoach",            subcategory: "transit", description: "Wild-west stagecoach with a wooden body, leaf-spring suspension, roof luggage rack and a team of horses harnessed in front" },
  { id: "horse-carriage",        label: "Horse-Drawn Carriage",  subcategory: "transit", description: "Ornate horse-drawn carriage with polished wood panels, large spoked wheels and a velvet-upholstered cabin" },

  // -------------------- Aircraft --------------------
  { id: "airliner",              label: "Airliner",              subcategory: "aircraft", description: "Wide-body commercial airliner with twin jet engines under swept wings, rows of oval windows and a tall swept tail fin" },
  { id: "biplane",               label: "Biplane",               subcategory: "aircraft", description: "Vintage biplane with two stacked wings connected by struts and wire bracing, an open cockpit and a wooden propeller" },
  { id: "propeller-plane",       label: "Propeller Plane",       subcategory: "aircraft", description: "Small single-engine propeller plane with a spinning nose prop, high wings, fixed landing gear and a bubble cockpit" },
  { id: "helicopter",            label: "Helicopter",            subcategory: "aircraft", description: "Utility helicopter with a large main rotor on top, a slim tail boom, skids underneath and a bubble-front cockpit" },
  { id: "seaplane",              label: "Seaplane",              subcategory: "aircraft", description: "Seaplane with twin pontoon floats instead of wheels, high wings and a propeller, resting on calm water" },
  { id: "hot-air-balloon",       label: "Hot Air Balloon",       subcategory: "aircraft", description: "Giant hot-air balloon with a colorful striped envelope, a flame burner flaring upward and a wicker basket underneath" },
  { id: "blimp",                 label: "Blimp",                 subcategory: "aircraft", description: "Sausage-shaped blimp airship with a sleek silver envelope, small rear fins and a slung gondola beneath" },
  { id: "glider",                label: "Glider",                subcategory: "aircraft", description: "Elegant sailplane glider with ultra-long narrow wings, no engine and a teardrop cockpit pod" },
  { id: "drone",                 label: "Drone",                 subcategory: "aircraft", description: "Quadcopter camera drone with four spinning rotors on slim arms, a central body and a gimbaled camera underneath" },

  // -------------------- Watercraft --------------------
  { id: "yacht",                 label: "Yacht",                 subcategory: "watercraft", description: "Sleek luxury motor yacht with multiple decks, tinted windows, a radar mast and glossy white hull cutting through blue water" },
  { id: "sailboat",              label: "Sailboat",              subcategory: "watercraft", description: "Graceful sailboat with a tall mast, taut white sails catching the wind and a narrow fiberglass hull" },
  { id: "speedboat",             label: "Speedboat",             subcategory: "watercraft", description: "Fast powerboat with a pointed deep-V hull, low windshield and a roaring outboard motor kicking up a wake" },
  { id: "cruise-ship",           label: "Cruise Ship",           subcategory: "watercraft", description: "Massive cruise ship with multiple towering decks, rows of balconies, bright funnels and a pointed bow" },
  { id: "cargo-ship",            label: "Cargo Ship",            subcategory: "watercraft", description: "Giant container cargo ship stacked high with rainbow-colored shipping containers, a bridge tower at the stern" },
  { id: "canoe",                 label: "Canoe",                 subcategory: "watercraft", description: "Classic wooden canoe with a pointed bow and stern, a cedar-ribbed interior and a single paddle resting inside" },
  { id: "kayak",                 label: "Kayak",                 subcategory: "watercraft", description: "Slim plastic kayak with a low profile, enclosed cockpit opening and a double-bladed paddle" },
  { id: "rowboat",               label: "Rowboat",               subcategory: "watercraft", description: "Small wooden rowboat with flat-bottom planks, oarlocks on the gunwales and two wooden oars" },
  { id: "jet-ski",               label: "Jet Ski",               subcategory: "watercraft", description: "Stand-up personal watercraft with an aggressive fairing, handlebars, a single seat and a jet-propulsion nozzle" },
  { id: "submarine",             label: "Submarine",             subcategory: "watercraft", description: "Military submarine with a long cylindrical hull, a conning tower with periscopes and a bulbous bow diving through deep water" },
  { id: "pirate-ship",           label: "Pirate Ship",           subcategory: "watercraft", description: "Wooden pirate galleon with tall masts, square sails, a figurehead on the bow, cannons along the hull and a tattered black flag" },

  // -------------------- Military --------------------
  { id: "tank",                  label: "Tank",                  subcategory: "military", description: "Heavy battle tank with a long cannon barrel, rotating turret, thick sloped armor and wide continuous tracks" },
  { id: "humvee",                label: "Humvee",                subcategory: "military", description: "Military Humvee with a wide stance, armored angular bodywork, off-road tires and a roof-mounted turret" },
  { id: "armored-personnel-carrier", label: "Armored Personnel Carrier", subcategory: "military", description: "Tracked armored personnel carrier with a boxy hull, rear ramp and a small turret up top" },
  { id: "fighter-jet",           label: "Fighter Jet",           subcategory: "military", description: "Supersonic fighter jet with swept delta wings, a sharp pointed nose, twin tail fins and missiles on wing pylons" },
  { id: "stealth-bomber",        label: "Stealth Bomber",        subcategory: "military", description: "Flying-wing stealth bomber with a matte black triangular silhouette, no tail fins and faceted radar-absorbing surfaces" },
  { id: "destroyer",             label: "Destroyer",             subcategory: "military", description: "Sleek naval destroyer with a long grey hull, gun turrets, missile launchers and a radar-bristling superstructure" },
  { id: "aircraft-carrier",      label: "Aircraft Carrier",      subcategory: "military", description: "Massive aircraft carrier with a flat-top flight deck, island tower with radar arrays and fighter jets parked in rows" },

  // -------------------- Construction --------------------
  { id: "bulldozer",             label: "Bulldozer",             subcategory: "construction", description: "Yellow construction bulldozer with a huge push blade up front, heavy tracks and a tall exhaust stack" },
  { id: "excavator",             label: "Excavator",             subcategory: "construction", description: "Hydraulic excavator with an articulated arm, toothed bucket, rotating cab and heavy tracked base" },
  { id: "crane-truck",           label: "Crane Truck",           subcategory: "construction", description: "Mobile crane truck with a massive telescoping boom extended upward, stabilizer outriggers and a heavy counterweight" },
  { id: "cement-mixer",          label: "Cement Mixer",          subcategory: "construction", description: "Cement mixer truck with a large rotating drum, chute at the rear and a boxy cab" },
  { id: "forklift",              label: "Forklift",              subcategory: "construction", description: "Warehouse forklift with twin steel fork tines raised in front, a roll cage over the driver and a compact counterweight rear" },
  { id: "backhoe",               label: "Backhoe",               subcategory: "construction", description: "Backhoe loader with a front bucket for scooping and a rear articulated arm with a toothed digging bucket" },
  { id: "tractor",               label: "Tractor",               subcategory: "construction", description: "Farm tractor with large knobby rear tires, smaller front tires, a roof canopy and a towing hitch at the back" },

  // -------------------- Sci-Fi / Fantasy --------------------
  { id: "spaceship",             label: "Spaceship",             subcategory: "sci-fi", description: "Sleek interstellar spaceship with curved fuselage, glowing engine nozzles, antenna arrays and a command bridge window" },
  { id: "starfighter",           label: "Starfighter",           subcategory: "sci-fi", description: "Agile single-pilot starfighter with swept wings, laser cannons on the wingtips, a bubble cockpit and glowing thrusters" },
  { id: "hovercar",              label: "Hovercar",              subcategory: "sci-fi", description: "Futuristic hovercar floating above the ground with no wheels, glowing underside thrusters, seamless bodywork and a curved canopy" },
  { id: "mech",                  label: "Mech",                  subcategory: "sci-fi", description: "Giant bipedal mech robot with armored plating, hydraulic pistons, a cockpit in the torso and heavy weapons mounted on the arms" },
  { id: "flying-saucer",         label: "Flying Saucer",         subcategory: "sci-fi", description: "Classic UFO flying saucer with a metallic disc body, glowing porthole lights around the rim and a domed cockpit on top" },
  { id: "space-shuttle",         label: "Space Shuttle",         subcategory: "sci-fi", description: "Space shuttle orbiter with white delta wings, a black heat-shield underbelly and huge rocket nozzles at the rear" },
  { id: "rocket",                label: "Rocket",                subcategory: "sci-fi", description: "Tall cylindrical rocket with pointed nose cone, tail fins, booster stages and flames roaring from the engines on launch" },
  { id: "hoverboard",            label: "Hoverboard",            subcategory: "sci-fi", description: "Futuristic hoverboard floating inches above the ground with glowing underside jets and a sleek single-plank body" },
] as const

const vehicleById = new Map<string, Vehicle>(VEHICLES.map((v) => [v.id, v]))

export function getVehicle(id: string | undefined | null): Vehicle | undefined {
  if (!id) return undefined
  return vehicleById.get(id)
}

export function getVehicleLabel(id: string | undefined | null, fallback?: string): string {
  const v = getVehicle(id)
  if (v) return v.label
  if (fallback !== undefined) return fallback
  return (id ?? "").replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
}

export const VEHICLE_IDS: ReadonlyArray<string> = VEHICLES.map((v) => v.id)

export const VEHICLE_SUBCATEGORY_LABELS: Readonly<Record<VehicleSubcategory, string>> = {
  "cars-classic": "Classic Cars",
  "cars-everyday": "Everyday Cars",
  "cars-performance": "Performance Cars",
  motorcycles: "Motorcycles",
  bicycles: "Bicycles & Human-Powered",
  trucks: "Trucks",
  transit: "Bus / Rail / Carriage",
  aircraft: "Aircraft",
  watercraft: "Watercraft",
  military: "Military",
  construction: "Construction",
  "sci-fi": "Sci-Fi",
}

export const VEHICLE_SUBCATEGORY_ORDER: ReadonlyArray<VehicleSubcategory> = [
  "cars-classic",
  "cars-everyday",
  "cars-performance",
  "motorcycles",
  "bicycles",
  "trucks",
  "transit",
  "aircraft",
  "watercraft",
  "military",
  "construction",
  "sci-fi",
]
