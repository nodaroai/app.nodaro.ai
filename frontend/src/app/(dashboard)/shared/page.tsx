import { Link } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import { Loader2, Users } from "lucide-react"
import { useAuth } from "@/hooks/use-auth"
import { formatRelative } from "@/lib/i18n"
import { getSharedWithMe } from "@/lib/api"

/**
 * Work other people shared with me.
 *
 * The home for a grant. Sharing takes effect the moment it is written — there
 * is no invitation to accept — so this page is where somebody finds out it
 * happened, and it is the reason the product can leave the accept step out
 * without work quietly landing nowhere.
 *
 * Only work that is NOT in a workspace the viewer belongs to; anything shared
 * with a whole workspace is already in that workspace's own lists, and of the
 * two labels "shared with me" would be the less true one.
 */
export default function SharedWithMePage() {
  const { user } = useAuth()

  const { data, isLoading, error } = useQuery({
    queryKey: ["workflows", "shared-with-me"],
    queryFn: () => getSharedWithMe(),
    enabled: !!user,
    staleTime: 30_000,
  })

  const workflows = data?.data ?? []

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <div className="mb-6 flex items-center gap-2">
        <Users className="h-5 w-5 text-muted-foreground" />
        <h1 className="text-2xl font-semibold">Shared with me</h1>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading
        </div>
      ) : error ? (
        <p className="text-sm text-destructive">Could not load shared work.</p>
      ) : workflows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nothing yet. When somebody shares a workflow with you it turns up here.
        </p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {workflows.map((w) => (
            <li key={w.id}>
              <Link
                to={`/editor/${w.id}`}
                className="block rounded-lg border p-4 transition-colors hover:bg-accent"
              >
                {w.thumbnailUrl && (
                  <img
                    src={w.thumbnailUrl}
                    alt=""
                    // Chosen by the workflow's creator, who is not this viewer.
                    referrerPolicy="no-referrer"
                    loading="lazy"
                    className="mb-3 aspect-video w-full rounded object-cover"
                  />
                )}
                <div className="truncate font-medium">{w.name}</div>
                <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
                  {/* The GRANT, not the access it resolves to. They can
                      differ — an editor grant on work in a workspace the
                      viewer does not belong to is capped at view — and the
                      honest thing to show on a list is what was given. What
                      they can actually do is enforced where it matters, on
                      the canvas. */}
                  <span>{w.grantedRole === "editor" ? "Can edit" : "Can view"}</span>
                  <span>{formatRelative(w.updatedAt)}</span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
