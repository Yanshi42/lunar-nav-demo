# 月面航迹 LunarNav

基于 NASA LRO WAC 月面影像与 LOLA 全球高程数据制作的浏览器端月球表面导航 demo。

## 使用

直接用本地静态服务器打开 `dist/`。应用包含：

- 月球全景与三个典型区域选择；
- 真实高程着色、坡度风险和导航网格；
- 地图点击选点与 A* 坡度加权航迹规划；
- 二维 / 三维地形视图、高程剖面与航迹 JSON 导出。

数据来源：NASA Scientific Visualization Studio 的 CGI Moon Kit。该原型仅用于科研展示，不用于真实月面任务决策。
