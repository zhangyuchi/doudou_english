# 精品英音实现计划

采用本会话顺序执行；用户已授权实施前文说明的精品接入方案。

**Goal:** 精品英音访问、下载、自动词表导入及待填写本地凭证。
**Architecture:** 复用生成器与导入器，按品质分目录，网页独立加载两种驱动。
**Tech Stack:** Node >=22.13、原生 fetch、Vite、已有 PDF.js、Playwright；不加依赖。
**Spec:** `docs/superpowers/specs/2026-10-01-premium-audio-design.md`。

## 全局约束

- 只支持 qwen-audio-3.1-tts-flash 的四种英音，WAV/24000Hz，rate 0.5—2。
- 标准清单v1与原文件保持兼容，精品写入aliyun/premium清单v2。
- API Key只在本地，env仅追加，默认预览，execute才请求。
- 根active-list与import锁唯一，共享WAV校验和生成锁，失败不发布。

## Task 1：精品生成及清单

- [x] 在 `tests/aliyun-audio.test.js` 加入精品两步协议、URL隔离、Token用量、预览/复用/坏响应/配置不匹配测试；先观察失败。
- [x] `src/aliyun-audio.js` 导出premiumModel/premiumVoices，验证版本2配置并复用条目验证；`makeAliyunVoice`提供独立URI。
- [x] `scripts/generate-aliyun-audio.mjs`增加品质配置、传输分支、全配置文件哈希、独立目录和usage，不改标准默认。
- [x] 运行聚焦测试，检查所有输出没有模拟key或URL签名。

## Task 2：导入及本地配置

- [x] 在 `tests/import-aliyun-list.test.js` 增加精品无输入、TXT/CSV/PDF路由、配置继承、同源ID保持、根锁和失败保留测试。
- [x] `importAliyunList({quality,rate,...})`选择音频子目录，共用source与根锁；标准回退不变；发布audioQuality。
- [x] 两CLI添加quality/rate帮助与参数互斥；`.env.example`增加两字段，在忽略的`.env.local`只追加缺失键并验证不修改已有内容。
- [x] 无凭证运行精品预览，确认无付费请求。

## Task 3：网页兼容与验证

- [x] storage支持可选lastCliAudioQuality；页面独立加载清单，按所选品质路由声音，更新发布品质保留同源错词。
- [x] 浏览器回归测试使用标准/精品两份有效WAV覆盖切换、播放、刷新和损坏清单隔离；扩展部署可选404仅精品manifest。
- [x] 更新README、阿里云指南与验证记录，给出需填写字段和实际可运行命令。
- [x] 运行npm test、Chromium回归、build、format及diff检查；本地审查新增边界，记录真实精品API未验证。
