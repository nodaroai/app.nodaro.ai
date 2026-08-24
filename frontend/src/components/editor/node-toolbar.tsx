"use client"

import { useState, useEffect, useCallback, useMemo, Suspense } from "react"
import { lazyWithRetry as lazy } from "@/lib/lazy-with-retry"
import {
  Plus,
  X,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { useReactFlow } from "@xyflow/react"
import { useT } from "@/lib/i18n"
const UnifiedAssetLibraryButton = lazy(() => import("./unified-asset-library").then(m => ({ default: m.UnifiedAssetLibraryButton })))
const ComponentMarketplaceModal = lazy(() => import("./component-marketplace-modal").then(m => ({ default: m.ComponentMarketplaceModal })))
import type { ComponentSelection } from "./component-marketplace-modal"
import type { SceneNodeType } from "@/types/nodes"
import { useAuth } from "@/hooks/use-auth"

// The catalogue and its edition filter are shared with the add-node popup.
// They used to be duplicated here and drifted — see #635. `getNodeOptions`
// is re-exported because the gating tests exercise this surface by name.
import { getNodeOptions } from "@/lib/node-options"
import { sidebarSections } from "@/lib/node-picker-sections"
import { SidebarSection } from "./node-toolbar/sidebar-section"
import { readOpenSections, persistOpenSections } from "@/lib/sidebar-sections-open"
export { getNodeOptions }




function NodeList({ onAdd }: { readonly onAdd: (type: SceneNodeType) => void }) {
  const t = useT()
  const { isAdmin } = useAuth()
  // Every node type, Parameter pickers included — the same pool the popup
  // browses. Only admin-only nodes stay gated; Cloud-only ones are already
  // filtered out of getNodeOptions() when !hasCredits().
  const visibleNodes = useMemo(
    () => getNodeOptions().filter((n) => !n.adminOnly || isAdmin),
    [isAdmin],
  )
  const sections = useMemo(() => sidebarSections(visibleNodes), [visibleNodes])

  const [open, setOpen] = useState<Set<string>>(readOpenSections)
  const apply = useCallback((next: Set<string>) => {
    persistOpenSections(next)
    setOpen(next)
  }, [])
  // Functional update so two toggles in one tick cannot drop the first.
  const toggle = useCallback((id: string) => {
    setOpen((prev) => {
      const next = new Set(prev)
      if (!next.delete(id)) next.add(id)
      persistOpenSections(next)
      return next
    })
  }, [])

  return (
    <>
      {/* Unified My Library - quick access to all assets */}
      <div className="mb-3 flex flex-col gap-1 border-b border-[var(--npk-border)] pb-3">
        <span className="mb-1 font-sans text-[10px] font-semibold uppercase tracking-wider text-[var(--npk-dim)]">
          {t("toolbar.library")}
        </span>
        <Suspense fallback={null}><UnifiedAssetLibraryButton /></Suspense>
      </div>

      <div className="mb-2 flex gap-1.5">
        <button
          type="button"
          onClick={() => apply(new Set(sections.map((s) => s.id)))}
          className="flex-1 rounded-md border border-[var(--npk-border)] px-2 py-1.5 font-sans text-[10px] font-semibold uppercase tracking-wider text-[var(--npk-dim)] transition-colors hover:bg-[var(--npk-hover)] hover:text-[var(--npk-t1)]"
        >
          {t("toolbar.expandAll")}
        </button>
        <button
          type="button"
          onClick={() => apply(new Set())}
          className="flex-1 rounded-md border border-[var(--npk-border)] px-2 py-1.5 font-sans text-[10px] font-semibold uppercase tracking-wider text-[var(--npk-dim)] transition-colors hover:bg-[var(--npk-hover)] hover:text-[var(--npk-t1)]"
        >
          {t("toolbar.collapseAll")}
        </button>
      </div>

      {sections.map((section) => (
        <SidebarSection
          key={section.id}
          section={section}
          open={open.has(section.id)}
          onToggle={toggle}
          onAdd={onAdd}
        />
      ))}
    </>
  )
}

interface NodeToolbarProps {
  readonly visible?: boolean
}

export function NodeToolbar({ visible = false }: NodeToolbarProps) {
  const t = useT()
  const addNode = useWorkflowStore((s) => s.addNode)
  const addNodeAndOpenPicker = useWorkflowStore((s) => s.addNodeAndOpenPicker)
  const { getViewport } = useReactFlow()
  const [sheetOpen, setSheetOpen] = useState(false)
  const [componentBrowserOpen, setComponentBrowserOpen] = useState(false)

  const getViewportCenterPosition = useCallback(() => {
    const el = document.querySelector('.react-flow')
    const rect = el?.getBoundingClientRect()
    const viewportWidth = rect?.width ?? window.innerWidth
    const viewportHeight = rect?.height ?? window.innerHeight
    const { x, y, zoom } = getViewport()
    const z = zoom || 1
    return {
      x: (-x + viewportWidth / 2) / z,
      y: (-y + viewportHeight / 2) / z,
    }
  }, [getViewport])

  const handleAddNode = useCallback(
    (type: SceneNodeType) => {
      if (type === "component") {
        setComponentBrowserOpen(true)
        return
      }
      const position = getViewportCenterPosition()
      // Picker auto-open is owned by the store action — see
      // addNodeAndOpenPicker in use-workflow-store.ts.
      addNodeAndOpenPicker(type, position)
      setSheetOpen(false)
    },
    [addNodeAndOpenPicker, getViewportCenterPosition],
  )

  const handleComponentSelect = useCallback(
    (component: ComponentSelection) => {
      const position = getViewportCenterPosition()
      addNode("component", position, component as unknown as Record<string, unknown>)
      setSheetOpen(false)
    },
    [addNode, getViewportCenterPosition],
  )

  // Close sheet on Escape
  useEffect(() => {
    if (!sheetOpen) return
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setSheetOpen(false)
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [sheetOpen])

  return (
    <>
      {/* Desktop: static sidebar panel - hidden by default, shown when visible prop is true */}
      {visible && (
        <div className="absolute top-4 left-16 z-10 hidden md:flex flex-col gap-2 bg-[var(--npk-surface-veil)] dark:backdrop-blur-sm border border-[var(--npk-border)] rounded-xl px-3 py-4 w-52 max-h-[calc(100vh-6rem)] overflow-y-auto shadow-lg animate-in slide-in-from-left-2 duration-200">
          <span className="font-sans text-[11px] font-semibold uppercase tracking-wider text-[var(--npk-dim)] dark:text-[var(--npk-accent)] mb-1">
            {t("toolbar.addNode")}
          </span>
          <NodeList onAdd={handleAddNode} />
        </div>
      )}

      {/* Mobile: FAB - always visible on mobile */}
      <Button
        size="sm"
        className="absolute bottom-4 right-4 z-10 h-12 w-12 rounded-full p-0 shadow-lg md:hidden"
        onClick={() => setSheetOpen(true)}
      >
        <Plus className="h-6 w-6" />
      </Button>

      {/* Mobile: bottom sheet */}
      {sheetOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setSheetOpen(false)}
          />
          {/* Sheet */}
          <div className="absolute bottom-0 left-0 right-0 bg-[var(--npk-surface-veil)] dark:backdrop-blur-sm border-t border-[var(--npk-border)] rounded-t-xl shadow-xl animate-in slide-in-from-bottom duration-200">
            <div className="flex items-center justify-between px-4 pt-3 pb-2">
              <span className="text-sm font-semibold text-[var(--npk-t1)]">{t("toolbar.addNode")}</span>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0 text-[var(--npk-dim)] hover:text-[var(--npk-t1)] dark:text-[var(--npk-dim)] dark:hover:text-white"
                onClick={() => setSheetOpen(false)}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="h-px bg-[var(--npk-border)]" />
            <div className="px-4 py-4 flex flex-col gap-2 max-h-[60vh] overflow-y-auto">
              <NodeList onAdd={handleAddNode} />
            </div>
            {/* Safe area padding for devices with home indicator */}
            <div className="h-[env(safe-area-inset-bottom)]" />
          </div>
        </div>
      )}

      {/* Component Marketplace Modal */}
      {componentBrowserOpen && (
        <Suspense fallback={null}>
          <ComponentMarketplaceModal
            open={componentBrowserOpen}
            onOpenChange={setComponentBrowserOpen}
            onSelect={handleComponentSelect}
          />
        </Suspense>
      )}
    </>
  )
}
