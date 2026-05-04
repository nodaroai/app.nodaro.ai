import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // ── Disaster ──
  "earthquake-tremor": { label: "हल्का भूकंप", description: "हल्का भूकंप, लटकी वस्तुएँ हिलती हैं" },
  "earthquake-major": { label: "भयंकर भूकंप", description: "ज़मीन फटना, मलबा गिरना" },
  "building-collapse": { label: "इमारत का ढहना", description: "गिरते-गिरते ढहती संरचना" },
  "tsunami-wave": { label: "सुनामी लहर", description: "विशाल पानी की दीवार सामने" },
  "tornado": { label: "तूफ़ानी बवंडर", description: "फ़नल बादल ज़मीन को छूता हुआ" },
  "hurricane": { label: "तूफ़ान", description: "गरजती हवाएँ पेड़ झुकातीं, बारिश की चादरें" },
  "blizzard-whiteout": { label: "हिमतूफ़ान व्हाइटआउट", description: "घनी बर्फ़ दृश्यता ख़त्म कर देती है" },
  "sandstorm": { label: "रेत का तूफ़ान", description: "नारंगी धूल की दीवार दृश्य निगलती हुई" },
  "dust-storm-haboob": { label: "धूलभरी आँधी (हबूब)", description: "विशाल रेगिस्तानी धूल मोर्चा" },
  "wildfire-distant": { label: "दूर का जंगली आग", description: "क्षितिज पर नारंगी चमक + धुआँ" },
  "wildfire-engulfing": { label: "घेरती जंगली आग", description: "लपटें पास आतीं, तीव्र गर्मी की लहरें" },
  "volcanic-eruption": { label: "ज्वालामुखी विस्फोट", description: "लावा निकलता हुआ, राख का स्तंभ" },
  "lava-flow": { label: "लावा प्रवाह", description: "ज़मीन पर रेंगती चमकती पिघली नदी" },
  "ash-rain": { label: "गिरती राख की बारिश", description: "बर्फ़ की तरह गिरती सर्वनाशी ग्रे राख" },
  "avalanche": { label: "हिमस्खलन", description: "पहाड़ की ढलान से लुढ़कती बर्फ़ की दीवार" },
  "hailstorm": { label: "ओले की वर्षा", description: "बड़े ओले सतहों से उछलते हुए" },

  // ── Fire & Blasts ──
  "explosion-small": { label: "छोटा विस्फोट", description: "केंद्रीय फ़्लैश के साथ संकुचित धमाका" },
  "explosion-large": { label: "बड़ा विस्फोट", description: "वाहन-आकार की आग का गोला मलबे के साथ" },
  "explosion-massive": { label: "विशाल विस्फोट", description: "इमारत-तबाह करने वाली आग का गोला आघात तरंग के साथ" },
  "nuclear-detonation": { label: "परमाणु विस्फोट", description: "मशरूम बादल + क्षितिज-चमकता फ़्लैश" },
  "fireball-airborne": { label: "हवाई आग का गोला", description: "हवा में लुढ़कती लपटों की गेंद" },
  "gas-explosion": { label: "गैस विस्फोट", description: "चमकीला प्रोपेन-शैली का धमाका" },
  "oil-fire": { label: "तेल की आग", description: "लंबी चिकनी लपटें + घना काला धुआँ" },
  "blazing-inferno": { label: "धधकता नरक", description: "सब कुछ निगलती आग की दीवार" },
  "flame-burst": { label: "लपटों का प्रवाह", description: "आग की त्वरित दिशात्मक धारा" },
  "ember-shower": { label: "अंगारों की बौछार", description: "चमकते नारंगी अंगारों का प्रवाह" },
  "smoke-pillar": { label: "धुएँ का स्तंभ", description: "काले धुएँ का ऊँचा खड़ा स्तंभ" },
  "mushroom-cloud": { label: "मशरूम बादल", description: "क्लासिक गुंबद-और-तना विस्फोट बादल" },

  // ── Electric ──
  "lightning-bolt": { label: "बिजली का कौंध", description: "तूफ़ानी आकाश में शाखा-दार चमक" },
  "lightning-strike-impact": { label: "बिजली का प्रहार", description: "ज़मीन पर बिजली गिरना प्रकाश के विस्फोट के साथ" },
  "lightning-storm": { label: "बिजली का तूफ़ान", description: "एक साथ कई प्रहार" },
  "ball-lightning": { label: "गोला बिजली", description: "हवा में तैरता विद्युत प्लाज़्मा का चमकता गोला" },
  "plasma-arc": { label: "प्लाज़्मा आर्क", description: "दो बिंदुओं के बीच निरंतर उच्च-वोल्टेज आर्क" },
  "taser-sparks": { label: "टेज़र चिंगारियाँ", description: "संपर्क पर संकुचित कड़कती विद्युत निर्वहन" },
  "electric-discharge": { label: "विद्युत निर्वहन", description: "ख़राब उपकरण से चाप-दार ऊर्जा का विस्फोट" },
  "transformer-blowout": { label: "ट्रांसफॉर्मर विस्फोट", description: "बिजली के खंभे पर नीला-सफ़ेद विस्फोट" },
  "st-elmos-fire": { label: "सेंट एल्मो की आग", description: "धातु छोरों पर डरावनी नीली प्लाज़्मा चमक" },
  "static-shock-burst": { label: "स्थैतिक झटका विस्फोट", description: "स्थैतिक बिजली का छोटा दिखाई देने वाला झटका" },

  // ── Combat ──
  "muzzle-flash": { label: "बंदूक की चमक", description: "बंदूक की नली से चमकीली नारंगी चमक" },
  "gunshot-impact": { label: "गोली का प्रहार", description: "गोली सतह से टकराती मलबे के छिड़काव के साथ" },
  "bullet-trail": { label: "गोली का निशान", description: "हवा से गुज़रती गोली का दिखाई देने वाला निशान" },
  "sword-spark": { label: "तलवार की चिंगारी", description: "धातु-पर-धातु घर्षण चिंगारियों की मैक्रो बौछार" },
  "blade-clash": { label: "तलवारों की भिड़ंत", description: "आघात तरंग के साथ दो ब्लेड मिलते हुए" },
  "ricochet-spark": { label: "रिकोचेट चिंगारी", description: "धातु से उछलती गोली चिंगारियों के साथ" },
  "debris-field": { label: "मलबे का क्षेत्र", description: "हवा में जमी छर्रे बिखरते हुए" },
  "glass-shatter-airborne": { label: "हवा में टूटता शीशा", description: "हवा में लटकते टुकड़ों में फूटता काँच" },
  "shockwave-ground": { label: "ज़मीनी आघात तरंग", description: "ज़मीन के स्तर पर फैलता दृश्य वलय" },
  "sonic-boom": { label: "ध्वनि बूम", description: "सुपरसोनिक गति पर संपीड़ित हवा का शंकु" },
  "smoke-grenade": { label: "धुएँ का बम", description: "घना रंगीन धुआँ बाहर की ओर फैलता हुआ" },
  "flashbang": { label: "फ़्लैशबैंग", description: "अंधा करने वाला सफ़ेद-आउट प्रकाश का विस्फोट" },
  "blood-spray": { label: "रक्त छिड़काव", description: "ख़ून की बूँदों का सिनेमाई चाप" },
  "arrow-hit-spark": { label: "तीर के प्रहार की चिंगारी", description: "तीर के प्रहार के बिंदु पर छोटी चिंगारियाँ" },

  // ── Sci-Fi ──
  "laser-blast": { label: "लेज़र विस्फोट", description: "ऊर्जा की चमकीली समेकित किरण" },
  "energy-beam": { label: "ऊर्जा किरण", description: "प्लाज़्मा ऊर्जा की चौड़ी स्पंदित किरण" },
  "plasma-bolt": { label: "प्लाज़्मा बोल्ट", description: "वाष्प निशान छोड़ता चमकता प्रक्षेपास्त्र" },
  "force-field-shimmer": { label: "बल क्षेत्र की झिलमिलाहट", description: "हेक्स-पैटर्न पारदर्शी ऊर्जा अवरोध" },
  "force-field-impact": { label: "बल क्षेत्र पर प्रहार", description: "जहाँ प्रक्षेपास्त्र ढाल पर लगता है, दृश्य लहरें" },
  "portal-opening": { label: "पोर्टल का खुलना", description: "अंतरिक्ष को चीरती ऊर्जा का घूमता भँवर" },
  "warp-distortion": { label: "वार्प विकृति", description: "एक वस्तु के चारों ओर मुड़ता दिक्-काल" },
  "hologram-flicker": { label: "होलोग्राम झिलमिलाहट", description: "ग्लिच होता पारदर्शी प्रक्षेपण" },
  "ion-storm": { label: "आयन तूफ़ान", description: "ब्रह्मांडीय पृष्ठभूमि पर आवेशित कणों का कड़कता क्षेत्र" },
  "antimatter-flash": { label: "एंटीमैटर फ़्लैश", description: "वास्तविकता-चीरने वाला शुद्ध सफ़ेद ऊर्जा का विस्फोट" },

  // ── Magic ──
  "fireball-spell": { label: "अग्निगोला मंत्र", description: "हाथ से छोड़ा घूमता आग का गोला" },
  "magic-aura": { label: "जादुई आभा", description: "एक आकृति के चारों ओर ऊर्जा का चमकता प्रभामंडल" },
  "summoning-glyph": { label: "आह्वान चिह्न", description: "ज़मीन पर चमकता जादुई वृत्त" },
  "lightning-magic": { label: "बिजली का जादू", description: "जादूगर के हाथों से निकलता विद्युत जादू" },
  "ice-shard-burst": { label: "बर्फ़ शार्ड विस्फोट", description: "बाहर की ओर बिखरते क्रिस्टलीय टुकड़े" },
  "energy-rune": { label: "ऊर्जा रून", description: "हवा में लटका चमकता रहस्यमय प्रतीक" },
  "portal-magic": { label: "जादुई पोर्टल", description: "अंतरिक्ष में घूमता रहस्यमय द्वार" },
  "healing-glow": { label: "उपचार चमक", description: "जादूगर से निकलती गर्म सुनहरी रोशनी" },
  "dark-vortex": { label: "अंधकार भँवर", description: "अशुभ काला-बैंगनी घूमता शून्य" },
  "light-explosion": { label: "प्रकाश विस्फोट", description: "शुद्ध सफ़ेद-सुनहरी आभा का विस्फोट" },
}

export default map
