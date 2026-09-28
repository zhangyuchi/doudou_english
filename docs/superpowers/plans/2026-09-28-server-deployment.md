# 自有 Linux 服务器部署实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 维护者可发布、列出和回滚独立静态版本，并按中文指南运行服务器及在 iPad 导入词表。

**Architecture:** 本地 Node.js 入口验证 JSON 配置、调用现有构建并生成临时 tar.gz；通过一次 SSH 会话运行 Bash 发布程序。远端专用目录用 releases/current、应用标记及互斥锁管理，不绑定 Web 服务。

**Tech Stack:** Node.js 标准库、OpenSSH、tar/gzip、远端 Bash 与 GNU coreutils；不增加 npm 依赖。

**Spec:** docs/superpowers/specs/2026-09-28-server-deployment-design.md

## Global Constraints

- 电脑 Node.js >=22.13；Linux/macOS，Windows 使用 WSL。
- 远端 Linux、Bash、GNU coreutils（含 mv -T）、tar/gzip；Python 内网运行示例要求 Python 3.9+。
- 不执行真实生产发布，不安装服务，不使用 sudo，不关闭 SSH 主机密钥检查。
- dist 仍只由 Vite 构建；不改播放器、导入逻辑、浏览器保存格式。
- 专用目录拒绝宽泛根目录、路径穿越及 shell 元字符；非空未标记目录拒绝接管。
- 切换与回滚互斥；失败不改变 current；旧版本不自动删除。

## 文件边界

- scripts/deploy.mjs：本地 CLI、配置验证、归档与 SSH 子进程。
- scripts/deploy-remote.sh：远端目录验证、锁、解包与原子版本切换。
- scripts/check-python-deployment.mjs：localhost 上验证 Python 托管真实构建、PDF worker 与原子版本切换，不触及生产服务器。
- deploy.config.example.json：配置字段示例；deploy.config.json 被忽略。
- tests/deployment.test.js：配置、CLI 和真实远端程序的临时目录测试。
- tests/import.test.js：新增公开 TXT/CSV 样例的真实解析断言。
- public/examples/words.txt、words.csv：真实可导入示例。
- deploy/nginx.conf、deploy/Caddyfile：管理员手动使用的根路径配置示例。
- docs/deployment.md、docs/word-list-import.md、README.md：操作入口、部署及导入指南。
- package.json、.gitignore：CLI 命令和配置排除；其他文件仅格式/设计状态同步。

## Task 1：配置与无副作用的 CLI（CHG-DEP-1 / V-DEP-1）

**Interfaces:** export validateConfig(value) 返回已校验配置；export sshArgs(config, action, version, script) 返回 OpenSSH 参数数组；export parseArgs(argv) 返回 config/action/version/dryRun/help。入口 npm run deploy，配置默认 deploy.config.json。

- [x] 写 tests/deployment.test.js，先覆盖合法与非法路径、SSH host/user/port、拒绝未知字段、互斥动作及 help/dry-run。
- [x] 运行 `node --test tests/deployment.test.js`，预期因 scripts/deploy.mjs 不存在失败。
- [x] 实现参数验证、shell 单引号引用与 SSH 参数；dry-run 只读取配置并显示计划，禁止运行 npm、tar 或 ssh。
- [x] 用下面的断言验证参数，不添加 ssh 安全绕过选项：

```js
assert.equal(
  validateConfig({ host: "learning", remoteDir: "/srv/doudou-english" }).host,
  "learning",
);
assert.throws(() =>
  validateConfig({
    host: "-oProxyCommand=bad",
    remoteDir: "/srv/doudou-english",
  }),
);
assert.throws(() =>
  validateConfig({ host: "learning", remoteDir: "/var/www" }),
);
```

- [x] 同步 package.json deploy 命令、配置样例和 .gitignore；重复运行聚焦测试。

## Task 2：安全发布与回滚（CHG-DEP-2 / V-DEP-2/3）

**Interfaces:** Bash 程序参数为 action remoteDir version；deploy 从 stdin 读取 tar.gz，list 只读，rollback 不读取归档。本地入口构建后以归档文件作为 SSH stdin；任一子进程失败返回非零。

- [x] 用 mkdtemp 建立临时应用目录与真实 tar 归档；执行实际 Bash 程序，写首次/再次发布、list、rollback、损坏归档、锁、非法目录和符号链接负例。
- [x] 先运行测试并记录缺失脚本的失败；实现应用标记、真实目录检查、锁与 current 链接验证。
- [x] 实现 remoteDir/current 的同目录临时链接加 GNU `mv -T`，只在完整解包并验证 index.html 后切换；添加发布完成标记，避免回滚至半成品。
- [x] 实现本地 `npm run build` → `tar -czf` → `ssh`，临时归档放 mkdtemp，finally 只清理该目录，不写其他生成目录。
- [x] 增加可控 SSH 包装器测试：运行完整本地入口，实际构建、归档和远端程序在临时目录完成；注入构建/SSH 失败验证非零退出和 current 保留。
- [x] 运行 `node --test tests/deployment.test.js` 与 `bash -n scripts/deploy-remote.sh`，确认全部通过。

## Task 3：服务器与导入说明（CHG-DEP-3 / V-DEP-4）

**Interfaces:** README 链接两份中文指南；两份指南引用真实脚本命令、配置样例及 public/examples 词表。不改变网页 UI。

- [x] 创建 UTF-8 words.txt 与 words.csv，每份包含 hello、primary school、point out，共两组、三项；TXT 使用实际 Tab，CSV 使用 english,chinese,group 表头。
- [x] 在 tests/import.test.js 加读取并解析样例的断言：每份分组长度 `[2, 1]`，短语保持完整。
- [x] 写 docs/deployment.md：前置检查、专用目录授权、SSH、配置、dry-run/发布/list/回滚、Python 内网运行、Nginx/Caddy、HTTP 验证、缓存、锁与失败恢复。
- [x] 写 docs/word-list-import.md：iPad 选文件、PDF/TXT/CSV、真实 Tab、预览与分组、取消/确认、错词清空、返回内置、保存范围与排查。
- [x] 添加 deploy/nginx.conf 与 deploy/Caddyfile，仅配置静态 current；说明 .mjs application/javascript 与 .wasm application/wasm。
- [x] 验证 Python 从构建目录提供真实 PDF 导入，且 current 原子切换无需重启 Python；按官方文档核对 Nginx/Caddy 配置语义。
- [x] 更新 README 导航；格式化指定文件，运行 `npm test`、`npm run format:check`、`npm run build`、`npm run test:deploy` 和浏览器回归。
- [x] 审查完整变更和链接，更新设计/计划/验证记录；提交到功能分支并报告真实服务器、Web 服务配置及 iPad 未执行的验证边界。

## 实施方式

用户已批准实现，在当前会话按 executing-plans 内联执行。使用 feat/server-deployment 分支隔离；未安装 using-git-worktrees、finishing-a-development-branch 或独立评审技能，以分支、本地全量审查和精确验证记录替代，不声称独立评审。
