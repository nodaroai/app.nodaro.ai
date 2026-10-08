# Run results on the canvas

When you press **Run**, **Run from here**, **Run up to here** or **Run selected**, the workflow runs
on the server, and each node shows its result on the canvas as it finishes —
the same result a run of that node alone would leave.

## Structured results

Some nodes produce data rather than a picture or a clip. After a workflow run
these show on the canvas too:

| Node | What it shows after a workflow run |
|------|------------------------------------|
| [Edit Plan](../nodes/processing-video/edit-plan.md) | the plan: the cut, the clips or the chapters |
| [Transcribe](../nodes/ai-text/transcribe.md) | the transcript text, with its word timings on the same take |
| [Silence Detect](../nodes/processing-audio/silence-detect.md) | the silent ranges |
| [Audio Sync](../nodes/processing-audio/audio-sync.md) | the offsets |
| [Video Analysis](../nodes/processing-video/video-analysis.md) | the analysis |
| [Video Audit](../nodes/processing-video/video-audit.md) | the corrected analysis |
| [Apply EDL](../nodes/processing-video/apply-edl.md) | the render and the transcript remapped through it (as before) |
| [Web Scrape](../nodes/input/web-scrape.md), [Meta Ads Scrape](../nodes/input/meta-ads-scrape.md), [Instagram Scrape](../nodes/input/instagram-scrape.md) | the pages, ads or posts it scraped, the first one featured |
| [Social Search](../nodes/input/social-search.md) | every post found and the ones passed on; picks you make afterwards are kept when the editor is reopened |
| [Describe to Picker](../nodes/ai-image/describe-to-picker.md) | the picker values it read from the image |
| [Extract Field](../nodes/utility/extract-field.md) | the extracted text, the list (List output) or the value (JSON output) |
| [JSON Process](../nodes/utility/json-process.md) | the processed value |

Before, these nodes kept whatever their last single-node run had left, or
stayed empty, so a later **Run from here** could start from an outdated plan or
transcript. They now hold what the workflow run produced, and a Run from here
starts from that.

Each of these nodes holds exactly what a run of that node alone would leave,
and nothing more. Extract Field and JSON Process keep no list of past runs: the
next node reads the list they produced, and their settings show no per-item
results. Workflows saved before this change may still carry such a list from
an earlier run; it is ignored, so those nodes hand on their own list again
without being run, in the editor and in server runs alike (Run from here,
webhook and schedule triggers).

Video Audit lists what it changed in a strip under the analysis. After a
workflow run the strip is read back from that run's audit a moment after the
analysis appears, so the two always belong to the same run. If that audit
cannot be read (for example, a teammate's run you have no access to), the strip
stays empty rather than showing one from an earlier run.

## Nodes a run only passes through

**Run from here** and **Run selected** run part of the workflow. The nodes
before that part are not run again: they hand on what they already hold. Those
nodes keep exactly what they show — the run never writes their result back onto
them, so an edit you made to one stays as it is.

## Run up to here

**Run up to here** is the other half of Run from here: it runs the nodes
**before** a node that have not run yet, and never the node itself. Use it to
feed a node that reads an upstream result (a Speaker View or an Apply EDL
waiting on an Edit Plan) and look at that result before you spend on the node.

- **Where:** right-click the node and choose **Run up to here**, or press the
  **Run up to here · ≈N** button in the Speaker View and Apply EDL panels. The
  panels show it, with a line saying the upstream has not run yet, when a node
  before them has no result. The menu entry appears only when there is
  something to run.
- **What runs:** the nodes before the node that hold no result. A node that
  already holds its result is not run again, and neither are the nodes that
  only feed it: it hands on what it holds, as in Run from here. A node whose
  last run failed holds no result and runs again. A result that is out of date
  because something before it changed still counts as a result: use **Run from
  here** on the changed node to refresh it.
- **It asks first when it is costly.** Run up to here follows the same rule as
  Run from here: the confirm dialog (**Run up to here · ≈N credits**) appears
  only when the estimate for exactly those nodes is above the usual run-confirm
  threshold; below it the run starts straight away, since the button already
  shows the figure. The estimate is the same one Run and Run from here use, over
  that set. Where credits are not charged, the run starts without asking.
- **What it does:** the same partial run as Run from here, so the result of each
  node shows on the canvas as it finishes, and Stop and the usual run history
  work as usual. A run already in progress, or a canvas you can only view, does
  not start one.

## Reopening after a run finished

Long runs often finish after you have closed the editor. When you open the
workflow again, the newest run you started from the editor (Run, Run from here
or Run selected) is brought onto the canvas:

- **On a workflow with Apply EDL**, every node the run actually ran shows that
  run's results, replacing what it held: the render and every node before it
  (Edit Plan, Transcribe, Silence Detect, Camera Switch and so on). A node after
  the render (captions, formats) or on a branch no render reads from is replaced
  only once a run has already been brought onto it, here or while the editor
  was open; until then it takes the run's result only if it has none yet, so
  edits and deleted takes there are kept.
- **On any other workflow**, a node takes the run's result only if it has none
  yet.

A node is left as it is when:

- the run only passed what it already held through (the nodes before a
  **Run from here** or **Run selected**);
- you emptied it with [Clear results](./clear-results.md) after the run ended;
- it already shows that run (it was open while the run finished, or you have
  reopened the workflow since);
- you ran that node on its own after it finished in the run (even if the rest
  of the run was still going) — its newer result stays;
- it shows a newer run than that one — including a run a teammate started, a
  run you discarded, or a run a Telegram message started, none of which count
  as your newest run.

**The transcript, the plan and the render stay together**, except in the cases
listed at the end of this section. A node *holds back*
other nodes when it keeps a newer run (the last two cases above), or when it is
a render the run never finished: one that failed, or one the run had not
finished when it ended, because it was stopped (Stop or Stop after current),
timed out, or failed at a node before the render (a Camera Switch or the Edit
Plan, say). A failed render shows the failure; an unfinished one shows nothing
new. Either keeps its earlier preview. A node that failed before an unfinished
render is held back with the rest, so it keeps its earlier result too. A render
a Router turned off in the run is not unfinished: it holds nothing back. A held-back node keeps what it holds, even where the run
would have filled an empty node. A node holds back:

- every node before it. When the render keeps a newer render, its Edit Plan,
  the Transcribe and Silence Detect feeding the plan, and every other node
  leading into the render are not loaded either. If captions keep a newer run,
  the render and everything before it stay as they are.
- every node it feeds on the way to a render, and so does every node it holds
  back. If you ran Edit Plan on its own after it finished in the run (even
  while the run was still rendering), the plan keeps your result and the run's
  render, cut from the run's plan, is not loaded. If a title writer that reads
  the Transcribe keeps a newer run, the Transcribe is held back, and so are the
  Edit Plan and the render cut from the run's transcript.

Results can still come from different runs in these cases:

- **The render already has the run's take.** A render that already has the
  run's render among its takes counts as already showing that run, even when
  you have picked an older take. It holds nothing back, so the plan loads from
  the run while the render keeps the take you picked.
- **A second input fed straight into a held-back render.** A render held back
  because its plan keeps a newer run holds back the nodes before the plan, not
  an input that reaches the render without passing through the plan. If the run
  ran such an input, it loads.
- **Nodes after a held-back render.** Captions and formats after the render
  are not on the way to a render, so they can load from the run while the
  render keeps its earlier result.
