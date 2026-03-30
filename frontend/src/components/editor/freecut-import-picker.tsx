"use client"

import { useState, useCallback, useEffect } from "react"
import { createPortal } from "react-dom"
import { X, Upload, FolderOpen, Film, Image as ImageIcon, Volume2, Search, Check } from "lucide-react"
import { Input } from "@/components/ui/input"
import { CachedImage } from "@/components/ui/cached-image"
import { getLibraryAssets, type LibraryAsset } from "@/lib/api"
import { useAuth } from "@/hooks/use-auth"

interface WorkflowAsset {
  nodeId: string
  url: string
  type: "video" | "image" | "audio"
  label?: string
  thumbnailUrl?: string
}

interface ImportPickerProps {
  readonly workflowAssets?: WorkflowAsset[]
  readonly accept: string
  readonly multiple: boolean
  readonly onImport: (files: Array<{ name: string; type: string; size: number; buffer: ArrayBuffer }>) => void
  readonly onClose: () => void
}

type Tab = "workflow" | "library" | "file"

const TYPE_ICON = { video: Film, image: ImageIcon, audio: Volume2 } as const

export function FreeCutImportPicker({ workflowAssets, accept, multiple, onImport, onClose }: ImportPickerProps) {
  const hasWorkflow = workflowAssets && workflowAssets.length > 0
  const [activeTab, setActiveTab] = useState<Tab>(hasWorkflow ? "workflow" : "library")
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [importing, setImporting] = useState(false)

  const { user } = useAuth()
  const [libraryAssets, setLibraryAssets] = useState<LibraryAsset[]>([])
  const [librarySearch, setLibrarySearch] = useState("")
  const [libraryType, setLibraryType] = useState<"all" | "video" | "image" | "audio">("all")
  const [libraryCursor, setLibraryCursor] = useState<string | null>(null)
  const [libraryLoading, setLibraryLoading] = useState(false)
  const [libraryHasMore, setLibraryHasMore] = useState(true)

  const loadLibrary = useCallback(async (reset = false) => {
    if (!user?.id || libraryLoading) return
    setLibraryLoading(true)
    try {
      const result = await getLibraryAssets({
        userId: user.id,
        type: libraryType === "all" ? undefined : libraryType,
        search: librarySearch || undefined,
        limit: 20,
        cursor: reset ? undefined : (libraryCursor ?? undefined),
      })
      setLibraryAssets(prev => reset ? result.data : [...prev, ...result.data])
      setLibraryCursor(result.nextCursor)
      setLibraryHasMore(!!result.nextCursor)
    } finally {
      setLibraryLoading(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, libraryType, librarySearch, libraryCursor, libraryLoading])

  useEffect(() => {
    if (activeTab === "library") {
      setLibraryAssets([])
      setLibraryCursor(null)
      setLibraryHasMore(true)
      loadLibrary(true)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, libraryType, librarySearch])

  function toggleSelect(id: string) {
    if (!multiple) {
      setSelected(new Set([id]))
      return
    }
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function handleImportSelected() {
    setImporting(true)
    try {
      const urls: Array<{ url: string; name: string; type: string }> = []

      if (activeTab === "workflow" && workflowAssets) {
        for (const asset of workflowAssets) {
          if (selected.has(asset.nodeId)) {
            const ext = asset.type === "video" ? "mp4" : asset.type === "audio" ? "mp3" : "png"
            const mime = asset.type === "video" ? "video/mp4" : asset.type === "audio" ? "audio/mpeg" : "image/png"
            urls.push({ url: asset.url, name: `${asset.label ?? asset.nodeId}.${ext}`, type: mime })
          }
        }
      } else if (activeTab === "library") {
        for (const asset of libraryAssets) {
          if (selected.has(asset.id)) {
            urls.push({ url: asset.url, name: asset.filename, type: asset.mimeType })
          }
        }
      }

      const files = await Promise.all(
        urls.map(async ({ url, name, type }) => {
          const buffer = await fetch(url).then(r => r.arrayBuffer())
          return { name, type, size: buffer.byteLength, buffer }
        }),
      )
      onImport(files)
      onClose()
    } finally {
      setImporting(false)
    }
  }

  function handleFileTab() {
    const input = document.createElement("input")
    input.type = "file"
    input.accept = accept
    input.multiple = multiple
    input.onchange = async () => {
      const files = Array.from(input.files || [])
      if (!files.length) return
      setImporting(true)
      try {
        const payload = await Promise.all(
          files.map(async (f) => ({
            name: f.name,
            type: f.type,
            size: f.size,
            buffer: await f.arrayBuffer(),
          })),
        )
        onImport(payload)
        onClose()
      } finally {
        setImporting(false)
      }
    }
    input.click()
  }

  const tabs: Array<{ id: Tab; label: string; icon: typeof FolderOpen }> = [
    ...(hasWorkflow ? [{ id: "workflow" as Tab, label: "From Workflow", icon: FolderOpen }] : []),
    { id: "library", label: "From Library", icon: FolderOpen },
    { id: "file", label: "From File", icon: Upload },
  ]

  return createPortal(
    <div className="fixed inset-0 z-[10001] bg-black/60 flex items-center justify-center" onClick={onClose}>
      <div className="bg-[#1E1E1E] border border-[#2D2D2D] rounded-lg w-[600px] max-h-[500px] flex flex-col shadow-xl" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#2D2D2D]">
          <span className="text-sm font-medium text-white">Import Assets</span>
          <button type="button" onClick={onClose} className="text-white/50 hover:text-white"><X className="w-4 h-4" /></button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-[#2D2D2D]">
          {tabs.map(tab => (
            <button
              key={tab.id}
              type="button"
              onClick={() => { if (tab.id === "file") { handleFileTab(); return } setActiveTab(tab.id); setSelected(new Set()) }}
              className={`flex items-center gap-1.5 px-4 py-2 text-xs font-medium transition-colors ${activeTab === tab.id ? "text-white border-b-2 border-[#ff0073]" : "text-white/50 hover:text-white/80"}`}
            >
              <tab.icon className="w-3.5 h-3.5" />
              {tab.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-3 min-h-[300px]">
          {activeTab === "workflow" && workflowAssets && (
            <div className="grid grid-cols-3 gap-2">
              {workflowAssets.map(asset => {
                const Icon = TYPE_ICON[asset.type as keyof typeof TYPE_ICON] ?? Film
                const isSelected = selected.has(asset.nodeId)
                return (
                  <button
                    key={asset.nodeId}
                    type="button"
                    onClick={() => toggleSelect(asset.nodeId)}
                    className={`relative flex flex-col items-center gap-1 p-2 rounded-md border transition-colors ${isSelected ? "border-[#ff0073] bg-[#ff0073]/10" : "border-[#2D2D2D] hover:border-white/30"}`}
                  >
                    {isSelected && <Check className="absolute top-1 right-1 w-3 h-3 text-[#ff0073]" />}
                    {asset.thumbnailUrl ? (
                      <CachedImage src={asset.thumbnailUrl} alt="" className="w-16 h-16 object-cover rounded" thumbnail thumbnailWidth={128} />
                    ) : (
                      <div className="w-16 h-16 flex items-center justify-center rounded bg-white/5"><Icon className="w-6 h-6 text-white/30" /></div>
                    )}
                    <span className="text-[10px] text-white/70 truncate w-full text-center">{asset.label ?? asset.nodeId}</span>
                    <span className="text-[9px] text-white/40 uppercase">{asset.type}</span>
                  </button>
                )
              })}
            </div>
          )}

          {activeTab === "library" && (
            <div className="flex flex-col gap-2">
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/30" />
                  <Input
                    value={librarySearch}
                    onChange={e => setLibrarySearch(e.target.value)}
                    placeholder="Search library..."
                    className="pl-7 h-7 text-xs bg-black/30 border-white/10"
                  />
                </div>
                <div className="flex gap-1">
                  {(["all", "video", "image", "audio"] as const).map(t => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setLibraryType(t)}
                      className={`px-2 py-1 text-[10px] rounded ${libraryType === t ? "bg-[#ff0073] text-white" : "bg-white/5 text-white/50 hover:text-white/80"}`}
                    >
                      {t === "all" ? "All" : t.charAt(0).toUpperCase() + t.slice(1)}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-4 gap-2">
                {libraryAssets.map(asset => {
                  const isSelected = selected.has(asset.id)
                  return (
                    <button
                      key={asset.id}
                      type="button"
                      onClick={() => toggleSelect(asset.id)}
                      className={`relative flex flex-col items-center gap-1 p-1.5 rounded border transition-colors ${isSelected ? "border-[#ff0073] bg-[#ff0073]/10" : "border-[#2D2D2D] hover:border-white/30"}`}
                    >
                      {isSelected && <Check className="absolute top-0.5 right-0.5 w-3 h-3 text-[#ff0073]" />}
                      {asset.thumbnailUrl ? (
                        <CachedImage src={asset.thumbnailUrl} alt="" className="w-14 h-14 object-cover rounded" thumbnail thumbnailWidth={112} />
                      ) : (
                        <div className="w-14 h-14 flex items-center justify-center rounded bg-white/5">
                          <Film className="w-5 h-5 text-white/20" />
                        </div>
                      )}
                      <span className="text-[9px] text-white/60 truncate w-full text-center">{asset.filename}</span>
                    </button>
                  )
                })}
              </div>
              {libraryHasMore && (
                <button type="button" onClick={() => loadLibrary(false)} disabled={libraryLoading} className="text-xs text-white/50 hover:text-white/80 py-1">
                  {libraryLoading ? "Loading..." : "Load more"}
                </button>
              )}
              {!libraryLoading && libraryAssets.length === 0 && (
                <p className="text-xs text-white/30 text-center py-8">No assets found</p>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        {activeTab !== "file" && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-[#2D2D2D]">
            <span className="text-[10px] text-white/40">{selected.size} selected</span>
            <button
              type="button"
              onClick={handleImportSelected}
              disabled={selected.size === 0 || importing}
              className="px-4 py-1.5 text-xs font-medium rounded-md bg-[#ff0073] text-white hover:bg-[#ff0073]/80 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {importing ? "Importing..." : `Import${selected.size > 0 ? ` (${selected.size})` : ""}`}
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}
