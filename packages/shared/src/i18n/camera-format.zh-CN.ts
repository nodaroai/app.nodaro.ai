import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // Film stocks
  "35mm-film":        { label: "35mm 胶片",       description: "经典电影胶片颗粒" },
  "16mm-film":        { label: "16mm 胶片",       description: "独立 / 纪录片颗粒" },
  "super-8":          { label: "Super 8 胶片",    description: "复古 8mm 家庭电影质感" },
  "imax-70mm":        { label: "IMAX 70mm",       description: "大画幅的纯净清晰度" },
  "anamorphic-scope": { description: "2.39:1 宽屏电影感" },
  // Modern digital
  "arri-alexa":             { description: "顶级数字电影机" },
  "dslr":                   { label: "数码单反",   description: "锐利的视频单反质感" },
  "mirrorless-a7iii":       { description: "现代混合无反相机" },
  "canon-r5":               { description: "高分辨率时尚大片无反" },
  "hasselblad-medium-format":{ description: "中画幅大片相机" },
  "leica-m-rangefinder":    { description: "经典 35mm 旁轴相机" },
  "voigtlander":            { description: "精品旁轴相机的独特调性" },
  "fuji-xt4":               { description: "胶片调色感的富士色彩" },
  // Aerial / action
  "drone-aerial":           { label: "无人机(航拍)",  description: "云台稳定的高空航拍" },
  "gopro-action-cam":       { label: "GoPro 运动相机",  description: "鱼眼广角的运动相机" },
  // Lo-fi modern
  "webcam-facetime":        { label: "网络摄像头 / FaceTime", description: "低分辨率视频通话" },
  // Vintage / lo-fi
  "vhs":                    { label: "VHS 录像带",    description: "磁带失真加扫描线" },
  "camcorder":              { label: "家用摄像机",    description: "90 年代消费级视频" },
  "polaroid":               { label: "宝丽来",        description: "拍立得即时胶片色调" },
  "fuji-instax":            { description: "现代拍立得" },
  "disposable-camera":      { label: "一次性相机",    description: "90 / 2000 年代一次性胶片" },
  "toy-camera-holga":       { label: "玩具相机(Holga)", description: "Holga / Lomo 塑料镜头低保真" },
  "tintype-wet-plate":      { label: "锡版 / 湿版法",  description: "复古湿版火棉胶工艺" },
  "daguerreotype":          { label: "达盖尔银版",    description: "1840 年代银版照相工艺" },
  "security-cam":           { label: "监控摄像头(CCTV)", description: "鱼眼加时间戳的监控画面" },
  "bw-film":                { label: "黑白胶片",      description: "黑白胶片质感" },
  "iphone":                 { label: "iPhone",       description: "现代手机相机质感" },
}

export default map
