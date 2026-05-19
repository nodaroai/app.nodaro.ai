import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // ── Transformation ──
  "auto": { label: "ऑटो", description: "मॉडल उचित प्रभाव चुनता है" },
  "none": { label: "कोई नहीं", description: "कोई चरित्र प्रभाव नहीं" },
  "werewolf": { label: "वेयरवुल्फ़", description: "वेयरवुल्फ़ में रूपांतरण" },
  "vampire": { label: "पिशाच", description: "पिशाच में रूपांतरण" },
  "cyborg": { label: "साइबॉर्ग उद्घाटन", description: "त्वचा खुलकर साइबरनेटिक तंत्र दिखाती है" },
  "ghost-form": { label: "भूत रूप", description: "शरीर पारदर्शी और अलौकिक हो जाता है" },
  "statue-stone": { label: "पत्थर में बदलना", description: "शरीर पत्थर की मूर्ति बन जाता है" },
  "liquid-metal": { label: "तरल धातु", description: "T-1000 शैली में तरल क्रोम धातु रूप" },
  "animalization": { label: "पशु रूपांतरण", description: "जानवर में बदलना" },
  "gorilla-form": { label: "गोरिल्ला रूप", description: "विशाल गोरिल्ला में रूपांतरण" },
  "mystification": { label: "जादुई रूपांतरण", description: "जादुई आभा चरित्र को ढककर बदल देती है" },
  "gas-form": { label: "गैस रूपांतरण", description: "शरीर रंगीन गैस के बादल में बदल जाता है" },
  "diamond-skin": { label: "हीरे की त्वचा", description: "शरीर हीरे के पहलुओं में बदल जाता है" },
  "agent-reveal": { label: "एजेंट उद्घाटन", description: "सूट और धूप के चश्मे चरित्र पर प्रकट होते हैं" },

  // ── Power ──
  "fire-breathe": { label: "आग की साँस", description: "लौ की निरंतर धारा उगलता है" },
  "ice-breathe": { label: "बर्फ़ की साँस", description: "जमी हुई हवा की धारा छोड़ता है" },
  "air-bending": { label: "वायु मोड़", description: "दृश्य वायु भँवर को नियंत्रित करता है" },
  "water-bending": { label: "जल मोड़", description: "इशारों से पानी की धारा नियंत्रित करता है" },
  "earth-bending": { label: "पृथ्वी मोड़", description: "ज़मीन से पत्थर की शिलाएँ उठाता है" },
  "lightning-hands": { label: "बिजली के हाथ", description: "हाथों से विद्युत चाप निकलते हैं" },
  "levitation": { label: "उत्तोलन", description: "ज़मीन से ऊपर उठता है, शरीर ऊर्ध्वाधर या क्षैतिज" },
  "telekinesis": { label: "टेलीकिनेसिस", description: "पास की वस्तुएँ तैरकर चारों ओर परिक्रमा करती हैं" },
  "invisibility": { label: "अदृश्यता", description: "शरीर पारदर्शी होकर अदृश्य हो जाता है" },
  "hero-flight": { label: "नायक उड़ान", description: "नायक मुद्रा में आकाश में उड़ान भरता है" },
  "super-speed": { label: "सुपर स्पीड", description: "कई परछाइयों के साथ अति-तीव्र गति" },
  "soul-departure": { label: "आत्मा का निकलना", description: "पारदर्शी आत्मा शरीर से बाहर उठती है" },

  // ── Body-Mod ──
  "wings-grow": { label: "पंख उगना", description: "पीठ से पंख फूटकर फैलते हैं" },
  "horns-grow": { label: "सींग उभरना", description: "सिर से सींग बाहर निकलते हैं" },
  "tail-emerge": { label: "पूँछ उभरना", description: "रीढ़ के आधार से पूँछ निकलती है" },
  "tentacles-emerge": { label: "स्पर्शक उभरना", description: "पीठ या शरीर से लहराते स्पर्शक निकलते हैं" },
  "extra-eyes": { label: "अतिरिक्त आँखें खुलना", description: "चेहरे और शरीर पर अतिरिक्त आँखें खुलती हैं" },
  "head-explode": { label: "सिर का विस्फोट", description: "सिर अमूर्त कणों में फटता है (PG-13 शैली)" },
  "head-off": { label: "सिर हटाना", description: "सिर अलग होकर तैरता है (शैलीबद्ध, PG-13)" },
  "spiders-from-mouth": { label: "मुँह से मकड़ियाँ", description: "खुले मुँह से मकड़ियाँ रेंगती हैं (हॉरर)" },
  "skin-surge": { label: "त्वचा की लहर", description: "त्वचा के नीचे कुछ हिलने जैसी लहरें" },

  // ── Face-Expression ──
  "horror-face": { label: "डरावना चेहरा", description: "चेहरा भयानक भाव में विकृत हो जाता है" },
  "oni-mask": { label: "ओनी मुखौटा", description: "लाल-सुनहरा राक्षसी मुखौटा चेहरे पर आता है" },
  "glowing-eyes": { label: "चमकती आँखें", description: "आँखें आंतरिक प्रकाश से जगमगाती हैं" },
  "floral-eyes": { label: "फूल जैसी आँखें", description: "आँखों के सॉकेट से फूल खिलते हैं" },
  "bloom-mouth": { label: "खिलता मुँह", description: "खुले मुँह से फूल और बेलें बाहर आती हैं" },
  "x-ray": { label: "एक्स-रे उद्घाटन", description: "शरीर एक्स-रे शैली में पारदर्शी होकर हड्डियाँ दिखाता है" },
  "agent-snap": { label: "धूप का चश्मा लगाना", description: "धूप के चश्मे आँखों पर झटके से लग जाते हैं" },
  "visor-x": { label: "साइबर वाइज़र", description: "भविष्यवादी साइबरनेटिक वाइज़र चेहरे पर प्रकट होता है" },

  // ── Aura-Ambient ──
  "paparazzi": { label: "पापाराज़ी फ़्लैश", description: "कैमरे के फ़्लैश चरित्र के चारों ओर चमकते हैं" },
  "money-rain": { label: "पैसों की बारिश", description: "नोट चरित्र के चारों ओर बरसते हैं" },
  "color-rain": { label: "रंगीन बारिश", description: "चमकीली रंगीन बूँदें चरित्र के आसपास गिरती हैं" },
  "saint-glow": { label: "संत की चमक", description: "सुनहरी प्रभामंडल और दिव्य प्रकाश चरित्र के चारों ओर" },
  "fire-aura": { label: "अग्नि आभा", description: "ज्वालाएँ चरित्र के शरीर के चारों ओर नाचती हैं" },
  "frost-aura": { label: "बर्फ़ आभा", description: "बर्फ़ और पाला चरित्र से बाहर की ओर फैलते हैं" },
  "shadow-aura": { label: "छाया आभा", description: "अंधेरे छाया के तंतु चरित्र के चारों ओर लहराते हैं" },
  "electricity-aura": { label: "विद्युत आभा", description: "टेस्ला-कॉइल जैसी विद्युत चापें चरित्र के चारों ओर" },
  "sparkles-around": { label: "जादुई चिंगारियाँ", description: "जादुई चिंगारियाँ चरित्र के चारों ओर परिक्रमा करती हैं" },
  "fairies-around": { label: "परियाँ आस-पास", description: "छोटी चमकती परियाँ चरित्र के चारों ओर उड़ती हैं" },
  "objects-orbit": { label: "वस्तुएँ परिक्रमा करती हैं", description: "छोटी वस्तुएँ चरित्र के चारों ओर तैरती हैं" },
  "petals-around": { label: "पंखुड़ियाँ आस-पास", description: "चेरी की पंखुड़ियाँ चरित्र के चारों ओर बरसती हैं" },
  "glow-trace": { label: "प्रकाश निशान", description: "चरित्र की गतिविधियों के पीछे प्रकाश के निशान" },
  "tattoo-animation": { label: "टैटू एनिमेशन", description: "त्वचा के टैटू चमककर हिलने लगते हैं" },
}

export default map
