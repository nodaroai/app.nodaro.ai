import { getWeapon, type WeaponSubcategory } from "@nodaro/shared"

const WEAPON_EMOJI: Record<string, string> = {
  // swords
  katana: "⚔️", longsword: "⚔️", broadsword: "⚔️", rapier: "🤺",
  saber: "⚔️", scimitar: "⚔️", claymore: "⚔️", cutlass: "🏴‍☠️",
  wakizashi: "⚔️", falchion: "⚔️",
  // daggers
  dagger: "🗡️", "bowie-knife": "🔪", kukri: "🗡️", stiletto: "🗡️",
  dirk: "🗡️", tanto: "🗡️", switchblade: "🔪", "trench-knife": "🗡️",
  // axes
  "battle-axe": "🪓", tomahawk: "🪓", hatchet: "🪓", halberd: "🪓",
  greataxe: "🪓", "bearded-axe": "🪓",
  // polearms
  spear: "🔱", lance: "🔱", pike: "🔱", glaive: "🔱", trident: "🔱", naginata: "🔱",
  // bows
  longbow: "🏹", "recurve-bow": "🏹", "compound-bow": "🏹",
  crossbow: "🏹", "short-bow": "🏹",
  // blunt
  mace: "🔨", "war-hammer": "🔨", club: "🏏", "morning-star": "🔨",
  flail: "⛓️", nunchaku: "🥋",
  // throwing
  shuriken: "⭐", "throwing-knife": "🗡️", boomerang: "🪃",
  javelin: "🔱", bolas: "⚪",
  // modern firearms
  pistol: "🔫", revolver: "🔫", "assault-rifle": "🔫", shotgun: "🔫",
  smg: "🔫", "sniper-rifle": "🔫", "machine-gun": "🔫",
  // historical firearms
  musket: "🔫", "flintlock-pistol": "🔫", blunderbuss: "🔫", "dueling-pistol": "🔫",
  // explosives & siege
  grenade: "💣", "stick-grenade": "💣", dynamite: "🧨", bomb: "💣",
  "rocket-launcher": "🚀", cannon: "💥", catapult: "🏰", trebuchet: "🏰",
  // sci-fi
  "laser-pistol": "🔫", "plasma-rifle": "🔫", lightsaber: "⚔️",
  blaster: "🔫", phaser: "🔫", "rail-gun": "🔫", "emp-grenade": "💣",
  // fantasy
  "enchanted-sword": "⚔️", "magic-staff": "🪄", "runed-dagger": "🗡️",
  "wizard-wand": "🪄", "war-horn": "📯", "sorcerer-orb": "🔮",
}

const SUBCATEGORY_FALLBACK_EMOJI: Record<WeaponSubcategory, string> = {
  swords: "⚔️",
  daggers: "🗡️",
  axes: "🪓",
  polearms: "🔱",
  bows: "🏹",
  blunt: "🔨",
  throwing: "🎯",
  "firearms-modern": "🔫",
  "firearms-historical": "🔫",
  "explosives-siege": "💣",
  "sci-fi": "🔫",
  fantasy: "🪄",
}

export function WEAPON_ICON_FOR(id: string): string {
  if (WEAPON_EMOJI[id]) return WEAPON_EMOJI[id]
  const w = getWeapon(id)
  return w ? SUBCATEGORY_FALLBACK_EMOJI[w.subcategory] ?? "⚔️" : "⚔️"
}
