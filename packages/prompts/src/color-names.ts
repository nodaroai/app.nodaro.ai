/**
 * Plain colour names for a hex value — what a saved colour palette reads as
 * in a prompt ("deep teal #0F4C5C"). A model follows a named colour more
 * reliably than a bare hex code, and the hex keeps the exact value.
 *
 * NEAREST NAME, NOT A CLASSIFIER: a fixed table of everyday colour names, each
 * with a representative value, and the one closest to the input in CIE Lab
 * (ΔE 1976 — Euclidean distance in Lab, which tracks perceived difference far
 * better than RGB). Deterministic, dependency-free, and a name is always one a
 * person would say. Ties go to the earlier row.
 */

/** Everyday colour names and a representative sRGB value for each. */
const NAMED: ReadonlyArray<readonly [name: string, hex: string]> = [
  // Neutrals
  ["black", "#000000"],
  ["charcoal", "#36454F"],
  ["dark gray", "#555555"],
  ["slate gray", "#708090"],
  ["gray", "#808080"],
  ["warm gray", "#9A9088"],
  ["silver", "#C0C0C0"],
  ["light gray", "#D3D3D3"],
  ["off-white", "#F2F0EB"],
  ["white", "#FFFFFF"],
  ["ivory", "#FFFFF0"],
  ["cream", "#FFFDD0"],
  ["eggshell", "#F0EAD6"],
  ["linen", "#FAF0E6"],
  ["champagne", "#F7E7CE"],
  ["wheat", "#F5DEB3"],
  // Earth tones and browns
  ["sand", "#C2B280"],
  ["tan", "#D2B48C"],
  ["khaki", "#C3B091"],
  ["taupe", "#8B8589"],
  ["camel", "#C19A6B"],
  ["caramel", "#C68E17"],
  ["brown", "#964B00"],
  ["chocolate", "#7B3F00"],
  ["coffee", "#6F4E37"],
  ["espresso", "#4E312D"],
  ["walnut", "#773F1A"],
  ["chestnut", "#954535"],
  ["mahogany", "#C04000"],
  ["rust", "#B7410E"],
  ["terracotta", "#E2725B"],
  ["copper", "#B87333"],
  ["bronze", "#CD7F32"],
  ["ochre", "#CC7722"],
  // Oranges
  ["burnt orange", "#CC5500"],
  ["orange", "#FFA500"],
  ["tangerine", "#F28500"],
  ["apricot", "#FBCEB1"],
  ["peach", "#FFCBA4"],
  ["coral", "#FF7F50"],
  ["salmon", "#FA8072"],
  // Reds
  ["red", "#FF0000"],
  ["scarlet", "#FF2400"],
  ["crimson", "#DC143C"],
  ["cherry red", "#D2042D"],
  ["brick red", "#CB4154"],
  ["burgundy", "#800020"],
  ["maroon", "#800000"],
  ["wine red", "#722F37"],
  ["oxblood", "#4A0000"],
  // Pinks
  ["raspberry", "#E30B5C"],
  ["rose", "#FF007F"],
  ["hot pink", "#FF69B4"],
  ["pink", "#FFC0CB"],
  ["blush pink", "#E8B4B8"],
  ["dusty rose", "#C08081"],
  ["mauve", "#B784A7"],
  // Purples
  ["magenta", "#FF00FF"],
  ["orchid", "#DA70D6"],
  ["plum", "#8E4585"],
  ["eggplant", "#614051"],
  ["dusty purple", "#6E5A7E"],
  ["lilac", "#C8A2C8"],
  ["lavender", "#B57EDC"],
  ["pale lavender", "#E6E6FA"],
  ["amethyst", "#9966CC"],
  ["violet", "#8F00FF"],
  ["purple", "#800080"],
  ["indigo", "#4B0082"],
  // Blues
  ["navy blue", "#000080"],
  ["midnight blue", "#191970"],
  ["prussian blue", "#003153"],
  ["dusky blue", "#4B5E7D"],
  ["royal blue", "#4169E1"],
  ["cobalt blue", "#0047AB"],
  ["blue", "#0000FF"],
  ["cornflower blue", "#6495ED"],
  ["denim blue", "#1560BD"],
  ["steel blue", "#4682B4"],
  ["slate blue", "#6A5ACD"],
  ["periwinkle", "#CCCCFF"],
  ["sky blue", "#87CEEB"],
  ["baby blue", "#89CFF0"],
  ["powder blue", "#B0E0E6"],
  ["ice blue", "#D6ECEF"],
  ["azure", "#007FFF"],
  ["cerulean", "#007BA7"],
  ["petrol blue", "#005F6A"],
  // Cyans and teals
  ["cyan", "#00FFFF"],
  ["turquoise", "#40E0D0"],
  ["aquamarine", "#7FFFD4"],
  ["teal", "#008080"],
  ["dark teal", "#014D4E"],
  ["dark slate gray", "#2F4F4F"],
  // Greens
  ["sea green", "#2E8B57"],
  ["emerald green", "#50C878"],
  ["jade green", "#00A86B"],
  ["mint green", "#98FF98"],
  ["seafoam green", "#93E9BE"],
  ["sage green", "#9CAF88"],
  ["olive green", "#708238"],
  ["olive", "#808000"],
  ["moss green", "#8A9A5B"],
  ["forest green", "#228B22"],
  ["hunter green", "#355E3B"],
  ["bottle green", "#006A4E"],
  ["dark green", "#013220"],
  ["green", "#008000"],
  ["kelly green", "#4CBB17"],
  ["lime green", "#32CD32"],
  ["chartreuse", "#7FFF00"],
  ["pistachio", "#93C572"],
  // Yellows and golds
  ["yellow", "#FFFF00"],
  ["lemon yellow", "#FFF44F"],
  ["pale yellow", "#FDFD96"],
  ["canary yellow", "#FFEF00"],
  ["mustard yellow", "#E1AD01"],
  ["gold", "#FFD700"],
  ["amber", "#FFBF00"],
  ["honey", "#F0A830"],
  ["saffron", "#F4C430"],
]

const HEX_RE = /^#[0-9a-f]{6}$/i

type Lab = readonly [l: number, a: number, b: number]

function channel(v: number): number {
  const c = v / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

function labPivot(t: number): number {
  return t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116
}

/** sRGB hex → CIE Lab (D65). Only called with a value that passed `HEX_RE`. */
function toLab(hex: string): Lab {
  const r = channel(parseInt(hex.slice(1, 3), 16))
  const g = channel(parseInt(hex.slice(3, 5), 16))
  const b = channel(parseInt(hex.slice(5, 7), 16))
  const x = labPivot((0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047)
  const y = labPivot(0.2126729 * r + 0.7151522 * g + 0.072175 * b)
  const z = labPivot((0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883)
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)]
}

let namedLab: ReadonlyArray<readonly [string, Lab]> | null = null

/**
 * The everyday name nearest to `hex` (`#RRGGBB`, any case), or `""` when the
 * value is not a `#RRGGBB` colour.
 */
export function nearestColorName(hex: string): string {
  if (!HEX_RE.test(hex)) return ""
  namedLab ??= NAMED.map(([name, value]) => [name, toLab(value)] as const)
  const [l, a, b] = toLab(hex)
  let best = ""
  let bestDistance = Infinity
  for (const [name, [nl, na, nb]] of namedLab) {
    const d = (l - nl) ** 2 + (a - na) ** 2 + (b - nb) ** 2
    if (d < bestDistance) {
      bestDistance = d
      best = name
    }
  }
  return best
}
