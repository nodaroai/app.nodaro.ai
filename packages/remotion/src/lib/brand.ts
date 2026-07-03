// packages/remotion/src/lib/brand.ts
import type { BrandTokens, BrandPalette, BrandFonts, BrandLogo } from "@nodaro/shared"
import { FONT_MAP, withRtlFallback } from "./font-registry"

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
