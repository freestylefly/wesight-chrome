/** Capture real WeSight extension UI with generated sample content in an isolated profile.
 * Run from the repository root: node docs/chrome-web-store/capture-screenshots.cjs
 * Optional: WESIGHT_PLAYWRIGHT_PATH, WESIGHT_CHROMIUM_EXECUTABLE, WESIGHT_SHARP_PATH.
 */
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const os = require('node:os');
const path = require('node:path');
function loadDependency(name, environmentKey) {
  const explicit = process.env[environmentKey];
  if (explicit) {
    try { return require(require.resolve(explicit, { paths: [process.cwd(), __dirname] })); }
    catch (error) { throw new Error(`${environmentKey} 无法加载 ${name}: ${explicit}`, { cause: error }); }
  }
  try { return require(require.resolve(name, { paths: [process.cwd(), __dirname] })); }
  catch { /* Try the current user's bundled Codex runtimes next. */ }
  const runtimes = path.join(os.homedir(), '.cache/codex-runtimes');
  const entries = fsSync.existsSync(runtimes) ? fsSync.readdirSync(runtimes) : [];
  entries.sort((a, b) => {
    if (a === 'codex-primary-runtime') return -1;
    if (b === 'codex-primary-runtime') return 1;
    return fsSync.statSync(path.join(runtimes, b)).mtimeMs - fsSync.statSync(path.join(runtimes, a)).mtimeMs;
  });
  for (const entry of entries) {
    const modules = path.join(runtimes, entry, 'dependencies/node/node_modules');
    if (!fsSync.existsSync(path.join(modules, name))) continue;
    try { return require(require.resolve(name, { paths: [modules] })); }
    catch { /* A partial or incompatible runtime may be followed by a usable one. */ }
  }
  throw new Error(`找不到 ${name}。请安装 playwright 和 sharp，或用 ${environmentKey} 指定模块路径。`);
}
function isExecutable(file) {
  try { fsSync.accessSync(file, fsSync.constants.X_OK); return fsSync.statSync(file).isFile(); }
  catch { return false; }
}
function findChromium(chromium) {
  const explicit = process.env.WESIGHT_CHROMIUM_EXECUTABLE;
  if (explicit) {
    const provided = explicit.startsWith('~/') ? path.join(os.homedir(), explicit.slice(2)) : path.resolve(explicit);
    if (isExecutable(provided)) return provided;
    throw new Error(`WESIGHT_CHROMIUM_EXECUTABLE 指定的文件不可执行: ${provided}`);
  }
  const installed = chromium.executablePath();
  if (isExecutable(installed)) return installed;
  const roots = [
    process.env.PLAYWRIGHT_BROWSERS_PATH === '0' ? null : process.env.PLAYWRIGHT_BROWSERS_PATH,
    path.join(os.homedir(), 'Library/Caches/ms-playwright'),
    path.join(os.homedir(), '.cache/ms-playwright'),
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'ms-playwright') : null,
  ].filter(Boolean);
  const relativeExecutables = [
    'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
    'chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
    'chrome-mac/Chromium.app/Contents/MacOS/Chromium',
    'chrome-linux64/chrome', 'chrome-linux/chrome', 'chrome-win64/chrome.exe', 'chrome-win/chrome.exe',
  ];
  for (const root of new Set(roots)) {
    if (!fsSync.existsSync(root)) continue;
    const versions = fsSync.readdirSync(root).filter(entry => /^chromium-\d+$/.test(entry))
      .sort((a, b) => Number(b.slice('chromium-'.length)) - Number(a.slice('chromium-'.length)));
    for (const version of versions) {
      for (const relative of relativeExecutables) {
        const candidate = path.join(root, version, relative);
        if (isExecutable(candidate)) return candidate;
      }
    }
  }
  throw new Error('找不到 Chromium。请运行 npx playwright install chromium，或用 WESIGHT_CHROMIUM_EXECUTABLE 指定可执行文件。');
}
const { chromium } = loadDependency('playwright', 'WESIGHT_PLAYWRIGHT_PATH');
const sharp = loadDependency('sharp', 'WESIGHT_SHARP_PATH');
const repo = path.resolve(__dirname, '../..');
const output = path.join(__dirname, 'screenshots');
const executablePath = findChromium(chromium);
const markdown = `---
title: 从一条灵感开始，完成今天的创作
tags: [创作日常, 内容工作流]
---

# 从一条灵感开始，完成今天的创作

把灵感整理成清楚的内容，让每一次分享都有准备。

## 01 收集灵感

记下一个观察、一段阅读或一次真实体验。先保留细节，再梳理你最想传达的观点。

## 02 写成文章

用 Markdown 整理标题、正文和图片，在预览里检查阅读节奏。把最有价值的内容放在读者容易找到的位置。

![创作工作流](creative-workflow.png)

## 03 准备分享

为不同平台调整表达，检查标题、图片和话题。同步到编辑页后，逐个平台确认，再完成发布。

> 让创作有条理，让分享更从容。
`;
function graphic(label, detail, color) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800"><rect width="1200" height="800" rx="0" fill="${color}"/><circle cx="1060" cy="110" r="240" fill="#ffffff" opacity=".12"/><circle cx="90" cy="730" r="210" fill="#ffffff" opacity=".08"/><text x="86" y="136" font-family="Arial" font-size="30" font-weight="700" fill="#ffffff" opacity=".7">CREATOR NOTES / 01</text><text x="80" y="325" font-family="PingFang SC,sans-serif" font-size="88" font-weight="700" fill="#ffffff">${label}</text><text x="86" y="410" font-family="PingFang SC,sans-serif" font-size="34" fill="#ffffff" opacity=".85">${detail}</text><path d="M88 520H1112" stroke="#ffffff" stroke-opacity=".3"/><text x="86" y="625" font-family="PingFang SC,sans-serif" font-size="30" fill="#ffffff">收集灵感  →  整理表达  →  确认分享</text></svg>`;
}
(async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'wesight-store-capture-'));
  await fs.mkdir(output, { recursive: true });
  const mdPath = path.join(temp, '创作工作流示例.md');
  const coverPath = path.join(temp, 'creative-workflow.png');
  const notePath = path.join(temp, 'creative-notes.png');
  await fs.writeFile(mdPath, markdown);
  await sharp(Buffer.from(graphic('给灵感一个出口', '把创作整理好，再从容分享。', '#b85a3b'))).png().toFile(coverPath);
  await sharp(Buffer.from(graphic('保持创作的节奏', '记录 · 编辑 · 预览 · 分享', '#356454'))).png().toFile(notePath);
  const extension = path.join(repo, 'build/chrome-mv3-prod');
  const context = await chromium.launchPersistentContext(path.join(temp, 'profile'), {
    executablePath, headless: true,
    viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--no-first-run'],
  });
  const errors = [];
  try {
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const id = new URL(worker.url()).host;
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`chrome-extension://${id}/tabs/publish.html`);
    console.log('Extension publish center loaded');
    await page.getByRole('button', { name: '文章', exact: true }).click();
    await page.locator('.import-card input[type=file]').setInputFiles([mdPath, coverPath]);
    await page.getByText('已导入本地 Markdown', { exact: true }).waitFor();
    console.log('Markdown and image imported');
    await page.waitForFunction(() => !document.querySelector('.platform-tools button')?.disabled, null, { timeout: 60000 });
    await page.getByPlaceholder('一两句话介绍文章').fill('把灵感整理成文章，再为不同平台准备合适的表达。所有示例内容均用于功能演示。');
    await page.locator('.platform-main').first().click();
    await page.getByRole('button', { name: /保存草稿|草稿已保存/ }).click();
    await page.locator('.content-card').scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollTo(0, document.querySelector('.content-card').offsetTop - 80));
    await page.screenshot({ path: path.join(output, '01-article-preview.png'), animations: 'disabled' });
    await page.getByRole('button', { name: 'Markdown', exact: true }).click();
    await page.screenshot({ path: path.join(output, '02-markdown-editor.png'), animations: 'disabled' });
    console.log('Article screenshots captured');
    await page.getByRole('button', { name: '动态', exact: true }).click();
    await page.evaluate(() => window.scrollTo(0, 0));
    if (!await page.getByRole('textbox', { name: '动态标题', exact: true }).isVisible()) await page.locator('.dc-add-title').click();
    await page.getByRole('textbox', { name: '动态标题', exact: true }).fill('给灵感一个出口');
    await page.getByRole('textbox', { name: '动态正文', exact: true }).fill('今天把零散的灵感整理成了一篇文章，也为不同平台准备了各自的表达。\n\n我的创作小习惯：\n• 随手记录具体的观察\n• 先写完整，再慢慢精简\n• 检查图片与标题，确认后再发布\n\n你有什么一直在坚持的创作习惯？');
    await page.locator('.dc-media-zone input[type=file][accept^="image"]').setInputFiles([coverPath, notePath]);
    await page.locator('.dc-image-item').nth(1).waitFor();
    await page.getByRole('button', { name: '效果预览', exact: true }).click();
    await page.locator('.dc-platform-account').first().click();
    await page.getByRole('button', { name: /保存草稿|草稿已保存/ }).click();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: path.join(output, '03-dynamic-preview.png'), animations: 'disabled' });
    await page.getByRole('button', { name: '分平台编辑', exact: true }).click();
    await page.getByRole('tab', { name: '微博', exact: true }).first().click();
    await page.getByRole('textbox', { name: '动态正文', exact: true }).fill('记录今天的创作小进展：把灵感写成文章，为每个平台整理好文案和配图，再到编辑页逐一检查。\n\n保持一点节奏，让表达慢慢生长。');
    await page.locator('.dc-save-status').filter({ hasText: '草稿已保存在本地' }).waitFor();
    await page.locator('.dc-intro h1').click();
    await page.evaluate(() => window.scrollTo(0, document.querySelector('.dc-workspace').offsetTop - 80));
    await page.screenshot({ path: path.join(output, '04-platform-copy.png'), animations: 'disabled' });
    const report = {
      extensionVersion: JSON.parse(await fs.readFile(path.join(extension, 'manifest.json'), 'utf8')).version,
      viewport: { width: 1280, height: 800 },
      screenshots: ['01-article-preview.png', '02-markdown-editor.png', '03-dynamic-preview.png', '04-platform-copy.png'],
      screenshotDimensions: {},
      signedIn: false, syncStarted: false, pageErrors: errors,
      horizontalOverflow: await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      articleDraftPersisted: await page.evaluate(async () => {
        const result = await new Promise((resolve, reject) => {
          const request = indexedDB.open('wesight-publish');
          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            const db = request.result;
            const query = db.transaction('drafts').objectStore('drafts').getAll();
            query.onsuccess = () => { resolve(query.result.map(row => ({ key: row.key, title: row.draft.title, mediaCount: (row.draft.assets || row.draft.media || []).length }))); db.close(); };
          };
        });
        return result;
      }),
    };
    for (const name of report.screenshots) {
      const info = await sharp(path.join(output, name)).metadata();
      report.screenshotDimensions[name] = { width: info.width, height: info.height };
      if (info.width !== 1280 || info.height !== 800) throw new Error(`Unexpected image size: ${name}`);
    }
    await fs.writeFile(path.join(output, 'verification.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await context.close();
    await fs.rm(temp, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
