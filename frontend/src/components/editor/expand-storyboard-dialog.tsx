"use client"

import { useState } from "react"
import { Sparkles, Layers, ArrowRight, ArrowDown, Check, Circle, Clapperboard, GitBranch } from "lucide-react"
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
import { creditUnits } from "@/lib/credit-units"
import type { GeneratedScript } from "@/types/nodes"
import { useT } from "@/lib/i18n"

export type NarrationSource = "visualDescription" | "action" | "imagePrompt"

export type ExpandNodeType = "pipeline" | "scene"

export interface ExpandOptions {
  readonly layout: "horizontal" | "vertical"
  readonly autoRun: boolean
  readonly includeCombine: boolean
  readonly narrationSource: NarrationSource
  readonly nodeType: ExpandNodeType
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
  const t = useT()
  const [layout, setLayout] = useState<"horizontal" | "vertical">("vertical")
  const [autoRun, setAutoRun] = useState(true)
  const [includeCombine, setIncludeCombine] = useState(true)
  const [narrationSource, setNarrationSource] = useState<NarrationSource>("visualDescription")
  const [nodeType, setNodeType] = useState<ExpandNodeType>("scene")

  const scenes = script.scenes
  const sceneCount = scenes.length
  const scenesWithImages = scenes.filter((s) => (s.generatedImages ?? []).length > 0)
  const scenesNeedingImages = sceneCount - scenesWithImages.length
  const allImagesReady = scenesNeedingImages === 0

  const imageCost = scenesNeedingImages * 5
  const videoCost = sceneCount * 20
  const ttsCost = sceneCount * 3
  const combineCost = includeCombine && nodeType === "pipeline" ? 2 : 0
  const sceneTotalCost = imageCost
  const pipelineTotalCost = imageCost + videoCost + ttsCost + combineCost
  const totalCost = nodeType === "scene" ? sceneTotalCost : pipelineTotalCost

