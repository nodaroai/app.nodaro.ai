import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // -------------------- Classic Cars --------------------
  "muscle-car":         { label: "肌肉车",           description: "凶悍的美式肌肉车,长引擎盖、宽阔站姿、双排镀铬排气与厚重低沉的 V8 气场" },
  "car-57-chevy":       { label: "1957 雪佛兰 Bel Air", description: "标志性的 1957 雪佛兰 Bel Air,带尾翼、镀铬保险杠、双色车漆与白边轮胎" },
  "hot-rod":            { label: "Hot Rod 改装车",   description: "削顶下沉的 Hot Rod,火焰涂装、外露镀铬引擎、宽后胎与窄前胎" },
  "vintage-roadster":   { label: "复古敞篷跑车",     description: "战前敞篷跑车,挡泥板优雅、踏板、辐条轮与抛光长引擎盖" },
  "model-t":            { label: "福特 Model T",     description: "20 世纪初的黑色 Model T,方正立式车身、铜质车头灯、辐条轮与手摇启动机" },
  "vw-beetle":          { label: "大众甲壳虫",       description: "粉彩色调的圆润大众甲壳虫,弧形引擎盖、风冷后置发动机与可爱的虫脸" },
  "checker-cab":        { label: "Checker 出租车",   description: "经典的纽约黄色 Checker 出租车,方正车身、黑白方格条带与车顶灯" },
  "woody-wagon":        { label: "Woody 旅行车",     description: "冲浪时代的旅行车,木饰侧门、镀铬保险杠与长尾门" },
  "lowrider":           { label: "低底盘改装车",     description: "糖果漆 Lowrider,液压悬挂、镀铬辐条轮、白边轮胎与喷绘壁画" },

  // -------------------- Everyday Cars --------------------
  "sedan":             { label: "三厢轿车",       description: "四门中型轿车,流线型轮廓、镀铬装饰与现代 LED 大灯" },
  "suv":               { label: "SUV",            description: "大型 SUV,高底盘、车顶导轨、大轮毂与肌肉感的方正车身" },
  "hatchback":         { label: "两厢掀背",       description: "紧凑型掀背车,短尾、上掀式后门、灵巧比例与亮丽涂装" },
  "minivan":           { label: "MPV / 商务车",   description: "家用 MPV,带电动侧滑门、宽敞高车顶、隐私后窗与宽大后舱" },
  "station-wagon":     { label: "旅行车",         description: "长车顶旅行车,加长后舱、后侧窗与家用风格轮廓" },
  "crossover":         { label: "跨界车",         description: "中型跨界 SUV,车身离地较高、轿车风格设计与流线 LED 装饰" },
  "electric-car":      { label: "电动车",         description: "时尚现代的电动车,无格栅平整车头、隐藏式门把手与流线干净的线条" },
  "hatchback-econobox":{ label: "经济型小车",     description: "小巧亲民的两门城市小车,短引擎盖、小轮与简洁紧凑造型" },

  // -------------------- Performance / Exotic --------------------
  "sports-car":        { label: "跑车",           description: "低趴的双门跑车,宽阔的攻击性站姿、空气动力学车身与亮丽光泽涂装" },
  "supercar":          { label: "超级跑车",       description: "中置发动机超级跑车,鸥翼门、超低引擎盖、巨大后进气口与碳纤维尾翼" },
  "convertible":       { label: "敞篷车",         description: "双座敞篷车,顶篷已收起,长引擎盖与从低剪边掠过的迎面风" },
  "grand-tourer":      { label: "GT 旅行跑车",    description: "优雅的 GT 双门跑车,长流畅的引擎盖、四出排气与豪华比例" },
  "roadster":          { label: "敞篷小跑车",     description: "紧凑的双座敞篷小跑车,环抱式挡风玻璃、收起的软顶与经典开顶剪影" },
  "racing-car":        { label: "赛车",           description: "开轮 F1 赛车,光头胎、巨大尾翼、Halo 座舱与布满赞助标识的侧箱" },
  "rally-car":         { label: "拉力赛车",       description: "溅满泥水的拉力掀背车,块状轮胎、巨大挡泥板、车顶射灯与赛车涂装" },
  "drift-car":         { label: "漂移车",         description: "改装漂移双门轿车,宽体套件、巨大尾翼、霓虹底灯与拖在身后的烟雾" },

  // -------------------- Motorcycles --------------------
  "sportbike":   { label: "公路赛车",         description: "空气动力学公路赛车,蜷缩骑行姿势、全包整流罩、抓地胎与亮丽赛车涂装" },
  "cruiser":     { label: "巡航摩托",         description: "低趴巡航摩托,水滴状油箱、向后扫的车把、镀铬排气与宽后胎" },
  "chopper":     { label: "Chopper 改装摩托", description: "拉伸定制 Chopper,大角度前叉、高扬手把、纤细前轮与镀铬一切" },
  "dirt-bike":   { label: "越野摩托",         description: "越野摩托,块状胎、高悬挂、亮色塑料导流罩与高把" },
  "scooter":     { label: "踏板车",           description: "穿越式踏板车,圆滑车壳、小轮、平踏板与座下储物凸起" },
  "moped":       { label: "助动车",           description: "脚蹬启动的小型助动车,简单钢架、车头小篮与座下小型汽油发动机" },
  "cafe-racer":  { label: "Cafe Racer 摩托",  description: "极简 Cafe Racer 摩托,握把分离、单座驼峰、外露车架与极简油箱" },

  // -------------------- Bicycles --------------------
  "road-bike":     { label: "公路自行车",     description: "轻量公路自行车,弯把、细高压胎与空气动力碳纤维车架" },
  "mountain-bike": { label: "山地车",         description: "粗犷的山地车,块状胎、前减震叉、平把与溅满泥的车架" },
  "bmx":           { label: "BMX 小轮车",     description: "特技 BMX 小轮车,小车架、车轴上的脚踏、粗胎与一字横拉手把" },
  "cruiser-bike":  { label: "海滩巡航单车",   description: "悠闲的海滩巡航单车,弧形车架、向后扫手把、宽座与气球胎" },
  "penny-farthing":{ label: "Penny Farthing 单车", description: "维多利亚时期的 Penny Farthing,巨大的前轮、小后轮与高高的皮革座垫" },
  "unicycle":      { label: "独轮车",         description: "单轮独轮车,高高的座管、轮毂上的简单脚踏与极简马戏感" },
  "skateboard":    { label: "滑板",           description: "木质滑板,顶面有防滑砂纸、四个聚氨酯轮与底面彩色图案" },
  "kick-scooter":  { label: "踏板车",         description: "两轮踏板车,高 T 型把手、窄站板与小型硬轮" },

  // -------------------- Trucks --------------------
  "pickup-truck":   { label: "皮卡",         description: "全尺寸皮卡,高大双排座驾驶舱、敞开车斗、镀铬格栅与凶悍越野胎" },
  "semi-truck":     { label: "重型卡车",     description: "长途重型卡车,带睡铺驾驶舱、高高的镀铬排气烟囱与挂在身后的巨大铰接挂车" },
  "dump-truck":     { label: "自卸卡车",     description: "重型自卸卡车,翻起的卸料斗、巨大越野胎与黄色工程涂装" },
  "tow-truck":      { label: "拖车",         description: "拖车,液压拖臂、吊钩与平板回收车斗,旋转琥珀色警示灯与醒目标识" },
  "delivery-van":   { label: "送货厢式车",   description: "白色送货厢式车,方正货舱、滑动侧门、车顶行李架与企业涂装" },
  "ice-cream-truck":{ label: "冰淇淋车",     description: "欢快的冰淇淋车,粉彩涂装、橱窗陈列、彩色贴纸与车顶上的甜筒装饰" },
  "food-truck":     { label: "餐车",         description: "造型感餐车,翻折式服务窗口、黑板菜单、串灯与亮丽定制车贴" },
  "box-truck":      { label: "厢式货车",     description: "中型厢式货车,普通长方形货箱、卷帘后门与前部驾驶室" },

  // -------------------- Transit --------------------
  "city-bus":         { label: "城市公交",       description: "现代铰接式城市公交,低底板、滑动门、车头线路牌与广告车贴" },
  "school-bus":       { label: "校车",           description: "经典的美式黄色校车,黑色饰条、闪烁的红色停车牌、伸出的停车臂与黑色车号" },
  "double-decker":    { label: "双层巴士",       description: "标志性的红色双层巴士,圆顶车顶、车内开放楼梯与车头滚动线路牌" },
  "coach-bus":        { label: "长途客车",       description: "长途客车,贴膜全景窗、底部行李舱与流线型车身" },
  "train":            { label: "火车",           description: "现代客运火车,流线型车头、全景窗与一列锃亮车厢" },
  "steam-locomotive": { label: "蒸汽机车",       description: "黑色蒸汽机车,高高的烟囱冒着蒸汽,锅炉、连杆与煤水车厢" },
  "bullet-train":     { label: "高速列车",       description: "高速子弹列车,空气动力的尖头、白蓝相间涂装与窄长窗户" },
  "subway":           { label: "地铁列车",       description: "不锈钢地铁车厢,防涂鸦面板、滑动门与车内整排日光灯" },
  "tram":             { label: "有轨电车",       description: "经典城市有轨电车,木框方形车身、车顶受电弓与下方铁轨" },
  "stagecoach":       { label: "西部驿马车",     description: "西部驿马车,木质车身、板簧悬挂、车顶行李架与车前一队套着挽具的马" },
  "horse-carriage":   { label: "马车",           description: "华丽的马车,抛光木板、大辐条轮与天鹅绒软包车厢" },

  // -------------------- Aircraft --------------------
  "airliner":        { label: "客机",           description: "宽体商用客机,后掠翼下的双发动机、椭圆窗户排列与高高的后掠尾翼" },
  "biplane":         { label: "双翼机",         description: "复古双翼机,两层机翼由支柱与拉线连接,开放座舱与木质螺旋桨" },
  "propeller-plane": { label: "螺旋桨飞机",     description: "单发螺旋桨小飞机,机头螺旋桨旋转、上单翼、固定起落架与气泡座舱" },
  "helicopter":      { label: "直升机",         description: "通用直升机,顶部大主旋翼、修长尾梁、下方滑橇与气泡座舱" },
  "seaplane":        { label: "水上飞机",       description: "水上飞机,双浮筒代替起落架、上单翼与螺旋桨,停在平静水面上" },
  "hot-air-balloon": { label: "热气球",         description: "巨大的热气球,彩色条纹外囊、向上喷火的火焰加热器与下方的藤编吊篮" },
  "blimp":           { label: "飞艇",           description: "香肠形飞艇,光滑银色外囊、小尾翼与悬挂吊舱" },
  "glider":          { label: "滑翔机",         description: "优雅的滑翔机,超长窄翼、无发动机与水滴形座舱" },
  "drone":           { label: "无人机",         description: "四旋翼相机无人机,四个旋翼、纤细悬臂、中央机身与下方云台相机" },

  // -------------------- Watercraft --------------------
  "yacht":        { label: "游艇",         description: "时尚豪华的机动游艇,多层甲板、贴膜窗、雷达桅杆与切开蓝色海水的光面白色船身" },
  "sailboat":     { label: "帆船",         description: "优雅的帆船,高耸桅杆、绷紧的白帆迎风与狭窄玻璃钢船身" },
  "speedboat":    { label: "快艇",         description: "快速动力艇,尖锐的深 V 船身、低矮挡风玻璃与轰鸣的舷外发动机" },
  "cruise-ship":  { label: "邮轮",         description: "巨大的邮轮,多层甲板高耸、成排阳台、明亮烟囱与尖锐船头" },
  "cargo-ship":   { label: "货船",         description: "巨大的集装箱货船,堆满彩虹色集装箱,船尾有驾驶塔" },
  "canoe":        { label: "独木舟",       description: "经典木质独木舟,首尾尖锐、雪松肋骨内饰与一支放在里面的桨" },
  "kayak":        { label: "皮划艇",       description: "细长的塑料皮划艇,低矮外形、封闭座舱开口与双桨叶的桨" },
  "rowboat":      { label: "划艇",         description: "小型木质划艇,平底木板、舷上桨架与两支木桨" },
  "jet-ski":      { label: "水上摩托",     description: "站立式水上摩托,激烈整流罩、车把、单座与喷射推进喷嘴" },
  "submarine":    { label: "潜艇",         description: "军用潜艇,长长的圆柱形船身、带潜望镜的指挥塔与从深水中潜行的鼓状船头" },
  "pirate-ship":  { label: "海盗船",       description: "木质海盗大帆船,高桅、方形船帆、船头雕像、舷侧大炮与破烂的黑旗" },

  // -------------------- Military --------------------
  "tank":                          { label: "坦克",         description: "重型主战坦克,长炮管、可旋转炮塔、厚倾斜装甲与宽阔履带" },
  "humvee":                        { label: "悍马",         description: "军用悍马,宽阔站姿、装甲方正车身、越野胎与车顶炮塔" },
  "armored-personnel-carrier":     { label: "装甲运兵车",   description: "履带式装甲运兵车,方正船体、后部坡道与小型炮塔" },
  "fighter-jet":                   { label: "战斗机",       description: "超音速战斗机,后掠三角翼、尖锐机头、双尾翼与翼下挂载的导弹" },
  "stealth-bomber":                { label: "隐形轰炸机",   description: "飞翼式隐形轰炸机,哑光黑色三角剪影、无尾翼与雷达吸波切面表面" },
  "destroyer":                     { label: "驱逐舰",       description: "光滑的海军驱逐舰,长长灰色船体、炮塔、导弹发射器与布满雷达的上层建筑" },
  "aircraft-carrier":              { label: "航空母舰",     description: "巨大的航空母舰,平顶飞行甲板、岛式塔楼带雷达与一排排停放的战机" },

  // -------------------- Construction --------------------
  "bulldozer":   { label: "推土机",       description: "黄色推土机,前部巨大推土铲、重型履带与高高的排气烟囱" },
  "excavator":   { label: "挖掘机",       description: "液压挖掘机,带关节的吊臂、齿状斗、可转驾驶室与重型履带底盘" },
  "crane-truck": { label: "起重车",       description: "移动式起重车,巨大伸缩臂向上伸展、稳定支腿与重型配重" },
  "cement-mixer":{ label: "水泥搅拌车",   description: "水泥搅拌车,大圆桶旋转、车后下料槽与方正驾驶室" },
  "forklift":    { label: "叉车",         description: "仓库叉车,前部双钢叉举起、驾驶员上方的防滚架与紧凑的后部配重" },
  "backhoe":     { label: "装载机挖掘机", description: "装载机挖掘机,前部铲斗用于装载、后部带关节臂上有齿状挖斗" },
  "tractor":     { label: "拖拉机",       description: "农用拖拉机,大型块状后胎、较小的前胎、车顶顶棚与车后牵引钩" },

  // -------------------- Sci-Fi --------------------
  "spaceship":      { label: "宇宙飞船",       description: "时尚的星际飞船,弧形机身、发光发动机喷口、天线阵列与指挥桥窗" },
  "starfighter":    { label: "星际战斗机",     description: "灵活的单座星际战斗机,后掠翼、翼尖激光炮、气泡座舱与发光推进器" },
  "hovercar":       { label: "悬浮车",         description: "未来悬浮车,无车轮悬浮于地面之上,底部发光推进器、无缝车身与弧形座舱罩" },
  "mech":           { label: "机甲",           description: "巨大的双足机甲机器人,装甲板、液压活塞、躯干内置驾驶舱与手臂上的重型武器" },
  "flying-saucer":  { label: "飞碟",           description: "经典的 UFO 飞碟,金属圆盘机身、边缘发光的舷窗与顶部的圆顶座舱" },
  "space-shuttle":  { label: "航天飞机",       description: "航天飞机轨道器,白色三角翼、黑色隔热瓦机腹与尾部巨大火箭喷管" },
  "rocket":         { label: "火箭",           description: "高耸的圆柱形火箭,尖锐头锥、尾翼、助推级与发射时引擎喷出的烈焰" },
  "hoverboard":     { label: "悬浮滑板",       description: "未来悬浮滑板,悬浮在地面之上几英寸,底部发光喷气与时尚的单板造型" },
}

export default map
