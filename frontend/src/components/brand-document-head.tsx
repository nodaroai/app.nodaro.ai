import { useEffect } from "react"
import { surfaceConfiguredBrandName, surfaceBrandDescription } from "@/lib/surface-selectors"

/**
 * Mirrors the deployment brand into <title> / <meta name="description"> (B1),
 * matching the pre-paint inline script in index.html field-for-field: the title
 * is overridden ONLY when a surface brand product name is actually configured,
 * and the meta description ONLY when brand.description is set. On a default
 * (non-surface) deployment both are left untouched, so the static
 * <title>Nodaro.ai</title> and meta stay byte-identical. This component is the
 * reactive setter and the tested source of truth; the inline script sets the
 * same values once before paint from the same runtime object. Headless —
 * mounted once at the app root beside <I18nHtmlDir/>.
 */
export function BrandDocumentHead(): null {
  // Raw configured brand — undefined on a default deployment. NOT the
  // defaulting surfaceBrandName(), which returns "Nodaro" even when no surface
  // brand is set and would flip the static <title> on every load. Kept in
  // lockstep with index.html's inline guard.
  const brandName = surfaceConfiguredBrandName()
  useEffect(() => {
    if (brandName) document.title = brandName
  }, [brandName])

  // Optional: a deployment may also override <meta name="description"> via
  // brand.description. Absent → the static index.html default is left intact.
  const description = surfaceBrandDescription()
  useEffect(() => {
    if (!description) return
    const el = document.querySelector('meta[name="description"]')
    if (el) el.setAttribute("content", description)
  }, [description])

  return null
}
