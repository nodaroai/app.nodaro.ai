import { hasAdmin } from "@/lib/edition"
import { WithheldTable } from "@/ee/components/admin/free-grants/withheld-table"
import { SharedMachinesCard } from "@/ee/components/admin/free-grants/shared-machines-card"

/**
 * Free-grant review. Two surfaces, each owning its own query:
 *  - the withheld list (who was refused, why, restore), and
 *  - the signup-signal clusters (who shares a machine, browser or network).
 */
export default function AdminFreeGrantsPage() {
  if (!hasAdmin()) return null

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold">Free Grants</h1>
        <p className="text-sm text-muted-foreground">
          Accounts whose free signup credits were withheld. Restore mints the grant.
        </p>
      </div>

      <WithheldTable />
      <SharedMachinesCard />
    </div>
  )
}
