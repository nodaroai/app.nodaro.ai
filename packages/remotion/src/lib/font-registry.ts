import { loadFont as loadInter } from "@remotion/google-fonts/Inter"
import { loadFont as loadRoboto } from "@remotion/google-fonts/Roboto"
import { loadFont as loadOpenSans } from "@remotion/google-fonts/OpenSans"
import { loadFont as loadMontserrat } from "@remotion/google-fonts/Montserrat"
import { loadFont as loadPoppins } from "@remotion/google-fonts/Poppins"
import { loadFont as loadRaleway } from "@remotion/google-fonts/Raleway"
import { loadFont as loadNunito } from "@remotion/google-fonts/Nunito"
import { loadFont as loadLato } from "@remotion/google-fonts/Lato"
import { loadFont as loadPlayfairDisplay } from "@remotion/google-fonts/PlayfairDisplay"
import { loadFont as loadMerriweather } from "@remotion/google-fonts/Merriweather"
import { loadFont as loadLora } from "@remotion/google-fonts/Lora"
import { loadFont as loadEBGaramond } from "@remotion/google-fonts/EBGaramond"
import { loadFont as loadBebasNeue } from "@remotion/google-fonts/BebasNeue"
import { loadFont as loadOswald } from "@remotion/google-fonts/Oswald"
import { loadFont as loadAnton } from "@remotion/google-fonts/Anton"
import { loadFont as loadDancingScript } from "@remotion/google-fonts/DancingScript"
import { loadFont as loadPacifico } from "@remotion/google-fonts/Pacifico"
import { loadFont as loadCaveat } from "@remotion/google-fonts/Caveat"
import { loadFont as loadRobotoMono } from "@remotion/google-fonts/RobotoMono"
import { loadFont as loadFiraCode } from "@remotion/google-fonts/FiraCode"

const fonts = {
  "Inter": loadInter(),
  "Roboto": loadRoboto(),
  "Open Sans": loadOpenSans(),
  "Montserrat": loadMontserrat(),
  "Poppins": loadPoppins(),
  "Raleway": loadRaleway(),
  "Nunito": loadNunito(),
  "Lato": loadLato(),
  "Playfair Display": loadPlayfairDisplay(),
  "Merriweather": loadMerriweather(),
  "Lora": loadLora(),
  "EB Garamond": loadEBGaramond(),
  "Bebas Neue": loadBebasNeue(),
  "Oswald": loadOswald(),
  "Anton": loadAnton(),
  "Dancing Script": loadDancingScript(),
  "Pacifico": loadPacifico(),
  "Caveat": loadCaveat(),
  "Roboto Mono": loadRobotoMono(),
  "Fira Code": loadFiraCode(),
} as const

/** Maps display name → CSS font-family value */
export const FONT_MAP: Record<string, string> = Object.fromEntries(
  Object.entries(fonts).map(([name, result]) => [name, result.fontFamily]),
)

/** List of all supported font display names (for AI prompt) */
export const SUPPORTED_FONTS: string[] = Object.keys(FONT_MAP)
