# 停用网页导入 Implementation Plan

**Goal:** 停用网页导入，保持命令行发布、播放和浏览器历史记录可用，更新 qqvps 站点。

**Architecture:** 移除 index.html 中的入口和对话框，删除 app.js 中专属导入处理。共享解析模块与存储格式不变。

**Tech Stack:** Vite、原生 JavaScript、Node test、Playwright、现有 SSH 发布脚本与 Nginx。

**Spec:** [设计说明](../specs/2026-10-03-disable-web-import-design.md)

## Task 1: 移除交互并验证发布

Files: index.html、src/app.js、tests/browser.spec.js、tests/aliyun-web.test.js、scripts/check-deployment.mjs、scripts/check-python-deployment.mjs、README.md、docs/word-list-import.md、docs/aliyun-audio.md。

保持共享 src/import.js、CLI、音频清单和快照字段不变，不增加依赖。

- [ ] 浏览器测试先断言 `await expect(page.locator('#import-open')).toHaveCount(0)`、导入对话框及文件输入不存在，观察旧实现失败。
- [ ] 删除 HTML 导入入口与对话框、app.js 导入处理及仅用于导入的引用；保留 useSource 的返回内置词表调用。
- [ ] 将旧导入场景改为 `defaultSnapshot(makeSource(...))` 加载历史快照，保留 HTML 安全、错词恢复和未覆盖项保护验证。
- [ ] 部署检查断言无导入控件；更新当前文档为命令行导入路径。
- [ ] 运行 `npm test`、`npm run test:browser -- --project=chromium-ipad`、`npm run build`、`npm run test:deploy`、`npm run test:deploy:python`、`npm run format:check`、`git diff --check`。
- [ ] 审查完整差异，执行 `npm run deploy`，用公网浏览器检查入口已移除、全部 161 项 Luna WAV 下载解码成功且实际播放正常。
