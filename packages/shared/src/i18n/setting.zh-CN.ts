import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // -------------------- Indoor --------------------
  "coffee-shop":  { label: "咖啡馆",         description: "舒适的咖啡馆室内" },
  "library":      { label: "图书馆",         description: "高书架的宏伟图书馆" },
  "office":       { label: "现代办公室",     description: "明亮通透的玻璃办公室" },
  "home-office":  { label: "家庭办公区",     description: "舒适的居家工作空间" },
  "bedroom":      { label: "卧室",           description: "亲密私人的卧室" },
  "living-room":  { label: "客厅",           description: "舒适的家用客厅" },
  "kitchen":      { label: "厨房",           description: "晨光中温馨的家庭厨房" },
  "hotel-room":   { label: "酒店客房",       description: "可远眺城市的优雅酒店客房" },
  "restaurant":   { label: "餐厅",           description: "亲密的烛光餐厅" },
  "nightclub":    { label: "夜店",           description: "带激光与烟雾的黑暗夜店" },
  "gym":          { label: "健身房",         description: "现代健身房" },
  "classroom":    { label: "教室",           description: "明亮的学校教室" },
  "hospital":     { label: "医院",           description: "无菌感的医院走廊" },
  "laboratory":   { label: "实验室",         description: "带发光设备的研究实验室" },
  "courtroom":    { label: "法庭",           description: "木质包覆的法庭" },
  "warehouse":    { label: "工业仓库",       description: "带天窗的高大仓库" },
  "subway-car":   { label: "地铁车厢",       description: "行驶中的地铁车厢内" },
  "taxi":         { label: "出租车内",       description: "夜晚城市出租车的后座" },
  "cathedral":    { label: "大教堂",         description: "哥特式大教堂内部" },
  "art-gallery":  { label: "艺术画廊",       description: "极简的白盒艺术画廊" },

  // -------------------- Urban --------------------
  "city-street":   { label: "城市街道",     description: "繁忙的城市街道" },
  "rooftop":       { label: "楼顶",         description: "可俯瞰天际线的楼顶平台" },
  "back-alley":    { label: "后巷",         description: "粗砺狭窄的后巷" },
  "neon-alley":    { label: "霓虹小巷",     description: "雨水浸透的霓虹小巷" },
  "park":          { label: "城市公园",     description: "带步道的绿意城市公园" },
  "backyard":      { label: "后院露台",     description: "带串灯的木地板露台" },
  "highway":       { label: "开阔高速路",   description: "通向地平线的开阔高速路" },
  "bridge":        { label: "悬索桥",       description: "跨越水面的长悬索桥" },
  "train-station": { label: "火车站",       description: "停着列车的站台" },
  "airport":       { label: "机场航站楼",   description: "带弧形玻璃的宽阔航站楼" },
  "parking-lot":   { label: "停车场",       description: "傍晚的郊区停车场" },
  "penthouse":     { label: "顶层公寓",     description: "可俯瞰天际线的奢华顶层公寓" },
  "gas-station":   { label: "加油站",       description: "夜晚孤独的高速路加油站" },

  // -------------------- Nature --------------------
  "forest":        { label: "森林空地",     description: "阳光下的青苔空地" },
  "beach":         { label: "海滩",         description: "带浪花的辽阔沙滩" },
  "mountain-peak": { label: "山顶",         description: "岩石密布的高山顶峰" },
  "desert":        { label: "沙漠沙丘",     description: "风吹起伏的沙漠沙丘" },
  "jungle":        { label: "丛林",         description: "潮湿密布的丛林深处" },
  "grassland":     { label: "草原",         description: "开阔风吹的草原" },
  "snowy-tundra":  { label: "雪原冻土",     description: "风雕的冻土雪原" },
  "lake-shore":    { label: "湖岸",         description: "宁静的山间湖岸线" },
  "riverbank":     { label: "河岸",         description: "带柳树的蜿蜒河岸" },
  "waterfall":     { label: "瀑布",         description: "瀑布从苔藓崖壁倾泻而下" },
  "cave":          { label: "洞穴",         description: "带阳光透射的岩石洞穴" },
  "western-canyon":{ label: "西部峡谷",     description: "蜿蜒河流穿过的红岩台地" },

  // -------------------- Fantastical --------------------
  "alien-planet":      { label: "外星行星",         description: "带双月的异星地貌" },
  "spaceship-interior":{ label: "飞船内部",         description: "光滑的星舰走廊" },
  "underwater":        { label: "水下",             description: "阳光下的深海场景" },
  "fantasy-castle":    { label: "奇幻城堡",         description: "庞大的城堡庭院" },
  "medieval-village":  { label: "中世纪村庄",       description: "鹅卵石村庄广场" },
  "ancient-ruins":     { label: "古代遗迹",         description: "藤蔓缠绕的石质遗迹" },
  "cyberpunk-city":    { label: "赛博朋克城市",     description: "无尽延展的霓虹大都会天际线" },
  "haunted-mansion":   { label: "鬼屋",             description: "腐朽的哥特庄园" },
  "dreamscape":        { label: "梦境",             description: "超现实的漂浮岛屿" },
  "wasteland":         { label: "末日废土",         description: "锈迹斑斑的阴沉废土" },
}

export default map
