# 品牌素材目录

临东通品牌素材源文件放在本目录。

当前文件：

- `ldpass_icon_color.svg`：彩色版 Logo。
- `ldpass_icon.svg`：单色版 Logo。
- `ldpass_app_icon.svg`：PWA / 安装入口使用的应用图标。
- `ldpass_app_icon_dark.svg`：深色背景场景备用应用图标。
- `ldpass_background_01.svg`：广告图背景。

要求：

- 文件编码与文本说明使用 UTF-8 无 BOM。
- SVG 中不要包含外部脚本或远程资源引用。
- 前端使用 SVG 时按静态文件引用，不要把 SVG 文本直接注入 DOM。
- PWA / favicon 需要兼容 PNG 时，从 SVG 源文件导出到 `apps/web/public/brand`。
