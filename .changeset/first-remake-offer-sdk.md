---
"@nodaro/sdk": minor
---

"First Remake on us": `UserBalance.firstRemakeOffer` (`{ status, allowed }`), present only while the signed-in account never bought anything and has not used its first Video Remake run (the offer); `VideoRemakeEstimate.firstRemakeOffer` and `TrendEstimate.firstRemakeOffer` (`{ allowed, coverCredits }`), what the offer would cover of that quote. New types `FirstRemakeOfferState` and `FirstRemakeOfferQuote`.
