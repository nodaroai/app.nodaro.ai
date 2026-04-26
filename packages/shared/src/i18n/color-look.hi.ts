import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // Palette
  "warm": { label: "गर्म", description: "गर्म नारंगी/लाल tones" },
  "cool": { label: "ठंडा", description: "ठंडे नीले/teal tones" },
  "teal-orange": { label: "Teal & Orange", description: "Hollywood complementary grade" },
  "split-toning": { label: "Split Toning", description: "ठंडी shadows, गर्म highlights" },
  "selective-color": { label: "Selective Color", description: "एक accent color के साथ B&W" },
  "faded-matte": { label: "Faded Matte", description: "उठे हुए blacks, milky low-contrast" },
  "log-flat": { label: "Log Flat", description: "Pre-grade S-Log/V-Log neutral" },
  "desaturated": { label: "Desaturated", description: "कम saturation, मद्धम" },
  "monochrome-bw": { label: "Monochrome B&W", description: "शुद्ध श्वेत-श्याम" },
  "sepia": { label: "Sepia", description: "विंटेज भूरा tone" },
  "pastel": { label: "Pastel", description: "नरम, low-contrast pastels" },
  "high-contrast": { label: "High Contrast", description: "Punchy contrast, गहरे blacks" },
  "vibrant": { label: "Vibrant", description: "अत्यधिक संतृप्त रंग" },

  // Film emulation — keep stock names in Latin
  "kodak-portra": { description: "नरम skin tones, बारीक grain" },
  "kodak-ektar": { description: "संतृप्त, बारीक grain" },
  "kodak-vision3": { description: "Cinema motion picture stock" },
  "fuji-pro-400h": { description: "Pastel हरियाली और आसमान" },
  "cinestill-800t": { description: "लाल halation के साथ tungsten film" },
  "bleach-bypass": { label: "Bleach Bypass", description: "High contrast, desaturated" },
  "technicolor": { label: "Technicolor 3-strip", description: "जीवंत रेट्रो Technicolor" },
  "two-strip-technicolor": { label: "Two-Strip Technicolor", description: "1920-30 के दशक का लाल-नीला Technicolor" },
  "eastman-color": { description: "1950/60 के दशक का गर्म मद्धम stock" },
  "hand-tinted": { label: "Hand-Tinted", description: "हाथ से रंगे हुए रंग के साथ B&W" },
  "agfa-orwo": { label: "Agfa / ORWO", description: "पूर्वी यूरोपीय ठंडी हरियाली" },
  "day-for-night": { label: "Day-for-Night", description: "दिन की shooting को रात के रूप में grade किया" },
  "cross-processed": { label: "Cross-Processed", description: "xpro से रंग shift" },

  // Social-preset
  "instagram-warm": { label: "Instagram Warm", description: "Valencia-शैली का warm filter" },
  "tiktok-saturated": { label: "TikTok Saturated", description: "उज्ज्वल punchy social palette" },
  "youtube-vlog-flat": { label: "YouTube Vlog Flat", description: "स्वच्छ vlog flat grade" },
  "iphone-hdr": { label: "iPhone HDR", description: "Computational HDR look" },
  "y2k-saturated": { label: "Y2K Saturated", description: "2000 के दशक का early digital pop" },
  "mtv-90s-vhs": { label: "MTV 90s VHS", description: "Oversaturated 90 के दशक का VHS chroma" },
  "polaroid-faded": { label: "Polaroid Faded", description: "Magenta-tinted faded Polaroid" },
  "lifestyle-warm-magazine": { label: "Lifestyle Warm Magazine", description: "आधुनिक warm editorial grade" },
  "kodachrome-64": { description: "संतृप्त लाल और amber highlights, vintage NatGeo गर्माहट" },
  "ektachrome-100": { description: "ठंडे साफ़ नीले, slide-film स्पष्टता" },
  "kodak-tri-x-400": { description: "Pushed-grain B&W street photo, gritty 35mm" },
  "aerochrome": { description: "Surreal गुलाबी-magenta पत्ते, false-color landscape" },
  "fuji-instax": { description: "मुलायम pastel midtones, square-format instant film" },
  "cinestill-50d": { description: "Daylight cinema stock, नियंत्रित नीले, Wong Kar-wai feel" },
  "expired-film": { label: "Expired Film", description: "रंग shifts, overexposed magentas, light leaks" },
}

export default map
