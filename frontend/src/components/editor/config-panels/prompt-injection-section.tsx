"use client"

import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Separator } from "@/components/ui/separator"
import { NODE_DEFINITIONS } from "@/types/nodes"

/**
 * "Prompt Injection" config section — lets a node opt out of the AUTOMATIC
 * injection of upstream **Look** (cinematography hints) and/or **Elements**
 * (character element fragments) into its prompt.
 *
 * Default is ON for both: the flags are absent (undefined) until the user
 * toggles a switch off, so existing nodes keep injecting exactly as before.
 * The runtime gates read `injectLook === false` / `injectElements === false` on
 * the CONSUMER node:
 *   - Look:     `collectCinematographyHints` (FE `cinematography-hints.ts`,
 *               BE `payload-builder.ts`) returns `[]`.
 *   - Elements: `stampElementInjections` (FE `node-input-resolver.ts`,
 *               BE `payload-builder.ts`) returns the refs un-stamped.
 *
 * Each toggle renders only when the node actually has the matching handle —
 * `look`/`cinematography` → Inject Look, `elements` → Inject Elements — read
 * straight from `NODE_DEFINITIONS` so new handle-bearing nodes get the toggle
 * automatically. Renders nothing for nodes with neither handle, so it is safe
 * to mount unconditionally.
 */
export function PromptInjectionSection({
  nodeType,
  nodeData,
  selectedNodeId,
  updateNodeData,
}: {
  nodeType: string
  nodeData: Record<string, unknown>
  selectedNodeId: string | undefined
  updateNodeData: (id: string, data: Record<string, unknown>) => void
}) {
  const inputs = NODE_DEFINITIONS.find((d) => d.type === nodeType)?.inputs ?? []
  const hasLook = inputs.includes("look") || inputs.includes("cinematography")
  const hasElements = inputs.includes("elements")
  // Prompt auto-append + variable suppression is wired only for the two gen
  // nodes (execute-node / payload-builder pass `appendWired` only there).
  const hasPromptInject =
    (nodeType === "generate-image" || nodeType === "generate-video") && inputs.includes("prompt")
  const hasNegativeInject =
    (nodeType === "generate-image" || nodeType === "generate-video") && inputs.includes("negative")
  if (!selectedNodeId || (!hasLook && !hasElements && !hasPromptInject && !hasNegativeInject)) return null

  const injectLook = nodeData.injectLook !== false
  const injectElements = nodeData.injectElements !== false
  const injectPrompt = nodeData.injectPrompt !== false
  const injectNegative = nodeData.injectNegative !== false

  return (
    <>
      <Separator />
      <div className="space-y-2">
        <Label className="text-[11px] font-semibold uppercase tracking-widest text-gray-500 dark:text-[#64748B]">
          Prompt Injection
        </Label>
        {hasPromptInject && (
          <>
            <div className="flex items-center justify-between">
              <Label htmlFor="inject-prompt" className="text-xs cursor-pointer">Inject Prompt</Label>
              <Switch
                id="inject-prompt"
                checked={injectPrompt}
                onCheckedChange={(v) => updateNodeData(selectedNodeId, { injectPrompt: v })}
              />
            </div>
            <p className="text-[10px] text-muted-foreground -mt-1">
              Append a connected prompt to this node&apos;s prompt
            </p>
          </>
        )}
        {hasNegativeInject && (
          <>
            <div className="flex items-center justify-between">
              <Label htmlFor="inject-negative" className="text-xs cursor-pointer">Inject Negative</Label>
              <Switch
                id="inject-negative"
                checked={injectNegative}
                onCheckedChange={(v) => updateNodeData(selectedNodeId, { injectNegative: v })}
              />
            </div>
            <p className="text-[10px] text-muted-foreground -mt-1">
              Append a connected negative prompt to this node&apos;s negative
            </p>
          </>
        )}
        {hasLook && (
          <>
            <div className="flex items-center justify-between">
              <Label htmlFor="inject-look" className="text-xs cursor-pointer">Inject Look</Label>
              <Switch
                id="inject-look"
                checked={injectLook}
                onCheckedChange={(v) => updateNodeData(selectedNodeId, { injectLook: v })}
              />
            </div>
            <p className="text-[10px] text-muted-foreground -mt-1">
              Fold connected cinematography / Look nodes into this node&apos;s prompt
            </p>
          </>
        )}
        {hasElements && (
          <>
            <div className="flex items-center justify-between">
              <Label htmlFor="inject-elements" className="text-xs cursor-pointer">Inject Elements</Label>
              <Switch
                id="inject-elements"
                checked={injectElements}
                onCheckedChange={(v) => updateNodeData(selectedNodeId, { injectElements: v })}
              />
            </div>
            <p className="text-[10px] text-muted-foreground -mt-1">
              Weave connected character Elements into this node&apos;s prompt
            </p>
          </>
        )}
      </div>
    </>
  )
}
