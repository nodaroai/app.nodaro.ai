import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // -------------------- Standing --------------------
  "standing-upright": { label: "सीधे खड़ा", description: "आरामदायक खड़ी मुद्रा" },
  "confident-stance": { label: "आत्मविश्वासी मुद्रा", description: "पैर अलग, कंधे पीछे" },
  "hands-on-hips": { label: "कमर पर हाथ", description: "कमर पर हाथ" },
  "arms-crossed": { label: "बाँहें cross की हुई", description: "छाती पर मुड़ी हुई बाँहें" },
  "leaning": { label: "टेक लगाकर", description: "किसी चीज़ के सहारे टेक लगाकर" },
  "hero-pose": { label: "Hero Pose", description: "Dramatic वीर मुद्रा" },
  "contrapposto": { label: "Contrapposto", description: "कूल्हा झुका हुआ, एक टाँग पर भार" },
  "leaning-against-wall": { label: "दीवार से टेक", description: "दीवार से सहज टेक लगाकर" },
  "hands-behind-head": { label: "सिर के पीछे हाथ", description: "दोनों हाथ सिर के पीछे clasped" },
  "hands-behind-back": { label: "पीठ के पीछे हाथ", description: "हाथ पीठ के पीछे clasped" },

  // -------------------- Seated --------------------
  "sitting": { label: "बैठा हुआ", description: "स्वाभाविक रूप से बैठा हुआ" },
  "cross-legged": { label: "Cross-legged", description: "फ़र्श पर पालथी मारकर" },
  "kneeling": { label: "घुटनों के बल", description: "ज़मीन पर घुटनों के बल" },
  "crouching": { label: "उकड़ूँ", description: "नीचे उकड़ूँ" },
  "lounging": { label: "Lounging", description: "झुका हुआ, आरामदायक बैठना" },
  "sitting-edge-of-bed": { label: "बिस्तर के किनारे बैठा", description: "बिस्तर के किनारे बैठा हुआ" },
  "chair-arm-drape": { label: "कुर्सी पर टाँगें draped", description: "कुर्सी की arm पर टाँगें draped" },
  "elbow-propped": { label: "Propped कोहनी पर गाल", description: "Propped कोहनी पर गाल टिका हुआ" },
  "lying-on-stomach-reading": { label: "पेट के बल पढ़ते हुए", description: "पेट के बल लेटकर, कोहनियों पर propped होकर पढ़ते हुए" },

  // -------------------- Movement --------------------
  "walking": { label: "चलते हुए", description: "Mid-stride चलते हुए" },
  "running": { label: "दौड़ते हुए", description: "Mid-run, गति में" },
  "jumping": { label: "कूदते हुए", description: "हवा में, mid-jump" },
  "dancing": { label: "नाचते हुए", description: "Mid-dance में पकड़ा हुआ" },
  "climbing": { label: "चढ़ते हुए", description: "चढ़ते हुए, ऊपर की ओर पकड़ते हुए" },
  "mid-fall": { label: "Mid-Fall", description: "हवा में mid-fall पकड़ा हुआ" },
  "mid-spin": { label: "Mid-Spin", description: "घूमते हुए, mid-rotation" },
  "stretching": { label: "Stretching", description: "बाँहें ऊपर पूरा-बदन stretch" },
  "reaching-up": { label: "ऊपर पहुँचना", description: "बाँहें ऊपर बढ़ी हुई" },
  "kissing": { label: "चूमते हुए", description: "Kiss में बंद" },
  "riding": { label: "सवारी", description: "साइकिल, घोड़े या motorcycle की सवारी" },
  "driving": { label: "गाड़ी चलाते हुए", description: "वाहन का steering wheel पकड़े हुए" },

  // -------------------- Action --------------------
  "fighting-stance": { label: "Fighting Stance", description: "Combat-ready मुद्रा" },
  "reaching": { label: "पहुँचते हुए", description: "बाहर की ओर पहुँचते हुए" },
  "throwing": { label: "फेंकते हुए", description: "Mid-throw motion" },
  "leaping": { label: "उछलते हुए", description: "गतिशील रूप से आगे उछलते हुए" },
  "dramatic-action": { label: "Dramatic Action", description: "Exaggerated action pose" },
  "biting-lip": { label: "होंठ काटते हुए", description: "हल्का चंचल lip-bite" },
  "mid-laugh": { label: "Mid-Laugh", description: "Mid-laugh में पकड़ा हुआ, सिर पीछे" },
  "pointing-at-camera": { label: "Camera की ओर इशारा", description: "Camera की ओर सीधा इशारा करते हुए" },
  "tongue-out": { label: "जीभ निकाली हुई", description: "चंचल जीभ-out अभिव्यक्ति" },
  "thinking": { label: "सोचते हुए", description: "ठुड्डी पर हाथ, contemplative" },

  // -------------------- Resting --------------------
  "lying-down": { label: "लेटा हुआ", description: "सपाट लेटा हुआ" },
  "sleeping": { label: "सोता हुआ", description: "आँखें बंद, सोता हुआ" },
  "hugging": { label: "गले लगाते हुए", description: "किसी और को गले लगाते हुए" },
  "looking-away": { label: "दूर देखते हुए", description: "सिर मुड़ा हुआ, दूर देखते हुए" },
  "looking-up": { label: "ऊपर देखते हुए", description: "आसमान की ओर देखते हुए" },
  "looking-down": { label: "नीचे देखते हुए", description: "आँखें झुकी हुई" },
  "head-over-shoulder": { label: "कंधे पर सिर", description: "कंधे पर देखते हुए पीछे की ओर" },
  "wading-in-water": { label: "पानी में चलते हुए", description: "पानी में जाँघ-गहराई तक चलते हुए" },

  // -------------------- Hand Position --------------------
  "hands-in-pockets": { label: "जेबों में हाथ", description: "दोनों हाथ जेबों में डाले हुए" },
  "hand-on-hip": { label: "कूल्हे पर हाथ", description: "एक हाथ कूल्हे पर" },
  "hand-position-hands-on-hips": { label: "कमर पर हाथ", description: "दोनों हाथ कमर पर" },
  "hand-on-chin": { label: "ठुड्डी पर हाथ", description: "ठुड्डी के नीचे टिका हुआ हाथ" },
  "hand-on-collarbone": { label: "Collarbone पर हाथ", description: "Collarbone पर टिका हुआ हाथ" },
  "hand-brushing-hair": { label: "बालों में हाथ", description: "बालों में चलता हाथ" },
  "finger-to-lip": { label: "होंठ पर उँगली", description: "निचले होंठ पर उँगली का सिरा दबा हुआ" },
  "arms-wrapped-around-self": { label: "ख़ुद को गले लगाए", description: "Self-hug, धड़ के चारों ओर बाँहें" },
  "hands-clasped": { label: "हाथ clasped", description: "दोनों हाथ सामने clasped" },

  // -------------------- Body Lean --------------------
  "leaning-back": { label: "पीछे झुका", description: "धड़ हल्के से पीछे झुका हुआ" },
  "leaning-forward": { label: "आगे झुका", description: "धड़ camera की ओर झुका हुआ" },
  "body-lean-contrapposto": { label: "Contrapposto", description: "एक टाँग पर भार, कूल्हा बाहर धकेला" },
  "arched-back": { label: "Arched पीठ", description: "पीठ हल्के से arched, छाती आगे" },
  "shoulder-rolled-forward": { label: "कंधा आगे rolled", description: "एक कंधा आगे rolled" },

  // -------------------- Head Tilt --------------------
  "tilted-up": { label: "ऊपर tilted", description: "सिर हल्का ऊपर tipped" },
  "tilted-down": { label: "नीचे tilted", description: "सिर हल्का नीचे tipped" },
  "tilted-side": { label: "Side पर tilted", description: "सिर कंधे की ओर tilted" },
  "tilted-back": { label: "पीछे tilted", description: "सिर पूरी तरह पीछे, गला दिखाई देता" },
  "chin-up": { label: "ठुड्डी ऊपर", description: "ठुड्डी उठी हुई, नाक से नीचे देखते हुए" },
  "chin-tucked": { label: "ठुड्डी छाती में", description: "ठुड्डी छाती में tucked" },

  // -------------------- Activity --------------------
  "activity-smoking": { label: "Smoking", description: "Cigarette पकड़ते और पीते हुए" },
  "activity-drinking": { label: "पीते हुए", description: "गिलास या cup से पीते हुए" },
  "activity-eating": { label: "खाते हुए", description: "Mid-bite में पकड़ा हुआ" },
  "activity-talking-on-phone": { label: "फ़ोन पर बात करते हुए", description: "Phone कान से लगाए, बोलते हुए" },
  "activity-texting": { label: "Texting", description: "Phone पर नीचे देखते हुए, अंगूठे type करते हुए" },
  "activity-typing-laptop": { label: "Laptop पर Typing", description: "Keyboard पर हाथ, screen पर ध्यान" },
  "activity-reading": { label: "पढ़ते हुए", description: "किताब या magazine खोले हुए" },
  "activity-writing": { label: "लिखते हुए", description: "Pen से notebook में लिखते हुए" },
  "activity-painting": { label: "पेंटिंग करते हुए", description: "Brush से canvas पर painting करते हुए" },
  "activity-playing-instrument": { label: "वाद्य बजाते हुए", description: "संगीत वाद्य बजाते हुए" },
  "activity-cooking": { label: "खाना बनाते हुए", description: "Kitchen counter या stove पर खाना बनाते हुए" },
  "activity-driving": { label: "गाड़ी चलाते हुए", description: "Wheel के पीछे, हाथ पकड़े हुए" },
}

export default map
