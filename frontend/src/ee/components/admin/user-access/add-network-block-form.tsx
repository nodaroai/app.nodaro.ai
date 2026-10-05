import { useState, type FormEvent } from "react"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useAdminWhoami, useBlockNetwork, type BlockDays } from "@/ee/hooks/queries/use-admin-access"
import { BLOCK_DAYS, DEFAULT_BLOCK_DAYS, blockDaysLabel, formatBlockDate } from "./block-format"

/**
 * Block an address or a range the admin types (`203.0.113.7`, `203.0.113.0/24`,
 * `2001:db8::/48`). The server decides everything — the widest range an admin
 * may block, private and Cloudflare addresses, the admin's own network — and
 * answers a refusal with a sentence, which is shown as is.
 *
 * "Your network" is shown so an admin does not have to guess what they must
 * not type; the server refuses it either way.
 */
export function AddNetworkBlockForm({ disabled }: { readonly disabled: boolean }) {
  const { data: me } = useAdminWhoami()
  const block = useBlockNetwork()
  const [address, setAddress] = useState("")
  const [label, setLabel] = useState("")
  const [days, setDays] = useState<BlockDays>(DEFAULT_BLOCK_DAYS)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const typed = address.trim()
    if (!typed) return
    try {
      const out = await block.mutateAsync({ address: typed, label: label.trim() || undefined, days })
      toast.success(`Blocked ${out.range ?? typed} until ${formatBlockDate(out.expiresAt)}`)
      setAddress("")
      setLabel("")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to block the network")
    }
  }

  return (
    <form onSubmit={submit} className="space-y-2 rounded-lg border bg-muted/30 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          className="h-8 w-[220px] font-mono"
          placeholder="Address or range"
          aria-label="Address or range to block"
          value={address}
          maxLength={64}
          dir="ltr"
          onChange={(e) => setAddress(e.target.value)}
        />
        <Input
          className="h-8 w-[220px]"
          placeholder="Note (optional)"
          aria-label="Note for other admins"
          value={label}
          maxLength={200}
          onChange={(e) => setLabel(e.target.value)}
        />
        <Select value={String(days)} onValueChange={(v) => setDays(Number(v) as BlockDays)}>
          <SelectTrigger className="h-8 w-[110px]" aria-label="Block duration">
            <SelectValue />
          </SelectTrigger>
          <SelectContent position="popper" className="z-[9999]">
            {BLOCK_DAYS.map((d) => (
              <SelectItem key={d} value={String(d)}>
                {blockDaysLabel(d)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button type="submit" size="sm" variant="destructive" disabled={disabled || block.isPending || !address.trim()}>
          {block.isPending && <Loader2 className="me-1 h-3 w-3 animate-spin" />}
          Block network
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Your network: <span className="font-mono">{me?.network ?? "unknown"}</span> (cannot be blocked). An admin can
        block one address (an IPv6 address blocks its /64). A range needs a super admin, and only a super admin lifts
        it.
      </p>
    </form>
  )
}
