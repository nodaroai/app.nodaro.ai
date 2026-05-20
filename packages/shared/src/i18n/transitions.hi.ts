import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // ── Standard ──
  "auto": { label: "ऑटो", description: "मॉडल उचित ट्रांज़िशन चुनता है" },
  "none": { label: "कोई नहीं / हार्ड कट", description: "बिना ट्रांज़िशन के तत्काल बदलाव" },
  "cross-dissolve": { label: "क्रॉस-डिसॉल्व", description: "दोनों दृश्यों के बीच क्रमिक मिश्रण" },
  "fade-to-black": { label: "काले में फ़ेड", description: "धीरे-धीरे काला होकर नया दृश्य उभरता है" },
  "fade-to-white": { label: "सफ़ेद में फ़ेड", description: "पूरी तरह सफ़ेद होकर नया दृश्य उभरता है" },
  "match-cut": { label: "मैच कट", description: "दोनों दृश्यों में आकार या गति का मिलान" },
  "smash-cut": { label: "स्मैश कट", description: "विपरीत दृश्यों के बीच अचानक कट" },
  "iris": { label: "आइरिस", description: "गोल वृत्त बंद होकर नए दृश्य पर खुलता है" },
  "wipe": { label: "वाइप", description: "रेखा फ्रेम पार करके नया दृश्य दिखाती है" },
  "roll-transition": { label: "रोल", description: "फ्रेम 90-180° घूमकर नए दृश्य पर रुकता है" },
  "seamless-match": { label: "सीमलेस मैच", description: "मिलान गति-रंग से छिपाया गया कट" },

  // ── Time ──
  "fast-forward-day-night": { label: "फ़ास्ट-फ़ॉरवर्ड (दिन → रात)", description: "उसी दृश्य में दिन से रात का टाइम-लैप्स" },
  "fast-forward-night-day": { label: "फ़ास्ट-फ़ॉरवर्ड (रात → भोर)", description: "उसी दृश्य में रात से भोर का टाइम-लैप्स" },
  "seasonal-shift": { label: "मौसमी बदलाव", description: "उसी दृश्य में चारों मौसम बदलते हैं" },
  "aging": { label: "उम्र बढ़ना", description: "पात्र कैमरे के सामने बूढ़ा होता है" },
  "rewind": { label: "रिवाइंड", description: "समय उलटा चलता है, गति पीछे जाती है" },
  "freeze-frame-jump": { label: "फ़्रीज़-फ्रेम जंप", description: "गति रुकती है, फिर किसी और पल पर कूदती है" },
  "weather-shift": { label: "मौसम बदलाव", description: "उसी दृश्य में बदलते मौसम" },
  "flashback": { label: "फ़्लैशबैक", description: "किसी पुरानी याद में संक्रमण" },

  // ── Element ──
  "dissolve-to-mist": { label: "कोहरे में घुलना", description: "पात्र कोहरे में बदलता है, फिर नया रूप लेता है" },
  "water-splash": { label: "पानी का छींटा", description: "पात्र पानी बनता है, उछलता है, फिर बनता है" },
  "sand-scatter": { label: "रेत का बिखरना", description: "पात्र रेत बनकर हवा में उड़ता है" },
  "fire-burnup": { label: "जलना", description: "पात्र जलकर अंगारा बनता है, फिर उभरता है" },
  "smoke-puff": { label: "धुएँ का गुबार", description: "पात्र धुएँ में गायब होकर फिर प्रकट होता है" },
  "magic-sparkles": { label: "जादुई चिंगारियाँ", description: "चमकते कणों में विघटन, फिर पुनर्निर्माण" },
  "lightning-flash": { label: "बिजली की चमक", description: "बिजली गिरती है, दृश्य बदल जाता है" },
  "ink-splash": { label: "स्याही का छींटा", description: "स्याही फ्रेम ढकती है, फिर नया दृश्य दिखाती है" },
  "sand-storm": { label: "रेत का तूफ़ान", description: "रेत का तूफ़ान फ्रेम ढकता है, दृश्य बदलता है" },
  "paint-splash": { label: "रंग का छींटा", description: "रंग फ्रेम ढकता है, नया दृश्य उभरता है" },
  "aurora-sweep": { label: "अरोरा की लहर", description: "अरोरा का पर्दा झूलता है, नया दृश्य दिखता है" },
  "sakura-petals": { label: "चेरी फूलों का तूफ़ान", description: "गुलाबी पंखुड़ियों का झुंड फ्रेम ढकता है" },
  "garden-bloom": { label: "बगीचे का खिलना", description: "फूल खिलकर पर्दा बनते हैं, नया दृश्य उभरता है" },
  "powder-burst": { label: "रंगीन पाउडर का विस्फोट", description: "रंगीन पाउडर का बादल फैलकर नया दृश्य दिखाता है" },

  // ── Morph ──
  "liquid-morph": { label: "तरल रूपांतरण", description: "पात्र पिघलकर नए पात्र का रूप लेता है" },
  "pixelate-reform": { label: "पिक्सलेट और पुनर्निर्माण", description: "पिक्सल बिखरकर नए पात्र बनाते हैं" },
  "shatter-glass": { label: "टूटना और पुनर्निर्माण", description: "पात्र काँच की तरह टूटकर नया रूप लेता है" },
  "origami-fold": { label: "ओरिगामी फ़ोल्ड", description: "पात्र कागज़ की तरह मुड़कर नया रूप दिखाता है" },
  "vortex-swirl": { label: "भँवर में समाना", description: "पात्र भँवर में घुमता है, नए रूप में उभरता है" },
  "dream-ripple": { label: "स्वप्न की लहर", description: "गोल लहर फ्रेम पार करके नया दृश्य दिखाती है" },
  "wireframe-morph": { label: "वायरफ्रेम रूपांतरण", description: "पात्र ज्यामितीय जाल बनकर नया रूप लेता है" },
  "polygon-shatter": { label: "पॉलीगन का बिखरना", description: "पात्र बहुभुज टुकड़ों में बंटकर नया रूप लेता है" },
  "melt-down": { label: "पिघलना और पुनर्निर्माण", description: "पात्र मोम की तरह पिघलकर नया रूप लेता है" },

  // ── Portal ──
  "zoom-into-eye": { label: "आँख में ज़ूम", description: "कैमरा पुतली में जाता है, अंदर नई दुनिया" },
  "zoom-into-mirror": { label: "दर्पण में ज़ूम", description: "कैमरा दर्पण से गुज़रकर नई दुनिया में जाता है" },
  "zoom-into-screen": { label: "स्क्रीन में ज़ूम", description: "कैमरा टीवी या फ़ोन स्क्रीन में घुसता है" },
  "zoom-into-book": { label: "किताब में ज़ूम", description: "कैमरा किताब के चित्र में जाता है" },
  "walk-through-door": { label: "दरवाज़े से गुज़रना", description: "कैमरा दरवाज़े से नए दृश्य में जाता है" },
  "fall-into-hole": { label: "गड्ढे में गिरना", description: "कैमरा गड्ढे में गिरकर नए दृश्य में उभरता है" },
  "pull-out-reveal": { label: "पीछे खिंचकर खुलासा", description: "खुलासा होता है कि दृश्य किसी तस्वीर में था" },
  "zoom-into-mouth": { label: "मुँह में ज़ूम", description: "कैमरा मुँह में जाकर नई दुनिया में निकलता है" },
  "push-through-glass": { label: "काँच से गुज़रना", description: "कैमरा काँच से गुज़रकर नई दुनिया में जाता है" },
  "soul-jump": { label: "आत्मा की छलाँग", description: "आत्मा एक शरीर से निकलकर दूसरे में जाती है" },

  // ── Physics ──
  "explosion-blast": { label: "विस्फोट की लहर", description: "विस्फोट फ्रेम पार करता है, नया दृश्य उभरता है" },
  "shockwave": { label: "शॉकवेव", description: "शॉकवेव फ्रेम को विकृत करती है, दृश्य बदलता है" },
  "punch-into-camera": { label: "कैमरे पर मुक्का", description: "मुट्ठी लेंस से टकराती है, दृश्य बदलता है" },
  "debris-shower": { label: "मलबे की बौछार", description: "मलबा फ्रेम पार करता है, दृश्य बदलता है" },
  "gravity-flip": { label: "गुरुत्वाकर्षण पलटना", description: "गुरुत्व उलट जाता है, कैमरा 180° घूमता है" },
  "building-explosion": { label: "इमारत विस्फोट", description: "इमारत फटती है, धुएँ में नया दृश्य उभरता है" },
  "vehicle-explosion": { label: "वाहन विस्फोट", description: "वाहन फटता है, आग छाती है, नया दृश्य दिखता है" },
  "jump-match": { label: "जंप मैच", description: "पात्र कूदता है, उतरने पर नए दृश्य में होता है" },
  "hand-swipe": { label: "हाथ का झटका", description: "हाथ लेंस पर झटका देता है, दृश्य बदलता है" },

  // ── Light ──
  "white-flash": { label: "सफ़ेद फ़्लैश", description: "फ्रेम सफ़ेद होता है, नया दृश्य उभरता है" },
  "lens-flare-swipe": { label: "लेंस फ़्लेयर स्वाइप", description: "अनामॉर्फिक लेंस फ़्लेयर फ्रेम पार करती है" },
  "light-streak": { label: "प्रकाश की लकीर", description: "प्रकाश की लकीर फ्रेम पार करती है, दृश्य बदलता है" },
  "color-invert": { label: "रंग इन्वर्ट फ़्लैश", description: "रंग एक पल के लिए उलट जाते हैं, दृश्य बदलता है" },
  "sun-glare": { label: "सूरज की चकाचौंध", description: "सूरज की रोशनी लेंस छाती है, नया दृश्य उभरता है" },
  "lens-crack": { label: "लेंस में दरार", description: "लेंस में दरार पड़ती है, नया दृश्य उससे दिखता है" },
  "dirty-lens-wipe": { label: "गंदे लेंस की सफ़ाई", description: "लेंस साफ़ होता है, नया दृश्य उभरता है" },
  "eye-light-burst": { label: "आँखों से प्रकाश विस्फोट", description: "पात्र की आँखों से किरण निकलकर फ्रेम ढकती है" },

  // ── Glitch ──
  "digital-glitch": { label: "डिजिटल ग्लिच", description: "RGB स्प्लिट, स्कैनलाइन, डेटामोश का घालमेल" },
  "vhs-rewind": { label: "VHS रिवाइंड", description: "VHS ट्रैकिंग और टेप-रिवाइंड आर्टिफ़ैक्ट" },
  "datamosh": { label: "डेटामोश", description: "मोशन वेक्टर का एक दृश्य से दूसरे में रिसाव" },
  "channel-flip": { label: "चैनल फ्लिप", description: "टीवी स्टैटिक और चैनल बदलने का झटका" },
  "hologram-flicker": { label: "होलोग्राम फ्लिकर", description: "होलोग्राम जैसा टिमटिमाना नया दृश्य दिखाता है" },
  "display-wipe": { label: "डिस्प्ले वाइप", description: "दृश्य छोटी स्क्रीन में सिकुड़ता है, फिर फैलता है" },
  "double-exposure": { label: "डबल एक्सपोज़र", description: "दो दृश्य पारदर्शी परत बनाते हैं, पहला फ़ेड होता है" },
}

export default map
