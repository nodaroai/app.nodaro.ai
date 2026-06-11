import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  "ultra-wide-14mm":       { label: "超广角(14mm)",      description: "极广视角,夸张透视" },
  "wide-24mm":             { label: "广角(24mm)",        description: "宽视野,带环境感" },
  "standard-35mm":         { label: "标准(35mm)",        description: "自然透视,纪实感" },
  "normal-50mm":           { label: "标头(50mm)",        description: "最接近人眼的视感" },
  "portrait-85mm":         { label: "人像(85mm)",        description: "压缩讨喜,奶油散景" },
  "telephoto-135mm":       { label: "长焦(135mm)",       description: "压缩景深,主体被分离" },
  "super-telephoto-400mm": { label: "超长焦(400mm)",     description: "极致压缩,主体被前推" },
  "fisheye":               { label: "鱼眼镜头",          description: "180° 半球状畸变" },
  "anamorphic":             { description: "电影感宽屏,椭圆散景" },
  "macro":                 { label: "微距镜头",          description: "对小细节的极近特写" },
  "tilt-shift":            { label: "移轴镜头",          description: "选择性对焦,微缩模型效果" },
  "shallow-dof":           { label: "浅景深",            description: "极薄焦面,梦幻散景" },
  "canon-k35":             { description: "复古电影感,温暖柔美的肤色" },
  "cooke-s4":              { description: "Cooke 之味——奶油般绘画感的肤色" },
  "helios-44":             { description: "复古苏联旋焦散景" },
  "petzval":               { description: "极致复古旋焦,戏剧性边缘衰减" },
  "probe": { label: "探针镜头", description: "管状微距——穿过孔洞与狭窄空间" },
  "cctv": { label: "监控镜头", description: "监控摄像画面质感" },
}

export default map
