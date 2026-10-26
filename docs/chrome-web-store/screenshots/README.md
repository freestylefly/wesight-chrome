# Chrome 商店截图

截图来自 WeSight 发布助手 1.1.1 的真实生产构建，尺寸均为 1280 × 800，未添加装饰外框或合成界面。

- `01-article-preview.png`：本地 Markdown 与图片导入后的文章内容、封面和苍绿主题预览。
- `02-markdown-editor.png`：Markdown 正文编辑、文章信息及平台选择。
- `03-dynamic-preview.png`：统一文案编辑和实时动态效果预览。
- `04-platform-copy.png`：独立平台文案、素材顺序与对应预览。

图中文字和配图由捕获脚本创建，仅用于功能演示。浏览器保持未登录 WeSight、未与 Obsidian 配对状态；未伪造平台账号、会员信息或同步完成状态。捕获流程未触发同步和最终发布。

## 重新生成

先在仓库根目录完成 `pnpm run build:chrome`，再执行：

```bash
node docs/chrome-web-store/capture-screenshots.cjs
```

脚本使用 Playwright 加载本地生产扩展，在临时 Chromium 用户目录中通过真实文件控件导入内容、填写编辑器并保存草稿。完成后关闭浏览器并删除临时示例文件与用户目录。

可用 `WESIGHT_PLAYWRIGHT_PATH`、`WESIGHT_SHARP_PATH` 和 `WESIGHT_CHROMIUM_EXECUTABLE` 指定本机依赖和 Chromium 可执行文件。依赖优先使用环境变量指定的路径，其次查找当前项目安装的模块，最后自动查找当前用户的 Codex 本机运行时。浏览器优先使用 Playwright 的安装版本；缺失时扫描当前用户缓存中的 Chromium，也可用环境变量指定可执行文件。

## 验证范围

`verification.json` 记录构建版本、图片尺寸、页面错误、横向溢出及 IndexedDB 草稿持久化结果。本轮已验证 Markdown 与封面导入、文章保存、动态图片添加、预览、分平台编辑和本地保存；真实平台登录、图片上传与同步由后续验收单独验证。
