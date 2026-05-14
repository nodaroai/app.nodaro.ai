// Admin → Tutorials. Two tabs sharing the page chrome:
//
//   Video Tutorials — CRUD over the `tutorials` table. Category is a
//                     dropdown of enabled tutorial_categories (Part 1 swapped
//                     the column from free-text to a uuid FK).
//   Flow Tutorials  — list + manage workflow_templates flagged with 'tutorial'
//                     in listed_in[]. Add flow = pick any template across the
//                     cross-user admin endpoint, then attach category + sort.
//
// The "Add Flow Tutorial" flow is a 2-step modal: pick template → set
// category + sort_order. Edit + Unmark reuse the same step-2 form.

import { useState, useMemo, useEffect } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { Link } from "react-router-dom"
import {
  Plus,
  Pencil,
  Trash2,
  ExternalLink,
  ArrowLeft,
  Search,
  Loader2,
  Zap,
  Tag,
  Layers,
  PlayCircle,
} from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { queryKeys } from "@/lib/query-keys"
import {
  fetchAdminTutorials,
  createTutorial,
  updateTutorial,
  deleteTutorial,
  listAdminWorkflowTemplates,
  type AdminTutorial,
  type AdminWorkflowTemplateRow,
  type TutorialCategory,
} from "@/lib/api"
import {
  useAdminTutorialCategories,
  useEnabledTutorialCategories,
} from "@/ee/hooks/queries/use-admin-tutorial-categories"
import {
  useAdminFlowTutorials,
  useToggleTutorialFlag,
} from "@/ee/hooks/queries/use-admin-flow-tutorials"
import { COMPLEXITY_CONFIG, type Complexity } from "@/lib/template-utils"
import { cn } from "@/lib/utils"

// ===========================================================================
// VIDEO TUTORIALS TAB
// ===========================================================================

interface VideoTutorialForm {
  title: string
  videoUrl: string
  description: string
  thumbnailUrl: string
  categoryId: string
  sortOrder: number
  isEnabled: boolean
}

const emptyVideoForm: VideoTutorialForm = {
  title: "",
  videoUrl: "",
  description: "",
  thumbnailUrl: "",
  categoryId: "",
  sortOrder: 0,
  isEnabled: true,
}

