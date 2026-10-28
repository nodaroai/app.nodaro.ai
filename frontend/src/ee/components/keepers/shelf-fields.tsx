import { KEEPER_CATALOG_CATEGORY_MAX, KEEPER_CATALOG_SORT_MAX } from "@nodaro/shared/entities"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { useT } from "@/lib/i18n"
import { formatNumber } from "@/lib/i18n/format"
import type { KeeperShelfForm } from "./use-keeper-shelf-state"

const CATEGORY_ID = "keeper-shelf-category"
const SORT_ID = "keeper-shelf-sort"

/** The three shelf fields: the switch, the heading and the order, each with its bound stated. */
export function ShelfFields({ form }: { form: KeeperShelfForm }) {
  const t = useT()
  const locked = form.loading || form.loadFailed

  return (
    <div className="space-y-4 py-2" aria-busy={form.loading}>
      <label className="flex items-center justify-between gap-3 text-sm cursor-pointer">
        <span>{t("keepers.onShelf")}</span>
        <Switch checked={form.onShelf} onCheckedChange={form.setOnShelf} disabled={locked} aria-label={t("keepers.onShelf")} />
      </label>

      <div className="space-y-1.5">
        <Label htmlFor={CATEGORY_ID}>{t("keepers.category")}</Label>
        <Input
          id={CATEGORY_ID}
          value={form.category}
          onChange={(e) => form.setCategory(e.target.value)}
          placeholder={t("common.optional")}
          maxLength={KEEPER_CATALOG_CATEGORY_MAX}
          aria-describedby={`${CATEGORY_ID}-hint`}
          disabled={locked}
        />
        <p id={`${CATEGORY_ID}-hint`} className="text-xs text-muted-foreground">
          {t("keepers.categoryHint", { max: formatNumber(KEEPER_CATALOG_CATEGORY_MAX) })}
        </p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={SORT_ID}>{t("keepers.sort")}</Label>
        <Input
          id={SORT_ID}
          type="number"
          inputMode="numeric"
          step={1}
          min={-KEEPER_CATALOG_SORT_MAX}
          max={KEEPER_CATALOG_SORT_MAX}
          value={form.sort}
          onChange={(e) => form.setSort(e.target.value)}
          aria-invalid={!form.sortValid}
          aria-describedby={`${SORT_ID}-hint`}
          disabled={locked}
          dir="ltr"
        />
        <p id={`${SORT_ID}-hint`} className={form.sortValid ? "text-xs text-muted-foreground" : "text-xs text-destructive"}>
          {t("keepers.sortHint", { max: formatNumber(KEEPER_CATALOG_SORT_MAX) })}
        </p>
      </div>
    </div>
  )
}
