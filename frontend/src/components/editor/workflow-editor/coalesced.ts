/**
 * Runs `task` one at a time. Asked while it runs, it queues ONE more run for
 * when it finishes, however many times it is asked — enough when every run
 * reads the current state of things, as the canvas's re-read of the row and
 * its re-check of the access both do. The queued run is dropped once `alive`
 * says the caller is gone.
 */
export function coalesced(task: () => Promise<void>, alive: () => boolean): () => void {
  let running = false
  let queued = false
  const run = (): void => {
    running = true
    void task()
      .catch(() => {})
      .finally(() => {
        running = false
        if (queued && alive()) {
          queued = false
          run()
        }
      })
  }
  return () => {
    if (running) queued = true
    else run()
  }
}
