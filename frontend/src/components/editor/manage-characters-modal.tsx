"use client"

import { useState, useEffect } from "react"
import { createPortal } from "react-dom"
import { X, ImageIcon, FileText, Loader2, Download, UserPlus, Pencil, Trash2 } from "lucide-react"
import { createClient } from "@/lib/supabase"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { DefineCharacterModal } from "./define-character-modal"
import type { CharacterDefinition } from "@/types/nodes"

interface WorkflowOption {
  readonly id: string
  readonly name: string
  readonly characters: readonly CharacterDefinition[]
}

interface ManageCharactersModalProps {
  readonly isOpen: boolean
  readonly onClose: () => void
}

export function ManageCharactersModal({
  isOpen,
  onClose,
}: ManageCharactersModalProps) {
  const charDefs = useWorkflowStore((s) => s.characterDefinitions)
  const workflowId = useWorkflowStore((s) => s.workflowId)
  const addCharacterDefinition = useWorkflowStore((s) => s.addCharacterDefinition)
  const updateCharacterDefinition = useWorkflowStore((s) => s.updateCharacterDefinition)
  const removeCharacterDefinition = useWorkflowStore((s) => s.removeCharacterDefinition)

  const [showDefineModal, setShowDefineModal] = useState(false)
  const [editingChar, setEditingChar] = useState<CharacterDefinition | null>(null)
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)

  // Import section state
  const [workflows, setWorkflows] = useState<WorkflowOption[]>([])
  const [loadingWorkflows, setLoadingWorkflows] = useState(false)
  const [importError, setImportError] = useState("")
  const [selectedWorkflowId, setSelectedWorkflowId] = useState("")
  const [selectedCharIds, setSelectedCharIds] = useState<Set<string>>(new Set())
  const [showImportSection, setShowImportSection] = useState(false)

  useEffect(() => {
    if (!isOpen) {
      setShowImportSection(false)
      setSelectedWorkflowId("")
      setSelectedCharIds(new Set())
      return
    }
  }, [isOpen])

  async function loadWorkflows() {
    setLoadingWorkflows(true)
    setImportError("")
    try {
      const supabase = createClient()
      const { data, error } = await supabase
        .from("workflows")
        .select("id, name, settings")
        .order("updated_at", { ascending: false })

      if (error) {
        setImportError(error.message)
        return
      }

      const results: WorkflowOption[] = (data ?? [])
        .filter((w) => w.id !== workflowId)
        .map((w) => {
          const settings = (w.settings ?? {}) as Record<string, unknown>
          const chars = (settings.characterDefinitions ?? []) as CharacterDefinition[]
          return { id: w.id, name: w.name, characters: chars }
        })
        .filter((w) => w.characters.length > 0)

      setWorkflows(results)
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "Failed to load workflows")
    } finally {
      setLoadingWorkflows(false)
    }
  }

  if (!isOpen) return null

  const existingNames = charDefs.map((c) => c.name)
  const selectedWorkflow = workflows.find((w) => w.id === selectedWorkflowId)
  const importableChars = (selectedWorkflow?.characters ?? []).filter(
    (c) => !existingNames.includes(c.name)
  )
  const duplicateChars = (selectedWorkflow?.characters ?? []).filter(
    (c) => existingNames.includes(c.name)
  )

  function toggleImportChar(id: string) {
    setSelectedCharIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
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
    for (const c of charsToImport) {
      addCharacterDefinition(c)
    }
    setSelectedCharIds(new Set())
    setSelectedWorkflowId("")
  }

  function handleDefineOrEdit(char: CharacterDefinition) {
    if (editingChar) {
      updateCharacterDefinition(char.id, {
        name: char.name,
        type: char.type,
        referenceImageUrl: char.referenceImageUrl,
        description: char.description,
      })
      setEditingChar(null)
    } else {
      addCharacterDefinition(char)
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/50"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="bg-background border rounded-lg shadow-xl w-full max-w-xl mx-4"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <h3 className="text-sm font-semibold">Manage Characters</h3>
          <button type="button" onClick={onClose} className="p-1 rounded-md hover:bg-muted">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-4 flex flex-col gap-4 max-h-[500px] overflow-y-auto">
          {/* Current workflow characters */}
          <div>
            <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
              Characters in this workflow
            </label>
            {charDefs.length === 0 ? (
              <p className="text-xs text-muted-foreground mt-2">No characters defined yet.</p>
            ) : (
              <div className="grid grid-cols-3 gap-2 mt-2">
                {charDefs.map((char) => (
                  <div
                    key={char.id}
                    className="flex flex-col items-center gap-1.5 p-3 rounded-md border bg-muted/20 relative group"
                  >
                    {char.type === "reference" && char.referenceImageUrl ? (
                      <img src={char.referenceImageUrl} alt={char.name} className="w-14 h-14 rounded object-cover" />
                    ) : (
                      <div className="w-14 h-14 rounded bg-muted flex items-center justify-center">
                        <FileText className="w-6 h-6 text-orange-500" />
                      </div>
                    )}
                    <span className="text-xs font-medium truncate w-full text-center">{char.name}</span>
                    <span className={`text-[9px] px-1.5 py-0.5 rounded ${
                      char.type === "reference" ? "bg-blue-500/10 text-blue-500" : "bg-orange-500/10 text-orange-500"
                    }`}>
                      {char.type === "reference" ? "reference" : "description"}
                    </span>
                    {char.type === "description" && char.description && (
                      <p className="text-[9px] text-muted-foreground text-center line-clamp-2 w-full">{char.description}</p>
                    )}
                    {char.importedFrom && (
                      <p className="text-[8px] text-muted-foreground/60 text-center">from: {char.importedFrom.workflowName}</p>
                    )}
                    {/* Action buttons */}
                    <div className="flex gap-1 mt-1">
                      <button
                        type="button"
                        onClick={() => { setEditingChar(char); setShowDefineModal(true) }}
                        className="p-1 rounded hover:bg-muted transition-colors"
                        title="Edit"
                      >
                        <Pencil className="w-3 h-3 text-muted-foreground" />
                      </button>
                      {deleteConfirmId === char.id ? (
                        <div className="flex gap-0.5">
                          <button
                            type="button"
                            onClick={() => { removeCharacterDefinition(char.id); setDeleteConfirmId(null) }}
                            className="px-1.5 py-0.5 text-[9px] rounded bg-destructive text-destructive-foreground"
                          >
                            Delete
                          </button>
                          <button
                            type="button"
                            onClick={() => setDeleteConfirmId(null)}
                            className="px-1.5 py-0.5 text-[9px] rounded border"
                          >
                            No
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setDeleteConfirmId(char.id)}
                          className="p-1 rounded hover:bg-destructive/10 transition-colors"
                          title="Delete"
                        >
                          <Trash2 className="w-3 h-3 text-muted-foreground" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
            <button
              type="button"
              onClick={() => { setEditingChar(null); setShowDefineModal(true) }}
              className="flex items-center gap-1 px-2.5 py-1.5 text-xs rounded-md border border-dashed hover:bg-muted transition-colors mt-2"
            >
              <UserPlus className="w-3.5 h-3.5" /> Define new character
            </button>
          </div>

          {/* Separator */}
          <div className="border-t" />

          {/* Import section */}
          <div>
            {!showImportSection ? (
              <button
                type="button"
                onClick={() => { setShowImportSection(true); loadWorkflows() }}
                className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-md border hover:bg-muted transition-colors"
              >
                <Download className="w-3.5 h-3.5" /> Import from another workflow
              </button>
            ) : (
              <div className="flex flex-col gap-3">
                <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
                  Import from another workflow
                </label>

                {loadingWorkflows && (
                  <div className="flex items-center justify-center py-4">
                    <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                  </div>
                )}

                {importError && <p className="text-xs text-destructive">{importError}</p>}

                {!loadingWorkflows && workflows.length === 0 && !importError && (
                  <p className="text-xs text-muted-foreground">No other workflows with characters found.</p>
                )}

                {!loadingWorkflows && workflows.length > 0 && (
                  <>
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
                          {w.name} ({w.characters.length} char{w.characters.length !== 1 ? "s" : ""})
                        </option>
                      ))}
                    </select>

                    {selectedWorkflow && (
                      <div>
                        {importableChars.length === 0 ? (
                          <p className="text-xs text-muted-foreground">All characters already exist in current workflow.</p>
                        ) : (
                          <>
                            <div className="grid grid-cols-3 gap-2">
                              {importableChars.map((char) => {
                                const isSelected = selectedCharIds.has(char.id)
                                return (
                                  <button
                                    key={char.id}
                                    type="button"
                                    onClick={() => toggleImportChar(char.id)}
                                    className={`flex flex-col items-center gap-1 p-2 rounded-md border transition-colors ${
                                      isSelected ? "border-primary bg-primary/10" : "hover:bg-muted"
                                    }`}
                                  >
                                    {char.type === "reference" && char.referenceImageUrl ? (
                                      <img src={char.referenceImageUrl} alt={char.name} className="w-10 h-10 rounded object-cover" />
                                    ) : (
                                      <div className="w-10 h-10 rounded bg-muted flex items-center justify-center">
                                        <FileText className="w-4 h-4 text-orange-500" />
                                      </div>
                                    )}
                                    <span className="text-[10px] font-medium truncate w-full text-center">{char.name}</span>
                                    <span className={`text-[8px] px-1 py-0.5 rounded ${
                                      char.type === "reference" ? "bg-blue-500/10 text-blue-500" : "bg-orange-500/10 text-orange-500"
                                    }`}>
                                      {char.type === "reference" ? "ref" : "desc"}
                                    </span>
                                  </button>
                                )
                              })}
                            </div>
                            {selectedCharIds.size > 0 && (
                              <button
                                type="button"
                                onClick={handleImport}
                                className="flex items-center gap-1 px-2.5 py-1.5 text-xs rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors mt-2"
                              >
                                <Download className="w-3 h-3" />
                                Import {selectedCharIds.size} character{selectedCharIds.size !== 1 ? "s" : ""}
                              </button>
                            )}
                          </>
                        )}
                        {duplicateChars.length > 0 && (
                          <p className="text-[10px] text-muted-foreground mt-1">
                            Skipped: {duplicateChars.map((c) => c.name).join(", ")} (already exist)
                          </p>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end px-4 py-3 border-t">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-xs rounded-md border hover:bg-muted transition-colors"
          >
            Close
          </button>
        </div>
      </div>

      <DefineCharacterModal
        isOpen={showDefineModal}
        onClose={() => { setShowDefineModal(false); setEditingChar(null) }}
        onSave={handleDefineOrEdit}
        existingNames={existingNames}
        editingCharacter={editingChar}
      />
    </div>,
    document.body,
  )
}
