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

/**
 * Single source of truth for the weights loaded per face, as the string
 * literals each `@remotion/google-fonts/<Face>` module's `weights` param
 * expects (e.g. Anton only accepts "400"). `FONT_LOADED_WEIGHTS` (the numeric
 * form consumed elsewhere, e.g. the brand-preset "weight is loaded" guard) is
 * derived from this below, so the two can never drift apart.
 */
const WEIGHT_STRINGS = {
  "Inter": ["300", "400", "700", "900"],
  "Roboto": ["300", "400", "700", "900"],
  "Open Sans": ["300", "400", "700", "800"],
  "Montserrat": ["300", "400", "700", "900"],
  "Poppins": ["300", "400", "700", "900"],
  "Raleway": ["300", "400", "700", "900"],
  "Nunito": ["300", "400", "700", "900"],
  "Lato": ["300", "400", "700", "900"],
  "Playfair Display": ["400", "700", "900"],
  "Merriweather": ["400", "700", "900"],
  "Lora": ["400", "700"],
  "EB Garamond": ["400", "700"],
  "Bebas Neue": ["400"],
  "Oswald": ["300", "400", "700"],
  "Anton": ["400"],
  "Dancing Script": ["400", "700"],
  "Pacifico": ["400"],
  "Caveat": ["400", "700"],
  "Roboto Mono": ["300", "400", "700"],
  "Fira Code": ["300", "400", "700"],
  "Rubik": ["300", "400", "700", "900"],
  "Heebo": ["300", "400", "700", "900"],
  "Cairo": ["300", "400", "700", "900"],
  "Tajawal": ["300", "400", "700", "900"],
} as const satisfies Record<SupportedFontName, readonly string[]>

/**
 * Numeric form of `WEIGHT_STRINGS`, for consumers that want CSS font-weight
 * numbers (e.g. the brand-preset "weight is loaded" guard test).
 */
export const FONT_LOADED_WEIGHTS: Record<SupportedFontName, readonly number[]> = {
  "Inter": WEIGHT_STRINGS.Inter.map(Number),
  "Roboto": WEIGHT_STRINGS.Roboto.map(Number),
  "Open Sans": WEIGHT_STRINGS["Open Sans"].map(Number),
  "Montserrat": WEIGHT_STRINGS.Montserrat.map(Number),
  "Poppins": WEIGHT_STRINGS.Poppins.map(Number),
  "Raleway": WEIGHT_STRINGS.Raleway.map(Number),
  "Nunito": WEIGHT_STRINGS.Nunito.map(Number),
  "Lato": WEIGHT_STRINGS.Lato.map(Number),
  "Playfair Display": WEIGHT_STRINGS["Playfair Display"].map(Number),
  "Merriweather": WEIGHT_STRINGS.Merriweather.map(Number),
  "Lora": WEIGHT_STRINGS.Lora.map(Number),
  "EB Garamond": WEIGHT_STRINGS["EB Garamond"].map(Number),
  "Bebas Neue": WEIGHT_STRINGS["Bebas Neue"].map(Number),
  "Oswald": WEIGHT_STRINGS.Oswald.map(Number),
  "Anton": WEIGHT_STRINGS.Anton.map(Number),
  "Dancing Script": WEIGHT_STRINGS["Dancing Script"].map(Number),
  "Pacifico": WEIGHT_STRINGS.Pacifico.map(Number),
  "Caveat": WEIGHT_STRINGS.Caveat.map(Number),
  "Roboto Mono": WEIGHT_STRINGS["Roboto Mono"].map(Number),
  "Fira Code": WEIGHT_STRINGS["Fira Code"].map(Number),
  "Rubik": WEIGHT_STRINGS.Rubik.map(Number),
  "Heebo": WEIGHT_STRINGS.Heebo.map(Number),
  "Cairo": WEIGHT_STRINGS.Cairo.map(Number),
  "Tajawal": WEIGHT_STRINGS.Tajawal.map(Number),
}

