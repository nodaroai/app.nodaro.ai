import { useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { Plus, Pencil, Trash2, ExternalLink } from "lucide-react"
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
import { toast } from "sonner"
import { queryKeys } from "@/lib/query-keys"
import {
  fetchAdminTutorials,
  createTutorial,
  updateTutorial,
  deleteTutorial,
  type Tutorial,
} from "@/lib/api"

const TUTORIAL_CATEGORIES = [
  { value: "getting-started", label: "Getting Started" },
  { value: "workflows", label: "Workflows" },
  { value: "advanced", label: "Advanced" },
] as const

interface TutorialForm {
  title: string
  video_url: string
  description: string
  thumbnail_url: string
  category: string
  sort_order: number
  is_enabled: boolean
}

const emptyForm: TutorialForm = {
  title: "",
  video_url: "",
  description: "",
  thumbnail_url: "",
  category: "getting-started",
  sort_order: 0,
  is_enabled: true,
}

export default function AdminTutorialsPage() {
  const queryClient = useQueryClient()

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<TutorialForm>(emptyForm)
  const [deleteId, setDeleteId] = useState<string | null>(null)

  const { data: tutorials = [], isLoading } = useQuery({
    queryKey: queryKeys.admin.tutorials(),
    queryFn: fetchAdminTutorials,
    staleTime: 30_000,
  })

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.admin.tutorials() })
    queryClient.invalidateQueries({ queryKey: queryKeys.tutorials.all })
  }

  const createMutation = useMutation({
    mutationFn: (data: TutorialForm) =>
      createTutorial({
        title: data.title,
        video_url: data.video_url,
        description: data.description || undefined,
        thumbnail_url: data.thumbnail_url || undefined,
        category: data.category,
        sort_order: data.sort_order,
        is_enabled: data.is_enabled,
      }),
    onSuccess: () => {
      invalidate()
      setDialogOpen(false)
      toast.success("Tutorial created")
    },
    onError: (err: Error) => {
      toast.error(err.message)
    },
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: TutorialForm }) =>
      updateTutorial(id, {
        ...data,
        description: data.description || null,
        thumbnail_url: data.thumbnail_url || null,
      }),
    onSuccess: () => {
      invalidate()
      setDialogOpen(false)
      toast.success("Tutorial updated")
    },
    onError: (err: Error) => {
      toast.error(err.message)
    },
  })

  const toggleMutation = useMutation({
    mutationFn: ({ id, is_enabled }: { id: string; is_enabled: boolean }) =>
      updateTutorial(id, { is_enabled }),
    onMutate: async ({ id, is_enabled }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.admin.tutorials() })
      const prev = queryClient.getQueryData<Tutorial[]>(queryKeys.admin.tutorials())
      queryClient.setQueryData<Tutorial[]>(queryKeys.admin.tutorials(), (old) =>
        old?.map((t) => (t.id === id ? { ...t, isEnabled: is_enabled } : t)),
      )
      return { prev }
    },
    onError: (_err, _vars, context) => {
      if (context?.prev) queryClient.setQueryData(queryKeys.admin.tutorials(), context.prev)
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
    onError: (err: Error) => {
      toast.error(err.message)
    },
  })

  const openCreate = () => {
    setEditingId(null)
    setForm(emptyForm)
    setDialogOpen(true)
  }

  const openEdit = (t: Tutorial) => {
    setEditingId(t.id)
    setForm({
      title: t.title,
      video_url: t.videoUrl,
      description: t.description ?? "",
      thumbnail_url: t.thumbnailUrl ?? "",
      category: t.category,
      sort_order: t.sortOrder,
      is_enabled: t.isEnabled,
    })
    setDialogOpen(true)
  }

  const handleSubmit = () => {
    if (editingId) {
      updateMutation.mutate({ id: editingId, data: form })
    } else {
      createMutation.mutate(form)
    }
  }

  const isSaving = createMutation.isPending || updateMutation.isPending

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold">Tutorials</h1>
        <Button size="sm" onClick={openCreate}>
          <Plus className="h-4 w-4 mr-1" /> Add Tutorial
        </Button>
      </div>

      {isLoading ? (
        <div className="text-sm text-muted-foreground">Loading...</div>
      ) : tutorials.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
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
              {tutorials.map((t) => (
                <tr key={t.id} className="border-b last:border-b-0 hover:bg-muted/30">
                  <td className="px-4 py-2 font-medium">{t.title}</td>
                  <td className="px-4 py-2 text-muted-foreground">{t.category}</td>
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
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive" onClick={() => setDeleteId(t.id)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Add/Edit dialog */}
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
                value={form.video_url}
                onChange={(e) => setForm({ ...form, video_url: e.target.value })}
                placeholder="https://youtube.com/watch?v=..."
              />
            </div>
            <div>
              <Label>Description (optional)</Label>
              <Input
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="A short description of the tutorial"
              />
            </div>
            <div>
              <Label>Thumbnail URL (optional)</Label>
              <Input
                value={form.thumbnail_url}
                onChange={(e) => setForm({ ...form, thumbnail_url: e.target.value })}
                placeholder="https://... (auto-detected from YouTube if empty)"
              />
            </div>
            <div>
              <Label>Category</Label>
              <div className="flex gap-2 mt-1">
                <Input
                  value={form.category}
                  onChange={(e) => setForm({ ...form, category: e.target.value })}
                  placeholder="getting-started"
                  className="flex-1"
                />
                <div className="flex gap-1">
                  {TUTORIAL_CATEGORIES.map((c) => (
                    <Button
                      key={c.value}
                      type="button"
                      variant={form.category === c.value ? "default" : "outline"}
                      size="sm"
                      className="text-xs"
                      onClick={() => setForm({ ...form, category: c.value })}
                    >
                      {c.label}
                    </Button>
                  ))}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <div className="flex-1">
                <Label>Sort Order</Label>
                <Input
                  type="number"
                  value={form.sort_order}
                  onChange={(e) => setForm({ ...form, sort_order: parseInt(e.target.value) || 0 })}
                />
              </div>
              <div className="flex items-center gap-2 pt-5">
                <Switch
                  checked={form.is_enabled}
                  onCheckedChange={(checked) => setForm({ ...form, is_enabled: checked })}
                />
                <Label>Enabled</Label>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={!form.title || !form.video_url || isSaving}>
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
