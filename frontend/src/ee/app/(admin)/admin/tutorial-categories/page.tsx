// Admin → Tutorial Categories. CRUD over the shared taxonomy that both
// video tutorials and flow tutorials reference.
//
// The DELETE button reads the count of tutorials + flow tutorials referencing
// the row (computed locally from the cached admin lists) so admins can decide
// whether to disable instead of delete. The backend rejects the delete with
// 409 if anything still references it — we surface that as a typed error.

import { useState, useMemo } from "react"
import { useQuery } from "@tanstack/react-query"
import { Plus, Pencil, Trash2, Tag } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
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
import { queryKeys } from "@/lib/query-keys"
import {
  fetchAdminTutorials,
  TutorialCategoryInUseError,
  type TutorialCategory,
} from "@/lib/api"
import {
  useAdminTutorialCategories,
  useCreateTutorialCategory,
  useUpdateTutorialCategory,
  useDeleteTutorialCategory,
} from "@/ee/hooks/queries/use-admin-tutorial-categories"
import { useAdminFlowTutorials } from "@/ee/hooks/queries/use-admin-flow-tutorials"

// ---------------------------------------------------------------------------
// Slug helpers
// ---------------------------------------------------------------------------

function toSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
}

// ---------------------------------------------------------------------------
// Form state
// ---------------------------------------------------------------------------

interface CategoryForm {
  name: string
  slug: string
  description: string
  sortOrder: number
  isEnabled: boolean
  slugManuallyEdited: boolean
}