  function handleConfirm() {
    onConfirm({ layout, autoRun, includeCombine, narrationSource, nodeType })
    onClose()
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Layers className="w-4 h-4" />
            {t("storyboard.title")}
          </DialogTitle>
          <DialogDescription>
            {t("storyboard.createNodesFor", { title: script.title })}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-2">
          {/* Cost breakdown */}
          <div className="rounded-md border bg-muted/30 p-3 text-sm space-y-1.5">
            {/* Image nodes with per-scene breakdown */}
            <div className="space-y-1">
              <div className="flex justify-between font-medium">
                <span>{t("storyboard.imageNodesCount", { n: sceneCount })}</span>
                <span className="text-muted-foreground">
                  {allImagesReady ? (
                    <span className="text-green-600 dark:text-green-400">{t("storyboard.zeroCredits")}</span>
                  ) : (
                    <>{t("storyboard.costFormula", { n: scenesNeedingImages, unit: creditUnits(5), total: creditUnits(imageCost) })}</>
                  )}
                </span>
              </div>
              <div className="ms-2 space-y-0.5 text-xs">
                {allImagesReady ? (
                  <div className="flex items-center gap-1.5 text-green-600 dark:text-green-400 font-medium">
                    <Check className="w-3 h-3" />
                    {t("storyboard.allImagesReady")}
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
                            {t("cfgext.sceneNumbered", { index: scene.sceneNumber })}
                          </span>
                        </span>
                        <span className="text-muted-foreground">
                          {hasImage ? t("storyboard.hasImage") : t("storyboard.creditsAmount", { n: creditUnits(5) })}
                        </span>
                      </div>
                    )
                  })
                )}
                {scenesWithImages.length > 0 && scenesNeedingImages > 0 && (
                  <div className="text-muted-foreground/70 pt-0.5">
                    {t("storyboard.scenesHaveImages", { ready: scenesWithImages.length, total: sceneCount })}
                  </div>
                )}
              </div>
            </div>

            {nodeType === "pipeline" && (
              <>
                <Separator />
                <div className="flex justify-between">
                  <span>{t("storyboard.videoNodesCount", { n: sceneCount })}</span>
                  <span className="text-muted-foreground">{t("storyboard.costFormula", { n: sceneCount, unit: creditUnits(20), total: creditUnits(videoCost) })}</span>
                </div>
                <div className="flex justify-between">
                  <span>{t("storyboard.ttsNodesCount", { n: sceneCount })}</span>
                  <span className="text-muted-foreground">{t("storyboard.costFormula", { n: sceneCount, unit: creditUnits(3), total: creditUnits(ttsCost) })}</span>
                </div>
                <div className="flex justify-between">
                  <span>{t("storyboard.mergeNodesCount", { n: sceneCount })}</span>
                  <span className="text-muted-foreground/60">{t("storyboard.zeroCredits")}</span>
                </div>
                <div className="flex justify-between">
                  <span>{t("storyboard.textPromptNodesCount", { n: sceneCount })}</span>
                  <span className="text-muted-foreground/60">{t("storyboard.zeroCredits")}</span>
                </div>
                {includeCombine && (
                  <div className="flex justify-between">
                    <span>{t("storyboard.combineNode")}</span>
                    <span className="text-muted-foreground">{t("storyboard.costFormula", { n: 1, unit: creditUnits(2), total: creditUnits(combineCost) })}</span>
                  </div>
                )}
              </>
            )}
            <Separator />
            <div className="flex justify-between font-medium">
              <span className="flex items-center gap-1">
                <Sparkles className="w-3.5 h-3.5" />
                {t("storyboard.totalEstimated")}
              </span>
              <span>{t("storyboard.creditsAmount", { n: creditUnits(totalCost) })}</span>
            </div>
          </div>

          {/* Node type option */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">{t("storyboard.nodeType")}</Label>
            <RadioGroup
              value={nodeType}
              onValueChange={(v) => setNodeType(v as ExpandNodeType)}
              className="flex gap-4"
            >
              <div className="flex items-center gap-2">
                <RadioGroupItem value="scene" id="type-scene" />
                <Label htmlFor="type-scene" className="flex items-center gap-1 text-sm cursor-pointer">
                  <Clapperboard className="w-3.5 h-3.5" />
                  {t("storyboard.sceneNodes")}
                  <span className="text-muted-foreground text-xs">{t("storyboard.recommended")}</span>
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="pipeline" id="type-pipeline" />
                <Label htmlFor="type-pipeline" className="flex items-center gap-1 text-sm cursor-pointer">
                  <GitBranch className="w-3.5 h-3.5" />
                  {t("storyboard.pipelineNodes")}
                </Label>
              </div>
            </RadioGroup>
            <p className="text-xs text-muted-foreground">
              {nodeType === "scene"
                ? t("storyboard.sceneNodesDesc")
                : t("storyboard.pipelineNodesDesc")}
            </p>
          </div>

          {/* Layout option */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">{t("proccfg.layout")}</Label>
            <RadioGroup
              value={layout}
              onValueChange={(v) => setLayout(v as "horizontal" | "vertical")}
              className="flex gap-4"
            >
              <div className="flex items-center gap-2">
                <RadioGroupItem value="horizontal" id="layout-h" />
                <Label htmlFor="layout-h" className="flex items-center gap-1 text-sm cursor-pointer">
                  <ArrowRight className="w-3.5 h-3.5" />
                  {t("storyboard.horizontal")}
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="vertical" id="layout-v" />
                <Label htmlFor="layout-v" className="flex items-center gap-1 text-sm cursor-pointer">
                  <ArrowDown className="w-3.5 h-3.5" />
                  {t("storyboard.vertical")}
                  <span className="text-muted-foreground text-xs">{t("storyboard.recommended")}</span>
                </Label>
              </div>
            </RadioGroup>
          </div>

          {/* Narration source - pipeline only */}
          {nodeType === "pipeline" && (
            <div className="space-y-2">
              <Label className="text-sm font-medium">{t("storyboard.narrationSource")}</Label>
              <select
                value={narrationSource}
                onChange={(e) => setNarrationSource(e.target.value as NarrationSource)}
                className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="visualDescription">{t("storyboard.narrationVisualDesc")}</option>
                <option value="action">{t("scriptcfg.sceneAction")}</option>
                <option value="imagePrompt">{t("storyboard.narrationImagePrompt")}</option>
              </select>
              <p className="text-xs text-muted-foreground">
                {t("storyboard.narrationSourceHint")}
              </p>
            </div>
          )}

          {/* Checkboxes */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Checkbox
                id="auto-run"
                checked={autoRun}
                onCheckedChange={(checked) => setAutoRun(checked === true)}
              />
              <Label htmlFor="auto-run" className="text-sm cursor-pointer">
                {t("storyboard.autoRun")}
              </Label>
            </div>
            {nodeType === "pipeline" && (
              <div className="flex items-center gap-2">
                <Checkbox
                  id="include-combine"
                  checked={includeCombine}
                  onCheckedChange={(checked) => setIncludeCombine(checked === true)}
                />
                <Label htmlFor="include-combine" className="text-sm cursor-pointer">
                  {t("storyboard.includeCombine")}
                </Label>
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("common.cancel")}</Button>
          <Button onClick={handleConfirm}>{t("storyboard.createNodes")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
