# Free credits

Every new Nodaro Cloud account gets a one-time grant of **300 credits**<!-- credits: n/a -->.
Nothing to buy, nothing to enter — the credits land the first time you open
the app after signing up, or, while the welcome offer is switched on, as soon
as you say yes to it (below).

The grant used to be 1,500 credits<!-- credits: n/a -->. An account that
received that grant keeps those credits; any grant that lands now — including
one an older account had not claimed yet, or one added with a first purchase —
is 300 credits<!-- credits: n/a -->.

## When the welcome offer is on

While a deployment has the welcome offer switched on, the grant waits for
your yes: say yes to product updates and tips by email — in the welcome
pop-up, or in the banner on the home screen — and the free credits land in
your account at once. You can unsubscribe anytime.

The pop-up opens by itself on the home screen. Closing it without answering
(the ×, Escape, or a click outside it) keeps the offer open, and the pop-up
opens by itself again on a later visit: at most once a day, three times in
all, and never twice in one visit. **Maybe later** is an answer: the pop-up
does not open by itself again. Either way the banner stays until you say yes.
The count belongs to your account, not to the device or the app you open.

When a run needs more credits than the account has, the **Insufficient
Credits** dialog offers the free credits again, above the figures, with
**Upgrade Plan** and **Buy Credits** below as always:

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
that estimate, with a note under it: the figure is the run's estimate, and the
run is charged what it uses. Their **Render final** runs as part of the
workflow's run. When that run also makes a UGC video, the editor checks the
balance itself and can open the dialog before anything is sent. Otherwise a
refusal shows on the node, as before. When a credits refusal names no figures,
the node shows the same error notice as before.

## When the grant waits for a first purchase

Occasionally the grant is not applied automatically. When that happens the
account works normally, and a banner at the top of the app says that the free
credits are added with your **first purchase**:

- Buy any credit pack, with any card. The free credits are added on top as
  soon as the payment settles — there is no separate activation step and no
  card-on-file form.
- A subscription brings its own monthly credits instead; the one-time grant
  does not stack on a plan.

## When you subscribe, and when a subscription ends

Free credits you have not spent when you subscribe move into your top-up
credits, where they stay valid for 12 months like any top-up. When the
subscription ends, the plan's remaining credits end with it: the account is
back on the free tier with no subscription credits, and it keeps every top-up
credit it holds. Ending a plan does not add free credits; a one-time grant
the account never claimed can still be claimed afterwards.

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
  except Kling 4.0 Flash, and Seedance 2.5 (including its HD finalize step)
  except Seedance 2.5 Flash,
  video upscaling (VEO 1080p / 4K, Topaz), and extending a video.
- **Kling 4.0 Flash** (`kling-4-flash`) is the one Kling model open to free
  credits, within the limits below: 3 or 4 second clips at 720p, its only
  resolution.
- **Seedance 2.5 Flash** (`seedance-2-5-flash`) is open to free credits within
  the limits below: a 4 second clip at 480p, its lowest resolution. Seedance
  2.5 itself, its HD finalize step and its extend stay unavailable, and so does
  Seedance 2.5 Flash's extend (`seedance-2-5-flash-extend`): extending a video
  is not available on any model (Gemini Omni Flash 1.2's extend,
  `gemini-omni-flash-1-2-extend`, included).
- **Every other video model:** clips of **up to 4 seconds**, at the model's
  **lowest resolution** (for example 480p on Seedance 2 Fast, 720p on VEO 3.1
  Lite). A model whose shortest clip is longer than 4 seconds is not
  available, and an "Auto" length is not accepted. Name the resolution: a
  request that leaves it out is refused, because the model would render its
  own default.
- **Video Remake is not limited.** A Video Remake run (either engine, a
  preview or the whole clip), a draft's Full Quality and a trend run work on
  free credits like on any account: the limits above are not applied to the
  video a Video Remake run makes for itself. The run still needs enough
  credits to cover its quote. Calling the same video models yourself (Generate
  Video, Video Upscale, the API's `/v1/generate-video` and
  `/v1/video-upscale`) stays within the limits.
  The video a Video Remake run delivers is watermarked like any other free
  tier result. The clips and pictures the run prepares for itself along the
  way (a depth map, a mask, a reference picture) are never results and carry
  no watermark; the same tools run on their own are watermarked as usual.

A run outside these limits is refused before anything is charged, with a
message naming the limit (HTTP 402, error code `free_video_limit`). A real
payment lifts them for good, on every surface: any credit pack, or any paid
subscription invoice — also after the subscription ends. A card on file or a
trial is not a payment.
The default Generate Video settings (Seedance 2 Fast, 4 seconds) run as they
are.

An app can lock these options before a run instead of meeting the refusal. The
rule the server refuses with is published in the SDK's companion package,
`@nodaro/shared/free-video-limits`, and the server states the limits it
applies: `GET /v1/user/credits` carries `freeVideoLimits` (`{ enabled,
maxSeconds }`) only while they apply to the signed-in account, and the free
plan of `GET /v1/billing/plans` carries them for a page shown before sign-in.
See [SDK reference § Locking video options on free credits](../sdk-reference.md#locking-video-options-on-free-credits).
