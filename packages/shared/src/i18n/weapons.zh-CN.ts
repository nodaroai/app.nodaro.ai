import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // -------------------- Swords --------------------
  "katana":       { label: "武士刀",     description: "日本武士刀,单刃微弯刀身、缠鲨鱼皮的刀柄、圆盘状鍔与镜面抛光" },
  "longsword":    { label: "长剑",       description: "中世纪双刃长剑,直且渐细的剑身、十字护手、皮革缠柄与圆形剑首" },
  "broadsword":   { label: "阔剑",       description: "重型阔剑,宽直双刃剑身、笼状护手与坚固皮革缠柄" },
  "rapier":       { label: "细剑",       description: "纤细细剑,长而窄的刺剑刃、华丽的扫式护手与球形剑首" },
  "saber":        { label: "马刀",       description: "骑兵马刀,单刃弯刀身、铜制指节护手与带肋皮革握把" },
  "scimitar":     { label: "弯刀",       description: "弯曲的弯刀,宽阔的单刃刀身、华丽十字护手与圆形金属刀首" },
  "claymore":     { label: "苏格兰大剑", description: "巨大的双手苏格兰大剑,长直剑身、向前倾的十字护手与皮革包裹的握把" },
  "cutlass":      { label: "短弯刀",     description: "海盗短弯刀,短而弯的单刃刀身、铜制杯状护手与久经风化的木质握把" },
  "wakizashi":    { label: "胁差",       description: "短款日本胁差伴刀,微弯刀刃、小鍔与缠鲨鱼皮握把" },
  "falchion":     { label: "弯背刀",     description: "重型单刃弯背刀,劈砍般渐细的刀身、简单十字护手与铆接皮革握把" },

  // -------------------- Daggers --------------------
  "dagger":       { label: "匕首",       description: "经典双刃匕首,窄而尖的刀身、十字护手与缠绕的皮革握把" },
  "bowie-knife":  { label: "鲍伊刀",     description: "大型鲍伊刀,带尖切的刀身、铜质护手、堆叠皮革垫圈握把与十字护手" },
  "kukri":        { label: "廓尔喀弯刀", description: "尼泊尔廓尔喀弯刀,前弯宽刃、木质握把与独特的内弯曲" },
  "stiletto":     { label: "尖刺匕首",   description: "纤细的尖刺匕首,长针状三角刀身、极简十字护手与渐细握把" },
  "dirk":         { label: "苏格兰短剑", description: "苏格兰短剑,长直单刃刀身、凯尔特结手柄与华丽剑首" },
  "tanto":        { label: "短刀",       description: "日本短刀,带方角凿尖的刀身、小鍔与缠鲨鱼皮握把" },
  "switchblade":  { label: "弹簧刀",     description: "口袋弹簧刀,弹簧折叠刀身、珍珠或树脂侧板与抛光释放按钮" },
  "trench-knife": { label: "战壕刀",     description: "军用战壕刀,纤细双刃刀身与裹住握把的铜制指节护手" },

  // -------------------- Axes --------------------
  "battle-axe":   { label: "战斧",       description: "重型双手战斧,宽弧切刃、带胡须的轮廓与铁箍捆绑的长木柄" },
  "tomahawk":     { label: "投掷战斧",   description: "轻型投掷战斧,小型单刃铁头、直木柄与握把附近的皮革缠绕" },
  "hatchet":      { label: "短柄斧",     description: "紧凑的短柄斧,短木柄、小型单刃钢头与锤打表面" },
  "halberd":      { label: "戟",         description: "长杆戟,结合斧刃、刺枪头与后部钩的高大木杆" },
  "greataxe":     { label: "巨斧",       description: "巨大的双面新月斧头、铁制加固带与需要双手挥舞的长重木柄" },
  "bearded-axe":  { label: "维京胡须斧", description: "维京胡须斧,刀刃下半部加长、窄铁头与皮革缠绕的高木柄" },

  // -------------------- Polearms --------------------
  "spear":        { label: "矛",         description: "简单的矛,树叶形铁矛头绑在高大笔直的木杆上,杆底有小护盖" },
  "lance":        { label: "长枪",       description: "比武长枪,长木杆、锥形钢尖与保护握把的喇叭形护手" },
  "pike":         { label: "长矛",       description: "极长的长矛,小三角矛头装在比人高两倍的高大木杆上" },
  "glaive":       { label: "长柄刀",     description: "长柄刀,长弯单刃刀身装在木杆上,渐细到小型十字护手" },
  "trident":      { label: "三叉戟",     description: "三尖三叉戟,带倒刺的尖锐齿、中央杆与长木杆" },
  "naginata":     { label: "薙刀",       description: "日本薙刀,弯曲单刃刀身装在长漆木杆上,带有丝绸缠绕" },

  // -------------------- Bows --------------------
  "longbow":      { label: "长弓",       description: "高大的英国长弓,单一紫杉木材、上蜡的亚麻弓弦与皮革缠绕握把" },
  "recurve-bow":  { label: "反曲弓",     description: "传统反曲弓,弓臂向外反曲、皮革缠绕的弓把与绷紧的弓弦" },
  "compound-bow": { label: "复合弓",     description: "现代复合弓,铝制偏心轮、每端的滑轮、碳纤维箭台与瞄准针阵列" },
  "crossbow":     { label: "弩",         description: "中世纪弩,水平木质弩身、钢弩臂、绷紧的弓弦与导轨下方的扳机机构" },
  "short-bow":    { label: "短弓",       description: "紧凑的木质短弓,简单的弯曲轮廓、上蜡弓弦与中部皮革握把" },

  // -------------------- Blunt --------------------
  "mace":         { label: "钉锤",       description: "中世纪带凸缘的钉锤,沉重冠状锤头带突出铁凸缘,装在短铁柄上" },
  "war-hammer":   { label: "战锤",       description: "长柄战锤,沉重铁锤头一面有平击打面、另一面有弯曲尖刺" },
  "club":         { label: "棍棒",       description: "简单的木棍,粗壮的疙瘩状头、渐细的杆与底部用旧的皮革握把" },
  "morning-star": { label: "晨星锤",     description: "晨星锤,木柄顶部装着一个布满高耸尖刺的铁球" },
  "flail":        { label: "连枷",       description: "军用连枷,带尖刺的铁球用短链连接到木柄,柄端有铁帽" },
  "nunchaku":     { label: "双节棍",     description: "武术双节棍,两根抛光木棒由短编织绳或链条相连" },

  // -------------------- Throwing --------------------
  "shuriken":      { label: "手里剑",     description: "金属投掷星,中央枢纽辐射出多个锐利尖端,呈黝黑钢面" },
  "throwing-knife":{ label: "飞刀",       description: "平衡的飞刀,树叶形双刃刀身、极简握把与抛光钢面" },
  "boomerang":     { label: "回旋镖",     description: "弯曲的木质回旋镖,带肘弯、绘有部族图案与流线型轮廓" },
  "javelin":       { label: "标枪",       description: "轻型投掷标枪,纤细钢尖、渐细的木杆与平衡点附近的皮革握把缠绕" },
  "bolas":         { label: "投索",       description: "三个加重的石球或铁球用编织皮绳系在中心结点上" },

  // -------------------- Modern Firearms --------------------
  "pistol":         { label: "手枪",         description: "现代半自动手枪,哑黑色聚合物框架、带肋滑套、扳机护圈与齐平弹匣底" },
  "revolver":       { label: "左轮手枪",     description: "六发左轮手枪,旋转弹巢、长枪管、击锤后扳与方格木质握把" },
  "assault-rifle":  { label: "突击步枪",     description: "军用突击步枪,长枪管、可折叠枪托、导轨上的光学瞄具与可拆卸弯曲弹匣" },
  "shotgun":        { label: "霰弹枪",       description: "泵动霰弹枪,大口径枪管、战术护木、下方管状弹仓与木制或合成枪托" },
  "smg":            { label: "冲锋枪",       description: "紧凑型冲锋枪,短枪管、侧装弹匣、可折叠铁丝枪托与一体前握把" },
  "sniper-rifle":   { label: "狙击步枪",     description: "栓动狙击步枪,长枪管、高倍率瞄准镜、双脚架与人体工学聚合物枪托" },
  "machine-gun":    { label: "机枪",         description: "重型弹链供弹机枪,长长带散热片的枪管、双脚架、提把与从侧面送入的弹链" },

  // -------------------- Historical Firearms --------------------
  "musket":          { label: "燧发滑膛枪",   description: "长燧发滑膛枪,光滑铁枪管、胡桃木枪托、铜质配件与靠近枪口固定的刺刀" },
  "flintlock-pistol":{ label: "燧发手枪",     description: "华丽的燧发手枪,弯曲木质握把、雕花铜配件、燧石击锤与单根长枪管" },
  "blunderbuss":     { label: "喇叭口火枪",   description: "短款燧发喇叭口火枪,喇叭形枪口、粗木枪托上的铜配件与海盗时代气场" },
  "dueling-pistol":  { label: "决斗手枪",     description: "优雅的决斗手枪,纤细八角枪管、精雕击发机构与抛光胡桃木握把" },

  // -------------------- Explosives & Siege --------------------
  "grenade":        { label: "手榴弹",       description: "菠萝纹理的铁制破片手榴弹,保险栓拔出后压住勺式拉杆" },
  "stick-grenade":  { label: "柄式手榴弹",   description: "圆柱形柄式手榴弹,铁制弹头装在长木柄顶部,底部带拉绳引信" },
  "dynamite":       { label: "炸药",         description: "成捆的红色炸药棒,用麻绳绑在一起,连接着燃烧的长导火索" },
  "bomb":           { label: "卡通炸弹",     description: "圆形黑色卡通炸弹,顶部冒烟的卷曲导火索与亮闪闪的球形铁壳" },
  "rocket-launcher":{ label: "火箭筒",       description: "肩扛式火箭筒,长发射管、前握把、后部排气锥与光学瞄准镜" },
  "cannon":         { label: "大炮",         description: "铸铁前装式大炮,装在木质轮架上,长光膛枪管与冒烟的发射孔" },
  "catapult":       { label: "投石器",       description: "木质攻城投石器,长长的投掷臂被拉回、配重或扭力捆绑与装载石头的篮子" },
  "trebuchet":      { label: "配重投石机",   description: "高大的中世纪配重投石机,巨大配重、长投掷臂、编织吊索与重木结构框架" },

  // -------------------- Sci-Fi --------------------
  "laser-pistol":  { label: "激光手枪",     description: "紧凑的科幻激光手枪,发光霓虹能量线圈、带肋金属枪身与短发射枪管" },
  "plasma-rifle":  { label: "等离子步枪",   description: "未来等离子步枪,发光蓝色能量电池、带通风的枪管护套与全息瞄具" },
  "lightsaber":    { label: "光剑",         description: "激光剑,金属带肋手柄发出高耸的饱和能量光刃,带朦胧的等离子光晕" },
  "blaster":       { label: "镭射枪",       description: "复古未来镭射手枪,粗壮枪身、发光能量舱、散热孔与顶部安装的瞄准镜" },
  "phaser":        { label: "Phaser 镭射枪", description: "光滑的科幻 Phaser 镭射枪,极简弧形握把、发光发射尖端与控制强度的光滑面板" },
  "rail-gun":      { label: "电磁炮",       description: "重型电磁炮,平行金属轨道、沿身体的巨大电容器与发光的弹丸舱" },
  "emp-grenade":   { label: "电磁脉冲手雷", description: "球形电磁脉冲手雷,外露线圈、发光蓝色指示灯与全息武装拨盘" },

  // -------------------- Fantasy --------------------
  "enchanted-sword":{ label: "附魔剑",       description: "附魔剑,带发光符文蚀刻的剑身、镶金的十字护手与剑首中嵌入的宝石" },
  "magic-staff":    { label: "魔法杖",       description: "高耸虬曲的法师法杖,扭曲木杆顶部分叉成树枝状,握住一颗发光的水晶" },
  "runed-dagger":   { label: "符文匕首",     description: "神秘匕首,刀身刻着发光符文、骨制握把与沿刃口旋绕的暗黑能量" },
  "wizard-wand":    { label: "魔杖",         description: "纤细的木质魔杖,带螺旋雕刻、皮革握把与从尖端漏出的小小魔法火花" },
  "war-horn":       { label: "战斗号角",     description: "巨大的弯曲战斗号角,皮革与银带捆绑,一端为吹口,另一端为喇叭形吹响开口" },
  "sorcerer-orb":   { label: "巫师水晶球",   description: "扭曲银色爪式底座托起的水晶巫师水晶球,玻璃球内悬浮着旋转的奥术雾气" },
}

export default map
