# 本地词表与阿里云音频一键发布 Implementation Plan

Implementation status: completed on 2026-10-01; test results are in `docs/verification.md`.

**Goal:** 本地命令读取 TXT、CSV、文字版 PDF，生成并保存英音；完成后刷新本地网站即可使用新词表。

**Architecture:** CLI 复用现有解析与音频生成，成功后原子发布带内容 ID 的词表；网页每次加载时读取同站音频和词表 JSON，并只应用尚未处理的新 ID。

**Tech Stack:** Node.js、PDF.js、Vite、Playwright、现有阿里云生成脚本。

**Spec:** `docs/superpowers/specs/2026-10-01-cli-wordlist-audio-design.md`

## Global Constraints

- Node.js 22.13+；TXT/CSV/PDF 与网页同样限制 20 MB、100 页、2000 项。
- 默认预览不得调用收费 API 或写文件；`--execute` 才生成并发布。
- `public/audio/aliyun` 私有、被 Git 忽略；凭证不得进入静态资源。
- `dist` 只由 Vite build 写入；远程发布须显式运行现有 deploy 命令。

---

### Task 1: CLI 输入与完整发布

**Files:** Create `scripts/import-aliyun-list.mjs` and `tests/import-aliyun-list.test.js`; modify `package.json`.

**Interfaces:** `readInputSource(path)` returns `{title,groups}`; `importAliyunList({inputPath,execute,...})` returns summary and atomically publishes `active-list.json` only after `generateAudio` succeeds.

- [x] Write focused TXT/CSV/PDF parsing tests, including project PDF's 11 groups and 161 items, invalid input, and 100-page/20-MB boundaries.
- [x] Observe the focused tests fail, then reuse `parseEditable`, `parseCsv`, `extractPdfGroups`, `regroup`, `makeSource` and `generateAudio`.
- [x] Test preview produces no files or API requests, partial synthesis leaves old list, complete synthesis publishes one covered list, and retry reuses audio.
- [x] Implement minimal CLI flags `--input`, `--voice`, `--speech-rate`, `--execute`; build `dist` only after a successful execute.
- [x] Allow omitted `--input` to repair the published list (built-in fallback only when absent), inherit voice settings, and preserve list identity.

### Task 2: Runtime source and voice loading

**Files:** Modify `src/app.js`, `src/storage.js`, `src/aliyun-audio.js`, `vite.config.js`; test in `tests/storage.test.js`, `tests/browser.spec.js`, `tests/aliyun-web.test.js`.

**Interfaces:** `validatePublishedSource(payload,manifest)` returns a valid source or throws; snapshot field `lastCliSourceId` is optional for old records and persisted for new ones.

- [x] Add failing browser tests: refresh sees published list and plays WAV; second refresh keeps mistakes; manual switch stays switched; newer source replaces it; invalid/incomplete JSON preserves prior state.
- [x] Remove build-time manifest injection, fetch private manifest with `cache: no-store`, and create Aliyun voice only when valid entries exist.
- [x] Fetch and validate the published source, apply a new ID only after full coverage, preserve damaged storage, select Aliyun voice, and save the marker with the snapshot.
- [x] Run focused browser and storage regression tests.

### Task 3: User flow and verification

**Files:** Modify `README.md`, `docs/aliyun-audio.md`, `docs/word-list-import.md` and this spec if implementation evidence changes it.

- [x] Document preview and execute commands, supported PDF boundaries, auto-refresh behavior for local dev and local static service, and explicit remote deploy boundary.
- [x] Run `npm test`, `npm run test:browser -- --project=chromium-ipad`, `npm run build`, `npm run test:deploy`, `npm run test:deploy:python`, `npm run format:check`, and `git diff --check`.
- [x] Review the full diff for secret exposure, stale assets, ownership, error paths, and compatibility; update spec outcome and report residual risks.
