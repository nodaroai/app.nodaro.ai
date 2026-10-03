import { lazy, Suspense, useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import { BookOpen, Play, Sparkles } from "lucide-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { PreviewVideo } from "@/components/ui/preview-video"
import { UpdateDialog } from "@/components/layout/update-dialog"
import {
  TutorialsTab,
  VideoPlayerDialog,
  flowToTemplateBrowseCard,
  videoThumbnailUrl,
} from "@/components/dashboard/tutorials-tab"
import { hasTutorial } from "@/components/tutorials/tutorial-registry"
import { useTutorialsGrouped } from "@/hooks/queries/use-tutorials"
import { useProjects } from "@/hooks/queries/use-projects-queries"
import {
  useTemplateFavorites,
  useToggleTemplateFavoriteMutation,
} from "@/hooks/queries/use-template-marketplace-queries"
import { useUpdateCheck, type UpdateInfo } from "@/hooks/use-update-check"
import { surfacePlatformLinks } from "@/lib/surface-selectors"
import { isCloud } from "@/lib/edition"
import { useT } from "@/lib/i18n"
import type { FlowTutorialItem, VideoTutorialItem } from "@/lib/api"
import { EmptyLine, RowArrows, SectionTitle, SegmentedControl, SkeletonRow, ThemeSwitch } from "./home-section"
import { HOME_QUIET_LINK, useRowScroller } from "./home-ui"
import { formatDate } from "@/lib/i18n/format"

// Lazy: pulls in the React Flow node registry + markdown — only when a flow
// tutorial without a guided view opens its preview.
const TemplatePreviewModal = lazy(() =>
  import("@/components/templates/template-preview-modal").then((m) => ({
    default: m.TemplatePreviewModal,
  })),
)

type LevelUpMode = "tutorials" | "releases"

type TutorialItem =
  | { readonly kind: "video"; readonly video: VideoTutorialItem }
  | { readonly kind: "flow"; readonly flow: FlowTutorialItem }

/**
 * "Level up" on the Explore tab. Tutorials are the tutorials catalogue (videos
 * and flow walkthroughs, in category order); release notes are the release the
 * version check already fetched. Neither source carries a duration, so the
 * card's pill names the kind of tutorial rather than inventing a length.
 */
export function LevelUpSection({ withThemeSwitch }: { readonly withThemeSwitch: boolean }) {
  const t = useT()
  const navigate = useNavigate()
  const [mode, setMode] = useState<LevelUpMode>("tutorials")
  const [openVideo, setOpenVideo] = useState<VideoTutorialItem | null>(null)
  const [previewFlow, setPreviewFlow] = useState<FlowTutorialItem | null>(null)
  const [allTutorialsOpen, setAllTutorialsOpen] = useState(false)
  const [releaseOpen, setReleaseOpen] = useState(false)

  const { data, isLoading } = useTutorialsGrouped()
  const { data: projects = [] } = useProjects()
  const { data: favoriteIds = [] } = useTemplateFavorites()
  const toggleFavorite = useToggleTemplateFavoriteMutation()
  const favorites = useMemo(() => new Set(favoriteIds), [favoriteIds])
  const updateInfo = useUpdateCheck()

  const tutorials = useMemo<readonly TutorialItem[]>(
    () =>
      (data?.categories ?? []).flatMap((category) => [
        ...category.videos.map((video) => ({ kind: "video" as const, video })),
        ...category.flows.map((flow) => ({ kind: "flow" as const, flow })),
      ]),
    [data],
  )
  const scroller = useRowScroller(`${mode}:${tutorials.length}`)

  // A flow tutorial with a guided view opens it; the rest keep the snapshot
  // preview (same rule as the full tutorials catalogue).
  const openFlow = (flow: FlowTutorialItem) => {
    if (hasTutorial(flow.slug)) {
      navigate(`/tutorials/${flow.slug}`)
      return
    }
    setPreviewFlow(flow)
  }

  // A pick inside the "All tutorials" dialog closes it first: the preview is a
  // hand-rolled portal that a modal Radix dialog leaves inert (body pointer
  // events are off while it is open), so it opens from this section, outside
  // the dialog — exactly like a pick from the row.
  const selectFromCatalogue = (flow: FlowTutorialItem) => {
    setAllTutorialsOpen(false)
    openFlow(flow)
  }

  // The same three modes the sidebar's version label opens the dialog in.
  const releaseMode: "upgrade" | "whats-new" | "current" = updateInfo?.updateAvailable
    ? "upgrade"
    : isCloud()
      ? "whats-new"
      : "current"

  return (
    <section className="mt-8 first:mt-0">
      <SectionTitle title={t("home.section.levelUp")} trailing={withThemeSwitch ? <ThemeSwitch /> : undefined} />
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <SegmentedControl
          label={t("home.section.levelUp")}
          value={mode}
          onChange={setMode}
          options={[
            { value: "tutorials", label: t("home.tutorials.filter") },
            ...(surfacePlatformLinks() ? [{ value: "releases" as const, label: t("home.tutorials.releaseNotes") }] : []),
          ]}
        />
        {mode === "tutorials" && tutorials.length > 0 && (
          <div className="flex items-center gap-4">
            <button type="button" className={HOME_QUIET_LINK} onClick={() => setAllTutorialsOpen(true)}>
              {t("home.tutorials.all")}
            </button>
            <RowArrows scroller={scroller} />
          </div>
        )}
      </div>

      {mode === "releases" ? (
        <ReleaseNotesCard updateInfo={updateInfo} onOpen={() => setReleaseOpen(true)} />
      ) : isLoading ? (
        <SkeletonRow itemWidth={300} aspectClass="aspect-[16/11]" />
      ) : tutorials.length === 0 ? (
        <EmptyLine text={t("home.tutorials.empty")} />
      ) : (
        <div ref={scroller.rowRef} className="home-row-scroll mt-3.5 flex gap-3.5 overflow-x-auto pb-1.5">
          {tutorials.map((item) =>
            item.kind === "video" ? (
              <TutorialCard
                key={`video-${item.video.id}`}
                title={item.video.title}
                mediaUrl={videoThumbnailUrl(item.video) || null}
                mediaType="image"
                kindLabel={t("home.tutorials.video")}
                isVideo
                onClick={() => setOpenVideo(item.video)}
              />
            ) : (
              <TutorialCard
                key={`flow-${item.flow.id}`}
                title={item.flow.title}
                mediaUrl={item.flow.previewMediaUrl}
                mediaType={item.flow.previewMediaType}
                kindLabel={t("home.tutorials.tutorial")}
                isVideo={false}
                disabled={!item.flow.slug}
                onClick={() => openFlow(item.flow)}
              />
            ),
          )}
        </div>
      )}

      <VideoPlayerDialog video={openVideo} onClose={() => setOpenVideo(null)} />

      {previewFlow && (
        <Suspense fallback={null}>
          <TemplatePreviewModal
            template={flowToTemplateBrowseCard(previewFlow)}
            onClose={() => setPreviewFlow(null)}
            isFavorited={favorites.has(previewFlow.templateId)}
            onToggleFavorite={(id) => toggleFavorite.mutate({ templateId: id })}
            projects={projects.map((p) => ({ id: p.id, name: p.name }))}
          />
        </Suspense>
      )}

      <Dialog open={allTutorialsOpen} onOpenChange={setAllTutorialsOpen}>
        {/* `sm:` on purpose: the base content carries `sm:max-w-lg`, and a bare
            `max-w-4xl` loses to it at that breakpoint. */}
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>{t("home.tutorials.all")}</DialogTitle>
          </DialogHeader>
          <TutorialsTab onSelectFlow={selectFromCatalogue} />
        </DialogContent>
      </Dialog>

      {updateInfo?.latest && (
        <UpdateDialog open={releaseOpen} onOpenChange={setReleaseOpen} info={updateInfo} mode={releaseMode} />
      )}
    </section>
  )
}

function TutorialCard({
  title,
  mediaUrl,
  mediaType,
  kindLabel,
  isVideo,
  disabled = false,
  onClick,
}: {
  readonly title: string
  readonly mediaUrl: string | null
  readonly mediaType: string | null
  readonly kindLabel: string
  readonly isVideo: boolean
  readonly disabled?: boolean
  readonly onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="w-[300px] flex-none rounded-[14px] border border-[var(--home-line-2)] bg-[var(--home-card)] p-2 text-start transition-colors hover:border-[var(--home-muted)] disabled:cursor-not-allowed disabled:opacity-50"
    >
      <span className="home-stripes relative grid aspect-video place-items-center overflow-hidden rounded-[10px]">
        {mediaUrl &&
          (mediaType === "video" ? (
            <PreviewVideo src={mediaUrl} className="absolute inset-0 h-full w-full object-cover" />
          ) : (
            <img src={mediaUrl} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover" />
          ))}
        <span className="relative grid size-10 place-items-center rounded-full border border-white/25 bg-black/55 text-white">
          {isVideo ? (
            <Play className="size-3.5 translate-x-px" fill="currentColor" aria-hidden />
          ) : (
            <BookOpen className="size-4" aria-hidden />
          )}
        </span>
      </span>
      <span className="flex items-center justify-between gap-2.5 px-1 pb-1 pt-2.5">
        <span className="truncate text-[13px] font-medium text-[var(--home-strong)]">{title}</span>
        <span className="flex-none rounded-full bg-[var(--home-raised)] px-2 py-[3px] text-[10px] text-[var(--home-muted)]">
          {kindLabel}
        </span>
      </span>
    </button>
  )
}

function ReleaseNotesCard({
  updateInfo,
  onOpen,
}: {
  readonly updateInfo: UpdateInfo | null
  readonly onOpen: () => void
}) {
  const t = useT()
  const latest = updateInfo?.latest
  if (!latest) return <EmptyLine text={t("home.release.empty")} />

  const published = Date.parse(latest.publishedAt)
  return (
    <button
      type="button"
      onClick={onOpen}
      className="mt-3.5 flex w-full max-w-[620px] items-start gap-3.5 rounded-[14px] border border-[var(--home-line-2)] bg-[var(--home-card)] p-4 text-start transition-colors hover:border-[var(--home-muted)]"
    >
      <span className="grid size-10 flex-none place-items-center rounded-full bg-[var(--home-raised-2)] text-[var(--primary)]">
        <Sparkles className="size-4" aria-hidden />
      </span>
      <span className="min-w-0">
        <span className="block text-[13px] font-semibold text-[var(--home-strong)]">
          {t("home.release.whatsNew", { version: latest.version.replace(/^v/, "") })}
        </span>
        {!Number.isNaN(published) && (
          <span className="mt-0.5 block text-[11px] text-[var(--home-muted)]">
            {formatDate(published)}
          </span>
        )}
        {latest.highlights && (
          <span className="mt-2 line-clamp-3 block whitespace-pre-line text-xs text-[var(--home-fg-2)]">
            {latest.highlights}
          </span>
        )}
      </span>
    </button>
  )
}
