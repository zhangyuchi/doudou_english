# iPad 录音播放修复计划

采用本会话顺序执行；用户反馈已有实现的兼容问题，授权修复。按 writing-plans 建立计划，以 minimal-code-change 实现并通过 code-quality-gate 本地复核，不自动提交或推送。

**Goal:** 预置和阿里云录音在支持Audio Session的iPad浏览器上请求媒体播放路由。
**Architecture:** 修改共用BundledAudio.unlock，在AudioContext创建/resume前设置可选会话类型；保留播放器生命周期。
**Tech Stack:** 原生JavaScript、Web Audio、可选Audio Session、Node测试及已有Playwright。
**Spec:** `docs/superpowers/specs/2026-10-01-ipad-recorded-playback-design.md`。

## 约束

- 不新增依赖、不调用合成、不改音频或持久化数据。
- Node >=22.13，API缺失保持原行为；设置仍在手势同步阶段。
- 配置失败沿用onerror，不伪造onend；取消和缓存保持原实现。

## Task 1：媒体会话兼容

文件：`src/audio.js`、`tests/audio.test.js`、`docs/verification.md`及本设计/计划。
接口：`unlock()`返回context.resume的Promise；`play(item,{onend,onerror})`保持原契约。

- [x] 添加测试，临时mock navigator.audioSession为ambient；context创建与resume只在type为playback时允许，先观察原实现失败。验证真实source结束前onend不调用，缓存再次播放仍成功。另验证设置失败进入onerror、无context创建。
- [x] 在unlock里使用 `const session = globalThis.navigator?.audioSession; if (session) session.type = "playback";`，放在现有context创建前，并更新该关键边界的契约注释。
- [x] 运行两个media session聚焦测试，先失败后通过。完整测试调用被中断，未读取结果；用户随后确认真机恢复，不为未修改的播放器重跑完整回归。
- [x] 新增并通过Chromium浏览器回归，覆盖预置/阿里云两驱动的会话配置、真实WAV结束及未点击时不修改会话。WebKit最初缺库，临时补齐依赖后双浏览器命令被用户中断，未声称通过；用户确认实际iPad已恢复有声。
- [x] 运行构建、格式及空白检查，更新记录和状态。真机已确认成功，无需再重复161项解码或调用合成服务。
