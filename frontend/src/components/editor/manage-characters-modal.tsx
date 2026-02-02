"use client"

import { useState, useEffect } from "react"
import { createPortal } from "react-dom"
import { X, FileText, Loader2, Download, UserPlus, Pencil, Trash2, Users, FolderOpen, MapPin, Box } from "lucide-react"
import { createClient } from "@/lib/supabase"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { DefineCharacterModal } from "./define-character-modal"
import type { CharacterDefinition } from "@/types/nodes"

interface ProjectOption {
  readonly id: string
  readonly name: string
}

interface WorkflowWithChars {
  readonly id: string
  readonly name: string
  readonly characters: readonly CharacterDefinition[]
}

interface GroupedProjectChars {
  readonly projectId: string
  readonly projectName: string
  readonly characters: readonly (CharacterDefinition & {
    readonly _workflowId: string
    readonly _workflowName: string
  })[]
}

type FilterType = "all" | "character" | "location" | "object"

interface ImportAssetsModalProps {
  readonly isOpen: boolean
  readonly onClose: () => void
  readonly onImported?: (ids: string[]) => void
}

export function ImportAssetsModal({
  isOpen,
  onClose,
  onImported,
}: ImportAssetsModalProps) {
  const charDefs = useWorkflowStore((s) => s.characterDefinitions)
  const workflowId = useWorkflowStore((s) => s.workflowId)
  const addCharacterDefinition = useWorkflowStore((s) => s.addCharacterDefinition)
  const updateCharacterDefinition = useWorkflowStore((s) => s.updateCharacterDefinition)
  const removeCharacterDefinition = useWorkflowStore((s) => s.removeCharacterDefinition)

  const [showDefineModal, setShowDefineModal] = useState(false)
  const [editingChar, setEditingChar] = useState<CharacterDefinition | null>(null)
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)

  const [filter, setFilter] = useState<FilterType>("all")

  // Import section state
  const [showImportSection, setShowImportSection] = useState(false)
  const [importLoading, setImportLoading] = useState(false)
  const [importError, setImportError] = useState("")
  const [selectedCharIds, setSelectedCharIds] = useState<Set<string>>(new Set())

  // Browse by project mode
  const [projects, setProjects] = useState<ProjectOption[]>([])
  const [selectedProjectId, setSelectedProjectId] = useState("")
  const [projectWorkflows, setProjectWorkflows] = useState<WorkflowWithChars[]>([])
  const [selectedWorkflowId, setSelectedWorkflowId] = useState("")
  const [loadingWorkflows, setLoadingWorkflows] = useState(false)

  // Show all mode
  const [showAllMode, setShowAllMode] = useState(false)
  const [allGrouped, setAllGrouped] = useState<GroupedProjectChars[]>([])
  const [loadingAll, setLoadingAll] = useState(false)

  useEffect(() => {
    if (!isOpen) {
      setFilter("all")
      setShowImportSection(false)
      setSelectedProjectId("")
      setSelectedWorkflowId("")
      setSelectedCharIds(new Set())
      setShowAllMode(false)
      setProjects([])
      setProjectWorkflows([])
      setAllGrouped([])
      return
    }
  }, [isOpen])

  async function loadProjects() {
    setImportLoading(true)
    setImportError("")
    try {
      const supabase = createClient()
      const { data, error } = await supabase
        .from("projects")
        .select("id, name")
        .order("updated_at", { ascending: false })

      if (error) {
        setImportError(error.message)
        return
      }
      setProjects(data ?? [])
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "Failed to load projects")
    } finally {
      setImportLoading(false)
    }
  }

  async function loadProjectWorkflows(projectId: string) {
    setLoadingWorkflows(true)
    setImportError("")
    try {
      const supabase = createClient()
      const { data, error } = await supabase
        .from("workflows")
        .select("id, name, settings")
        .eq("project_id", projectId)
        .order("updated_at", { ascending: false })

      if (error) {
        setImportError(error.message)
        return
      }

      const results: WorkflowWithChars[] = (data ?? [])
        .filter((w) => w.id !== workflowId)
        .map((w) => {
          const settings = (w.settings ?? {}) as Record<string, unknown>
          const chars = (settings.characterDefinitions ?? []) as CharacterDefinition[]
          return { id: w.id, name: w.name, characters: chars }
        })
        .filter((w) => w.characters.length > 0)

      setProjectWorkflows(results)
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "Failed to load workflows")
    } finally {
      setLoadingWorkflows(false)
    }
  }

  async function loadAllCharacters() {
    setLoadingAll(true)
    setImportError("")
    try {
      const supabase = createClient()
      const { data, error } = await supabase
        .from("workflows")
        .select("id, name, settings, projects(id, name)")
        .order("updated_at", { ascending: false })

      if (error) {
        setImportError(error.message)
        return
      }

      const groupMap = new Map<string, GroupedProjectChars & { characters: (CharacterDefinition & { _workflowId: string; _workflowName: string })[] }>()

      for (const w of data ?? []) {
        if (w.id === workflowId) continue
        const settings = (w.settings ?? {}) as Record<string, unknown>
        const chars = (settings.characterDefinitions ?? []) as CharacterDefinition[]
        if (chars.length === 0) continue

        const project = w.projects as unknown as { id: string; name: string } | null
        const pid = project?.id ?? "unknown"
        const pname = project?.name ?? "Unknown Project"

        if (!groupMap.has(pid)) {
          groupMap.set(pid, { projectId: pid, projectName: pname, characters: [] })
        }
        const group = groupMap.get(pid)!
        for (const c of chars) {
          group.characters.push({ ...c, _workflowId: w.id, _workflowName: w.name })
        }
      }

      setAllGrouped(Array.from(groupMap.values()))
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "Failed to load characters")
    } finally {
      setLoadingAll(false)
    }
  }

  if (!isOpen) return null

  const existingNames = charDefs.map((c) => c.name)

  // For browse-by-project mode
  const selectedWorkflow = projectWorkflows.find((w) => w.id === selectedWorkflowId)
  const browseImportable = (selectedWorkflow?.characters ?? []).filter(
    (c) => !existingNames.includes(c.name)
  )
  const browseDuplicates = (selectedWorkflow?.characters ?? []).filter(
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

  function handleImportFromBrowse() {
    if (!selectedWorkflow) return
    const importedIds: string[] = []
    const charsToImport = browseImportable
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
      importedIds.push(c.id)
    }
    onImported?.(importedIds)
    setSelectedCharIds(new Set())
    setSelectedWorkflowId("")
  }

  function handleImportFromAll() {
    const allChars = allGrouped.flatMap((g) => g.characters)
    const selected = allChars.filter((c) => selectedCharIds.has(c.id) && !existingNames.includes(c.name))
    const importedIds: string[] = []
    for (const c of selected) {
      const newId = crypto.randomUUID()
      const charData: CharacterDefinition = {
        id: newId,
        name: c.name,
        type: c.type,
        category: c.category,
        ...(c.referenceImageUrl ? { referenceImageUrl: c.referenceImageUrl } : {}),
        ...(c.description ? { description: c.description } : {}),
        importedFrom: {
          workflowId: c._workflowId,
          workflowName: c._workflowName,
        },
      }
      addCharacterDefinition(charData)
      importedIds.push(newId)
    }
    onImported?.(importedIds)
    setSelectedCharIds(new Set())
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

  function renderCharCard(
    char: CharacterDefinition & { _workflowName?: string },
    opts?: { showWorkflow?: boolean },
  ) {
    const isSelected = selectedCharIds.has(char.id)
    const isDuplicate = existingNames.includes(char.name)
    return (
      <button
        key={char.id}
        type="button"
        onClick={() => !isDuplicate && toggleImportChar(char.id)}
        disabled={isDuplicate}
        className={`flex flex-col items-center gap-1 p-2 rounded-md border transition-colors ${
          isDuplicate
            ? "opacity-40 cursor-not-allowed"
            : isSelected
              ? "border-primary bg-primary/10"
              : "hover:bg-muted"
        }`}
      >
        {char.referenceImageUrl ? (
          <img src={char.referenceImageUrl} alt={char.name} className="w-12 h-12 rounded object-cover" />
        ) : (
          <div className="w-12 h-12 rounded bg-muted flex items-center justify-center">
            <FileText className="w-4 h-4 text-orange-500" />
          </div>
        )}
        <span className="text-[10px] font-medium truncate w-full text-center">{char.name}</span>
        <span className={`text-[8px] px-1 py-0.5 rounded ${
          char.referenceImageUrl ? "bg-blue-500/10 text-blue-500" : "bg-orange-500/10 text-orange-500"
        }`}>
          {char.referenceImageUrl ? "ref" : "desc"}
        </span>
        {isDuplicate && (
          <span className="text-[8px] text-muted-foreground">already exists</span>
        )}
        {opts?.showWorkflow && char._workflowName && (
          <span className="text-[8px] text-muted-foreground/60 truncate w-full text-center">{char._workflowName}</span>
        )}
      </button>
    )
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/50"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="bg-background border rounded-lg shadow-xl w-full max-w-2xl mx-4"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <h3 className="text-sm font-semibold">Import Assets</h3>
          <button type="button" onClick={onClose} className="p-1 rounded-md hover:bg-muted">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Filter buttons */}
        <div className="flex gap-1 px-4 pt-3">
          {(["all", "character", "location", "object"] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={`px-2.5 py-1 text-[10px] font-medium rounded-full border transition-colors ${
                filter === f ? "border-primary bg-primary/10 text-primary" : "hover:bg-muted"
              }`}
            >
              {f === "all" ? "All" : f === "character" ? "Characters" : f === "location" ? "Locations" : "Objects"}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="p-4 flex flex-col gap-4 max-h-[550px] overflow-y-auto">
          {/* Current workflow assets */}
          {(() => {
            const filtered = filter === "all"
              ? charDefs
              : charDefs.filter((c) => (c.category ?? "character") === filter)

            function renderRefGrid(items: readonly CharacterDefinition[]) {
              if (items.length === 0) return <p className="text-xs text-muted-foreground mt-1">None defined yet.</p>
              return (
                <div className="grid grid-cols-3 gap-2 mt-1">
                  {items.map((char) => (
                    <div
                      key={char.id}
                      className="flex flex-col items-center gap-1.5 p-3 rounded-md border bg-muted/20 relative group"
                    >
                      {char.referenceImageUrl ? (
                        <img src={char.referenceImageUrl} alt={char.name} className="w-14 h-14 rounded object-cover" />
                      ) : (
                        <div className="w-14 h-14 rounded bg-muted flex items-center justify-center">
                          <FileText className="w-6 h-6 text-orange-500" />
                        </div>
                      )}
                      <span className="text-xs font-medium truncate w-full text-center">{char.name}</span>
                      {!char.referenceImageUrl && char.description && (
                        <p className="text-[9px] text-muted-foreground text-center line-clamp-2 w-full">{char.description}</p>
                      )}
                      {char.importedFrom && (
                        <p className="text-[8px] text-muted-foreground/60 text-center">from: {char.importedFrom.workflowName}</p>
                      )}
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
              )
            }

            // Group by category for display
            const characters = filtered.filter((c) => !c.category || c.category === "character")
            const locations = filtered.filter((c) => c.category === "location")
            const objectDefs = filtered.filter((c) => c.category === "object")

            return (
              <div className="flex flex-col gap-3">
                <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
                  Assets in this workflow
                </label>

                {filter === "all" || filter === "character" ? (
                  <div>
                    {filter === "all" && <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1"><UserPlus className="w-3 h-3" /> Characters</label>}
                    {renderRefGrid(characters)}
                    <button
                      type="button"
                      onClick={() => { setEditingChar(null); setShowDefineModal(true) }}
                      className="flex items-center gap-1 px-2.5 py-1.5 text-xs rounded-md border border-dashed hover:bg-muted transition-colors mt-2"
                    >
                      <UserPlus className="w-3.5 h-3.5" /> Define new character
                    </button>
                  </div>
                ) : null}

                {(filter === "all" || filter === "location") && locations.length > 0 && (
                  <div>
                    {filter === "all" && <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1"><MapPin className="w-3 h-3" /> Locations</label>}
                    {renderRefGrid(locations)}
                  </div>
                )}

                {(filter === "all" || filter === "object") && objectDefs.length > 0 && (
                  <div>
                    {filter === "all" && <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1"><Box className="w-3 h-3" /> Objects</label>}
                    {renderRefGrid(objectDefs)}
                  </div>
                )}

                {filter !== "all" && filter !== "character" && filtered.length === 0 && (
                  <p className="text-xs text-muted-foreground">No {filter}s defined yet. Extract them from generated images.</p>
                )}
              </div>
            )
          })()}

          {/* Separator */}
          <div className="border-t" />

          {/* Import section */}
          <div>
            {!showImportSection ? (
              <button
                type="button"
                onClick={() => { setShowImportSection(true); loadProjects() }}
                className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-md border hover:bg-muted transition-colors"
              >
                <Download className="w-3.5 h-3.5" /> Import from another project/workflow
              </button>
            ) : (
              <div className="flex flex-col gap-3">
                <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
                  Import from another project/workflow
                </label>

                {importLoading && (
                  <div className="flex items-center justify-center py-4">
                    <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                  </div>
                )}

                {importError && <p className="text-xs text-destructive">{importError}</p>}

                {!importLoading && (
                  <>
                    {/* Mode toggle */}
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setShowAllMode(true)
                          setSelectedCharIds(new Set())
                          if (allGrouped.length === 0) loadAllCharacters()
                        }}
                        className={`flex items-center gap-1 px-2.5 py-1.5 text-xs rounded-md border transition-colors ${
                          showAllMode ? "border-primary bg-primary/10 text-primary" : "hover:bg-muted"
                        }`}
                      >
                        <Users className="w-3 h-3" /> Show all my assets
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setShowAllMode(false)
                          setSelectedCharIds(new Set())
                        }}
                        className={`flex items-center gap-1 px-2.5 py-1.5 text-xs rounded-md border transition-colors ${
                          !showAllMode ? "border-primary bg-primary/10 text-primary" : "hover:bg-muted"
                        }`}
                      >
                        <FolderOpen className="w-3 h-3" /> Browse by project
                      </button>
                    </div>

                    {/* Show All Mode */}
                    {showAllMode && (
                      <div className="flex flex-col gap-3">
                        {loadingAll && (
                          <div className="flex items-center justify-center py-4">
                            <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                          </div>
                        )}
                        {!loadingAll && allGrouped.length === 0 && (
                          <p className="text-xs text-muted-foreground">No assets found in other workflows.</p>
                        )}
                        {!loadingAll && allGrouped.map((group) => (
                          <div key={group.projectId}>
                            <label className="text-[10px] font-semibold text-muted-foreground block mb-1">
                              {group.projectName}
                            </label>
                            <div className="grid grid-cols-4 gap-2">
                              {group.characters.map((char) =>
                                renderCharCard(char, { showWorkflow: true })
                              )}
                            </div>
                          </div>
                        ))}
                        {!loadingAll && selectedCharIds.size > 0 && (
                          <button
                            type="button"
                            onClick={handleImportFromAll}
                            className="flex items-center gap-1 px-2.5 py-1.5 text-xs rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                          >
                            <Download className="w-3 h-3" />
                            Import selected ({selectedCharIds.size})
                          </button>
                        )}
                      </div>
                    )}

                    {/* Browse by Project Mode */}
                    {!showAllMode && (
                      <div className="flex flex-col gap-3">
                        {projects.length === 0 && !importLoading && (
                          <p className="text-xs text-muted-foreground">No projects found.</p>
                        )}

                        {projects.length > 0 && (
                          <>
                            {/* Project dropdown */}
                            <div>
                              <label className="text-[10px] font-medium text-muted-foreground block mb-1">Project</label>
                              <select
                                value={selectedProjectId}
                                onChange={(e) => {
                                  setSelectedProjectId(e.target.value)
                                  setSelectedWorkflowId("")
                                  setSelectedCharIds(new Set())
                                  setProjectWorkflows([])
                                  if (e.target.value) loadProjectWorkflows(e.target.value)
                                }}
                                className="w-full px-3 py-2 text-sm border rounded-md bg-background focus:outline-none focus:ring-1 focus:ring-primary"
                              >
                                <option value="">Select project...</option>
                                {projects.map((p) => (
                                  <option key={p.id} value={p.id}>{p.name}</option>
                                ))}
                              </select>
                            </div>

                            {/* Workflow dropdown */}
                            {selectedProjectId && (
                              <div>
                                <label className="text-[10px] font-medium text-muted-foreground block mb-1">Workflow</label>
                                {loadingWorkflows ? (
                                  <div className="flex items-center justify-center py-2">
                                    <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                                  </div>
                                ) : projectWorkflows.length === 0 ? (
                                  <p className="text-xs text-muted-foreground">No workflows with assets in this project.</p>
                                ) : (
                                  <select
                                    value={selectedWorkflowId}
                                    onChange={(e) => {
                                      setSelectedWorkflowId(e.target.value)
                                      setSelectedCharIds(new Set())
                                    }}
                                    className="w-full px-3 py-2 text-sm border rounded-md bg-background focus:outline-none focus:ring-1 focus:ring-primary"
                                  >
                                    <option value="">Select workflow...</option>
                                    {projectWorkflows.map((w) => (
                                      <option key={w.id} value={w.id}>
                                        {w.name} ({w.characters.length} char{w.characters.length !== 1 ? "s" : ""})
                                      </option>
                                    ))}
                                  </select>
                                )}
                              </div>
                            )}

                            {/* Character grid */}
                            {selectedWorkflow && (
                              <div>
                                {browseImportable.length === 0 ? (
                                  <p className="text-xs text-muted-foreground">All assets already exist in current workflow.</p>
                                ) : (
                                  <>
                                    <div className="grid grid-cols-4 gap-2">
                                      {browseImportable.map((char) => renderCharCard(char))}
                                    </div>
                                    {selectedCharIds.size > 0 && (
                                      <button
                                        type="button"
                                        onClick={handleImportFromBrowse}
                                        className="flex items-center gap-1 px-2.5 py-1.5 text-xs rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors mt-2"
                                      >
                                        <Download className="w-3 h-3" />
                                        Import selected ({selectedCharIds.size})
                                      </button>
                                    )}
                                  </>
                                )}
                                {browseDuplicates.length > 0 && (
                                  <p className="text-[10px] text-muted-foreground mt-1">
                                    Skipped: {browseDuplicates.map((c) => c.name).join(", ")} (already exist)
                                  </p>
                                )}
                              </div>
                            )}
                          </>
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
