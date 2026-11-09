import type { ReactNode } from "react"
import { useBillingSurface } from "@/hooks/use-billing-surface"
import { personalFreeCreditsShown } from "@/lib/surface-selectors"

/**
 * Renders its children only where this deployment may promise a person free
 * credits of their own (`personalFreeCreditsShown`), and nothing elsewhere.
 *
 * A component rather than a hook for the promise that sits on one path of a
 * page: the sign-in page's line, shown only when the page has no sign-up links
 * to show, and the pricing page's free-tier strip, past that page's edition
 * gate where no new hook may be added (rules of hooks). The billing surface is
 * read only where the promise is about to render.
 */
export function PersonalFreeCreditsOnly({ children }: { readonly children: ReactNode }) {
  const { surface } = useBillingSurface()
  return personalFreeCreditsShown(surface.deploymentPayer) ? <>{children}</> : null
}
