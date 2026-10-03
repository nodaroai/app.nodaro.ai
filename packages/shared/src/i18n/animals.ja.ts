import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // Cats
  "cat-persian": { label: "ペルシャ猫", description: "平らな顔、がっしりした体格、贅沢でふわふわした被毛を持つ長毛種の猫" },
  "cat-siamese": { label: "シャム猫", description: "クリーム色の体に顔・耳・足・尾の暗いポイント、鋭く青いアーモンド形の瞳を持つ短毛のしなやかな猫" },
  "cat-maine-coon": { label: "メインクーン", description: "ふさふさした襟巻き、房状の耳、リング模様の太い尾を持つ非常に大きな長毛種の猫" },
  "cat-bengal": { label: "ベンガル猫", description: "金色と茶色のヒョウのようなロゼット模様のつややかな被毛を持つ、筋肉質で引き締まった猫" },
  "cat-sphynx": { label: "スフィンクス", description: "大きなコウモリのような耳、際立った頬骨、エレガントで筋肉質な体つきを持つ無毛のしわのある猫" },
  "cat-ragdoll": { label: "ラグドール", description: "柔らかく絹のような被毛、カラーポイント、鮮やかな青い瞳を持つ大型の半長毛種の猫" },
  "cat-british-shorthair": { label: "ブリティッシュショートヘア", description: "密な青灰色の被毛、ふっくらした頬、銅色の瞳を持つ、ぬいぐるみのような丸顔の猫" },
  "cat-scottish-fold": { label: "スコティッシュフォールド", description: "小さく折れた耳、がっしりした体、フクロウのような大きな丸い瞳を持つ丸顔の猫" },
  "cat-tabby": { label: "トラ猫", description: "額にM字模様があり、きりっとした緑の瞳を持つクラシックな縞模様の短毛種" },
  "cat-black": { label: "黒猫", description: "鮮やかな黄緑色の瞳と艶やかな被毛を持つ、すらりとした全身真っ黒の短毛猫" },

  // Dogs
  "dog-labrador": { label: "ラブラドール・レトリバー", description: "黄・黒・チョコレートの短く密な被毛とカワウソのような太い尾を持つ、人懐っこい中型から大型の猟犬" },
  "dog-golden-retriever": { label: "ゴールデン・レトリバー", description: "豊かに波打つ金色の被毛、飾り毛のある尾、温かくフレンドリーな顔を持つ中型から大型の犬" },
  "dog-german-shepherd": { label: "ジャーマン・シェパード", description: "タンと黒のサドル模様、立った耳、ふさふさした尾を持つ、力強く警戒心のあるワーキングドッグ" },
  "dog-bulldog": { label: "ブルドッグ", description: "しわの寄った平らな顔、広い顎、たるんだ頬を持つ、がっしりとした筋肉質の短毛犬" },
  "dog-poodle": { label: "プードル", description: "誇り高い姿勢とクラシックなトリミングのシルエットを持つエレガントな巻き毛の犬" },
  "dog-husky": { label: "シベリアン・ハスキー", description: "黒と白の模様、鋭い青または異なる色の瞳、立った三角形の耳を持つ厚いダブルコートの犬" },
  "dog-beagle": { label: "ビーグル", description: "長く垂れた耳、短い被毛、白い先端の尾を持つ小型の三色ハウンド犬" },
  "dog-dachshund": { label: "ダックスフンド", description: "短い脚、深い胸、長く垂れた耳を持つ、長く低い体型の犬" },
  "dog-chihuahua": { label: "チワワ", description: "リンゴのような頭、とても大きな立ち耳、ぱっちりと見開いた大きな瞳を持つ小さなトイ犬" },
  "dog-corgi": { label: "コーギー", description: "キツネのような顔、巨大な立ち耳、赤と白の豊かなダブルコートを持つ短足の牧畜犬" },
  "dog-pug": { label: "パグ", description: "深いしわのある平らな顔、巻いた尾、黒いマスクのあるフォーンの被毛を持つ小型でがっしりした犬" },
  "dog-border-collie": { label: "ボーダー・コリー", description: "黒と白の被毛、強い眼差し、飾り毛のある尾を持つ、機敏な中型の牧畜犬" },
  "dog-rottweiler": { label: "ロットワイラー", description: "短く艶やかな黒い被毛と、顔・胸・脚にマホガニー色の特徴的な模様を持つ力強く筋肉質な犬" },
  "dog-shiba-inu": { label: "柴犬", description: "赤橙色の被毛、巻いた尾、立った三角形の耳、キツネのような顔を持つコンパクトなスピッツ系の犬" },

  // Transport
  "horse": { label: "馬", description: "流れるたてがみと尾、頑丈な蹄、筋肉質な体つきを持つ、力強く優雅な馬" },
  "camel": { label: "ラクダ", description: "高いこぶ、長い脚、幅広く厚い足裏、穏やかな表情を持つ砂漠のラクダ" },
  "donkey": { label: "ロバ", description: "長い耳、短く立ったたてがみ、優しい顔つきを持つ小型でがっしりしたロバ" },
  "mule": { label: "ラバ", description: "長い耳、短く暗い色のたてがみ、コンパクトで筋肉質な体つきを持つ頑丈な荷役ラバ" },
  "ox": { label: "雄牛", description: "広い肩、湾曲した角、辛抱強く動じない顔つきを持つ巨大な役牛" },

  // Farm
  "cow": { label: "牛", description: "白と黒の斑模様の皮、大きな乳房、優しい茶色の瞳を持つ乳牛" },
  "pig": { label: "豚", description: "巻いた尾、丸い鼻、立った耳を持つ、ピンク色のずんぐりとした農場の豚" },
  "sheep": { label: "羊", description: "厚いクリーム色の毛、黒っぽい顔、短い脚を持つふわふわの羊毛種" },
  "goat": { label: "ヤギ", description: "もこもこの被毛、湾曲した角、あごひげの房、長方形の瞳孔を持つ機敏なヤギ" },
  "chicken": { label: "鶏", description: "赤いとさかと肉ぜん、羽毛に覆われた体を持ち、首をかしげて辺りを見回す典型的な農場の鶏" },
  "rooster": { label: "雄鶏", description: "高い赤いとさか、虹色の緑と銅の羽根、長く弧を描く尾羽を持つ誇り高い雄鶏" },
  "duck": { label: "アヒル", description: "オレンジ色のくちばし、水かきのある足、丸いお尻を持つ白と茶色の農場のアヒル" },
  "rabbit": { label: "ウサギ", description: "長く立った耳、ピクピクと動く鼻、綿毛のような尾を持つふわふわのウサギ" },
  "turkey": { label: "七面鳥", description: "暗い虹色の尾羽の扇、剥き出しの赤い頭、ぶら下がった肉垂を持つ大きな七面鳥" },

  // Wild
  "lion": { label: "ライオン", description: "幅広い黄褐色の顔を縁取る厚い金色のたてがみと筋肉質な体つきを持つ力強い雄ライオン" },
  "tiger": { label: "トラ", description: "印象的なオレンジ色の毛皮、大胆な黒い縞、強烈な琥珀色の瞳を持つ巨大なトラ" },
  "bear": { label: "クマ", description: "厚くもじゃもじゃの毛、広い頭、丸い耳、強力な爪のある足を持つ大きな茶色のクマ" },
  "polar-bear": { label: "ホッキョクグマ", description: "厚いクリーム色がかった白い毛、長い首、黒い鼻、肉球のある大きな足を持つ、北極に住む巨大なクマ" },
  "wolf": { label: "オオカミ", description: "厚いダブルコート、立った耳、鋭い黄色の瞳、ふさふさした尾を持つ、引き締まった体の灰色のオオカミ" },
  "fox": { label: "キツネ", description: "鋭く尖った口先、立った耳、先端が白く長いふさふさの尾を持つ、ほっそりしたアカギツネ" },
  "elephant": { label: "ゾウ", description: "しわのある灰色の皮膚、長い鼻、ぱたぱたと動く幅広の耳、湾曲した象牙を持つ巨大なゾウ" },
  "zebra": { label: "シマウマ", description: "大胆な白黒の縞、短く立ったたてがみ、大きな暗い瞳を持つ馬のような頑丈なシマウマ" },
  "giraffe": { label: "キリン", description: "信じられないほど長い首、金色のパッチワークの被毛、小さなオシコーン角を持つ、背が高く優雅なキリン" },
  "panda": { label: "ジャイアントパンダ", description: "白黒の被毛、丸い耳、目の周りの特徴的な黒い模様、優しい顔つきを持つコロコロしたパンダ" },
  "leopard": { label: "ヒョウ", description: "ロゼット模様で覆われた黄褐色の毛皮、筋肉質な肩、鋭い淡色の瞳を持つしなやかな斑点のヒョウ" },
  "cheetah": { label: "チーター", description: "黒一色の斑点が散る金色の毛皮と、顔に涙の跡のような黒い線を持つ、細身で俊足のチーター" },
  "monkey": { label: "サル", description: "表情豊かな茶色の瞳、ほっそりした手足、柔らかな茶色とクリーム色の被毛を持つ機敏な長尾のサル" },
  "gorilla": { label: "ゴリラ", description: "広い肩、突き出た眉、厚い黒い毛を持つ巨大なシルバーバックのゴリラ" },
  "kangaroo": { label: "カンガルー", description: "強力な後ろ足、太く筋肉質な尾、小さな前足、ピンと立った耳を持つ背の高いカンガルー" },
  "koala": { label: "コアラ", description: "丸い頭、大きくふさふさした耳、大きな黒い鼻、柔らかなふわふわの胸を持つ灰色の有袋類" },
  "deer": { label: "シカ", description: "赤褐色の被毛、ほっそりした脚、白い喉のパッチ、雄では枝分かれした角を持つ優雅なシカ" },
  "raccoon": { label: "アライグマ", description: "灰色の被毛、目元を横切る泥棒の覆面のような黒い模様、ふさふさしたリング模様の尾を持つアライグマ" },

  // Birds
  "eagle": { label: "ワシ", description: "暗い茶色の体、白い頭と尾、湾曲した黄色のくちばし、鋭い爪を持つ威厳あるワシ" },
  "owl": { label: "フクロウ", description: "斑模様の茶色と白の羽毛、巨大な前向きの黄色い瞳、耳のような羽角を持つ丸顔のフクロウ" },
  "parrot": { label: "インコ", description: "鮮やかな赤・緑・黄・青の羽毛と曲がったくちばしを持つ熱帯のインコ" },
  "peacock": { label: "クジャク", description: "目玉模様の輝く羽根の巨大な扇状の尾を持つ虹色の青いクジャク" },
  "flamingo": { label: "フラミンゴ", description: "鮮やかなピンクの羽毛、長く湾曲した首、水に浸かる曲がったくちばしを持つ、すらりとしたフラミンゴ" },
  "penguin": { label: "ペンギン", description: "黒い背、白い腹、フリッパー状の小さな翼を持つ直立したタキシード姿のペンギン" },
  "swan": { label: "白鳥", description: "長く湾曲した首、オレンジのくちばし、繊細に折りたたまれた翼を持つエレガントな白鳥" },
  "sparrow": { label: "スズメ", description: "縞模様の背、整った丸い体、警戒した黒い瞳を持つ茶色と灰色の小さなスズメ" },
  "crow": { label: "カラス", description: "太くまっすぐなくちばし、知的な黒い瞳、滑らかな虹色の羽根を持つ艶のある真っ黒なカラス" },
  "hummingbird": { label: "ハチドリ", description: "虹色のエメラルドとルビーの羽毛と長い針のようなくちばしを持つ宝石色の小さなハチドリ" },

  // Sea
  "dolphin": { label: "イルカ", description: "遊び心のある笑顔、湾曲した背びれ、強力な尾びれを持つ、しなやかな灰色のイルカ" },
  "whale": { label: "クジラ", description: "暗い青灰色の体、長い胸びれ、フジツボの付いたこぶの頭を持つ巨大なザトウクジラ" },
  "shark": { label: "サメ", description: "魚雷型の灰色の体、白い下面、鋭い歯の列を持つ力強いホホジロザメ" },
  "octopus": { label: "タコ", description: "丸く膨らんだ頭、大きな知的な瞳、吸盤のある8本の長い腕を持つ好奇心旺盛なタコ" },
  "sea-turtle": { label: "ウミガメ", description: "緑と茶色の模様のある甲羅、フリッパー状の手足、賢くしわのある顔を持つ優雅なウミガメ" },
  "jellyfish": { label: "クラゲ", description: "輝く鐘型の体と長く流れる糸状の触手を持つ半透明のクラゲ" },
  "crab": { label: "カニ", description: "幅広い装甲の甲羅、大きなはさみ、横歩きする足を持つ赤い甲のカニ" },
  "seahorse": { label: "タツノオトシゴ", description: "巻き付く尾、馬のような頭、繊細な背びれを持つ小さなタツノオトシゴ" },

  // Small pets
  "hamster": { label: "ハムスター", description: "ふっくらした頬袋、小さな手、明るく黒いビーズのような瞳を持つ丸くふわふわのハムスター" },
  "guinea-pig": { label: "モルモット", description: "柔らかな三色の被毛、外からは見えない尾、目をぱっちり開けた愛らしい顔を持つふっくらしたモルモット" },
  "ferret": { label: "フェレット", description: "クリーム色とセーブルの被毛、目元の黒いマスク模様、遊び心のある姿勢を持つ細長い体のフェレット" },
  "parakeet": { label: "セキセイインコ", description: "縞模様の頭、暗い目の斑点、長く先細りの尾を持つ鮮やかな緑と黄色の小さなセキセイインコ" },
  "gerbil": { label: "スナネズミ", description: "大きな暗い瞳、立った耳、長く房状の尾を持つ、ほっそりした砂色のスナネズミ" },

  // Reptiles
  "snake": { label: "ヘビ", description: "滑らかな鱗の体、ダイヤモンド模様の皮膚、細長い瞳孔、チロチロと動く二股の舌を持つ、とぐろを巻いたヘビ" },
  "lizard": { label: "トカゲ", description: "ほっそりした鱗の体、長い鞭状の尾、爪のある足、顔の側面についた鋭い目を持つ機敏なトカゲ" },
  "turtle": { label: "カメ", description: "ドーム型の模様のある甲羅、頑丈な鱗の足、賢くしわのある顔を持つフレンドリーな陸ガメ" },
  "crocodile": { label: "ワニ", description: "装甲のオリーブグリーンの鱗、長い歯のある口先、強力な爪のある手足を持つ巨大なワニ" },
  "chameleon": { label: "カメレオン", description: "兜のように高く突き出た頭、左右別々に動く目、しっかり巻いた把握尾を持つ、体色を変えるカメレオン" },
  "gecko": { label: "ヤモリ", description: "ふっくらした斑点のある体、大きなまぶたのない瞳、幅広い粘着性のある足指を持つ小さなヤモリ" },

  // Insects
  "butterfly": { label: "蝶", description: "鮮やかな色の幅広く模様のある翅、ほっそりした体、長い触角を持つ繊細な蝶" },
  "bee": { label: "ミツバチ", description: "黄色と黒の縞、半透明の翅、花粉まみれの足を持つふわふわのミツバチ" },
  "ant": { label: "アリ", description: "節のある暗い体、6本の細い足、曲がった触角、強力な大顎を持つ忙しいアリ" },
  "spider": { label: "クモ", description: "丸く膨らんだ腹部、寄り集まった黒い目、体中の細かい毛を持つ8本足のクモ" },
  "ladybug": { label: "テントウムシ", description: "艶のある丸い殻、大胆な黒い斑点、覗く繊細な足を持つ小さな赤いテントウムシ" },
  "dragonfly": { label: "トンボ", description: "虹色の青緑の体、巨大な複眼、4枚の長く透明な翅を持つ、ほっそりしたトンボ" },
  "beetle": { label: "甲虫", description: "艶のある硬い殻、稜のある翅鞘、頑丈な足、短い触角を持つ装甲の甲虫" },
  "grasshopper": { label: "バッタ", description: "長く強力な後ろ足、背中に折りたたまれた翅、長い鞭のような触角を持つ緑のバッタ" },
  "praying-mantis": { label: "カマキリ", description: "三角形の頭、大きな複眼、祈るように構えた棘のある鎌状の前脚を持つ細長いカマキリ" },
  "mosquito": { label: "蚊", description: "長く細い足、狭く透明な翅、針のような口吻を持つ、ほっそりした蚊" },
  "scorpion": { label: "サソリ", description: "装甲の節、大きなはさみ、背中に上がった毒針付きの巻いた尾を持つ砂漠のサソリ" },
  "caterpillar": { label: "イモムシ", description: "柔らかな毛の房と小さな脚を持ち、緑の葉の上で楽しげにむしゃむしゃ食べる、ふっくらした節のあるイモムシ" },

  // Dinosaurs
  "t-rex": { label: "ティラノサウルス・レックス", description: "強力な後ろ足、小さな爪のある腕、短剣のような歯がいっぱいの大きな顎、厚い鱗の皮膚を持つ巨大なティラノサウルス" },
  "velociraptor": { label: "ヴェロキラプトル", description: "鎌状の爪、長く硬い尾、捕食者のような前傾姿勢を持つ、引き締まった体の羽毛のヴェロキラプトル" },
  "triceratops": { label: "トリケラトプス", description: "大きな骨のえり飾り、顔の3本の鋭い角、重い四足の構えを持つ装甲のトリケラトプス" },
  "brachiosaurus": { label: "ブラキオサウルス", description: "木のてっぺんに届く信じられないほど長い首、小さな頭、柱のような足を持つそびえ立つブラキオサウルス" },
  "stegosaurus": { label: "ステゴサウルス", description: "背中に沿って2列の高いダイヤモンド型のプレートと、棘のある尾を持つ巨大なステゴサウルス" },
  "pterodactyl": { label: "プテロダクティルス", description: "広大な革のような翼、長い歯のあるくちばし、後ろに伸びた頭の冠を持つ飛行するプテロダクティルス" },
  "spinosaurus": { label: "スピノサウルス", description: "背中に高い帆ヒレ、長いワニのような口先、強力な爪のある腕を持つ捕食性のスピノサウルス" },
  "diplodocus": { label: "ディプロドクス", description: "鞭のように細い尾、同じく長い首、ペグ状の歯、頑丈な足を持つ巨大な長い体のディプロドクス" },
  "ankylosaurus": { label: "アンキロサウルス", description: "厚い装甲のプレートと棘で覆われ、尾の先端に巨大な骨の棍棒を持つ戦車のようなアンキロサウルス" },
  "brontosaurus": { label: "ブロントサウルス", description: "長く流れる首、小さな頭、太い体、先細りの鞭のような尾を持つ穏やかな巨人ブロントサウルス" },
  "parasaurolophus": { label: "パラサウロロフス", description: "頭から後ろに伸びる長く湾曲した管状の冠と、ほっそりした二足歩行の体を持つ、カモノハシ竜のパラサウロロフス" },
  "allosaurus": { label: "アロサウルス", description: "大きな頭、目の上の小さな角、鋸状の歯、獲物をつかむ力強い腕を持つ、獰猛な捕食者アロサウルス" },

  // Mythical
  "dragon": { label: "ドラゴン", description: "革のような翼、稜のある鱗、湾曲した角、輝く瞳、鼻孔から立ち上る煙を持つそびえ立つドラゴン" },
  "unicorn": { label: "ユニコーン", description: "流れるパステル色のたてがみと尾、額に1本の螺旋状の真珠光沢の角を持つ純白のユニコーン" },
  "phoenix": { label: "フェニックス", description: "燃えるような赤・橙・金の羽毛、長く流れる尾羽、翼の先端をなめる炎を持つ威厳ある不死鳥" },
  "griffin": { label: "グリフォン", description: "ワシの頭・翼・爪のある前足とライオンの筋肉質な後半身を併せ持つグリフォン" },
  "pegasus": { label: "ペガサス", description: "羽毛の翼、流れるたてがみ、異世界的な存在感を持つ純白の翼の馬" },
  "kraken": { label: "クラーケン", description: "巨大な頭、輝く瞳、深淵から伸びる吸盤付きの巨大な触手を持つ巨大な海の獣クラーケン" },

  // Additional animals
  "capybara": { label: "カピバラ", description: "樽のような胴体、丸みのある鼻先、穏やかな表情を持つ南米原産の大型でおとなしい齧歯類、柑橘の浮かぶ温泉につかる姿がよく撮影される" },
  "sloth": { label: "ナマケモノ", description: "もじゃもじゃの毛と長く曲がった爪を持ち、穏やかな笑顔を絶やさない、ゆっくり動く樹上性の哺乳類、枝から逆さまにぶら下がる姿が多い" },
  "red-panda": { label: "レッサーパンダ", description: "濃い赤褐色の毛、顔の白い模様、リング模様の尾、房毛のある立ち耳を持つ、キツネ顔で竹を食べる小型動物、ジャイアントパンダとは別種" },
  "raven": { label: "ワタリガラス", description: "太いくさび形のくちばし、ぼさぼさの喉の羽毛、知的で鋭い眼差しを持つ、艶のある真っ黒な大型のワタリガラス、映画のような神秘的な雰囲気でとまっている姿が多い" },
  "axolotl": { label: "ウーパールーパー", description: "頭から扇状に広がる羽毛のような外鰓、小さな爪のある手足、特徴的な笑顔を持つピンク色の水生サンショウウオ" },

  // Additional animals
  "pangolin": { label: "センザンコウ", description: "重なり合う特徴的な鱗板に覆われた、鎧のようなアリクイ" },
  "okapi": { label: "オカピ", description: "シマウマ模様の脚を持つ森のキリン" },
  "quokka": { label: "クオッカ", description: "ネットで自撮り動物として有名な、微笑むオーストラリアの有袋類" },
  "meerkat": { label: "ミーアキャット", description: "見張りの姿勢で立ち上がるアフリカのマングース" },
  "emu": { label: "エミュー", description: "オーストラリアに生息する、飛べない大型の走鳥類" },
  "tarantula": { label: "タランチュラ", description: "大型で毛深い狩猟性のクモ" },
}

export default map
