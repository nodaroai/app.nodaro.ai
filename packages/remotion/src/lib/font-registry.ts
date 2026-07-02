import { SUPPORTED_FONT_NAMES, type SupportedFontName } from "@nodaro/shared"
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
import { loadFont as loadRubik } from "@remotion/google-fonts/Rubik"
import { loadFont as loadHeebo } from "@remotion/google-fonts/Heebo"
import { loadFont as loadCairo } from "@remotion/google-fonts/Cairo"
import { loadFont as loadTajawal } from "@remotion/google-fonts/Tajawal"

// Only load weights actually used in compositions and latin subset
// to avoid hundreds of unnecessary network requests per render.
// Each font specifies only the weights it supports from {300, 400, 700, 900}.
const fonts = {
  "Inter": loadInter("normal", { weights: ["300", "400", "700", "900"], subsets: ["latin"] }),
  "Roboto": loadRoboto("normal", { weights: ["300", "400", "700", "900"], subsets: ["latin"] }),
  "Open Sans": loadOpenSans("normal", { weights: ["300", "400", "700", "800"], subsets: ["latin"] }),
  "Montserrat": loadMontserrat("normal", { weights: ["300", "400", "700", "900"], subsets: ["latin"] }),
  "Poppins": loadPoppins("normal", { weights: ["300", "400", "700", "900"], subsets: ["latin"] }),
  "Raleway": loadRaleway("normal", { weights: ["300", "400", "700", "900"], subsets: ["latin"] }),
  "Nunito": loadNunito("normal", { weights: ["300", "400", "700", "900"], subsets: ["latin"] }),
  "Lato": loadLato("normal", { weights: ["300", "400", "700", "900"], subsets: ["latin"] }),
  "Playfair Display": loadPlayfairDisplay("normal", { weights: ["400", "700", "900"], subsets: ["latin"] }),
  "Merriweather": loadMerriweather("normal", { weights: ["400", "700", "900"], subsets: ["latin"] }),
  "Lora": loadLora("normal", { weights: ["400", "700"], subsets: ["latin"] }),
  "EB Garamond": loadEBGaramond("normal", { weights: ["400", "700"], subsets: ["latin"] }),
  "Bebas Neue": loadBebasNeue("normal", { weights: ["400"], subsets: ["latin"] }),
  "Oswald": loadOswald("normal", { weights: ["300", "400", "700"], subsets: ["latin"] }),
  "Anton": loadAnton("normal", { weights: ["400"], subsets: ["latin"] }),
  "Dancing Script": loadDancingScript("normal", { weights: ["400", "700"], subsets: ["latin"] }),
  "Pacifico": loadPacifico("normal", { weights: ["400"], subsets: ["latin"] }),
  "Caveat": loadCaveat("normal", { weights: ["400", "700"], subsets: ["latin"] }),
  "Roboto Mono": loadRobotoMono("normal", { weights: ["300", "400", "700"], subsets: ["latin"] }),
  "Fira Code": loadFiraCode("normal", { weights: ["300", "400", "700"], subsets: ["latin"] }),
  "Rubik": loadRubik("normal", { weights: ["300", "400", "700", "900"], subsets: ["latin", "hebrew", "arabic"] }),
  "Heebo": loadHeebo("normal", { weights: ["300", "400", "700", "900"], subsets: ["latin", "hebrew"] }),
  "Cairo": loadCairo("normal", { weights: ["300", "400", "700", "900"], subsets: ["latin", "arabic"] }),
  "Tajawal": loadTajawal("normal", { weights: ["300", "400", "700", "900"], subsets: ["latin", "arabic"] }),
} satisfies Record<SupportedFontName, { readonly fontFamily: string }>

/** Maps display name → CSS font-family value */
export const FONT_MAP: Record<string, string> = Object.fromEntries(
  Object.entries(fonts).map(([name, result]) => [name, result.fontFamily]),
)

/** Display names supported by the renderer (single source of truth in @nodaro/shared). */
export const SUPPORTED_FONTS: readonly string[] = SUPPORTED_FONT_NAMES

/** RTL fallback stack, derived from the loaded Rubik face (covers Latin+Hebrew+Arabic). */
export const RTL_FONT_FALLBACK: string = `${fonts["Rubik"].fontFamily}, sans-serif`

/** Append the RTL fallback so Hebrew/Arabic codepoints resolve on a controlled webfont. */
export function withRtlFallback(fontFamily: string): string {
  return `${fontFamily}, ${RTL_FONT_FALLBACK}`
}
