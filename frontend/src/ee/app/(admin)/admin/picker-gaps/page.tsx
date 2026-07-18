import { useState, useDeferredValue } from "react"
import { Loader2, CheckCircle, XCircle, PlusCircle, Download } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { hasAdmin } from "@/lib/edition"
import {
  useAdminPickerGaps,
  usePatchPickerGapMutation,
  fetchAdminPickerGapsPage,
  type PickerGap,
} from "@/ee/hooks/queries/use-admin-queries"
import { downloadMarkdown, exportDateStamp, exportPreamble, fetchAllRows, markdownTable } from "@/ee/lib/admin-export"

const LIMIT = 50
const isAdmin = hasAdmin()

/** LLM-handoff document: every filtered gap with the semantics spelled out, so
 *  the export can be pasted to a model with "draft the missing catalog entries". */
function gapsMarkdown(rows: PickerGap[], total: number, filters: Record<string, string>): string {
  return (
    exportPreamble({
      title: "Picker catalog gaps",
      description:
        "Each row is an attribute the image analyzer SAW but the picker catalogs could not express. `observed` is the LLM's description; `chosen` is the closest existing option id it settled for (empty for missing-category rows, where NO dimension covered the attribute); `count` is how often this gap recurred. Task for an LLM: for each row, propose the new picker item (or new dimension, for category rows) to add to the catalogs.",
      filters,
      rowCount: rows.length,
      total,
    }) +
    markdownTable(
      ["Picker", "Type", "Dimension", "Observed", "Chosen (closest)", "Count", "Status"],
      rows.map((g) => [g.picker_type, g.gap_type, g.dimension, g.observed, g.chosen_id, g.count, g.status]),
    ) +
    "\n"
  )
}

export default function AdminPickerGapsPage() {
  const [offset, setOffset] = useState(0)
  const [picker, setPicker] = useState("all")
  const [gapType, setGapType] = useState("all")
  const [status, setStatus] = useState("new")
  const deferredPicker = useDeferredValue(picker)

  const [exporting, setExporting] = useState(false)
  const listQuery = useAdminPickerGaps(offset, deferredPicker, gapType, status)
  const patch = usePatchPickerGapMutation()
  if (!isAdmin) return null

  const gaps = listQuery.data?.data ?? []
  const total = listQuery.data?.total ?? 0
  const loading = listQuery.isLoading && gaps.length === 0

  const exportMd = async () => {
    setExporting(true)
    try {
      const { rows, total: all } = await fetchAllRows((off, lim) =>
        fetchAdminPickerGapsPage(off, lim, deferredPicker, gapType, status),
      )
      downloadMarkdown(
        `picker-gaps-${exportDateStamp()}.md`,
        gapsMarkdown(rows, all, { picker: deferredPicker, type: gapType, status }),
      )
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold">Picker Catalog Gaps</h1>
        <p className="text-sm text-muted-foreground">Where the image analyzer wanted a catalog value that doesn't exist</p>
      </div>

      <div className="flex flex-wrap items-end gap-3 mb-4">
        <div className="w-44">
          <label className="text-xs font-medium text-muted-foreground mb-1 block">Picker</label>
          <Input placeholder="person, styling…" value={picker === "all" ? "" : picker} onChange={(e) => { setPicker(e.target.value || "all"); setOffset(0) }} className="text-sm" />
        </div>
        <div className="w-36">
          <label className="text-xs font-medium text-muted-foreground mb-1 block">Type</label>
          <Select value={gapType} onValueChange={(v) => { setGapType(v); setOffset(0) }}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="item">Missing item</SelectItem>
              <SelectItem value="category">Missing category</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="w-36">
          <label className="text-xs font-medium text-muted-foreground mb-1 block">Status</label>
          <Select value={status} onValueChange={(v) => { setStatus(v); setOffset(0) }}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="new">New</SelectItem>
              <SelectItem value="reviewed">Reviewed</SelectItem>
              <SelectItem value="added">Added</SelectItem>
              <SelectItem value="dismissed">Dismissed</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button variant="outline" size="sm" className="ml-auto" disabled={exporting || total === 0} onClick={exportMd}>
          {exporting ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Download className="h-3.5 w-3.5 mr-1.5" />}
          Export .md
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : (
        <div className="border rounded-lg overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left px-3 py-2 font-medium">Picker</th>
                <th className="text-left px-3 py-2 font-medium">Type</th>
                <th className="text-left px-3 py-2 font-medium">Dimension</th>
                <th className="text-left px-3 py-2 font-medium">Observed</th>
                <th className="text-left px-3 py-2 font-medium">Chosen</th>
                <th className="text-right px-3 py-2 font-medium">Count</th>
                <th className="text-left px-3 py-2 font-medium">Status</th>
                <th className="text-left px-3 py-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {gaps.map((g: PickerGap) => (
                <tr key={g.id} className="border-t hover:bg-muted/30">
                  <td className="px-3 py-2 text-xs font-mono">{g.picker_type}</td>
                  <td className="px-3 py-2 text-xs">{g.gap_type}</td>
                  <td className="px-3 py-2 text-xs font-mono">{g.dimension}</td>
                  <td className="px-3 py-2 max-w-[260px]">{g.observed}</td>
                  <td className="px-3 py-2 text-xs font-mono text-muted-foreground">{g.chosen_id ?? "--"}</td>
                  <td className="px-3 py-2 text-right tabular-nums font-medium">{g.count}</td>
                  <td className="px-3 py-2"><Badge variant="outline" className="text-xs">{g.status}</Badge></td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="icon" className="h-7 w-7" title="Added to catalog" disabled={patch.isPending} onClick={() => patch.mutate({ id: g.id, status: "added" })}><PlusCircle className="h-3.5 w-3.5 text-green-400" /></Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7" title="Reviewed" disabled={patch.isPending} onClick={() => patch.mutate({ id: g.id, status: "reviewed" })}><CheckCircle className="h-3.5 w-3.5 text-blue-400" /></Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7" title="Dismiss" disabled={patch.isPending} onClick={() => patch.mutate({ id: g.id, status: "dismissed" })}><XCircle className="h-3.5 w-3.5 text-muted-foreground" /></Button>
                    </div>
                  </td>
                </tr>
              ))}
              {gaps.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">No gaps found.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex items-center justify-between mt-4">
        <p className="text-xs text-muted-foreground">Showing {gaps.length > 0 ? offset + 1 : 0}–{offset + gaps.length} of {total}</p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled={offset === 0} onClick={() => setOffset((o) => Math.max(0, o - LIMIT))}>Previous</Button>
          <Button variant="outline" size="sm" disabled={offset + LIMIT >= total} onClick={() => setOffset((o) => o + LIMIT)}>Next</Button>
        </div>
      </div>
    </div>
  )
}