// Only load weights actually used in compositions and latin subset
// to avoid hundreds of unnecessary network requests per render.
// Each font specifies only the weights it supports from {300, 400, 700, 900}.
// The spread makes a fresh mutable array (loadFont's `weights` param is
// mutable) that keeps the narrowed literal element types from WEIGHT_STRINGS,
// which is what lets each face's own literal-string union typecheck with zero cast.
const fonts = {
  "Inter": loadInter("normal", { weights: [...WEIGHT_STRINGS.Inter], subsets: ["latin"] }),
  "Roboto": loadRoboto("normal", { weights: [...WEIGHT_STRINGS.Roboto], subsets: ["latin"] }),
  "Open Sans": loadOpenSans("normal", { weights: [...WEIGHT_STRINGS["Open Sans"]], subsets: ["latin"] }),
  "Montserrat": loadMontserrat("normal", { weights: [...WEIGHT_STRINGS.Montserrat], subsets: ["latin"] }),
  "Poppins": loadPoppins("normal", { weights: [...WEIGHT_STRINGS.Poppins], subsets: ["latin"] }),
  "Raleway": loadRaleway("normal", { weights: [...WEIGHT_STRINGS.Raleway], subsets: ["latin"] }),
  "Nunito": loadNunito("normal", { weights: [...WEIGHT_STRINGS.Nunito], subsets: ["latin"] }),
  "Lato": loadLato("normal", { weights: [...WEIGHT_STRINGS.Lato], subsets: ["latin"] }),
  "Playfair Display": loadPlayfairDisplay("normal", { weights: [...WEIGHT_STRINGS["Playfair Display"]], subsets: ["latin"] }),
  "Merriweather": loadMerriweather("normal", { weights: [...WEIGHT_STRINGS.Merriweather], subsets: ["latin"] }),
  "Lora": loadLora("normal", { weights: [...WEIGHT_STRINGS.Lora], subsets: ["latin"] }),
  "EB Garamond": loadEBGaramond("normal", { weights: [...WEIGHT_STRINGS["EB Garamond"]], subsets: ["latin"] }),
  "Bebas Neue": loadBebasNeue("normal", { weights: [...WEIGHT_STRINGS["Bebas Neue"]], subsets: ["latin"] }),
  "Oswald": loadOswald("normal", { weights: [...WEIGHT_STRINGS.Oswald], subsets: ["latin"] }),
  "Anton": loadAnton("normal", { weights: [...WEIGHT_STRINGS.Anton], subsets: ["latin"] }),
  "Dancing Script": loadDancingScript("normal", { weights: [...WEIGHT_STRINGS["Dancing Script"]], subsets: ["latin"] }),
  "Pacifico": loadPacifico("normal", { weights: [...WEIGHT_STRINGS.Pacifico], subsets: ["latin"] }),
  "Caveat": loadCaveat("normal", { weights: [...WEIGHT_STRINGS.Caveat], subsets: ["latin"] }),
  "Roboto Mono": loadRobotoMono("normal", { weights: [...WEIGHT_STRINGS["Roboto Mono"]], subsets: ["latin"] }),
  "Fira Code": loadFiraCode("normal", { weights: [...WEIGHT_STRINGS["Fira Code"]], subsets: ["latin"] }),
  "Rubik": loadRubik("normal", { weights: [...WEIGHT_STRINGS.Rubik], subsets: ["latin", "hebrew", "arabic"] }),
  "Heebo": loadHeebo("normal", { weights: [...WEIGHT_STRINGS.Heebo], subsets: ["latin", "hebrew"] }),
  "Cairo": loadCairo("normal", { weights: [...WEIGHT_STRINGS.Cairo], subsets: ["latin", "arabic"] }),
  "Tajawal": loadTajawal("normal", { weights: [...WEIGHT_STRINGS.Tajawal], subsets: ["latin", "arabic"] }),
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
