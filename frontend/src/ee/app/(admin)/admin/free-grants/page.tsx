import { useState } from "react"
import { hasAdmin } from "@/lib/edition"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { GrantsTable } from "@/ee/components/admin/free-grants/grants-table"
import { SharedMachinesCard } from "@/ee/components/admin/free-grants/shared-machines-card"
import { GRANT_LIST_TABS, type GrantListState } from "@/ee/components/admin/free-grants/types"

/**
 * Free-grant review. Two surfaces, each owning its own query:
 *  - the accounts in one grant state — withheld (who was refused, why,
 *    restore), given (take back), taken back (restore exactly), and
 *  - the signup-signal clusters (who shares a machine, browser or network).
 */
export default function AdminFreeGrantsPage() {
  const [state, setState] = useState<GrantListState>("withheld")

  if (!hasAdmin()) return null

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold">Free Grants</h1>
        <p className="text-sm text-muted-foreground">
          Free signup credits: withheld by the abuse check, given, or taken back by an admin.
        </p>
      </div>

      <Tabs value={state} onValueChange={(value) => setState(value as GrantListState)} className="mb-4">
        <TabsList>
          {GRANT_LIST_TABS.map((t) => (
            <TabsTrigger key={t.value} value={t.value}>
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <GrantsTable key={state} state={state} />
      <SharedMachinesCard />
    </div>
  )
}
