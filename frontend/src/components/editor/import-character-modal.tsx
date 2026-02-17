import { useState, useEffect } from "react"
import { createPortal } from "react-dom"
import { X, FileText, Loader2, Download } from "lucide-react"
import { CachedImage } from "@/components/ui/cached-image"
import { useImportableWorkflows } from "@/hooks/queries/use-editor-queries"
import type { CharacterDefinition } from "@/types/nodes"

interface ImportCharacterModalProps {
  readonly isOpen: boolean
  readonly onClose: () => void
  readonly onImport: (chars: CharacterDefinition[]) => void
  readonly currentWorkflowId: string | null
  readonly existingNames: readonly string[]
  readonly projectId?: string
}

export function ImportCharacterModal({
  isOpen,
  onClose,
  onImport,
  currentWorkflowId,
  existingNames,
  projectId,
}: ImportCharacterModalProps) {
  const { data: workflows = [], isLoading: loading, error: queryError } = useImportableWorkflows(
    projectId,
    currentWorkflowId,
    isOpen,
  )
  const error = queryError instanceof Error ? queryError.message : queryError ? "Failed to load workflows" : ""

  const [selectedWorkflowId, setSelectedWorkflowId] = useState("")
  const [selectedCharIds, setSelectedCharIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (isOpen) {
      setSelectedWorkflowId("")
      setSelectedCharIds(new Set())
    }
  }, [isOpen])

  if (!isOpen) return null

  const selectedWorkflow = workflows.find((w) => w.id === selectedWorkflowId)
  const importableChars = (selectedWorkflow?.characters ?? []).filter(
    (c) => !existingNames.includes(c.name)
  )
  const duplicateChars = (selectedWorkflow?.characters ?? []).filter(
    (c) => existingNames.includes(c.name)
  )

  function toggleChar(id: string) {
    setSelectedCharIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  function handleImport() {
    if (!selectedWorkflow) return
    const charsToImport = importableChars
      .filter((c) => selectedCharIds.has(c.id))
      .map((c) => ({
        ...c,
        id: crypto.randomUUID(),
        importedFrom: {
          workflowId: selectedWorkflow.id,
          workflowName: selectedWorkflow.name,
        },
      }))
    onImport(charsToImport)
    onClose()
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/50"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="bg-background border rounded-lg shadow-xl w-full max-w-lg mx-4"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <h3 className="text-sm font-semibold">Import Characters from Workflow</h3>
          <button type="button" onClick={onClose} className="p-1 rounded-md hover:bg-muted">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-4 flex flex-col gap-4 max-h-[400px] overflow-y-auto">
          {loading && (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          )}

          {error && <p className="text-xs text-destructive">{error}</p>}

          {!loading && workflows.length === 0 && !error && (
            <p className="text-xs text-muted-foreground text-center py-8">
              No other workflows with characters found.
            </p>
          )}

          {!loading && workflows.length > 0 && (
            <>
              {/* Workflow selector */}
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1">Select Workflow</label>
                <select
                  value={selectedWorkflowId}
                  onChange={(e) => {
                    setSelectedWorkflowId(e.target.value)
                    setSelectedCharIds(new Set())
                  }}
                  className="w-full px-3 py-2 text-sm border rounded-md bg-background focus:outline-none focus:ring-1 focus:ring-primary"
                >
                  <option value="">Choose a workflow...</option>
                  {workflows.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name} ({w.characters.length} character{w.characters.length !== 1 ? "s" : ""})
                    </option>
                  ))}
                </select>
              </div>

              {/* Character grid */}
              {selectedWorkflow && (
                <div>
                  <label className="text-xs font-medium text-muted-foreground block mb-2">
                    Characters ({importableChars.length} available)
                  </label>
                  {importableChars.length === 0 && duplicateChars.length > 0 && (
                    <p className="text-xs text-muted-foreground">All characters already exist in current workflow.</p>
                  )}
                  <div className="grid grid-cols-3 gap-2">
                    {importableChars.map((char) => {
                      const isSelected = selectedCharIds.has(char.id)
                      return (
                        <button
                          key={char.id}
                          type="button"
                          onClick={() => toggleChar(char.id)}
                          className={`flex flex-col items-center gap-1.5 p-3 rounded-md border transition-colors ${
                            isSelected ? "border-primary bg-primary/10" : "hover:bg-muted"
                          }`}
                        >
                          {char.type === "reference" && char.referenceImageUrl ? (
                            <CachedImage src={char.referenceImageUrl} alt={char.name} className="w-12 h-12 rounded object-cover" thumbnail thumbnailWidth={120} />
                          ) : (
                            <div className="w-12 h-12 rounded bg-muted flex items-center justify-center">
                              <FileText className="w-5 h-5 text-muted-foreground" />
                            </div>
                          )}
                          <span className="text-xs font-medium truncate w-full text-center">{char.name}</span>
                          <span className={`text-[9px] px-1.5 py-0.5 rounded ${
                            char.type === "reference" ? "bg-blue-500/10 text-blue-500" : "bg-orange-500/10 text-orange-500"
                          }`}>
                            {char.type === "reference" ? "ref" : "desc"}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                  {duplicateChars.length > 0 && (
                    <p className="text-[10px] text-muted-foreground mt-2">
                      Skipped {duplicateChars.length} character{duplicateChars.length !== 1 ? "s" : ""} already in current workflow: {duplicateChars.map((c) => c.name).join(", ")}
                    </p>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-4 py-3 border-t">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-xs rounded-md border hover:bg-muted transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleImport}
            disabled={selectedCharIds.size === 0}
            className="flex items-center gap-1 px-3 py-1.5 text-xs rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            <Download className="w-3 h-3" />
            Import {selectedCharIds.size > 0 ? `(${selectedCharIds.size})` : "Selected"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
