# Free credits

Every new Nodaro Cloud account gets a one-time grant of **1,500 credits**<!-- credits: n/a -->.
Nothing to buy, nothing to enter — the credits land the first time you open
the app after signing up, or, while the welcome offer is switched on, as soon
as you say yes to it (below).

## When the welcome offer is on

While a deployment has the welcome offer switched on, the grant waits for
your yes: say yes to product updates and tips by email — in the welcome
pop-up, or in the banner on the home screen — and the free credits land in
your account at once. You can unsubscribe anytime.

Closing the pop-up without answering keeps the offer open. When a run needs
more credits than the account has, the **Insufficient Credits** dialog offers
the free credits again, above the figures, with **Upgrade Plan** and **Buy
Credits** below as always:

- The free credits cover the run: the dialog closes. Press **Run** again —
  nothing starts on its own.
- The run still needs more: the dialog stays and shows the new balance. The
  free credits bring your plan's credits up to the grant's amount; they are
  not added on top of plan credits you already have.
- If your balance could not be read right after the yes, the dialog shows
  the grant's amount (or what you had, if that was more) until the balance
  arrives, then shows it — and closes if it covers the run.
- The grant was withheld: in place of the offer, the dialog shows the notice
  the banner at the top of the app shows — that the free credits are added
  with a first purchase (next section), or, when your balance says the
  browser could not be checked, to turn off the ad blocker or privacy shield
  and reload. If the balance could not be read just then, it shows the
  first-purchase notice.

The "Yes" in the dialog is never the first thing it focuses: pressing Enter
right after it opens closes it instead of saying yes.

The dialog opens before the whole workflow's **Run** starts. For most nodes it
also opens when the node's own run (its ▶, or **Run This Node** in its
settings) is refused for a credits shortfall and the refusal names the
figures. That includes the podcast nodes (Tighten Episode, Chapters, Trailer,
Clip Pack and Speaker Layout): their own run and their **Continue** are
refused when the balance cannot cover the run's estimate, and the dialog shows
that estimate. Their **Render final** runs as part of the workflow's run, so a
refusal there shows on the node, as before. When a credits refusal names no
figures, the node shows the same error notice as before.

## When the grant waits for a first purchase

Occasionally the grant is not applied automatically. When that happens the
account works normally, and a banner at the top of the app says that the free
credits are added with your **first purchase**:

- Buy any credit pack, with any card. The free credits are added on top as
  soon as the payment settles — there is no separate activation step and no
  card-on-file form.
- A subscription brings its own monthly credits instead; the one-time grant
  does not stack on a plan.

If you believe your grant should have applied and you would rather not buy
anything, contact support from the same account and we will look into it.

## What the grant covers

The grant is the free tier's spending balance: it works with every model the
free tier can run, and there is no daily cap. Image and video outputs are
watermarked while the account is on the free tier, with no subscription and
no credits bought. A subscription lifts the watermark while it lasts, and
buying a credit pack lifts it for good on runs made through the API, SDK, CLI
and MCP (see [pay-as-you-go accounts](../api-integration.md#8b-pay-as-you-go-accounts)),
unless the credits bought are all refunded. Details of what each tier
includes are on the [pricing page](https://app.nodaro.ai/pricing).

## Video on free credits

Until an account buys anything, its video runs within these limits:

- **Not available:** every Kling model (generation, motion transfer, lip-sync)
  except Kling 4.0 Flash, and Seedance 2.5 (including its HD finalize step),
  video upscaling (VEO 1080p / 4K, Topaz), and extending a video.
- **Kling 4.0 Flash** (`kling-4-flash`) is the one Kling model open to free
  credits, within the limits below: 3 or 4 second clips at 720p, its only
  resolution.
- **Every other video model:** clips of **up to 4 seconds**, at the model's
  **lowest resolution** (for example 480p on Seedance 2 Fast, 720p on VEO 3.1
  Lite). A model whose shortest clip is longer than 4 seconds is not
  available, and an "Auto" length is not accepted. Name the resolution: a
  request that leaves it out is refused, because the model would render its
  own default.

A run outside these limits is refused before anything is charged, with a
message naming the limit (HTTP 402, error code `free_video_limit`). A real
payment lifts them for good, on every surface: any credit pack, or any paid
subscription invoice — also after the subscription ends. A card on file or a
trial is not a payment.
The default Generate Video settings (Seedance 2 Fast, 4 seconds) run as they
are.
