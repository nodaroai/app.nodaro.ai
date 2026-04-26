import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // -------------------- Cats --------------------
  "cat-persian":          { label: "波斯猫",        description: "扁脸长毛、身形粗壮、毛被蓬松奢华的长毛猫" },
  "cat-siamese":          { label: "暹罗猫",        description: "短毛流畅,奶油色身体配脸、耳、爪、尾的深色重点,蓝色杏仁眼锐利夺目" },
  "cat-maine-coon":       { label: "缅因猫",        description: "体型很大的长毛猫,蓬松领毛、耳尖簇毛和环纹蓬松大尾" },
  "cat-bengal":           { label: "孟加拉猫",      description: "肌肉发达、运动型猫,皮毛带豹斑玫瑰花纹,色调金棕" },
  "cat-sphynx":           { label: "斯芬克斯无毛猫", description: "无毛多皱褶,大蝙蝠耳、颧骨突出、肌肉线条优雅" },
  "cat-ragdoll":          { label: "布偶猫",        description: "中长毛大型猫,毛丝顺滑、重点色斑、鲜亮蓝眼" },
  "cat-british-shorthair":{ label: "英国短毛猫",    description: "圆脸毛短而密的灰蓝色猫,圆胖脸颊与铜色大眼" },
  "cat-scottish-fold":    { label: "苏格兰折耳猫",  description: "圆脸折耳、身形结实,圆滚滚的猫头鹰般圆眼" },
  "cat-tabby":            { label: "虎斑猫",        description: "经典短毛条纹猫,额头有 M 形花纹,绿眼机敏" },
  "cat-black":            { label: "黑猫",          description: "全身光亮纯黑短毛,黄绿色明亮双眼,毛色油亮" },

  // -------------------- Dogs --------------------
  "dog-labrador":         { label: "拉布拉多犬",    description: "友善的中大型运动犬,黄、黑或巧克力色短密毛,水獭尾粗壮" },
  "dog-golden-retriever": { label: "金毛犬",        description: "中大型犬,金色波浪长毛奢华,飘扬的羽毛尾,温暖友好的脸" },
  "dog-german-shepherd":  { label: "德国牧羊犬",    description: "强壮警觉的工作犬,棕黑马鞍状毛色,直立耳与浓密尾" },
  "dog-bulldog":          { label: "斗牛犬",        description: "结实粗壮的短毛犬,皱褶扁脸、宽颚与下垂的脸颊" },
  "dog-poodle":           { label: "贵宾犬",        description: "卷毛优雅的犬种,姿态高傲,经典修剪轮廓" },
  "dog-husky":            { label: "西伯利亚哈士奇",description: "厚密双层毛、黑白斑纹、蓝色或异色眼、三角立耳" },
  "dog-beagle":           { label: "比格犬",        description: "三色小型猎犬,长长的下垂耳、短毛与白色尾尖" },
  "dog-dachshund":        { label: "腊肠犬",        description: "身长腿短的犬,胸深、双耳长长下垂" },
  "dog-chihuahua":        { label: "吉娃娃",        description: "苹果头小型玩具犬,巨大的直立耳与机敏大眼" },
  "dog-corgi":            { label: "柯基犬",        description: "短腿牧羊犬,狐狸脸大立耳,红白双色蓬松双层毛" },
  "dog-pug":              { label: "巴哥犬",        description: "结实小型犬,深皱褶扁脸,卷尾,黄褐色被毛配黑色面罩" },
  "dog-border-collie":    { label: "边境牧羊犬",    description: "敏捷的中型牧羊犬,黑白色被毛,凝视坚定,羽毛尾" },
  "dog-rottweiler":       { label: "罗威纳犬",      description: "强壮肌肉发达的犬,黑色短毛油亮,脸、胸和腿带桃花心木色斑纹" },
  "dog-shiba-inu":        { label: "柴犬",          description: "紧凑的尖嘴犬种,红橙色被毛,卷尾、三角立耳、狐狸脸" },

  // -------------------- Transport --------------------
  "horse":   { label: "马",     description: "鬃毛和尾巴飘逸的强壮马匹,蹄健壮、肌肉发达" },
  "camel":   { label: "骆驼",   description: "驼背高耸的沙漠骆驼,长腿厚蹄,神情安详" },
  "donkey":  { label: "驴",     description: "结实的小型驴,长耳短鬃,神情温和" },
  "mule":    { label: "骡",     description: "耐力强的驮骡,长耳短鬃,身形紧凑结实" },
  "ox":      { label: "公牛",   description: "肌肉发达的役牛,肩膀宽阔,角弯曲,神情坚毅" },

  // -------------------- Farm --------------------
  "cow":     { label: "奶牛",   description: "白底黑斑的奶牛,乳房硕大,棕色双眼温和" },
  "pig":     { label: "猪",     description: "粉嫩结实的农场猪,卷尾、圆鼻、立耳" },
  "sheep":   { label: "绵羊",   description: "毛被厚实的绵羊,奶白色厚羊毛,深色脸,腿短" },
  "goat":    { label: "山羊",   description: "灵敏的山羊,毛蓬乱,角弯曲,胡须丛生,瞳孔成长方形" },
  "chicken": { label: "鸡",     description: "经典农场鸡,红冠红肉垂,被羽身体丰满,头侧倾警觉" },
  "rooster": { label: "公鸡",   description: "高傲的公鸡,红冠高耸,绿铜色虹彩羽毛,长长的拱形尾羽" },
  "duck":    { label: "鸭",     description: "棕白相间的农场鸭,橙色喙、蹼足与圆润臀部" },
  "rabbit":  { label: "兔",     description: "蓬松的兔子,长耳直立,鼻子抽动,棉球般小尾巴" },
  "turkey":  { label: "火鸡",   description: "巨大的火鸡,深色虹彩尾扇展开,光秃红头,下垂的肉裾" },

  // -------------------- Wild --------------------
  "lion":       { label: "狮子",      description: "强壮的雄狮,金色鬃毛环绕宽阔的褐色脸庞,身形肌肉饱满" },
  "tiger":      { label: "老虎",      description: "巨大的老虎,橘色皮毛上印着醒目的黑色条纹,琥珀色双眼锐利" },
  "bear":       { label: "棕熊",      description: "皮毛厚密蓬乱的大型棕熊,头宽圆耳,爪掌强壮带利爪" },
  "polar-bear": { label: "北极熊",    description: "巨大的北极熊,奶白厚毛、长颈黑鼻、巨大的厚垫掌" },
  "wolf":       { label: "狼",        description: "瘦削的灰狼,双层毛厚密,直立耳、黄色锐利双眼与浓密尾" },
  "fox":        { label: "狐狸",      description: "瘦长的红狐,尖嘴直立耳,白尖蓬松尾" },
  "elephant":   { label: "大象",      description: "巨大的灰色皱皮大象,长长鼻子、扇动的大耳和弯曲象牙" },
  "zebra":      { label: "斑马",      description: "马身粗壮的斑马,黑白条纹醒目,直立短鬃,深色大眼" },
  "giraffe":    { label: "长颈鹿",    description: "颈长得离谱的优雅长颈鹿,金色拼贴皮纹,头顶小角骨" },
  "panda":      { label: "大熊猫",    description: "圆滚滚的大熊猫,黑白皮毛、圆耳、标志性黑眼圈与温柔脸庞" },
  "leopard":    { label: "豹",        description: "敏捷的豹,黄褐色皮毛布满玫瑰斑,肩部肌肉发达,浅色双眼锐利" },
  "cheetah":    { label: "猎豹",      description: "瘦长善跑的猎豹,金色皮毛布满纯黑实斑,脸上有泪痕状黑线" },
  "monkey":     { label: "猴子",      description: "灵活的长尾猴,棕色双眼充满表情,四肢纤细,毛色棕奶相间" },
  "gorilla":    { label: "大猩猩",    description: "巨大的银背大猩猩,肩膀宽阔,眉骨突出,黑毛厚密" },
  "kangaroo":   { label: "袋鼠",      description: "高大的袋鼠,后腿强壮,尾巴粗壮有力,前爪小巧,耳朵警觉直立" },
  "koala":      { label: "考拉",      description: "蓬松的灰色有袋类动物,圆头、毛茸茸大耳、黑色大鼻,胸前柔软蓬松" },
  "deer":       { label: "鹿",        description: "优雅的鹿,红棕色皮毛、纤细四肢、白色喉斑——若是雄鹿则有分叉鹿角" },
  "raccoon":    { label: "浣熊",      description: "戴面具的浣熊,灰色皮毛,眼周有强盗般的黑色面罩,蓬松环纹尾" },
  "capybara":   { label: "水豚",      description: "南美的大型温顺啮齿动物,身体壮硕,神情安详" },
  "sloth":      { label: "树懒",      description: "行动缓慢的树栖哺乳动物,带有温柔的微笑" },
  "red-panda":  { label: "小熊猫",    description: "小型红棕色食竹动物,狐狸脸庞" },

  // -------------------- Birds --------------------
  "eagle":       { label: "鹰",        description: "雄伟的鹰,深棕色身体、白色头尾、黄色弯钩喙与锋利爪子" },
  "owl":         { label: "猫头鹰",    description: "圆脸的猫头鹰,棕白斑驳羽毛,前向黄色大眼,头顶有羽角" },
  "parrot":      { label: "鹦鹉",      description: "色彩鲜艳的热带鹦鹉,饱和的红绿黄蓝羽毛,弯钩喙" },
  "peacock":     { label: "孔雀",      description: "蓝色虹彩孔雀,巨大的扇形尾羽布满闪光眼斑" },
  "flamingo":    { label: "火烈鸟",    description: "高挑纤细的火烈鸟,亮粉色羽毛、长弯颈,弯喙伸向水面" },
  "penguin":     { label: "企鹅",      description: "直立的燕尾服企鹅,黑背白腹,鳍状小翅膀" },
  "swan":        { label: "天鹅",      description: "优雅的白天鹅,长长弯颈、橙色喙,双翼精巧折叠" },
  "sparrow":     { label: "麻雀",      description: "棕灰色的小麻雀,背带条纹、身形圆润紧凑,小黑眼机敏" },
  "crow":        { label: "乌鸦",      description: "通体油亮的黑色乌鸦,直粗喙、聪慧的黑眼、虹彩光泽羽毛" },
  "hummingbird": { label: "蜂鸟",      description: "迷你宝石色蜂鸟,翠绿与红宝石虹彩羽毛,长针状细喙" },
  "raven":       { label: "渡鸦",      description: "通体油亮的黑色渡鸦,目光聪慧锐利" },

  // -------------------- Sea --------------------
  "dolphin":    { label: "海豚",      description: "光滑的灰色海豚,带笑脸,弯曲背鳍与有力尾鳍" },
  "whale":      { label: "鲸鱼",      description: "巨大的座头鲸,深蓝灰色身体,长长胸鳍,头部布满藤壶状凸起" },
  "shark":      { label: "鲨鱼",      description: "强壮的大白鲨,鱼雷状灰色身体,白色腹部,牙齿尖利成排" },
  "octopus":    { label: "章鱼",      description: "好奇的章鱼,头部圆鼓,大眼充满智慧,八条带吸盘的长腕" },
  "sea-turtle": { label: "海龟",      description: "优雅的海龟,绿棕色花纹龟壳,鳍状肢,带皱褶的智慧脸庞" },
  "jellyfish":  { label: "水母",      description: "半透明的水母,钟状身体发光,长长丝状触手拖曳" },
  "crab":       { label: "螃蟹",      description: "红壳螃蟹,宽阔的盔甲背壳,大钳与横步快走的腿" },
  "seahorse":   { label: "海马",      description: "小巧的海马,卷曲的可缠尾、马形头、精致背鳍" },
  "axolotl":    { label: "墨西哥钝口螈", description: "粉红色的水生蝾螈,头部带有羽毛状的外鳃" },

  // -------------------- Small Pets --------------------
  "hamster":    { label: "仓鼠",      description: "圆滚滚的仓鼠,胖嘟嘟的颊袋、小爪与明亮的黑色珠眼" },
  "guinea-pig": { label: "豚鼠",      description: "丰满的豚鼠,三色软毛,无明显尾巴,脸庞甜美机敏" },
  "ferret":     { label: "雪貂",      description: "身体修长的雪貂,奶油与貂色被毛,黑色面罩与顽皮姿态" },
  "parakeet":   { label: "虎皮鹦鹉",  description: "明亮的绿黄色小型虎皮鹦鹉,头部带条纹,黑色眼斑,长尾渐尖" },
  "gerbil":     { label: "沙鼠",      description: "纤细的沙棕色沙鼠,大黑眼、立耳,长尾尖端有簇毛" },

  // -------------------- Reptiles --------------------
  "snake":     { label: "蛇",        description: "卷曲的蛇,鳞片光滑、菱形花纹皮、瞳孔狭长,舌头分叉吐信" },
  "lizard":    { label: "蜥蜴",      description: "敏捷的蜥蜴,鳞身纤细,长鞭状尾巴,带爪四肢与侧向锐眼" },
  "turtle":    { label: "陆龟",      description: "和善的陆龟,圆顶花纹龟壳、粗壮鳞腿与带皱褶的智慧脸庞" },
  "crocodile": { label: "鳄鱼",      description: "巨大的鳄鱼,橄榄绿装甲鳞片,长满牙齿的吻部,带爪四肢强壮" },
  "chameleon": { label: "变色龙",    description: "会变色的变色龙,头顶有高高的盔状凸起,双眼可独立转动,卷曲的可缠尾" },
  "gecko":     { label: "壁虎",      description: "小型壁虎,带斑点的丰满身体,无眼睑的大眼,宽大的吸盘脚趾" },

  // -------------------- Insects --------------------
  "butterfly":     { label: "蝴蝶",      description: "精致的蝴蝶,翅膀宽大花纹艳丽,身体细长,触角修长" },
  "bee":           { label: "蜜蜂",      description: "毛茸茸的蜂蜜蜜蜂,黄黑相间条纹,翅膀半透明,腿上沾满花粉" },
  "ant":           { label: "蚂蚁",      description: "忙碌的蚂蚁,身体分节深色,六条细腿、弯曲触角与有力大颚" },
  "spider":        { label: "蜘蛛",      description: "八条腿的蜘蛛,腹部圆鼓,黑色复眼成簇,全身覆细毛" },
  "ladybug":       { label: "瓢虫",      description: "小巧的红瓢虫,圆润光亮的甲壳,醒目黑斑与精致小腿" },
  "dragonfly":     { label: "蜻蜓",      description: "纤细的蜻蜓,虹彩蓝绿色身体、巨大复眼与四片透明长翅" },
  "beetle":        { label: "甲虫",      description: "披甲的甲虫,光亮硬壳、棱状鞘翅、结实腿与短触角" },
  "grasshopper":   { label: "蚱蜢",      description: "绿色蚱蜢,后腿强劲有力,翅膀沿背折叠,长长鞭状触角" },
  "praying-mantis":{ label: "螳螂",      description: "细长的螳螂,三角头、复眼大、带刺的捕捉前足摆出祈祷姿势" },
  "mosquito":      { label: "蚊子",      description: "纤细的蚊子,腿细长、翅膀狭窄半透明,口器针状" },
  "scorpion":      { label: "蝎子",      description: "沙漠蝎子,身体分节披甲,大钳子,带毒针的尾巴卷曲举起" },
  "caterpillar":   { label: "毛毛虫",    description: "丰满的分节毛毛虫,身上有柔软绒毛、细小腿,在绿叶上欢快咀嚼" },

  // -------------------- Dinosaurs --------------------
  "t-rex":          { label: "霸王龙",       description: "巨大的霸王龙,后腿强壮、前肢短小带爪,巨颚布满匕首般尖牙,鳞甲皮厚实" },
  "velociraptor":   { label: "迅猛龙",       description: "瘦小的带羽迅猛龙,镰刀爪、长直尾,前倾的捕食姿势" },
  "triceratops":    { label: "三角龙",       description: "披甲的三角龙,头后有大骨盾,脸上三只尖角,四足重心稳健" },
  "brachiosaurus":  { label: "腕龙",         description: "高耸的腕龙,长得离谱的脖子伸向树梢,头小、腿如柱状" },
  "stegosaurus":    { label: "剑龙",         description: "笨重的剑龙,背部两排高耸的菱形板,尾部带尖刺" },
  "pterodactyl":    { label: "翼手龙",       description: "飞翔的翼手龙,皮翼宽阔、长喙带牙、头后有后掠冠" },
  "spinosaurus":    { label: "棘龙",         description: "捕食型棘龙,背部有高耸帆鳍,长长的鳄鱼般吻部,前肢带强爪" },
  "diplodocus":     { label: "梁龙",         description: "庞大的长身梁龙,鞭状细尾平衡同样长的脖子,牙如木桩,腿粗壮" },
  "ankylosaurus":   { label: "甲龙",         description: "坦克般的甲龙,身披厚甲与尖刺,尾末端有巨大骨锤" },
  "brontosaurus":   { label: "雷龙",         description: "温柔的雷龙巨兽,长颈舒展、头小、身体粗壮,鞭状尾渐细" },
  "parasaurolophus":{ label: "副栉龙",       description: "鸭嘴的副栉龙,头后有长长向后弯曲的管状冠,身形纤细两足行走" },
  "allosaurus":     { label: "异特龙",       description: "凶猛的异特龙,头大、眉上有小角、牙齿带锯齿,前肢有抓握力" },

  // -------------------- Mythical --------------------
  "dragon":  { label: "龙",     description: "高耸的巨龙,皮翼坚韧、鳞片棱起、角弯曲、双眼发光,鼻孔冒出袅袅烟雾" },
  "unicorn": { label: "独角兽", description: "纯白的独角兽,粉彩色鬃毛和尾巴飘逸,额前一只螺旋珠光独角" },
  "phoenix": { label: "凤凰",   description: "雄伟的凤凰,红橙金羽毛如火,长尾羽飘曳,翼尖燃烧着火焰" },
  "griffin": { label: "狮鹫",   description: "混血狮鹫,头、翅与前爪如鹰,后身肌肉发达如狮" },
  "pegasus": { label: "飞马",   description: "纯白的有翼之马,羽翼飘扬、鬃毛流动,带有超凡的气场" },
  "kraken":  { label: "克拉肯", description: "巨大的海怪克拉肯,头颅庞大、双眼发光,带吸盘的巨大触手从深海中翻涌而出" },
}

export default map
