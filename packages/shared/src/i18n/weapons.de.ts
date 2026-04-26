import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // Swords
  "katana": { description: "Japanisches Katana mit einseitig geschliffener, sanft gebogener Klinge, mit Rochenhaut umwickeltem Griff, scheibenförmigem Tsuba und polierter Spiegeloberfläche" },
  "longsword": { label: "Langschwert", description: "Mittelalterliches zweischneidiges Langschwert mit gerader sich verjüngender Klinge, Parierstange, lederumwickeltem Griff und rundem Knauf" },
  "broadsword": { label: "Breitschwert", description: "Schweres Breitschwert mit breiter gerader zweischneidiger Klinge, Korbgefäß und robustem lederumwickeltem Griff" },
  "rapier": { label: "Rapier", description: "Schlankes Rapier mit langer schmaler Stoßklinge, kunstvollem geschwungenem Korbgefäß und kugelförmigem Knauf" },
  "saber": { label: "Säbel", description: "Kavalleriesäbel mit einseitig geschliffener gebogener Klinge, messingfarbenem Bügelgriff und geriffeltem Ledergriff" },
  "scimitar": { label: "Scimitar", description: "Gebogener Scimitar mit breiter einseitig geschliffener Klinge, kunstvoller Parierstange und gerundetem Metallknauf" },
  "claymore": { label: "Claymore", description: "Massive zweihändige schottische Claymore mit langer gerader Klinge, nach vorn geneigter Parierstange und großem lederumwickeltem Griff" },
  "cutlass": { label: "Entermesser", description: "Piraten-Entermesser mit kurzer gebogener einseitig geschliffener Klinge, messingfarbenem Topfhandschutz und verwittertem Holzgriff" },
  "wakizashi": { description: "Kurze japanische Wakizashi-Begleitklinge mit sanft gebogener Schneide, kleinem Tsuba und mit Rochenhaut umwickeltem Griff" },
  "falchion": { label: "Falchion", description: "Schweres einseitig geschliffenes Falchion mit hackmesserartig sich verjüngender Klinge, einfacher Parierstange und genietetem Ledergriff" },

  // Daggers & Knives
  "dagger": { label: "Dolch", description: "Klassischer zweischneidiger Dolch mit schmaler spitzer Klinge, Parierstange und umwickeltem Ledergriff" },
  "bowie-knife": { label: "Bowie-Messer", description: "Großes Bowie-Messer mit Clip-Point-Klinge, Messingschutz, gestapeltem Lederscheibengriff und Parierstange" },
  "kukri": { description: "Nepalesisches Kukri mit nach vorn gekrümmter breiter Klinge, Holzgriff und charakteristischer einwärts gekehrter Recurve-Form" },
  "stiletto": { label: "Stilett", description: "Schlankes Stilett mit langer nadelfeiner dreikantiger Klinge, minimaler Parierstange und sich verjüngendem Griff" },
  "dirk": { label: "Dirk", description: "Schottischer Dirk mit langer gerader einseitig geschliffener Klinge, mit keltischen Knoten verflochtenem Griff und kunstvollem Knauf" },
  "tanto": { description: "Japanischer Tanto-Dolch mit kantiger Meißelspitze, kleinem Tsuba und mit Rochenhaut umwickeltem Griff" },
  "switchblade": { label: "Springmesser", description: "Taschen-Springmesser mit federbelasteter Klappklinge, Seitengriffschalen aus Perlmutt oder Harz und poliertem Auslöseknopf" },
  "trench-knife": { label: "Grabenmesser", description: "Militärisches Grabenmesser mit schmaler zweischneidiger Klinge und messingfarbenem Schlagring-Handschutz, der den Griff umschließt" },

  // Axes
  "battle-axe": { label: "Streitaxt", description: "Schwere zweihändige Streitaxt mit breiter gebogener Schneide, bartförmigem Profil und langem Holzschaft mit Eisenbändern" },
  "tomahawk": { label: "Tomahawk", description: "Leichtes Wurf-Tomahawk mit kleinem einschneidigem Eisenkopf, geradem Holzschaft und Lederwicklung nahe dem Griff" },
  "hatchet": { label: "Beil", description: "Kompaktes Beil mit kurzem Holzgriff, kleinem einschneidigem Stahlkopf und gehämmerter Oberfläche" },
  "halberd": { label: "Hellebarde", description: "Stangen-Hellebarde, die Axtklinge, Stoßspitze und hinteren Haken auf einem hohen Holzschaft kombiniert" },
  "greataxe": { label: "Großaxt", description: "Massive Großaxt mit riesigem doppelseitigem halbmondförmigem Kopf, eisernen Verstärkungsbändern und langem schwerem Schaft, der zwei Hände erfordert" },
  "bearded-axe": { label: "Bartaxt", description: "Wikinger-Bartaxt mit verlängerter unterer Schneide, schmalem Eisenkopf und hohem mit Leder umwickeltem Holzschaft" },

  // Polearms
  "spear": { label: "Speer", description: "Einfacher Speer mit blattförmiger Eisenspitze, an einen hohen geraden Holzschaft gebunden, und kleiner Endkappe am Schaftende" },
  "lance": { label: "Lanze", description: "Turnierlanze mit langem Holzschaft, kegelförmiger Stahlspitze und ausgestelltem Handschutz, der den Griff schützt" },
  "pike": { label: "Pike", description: "Sehr lange Pike mit kleiner dreikantiger Spitze, montiert auf einem hoch aufragenden Holzschaft von doppelter Manneshöhe" },
  "glaive": { label: "Glefe", description: "Glefe-Stangenwaffe mit langer gebogener einseitig geschliffener Klinge auf einem Holzschaft, der zu einer kleinen Parierstange ausläuft" },
  "trident": { label: "Dreizack", description: "Dreizinkiger Dreizack mit scharfen Widerhakenzinken, Mittelschaft und langem Holzstock" },
  "naginata": { description: "Japanische Naginata mit gebogener einseitig geschliffener Klinge auf einem langen lackierten Holzschaft mit Seidenwicklungen" },

  // Bows & Crossbows
  "longbow": { label: "Langbogen", description: "Hoher englischer Langbogen aus einem einzigen Stück Eibenholz, gewachster Leinensehne und lederumwickeltem Griff" },
  "recurve-bow": { label: "Recurvebogen", description: "Traditioneller Recurvebogen mit Wurfarmen, die sich vom Schützen abwenden, lederumwickeltem Mittelstück und gespannter Sehne" },
  "compound-bow": { label: "Compoundbogen", description: "Moderner Compoundbogen mit Aluminium-Cams, Umlenkrollen an beiden Enden, Pfeilauflage aus Carbonfaser und einem Visiernadelraster" },
  "crossbow": { label: "Armbrust", description: "Mittelalterliche Armbrust mit horizontalem Holzschaft, Stahlbogen, gespannter Sehne und Abzugsmechanismus unter der Schiene" },
  "short-bow": { label: "Kurzbogen", description: "Kompakter hölzerner Kurzbogen mit einfachem geschwungenem Profil, gewachster Sehne und Ledergriff in der Mitte" },

  // Blunt & Impact
  "mace": { label: "Streitkolben", description: "Mittelalterlicher geflanschter Streitkolben mit schwerem gekröntem Kopf mit hervorstehenden Eisenflanschen auf kurzem Eisenschaft" },
  "war-hammer": { label: "Kriegshammer", description: "Langstieliger Kriegshammer mit schwerem Eisenkopf mit flacher Schlagfläche auf der einen und gebogenem Spike auf der anderen Seite" },
  "club": { label: "Keule", description: "Einfache Holzkeule mit dickem knotigem Kopf, sich verjüngendem Schaft und gut abgenutztem Ledergriff am unteren Ende" },
  "morning-star": { label: "Morgenstern", description: "Morgenstern mit Holzschaft, gekrönt von einer großen Eisenkugel, die in alle Richtungen mit hohen Stacheln besetzt ist" },
  "flail": { label: "Flegel", description: "Militärischer Flegel mit stacheliger Eisenkugel, die durch eine kurze Kette mit einem Holzschaft mit Eisenendkappe verbunden ist" },
  "nunchaku": { description: "Kampfsport-Nunchaku mit zwei polierten Holzstäben, verbunden durch eine kurze geflochtene Schnur oder Kette" },

  // Throwing
  "shuriken": { description: "Metallener Wurfstern mit mehreren rasiermesserscharfen Spitzen, die von einer zentralen Nabe abstrahlen, in geschwärzter Stahloberfläche" },
  "throwing-knife": { label: "Wurfmesser", description: "Ausgewogenes Wurfmesser mit blattförmiger zweischneidiger Klinge, minimalem Griff und polierter Stahloberfläche" },
  "boomerang": { label: "Bumerang", description: "Gebogener hölzerner Bumerang mit Knickwinkel, aufgemalten Stammesmustern und glattem aerodynamischem Profil" },
  "javelin": { label: "Wurfspeer", description: "Leichter Wurfspeer mit schlanker Stahlspitze, sich verjüngendem Holzschaft und Ledergriffwicklung nahe dem Schwerpunkt" },
  "bolas": { label: "Bolas", description: "Drei mit geflochtenen Lederschnüren verbundene Stein- oder Eisenkugeln, die an einem zentralen Knoten zusammenlaufen" },

  // Modern Firearms
  "pistol": { label: "Pistole", description: "Moderne halbautomatische Pistole mit mattschwarzem Polymerrahmen, geriffeltem Schlitten, Abzugsbügel und bündig abschließendem Magazinboden" },
  "revolver": { label: "Revolver", description: "Sechsschüssiger Revolver mit rotierender Trommel, langem Lauf, gespanntem Hahn und kariertem Holzgriff" },
  "assault-rifle": { label: "Sturmgewehr", description: "Militärisches Sturmgewehr mit langem Lauf, einklappbarer Schulterstütze, Zielfernrohr auf der Schiene und gebogenem abnehmbarem Magazin" },
  "shotgun": { label: "Schrotflinte", description: "Pumpgun-Schrotflinte mit weitem Lauf, taktischem Vorderschaft, Röhrenmagazin darunter und Schulterstütze aus Holz oder Synthetikmaterial" },
  "smg": { label: "Maschinenpistole", description: "Kompakte Maschinenpistole mit kurzem Lauf, seitlich montiertem Magazin, einklappbarer Drahtschulterstütze und integriertem Vordergriff" },
  "sniper-rifle": { label: "Scharfschützengewehr", description: "Repetier-Scharfschützengewehr mit langem Lauf, hochvergrößerndem Zielfernrohr, Zweibein und ergonomischem Polymerschaft" },
  "machine-gun": { label: "Maschinengewehr", description: "Schweres gurtgespeistes Maschinengewehr mit langem geripptem Lauf, Zweibein, Tragegriff und einem Munitionsgurt, der von der Seite zugeführt wird" },

  // Historical Firearms
  "musket": { label: "Muskete", description: "Lange Steinschloss-Muskete mit glattem Eisenlauf, Walnussschaft, Messingbeschlägen und nahe der Mündung aufgepflanztem Bajonett" },
  "flintlock-pistol": { label: "Steinschlosspistole", description: "Verzierte Steinschlosspistole mit gebogenem Holzgriff, gravierten Messingbeschlägen, Steinhahn und einem einzigen langen Lauf" },
  "blunderbuss": { label: "Donnerbüchse", description: "Kurze Steinschloss-Donnerbüchse mit ausgestellter Mündung, Messingbeschlägen auf einem stämmigen Holzschaft und Piratenzeit-Präsenz" },
  "dueling-pistol": { label: "Duellpistole", description: "Elegante Duellpistole mit schlankem oktogonalem Lauf, fein gravierter Schlossarbeit und poliertem Walnussgriff" },

  // Explosives & Siege
  "grenade": { label: "Handgranate", description: "Ananas-strukturierte eiserne Splittergranate mit Löffelhebel, der durch einen herausgezogenen Sicherungsstift festgehalten wird" },
  "stick-grenade": { label: "Stielhandgranate", description: "Zylindrische Stielhandgranate mit Eisensprengkopf auf langem Holzgriff und Reißleinen-Zünder am unteren Ende" },
  "dynamite": { label: "Dynamit", description: "Gebündelte Stangen roten Dynamits, mit Bindfaden umwickelt und mit einer langen sprühenden Zündschnur mit brennender Spitze verbunden" },
  "bomb": { label: "Cartoon-Bombe", description: "Runde schwarze Cartoon-Bombe mit rauchender gekräuselter Zündschnur an der Oberseite und glänzender kugelförmiger Eisenhülle" },
  "rocket-launcher": { label: "Raketenwerfer", description: "Schultergestützter Raketenwerfer mit langem Rohr, Vordergriff, hinterem Auspuffkonus und optischem Zielvisier" },
  "cannon": { label: "Kanone", description: "Gusseiserne Vorderlader-Kanone, montiert auf einer hölzernen Räderlafette, mit langem glattem Lauf und rauchendem Zündloch" },
  "catapult": { label: "Katapult", description: "Hölzernes Belagerungskatapult mit langem zurückgezogenem Wurfarm, Gegengewicht oder Torsionsbündel und einem mit Stein beladenen Korb" },
  "trebuchet": { label: "Tribok", description: "Hoher mittelalterlicher Tribok mit massivem Gegengewicht, langem Wurfarm, geflochtener Schleuder und schwerem Holzrahmen" },

  // Sci-Fi
  "laser-pistol": { label: "Laserpistole", description: "Kompakte Sci-Fi-Laserpistole mit glühenden Neon-Energiespulen, geripptem Metallkörper und kurzem Emitterlauf" },
  "plasma-rifle": { label: "Plasmagewehr", description: "Futuristisches Plasmagewehr mit glühenden blauen Energiezellen, ventilierten Laufabdeckungen und holografischem Zielvisier" },
  "lightsaber": { label: "Lichtschwert", description: "Laserschwert mit metallisch geripptem Griff, das eine hohe glühende Klinge aus gesättigter Energie mit einem dunstigen Plasma-Halo aussendet" },
  "blaster": { label: "Blaster", description: "Retro-futuristische Blaster-Pistole mit klobigem Körper, glühender Energiekammer, Kühlschlitzen und einem oben montierten Zielfernrohr" },
  "phaser": { label: "Phaser", description: "Schlanker Sci-Fi-Phaser mit minimalistischem geschwungenem Griff, glühender Emitterspitze und glatter Bedientafel zur Intensitätsregelung" },
  "rail-gun": { label: "Railgun", description: "Schwere elektromagnetische Railgun mit parallelen Metallschienen, massiven Kondensatoren entlang des Körpers und einer glühenden Geschosskammer" },
  "emp-grenade": { label: "EMP-Granate", description: "Kugelförmige elektromagnetische Pulsgranate mit freiliegenden Spulen, glühenden blauen Anzeigelichtern und holografischem Scharfschaltrad" },

  // Fantasy / Magical
  "enchanted-sword": { label: "Verzaubertes Schwert", description: "Verzaubertes Schwert mit glühender runen-geätzter Klinge, gold-eingelegter Parierstange und einem in den Knauf eingelassenen Edelstein" },
  "magic-staff": { label: "Magierstab", description: "Hoher knorriger Zauberstab mit verdrehtem Holzschaft, der in einer Krone aus Ästen endet, die einen glühenden Kristall hält" },
  "runed-dagger": { label: "Runen-Dolch", description: "Mystischer Dolch mit einer in glühenden Runen beschrifteten Klinge, Knochengriff und dunkler Energie, die entlang der Schneide wirbelt" },
  "wizard-wand": { label: "Zauberstab", description: "Schlanker Holz-Zauberstab mit gerändelten Spiralen, Ledergriff und winzigen Magiefunken, die aus der spitzen Spitze entweichen" },
  "war-horn": { label: "Kriegshorn", description: "Massives gebogenes Kriegshorn, umwickelt mit Leder und Silberbändern, mit Mundstück an einem Ende und ausgestellter dröhnender Öffnung am anderen" },
  "sorcerer-orb": { label: "Hexer-Orb", description: "Kristallener Hexer-Orb, gehalten in einem verdrehten silbernen Klauenständer, mit wirbelndem arkanem Nebel im Inneren der Glaskugel" },
  "zweihander": { label: "Zweihänder", description: "Beidhändiges deutsches Renaissance-Großschwert" },
  "slingshot": { label: "Steinschleuder", description: "Y-förmiger Holzrahmen mit Gummiband" },
  "blowgun": { label: "Blasrohr", description: "Langes Rohr, das mit dem Atem Pfeile verschießt" },
  "service-pistol": { label: "Dienstpistole", description: "Moderne halbautomatische Seitenwaffe" },
  "hunting-rifle": { label: "Jagdgewehr", description: "Repetiergewehr mit Holzschaft und Zielfernrohr" },
  "plasma-sword": { label: "Plasmaschwert / Lichtschwert", description: "Sci-Fi-Energieklinge, die ein helles Leuchten aussendet" },
  "gravity-gun": { label: "Gravity Gun", description: "Sci-Fi-Distanzwaffe zur Manipulation der Physik" },
}

export default map