function VideoTutorialsTab() {
  const queryClient = useQueryClient()
  const enabledCategories = useEnabledTutorialCategories()
  const allCategories = useAdminTutorialCategories().data ?? []

  // Map for label lookups (use ALL categories so we can label rows whose
  // category is currently disabled — they still belong somewhere).
  const categoryById = useMemo(
    () => new Map(allCategories.map((c) => [c.id, c])),
    [allCategories],
  )

  const { data: tutorials = [], isLoading } = useQuery({
    queryKey: queryKeys.admin.tutorials(),
    queryFn: fetchAdminTutorials,
    staleTime: 30_000,
  })

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<VideoTutorialForm>(emptyVideoForm)
  const [deleteId, setDeleteId] = useState<string | null>(null)

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.admin.tutorials() })
    queryClient.invalidateQueries({ queryKey: queryKeys.tutorials.all })
  }

  const createMutation = useMutation({
    mutationFn: (data: VideoTutorialForm) =>
      createTutorial({
        title: data.title,
        video_url: data.videoUrl,
        description: data.description || undefined,
        thumbnail_url: data.thumbnailUrl || undefined,
        category_id: data.categoryId,
        sort_order: data.sortOrder,
        is_enabled: data.isEnabled,
      }),
    onSuccess: () => {
      invalidate()
      setDialogOpen(false)
      toast.success("Tutorial created")
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: VideoTutorialForm }) =>
      updateTutorial(id, {
        title: data.title,
        video_url: data.videoUrl,
        description: data.description || null,
        thumbnail_url: data.thumbnailUrl || null,
        category_id: data.categoryId,
        sort_order: data.sortOrder,
        is_enabled: data.isEnabled,
      }),
    onSuccess: () => {
      invalidate()
      setDialogOpen(false)
      toast.success("Tutorial updated")
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const toggleMutation = useMutation({
    mutationFn: ({ id, is_enabled }: { id: string; is_enabled: boolean }) =>
      updateTutorial(id, { is_enabled }),
    onMutate: async ({ id, is_enabled }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.admin.tutorials() })
      const prev = queryClient.getQueryData<AdminTutorial[]>(queryKeys.admin.tutorials())
      queryClient.setQueryData<AdminTutorial[]>(queryKeys.admin.tutorials(), (old) =>
        old?.map((t) => (t.id === id ? { ...t, isEnabled: is_enabled } : t)),
      )
      return { prev }
    },
    onError: (_err, _vars, context) => {
      if (context?.prev) {
        queryClient.setQueryData(queryKeys.admin.tutorials(), context.prev)
      }
      toast.error("Failed to update")
    },
    onSettled: () => invalidate(),
  })

  const deleteMutation = useMutation({
    mutationFn: deleteTutorial,
    onSuccess: () => {
      invalidate()
      setDeleteId(null)
      toast.success("Tutorial deleted")
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const openCreate = () => {
    setEditingId(null)
    setForm({
      ...emptyVideoForm,
      categoryId: enabledCategories[0]?.id ?? "",
    })
    setDialogOpen(true)
  }

  const openEdit = (t: AdminTutorial) => {
    setEditingId(t.id)
    setForm({
      title: t.title,
      videoUrl: t.videoUrl,
      description: t.description ?? "",
      thumbnailUrl: t.thumbnailUrl ?? "",
      categoryId: t.categoryId,
      sortOrder: t.sortOrder,
      isEnabled: t.isEnabled,
    })
    setDialogOpen(true)
  }

  const handleSubmit = () => {
    if (!form.title || !form.videoUrl || !form.categoryId) {
      toast.error("Title, video URL, and category are required")
      return
    }
    if (editingId) {
      updateMutation.mutate({ id: editingId, data: form })
    } else {
      createMutation.mutate(form)
    }
  }

  const isSaving = createMutation.isPending || updateMutation.isPending
  const noCategories = enabledCategories.length === 0

  return (
    <div>
      {noCategories && (
        <div className="mb-4 p-3 rounded-lg border border-amber-300/50 bg-amber-50/50 dark:bg-amber-500/10 text-sm">
          <p className="font-medium text-amber-900 dark:text-amber-300">
            No categories yet
          </p>
          <p className="text-xs text-amber-900/80 dark:text-amber-300/80 mt-1">
            Tutorials must belong to a category.{" "}
            <Link to="/admin/tutorial-categories" className="underline font-medium">
              Create one in Tutorial Categories
            </Link>{" "}
            first.
          </p>
        </div>
      )}

      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-muted-foreground">
          Step-by-step videos surfaced in the dashboard Tutorials tab.
        </p>
        <Button size="sm" onClick={openCreate} disabled={noCategories}>
          <Plus className="h-4 w-4 mr-1" /> Add Tutorial
        </Button>
      </div>

      {isLoading ? (
        <div className="text-sm text-muted-foreground">Loading...</div>
      ) : tutorials.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground border rounded-lg">
          <PlayCircle className="h-8 w-8 mx-auto mb-2 opacity-40" />
          <p className="text-sm">No tutorials yet. Click "Add Tutorial" to create one.</p>
        </div>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="text-left px-4 py-2 font-medium">Title</th>
                <th className="text-left px-4 py-2 font-medium">Category</th>
                <th className="text-left px-4 py-2 font-medium hidden md:table-cell">Video URL</th>
                <th className="text-center px-4 py-2 font-medium w-20">Order</th>
                <th className="text-center px-4 py-2 font-medium w-20">Enabled</th>
                <th className="text-right px-4 py-2 font-medium w-24">Actions</th>
              </tr>
            </thead>
            <tbody>
              {tutorials.map((t) => {
                const cat = categoryById.get(t.categoryId)
                return (
                  <tr key={t.id} className="border-b last:border-b-0 hover:bg-muted/30">
                    <td className="px-4 py-2 font-medium">{t.title}</td>
                    <td className="px-4 py-2 text-muted-foreground">
                      {cat ? cat.name : <span className="text-destructive">Unknown</span>}
                    </td>
                    <td className="px-4 py-2 text-muted-foreground hidden md:table-cell">
                      <a
                        href={t.videoUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 hover:text-foreground truncate max-w-[200px]"
                      >
                        {t.videoUrl.length > 40 ? `${t.videoUrl.slice(0, 40)}...` : t.videoUrl}
                        <ExternalLink className="h-3 w-3 flex-shrink-0" />
                      </a>
                    </td>
                    <td className="px-4 py-2 text-center">{t.sortOrder}</td>
                    <td className="px-4 py-2 text-center">
                      <Switch
                        checked={t.isEnabled}
                        onCheckedChange={() => toggleMutation.mutate({ id: t.id, is_enabled: !t.isEnabled })}
                      />
                    </td>
                    <td className="px-4 py-2 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => openEdit(t)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0 text-destructive"
                          onClick={() => setDeleteId(t.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Add/edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit Tutorial" : "Add Tutorial"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Title</Label>
              <Input
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder="Getting started with workflows"
              />
            </div>
            <div>
              <Label>Video URL</Label>
              <Input
                value={form.videoUrl}
                onChange={(e) => setForm({ ...form, videoUrl: e.target.value })}
                placeholder="https://youtube.com/watch?v=..."
              />
            </div>
            <div>
              <Label>Description (optional)</Label>
              <Input
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="Short description of the tutorial"
              />
            </div>
            <div>
              <Label>Thumbnail URL (optional)</Label>
              <Input
                value={form.thumbnailUrl}
                onChange={(e) => setForm({ ...form, thumbnailUrl: e.target.value })}
                placeholder="https://... (auto-detected from YouTube if empty)"
              />
            </div>
            <div>
              <Label>Category</Label>
              <Select
                value={form.categoryId}
                onValueChange={(v) => setForm({ ...form, categoryId: v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Pick a category" />
                </SelectTrigger>
                <SelectContent>
                  {enabledCategories.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-4">
              <div className="flex-1">
                <Label>Sort Order</Label>
                <Input
                  type="number"
                  value={form.sortOrder}
                  onChange={(e) =>
                    setForm({ ...form, sortOrder: parseInt(e.target.value) || 0 })
                  }
                />
              </div>
              <div className="flex items-center gap-2 pt-5">
                <Switch
                  checked={form.isEnabled}
                  onCheckedChange={(checked) => setForm({ ...form, isEnabled: checked })}
                />
                <Label>Enabled</Label>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={!form.title || !form.videoUrl || !form.categoryId || isSaving}
            >
              {isSaving ? "Saving..." : editingId ? "Update" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteId} onOpenChange={(open) => { if (!open) setDeleteId(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Tutorial</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this tutorial? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => { if (deleteId) deleteMutation.mutate(deleteId) }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// ===========================================================================
// FLOW TUTORIALS TAB
// ===========================================================================

interface FlowAttachForm {
  templateId: string
  templateName: string
  categoryId: string
  sortOrder: number
}

function FlowTutorialsTab() {
  const enabledCategories = useEnabledTutorialCategories()
  const allCategories = useAdminTutorialCategories().data ?? []
  const categoryById = useMemo(
    () => new Map(allCategories.map((c) => [c.id, c])),
    [allCategories],
  )

  const { flows, isLoading } = useAdminFlowTutorials()
  const toggleFlag = useToggleTutorialFlag()

  // Picker / form state
  const [pickerOpen, setPickerOpen] = useState(false)
  const [step, setStep] = useState<1 | 2>(1)
  const [pickerSearch, setPickerSearch] = useState("")
  const [pickedTemplate, setPickedTemplate] = useState<AdminWorkflowTemplateRow | null>(null)
  const [attachForm, setAttachForm] = useState<FlowAttachForm | null>(null)

  // Inline-edit (existing flow's category + sort)
  const [editingFlow, setEditingFlow] = useState<AdminWorkflowTemplateRow | null>(null)
  const [editForm, setEditForm] = useState<{ categoryId: string; sortOrder: number } | null>(null)

  // Unmark confirm
  const [unmarkTarget, setUnmarkTarget] = useState<AdminWorkflowTemplateRow | null>(null)

  // Group flows by category for display
  const flowsByCategory = useMemo(() => {
    const map = new Map<string, AdminWorkflowTemplateRow[]>()
    for (const f of flows) {
      if (!f.tutorialCategoryId) continue
      const list = map.get(f.tutorialCategoryId) ?? []
      list.push(f)
      map.set(f.tutorialCategoryId, list)
    }
    return map
  }, [flows])

  const noCategories = enabledCategories.length === 0

  // -------- Add flow flow (step 1: picker) --------
  const openAdd = () => {
    setStep(1)
    setPickerSearch("")
    setPickedTemplate(null)
    setAttachForm(null)
    setPickerOpen(true)
  }

  const selectTemplate = (t: AdminWorkflowTemplateRow) => {
    setPickedTemplate(t)
    setAttachForm({
      templateId: t.id,
      templateName: t.name,
      categoryId: enabledCategories[0]?.id ?? "",
      sortOrder: 0,
    })
    setStep(2)
  }

  const handleAttach = () => {
    if (!attachForm || !attachForm.categoryId) {
      toast.error("Pick a category")
      return
    }
    toggleFlag.mutate(
      {
        templateId: attachForm.templateId,
        isTutorial: true,
        tutorialCategoryId: attachForm.categoryId,
        tutorialSortOrder: attachForm.sortOrder,
      },
      {
        onSuccess: () => {
          setPickerOpen(false)
          toast.success("Template flagged as tutorial")
        },
        onError: (err: Error) => toast.error(err.message),
      },
    )
  }

  // -------- Edit existing flow (category + sort_order) --------
  const openEdit = (f: AdminWorkflowTemplateRow) => {
    setEditingFlow(f)
    setEditForm({
      categoryId: f.tutorialCategoryId ?? "",
      sortOrder: f.tutorialSortOrder,
    })
  }

  const handleEdit = () => {
    if (!editingFlow || !editForm) return
    if (!editForm.categoryId) {
      toast.error("Pick a category")
      return
    }
    toggleFlag.mutate(
      {
        templateId: editingFlow.id,
        isTutorial: true, // keep flagged; just update category + sort
        tutorialCategoryId: editForm.categoryId,
        tutorialSortOrder: editForm.sortOrder,
      },
      {
        onSuccess: () => {
          setEditingFlow(null)
          toast.success("Updated")
        },
        onError: (err: Error) => toast.error(err.message),
      },
    )
  }

  // -------- Unmark --------
  const handleUnmark = () => {
    if (!unmarkTarget) return
    toggleFlag.mutate(
      { templateId: unmarkTarget.id, isTutorial: false },
      {
        onSuccess: () => {
          setUnmarkTarget(null)
          toast.success("Unmarked")
        },
        onError: (err: Error) => toast.error(err.message),
      },
    )
  }

  return (
    <div>
      {noCategories && (
        <div className="mb-4 p-3 rounded-lg border border-amber-300/50 bg-amber-50/50 dark:bg-amber-500/10 text-sm">
          <p className="font-medium text-amber-900 dark:text-amber-300">
            No categories yet
          </p>
          <p className="text-xs text-amber-900/80 dark:text-amber-300/80 mt-1">
            Flow tutorials need a category too.{" "}
            <Link to="/admin/tutorial-categories" className="underline font-medium">
              Create one
            </Link>{" "}
            first.
          </p>
        </div>
      )}

      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-muted-foreground">
          Hands-on workflow templates that surface as cloneable tutorials in the dashboard.
        </p>
        <Button size="sm" onClick={openAdd} disabled={noCategories}>
          <Plus className="h-4 w-4 mr-1" /> Add Flow Tutorial
        </Button>
      </div>

      {isLoading ? (
        <div className="text-sm text-muted-foreground">Loading...</div>
      ) : flows.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground border rounded-lg">
          <Zap className="h-8 w-8 mx-auto mb-2 opacity-40" />
          <p className="text-sm">No flow tutorials yet. Click "Add Flow Tutorial" to flag a template.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {Array.from(flowsByCategory.entries())
            .sort(([aId], [bId]) => {
              const a = categoryById.get(aId)?.sortOrder ?? 999
              const b = categoryById.get(bId)?.sortOrder ?? 999
              return a - b
            })
            .map(([catId, items]) => {
              const cat = categoryById.get(catId)
              return (
                <div key={catId}>
                  <h3 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
                    <Tag className="h-3.5 w-3.5 text-muted-foreground" />
                    {cat?.name ?? "Unknown category"}
                    {cat && !cat.isEnabled && (
                      <Badge variant="outline" className="text-[10px]">disabled</Badge>
                    )}
                  </h3>
                  <div className="border rounded-lg overflow-hidden">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b bg-muted/50">
                          <th className="text-left px-4 py-2 font-medium">Name</th>
                          <th className="text-left px-4 py-2 font-medium hidden md:table-cell">Creator</th>
                          <th className="text-center px-4 py-2 font-medium w-20">Order</th>
                          <th className="text-center px-4 py-2 font-medium w-24 hidden md:table-cell">Complexity</th>
                          <th className="text-center px-4 py-2 font-medium w-16 hidden md:table-cell">Nodes</th>
                          <th className="text-center px-4 py-2 font-medium w-32 hidden lg:table-cell">Marketplace</th>
                          <th className="text-right px-4 py-2 font-medium w-28">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {items.map((f) => (
                          <tr key={f.id} className="border-b last:border-b-0 hover:bg-muted/30">
                            <td className="px-4 py-2 font-medium">
                              {f.name}
                              {f.slug && (
                                <a
                                  href={`/templates`}
                                  className="ml-1 text-muted-foreground hover:text-foreground"
                                  title="View in marketplace"
                                >
                                  <ExternalLink className="h-3 w-3 inline" />
                                </a>
                              )}
                            </td>
                            <td className="px-4 py-2 text-muted-foreground hidden md:table-cell">
                              {f.creatorDisplayName ?? f.creatorId.slice(0, 8)}
                            </td>
                            <td className="px-4 py-2 text-center">{f.tutorialSortOrder}</td>
                            <td className="px-4 py-2 text-center text-muted-foreground hidden md:table-cell">
                              <ComplexityBadge complexity={f.complexity} />
                            </td>
                            <td className="px-4 py-2 text-center text-muted-foreground hidden md:table-cell">
                              <span className="inline-flex items-center gap-1">
                                <Layers className="h-3 w-3" /> {f.nodeCount}
                              </span>
                            </td>
                            <td className="px-4 py-2 text-center hidden lg:table-cell">
                              {f.isListed ? (
                                <Badge variant="outline" className="text-[10px]">Listed</Badge>
                              ) : (
                                <span className="text-[10px] text-muted-foreground">private</span>
                              )}
                            </td>
                            <td className="px-4 py-2 text-right">
                              <div className="flex items-center justify-end gap-1">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 w-7 p-0"
                                  onClick={() => openEdit(f)}
                                  title="Edit category / sort"
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 px-2 text-destructive text-xs"
                                  onClick={() => setUnmarkTarget(f)}
                                  title="Remove tutorial flag"
                                >
                                  Unmark
                                </Button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )
            })}
        </div>
      )}

      {/* 2-step picker / attach dialog */}
      <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
        <DialogContent className="max-w-2xl">
          {step === 1 ? (
            <PickerStep
              search={pickerSearch}
              onSearchChange={setPickerSearch}
              onSelect={selectTemplate}
              onClose={() => setPickerOpen(false)}
            />
          ) : (
            attachForm && (
              <AttachStep
                form={attachForm}
                onChange={setAttachForm}
                onBack={() => setStep(1)}
                onSubmit={handleAttach}
                pickedName={pickedTemplate?.name ?? ""}
                isSaving={toggleFlag.isPending}
                enabledCategories={enabledCategories}
              />
            )
          )}
        </DialogContent>
      </Dialog>

      {/* Edit category/sort for existing flow */}
      <Dialog open={!!editingFlow} onOpenChange={(open) => { if (!open) setEditingFlow(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Tutorial Settings</DialogTitle>
            <DialogDescription>
              {editingFlow?.name}
            </DialogDescription>
          </DialogHeader>
          {editForm && (
            <div className="space-y-4">
              <div>
                <Label>Category</Label>
                <Select
                  value={editForm.categoryId}
                  onValueChange={(v) => setEditForm({ ...editForm, categoryId: v })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Pick a category" />
                  </SelectTrigger>
                  <SelectContent>
                    {enabledCategories.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Sort Order</Label>
                <Input
                  type="number"
                  value={editForm.sortOrder}
                  onChange={(e) =>
                    setEditForm({
                      ...editForm,
                      sortOrder: parseInt(e.target.value) || 0,
                    })
                  }
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingFlow(null)}>
              Cancel
            </Button>
            <Button onClick={handleEdit} disabled={toggleFlag.isPending}>
              {toggleFlag.isPending ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Unmark confirmation */}
      <AlertDialog open={!!unmarkTarget} onOpenChange={(open) => { if (!open) setUnmarkTarget(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unmark "{unmarkTarget?.name}" as tutorial?</AlertDialogTitle>
            <AlertDialogDescription>
              The template will remain in the marketplace if it was already published there;
              only the Tutorial tag is removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleUnmark} disabled={toggleFlag.isPending}>
              {toggleFlag.isPending ? "Working..." : "Unmark"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Picker step (server-side search via the admin all-templates endpoint)
// ---------------------------------------------------------------------------

function PickerStep({
  search,
  onSearchChange,
  onSelect,
  onClose,
}: {
  search: string
  onSearchChange: (s: string) => void
  onSelect: (t: AdminWorkflowTemplateRow) => void
  onClose: () => void
}) {
  // Debounce the search so we don't refetch on every keystroke.
  const [debounced, setDebounced] = useState(search)
  // Sync immediate input → debounce after 250ms
  useDebounced(search, 250, setDebounced)

  const { data, isLoading } = useQuery({
    queryKey: queryKeys.admin.workflowTemplatesAll({ search: debounced }),
    queryFn: () =>
      listAdminWorkflowTemplates({
        search: debounced || undefined,
        limit: 50,
      }),
    staleTime: 30_000,
  })

  const templates = data?.data ?? []

  return (
    <>
      <DialogHeader>
        <DialogTitle>Pick a template to flag as a tutorial</DialogTitle>
        <DialogDescription>
          Any workflow template (yours or someone else's) can be flagged. Templates already flagged
          show a "Tutorial" badge.
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-3">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search by name, description, or tag..."
            className="pl-8"
          />
        </div>
        <div className="border rounded-lg max-h-[420px] overflow-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground text-sm gap-2">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading...
            </div>
          ) : templates.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground text-sm">
              No templates matched "{debounced}"
            </div>
          ) : (
            <ul className="divide-y">
              {templates.map((t) => (
                <li key={t.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(t)}
                    className={cn(
                      "w-full text-left px-3 py-2.5 hover:bg-muted/50 transition-colors flex items-center gap-3",
                      t.isTutorial && "bg-amber-50/30 dark:bg-amber-500/5",
                    )}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium truncate">{t.name}</p>
                        {t.isTutorial && (
                          <Badge variant="outline" className="text-[10px] border-amber-500 text-amber-600">
                            already tutorial
                          </Badge>
                        )}
                        {t.isListed && (
                          <Badge variant="outline" className="text-[10px]">Listed</Badge>
                        )}
                      </div>
                      {t.description && (
                        <p className="text-xs text-muted-foreground truncate">{t.description}</p>
                      )}
                      <p className="text-[10px] text-muted-foreground mt-0.5">
                        by {t.creatorDisplayName ?? t.creatorId.slice(0, 8)}
                        {" · "}
                        <span className="capitalize">{t.complexity}</span>
                        {" · "}
                        {t.nodeCount} nodes
                      </p>
                    </div>
                    <ComplexityBadge complexity={t.complexity} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
      </DialogFooter>
    </>
  )
}

// ---------------------------------------------------------------------------
// Attach step (category + sort_order form)
// ---------------------------------------------------------------------------

function AttachStep({
  form,
  onChange,
  onBack,
  onSubmit,
  pickedName,
  isSaving,
  enabledCategories,
}: {
  form: FlowAttachForm
  onChange: (f: FlowAttachForm) => void
  onBack: () => void
  onSubmit: () => void
  pickedName: string
  isSaving: boolean
  enabledCategories: TutorialCategory[]
}) {
  return (
    <>
      <DialogHeader>
        <DialogTitle>Flag as tutorial</DialogTitle>
        <DialogDescription>
          Picked: <span className="font-medium text-foreground">{pickedName}</span>
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-4">
        <div>
          <Label>Category</Label>
          <Select
            value={form.categoryId}
            onValueChange={(v) => onChange({ ...form, categoryId: v })}
          >
            <SelectTrigger>
              <SelectValue placeholder="Pick a category" />
            </SelectTrigger>
            <SelectContent>
              {enabledCategories.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Sort Order</Label>
          <Input
            type="number"
            value={form.sortOrder}
            onChange={(e) =>
              onChange({ ...form, sortOrder: parseInt(e.target.value) || 0 })
            }
          />
          <p className="text-[11px] text-muted-foreground mt-1">
            Lower numbers appear first within the category.
          </p>
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onBack} disabled={isSaving}>
          <ArrowLeft className="h-3.5 w-3.5 mr-1" /> Back
        </Button>
        <Button onClick={onSubmit} disabled={!form.categoryId || isSaving}>
          {isSaving ? "Saving..." : "Flag as Tutorial"}
        </Button>
      </DialogFooter>
    </>
  )
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function ComplexityBadge({ complexity }: { complexity: string }) {
  const c = COMPLEXITY_CONFIG[complexity as Complexity]
  if (!c) return <span className="text-muted-foreground">—</span>
  return (
    <span className={cn("text-[10px] px-1.5 py-0.5 rounded border font-medium", c.color)}>
      {c.label}
    </span>
  )
}

/** Inline debounce — we don't pull in a util just for the picker. */
function useDebounced<T>(value: T, delayMs: number, setter: (v: T) => void) {
  useEffect(() => {
    const id = setTimeout(() => setter(value), delayMs)
    return () => clearTimeout(id)
  }, [value, delayMs, setter])
}

// ===========================================================================
// PAGE
// ===========================================================================

export default function AdminTutorialsPage() {
  return (
    <div className="p-6 max-w-6xl mx-auto">
      <h1 className="text-2xl font-semibold mb-2">Tutorials</h1>
      <p className="text-sm text-muted-foreground mb-6">
        Manage what shows up in the dashboard Tutorials tab — video tutorials and hands-on flow
        tutorials.
      </p>
      <Tabs defaultValue="videos">
        <TabsList>
          <TabsTrigger value="videos">
            <PlayCircle className="h-3.5 w-3.5 mr-1" /> Video Tutorials
          </TabsTrigger>
          <TabsTrigger value="flows">
            <Zap className="h-3.5 w-3.5 mr-1" /> Flow Tutorials
          </TabsTrigger>
        </TabsList>
        <TabsContent value="videos" className="pt-4">
          <VideoTutorialsTab />
        </TabsContent>
        <TabsContent value="flows" className="pt-4">
          <FlowTutorialsTab />
        </TabsContent>
      </Tabs>
    </div>
  )
}
