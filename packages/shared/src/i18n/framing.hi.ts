import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // Shot size
  "extreme-wide-shot": { label: "Extreme Wide Shot", description: "विशाल वातावरण में subject बहुत छोटा" },
  "wide-shot": { label: "Wide Shot", description: "आसपास के माहौल के साथ पूरा बदन" },
  "medium-wide-shot": { label: "Medium Wide", description: "घुटनों से ऊपर subject" },
  "medium-shot": { label: "Medium Shot", description: "कमर से ऊपर subject" },
  "medium-close-up": { label: "Medium Close-up", description: "छाती से ऊपर subject" },
  "close-up": { label: "Close-up", description: "Frame भरते हुए subject का चेहरा" },
  "extreme-close-up": { label: "Extreme Close-up", description: "चेहरे की एक feature का तंग detail" },
  "insert": { label: "Insert", description: "किसी वस्तु का detail shot" },
  "macro": { label: "Macro", description: "छोटे subject का अत्यधिक नज़दीकी detail" },
  "full-shot": { label: "Full Shot", description: "Frame में सिर-से-पैर तक पूरा बदन" },
  "cowboy-shot": { label: "Cowboy Shot", description: "जाँघ के बीच से ऊपर, क्लासिक Western framing" },
  "head-to-knees": { label: "सिर से घुटनों तक", description: "सिर से लेकर घुटनों तक" },
  "head-to-hip": { label: "सिर से कूल्हे तक", description: "सिर से लेकर कूल्हे तक" },
  "half-body": { label: "आधा बदन", description: "साफ़ कमर-से-ऊपर portrait" },

  // Angle
  "eye-level": { label: "Eye Level", description: "Subject की आँख की ऊँचाई पर camera" },
  "high-angle": { label: "High Angle", description: "Subject के ऊपर से नीचे देखता camera" },
  "low-angle": { label: "Low Angle", description: "Subject के नीचे से ऊपर देखता camera" },
  "overhead": { label: "Overhead", description: "सीधा ऊपर से god's eye view" },
  "worms-eye-angle": { label: "Worm's Eye", description: "ज़मीन से अत्यधिक नीचे का कोण" },
  "dutch-angle": { label: "Dutch Angle", description: "Tilted canted horizon" },
  "birds-eye": { label: "Bird's Eye", description: "ऊँचा aerial overhead view" },
  "slightly-downward": { label: "थोड़ा नीचे", description: "ऊपर से कोमल tilt, selfie-शैली" },

  // Coverage
  "single": { label: "Single", description: "एक subject की साफ़ shot" },
  "two-shot": { label: "Two-Shot", description: "Frame में दोनों subjects" },
  "three-shot": { label: "Three-Shot", description: "Frame में तीन subjects" },
  "over-the-shoulder-framing": { label: "Over The Shoulder", description: "एक subject के कंधे के पीछे से दूसरे पर" },
  "reverse-shot": { label: "Reverse Shot", description: "पिछली shot का विपरीत POV" },
  "pov-framing": { label: "POV", description: "Subject की आँखों से" },
  "selfie-framing": { label: "Selfie", description: "बाँह की दूरी पर self-portrait" },
  "mirror-selfie": { label: "Mirror Selfie", description: "Mirror के प्रतिबिंब में phone दिखाई देता है" },
  "gym-mirror-selfie": { label: "Gym Mirror Selfie", description: "Gym mirror से 3/4 side-back angle" },
  "through-glass": { label: "काँच के पार", description: "अग्रभूमि के काँच के पार से framed" },
  "top-down-flat-lay": { label: "Top-down Flat Lay", description: "सतह पर वस्तुओं की overhead arrangement" },
  "establishing-shot": { label: "Establishing Shot", description: "Wide environmental shot, subject छोटा" },
  "dirty-single": { label: "Dirty Single", description: "किनारे पर दूसरे पात्र के साथ single" },

  // Composition
  "rule-of-thirds": { label: "Rule of Thirds", description: "Thirds intersection पर subject" },
  "centered": { label: "केंद्रित", description: "Subject बिल्कुल बीच में, सममित" },
  "headroom-tight": { label: "Headroom Tight", description: "Subject का सिर frame के top के पास" },
  "negative-space": { label: "Negative Space", description: "खाली जगह के साथ subject offset" },
  "leading-lines": { label: "Leading Lines", description: "रेखाएँ नज़र को subject की ओर खींचती हैं" },
  "3x3-grid-collage": { label: "3×3 Grid Collage", description: "बदलावों की 3×3 grid में subject" },
  "diptych": { label: "Diptych", description: "Two-frame side-by-side composition" },
  "triptych": { label: "Triptych", description: "Three-frame composition" },
  "multi-frame-mosaic": { label: "Multi-frame Mosaic", description: "छोटे tiles के mosaic से बना चेहरा" },
  "contact-sheet": { label: "Contact Sheet", description: "Thumbnails का photo contact sheet" },
  "magazine-spread": { label: "Magazine Spread", description: "Typography के साथ two-page magazine layout" },
  "cutaway-cross-section": { label: "Cutaway / Cross-Section", description: "दीवारें हटाई हुई architectural cross-section" },

  // Vantage
  "front-on": { label: "सामने से", description: "Camera की ओर देखता हुआ subject" },
  "three-quarter-front": { label: "Three-Quarter Front", description: "सामने से थोड़ा off-axis" },
  "profile-left": { label: "Profile बाएँ", description: "Side view, subject का बायाँ" },
  "profile-right": { label: "Profile दाएँ", description: "Side view, subject का दायाँ" },
  "three-quarter-back": { label: "Three-Quarter Back", description: "पीछे से off-axis" },
  "behind": { label: "पीछे से", description: "सीधा rear view" },
  "side-back-angle": { label: "Side-Back Angle", description: "एक कंधे के पीछे से 3/4 view" },
}

export default map
