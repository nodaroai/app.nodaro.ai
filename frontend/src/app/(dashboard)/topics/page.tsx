import { DeleteConfirmationDialog } from "@/components/ui/delete-confirmation-dialog"
import { TopicDetailDialog } from "@/components/topics/topic-detail-dialog"
import { TopicFormDialog } from "@/components/topics/topic-form-dialog"
import { TopicsBody, TopicsHeader } from "@/components/topics/topics-layout"
import { topicsBodyState, useTopicsPage } from "@/components/topics/use-topics-page"
import { useT } from "@/lib/i18n"

/**
 * Topics: a hashtag or phrase followed on the platforms the person picks,
 * with no brand around it — the topics, what is happening around them (the
 * cards), and each topic's posts and scans.
 */
export default function TopicsPage() {
  const t = useT()
  const page = useTopicsPage()
  const { list, topics, limit, form, actions, opened, removing } = page
  const state = topicsBodyState(list)
  const locked = limit === 0
  const atCap = typeof limit === "number" && limit > 0 && topics.length >= limit
  return (
    <div className="container mx-auto max-w-[1100px] px-5 pb-16 pt-7">
      <TopicsHeader canAdd={state === "ready" && !locked} limit={limit} atCap={atCap} onAdd={() => form.start(null)} />
      <TopicsBody state={state} topics={topics} locked={locked} cards={page.cards} actions={actions} />
      <TopicFormDialog open={form.open} editing={form.editing} onOpenChange={(open) => !open && form.close()} onSubmit={form.submit} busy={form.busy} />
      <TopicDetailDialog
        topic={opened}
        busy={opened !== null && actions.isBusy(opened)}
        blockedWhy={opened ? actions.scanBlockedWhy(opened) : null}
        onScan={actions.onScan}
        onOpenChange={(open) => !open && page.closeOpened()}
      />
      <DeleteConfirmationDialog
        isOpen={removing !== null}
        onClose={() => page.setRemoving(null)}
        onConfirm={() => removing && page.removeTopic(removing)}
        title={t("topics.removeTitle", { name: removing?.name ?? "" })}
        description={t("topics.removeDesc")}
        confirmLabel={t("common.remove")}
      />
    </div>
  )
}
