# 服务器部署脚本验证记录

日期：2026-09-28。Task Mode: design-build；代码质量采用 Implementation mode，交付前按 Completion mode 审查整个变更集。范围仅为部署脚本、配置示例、公开词表样例、中文操作文档及测试，原听写行为未改动。设计已由用户确认，见[部署设计](superpowers/specs/2026-09-28-server-deployment-design.md)。

## 实际验证

| 命令                                                                                           | 结果                   | 范围                                                                                 |
| ---------------------------------------------------------------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------ |
| `npm test`                                                                                     | 30 项通过              | 部署 11 项、导入 5 项、播放器 10 项、存储 4 项                                       |
| `node --test --test-name-pattern='failed link creation' tests/deployment.test.js`              | 修复前失败，修复后通过 | ln 跟随目录链接的边界重现；拒绝临时路径冲突、保留 current 与原路径、不向外部目录写入 |
| `bash -n scripts/deploy-remote.sh`                                                             | 通过                   | Bash 语法；不是完整 shell 静态安全审计                                               |
| `node --check scripts/deploy.mjs`、`node --check scripts/check-python-deployment.mjs`          | 通过                   | Node 语法                                                                            |
| `npm run deploy -- --help`                                                                     | 成功                   | 帮助与文档入口一致，无服务器连接                                                     |
| `npm run deploy -- --config deploy.config.example.json --dry-run`                              | 成功                   | 配置样例与无副作用计划，不连接样例域名                                               |
| `npm run build`                                                                                | 成功                   | 静态 dist，含新增 TXT/CSV 样例                                                       |
| `npm run test:deploy`                                                                          | 成功                   | 构建产物在 /practice/ 子路径加载真实 PDF、worker 与资源，无 404/pageerror            |
| `npm run test:deploy:python`                                                                   | 成功                   | Python 3.14.4 内置 HTTP 服务，真实 PDF/worker 导入与 current 原子切换，无需重启      |
| `IPAD_WEBKIT_EXECUTABLE=/tmp/ipad-dictation-webkit-libs/launch-webkit.sh npm run test:browser` | 10 项通过              | Chromium 5 项、桌面 WebKit 5 项；语音受控模拟，不能证明实体 iPad 音质                |
| `npm run format:check`、`git diff --check`                                                     | 通过                   | 项目定义格式与空白检查，配置 JSON 已加入格式门禁                                     |
| Markdown 本地链接检查                                                                          | 通过                   | README、部署/导入指南、设计/计划与验证记录的本地目标存在                             |

新增部署测试执行真实 tar、真实 Bash 与 Linux 文件系统，不是只断言命令字符串；覆盖首次/再次发布、版本列出和回滚、缺失 index、损坏/截断归档、版本重复、锁、非法路径与目录/链接替换、本地构建产物链接拒绝、临时链接冲突、构建/SSH 失败和本地临时归档清理。完整本地 CLI 流程使用可控 SSH 替身在临时目录执行，不建立网络 SSH 连接。

首次执行部署测试时因缺少脚本出现预期失败，再实现对应脚本。复核时独立临时链接冲突测试重现 ln 默认跟随目录链接的问题，改用 ln -sT 后通过。早期测试曾遗留一个 /tmp/new 链接，已核验为该测试产生后 unlink；当前用例只访问自建临时目录，不依赖该全局路径。

## 限制与警告

- 没有用户服务器地址/凭据，也未执行生产发布：SSH 认证、服务器权限、发行版工具、域名、TLS、防火墙及真实 HTTP 可达性需维护者按指南验证。
- 本机未安装 Nginx、Caddy、shellcheck，未实际执行 nginx -t、caddy validate 或 shellcheck。配置按官方文档核对，仅作为管理员可调整的示例，启用前须在服务器验证；不声称两个服务的兼容性测试通过。
- WebKit 使用此前准备的临时依赖启动器；其他机器应安装自身 Playwright 运行依赖。未安装独立评审技能或独立评审者，完成的是本地完整变更审查，不声称独立代码评审。
- 浏览器测试观察到 NO_COLOR 与 FORCE_COLOR 冲突警告，未影响断言；环境变量来源未核实。工具测试通过不等于不存在未来漏洞。
- 根目录/current 的原子切换保护发布文件，不迁移或备份浏览器 localStorage，不保证旧页面的惰性资源请求不会遇到版本不匹配。
- 远端发布互斥；同一电脑项目目录的 build/deploy/npm test 必须串行。进程被强制杀死可能留下空锁或失败版本，文档提供人工恢复，不自动清理历史版本。

## 完成映射

DC-DEP-1 → CHG-DEP-1 → V-DEP-1：配置、参数引用、帮助与 dry-run；DC-DEP-2/3 → CHG-DEP-2 → V-DEP-2/3：真实发布/回滚/失败与锁测试；DC-DEP-4 → CHG-DEP-3 → V-DEP-4：真实词表样例、Python 运行验证、原有回归与文档链接。

ISSUE-DEP-1 已解决，无 open issue/block；完成范围为脚本、说明和本地验证，不包含实际服务器上线。后续代码或命令改变时需重新运行相应检查并更新此记录。
