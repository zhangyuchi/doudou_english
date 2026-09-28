# iPad 英语听写 Implementation Plan

> **For agentic workers:** 使用 executing-plans 在本会话逐项实现。用户已经确认功能与英音方案，独立项目无 Git 仓库，不创建 worktree 或提交；保持原 PDF。

**Goal:** 实现可独立部署、适配 iPad 的英音纸上听写网页，支持 PDF 词表导入和可调节奏。

**Architecture:** Vanilla JavaScript 管理页面，独立播放器拥有语音与计时器，PDF.js 在浏览器解析文字版 PDF。本地快照存储设置、当前词源和错词；Vite 打包所有运行资源到 dist。

**Tech Stack:** HTML、CSS、JavaScript ES modules、Vite、PDF.js、Node test runner、Playwright。

**Spec:** ../specs/2026-09-28-ipad-dictation-design.md；../../design-contracts.md。

## Global Constraints

- iPad Safari，纸上作答，独立 ipad-dictation 项目。
- 默认朗读1次，可选1、2、3次；默认间隔10秒，快捷5、8、10、15秒，自定义1—60整数。
- 明确选 en-GB，不回退美音；不使用原 PDF 音频。
- 保留内置11组161项，支持当前文字版中英词表PDF导入、预览修正与确认。
- 复习、听写、答案核对、错词记录/听写、设置记忆；不实现离线或OCR。

## Task 1 — 词源、解析与依赖

Files: package.json、src/words.js、src/import.js、tests/import.test.js、public/examples、scripts/prepare-assets.mjs。
接口：extractPdfGroups(pages) 接受 PDF.js 坐标文字页；parseEditable(text) 接受英文 TAB 中文/空行分组；parseFile(file) 返回 groups；builtinSource 含11组161项。

- [x] 编写真实 PDF 测试，导入断言：`assert.deepEqual(groups.map(g=>g.items.length),[10,15,15,15,15,15,15,15,15,15,16])`；音频页无词表时抛明确错误。运行 `node --test tests/import.test.js` 确认未实现时失败。
- [x] 实现 PDF 坐标按 y 降序、x 升序聚合行；行中英文连续短语与后续中文组成项，异常/标题跳过；按大于典型行距1.45倍的垂直间隔切组。保留跨页边界。TXT/CSV共用预览验证。
- [x] `npm install`，准备本地PDF字体/worker资源，复制真实词表样本；运行对应测试并核对计数。

## Task 2 — 语音状态与本地快照

Files: src/player.js、src/storage.js、tests/player.test.js、tests/storage.test.js。
接口：DictationPlayer({synth,createUtterance,timers,onChange})；setQueue(items)、configure({repeat,interval,voice})、start/pause/resume/replay/move/stop；state 包含阶段、index、remaining、error。loadSnapshot/saveSnapshot 验证版本1快照。

- [x] 用假语音记录 speak 次数与 end，假时钟逐步推进；断言 end 前不启动倒计时、重复1/2/3、最后一项完整间隔、旧end取消无效、暂停等待不前进和错误不跳项。运行 `node --test tests/player.test.js` 观察失败。
- [x] 实现 generation 取消边界，单 utterance/单 timer 所有权，剩余等待冻结，后台重读当前遍，错误显式显示。
- [x] 写完整快照验证和可见保存错误，测试损坏、未知版本、超范围、配额和重复英文独立标识。运行 `npm test`。

## Task 3 — iPad页面与导入预览

Files: index.html、src/app.js、src/style.css、tests/browser.spec.js、playwright.config.js。
接口：页面消费 builtinSource、parseFile、DictationPlayer、storage；声音列表限定 en-GB。

- [x] 实现分组卡片、练习页复习/听写/核对、声音选择试听、控制按钮、设置、错词视图和可编辑导入预览。使用 textContent 展示用户文件内容。
- [x] browser 测试注入英音与美音，确认只列英音；设置默认值、导入真实PDF、取消不覆盖、确认切源、错词刷新恢复；无英音时禁用发音。
- [x] 运行 `npm run test:browser`，检查 iPad横竖屏截图和页面溢出；修复证据支持的错误。

## Task 4 — 独立部署与交付审查

Files: vite.config.js、README.md、docs/verification.md。

- [x] `npm run build` 生成相对路径 dist，启动 preview，从子路径和静态服务器验证所有 PDF 资源加载。
- [x] README 给出 `npm ci`、`npm run dev -- --host 0.0.0.0`、iPad访问和 `npm run build` 后部署 dist 的实际命令。
- [x] 运行 `npm test`、`npm run test:browser`、`npm run build`；完整审查取消、导入、保存、英音和文档，记录实际结果及真机未验证限制。
