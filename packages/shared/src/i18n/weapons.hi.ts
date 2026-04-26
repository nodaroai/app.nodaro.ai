import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // -------------------- Swords --------------------
  "katana": { description: "जापानी katana, एकधारी हल्की घुमावदार ब्लेड, rayskin से लिपटा हत्था, disc-आकार का tsuba गार्ड और चमकदार mirror finish" },
  "longsword": { label: "Longsword", description: "मध्यकालीन दोधारी longsword, सीधी पतली होती ब्लेड, cross गार्ड, चमड़े से लिपटा grip और गोल pommel" },
  "broadsword": { label: "Broadsword", description: "भारी broadsword, चौड़ी सीधी दोधारी ब्लेड, basket-hilt गार्ड और मज़बूत चमड़े से लिपटा grip" },
  "rapier": { label: "Rapier", description: "पतला rapier, लंबी संकरी thrusting ब्लेड, अलंकृत swept-hilt basket गार्ड और गोलाकार pommel" },
  "saber": { label: "Saber", description: "घुड़सवारी का saber, एकधारी घुमावदार ब्लेड, brass knuckle-bow गार्ड और ribbed चमड़े का grip" },
  "scimitar": { label: "Scimitar", description: "घुमावदार scimitar, चौड़ी एकधारी ब्लेड, अलंकृत crossguard और गोलाकार धातु का pommel" },
  "claymore": { label: "Claymore", description: "विशाल दो-हाथी Scottish claymore, लंबी सीधी ब्लेड, आगे झुका crossguard और बड़ा चमड़े से बंधा grip" },
  "cutlass": { label: "Cutlass", description: "Pirate cutlass, छोटी घुमावदार एकधारी ब्लेड, brass cup-shaped हाथ-गार्ड और घिसा-पिटा लकड़ी का grip" },
  "wakizashi": { description: "छोटी जापानी wakizashi साथी ब्लेड, हल्की घुमावदार धार, छोटा tsuba और rayskin से लिपटा हत्था" },
  "falchion": { label: "Falchion", description: "भारी एकधारी falchion, पतली होती cleaver-जैसी ब्लेड, साधारण crossguard और कीलों वाला चमड़े का grip" },

  // -------------------- Daggers & Knives --------------------
  "dagger": { label: "ख़ंजर", description: "क्लासिक दोधारी ख़ंजर, संकरी नुकीली ब्लेड, crossguard और लिपटा चमड़े का grip" },
  "bowie-knife": { label: "Bowie Knife", description: "बड़ा bowie knife, clip-point ब्लेड, brass गार्ड, stacked leather-washer हत्था और crossguard" },
  "kukri": { label: "खुकरी", description: "नेपाली खुकरी, आगे झुकती चौड़ी ब्लेड, लकड़ी का हत्था और विशिष्ट अंदर की ओर मुड़ी recurve" },
  "stiletto": { label: "Stiletto", description: "पतला stiletto, लंबी सूई-जैसी पतली त्रिकोणीय ब्लेड, न्यूनतम crossguard और पतला होता हत्था" },
  "dirk": { label: "Dirk", description: "Scottish dirk, लंबी सीधी एकधारी ब्लेड, आपस में बुना Celtic-knot हत्था और अलंकृत pommel" },
  "tanto": { label: "Tanto", description: "जापानी tanto ख़ंजर, कोणीय chisel-point नोक, छोटा tsuba और rayskin से लिपटा हत्था" },
  "switchblade": { label: "Switchblade", description: "जेबी switchblade, spring-loaded मुड़ने वाली ब्लेड, मोती या resin के side panels और चमकदार release बटन" },
  "trench-knife": { label: "Trench Knife", description: "सैन्य trench knife, पतली दोधारी ब्लेड और grip को लपेटता brass knuckle-duster handguard" },

  // -------------------- Axes --------------------
  "battle-axe": { label: "युद्ध कुल्हाड़ी", description: "भारी दो-हाथी battle axe, चौड़ी घुमावदार धार, bearded profile और iron पट्टियों से बंधी लंबी लकड़ी की haft" },
  "tomahawk": { label: "Tomahawk", description: "हल्का throwing tomahawk, छोटा single-bit iron का सिर, सीधी लकड़ी की haft और grip के पास चमड़े की लपेट" },
  "hatchet": { label: "Hatchet", description: "कॉम्पैक्ट hatchet, छोटा लकड़ी का हत्था, छोटा single-bit स्टील का सिर और हथौड़े जैसा finish" },
  "halberd": { label: "Halberd", description: "लंबे डंडे का halberd, axe ब्लेड, thrusting spear नोक और ऊँची लकड़ी की shaft के ऊपर पीछे का hook" },
  "greataxe": { label: "Greataxe", description: "विशाल greataxe, बहुत बड़ा double-sided crescent सिर, iron की मज़बूत पट्टियाँ और लंबी भारी haft जिसके लिए दो हाथ चाहिए" },
  "bearded-axe": { label: "Bearded Axe", description: "Viking bearded axe, लंबी निचली ब्लेड धार, संकरा iron का सिर और चमड़े से लिपटी ऊँची लकड़ी की haft" },

  // -------------------- Polearms --------------------
  "spear": { label: "भाला", description: "साधारण भाला, पत्ते के आकार का iron spearhead जो ऊँची सीधी लकड़ी की shaft पर बंधा है, और तले पर छोटा butt cap" },
  "lance": { label: "Lance", description: "Jousting lance, लंबी लकड़ी की shaft, शंकु आकार की steel नोक और grip की रक्षा करता flared हाथ-गार्ड" },
  "pike": { label: "Pike", description: "बहुत लंबा pike, छोटा त्रिकोणीय spearhead जो आदमी की दुगुनी ऊँचाई के लकड़ी के डंडे पर लगा है" },
  "glaive": { label: "Glaive", description: "Glaive polearm, लकड़ी की shaft पर लगी लंबी घुमावदार एकधारी ब्लेड, छोटे crossguard तक पतली होती हुई" },
  "trident": { label: "त्रिशूल", description: "तीन-नोकों वाला त्रिशूल, तीखी barbed कीलें, केंद्रीय shaft और लंबा लकड़ी का डंडा" },
  "naginata": { label: "Naginata", description: "जापानी naginata, lacquered लंबे लकड़ी के डंडे पर लगी घुमावदार एकधारी ब्लेड, silk की लपेटों के साथ" },

  // -------------------- Bows & Crossbows --------------------
  "longbow": { label: "Longbow", description: "ऊँचा English longbow, yew की लकड़ी का एक टुकड़ा, मोम-लगा linen का धागा और चमड़े से लिपटा grip" },
  "recurve-bow": { label: "Recurve Bow", description: "पारंपरिक recurve bow, धनुर्धर से दूर मुड़ती limbs, चमड़े से लिपटा riser और कसा हुआ bowstring" },
  "compound-bow": { label: "Compound Bow", description: "आधुनिक compound bow, aluminium cams, हर सिरे पर pulley wheels, carbon-fiber arrow rest और sighting pin का array" },
  "crossbow": { label: "Crossbow", description: "मध्यकालीन crossbow, क्षैतिज लकड़ी का stock, steel का prod, कसा हुआ धागा और rail के नीचे trigger व्यवस्था" },
  "short-bow": { label: "Short Bow", description: "कॉम्पैक्ट लकड़ी का short bow, साधारण घुमावदार profile, मोम-लगा धागा और बीच में चमड़े का grip" },

  // -------------------- Blunt & Impact --------------------
  "mace": { label: "गदा", description: "मध्यकालीन flanged गदा, बाहर निकली iron flanges वाला भारी ताज जैसा सिर, छोटी iron की shaft पर" },
  "war-hammer": { label: "War Hammer", description: "लंबे हत्थे का war hammer, भारी iron का सिर — एक तरफ़ सपाट striking face और दूसरी तरफ़ घुमावदार spike" },
  "club": { label: "गदका", description: "साधारण लकड़ी का club, मोटा गाँठदार सिर, पतली होती shaft और तले के पास घिसा चमड़े का grip" },
  "morning-star": { label: "Morning Star", description: "Morning star, लकड़ी की shaft के ऊपर बड़ी iron की गेंद जिसमें हर दिशा में लंबी spikes निकली हैं" },
  "flail": { label: "Flail", description: "सैन्य flail, छोटी chain से जुड़ी spiked iron की गेंद, लकड़ी की haft और iron का end cap" },
  "nunchaku": { label: "Nunchaku", description: "मार्शल आर्ट्स के nunchaku, चमकदार लकड़ी के दो बैटन, बुनी हुई rope या chain के छोटे टुकड़े से जुड़े हुए" },

  // -------------------- Throwing --------------------
  "shuriken": { label: "Shuriken", description: "धातु का throwing star, केंद्रीय hub से निकलती कई धारदार नोकें और काला किया हुआ steel finish" },
  "throwing-knife": { label: "Throwing Knife", description: "संतुलित throwing knife, पत्ते के आकार की दोधारी ब्लेड, न्यूनतम हत्था और चमकदार steel finish" },
  "boomerang": { label: "Boomerang", description: "घुमावदार लकड़ी का boomerang, कोहनी का मोड़, चित्रित tribal pattern और चिकना aerodynamic profile" },
  "javelin": { label: "Javelin", description: "हल्का throwing javelin, पतली steel की नोक, पतली होती लकड़ी की shaft और संतुलन बिंदु के पास चमड़े की लपेट" },
  "bolas": { label: "Bolas", description: "बुनी चमड़े की डोरियों से एक केंद्रीय गाँठ पर बंधे तीन वज़नदार पत्थर या iron के गोले" },

  // -------------------- Modern Firearms --------------------
  "pistol": { label: "Pistol", description: "आधुनिक semi-automatic pistol, मैट काला polymer frame, ribbed slide, trigger guard और flush magazine का base" },
  "revolver": { label: "Revolver", description: "Six-shooter revolver, घूमता cylinder, लंबा barrel, पीछे खींचा hammer और checkered लकड़ी का grip" },
  "assault-rifle": { label: "Assault Rifle", description: "सैन्य assault rifle, लंबा barrel, समेटा जा सकने वाला stock, rail पर optical sight और घुमावदार detachable magazine" },
  "shotgun": { label: "Shotgun", description: "Pump-action shotgun, चौड़े bore का barrel, tactical fore-end, नीचे tube magazine और लकड़ी या synthetic stock" },
  "smg": { label: "Submachine Gun", description: "कॉम्पैक्ट submachine gun, छोटा barrel, side-mounted magazine, मुड़ने वाला wire stock और integral foregrip" },
  "sniper-rifle": { label: "Sniper Rifle", description: "Bolt-action sniper rifle, लंबा barrel, उच्च-magnification scope, bipod legs और ergonomic polymer stock" },
  "machine-gun": { label: "Machine Gun", description: "भारी belt-fed machine gun, लंबा finned barrel, bipod, carry handle और बगल से आती ammunition belt" },

  // -------------------- Historical Firearms --------------------
  "musket": { label: "Musket", description: "लंबा flintlock musket, smooth-bore iron का barrel, walnut का stock, brass की fittings और muzzle के पास लगा bayonet" },
  "flintlock-pistol": { label: "Flintlock Pistol", description: "अलंकृत flintlock pistol, घुमावदार लकड़ी का grip, उत्कीर्ण brass fittings, flint hammer और एक लंबा barrel" },
  "blunderbuss": { label: "Blunderbuss", description: "छोटा flintlock blunderbuss, flared muzzle, मज़बूत लकड़ी के stock पर brass fittings और pirate-दौर की उपस्थिति" },
  "dueling-pistol": { label: "Dueling Pistol", description: "Elegant dueling pistol, पतला अष्टकोणीय barrel, बारीक उत्कीर्ण lockwork और चमकदार walnut का grip" },

  // -------------------- Explosives & Siege --------------------
  "grenade": { label: "Grenade", description: "Pineapple-textured iron का fragmentation grenade, खींचे गए safety pin से जगह पर रुका हुआ spoon lever" },
  "stick-grenade": { label: "Stick Grenade", description: "बेलनाकार stick grenade, लंबे लकड़ी के हत्थे पर लगा iron warhead और तले पर pull-string fuse" },
  "dynamite": { label: "Dynamite", description: "लाल dynamite की sticks का गुच्छा, सुतली से बंधा और जलती नोक वाले लंबे sputtering fuse से जुड़ा" },
  "bomb": { label: "Cartoon Bomb", description: "गोल काला cartoon bomb, ऊपर से निकलता धुआँदार मुड़ा हुआ fuse और चमकदार गोलाकार iron का खोल" },
  "rocket-launcher": { label: "Rocket Launcher", description: "कंधे से दागा जाने वाला rocket launcher, लंबी ट्यूब, सामने का grip, पीछे का exhaust cone और optical targeting sight" },
  "cannon": { label: "तोप", description: "Cast-iron muzzle-loading तोप, लकड़ी की पहियेदार carriage पर लगी, लंबा smooth-bore barrel और धुआँ छोड़ता vent" },
  "catapult": { label: "Catapult", description: "लकड़ी का siege catapult, पीछे खींचा गया लंबा throwing arm, counterweight या torsion bundle और पत्थर से भरी टोकरी" },
  "trebuchet": { label: "Trebuchet", description: "ऊँचा मध्यकालीन trebuchet, विशाल counterweight, लंबा throwing arm, बुनी sling और भारी लकड़ी का frame" },

  // -------------------- Sci-Fi --------------------
  "laser-pistol": { label: "Laser Pistol", description: "कॉम्पैक्ट sci-fi laser pistol, चमकती neon energy की coils, ribbed धातु का बदन और छोटा emitter barrel" },
  "plasma-rifle": { label: "Plasma Rifle", description: "भविष्यवादी plasma rifle, चमकते नीले energy cells, ventilated barrel shrouds और holographic sight" },
  "lightsaber": { label: "Lightsaber", description: "Laser तलवार, धातु का ribbed हत्था जिससे संतृप्त energy की लंबी चमकती ब्लेड और धुँधला plasma halo निकलता है" },
  "blaster": { label: "Blaster", description: "Retro-futuristic blaster pistol, मोटा बदन, चमकता energy chamber, cooling vents और ऊपर लगा scope" },
  "phaser": { label: "Phaser", description: "Sleek sci-fi phaser, minimalist घुमावदार grip, चमकती emitter नोक और तीव्रता नियंत्रित करता चिकना panel" },
  "rail-gun": { label: "Rail Gun", description: "भारी electromagnetic rail gun, समानांतर धातु की rails, बदन के साथ विशाल capacitors और चमकता projectile chamber" },
  "emp-grenade": { label: "EMP Grenade", description: "गोलाकार electromagnetic pulse grenade, खुली coils, चमकती नीली indicator lights और holographic arming dial" },

  // -------------------- Fantasy / Magical --------------------
  "enchanted-sword": { label: "जादुई तलवार", description: "जादुई तलवार, चमकती rune-उत्कीर्ण ब्लेड, gold-inlaid crossguard और pommel में जड़ा रत्न" },
  "magic-staff": { label: "जादुई लाठी", description: "ऊँची गाँठदार जादूगर की लाठी, मुड़ी हुई लकड़ी की shaft जो एक चमकते crystal को थामती शाखाओं के मुकुट में समाप्त होती है" },
  "runed-dagger": { label: "Runed ख़ंजर", description: "रहस्यमय ख़ंजर, चमकती runes में उत्कीर्ण ब्लेड, हड्डी का हत्था और धार के साथ घूमती अँधेरी ऊर्जा" },
  "wizard-wand": { label: "जादूगर की छड़ी", description: "पतली लकड़ी की छड़ी, गाँठदार स्वर्ल्स, चमड़े का grip और नुकीली नोक से रिसती जादू की नन्ही चिंगारियाँ" },
  "war-horn": { label: "रणसिंगा", description: "विशाल घुमावदार रणसिंगा, चमड़े और चाँदी की पट्टियों से बंधा, एक सिरे पर mouthpiece और दूसरे पर flared गूँजता मुख" },
  "sorcerer-orb": { label: "जादूगर का गोला", description: "Crystal का जादूगर का गोला, मुड़े हुए चाँदी के पंजे-stand में थामा हुआ, काँच के गोले के अंदर निलंबित घूमती जादुई धुंध" },
}

export default map
