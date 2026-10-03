# 月面航迹 LunarNav

基于 NASA LRO WAC 月面影像与 LOLA 全球高程数据制作的浏览器端月球表面导航 demo。

在线体验：[月面航迹 · LunarNav](https://lunar-nav-terrain-demo.justinxu082.chatgpt.site/)

## 使用

在仓库根目录运行 `python -m http.server 4173 --directory dist`，然后打开 `http://localhost:4173/`。应用包含：

- 可任意方向拖拽的球体月球，表面采用六面球面近等面积方格网；
- 全球 1,944 个分片均可直接在球体上点击选取，也可输入经纬度；
- 基于 LRO WAC 影像、LOLA 高程的细粒度地形与坡度可视化；
- 点击“起点”“终点”“增加途经点”后直接在地图上选点；
- 有序途经点规划，以及 2–8 个无序目标点的最短访问顺序规划；
- 二维 / 三维地形视图、可调高程夸张系数、高程剖面与航迹 JSON 导出。

数据来源：[NASA Scientific Visualization Studio CGI Moon Kit](https://svs.gsfc.nasa.gov/4720/)。构建脚本 `tools/prepare_global.py` 将 LOLA 全球 64 px/° 高程图平均至 32 px/°，按纬度打包供浏览器按需读取。浏览器将真实数据重投影到每个 160 × 160 的球面方格地图；原始高程仍是经纬度格网，交互分片则采用每面 18 × 18 格的六面球面投影。各片接近等面积、不会在极区缩窄，但球面不可能由完全相同的正方形无缝铺满。三维视图以月球半径和分片实际水平尺度为基础，默认使用 4 倍高程夸张以保持地形可辨识。该原型仅用于科研展示，不用于真实月面任务决策。