const emptyForm: CategoryForm = {
  name: "",
  slug: "",
  description: "",
  sortOrder: 0,
  isEnabled: true,
  slugManuallyEdited: false,
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function AdminTutorialCategoriesPage() {
  const { data: categories = [], isLoading } = useAdminTutorialCategories()

  // Pulled to compute reference counts per category. Both lists are admin-
  // gated and small (typically dozens) so client-side aggregation is fine.
  const { data: tutorials = [] } = useQuery({
    queryKey: queryKeys.admin.tutorials(),
    queryFn: fetchAdminTutorials,
    staleTime: 30_000,
  })
  const { flows } = useAdminFlowTutorials()

  const counts = useMemo(() => {
    const videoCount = new Map<string, number>()
    const flowCount = new Map<string, number>()
    for (const t of tutorials) {
      videoCount.set(t.categoryId, (videoCount.get(t.categoryId) ?? 0) + 1)
    }
    for (const f of flows) {
      if (!f.tutorialCategoryId) continue
      flowCount.set(f.tutorialCategoryId, (flowCount.get(f.tutorialCategoryId) ?? 0) + 1)
    }
    return { videoCount, flowCount }
  }, [tutorials, flows])

  // Mutations
  const createMutation = useCreateTutorialCategory()
  const updateMutation = useUpdateTutorialCategory()
  const deleteMutation = useDeleteTutorialCategory()

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<CategoryForm>(emptyForm)
  const [deleteTarget, setDeleteTarget] = useState<TutorialCategory | null>(null)
  const [deleteError, setDeleteError] = useState<{ videos: number; flows: number; message: string } | null>(null)

  // Quick toggle: enabled
  const toggleEnabled = (c: TutorialCategory) => {
    updateMutation.mutate(
      { id: c.id, data: { is_enabled: !c.isEnabled } },
      {
        onError: (err: Error) => toast.error(err.message),
      },
    )
  }

  const openCreate = () => {
    setEditingId(null)
    setForm({ ...emptyForm, sortOrder: categories.length })
    setDialogOpen(true)
  }

  const openEdit = (c: TutorialCategory) => {
    setEditingId(c.id)
    setForm({
      name: c.name,
      slug: c.slug,
      description: c.description ?? "",
      sortOrder: c.sortOrder,
      isEnabled: c.isEnabled,
      slugManuallyEdited: true, // edit mode never auto-derives
    })
    setDialogOpen(true)
  }

  const handleNameChange = (name: string) => {
    setForm((f) => ({
      ...f,
      name,
      slug: f.slugManuallyEdited ? f.slug : toSlug(name),
    }))
  }

  const handleSlugChange = (slug: string) => {
    setForm((f) => ({ ...f, slug: toSlug(slug), slugManuallyEdited: true }))
  }

  const handleSubmit = () => {
    if (!form.name.trim() || !form.slug.trim()) {
      toast.error("Name and slug are required")
      return
    }
    const payload = {
      name: form.name.trim(),
      slug: form.slug.trim(),
      description: form.description.trim() || undefined,
      sort_order: form.sortOrder,
      is_enabled: form.isEnabled,
    }
    if (editingId) {
      updateMutation.mutate(
        {
          id: editingId,
          data: {
            ...payload,
            description: payload.description ?? null,
          },
        },
        {
          onSuccess: () => {
            setDialogOpen(false)
            toast.success("Category updated")
          },
          onError: (err: Error) => toast.error(err.message),
        },
      )
    } else {
      createMutation.mutate(payload, {
        onSuccess: () => {
          setDialogOpen(false)
          toast.success("Category created")
        },
        onError: (err: Error) => toast.error(err.message),
      })
    }
  }

  const confirmDelete = (c: TutorialCategory) => {
    setDeleteError(null)
    setDeleteTarget(c)
  }

  const performDelete = () => {
    if (!deleteTarget) return
    deleteMutation.mutate(deleteTarget.id, {
      onSuccess: () => {
        setDeleteTarget(null)
        toast.success("Category deleted")
      },
      onError: (err) => {
        if (err instanceof TutorialCategoryInUseError) {
          setDeleteError({
            videos: err.videoCount,
            flows: err.flowCount,
            message: err.message,
          })
        } else {
          toast.error(err instanceof Error ? err.message : "Failed to delete category")
        }
      },
    })
  }

  const isSaving = createMutation.isPending || updateMutation.isPending

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-2">
        <h1 className="text-2xl font-semibold">Tutorial Categories</h1>
        <Button size="sm" onClick={openCreate}>
          <Plus className="h-4 w-4 mr-1" /> Add Category
        </Button>
      </div>
      <p className="text-sm text-muted-foreground mb-6">
        Shared taxonomy used by both video tutorials and flow tutorials. Disable a category to hide
        it from the dashboard without losing its content.
      </p>

      {isLoading ? (
        <div className="text-sm text-muted-foreground">Loading...</div>
      ) : categories.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground border rounded-lg">
          <Tag className="h-8 w-8 mx-auto mb-2 opacity-40" />
          <p className="text-sm">No categories yet. Click "Add Category" to create the first one.</p>
        </div>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="text-left px-4 py-2 font-medium">Name</th>
                <th className="text-left px-4 py-2 font-medium hidden md:table-cell">Slug</th>
                <th className="text-center px-4 py-2 font-medium w-20">Order</th>
                <th className="text-center px-4 py-2 font-medium w-24 hidden md:table-cell">Videos</th>
                <th className="text-center px-4 py-2 font-medium w-24 hidden md:table-cell">Flows</th>
                <th className="text-center px-4 py-2 font-medium w-20">Enabled</th>
                <th className="text-right px-4 py-2 font-medium w-24">Actions</th>
              </tr>
            </thead>
            <tbody>
              {categories.map((c) => {
                const videos = counts.videoCount.get(c.id) ?? 0
                const flowsCount = counts.flowCount.get(c.id) ?? 0
                return (
                  <tr key={c.id} className="border-b last:border-b-0 hover:bg-muted/30">
                    <td className="px-4 py-2 font-medium">
                      <div className="flex flex-col">
                        <span>{c.name}</span>
                        {c.description && (
                          <span className="text-[10px] text-muted-foreground line-clamp-1">
                            {c.description}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-2 text-muted-foreground hidden md:table-cell">
                      <code className="text-xs">{c.slug}</code>
                    </td>
                    <td className="px-4 py-2 text-center">{c.sortOrder}</td>
                    <td className="px-4 py-2 text-center text-muted-foreground hidden md:table-cell">
                      {videos}
                    </td>
                    <td className="px-4 py-2 text-center text-muted-foreground hidden md:table-cell">
                      {flowsCount}
                    </td>
                    <td className="px-4 py-2 text-center">
                      <Switch
                        checked={c.isEnabled}
                        onCheckedChange={() => toggleEnabled(c)}
                      />
                    </td>
                    <td className="px-4 py-2 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0"
                          onClick={() => openEdit(c)}
                          title="Edit"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0 text-destructive"
                          onClick={() => confirmDelete(c)}
                          title="Delete"
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
            <DialogTitle>{editingId ? "Edit Category" : "Add Category"}</DialogTitle>
            <DialogDescription>
              The slug is the stable identifier — keep it short, kebab-case, and don't change it once
              tutorials reference the category.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Name</Label>
              <Input
                value={form.name}
                onChange={(e) => handleNameChange(e.target.value)}
                placeholder="Getting Started"
              />
            </div>
            <div>
              <Label>Slug</Label>
              <Input
                value={form.slug}
                onChange={(e) => handleSlugChange(e.target.value)}
                placeholder="getting-started"
              />
              <p className="text-[11px] text-muted-foreground mt-1">
                Auto-derived from name. Edit only if you really need to.
              </p>
            </div>
            <div>
              <Label>Description (optional)</Label>
              <Input
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="Short blurb shown to admins"
              />
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
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={isSaving}>
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={!form.name || !form.slug || isSaving}>
              {isSaving ? "Saving..." : editingId ? "Update" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteTarget(null)
            setDeleteError(null)
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleteTarget?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteError ? (
                <span className="text-destructive">
                  Can't delete this category — {deleteError.videos} video tutorial(s) and{" "}
                  {deleteError.flows} flow tutorial(s) still reference it. Move them to another
                  category first, or disable this one instead.
                </span>
              ) : (
                <>
                  This permanently removes the category. Tutorials referencing it will fail to load —
                  the backend will reject the delete if anything is still attached.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            {!deleteError && (
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={performDelete}
                disabled={deleteMutation.isPending}
              >
                {deleteMutation.isPending ? "Deleting..." : "Delete"}
              </AlertDialogAction>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
