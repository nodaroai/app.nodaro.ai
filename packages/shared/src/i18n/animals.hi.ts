import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // -------------------- Cats --------------------
  "cat-persian": { label: "Persian बिल्ली", description: "लंबे बालों वाली बिल्ली, चपटा चेहरा, मज़बूत शरीर और शानदार रोएँदार कोट" },
  "cat-siamese": { label: "Siamese बिल्ली", description: "चिकनी छोटे बालों वाली बिल्ली, क्रीम बदन, चेहरे, कानों, पंजों और पूँछ पर गहरे रंग के निशान, और चमकीली नीली बादाम-आकार की आँखें" },
  "cat-maine-coon": { label: "Maine Coon", description: "बहुत बड़ी लंबे बालों वाली बिल्ली, झबरा रफ़, गुच्छेदार कान और घनी छल्लेदार पूँछ" },
  "cat-bengal": { label: "Bengal बिल्ली", description: "मांसल फुर्तीली बिल्ली, सुनहरे और भूरे रंग में तेंदुए-जैसे rosette पैटर्न का चिकना कोट" },
  "cat-sphynx": { label: "Sphynx बिल्ली", description: "बाल रहित झुर्रीदार बिल्ली, बड़े bat-जैसे कान, उभरे गाल और सुडौल मांसल शरीर" },
  "cat-ragdoll": { label: "Ragdoll बिल्ली", description: "बड़ी अर्ध-लंबे बालों वाली बिल्ली, मुलायम रेशमी कोट, रंग के बिंदु और चमकीली नीली आँखें" },
  "cat-british-shorthair": { label: "British Shorthair", description: "गोल-चेहरे वाली प्लश बिल्ली, घना नीला-धूसर कोट, गोलमटोल गाल और तांबई आँखें" },
  "cat-scottish-fold": { label: "Scottish Fold", description: "गोल चेहरे वाली बिल्ली, छोटे मुड़े हुए कान, मज़बूत बदन और बड़ी गोल उल्लू-जैसी आँखें" },
  "cat-tabby": { label: "Tabby बिल्ली", description: "क्लासिक धारीदार छोटे बालों वाली बिल्ली, माथे पर M का निशान और सतर्क हरी आँखें" },
  "cat-black": { label: "काली बिल्ली", description: "चिकनी पूरी काली छोटे बालों वाली बिल्ली, चमकीली पीली-हरी आँखें और चमकदार कोट" },

  // -------------------- Dogs --------------------
  "dog-labrador": { label: "Labrador Retriever", description: "मित्रवत मध्यम-बड़ा खेल कुत्ता, छोटा घना कोट पीले, काले या चॉकलेट रंग में और मोटी otter पूँछ" },
  "dog-golden-retriever": { label: "Golden Retriever", description: "मध्यम-बड़ा कुत्ता, लहराते सुनहरे कोट के साथ शानदार रूप, पंखदार पूँछ और गर्म मित्रवत चेहरा" },
  "dog-german-shepherd": { label: "German Shepherd", description: "मज़बूत सतर्क काम करने वाला कुत्ता, tan और काले saddle कोट के साथ, सीधे कान और घनी पूँछ" },
  "dog-bulldog": { label: "Bulldog", description: "मज़बूत मांसल छोटे बालों वाला कुत्ता, झुर्रीदार चपटा चेहरा, चौड़ा जबड़ा और लटकती जौल" },
  "dog-poodle": { label: "Poodle", description: "लालित्यपूर्ण घुँघराले कोट वाला कुत्ता, गर्वीली मुद्रा और क्लासिक groomed silhouette" },
  "dog-husky": { label: "Siberian Husky", description: "मोटे double कोट वाला कुत्ता, काले-सफ़ेद निशान, चमकीली नीली या दो-रंगी आँखें और सीधे त्रिकोणीय कान" },
  "dog-beagle": { label: "Beagle", description: "छोटा तीन-रंगी hound, लंबे लटकते कान, छोटा कोट और सफ़ेद-सिरे वाली पूँछ" },
  "dog-dachshund": { label: "Dachshund", description: "लंबा नीचा कुत्ता, छोटी टाँगें, गहरी छाती और लंबे लटकते कान" },
  "dog-chihuahua": { label: "Chihuahua", description: "बहुत छोटा खिलौना कुत्ता, सेब के आकार का सिर, बहुत बड़े सीधे कान और बड़ी सतर्क आँखें" },
  "dog-corgi": { label: "Corgi", description: "छोटी टाँगों वाला herding कुत्ता, लोमड़ी जैसा चेहरा, बहुत बड़े सीधे कान और लाल-सफ़ेद रंग का प्लश double कोट" },
  "dog-pug": { label: "Pug", description: "छोटा मज़बूत कुत्ता, गहरी झुर्रीदार चपटे चेहरे वाला, घुँघराली पूँछ और काले मास्क के साथ fawn कोट" },
  "dog-border-collie": { label: "Border Collie", description: "फुर्तीला मध्यम herding कुत्ता, काला-सफ़ेद कोट, तीव्र नज़र और पंखदार पूँछ" },
  "dog-rottweiler": { label: "Rottweiler", description: "शक्तिशाली मांसल कुत्ता, छोटा चमकदार काला कोट और चेहरे, छाती और टाँगों पर विशिष्ट महोगनी निशान" },
  "dog-shiba-inu": { label: "Shiba Inu", description: "कॉम्पैक्ट spitz-प्रकार का कुत्ता, लाल-नारंगी कोट, घुँघराली पूँछ, सीधे त्रिकोणीय कान और लोमड़ी-जैसा चेहरा" },

  // -------------------- Transport / Working --------------------
  "horse": { label: "घोड़ा", description: "मज़बूत सुंदर घोड़ा, बहती अयाल और पूँछ, मज़बूत खुर और मांसल शरीर" },
  "camel": { label: "ऊँट", description: "रेगिस्तानी ऊँट, ऊँची कूबड़, लंबी टाँगें, चौड़े गद्देदार पैर और शांत चेहरा" },
  "donkey": { label: "गधा", description: "छोटा मज़बूत गधा, लंबे कान, छोटी सीधी अयाल और कोमल चेहरा" },
  "mule": { label: "खच्चर", description: "मज़बूत pack खच्चर, लंबे कान, छोटी गहरी अयाल और कॉम्पैक्ट मांसल शरीर" },
  "ox": { label: "बैल", description: "विशाल काम करने वाला बैल, चौड़े कंधे, घुमावदार सींग और शांत चेहरा" },

  // -------------------- Farm --------------------
  "cow": { label: "गाय", description: "डेयरी गाय, सफ़ेद-काले धब्बेदार खाल, बड़ा थन और कोमल भूरी आँखें" },
  "pig": { label: "सूअर", description: "मज़बूत गुलाबी farm सूअर, घुमावदार पूँछ, गोल थूथन और सीधे कान" },
  "sheep": { label: "भेड़", description: "रोएँदार ऊनी भेड़, मोटा क्रीम fleece, गहरा चेहरा और छोटी टाँगें" },
  "goat": { label: "बकरी", description: "फुर्तीली बकरी, झबरा कोट, घुमावदार सींग, दाढ़ी का गुच्छा और आयताकार पुतलियाँ" },
  "chicken": { label: "मुर्ग़ी", description: "सामान्य farm मुर्ग़ी, लाल कलगी और wattles, पंखदार बदन और सतर्क झुका हुआ सिर" },
  "rooster": { label: "मुर्ग़ा", description: "गर्वीला मुर्ग़ा, ऊँची लाल कलगी, चमकीले हरे-तांबे के पंख और लंबी मेहराबदार पूँछ" },
  "duck": { label: "बत्तख़", description: "सफ़ेद-भूरे रंग की farm बत्तख़, नारंगी चोंच, जालदार पैर और गोल पुठ्ठा" },
  "rabbit": { label: "ख़रगोश", description: "रोएँदार ख़रगोश, लंबे सीधे कान, फड़कती नाक और रुई जैसी पूँछ" },
  "turkey": { label: "टर्की", description: "बड़ा टर्की, गहरे चमकीले पंखों का पंखा, खुला लाल सिर और लटकता snood" },

  // -------------------- Wild --------------------
  "lion": { label: "शेर", description: "शक्तिशाली नर शेर, चौड़े tawny चेहरे को घेरती मोटी सुनहरी अयाल और मांसल शरीर" },
  "tiger": { label: "बाघ", description: "विशाल बाघ, चमकीले नारंगी फ़र, गहरी काली धारियाँ और तीव्र अंबर आँखें" },
  "bear": { label: "भालू", description: "बड़ा भूरा भालू, मोटा झबरा फ़र, चौड़ा सिर, गोल कान और शक्तिशाली पंजे" },
  "polar-bear": { label: "ध्रुवीय भालू", description: "विशाल आर्कटिक भालू, मोटा क्रीम-सफ़ेद फ़र, लंबी गर्दन, काली नाक और बड़े गद्देदार पंजे" },
  "wolf": { label: "भेड़िया", description: "दुबला धूसर भेड़िया, मोटा double कोट, सीधे कान, तीव्र पीली आँखें और घनी पूँछ" },
  "fox": { label: "लोमड़ी", description: "पतली लाल लोमड़ी, तीखा नुकीला थूथन, सीधे कान और लंबी सफ़ेद-सिरे वाली घनी पूँछ" },
  "elephant": { label: "हाथी", description: "विशाल हाथी, झुर्रीदार धूसर खाल, लंबी सूँड, चौड़े फड़फड़ाते कान और घुमावदार ivory दाँत" },
  "zebra": { label: "ज़ेब्रा", description: "मज़बूत घोड़े-जैसा ज़ेब्रा, गहरी काली-सफ़ेद धारियाँ, छोटी सीधी अयाल और बड़ी गहरी आँखें" },
  "giraffe": { label: "जिराफ़", description: "लंबा सुंदर जिराफ़, असाधारण रूप से लंबी गर्दन, सुनहरा patchwork कोट और छोटे ossicone सींग" },
  "panda": { label: "विशाल Panda", description: "गोलमटोल panda, काला-सफ़ेद कोट, गोल कान, विशिष्ट काले eye-patch और कोमल चेहरा" },
  "leopard": { label: "तेंदुआ", description: "चिकना धब्बेदार तेंदुआ, rosette से ढका tawny कोट, मांसल कंधे और तीव्र पीली आँखें" },
  "cheetah": { label: "Cheetah", description: "पतला तेज़ दौड़ने वाला cheetah, सुनहरा कोट ठोस काले धब्बों के साथ और चेहरे पर tear-track रेखाएँ" },
  "monkey": { label: "बंदर", description: "फुर्तीला लंबी पूँछ वाला बंदर, अभिव्यक्तिपूर्ण भूरी आँखें, पतले अंग और मुलायम भूरा-क्रीम कोट" },
  "gorilla": { label: "Gorilla", description: "विशाल silverback gorilla, चौड़े कंधे, उभरी हुई भौंह की हड्डी और मोटा काला फ़र" },
  "kangaroo": { label: "Kangaroo", description: "लंबा kangaroo, शक्तिशाली पिछली टाँगें, मोटी मांसल पूँछ, छोटे आगे के पंजे और सीधे सतर्क कान" },
  "koala": { label: "Koala", description: "रोएँदार धूसर marsupial, गोल सिर, बड़े फूले हुए कान, बड़ी काली नाक और मुलायम रोएँदार छाती" },
  "deer": { label: "हिरण", description: "सुंदर हिरण, लाल-भूरा कोट, पतली टाँगें, गले पर सफ़ेद धब्बा और — नर पर — शाखादार सींग" },
  "raccoon": { label: "Raccoon", description: "नक़ाबपोश raccoon, धूसर कोट, आँखों पर गहरा डाकू-मास्क और घनी छल्लेदार पूँछ" },
  "capybara": { label: "Capybara", description: "बड़ा शांत दक्षिण अमेरिकी कृंतक" },
  "sloth": { label: "स्लॉथ", description: "धीमा पेड़-वासी स्तनपायी, कोमल मुस्कान वाला" },
  "red-panda": { label: "Red Panda", description: "छोटा लाल-भूरे रंग का बाँस खाने वाला, लोमड़ी जैसा चेहरा" },
  "axolotl": { label: "Axolotl", description: "गुलाबी जलीय salamander, पंखदार gills वाला" },

  // -------------------- Birds --------------------
  "eagle": { label: "बाज़", description: "राजसी बाज़, गहरा भूरा बदन, सफ़ेद सिर और पूँछ, घुमावदार पीली चोंच और तीखे पंजे" },
  "owl": { label: "उल्लू", description: "गोल चेहरे वाला उल्लू, धब्बेदार भूरे-सफ़ेद पंख, बड़ी आगे की ओर देखने वाली पीली आँखें और पंखदार कान-गुच्छे" },
  "parrot": { label: "तोता", description: "जीवंत उष्णकटिबंधीय तोता, संतृप्त लाल, हरे, पीले और नीले पंख और हुक-आकार की चोंच" },
  "peacock": { label: "मोर", description: "इंद्रधनुषी नीला मोर, चमकती eye-pattern पंखों की विशाल पंखदार पूँछ" },
  "flamingo": { label: "Flamingo", description: "लंबा पतला flamingo, चमकीले गुलाबी पंख, लंबी घुमावदार गर्दन और पानी की ओर झुकती मुड़ी हुई चोंच" },
  "penguin": { label: "Penguin", description: "सीधा tuxedo पहना penguin, काली पीठ, सफ़ेद पेट और छोटे flipper-जैसे पंख" },
  "swan": { label: "हंस", description: "लालित्यपूर्ण सफ़ेद हंस, लंबी घुमावदार गर्दन, नारंगी चोंच और नाज़ुक रूप से मुड़े हुए पंख" },
  "sparrow": { label: "गौरैया", description: "छोटी भूरी-धूसर गौरैया, धारीदार पीठ, साफ़ गोल बदन और सतर्क काली आँख" },
  "crow": { label: "कौआ", description: "चमकदार पूरी काली कौआ, मोटी सीधी चोंच, बुद्धिमान गहरी आँखें और चिकने इंद्रधनुषी पंख" },
  "raven": { label: "रेवन", description: "चमकदार काला रेवन, बुद्धिमान दृष्टि वाला" },
  "hummingbird": { label: "Hummingbird", description: "नन्हा रत्न-रंगी hummingbird, इंद्रधनुषी emerald और ruby पंख और लंबी सूई-जैसी चोंच" },

  // -------------------- Sea --------------------
  "dolphin": { label: "Dolphin", description: "चिकना धूसर dolphin, चंचल मुस्कुराता चेहरा, घुमावदार पृष्ठीय fin और शक्तिशाली पूँछ" },
  "whale": { label: "व्हेल", description: "विशाल humpback व्हेल, गहरा नीला-धूसर बदन, लंबे pectoral fin और barnacle-युक्त गाँठदार सिर" },
  "shark": { label: "शार्क", description: "शक्तिशाली great white शार्क, torpedo-आकार का धूसर बदन, सफ़ेद नीचे का हिस्सा और तीखे दाँतों की पंक्तियाँ" },
  "octopus": { label: "Octopus", description: "जिज्ञासु octopus, फूला हुआ सिर, बड़ी बुद्धिमान आँखें और आठ लंबी sucker वाली बाँहें" },
  "sea-turtle": { label: "समुद्री कछुआ", description: "सुंदर समुद्री कछुआ, पैटर्न वाला हरा-भूरा खोल, flipper-जैसे अंग और बुद्धिमान झुर्रीदार चेहरा" },
  "jellyfish": { label: "Jellyfish", description: "पारदर्शी jellyfish, चमकता घंटी-आकार का बदन और लंबे बहते filament-जैसे tentacles" },
  "crab": { label: "केकड़ा", description: "लाल खोल वाला केकड़ा, चौड़ी कवचदार carapace, बड़े पकड़ने वाले पंजे और बग़ल में चलने वाली टाँगें" },
  "seahorse": { label: "Seahorse", description: "नन्हा seahorse, मुड़ी हुई prehensile पूँछ, घोड़े जैसा सिर और नाज़ुक पृष्ठीय fin" },

  // -------------------- Small Pets --------------------
  "hamster": { label: "Hamster", description: "गोल रोएँदार hamster, गोलमटोल गाल की थैलियाँ, छोटे पंजे और चमकीली काली मणि-जैसी आँखें" },
  "guinea-pig": { label: "Guinea Pig", description: "मोटा guinea pig, मुलायम तीन-रंगी कोट, बिना दिखाई देने वाली पूँछ और प्यारा सतर्क चेहरा" },
  "ferret": { label: "Ferret", description: "चिकना लंबे बदन वाला ferret, क्रीम और sable कोट, गहरा डाकू मास्क और चंचल मुद्रा" },
  "parakeet": { label: "Parakeet", description: "छोटा चमकीला हरा-पीला parakeet, धारीदार सिर, गहरे eye-spot और लंबी पतली पूँछ" },
  "gerbil": { label: "Gerbil", description: "पतला रेतीले-भूरे रंग का gerbil, बड़ी गहरी आँखें, सीधे कान और लंबी गुच्छेदार पूँछ" },

  // -------------------- Reptiles --------------------
  "snake": { label: "साँप", description: "लिपटा हुआ साँप, चिकना शल्कदार बदन, हीरे-पैटर्न वाली त्वचा, चीरदार पुतलियाँ और लपलपाती दो-शाखी जीभ" },
  "lizard": { label: "छिपकली", description: "फुर्तीली छिपकली, पतला शल्कदार बदन, लंबी कोड़े-जैसी पूँछ, पंजे वाले पैर और तेज़ बग़ल वाली आँखें" },
  "turtle": { label: "कछुआ", description: "मित्रवत भूमि कछुआ, गुंबदाकार पैटर्न वाला खोल, मोटी शल्कदार टाँगें और बुद्धिमान झुर्रीदार चेहरा" },
  "crocodile": { label: "मगरमच्छ", description: "विशाल मगरमच्छ, कवचदार जैतून-हरे शल्क, लंबा दाँतेदार थूथन और शक्तिशाली पंजे वाले अंग" },
  "chameleon": { label: "गिरगिट", description: "रंग बदलने वाला गिरगिट, ऊँचा casque-आकार का सिर, स्वतंत्र रूप से घूमने वाली आँखें और कसकर मुड़ी हुई prehensile पूँछ" },
  "gecko": { label: "Gecko", description: "छोटा gecko, मोटा धब्बेदार बदन, बड़ी पलक रहित आँखें और चौड़े चिपचिपे पैर के पैड" },

  // -------------------- Insects --------------------
  "butterfly": { label: "तितली", description: "नाज़ुक तितली, चमकीले रंगों के चौड़े पैटर्न वाले पंख, पतला बदन और लंबे antennae" },
  "bee": { label: "मधुमक्खी", description: "रोएँदार honey मधुमक्खी, पीली-काली धारियाँ, पारदर्शी पंख और पराग से ढकी टाँगें" },
  "ant": { label: "चींटी", description: "व्यस्त चींटी, खंडित गहरा बदन, छह पतली टाँगें, मुड़े हुए antennae और मज़बूत mandibles" },
  "spider": { label: "मकड़ी", description: "आठ-पैरों वाली मकड़ी, फूला हुआ पेट, गुच्छेदार गहरी आँखें और बदन पर महीन बाल" },
  "ladybug": { label: "Ladybug", description: "नन्ही लाल ladybug, चमकदार गोल खोल, गहरे काले धब्बे और झाँकती नाज़ुक टाँगें" },
  "dragonfly": { label: "Dragonfly", description: "पतली dragonfly, इंद्रधनुषी नीला-हरा बदन, बड़ी faceted आँखें और चार लंबे पारदर्शी पंख" },
  "beetle": { label: "Beetle", description: "कवचदार beetle, चमकदार सख़्त खोल, उभरे हुए wing cover, मज़बूत टाँगें और छोटे antennae" },
  "grasshopper": { label: "टिड्डा", description: "हरा टिड्डा, लंबी शक्तिशाली पिछली टाँगें, पीठ पर मुड़े पंख और लंबे कोड़े-जैसे antennae" },
  "praying-mantis": { label: "Praying Mantis", description: "लंबी praying mantis, त्रिकोणीय सिर, बड़ी compound आँखें और प्रार्थना मुद्रा में पकड़े हुए कांटेदार raptorial अग्र-पैर" },
  "mosquito": { label: "मच्छर", description: "पतला मच्छर, लंबी पतली टाँगें, संकरे पारदर्शी पंख और सूई-जैसा proboscis" },
  "scorpion": { label: "बिच्छू", description: "रेगिस्तानी बिच्छू, कवचदार खंड, बड़े पकड़ने वाले पंजे और पीठ के ऊपर उठी डंक-वाली मुड़ी हुई पूँछ" },
  "caterpillar": { label: "इल्ली", description: "मोटी खंडित इल्ली, मुलायम गुच्छे, छोटी टाँगें और हरी पत्ती पर ख़ुशी से चबाती मुद्रा" },

  // -------------------- Dinosaurs --------------------
  "t-rex": { label: "Tyrannosaurus Rex", description: "विशाल T-Rex, शक्तिशाली पिछली टाँगें, छोटी पंजे वाली बाँहें, ख़ंजर-जैसे दाँतों से भरा विशाल जबड़ा और मोटी शल्कदार खाल" },
  "velociraptor": { label: "Velociraptor", description: "दुबला पंखदार velociraptor, sickle पंजे, लंबी सख़्त पूँछ और शिकारी आगे झुकी मुद्रा" },
  "triceratops": { label: "Triceratops", description: "कवचदार triceratops, बड़ा हड्डी का frill, चेहरे पर तीन तीखे सींग और भारी चार-पैरों वाली मुद्रा" },
  "brachiosaurus": { label: "Brachiosaurus", description: "ऊँचा brachiosaurus, पेड़ की चोटी तक पहुँचने वाली असाधारण रूप से लंबी गर्दन, छोटा सिर और स्तंभ-जैसी टाँगें" },
  "stegosaurus": { label: "Stegosaurus", description: "विशालकाय stegosaurus, पीठ पर ऊँचे हीरे-आकार के plates की दो पंक्तियाँ और काँटेदार पूँछ" },
  "pterodactyl": { label: "Pterodactyl", description: "उड़ने वाला pterodactyl, विशाल चमड़े के पंख, लंबी दाँतेदार चोंच और पीछे झुका सिर का crest" },
  "spinosaurus": { label: "Spinosaurus", description: "शिकारी spinosaurus, पीठ पर ऊँचा sail fin, लंबा मगरमच्छ-जैसा थूथन और शक्तिशाली पंजे वाली बाँहें" },
  "diplodocus": { label: "Diplodocus", description: "विशाल लंबे बदन वाला diplodocus, कोड़े-पतली पूँछ बराबर लंबी गर्दन को संतुलित करती है, खूँटी जैसे दाँत और मज़बूत टाँगें" },
  "ankylosaurus": { label: "Ankylosaurus", description: "टैंक-जैसा ankylosaurus, मोटे कवचदार plates और कांटों से ढका, पूँछ के अंत में विशाल हड्डी का गदा" },
  "brontosaurus": { label: "Brontosaurus", description: "नम्र विशालकाय brontosaurus, लंबी झुकी गर्दन, छोटा सिर, मोटा बदन और पतली कोड़े-पूँछ" },
  "parasaurolophus": { label: "Parasaurolophus", description: "Duck-billed parasaurolophus, सिर से पीछे की ओर जाता लंबा घुमावदार ट्यूबलर crest और पतला द्विपाद बदन" },
  "allosaurus": { label: "Allosaurus", description: "उग्र allosaurus शिकारी, बड़ा सिर, छोटे माथे के सींग, दाँतेदार दाँत और शक्तिशाली पकड़ने वाली बाँहें" },

  // -------------------- Mythical --------------------
  "dragon": { label: "Dragon", description: "विशाल dragon, चमड़े के पंख, उभरे हुए शल्क, घुमावदार सींग, चमकती आँखें और नथुनों से कुंडली मारता धुआँ" },
  "unicorn": { label: "Unicorn", description: "शुद्ध सफ़ेद unicorn, बहती pastel अयाल और पूँछ और माथे पर एक pearlescent सर्पिल सींग" },
  "phoenix": { label: "Phoenix", description: "राजसी phoenix, उग्र लाल, नारंगी और सुनहरे पंख, लंबी बहती पूँछ और पंखों के सिरों पर लपटें" },
  "griffin": { label: "Griffin", description: "हाइब्रिड griffin, बाज़ का सिर, पंख और पंजे वाले अग्र-पैर और शेर का मांसल पिछला बदन" },
  "pegasus": { label: "Pegasus", description: "शुद्ध सफ़ेद पंखों वाला घोड़ा, पंखदार पंख, बहती अयाल और एक अलौकिक उपस्थिति" },
  "kraken": { label: "Kraken", description: "विशाल समुद्री-दैत्य kraken, विशाल सिर, चमकती आँखें और गहराई से उठते विशाल suckered tentacles" },
}

export default map
