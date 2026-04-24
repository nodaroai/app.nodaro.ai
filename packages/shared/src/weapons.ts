/**
 * Canonical catalog of weapon presets for the Object entity node.
 *
 * When the Object category is "weapon", users pick a specific weapon from
 * this catalog. The picker auto-fills the object's `objectName` and
 * `description` so the existing `buildObjectPrompt` pipeline just works —
 * no backend prompt changes needed.
 *
 * Organized by weapon family: swords, daggers, axes, polearms, bows,
 * blunt/impact, throwing, modern firearms, historical firearms, explosives
 * & siege, sci-fi, and fantasy.
 */

export type WeaponSubcategory =
  | "swords"
  | "daggers"
  | "axes"
  | "polearms"
  | "bows"
  | "blunt"
  | "throwing"
  | "firearms-modern"
  | "firearms-historical"
  | "explosives-siege"
  | "sci-fi"
  | "fantasy"

export interface Weapon {
  readonly id: string
  readonly label: string
  readonly subcategory: WeaponSubcategory
  readonly description: string
}

export const WEAPONS: ReadonlyArray<Weapon> = [
  // -------------------- Swords --------------------
  { id: "katana",               label: "Katana",              subcategory: "swords", description: "Japanese katana with a single-edged gently curved blade, wrapped rayskin handle, disc-shaped tsuba guard and a polished mirror finish" },
  { id: "longsword",            label: "Longsword",           subcategory: "swords", description: "Medieval double-edged longsword with a straight tapering blade, cross guard, leather-wrapped grip and a round pommel" },
  { id: "broadsword",           label: "Broadsword",          subcategory: "swords", description: "Heavy broadsword with a wide straight double-edged blade, basket hilt guard and a sturdy leather-wrapped grip" },
  { id: "rapier",               label: "Rapier",              subcategory: "swords", description: "Slim rapier with a long narrow thrusting blade, ornate swept-hilt basket guard and a spherical pommel" },
  { id: "saber",                label: "Saber",               subcategory: "swords", description: "Cavalry saber with a single-edged curved blade, brass knuckle-bow guard and a ribbed leather grip" },
  { id: "scimitar",             label: "Scimitar",            subcategory: "swords", description: "Curved scimitar with a wide single-edged blade, ornate crossguard and a rounded metal pommel" },
  { id: "claymore",             label: "Claymore",            subcategory: "swords", description: "Massive two-handed Scottish claymore with a long straight blade, forward-angled crossguard and a large leather-bound grip" },
  { id: "cutlass",              label: "Cutlass",             subcategory: "swords", description: "Pirate cutlass with a short curved single-edged blade, brass cup-shaped hand guard and a weathered wooden grip" },
  { id: "wakizashi",            label: "Wakizashi",           subcategory: "swords", description: "Short Japanese wakizashi companion blade with a gently curved edge, small tsuba and rayskin-wrapped handle" },
  { id: "falchion",             label: "Falchion",            subcategory: "swords", description: "Heavy single-edged falchion with a cleaver-like tapering blade, simple crossguard and a riveted leather grip" },

  // -------------------- Daggers & Knives --------------------
  { id: "dagger",               label: "Dagger",              subcategory: "daggers", description: "Classic double-edged dagger with a narrow pointed blade, crossguard and a wrapped leather grip" },
  { id: "bowie-knife",          label: "Bowie Knife",         subcategory: "daggers", description: "Large bowie knife with a clip-point blade, brass guard, stacked leather-washer handle and a crossguard" },
  { id: "kukri",                label: "Kukri",               subcategory: "daggers", description: "Nepalese kukri with a forward-curving broad blade, wooden handle and distinctive inwardly-angled recurve" },
  { id: "stiletto",             label: "Stiletto",            subcategory: "daggers", description: "Slim stiletto with a long needle-thin triangular blade, minimal crossguard and a tapered handle" },
  { id: "dirk",                 label: "Dirk",                subcategory: "daggers", description: "Scottish dirk with a long straight single-edged blade, interwoven Celtic-knot handle and an ornate pommel" },
  { id: "tanto",                label: "Tanto",               subcategory: "daggers", description: "Japanese tanto dagger with an angular chisel-point tip, small tsuba and wrapped rayskin handle" },
  { id: "switchblade",          label: "Switchblade",         subcategory: "daggers", description: "Pocket switchblade with a spring-loaded folding blade, pearl or resin side panels and a polished release button" },
  { id: "trench-knife",         label: "Trench Knife",        subcategory: "daggers", description: "Military trench knife with a slim double-edged blade and a brass knuckle-duster handguard wrapping the grip" },

  // -------------------- Axes --------------------
  { id: "battle-axe",           label: "Battle Axe",          subcategory: "axes", description: "Heavy two-handed battle axe with a wide curved cutting edge, bearded profile and a long wooden haft bound with iron bands" },
  { id: "tomahawk",             label: "Tomahawk",            subcategory: "axes", description: "Light throwing tomahawk with a small single-bit iron head, straight wooden haft and leather wrapping near the grip" },
  { id: "hatchet",              label: "Hatchet",             subcategory: "axes", description: "Compact hatchet with a short wooden handle, small single-bit steel head and a hammered finish" },
  { id: "halberd",              label: "Halberd",             subcategory: "axes", description: "Long-pole halberd combining an axe blade, a thrusting spear point and a rear hook atop a tall wooden shaft" },
  { id: "greataxe",             label: "Greataxe",            subcategory: "axes", description: "Massive greataxe with a huge double-sided crescent head, iron reinforcing bands and a long heavy haft requiring two hands" },
  { id: "bearded-axe",          label: "Bearded Axe",         subcategory: "axes", description: "Viking bearded axe with an elongated lower blade edge, narrow iron head and a tall wooden haft wrapped with leather" },

  // -------------------- Polearms --------------------
  { id: "spear",                label: "Spear",               subcategory: "polearms", description: "Simple spear with a leaf-shaped iron spearhead lashed to a tall straight wooden shaft and a small butt cap at the base" },
  { id: "lance",                label: "Lance",               subcategory: "polearms", description: "Jousting lance with a long wooden shaft, conical steel tip and a flared hand guard protecting the grip" },
  { id: "pike",                 label: "Pike",                subcategory: "polearms", description: "Very long pike with a small triangular spearhead mounted atop a towering wooden pole twice the height of a man" },
  { id: "glaive",               label: "Glaive",              subcategory: "polearms", description: "Glaive polearm with a long curved single-edged blade mounted on a wooden shaft, tapering to a small crossguard" },
  { id: "trident",              label: "Trident",             subcategory: "polearms", description: "Three-pronged trident with sharp barbed tines, a central shaft and a long wooden pole" },
  { id: "naginata",             label: "Naginata",            subcategory: "polearms", description: "Japanese naginata with a curved single-edged blade mounted on a long lacquered wooden pole with silk wrappings" },

  // -------------------- Bows & Crossbows --------------------
  { id: "longbow",              label: "Longbow",             subcategory: "bows", description: "Tall English longbow with a single piece of yew wood, waxed linen string and a leather-wrapped grip" },
  { id: "recurve-bow",          label: "Recurve Bow",         subcategory: "bows", description: "Traditional recurve bow with limbs that curve away from the archer, a leather-wrapped riser and a taut bowstring" },
  { id: "compound-bow",         label: "Compound Bow",        subcategory: "bows", description: "Modern compound bow with aluminum cams, pulley wheels at each tip, carbon-fiber arrow rest and a sighting pin array" },
  { id: "crossbow",             label: "Crossbow",            subcategory: "bows", description: "Medieval crossbow with a horizontal wooden stock, steel prod, taut string and a trigger mechanism under the rail" },
  { id: "short-bow",            label: "Short Bow",           subcategory: "bows", description: "Compact wooden short bow with a simple curved profile, a waxed string and a leather grip in the middle" },

  // -------------------- Blunt & Impact --------------------
  { id: "mace",                 label: "Mace",                subcategory: "blunt", description: "Medieval flanged mace with a heavy crowned head bearing protruding iron flanges atop a short iron shaft" },
  { id: "war-hammer",           label: "War Hammer",          subcategory: "blunt", description: "Long-handled war hammer with a heavy iron head featuring a flat striking face on one side and a curved spike on the other" },
  { id: "club",                 label: "Club",                subcategory: "blunt", description: "Simple wooden club with a thick knotted head, tapering shaft and a well-worn leather grip near the base" },
  { id: "morning-star",         label: "Morning Star",        subcategory: "blunt", description: "Morning star with a wooden shaft topped by a large iron ball bristling with tall spikes in every direction" },
  { id: "flail",                label: "Flail",               subcategory: "blunt", description: "Military flail with a spiked iron ball connected by a short chain to a wooden haft with an iron end cap" },
  { id: "nunchaku",             label: "Nunchaku",            subcategory: "blunt", description: "Martial-arts nunchaku with two polished wooden batons connected by a short length of braided cord or chain" },

  // -------------------- Throwing --------------------
  { id: "shuriken",             label: "Shuriken",            subcategory: "throwing", description: "Metal throwing star with multiple razor-sharp points radiating from a central hub and a blackened steel finish" },
  { id: "throwing-knife",       label: "Throwing Knife",      subcategory: "throwing", description: "Balanced throwing knife with a leaf-shaped double-edged blade, minimal handle and a polished steel finish" },
  { id: "boomerang",            label: "Boomerang",           subcategory: "throwing", description: "Curved wooden boomerang with an elbow bend, painted tribal patterns and a smooth aerodynamic profile" },
  { id: "javelin",              label: "Javelin",             subcategory: "throwing", description: "Lightweight throwing javelin with a slim steel tip, tapered wooden shaft and a leather grip wrap near the balance point" },
  { id: "bolas",                label: "Bolas",               subcategory: "throwing", description: "Three weighted stone or iron balls tied together by braided leather cords meeting at a central knot" },

  // -------------------- Modern Firearms --------------------
  { id: "pistol",               label: "Pistol",              subcategory: "firearms-modern", description: "Modern semi-automatic pistol with a matte black polymer frame, ribbed slide, trigger guard and a flush magazine base" },
  { id: "revolver",             label: "Revolver",            subcategory: "firearms-modern", description: "Six-shooter revolver with a rotating cylinder, long barrel, hammer cocked back and a checkered wooden grip" },
  { id: "assault-rifle",        label: "Assault Rifle",       subcategory: "firearms-modern", description: "Military assault rifle with a long barrel, collapsible stock, optical sight on the rail and a curved detachable magazine" },
  { id: "shotgun",              label: "Shotgun",             subcategory: "firearms-modern", description: "Pump-action shotgun with a wide bore barrel, tactical fore-end, tube magazine underneath and a wooden or synthetic stock" },
  { id: "smg",                  label: "Submachine Gun",      subcategory: "firearms-modern", description: "Compact submachine gun with a short barrel, side-mounted magazine, folding wire stock and an integral foregrip" },
  { id: "sniper-rifle",         label: "Sniper Rifle",        subcategory: "firearms-modern", description: "Bolt-action sniper rifle with a long barrel, high-magnification scope, bipod legs and an ergonomic polymer stock" },
  { id: "machine-gun",          label: "Machine Gun",         subcategory: "firearms-modern", description: "Heavy belt-fed machine gun with a long finned barrel, bipod, carry handle and an ammunition belt feeding from the side" },

  // -------------------- Historical Firearms --------------------
  { id: "musket",               label: "Musket",              subcategory: "firearms-historical", description: "Long flintlock musket with a smooth-bore iron barrel, walnut stock, brass fittings and a bayonet fixed near the muzzle" },
  { id: "flintlock-pistol",     label: "Flintlock Pistol",    subcategory: "firearms-historical", description: "Ornate flintlock pistol with a curved wooden grip, engraved brass fittings, a flint hammer and a single long barrel" },
  { id: "blunderbuss",          label: "Blunderbuss",         subcategory: "firearms-historical", description: "Short flintlock blunderbuss with a flared muzzle, brass fittings on a stout wooden stock and a pirate-era presence" },
  { id: "dueling-pistol",       label: "Dueling Pistol",      subcategory: "firearms-historical", description: "Elegant dueling pistol with a slim octagonal barrel, finely engraved lockwork and a polished walnut grip" },

  // -------------------- Explosives & Siege --------------------
  { id: "grenade",              label: "Grenade",             subcategory: "explosives-siege", description: "Pineapple-textured iron fragmentation grenade with a spoon lever held in place by a pulled safety pin" },
  { id: "stick-grenade",        label: "Stick Grenade",       subcategory: "explosives-siege", description: "Cylindrical stick grenade with an iron warhead mounted atop a long wooden handle and a pull-string fuse at the base" },
  { id: "dynamite",             label: "Dynamite",            subcategory: "explosives-siege", description: "Bundled sticks of red dynamite wrapped with twine and joined to a long sputtering fuse with a burning tip" },
  { id: "bomb",                 label: "Cartoon Bomb",        subcategory: "explosives-siege", description: "Round black cartoon bomb with a smoking curled fuse coming out of the top and a shiny spherical iron shell" },
  { id: "rocket-launcher",      label: "Rocket Launcher",     subcategory: "explosives-siege", description: "Shoulder-fired rocket launcher with a long tube, forward grip, rear exhaust cone and optical targeting sight" },
  { id: "cannon",               label: "Cannon",              subcategory: "explosives-siege", description: "Cast-iron muzzle-loading cannon mounted on a wooden wheeled carriage with a long smooth-bore barrel and a smoking vent" },
  { id: "catapult",             label: "Catapult",            subcategory: "explosives-siege", description: "Wooden siege catapult with a long throwing arm cocked back, a counterweight or torsion bundle and a basket loaded with stone" },
  { id: "trebuchet",            label: "Trebuchet",           subcategory: "explosives-siege", description: "Tall medieval trebuchet with a massive counterweight, long throwing arm, braided sling and heavy timber frame" },

  // -------------------- Sci-Fi --------------------
  { id: "laser-pistol",         label: "Laser Pistol",        subcategory: "sci-fi", description: "Compact sci-fi laser pistol with glowing neon energy coils, a ridged metal body and a short emitter barrel" },
  { id: "plasma-rifle",         label: "Plasma Rifle",        subcategory: "sci-fi", description: "Futuristic plasma rifle with glowing blue energy cells, ventilated barrel shrouds and a holographic sight" },
  { id: "lightsaber",           label: "Lightsaber",          subcategory: "sci-fi", description: "Laser sword with a metallic ribbed handle emitting a tall glowing blade of saturated energy with a hazy plasma halo" },
  { id: "blaster",              label: "Blaster",             subcategory: "sci-fi", description: "Retro-futuristic blaster pistol with a chunky body, glowing energy chamber, cooling vents and a scope mounted on top" },
  { id: "phaser",               label: "Phaser",              subcategory: "sci-fi", description: "Sleek sci-fi phaser with a minimalist curved grip, glowing emitter tip and a smooth panel controlling intensity" },
  { id: "rail-gun",             label: "Rail Gun",            subcategory: "sci-fi", description: "Heavy electromagnetic rail gun with parallel metal rails, massive capacitors along the body and a glowing projectile chamber" },
  { id: "emp-grenade",          label: "EMP Grenade",         subcategory: "sci-fi", description: "Spherical electromagnetic pulse grenade with exposed coils, glowing blue indicator lights and a holographic arming dial" },

  // -------------------- Fantasy / Magical --------------------
  { id: "enchanted-sword",      label: "Enchanted Sword",     subcategory: "fantasy", description: "Enchanted sword with a glowing rune-etched blade, gold-inlaid crossguard and a gemstone embedded in the pommel" },
  { id: "magic-staff",          label: "Magic Staff",         subcategory: "fantasy", description: "Tall gnarled wizard's staff with a twisted wooden shaft ending in a crown of branches holding a glowing crystal" },
  { id: "runed-dagger",         label: "Runed Dagger",        subcategory: "fantasy", description: "Mystical dagger with a blade inscribed in glowing runes, a bone handle and dark energy swirling along the edge" },
  { id: "wizard-wand",          label: "Wizard Wand",         subcategory: "fantasy", description: "Slender wooden wand with knurled swirls, a leather grip and tiny sparks of magic leaking from the pointed tip" },
  { id: "war-horn",             label: "War Horn",            subcategory: "fantasy", description: "Massive curved war horn bound in leather and silver bands with a mouthpiece at one end and a flared bellowing opening at the other" },
  { id: "sorcerer-orb",         label: "Sorcerer's Orb",      subcategory: "fantasy", description: "Crystal sorcerer's orb held in a twisted silver claw-stand with swirling arcane mist suspended inside the glass sphere" },
] as const

