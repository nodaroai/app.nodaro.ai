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
  loss, and the page shows that figure before it is chosen. The route is
  still read for a late bill for seven days, for every part of the run that
  may still be billed: one that arrives is recorded with its difference and
  alerted, and nothing more is ever charged for it. A send that started and
  could never be read to an end is not charged, even when a bill for it
  arrives later; it is recorded and listed in the daily check as a possible
  loss, and its bill, when it comes, as a known loss.
- **What a loss is.** On every path (a run that failed or was cancelled, a
  release, a run that delivered nothing, a clip that was replaced, a late
  bill) the loss recorded is what the route billed for the parts that were
  not charged, or the quote of a delivered part it has not billed yet. It is
  the route's cost only, with nothing the platform adds on top. It is
  corrected when the real bill arrives, down as well as up.
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

A daily check lists the verified bills this environment recorded on routed
jobs for each day, each counted on the day the route billed it (even when the
bill reached the platform days later: the last nine days are checked again
each time), with known losses on a line of their own, beside what the route's
account reports it spent that day. It alerts, for the day just ended, on bills
that were never reported and on sends that were never read to an end.

The route's account can be shared by more than one environment, and by
alternate-route runs made while no routing choice is saved, so the account
itself is checked once a day for all of them together: what it spent each day
against every environment's bills, the parts still to be billed at the route's
estimate, and the recorded cost of those other runs. The page lists each day
checked under **Account check (all environments)**.

- **What it alerts.** The account spent more than all of that (paid work
  nothing recorded may exist), or what was recorded comes to more than the
  account spent (the recorded bills may be wrong), past the drift percentage
  set on this page and never for less than a small allowance. A day is alerted
  only when the next day's check still finds the difference, so a bill that
  arrives late, or the next day's figure, can explain it first; it is alerted
  again only when the difference grows.
- **Runs that straddle midnight.** A difference on one day that the next (or
  previous) day's opposite difference offsets, within one run's worth, is
  counted as a run billed on one side of midnight and recorded on the other,
  and is not alerted. The page shows it as **Straddle**.
- **Known other spend.** When something else this platform never records also
  spends from the same account, set **Known other spend on the route's account
  (USD per day)** to what you know it spends. It is taken off the account's
  spend before the check alerts. It is 0 by default: the check never guesses
  at other spending.
- **When the account cannot be read.** The check runs every hour. A day whose
  spend could not be read stays **Pending** and is read again on the next
  checks while the route still reports it (the day just ended and the one
  before). A day still unread after that is **Not measured**, alerted once, and
  not compared. A check that fails is alerted and runs again the next hour.
- **Late bills.** The last nine days are checked again each time, so a bill
  that arrives late corrects its own day.
- **Who runs it.** One environment with a routing choice saved runs it for the
  whole account; its alerts appear on that environment's page.

These checks only alert; they change no charge.

A choice that adds a route (puts a model, or one of its services, on the
alternate route where it was not before), or that turns on **Enforce unpaid
charges**, is saved only when the database confirms that its routed-video
schema is complete. It is refused while that cannot be confirmed (for example,
before the schema check is installed). Removing a route, changing only a
threshold, and **Revert** are always allowed.
