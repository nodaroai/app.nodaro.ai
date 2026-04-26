import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // -------------------- Seating --------------------
  "sofa":           { label: "沙发",         description: "三人座沙发,带柔软坐垫和靠背、低扶手,中性色软包" },
  "sectional-sofa": { label: "组合沙发",     description: "L 形组合沙发,深座、软垫,贵妃端,带隐藏储物或可调躺机构" },
  "loveseat":       { label: "双人沙发",     description: "紧凑型双人沙发,卷边扶手、簇绒靠背与锥形木腿" },
  "armchair":       { label: "扶手椅",       description: "软包扶手椅,高靠背、弧形扶手与四条细木腿" },
  "recliner":       { label: "可调躺椅",     description: "厚软垫的可调躺椅,带拉杆、伸出脚踏、厚皮包覆与后倾靠背" },
  "office-chair":   { label: "办公椅",       description: "人体工学办公椅,网背、可调扶手、气压升降与五星脚轮底" },
  "rocking-chair":  { label: "摇椅",         description: "木制摇椅,弧形摇杆、藤编靠背与软垫坐面" },
  "throne":         { label: "宝座",         description: "华丽的皇室宝座,雕花高靠背、镶金边、嵌宝石与天鹅绒坐垫" },
  "bean-bag":       { label: "豆袋椅",       description: "超大慵懒豆袋椅,柔软外布与如枕般贴合身体的柔软形态" },
  "stool":          { label: "凳",           description: "无靠背简单凳,圆形木坐面、四条外撇车制腿,使用感包浆" },
  "bench":          { label: "长凳",         description: "长木凳,坐面平整、镂空板背、结实木腿" },
  "chaise-lounge":  { label: "贵妃椅",       description: "优雅贵妃椅,斜枕头部、加长软包坐面与车制木腿" },
  "dining-chair":   { label: "餐椅",         description: "正式餐椅,高镂空靠背、软包坐垫与锥形木腿" },

  // -------------------- Tables --------------------
  "dining-table":   { label: "餐桌",         description: "大型长方形餐桌,木面抛光、厚实支架底,可坐 6 至 8 人" },
  "coffee-table":   { label: "咖啡桌",       description: "矮长方形咖啡桌,玻璃或木面、极简腿与下层杂志架" },
  "side-table":     { label: "边几",         description: "小型边几,圆形面、单抽屉与细锥形腿" },
  "console-table":  { label: "玄关桌",       description: "窄长玄关桌,细长面、纤细腿和围裙处的装饰花纹" },
  "desk":           { label: "书桌",         description: "书桌,平整工作面、侧边抽屉柜与背后的理线开口" },
  "workbench":      { label: "工作台",       description: "重型工作台,厚实切肉砧板面、洞洞板背板与一边夹有台钳" },
  "vanity-table":   { label: "梳妆台",       description: "梳妆桌,宽大三折镜、两侧小抽屉与下方软垫坐凳" },
  "nightstand":     { label: "床头柜",       description: "小型床头柜,单抽屉、下方开放搁架与可放台灯的桌面" },
  "picnic-table":   { label: "野餐桌",       description: "经典木野餐桌,木板面、连体长凳与户外久经风化的处理" },

  // -------------------- Beds --------------------
  "bed-single":      { label: "单人床",       description: "窄单人床,带软包床头、贴合床单与脚部叠好的针织毯" },
  "bed-queen":       { label: "大号床",       description: "Queen 大床,带高高软包床头、层叠枕头、洁净羽绒被与床尾装饰布" },
  "bed-king":        { label: "特大床",       description: "King 特大床,簇绒床头、多个软枕、洁净白色床品与厚实绗缝羽绒被" },
  "bunk-bed":        { label: "上下铺",       description: "结实木质上下铺,两层床垫、侧梯、安全护栏与儿童友好的成套床品" },
  "canopy-bed":      { label: "顶篷床",       description: "四柱顶篷床,高雕柱、布质顶篷罩与四角飘动的帷帘" },
  "four-poster-bed": { label: "四柱床",       description: "四柱床,四角车制立柱不加装饰,与雕花床头形成呼应" },
  "daybed":          { label: "贵妃榻床",     description: "贵妃榻床,矮框架、三面软包形成扶手与靠背,墙边铺有长枕" },
  "crib":            { label: "婴儿床",       description: "木制婴儿床,垂直栏杆、合身小床垫与床内塞着的软玩具" },
  "futon":           { label: "可折叠床",     description: "可折叠床,薄软垫加可折叠金属架,沙发可秒变床" },
  "hammock":         { label: "吊床",         description: "麻绳编织吊床,挂在两个支撑物之间,弧度迷人,两端饰有彩色流苏" },

  // -------------------- Storage --------------------
  "bookshelf":     { label: "书架",         description: "高耸的独立书架,多层水平搁板、木侧板与整齐排列的书" },
  "wardrobe":      { label: "衣柜",         description: "大型双开门衣柜,带全长悬挂区、抽屉柜与装饰镶板柜门" },
  "dresser":       { label: "斗柜",         description: "木制斗柜,宽顶、两列共六个深抽屉、铜质拉手与短锥形腿" },
  "cabinet":       { label: "柜",           description: "储物柜,镶板门、内部可调搁板与铜质五金件" },
  "chest":         { label: "储物箱",       description: "做旧木质储物箱,铁艺包边、铰链拱顶盖与前方厚重搭扣" },
  "trunk":         { label: "蒸汽行李箱",   description: "复古蒸汽行李箱,带皮革带、铜角、旅行贴纸与带托盘的内部" },
  "filing-cabinet":{ label: "文件柜",       description: "四抽金属文件柜,每抽屉带标签槽、内嵌拉手与顶部钥匙锁" },
  "tv-stand":      { label: "电视柜",       description: "矮电视柜,开放搁架、玻璃门柜与穿线孔" },
  "display-case":  { label: "展示柜",       description: "高玻璃展示柜,内置照明、玻璃搁板与可上锁的玻璃门" },
  "hutch":         { label: "餐具柜",       description: "两段式餐具柜,玻璃门上柜立摆盘子,带抽屉柜门的下柜" },
  "toy-chest":     { label: "玩具箱",       description: "彩绘木质玩具箱,带可爱图案、缓降铰链盖与侧面贴满贴纸" },

  // -------------------- Lighting --------------------
  "floor-lamp":   { label: "落地灯",   description: "高落地灯,纤细金属杆、配重底座、拉绳开关与顶部鼓形布艺灯罩" },
  "table-lamp":   { label: "台灯",     description: "经典台灯,陶瓷底座、褶皱布艺灯罩与小拉绳开关" },
  "desk-lamp":    { label: "书桌灯",   description: "可调式书桌灯,可活动臂、铰链头与小型锥形金属罩" },
  "chandelier":   { label: "吊灯",     description: "宏伟水晶吊灯,层叠水晶串、弧形金色吊臂与多枚火焰形灯泡" },
  "pendant-light":{ label: "吊灯(单)", description: "现代单头吊灯,长线悬吊、极简金属或玻璃灯罩" },
  "sconce":       { label: "壁灯",     description: "壁挂式壁灯,装饰底板、弧形吊臂与朝上的布艺或玻璃灯罩" },
  "lantern":      { label: "灯笼",     description: "经典灯笼,金属框架、玻璃面板,内置蜡烛或闪烁灯泡,顶部带提环" },
  "candelabra":   { label: "烛台",     description: "华丽银烛台,多枝弧形分叉,每枝插着一根细长蜡烛" },
  "neon-sign":    { label: "霓虹灯牌", description: "发光的霓虹灯牌,弯曲玻璃管组成草书文字或复古图标,在墙上投出彩色光" },

  // -------------------- Kitchen & Dining --------------------
  "kitchen-island":{ label: "厨房中岛",   description: "独立厨房中岛,厚实切肉砧板面、下方柜储、吧台外挑与上方挂架" },
  "bar-counter":   { label: "吧台",       description: "家庭吧台,木质抛光台面、铜质脚踏、背光玻璃陈列架与酒瓶展示" },
  "bar-stool":     { label: "吧凳",       description: "高吧凳,圆形旋转坐面、脚踏环、金属架与可选低靠背" },
  "pot-rack":      { label: "锅架",       description: "悬挂式锅架,锻铁框、S 钩挂着锅、上方还可放调料" },
  "spice-rack":    { label: "调料架",     description: "壁挂式调料架,排列着标签玻璃罐、木搁板,带杂乱欢快的家常感" },
  "buffet":        { label: "餐边柜",     description: "长餐边柜,平面用于放餐盘,抽屉收餐布,下方柜门收纳餐具" },

  // -------------------- Outdoor --------------------
  "patio-chair":     { label: "庭院椅",       description: "户外庭院椅,耐候编织藤面、铝架与防水坐垫" },
  "adirondack-chair":{ label: "阿迪朗达克椅", description: "经典木质阿迪朗达克椅,斜倚条板背、宽大平扶手与微微下倾的座面" },
  "porch-swing":     { label: "门廊秋千",     description: "木质门廊秋千,用链条悬吊于天花板,条板坐面与一排彩色户外坐垫" },
  "gazebo":          { label: "凉亭",         description: "独立户外凉亭,尖顶瓦盖、六根开放木柱、栏杆与抬高的木地板" },
  "bistro-set":      { label: "小酒馆桌椅",   description: "紧凑户外小酒馆桌椅,圆形锻铁桌与两把同款椅子,光泽耐候漆面" },
  "sun-lounger":     { label: "日光躺椅",     description: "泳池边日光躺椅,可调靠背、白色乙烯带与配套小边桌" },
  "fire-pit":        { label: "火盆",         description: "圆形户外火盆,粗铁外壳、跳动火焰与防护网下的炽热余烬" },

  // -------------------- Decorative --------------------
  "mirror":           { label: "镜子",         description: "大型壁镜,镀金华丽边框、雕花与略带做旧的镜面" },
  "rug":              { label: "地毯",         description: "大型花纹地毯,精致编织图案、流苏边和柔软厚毛" },
  "vase":             { label: "花瓶",         description: "高耸陶瓷花瓶,圆肚窄颈、釉面与瓶口的鲜花花束" },
  "grandfather-clock":{ label: "落地钟",       description: "高大木质落地钟,玻璃门内有钟摆、铜钟面、罗马数字与报时机构" },
  "wall-art":         { label: "装裱壁画",     description: "大型装裱画作,镀金或极简画框、画廊式衬边与一幅核心画作" },
  "pillow":           { label: "抱枕",         description: "装饰抱枕,花纹枕套、滚边、蓬松填充与隐藏拉链" },
  "curtains":         { label: "窗帘",         description: "落地窗帘,厚重布料垂坠,顶部褶裥挂在金属杆上,两侧有束带" },
  "sculpture":        { label: "雕塑",         description: "底座上的抽象雕塑,流动的有机形态,青铜或大理石材质从多角度反光" },

  // -------------------- Bath --------------------
  "bathtub":     { label: "浴缸",         description: "独立式爪足浴缸,卷边、抛光白珐琅内壁与四只华丽铸铁脚" },
  "shower":      { label: "淋浴间",       description: "步入式淋浴间,无框玻璃隔断、瓷砖墙、雨淋花洒与线性地漏" },
  "toilet":      { label: "马桶",         description: "标准白色陶瓷马桶,椭圆便器、加长坐圈与带铬冲水把手的水箱" },
  "sink-vanity": { label: "洗手台",       description: "浴室洗手台,石材台面、台下盆、上方宽镜与下方镶板柜门" },
  "towel-rack":  { label: "毛巾架",       description: "壁挂式电热毛巾架,多根水平横杆与每杆上叠放的毛绒毛巾" },
}

export default map
