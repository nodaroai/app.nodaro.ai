import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // -------------------- Positive --------------------
  "happy": { label: "ख़ुश", description: "गर्म, मुस्कुराती ख़ुशी" },
  "joyful": { label: "हर्षित", description: "उज्ज्वल, बेलगाम आनंद" },
  "serene": { label: "शांत", description: "शांत, peaceful संतोष" },
  "playful": { label: "चंचल", description: "शरारती, चंचल ऊर्जा" },
  "confident": { label: "आत्मविश्वासी", description: "Self-assured, आत्मविश्वासी" },
  "loving": { label: "प्यार भरा", description: "कोमल, स्नेहपूर्ण" },
  "amused": { label: "मनोरंजित", description: "हल्के से मनोरंजित, smirking" },
  "smirking": { label: "Smirking", description: "घमंडी, अहंकारी मनोरंजन" },
  "eccentric": { label: "विलक्षण", description: "अनोखा, अपरंपरागत" },
  "hopeful": { label: "आशावान", description: "उज्ज्वल आँखों वाला, आशावादी" },

  // -------------------- Negative --------------------
  "sad": { label: "उदास", description: "शांति से उदास, downcast" },
  "angry": { label: "ग़ुस्सा", description: "स्पष्ट ग़ुस्सा, तनाव" },
  "afraid": { label: "डरा हुआ", description: "भयभीत, चौड़ी आँखें" },
  "anxious": { label: "बेचैन", description: "घबराया हुआ, चिंतित" },
  "melancholy": { label: "उदासी", description: "Wistful उदासी" },
  "devastated": { label: "तबाह", description: "टूटे दिल वाला दुख" },
  "grieving": { label: "शोक में", description: "गहरा शोक, हानि" },
  "caught-off-guard": { label: "अचानक चौंका", description: "Mid-reaction में चौंका हुआ" },
  "aloof": { label: "उदासीन", description: "विमुख, अरुचि" },
  "vulnerable": { label: "कमज़ोर", description: "उजागर, असहाय" },
  "coy": { label: "Coy", description: "शरमीला, downcast" },
  "bored": { label: "ऊबा हुआ", description: "अरुचि, deadpan" },
  "embarrassed": { label: "शर्मिंदा", description: "Blushing, आँखें झुकी हुई" },
  "disgusted": { label: "घृणा भरा", description: "Repulsed, पीछे हटता हुआ" },
  "bewildered": { label: "हैरान", description: "उलझा हुआ, खोया हुआ" },

  // -------------------- Neutral --------------------
  "thoughtful": { label: "विचारशील", description: "सोच में डूबा हुआ" },
  "stoic": { label: "Stoic", description: "Impassive, अपठनीय" },
  "calm": { label: "शांत", description: "केंद्रित, अप्रतिक्रियाशील" },
  "curious": { label: "जिज्ञासु", description: "Intrigued, सतर्क" },
  "mysterious": { label: "रहस्यमय", description: "अबूझ, पहेली जैसा" },
  "dazed": { label: "हक्का-बक्का", description: "Dreamy, आधा-उपस्थित" },
  "sleepy": { label: "नींद भरा", description: "Drowsy, भारी पलकों वाला" },
  "unbothered": { label: "बेपरवाह", description: "शांत self-possession" },

  // -------------------- Intense --------------------
  "fierce": { label: "उग्र", description: "उग्र, दमदार" },
  "determined": { label: "दृढ़", description: "Resolute, केंद्रित इच्छाशक्ति" },
  "passionate": { label: "जोशीला", description: "जलता हुआ जुनून" },
  "brooding": { label: "Brooding", description: "गहरी, brooding melancholy" },
  "seductive": { label: "Seductive", description: "आकर्षक, मोहक" },
  "defiant": { label: "विद्रोही", description: "विद्रोही, अडिग" },
  "sultry": { label: "Sultry", description: "Smoldering, भारी पलकों वाला" },
  "smoldering": { label: "Smoldering", description: "Coiled, धीमी-जलती तीव्रता" },
  "sinister": { label: "अशुभ", description: "गहरा, दुर्भावनापूर्ण, धमकीभरा" },
  "wiccan-mystical": { label: "Wiccan / Mystical", description: "शांति से अलौकिक, occult" },
  "lazy-shy": { label: "Lazy Shy", description: "Drowsy, मुलायम, आधा-शरमीला" },
  "awe": { label: "विस्मय", description: "अचंभा, श्रद्धावान" },
  "shocked": { label: "हैरान", description: "चौंका हुआ, मुँह खुला" },

  // -------------------- Round 2 --------------------
  "flirty": { label: "Flirty", description: "चंचल flirtation, ठहरी हुई मुस्कान, बनाए रखा eye contact" },
  "suspicious": { label: "संदेहास्पद", description: "सावधान अविश्वास, सिकुड़ी आँखें, side-eye" },
  "resigned": { label: "विवश", description: "किसी अप्रिय स्थिति की शांत स्वीकार्यता" },
  "conflicted": { label: "द्वंद्वग्रस्त", description: "दिखाई देता आंतरिक संघर्ष, भौंहें सिकुड़ी हुई" },
  "relieved": { label: "राहत", description: "तनाव शांत हो जाता है" },
}

export default map
