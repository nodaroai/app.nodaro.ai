// packages/remotion/src/lib/brand.ts
import type { BrandTokens, BrandPalette, BrandFonts, BrandLogo, BrandCasing, BrandTypeSpec } from "@nodaro/prompts"
import { FONT_MAP, withRtlFallback } from "./font-registry"
import { containsArabic } from "./text-direction"

/**
 * Render-time brand, resolved from a plan's optional brandTokens.
 * When brandTokens is absent, only `backgroundColor` is set and every
 * consumer's `?? <default>` fallback fires — the byte-identical invariant.
 */
export interface ResolvedBrand {
  backgroundColor: string
  palette?: BrandPalette
  fonts?: BrandFonts
  logo?: BrandLogo
}

export function resolveBrand(
  brandTokens: BrandTokens | undefined,
  backgroundColor: string,
): ResolvedBrand {
  if (!brandTokens) return { backgroundColor }
  return {
    backgroundColor: brandTokens.palette.bg ?? backgroundColor,
    palette: brandTokens.palette,
    fonts: brandTokens.fonts,
    logo: brandTokens.logo,
  }
}

/**
 * Resolve a font display name to its full RTL-aware CSS font-stack.
 * Shared primitive: looks the name up in FONT_MAP (falling back to `fallback`
 * when it isn't a registered face) and appends the RTL fallback faces.
 */
export function resolveFontStack(name: string, fallback: string): string {
  return withRtlFallback(FONT_MAP[name] ?? fallback)
}

/** The heading-font stack every blueprint uses; defaults to Montserrat (today's hardcode). */
export function blueprintFontFamily(brand: ResolvedBrand): string {
  return resolveFontStack(brand.fonts?.heading ?? "Montserrat", "Montserrat")
}

/**
 * The ONE definition of blueprint accent precedence: explicit param → brand
 * accent → the blueprint's own hardcoded default. Every blueprint calls this
 * so the rule can't drift and is tested once.
 */
export function resolveBlueprintAccent(
  paramAccent: string | undefined,
  brand: ResolvedBrand,
  fallback: string,
): string {
  return paramAccent ?? brand.palette?.accent ?? fallback
}

export interface ResolvedTypeStyle {
  fontFamily: string
  fontWeight: number
  textTransform?: "uppercase" | "lowercase"
  letterSpacing?: string
}

/** The blueprint-authored fallback for a role's type spec, applied when the brand has no override. */
type BlueprintTypeFallback = { weight: number; tracking?: string; casing?: BrandCasing }

function resolveType(
  fontFamily: string,
  spec: BrandTypeSpec | undefined,
  text: string,
  fallback: BlueprintTypeFallback,
): ResolvedTypeStyle {
  const out: ResolvedTypeStyle = { fontFamily, fontWeight: spec?.weight ?? fallback.weight }
  const casing = spec?.casing ?? fallback.casing
  if (casing === "uppercase" || casing === "lowercase") out.textTransform = casing
  if (!containsArabic(text)) {
    const ls = spec?.tracking != null ? `${spec.tracking}em` : fallback.tracking
    if (ls) out.letterSpacing = ls
  }
  return out
}

/** Script-aware heading type resolver: brand `headingType` overrides the blueprint's fallback,
 *  Arabic text suppresses letter-spacing (breaks cursive joining), casing:"none" forces no transform. */
export function resolveHeadingType(
  brand: ResolvedBrand,
  text: string,
  fallback: BlueprintTypeFallback,
): ResolvedTypeStyle {
  return resolveType(blueprintFontFamily(brand), brand.fonts?.headingType, text, fallback)
}

/** The body-font stack every blueprint uses; defaults to Montserrat (today's hardcode).
 *  Symmetric with `blueprintFontFamily` (heading). */
export function blueprintBodyFontFamily(brand: ResolvedBrand): string {
  return resolveFontStack(brand.fonts?.body ?? "Montserrat", "Montserrat")
}

/** Script-aware body type resolver — same precedence rules as resolveHeadingType, body font/role. */
export function resolveBodyType(
  brand: ResolvedBrand,
  text: string,
  fallback: BlueprintTypeFallback,
): ResolvedTypeStyle {
  return resolveType(blueprintBodyFontFamily(brand), brand.fonts?.bodyType, text, fallback)
}