const weaponById = new Map<string, Weapon>(WEAPONS.map((w) => [w.id, w]))

export function getWeapon(id: string | undefined | null): Weapon | undefined {
  if (!id) return undefined
  return weaponById.get(id)
}

export function getWeaponLabel(id: string | undefined | null, fallback?: string): string {
  const w = getWeapon(id)
  if (w) return w.label
  if (fallback !== undefined) return fallback
  return (id ?? "").replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
}

export const WEAPON_IDS: ReadonlyArray<string> = WEAPONS.map((w) => w.id)

export const WEAPON_SUBCATEGORY_LABELS: Readonly<Record<WeaponSubcategory, string>> = {
  swords: "Swords",
  daggers: "Daggers & Knives",
  axes: "Axes",
  polearms: "Polearms",
  bows: "Bows & Crossbows",
  blunt: "Blunt & Impact",
  throwing: "Throwing",
  "firearms-modern": "Firearms (Modern)",
  "firearms-historical": "Firearms (Historical)",
  "explosives-siege": "Explosives & Siege",
  "sci-fi": "Sci-Fi",
  fantasy: "Fantasy",
}

export const WEAPON_SUBCATEGORY_ORDER: ReadonlyArray<WeaponSubcategory> = [
  "swords",
  "daggers",
  "axes",
  "polearms",
  "bows",
  "blunt",
  "throwing",
  "firearms-modern",
  "firearms-historical",
  "explosives-siege",
  "sci-fi",
  "fantasy",
]
