"use client"

import { useState } from "react"
import { Sparkles, Layers, ArrowRight, ArrowDown, Check, Circle } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import type { GeneratedScript } from "@/types/nodes"

export interface ExpandOptions {
  readonly layout: "horizontal" | "vertical"
  readonly autoRun: boolean
  readonly includeCombine: boolean
}

interface ExpandStoryboardDialogProps {
  readonly isOpen: boolean
  readonly onClose: () => void
  readonly script: GeneratedScript
  readonly onConfirm: (options: ExpandOptions) => void
}

export function ExpandStoryboardDialog({
  isOpen,
  onClose,
  script,
  onConfirm,
}: ExpandStoryboardDialogProps) {
  const [layout, setLayout] = useState<"horizontal" | "vertical">("horizontal")
  const [autoRun, setAutoRun] = useState(true)
  const [includeCombine, setIncludeCombine] = useState(true)

  const scenes = script.scenes
  const sceneCount = scenes.length
  const scenesWithImages = scenes.filter((s) => (s.generatedImages ?? []).length > 0)
  const scenesNeedingImages = sceneCount - scenesWithImages.length
  const allImagesReady = scenesNeedingImages === 0

  const imageCost = scenesNeedingImages * 5
  const videoCost = sceneCount * 20
  const combineCost = includeCombine ? 2 : 0
  const totalCost = imageCost + videoCost + combineCost

  function handleConfirm() {
    onConfirm({ layout, autoRun, includeCombine })
    onClose()
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Layers className="w-4 h-4" />
            Expand Storyboard to Nodes
          </DialogTitle>
          <DialogDescription>
            Create workflow nodes for &quot;{script.title}&quot;
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-2">
          {/* Cost breakdown */}
          <div className="rounded-md border bg-muted/30 p-3 text-sm space-y-1.5">
            {/* Image nodes with per-scene breakdown */}
            <div className="space-y-1">
              <div className="flex justify-between font-medium">
                <span>{sceneCount}x Generate Image nodes</span>
                <span className="text-muted-foreground">
                  {allImagesReady ? (
                    <span className="text-green-600 dark:text-green-400">0 credits</span>
                  ) : (
                    <>{scenesNeedingImages} x 5 = {imageCost} credits</>
                  )}
                </span>
              </div>
              <div className="ml-2 space-y-0.5 text-xs">
                {allImagesReady ? (
                  <div className="flex items-center gap-1.5 text-green-600 dark:text-green-400 font-medium">
                    <Check className="w-3 h-3" />
                    All images ready!
                  </div>
                ) : (
                  scenes.map((scene) => {
                    const hasImage = (scene.generatedImages ?? []).length > 0
                    return (
                      <div key={scene.sceneNumber} className="flex items-center justify-between">
                        <span className="flex items-center gap-1.5">
                          {hasImage ? (
                            <Check className="w-3 h-3 text-green-600 dark:text-green-400" />
                          ) : (
                            <Circle className="w-3 h-3 text-muted-foreground/50" />
                          )}
                          <span className={hasImage ? "text-muted-foreground" : ""}>
                            Scene {scene.sceneNumber}
                          </span>
                        </span>
                        <span className="text-muted-foreground">
                          {hasImage ? "has image" : "5 credits"}
                        </span>
                      </div>
                    )
                  })
                )}
                {scenesWithImages.length > 0 && scenesNeedingImages > 0 && (
                  <div className="text-muted-foreground/70 pt-0.5">
                    {scenesWithImages.length}/{sceneCount} scenes already have images
                  </div>
                )}
              </div>
            </div>

            <Separator />

            <div className="flex justify-between">
              <span>{sceneCount}x Image to Video nodes</span>
              <span className="text-muted-foreground">{sceneCount} x 20 = {videoCost} credits</span>
            </div>
            {includeCombine && (
              <div className="flex justify-between">
                <span>1x Combine Videos node</span>
                <span className="text-muted-foreground">1 x 2 = {combineCost} credits</span>
              </div>
            )}
            <Separator />
            <div className="flex justify-between font-medium">
              <span className="flex items-center gap-1">
                <Sparkles className="w-3.5 h-3.5" />
                Total estimated
              </span>
              <span>{totalCost} credits</span>
            </div>
          </div>

          {/* Layout option */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">Layout</Label>
            <RadioGroup
              value={layout}
              onValueChange={(v) => setLayout(v as "horizontal" | "vertical")}
              className="flex gap-4"
            >
              <div className="flex items-center gap-2">
                <RadioGroupItem value="horizontal" id="layout-h" />
                <Label htmlFor="layout-h" className="flex items-center gap-1 text-sm cursor-pointer">
                  <ArrowRight className="w-3.5 h-3.5" />
                  Horizontal
                  <span className="text-muted-foreground text-xs">(recommended)</span>
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="vertical" id="layout-v" />
                <Label htmlFor="layout-v" className="flex items-center gap-1 text-sm cursor-pointer">
                  <ArrowDown className="w-3.5 h-3.5" />
                  Vertical
                </Label>
              </div>
            </RadioGroup>
          </div>

          {/* Checkboxes */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Checkbox
                id="auto-run"
                checked={autoRun}
                onCheckedChange={(checked) => setAutoRun(checked === true)}
              />
              <Label htmlFor="auto-run" className="text-sm cursor-pointer">
                Auto-run image generation after creating nodes
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="include-combine"
                checked={includeCombine}
                onCheckedChange={(checked) => setIncludeCombine(checked === true)}
              />
              <Label htmlFor="include-combine" className="text-sm cursor-pointer">
                Include Combine Videos node at the end
              </Label>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleConfirm}>Create Nodes</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
