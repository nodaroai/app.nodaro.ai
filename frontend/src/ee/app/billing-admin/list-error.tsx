import { Button } from "@/components/ui/button"
import { useT } from "@/lib/i18n"

/**
 * What a FAILED list read looks like on the billing account's page.
 *
 * The page already refuses to manufacture an unavailable per-cell figure — a
 * null allowance is an em dash, never a 0, because 0 means "exhausted, this
 * person cannot generate" (units.ts). This is the same rule one level up: the
 * three lists on this page are three separate queries against three separate
 * routes, every one of them `retry: false`, and TanStack sets `isLoading` false
 * on error. Reading them as `data?.data ?? []` therefore renders a failed read
 * as "No users match this search." / "No purchases yet." / "No grants yet." —
 * definite factual claims about a deployment nobody has managed to read.
 *
 * The retry is load-bearing, not decoration: `retry: false` means the query
 * will not try again on its own, so without a button the payer's only recovery
 * is a full page reload.
 *
 * Deliberately NOT `billingAdmin.loadError`: that sentence ends "Nothing was
 * changed", which is the page-level promise about a WRITE, and is the wrong
 * thing to say about a read that simply did not arrive.
 *
 * RTL (R5): logical properties only; the `rtl:` variant is banned repo-wide.
 */
export function ListError({ retryTestId, onRetry }: { retryTestId: string; onRetry: () => void }) {
  const t = useT()
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <p className="text-sm text-muted-foreground">{t("billingAdmin.listError")}</p>
      <Button size="sm" variant="outline" data-testid={retryTestId} onClick={onRetry}>
        {t("billingAdmin.listRetry")}
      </Button>
    </div>
  )
}
