import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  "bursting-through-frame": { label: "Frame से बाहर निकलता हुआ", description: "Frame को तोड़ता 3D paper-tear" },
  "breaking-out-of-frame": { label: "Frame से बाहर निकलना", description: "अंग canvas की सीमा से बाहर निकलता है" },
  "pixel-disintegration": { label: "Pixel Disintegration", description: "Subject कणों में घुलता हुआ" },
  "smoke-sculpture": { label: "धुएँ की मूर्ति", description: "घूमते धुएँ से बना subject" },
  "liquid-sculpture": { label: "तरल मूर्ति", description: "बहते तरल से बना subject" },
  "shattering-glass": { label: "टूटता काँच", description: "Mid-flight में जमी हुई काँच की किरचें" },
  "emerging-from-background": { label: "पृष्ठभूमि से उभरना", description: "Textured सतह से आधा उभरता हुआ" },
  "fragmented-mosaic": { label: "खंडित Mosaic", description: "Mosaic tiles से बना portrait" },
  "glitch-distortion": { label: "Glitch Distortion", description: "RGB-shift digital corruption" },
  "doubled-mirror": { label: "Doubled Mirror", description: "Mirror-परावर्तित नक़ल" },
  "floating-fragments": { label: "तैरते टुकड़े", description: "बदन आंशिक रूप से दूर बहता हुआ" },
  "silhouette-outline": { label: "Silhouette की रेखा", description: "Flat BG पर साफ़ काला silhouette" },
  "exploding-particles": { label: "विस्फोटक कण", description: "रेखा कणों में बिखर रही है" },
  "3x3-grid-collage": { label: "3x3 Grid Collage", description: "Contact-sheet 9-pose montage" },

  // -------------------- Round 2 --------------------
  "matte-painting": { label: "Matte Painting", description: "Live action के साथ blended composite matte-painted background" },
  "double-exposure": { label: "Double Exposure", description: "दो layered photographic exposures fused" },
  "multiple-exposure": { label: "Multiple Exposure", description: "तीन या उससे ज़्यादा exposures stacked" },
  "in-camera-effects": { label: "In-Camera Effects", description: "Practical in-camera optical effects, no post" },
  "prism-flares": { label: "Prism Flares", description: "Crystal prism refracted light flares spectral bands में बँटते हुए" },
}

export default map
