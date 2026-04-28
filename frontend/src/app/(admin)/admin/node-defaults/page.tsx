import { Loader2, RotateCcw } from "lucide-react"
import { toast } from "sonner"
import {
  useAdminNodeDefaults,
  useUpdateNodeDefaultMutation,
  useResetNodeDefaultMutation,
} from "@/hooks/queries/use-admin-queries"
import {
  NODE_DEFAULT_TYPES,
  supportedDefaultDimensions,
  getValidValues,
  getTargetField,
  type NodeDefaultType,
} from "@nodaro/shared"
import type { AdminDefault } from "@/lib/node-defaults"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Button } from "@/components/ui/button"

const GROUPS: ReadonlyArray<{ title: string; nodeTypes: readonly NodeDefaultType[] }> = [
  {
    title: "Image",
    nodeTypes: ["generate-image", "image-to-image", "edit-image", "upscale-image"],
  },
  {
    title: "Video & Composition",
    nodeTypes: ["text-to-video", "image-to-video", "lip-sync"],
  },
  {
    title: "Audio",
    nodeTypes: ["text-to-speech", "generate-music", "voice-design"],
  },
  {
    title: "LLM-driven",
    nodeTypes: ["ai-writer", "lottie-overlay", "3d-title", "motion-graphics", "image-to-text", "qa-check"],
  },
]

const QUALITY_OPTIONS = ["low", "mid", "high"] as const
const ASPECT_OPTIONS = ["auto", "1:1", "4:3", "3:4", "16:9", "9:16"] as const

const RESET_VALUE = "__factory__"

function NodeRow({
  nodeType,
  row,
  onUpdate,
  onReset,
  isPending,
}: {
  readonly nodeType: NodeDefaultType
  readonly row: AdminDefault | undefined
  readonly onUpdate: (
    nodeType: NodeDefaultType,
    patch: { provider?: string; qualityLevel?: string | null; aspectRatio?: string | null },
  ) => void
  readonly onReset: (nodeType: NodeDefaultType) => void
  readonly isPending: boolean
}) {
  const dims = supportedDefaultDimensions(nodeType)
  const validValues = getValidValues(nodeType)
  const fieldLabel = getTargetField(nodeType)

  return (
    <tr className="border-b last:border-b-0 hover:bg-muted/30 transition-colors">
      <td className="py-3 px-4">
        <div className="flex flex-col gap-0.5">
          <span className="font-mono text-xs">{nodeType}</span>
          <span className="text-[10px] text-muted-foreground">field: {fieldLabel}</span>
        </div>
      </td>
      <td className="py-3 px-4 min-w-[220px]">
        <Select
          value={row?.provider ?? ""}
          onValueChange={(v) => onUpdate(nodeType, { provider: v })}
          disabled={isPending}
        >
          <SelectTrigger className="h-9">
            <SelectValue placeholder="(factory default)" />
          </SelectTrigger>
          <SelectContent>
            {validValues.map((p) => (
              <SelectItem key={p} value={p}>
                {p}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </td>
      <td className="py-3 px-4 min-w-[120px]">
        {dims.quality ? (
          <Select
            value={row?.quality_level ?? ""}
            onValueChange={(v) =>
              onUpdate(nodeType, { qualityLevel: v === RESET_VALUE ? null : v })
            }
            disabled={isPending || !row}
          >
            <SelectTrigger className="h-9">
              <SelectValue placeholder="—" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={RESET_VALUE}>(unset)</SelectItem>
              {QUALITY_OPTIONS.map((q) => (
                <SelectItem key={q} value={q}>
                  {q}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <span className="text-muted-foreground text-xs">—</span>
        )}
      </td>
      <td className="py-3 px-4 min-w-[120px]">
        {dims.aspectRatio ? (
          <Select
            value={row?.aspect_ratio ?? ""}
            onValueChange={(v) =>
              onUpdate(nodeType, { aspectRatio: v === RESET_VALUE ? null : v })
            }
            disabled={isPending || !row}
          >
            <SelectTrigger className="h-9">
              <SelectValue placeholder="—" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={RESET_VALUE}>(unset)</SelectItem>
              {ASPECT_OPTIONS.map((a) => (
                <SelectItem key={a} value={a}>
                  {a}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <span className="text-muted-foreground text-xs">—</span>
        )}
      </td>
      <td className="py-3 px-4 w-12">
        {row && (
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onReset(nodeType)}
            title="Reset to factory default"
            disabled={isPending}
          >
            <RotateCcw className="h-4 w-4" />
          </Button>
        )}
      </td>
    </tr>
  )
}

export default function NodeDefaultsAdminPage() {
  const { data: defaults = [], isLoading } = useAdminNodeDefaults()
  const update = useUpdateNodeDefaultMutation()
  const reset = useResetNodeDefaultMutation()

  function getRow(nodeType: NodeDefaultType): AdminDefault | undefined {
    return defaults.find((d) => d.node_type === nodeType)
  }

  function handleUpdate(
    nodeType: NodeDefaultType,
    patch: { provider?: string; qualityLevel?: string | null; aspectRatio?: string | null },
  ) {
    const existing = getRow(nodeType)
    const provider = patch.provider ?? existing?.provider
    if (!provider) {
      toast.error("Pick a provider first")
      return
    }
    update.mutate(
      {
        nodeType,
        provider,
        qualityLevel: patch.qualityLevel !== undefined ? patch.qualityLevel : existing?.quality_level ?? null,
        aspectRatio: patch.aspectRatio !== undefined ? patch.aspectRatio : existing?.aspect_ratio ?? null,
      },
      {
        onSuccess: () => toast.success(`Updated ${nodeType}`),
        onError: (e) => toast.error(`Failed: ${(e as Error).message}`),
      },
    )
  }

  function handleReset(nodeType: NodeDefaultType) {
    reset.mutate(nodeType, {
      onSuccess: () => toast.success(`Reset ${nodeType} to factory default`),
      onError: (e) => toast.error(`Failed: ${(e as Error).message}`),
    })
  }

  if (isLoading) {
    return (
      <div className="p-6 flex items-center gap-2 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading…
      </div>
    )
  }

  const isPending = update.isPending || reset.isPending

  return (
    <div className="p-6 space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold">Node Defaults</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Set the default provider/model and (where applicable) quality and aspect ratio for each AI node type.
          Users can still pick anything they want — these are just the starting values for newly added nodes.
          Existing nodes on existing canvases are not affected.
        </p>
      </div>

      {GROUPS.map((group) => (
        <div key={group.title} className="border rounded-lg bg-card overflow-hidden">
          <div className="px-4 py-3 border-b bg-muted/30">
            <h2 className="font-semibold text-sm">{group.title}</h2>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="py-2 px-4 w-1/4">Node type</th>
                <th className="py-2 px-4">Provider / Model</th>
                <th className="py-2 px-4">Quality</th>
                <th className="py-2 px-4">Aspect</th>
                <th className="py-2 px-4 w-12"></th>
              </tr>
            </thead>
            <tbody>
              {group.nodeTypes.map((nt) => (
                <NodeRow
                  key={nt}
                  nodeType={nt}
                  row={getRow(nt)}
                  onUpdate={handleUpdate}
                  onReset={handleReset}
                  isPending={isPending}
                />
              ))}
            </tbody>
          </table>
        </div>
      ))}

      <p className="text-xs text-muted-foreground pt-4 border-t">
        Coverage: {NODE_DEFAULT_TYPES.length} node types. Quality/aspect dimensions apply only where the underlying provider exposes them.
      </p>
    </div>
  )
}
