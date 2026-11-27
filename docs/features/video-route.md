# Video route (Admin, Cloud)

**Admin → Video route** chooses which provider runs each Seedance 2.x model
(Seedance 2, 2 Fast, 2 Mini, 2.5 and 2.5 Flash): the platform's default
provider, or an **alternate route** the deployment operates. The choice is
made per model, and can be overridden per service: a platform lane (Generate
Video, Text to Video, Extend, Lip Sync, voiced video, character / location /
object / creature motion) or a plugin feature that runs the model for its own
steps (Video Remake, Generate Video Pro, Edit Video Pro, UGC, …).

Nothing changes until an admin chooses the alternate route for a model. With
nothing saved every model runs, and is priced, exactly as before.

From the first save on, the saved choices alone decide the route, for every
model and service. The page shows what the alternate route already runs
before that first save and pre-selects it, so saving keeps it there; when
the route cannot report it, the page says so, and anything it ran moves to
the default provider unless the alternate route is chosen for it.

## What the choice changes

- **New jobs only.** A job keeps the route it was admitted on, whatever is
  saved afterwards. **Revert all to default** puts every model back on the
  default provider for new jobs.
- **Each environment on its own.** Staging and production keep separate
  settings, even though they share a database.
- **No fallback.** A job admitted on the alternate route runs there or fails.
  A start that the route refuses before anything is created is tried once
  more; after that, or after any other failure, the job fails and its
  credits are returned in full. It never switches to the default provider
  mid-run.
- **A request the route does not take is refused.** When the selected route
  is unavailable or does not take a request, the request is refused before
  anything is held. It is not sent to the default provider. The page lists,
  per model and service, how many requests the route took and why the
  others were refused.
- **Follow-ups stay on their route.** A Seedance 2.5 draft is finalized to
  1080p on the provider that made it.

## What a run on the alternate route costs

- **The price is the live one.** The editor, run estimates, `/v1/quote`, the
  API and MCP show the price of the route chosen right now. The prices
  written in these docs are the default provider's; a model on the
  alternate route can cost less or more than they say.
- **Held from the route's quote, charged what the route billed.** A run holds
  the route's quote for that request (its length, resolution and measured
  reference clips), plus the same add-ons as on the default route (the
  seamless-loop trim, a character voice track). When it finishes it is
  charged the route's verified bill for it, with no upper limit: less than
  the hold is returned, more than the hold is collected from the balance. A
  run that fails, including one whose clip arrived but could not be finished,
  is charged nothing.
- **What counts as the verified bill.** The amount the route reports for the
  run. When the route reports the seconds it billed instead of an amount,
  the bill is those seconds at the route's agreed rate. A run the route
  reports neither for stays delivered, with its settlement pending. An
  estimate is never charged, and a bill of zero is not a bill.
- **A run the route has not billed yet.** The platform reads the route again
  for the bill, with a growing wait between reads, for 48 hours. After that
  the run appears under **Held settlements** with one alert, and an admin
  either settles it at the quote it was held at or releases it. The page
  shows what each action would charge before it is chosen. Settling at the
  quote prices only the parts the route never billed; billed parts keep
  their real bill, and when the total is far above the quote the run is
  held for its own confirmation instead of charged. A release records the
  best-known cost as the loss. The route is still read for a late bill for
  seven days: one that arrives is recorded with its difference and alerted,
  and nothing more is ever charged for it. A send that started and could
  never be read to an end is not charged; it is recorded and listed in the
  daily check as a possible loss.
- **Only the clip delivered is charged.** When a step of the platform's own
  fails after the route delivered a clip (a voice track that could not be
  laid on) and a second clip is made, the run is charged for the clip the
  person received. The other clip's bill is recorded as the platform's loss.
- **A bill far above its quote waits for an admin.** This test always runs on
  the total about to be charged, whatever was decided before. When a run's bill is
  more than a set multiple of its quote (5 unless an admin saved another
  number on the page), the run is delivered but not charged. It appears
  under **Held settlements**, with one alert. **Confirm charge** charges it
  in full; **Reject** releases the hold and records the bill as a loss. A
  confirmation is for the total the page showed: the route is read once
  more when the button is pressed, and if the total is no longer that one
  (a bill arrived meanwhile) nothing is decided and the page shows the new
  total to look at again. A
  run with several tasks is compared as a whole: the sum of what they billed
  against the sum of their quotes.
- **A charge the payer could not cover.** When the balance cannot cover the
  part of a bill above the hold, the unpaid part is recorded and an alert is
  raised. By default nothing else happens: the payer's later runs and
  funding are not affected. **Enforce unpaid charges** (off by default)
  makes it binding: that payer's new paid runs are refused with
  `402 routed_balance_due` until it is paid, and later top-ups and budget
  grants repay it first. It applies to the environment it is saved in only:
  a charge left unpaid on staging never blocks, or collects from, a run or a
  top-up in production. A top-up or grant is never refused or delayed by a
  repayment: one that cannot be applied at that moment is applied shortly
  after, takes no more than the balance (or a workspace budget's free room)
  then holds, and after ten failed tries is reported in the daily alert
  and left for an admin; the charge stays owed. A deployment whose customers pay through an
  [external wallet](../external-wallet.md) must have a wallet that supports
  the routed contract before turning it on.
- **Listed prices are the safe figure for a reference no longer than the
  output.** A model list or a "from" price for a reference-video run is the
  price of a reference as long as the output; a run with a shorter reference
  settles lower. A reference longer than the output costs more than the
  listed figure: the run's own estimate and its hold are quoted on the
  measured reference.
- **Prices follow what runs cost.** When runs keep billing more than they
  were quoted, the price of that model, resolution and kind rises on its
  own, one small step at a time, up to a ceiling. An admin can set or reset
  each one under **Price correction factors**.

## Stopping a run

For the Seedance 2.x models (on either provider), a run whose video has
already started is not cancelled by **Stop**, by stopping an app run, or by a
node that timed out. The provider is already making it, so it finishes, lands
in **My Library**, and is charged like any finished run. The node shows that
it stopped and that the video finishes in the library; nodes after it do not
get it. A run stopped before its video started is cancelled and its credits
are returned, as before.

## Alerts and checks

The page shows both providers' balances and can raise an alert when either
is below a number an admin sets. Leave a number empty for no alert. Nothing is
switched automatically.

A daily check compares the total the route's account reports it spent with
the verified bills the platform recorded on routed jobs. It lists jobs that
failed after the route billed them as their own line, and alerts when the
rest does not add up. It only alerts; it changes no charge.
