# 部署到自己的 Linux 服务器

部署脚本负责在电脑构建网页、通过 SSH 上传、切换版本和回滚，不要求 Nginx。服务器可以用 Python 内置 HTTP 服务试用，也可以使用已有的 Nginx、Caddy 或其他静态文件服务。

本文命令假设你已进入项目根目录。先配置自己的服务器，脚本不会安装软件、修改 Web 服务、防火墙、域名或证书，也不会自动删除历史版本。

## 1. 准备电脑与服务器

电脑：Linux/macOS，Node.js 22.13+、npm、OpenSSH 客户端和 tar/gzip。Windows 使用 WSL。服务器：Linux，Bash、GNU coreutils（包括 realpath、mv -T）、tar/gzip。服务器不需要 Node.js。

电脑首次安装项目依赖：

```bash
npm ci
npm run deploy -- --help
```

使用能写应用目录的普通 SSH 用户，推荐密钥认证。先手动 SSH 登录，核对主机指纹并确认工具可用。以下示例的用户 deploy、服务器地址和端口均需改成你的实际值：

```bash
ssh -p 22 deploy@your-server.example.com
command -v bash tar gzip realpath mv
mv --version
exit
```

脚本使用 BatchMode：不弹出密码或密钥口令提示。带口令的密钥先加入 ssh-agent；可用 ~/.ssh/config 设置 Host 别名、IdentityFile 和 ProxyJump。不要关闭主机密钥检查。首次连接时出现的真实指纹应通过可信渠道核对。

### 创建应用专用目录

选择例如 /srv/doudou-english 的专用目录，不要复用已有站点目录。首次发布只接管空目录；之后通过管理标记校验，不接管非空未标记目录。不接受 /、/srv、/var/www、用户家目录本身、尾斜杠、空格或符号链接路径。

若 SSH 用户无法在 /srv 创建目录，由服务器管理员执行以下一次性准备。确认这里的 deploy 是实际发布用户名；只为这个目录授权，不递归修改其他目录：

```bash
sudo install -d -m 0755 -o deploy -g deploy /srv/doudou-english
```

也可以选择 SSH 用户已有写权限的应用专用子目录。Web 服务用户须能读取文件并遍历所有父目录；位于家目录内可能需要额外授权，因此优先使用 /srv。

## 2. 配置发布目标

复制样例，并编辑 deploy.config.json：

```bash
cp deploy.config.example.json deploy.config.json
```

```json
{
  "host": "your-server.example.com",
  "user": "deploy",
  "port": 22,
  "remoteDir": "/srv/doudou-english"
}
```

- host：主机名、IPv4 地址或 ~/.ssh/config 的 Host 别名；不填写 user@host。不直接支持 IPv6 字面地址，可使用 SSH Host 别名连接 IPv6。
- user、port：可省略，使用 SSH 配置中的值；指定 port 时必须是 1—65535 整数。
- remoteDir：应用专用绝对路径，只使用字母、数字、下划线、连字符、段内点号和斜杠，不能有 . 或 .. 路径段。

deploy.config.json 和 deploy.config.local\*.json 已被 Git 忽略。配置无需密码或 API 密钥；私钥保持在 SSH 配置管理的位置，不放进项目。其他自定义文件名需要自行避免提交。

先预览计划，**不会构建、连接或更改服务器**：

```bash
npm run deploy -- --dry-run
```

多个环境可用 `--config deploy.config.local-staging.json` 显式选择配置；无论当前终端从哪里调用脚本，构建都在此项目执行。

## 3. 首次发布与更新

发布会修改指定服务器上的应用专用目录，请在 dry-run 确认目标后执行：

```bash
npm run deploy
```

每次发布都会重新执行 npm run build，完整上传 dist（包括 PDF worker、字体和样例），成功解包后切换 current。成功输出类似 `CURRENT 20260928T...Z-...`。不上传源码、node_modules 或本地部署配置。同一电脑项目目录不要同时运行多个发布、构建或 npm test；远端发布锁保护服务器切换，不代替本地构建排他性。

远端布局：

```text
/srv/doudou-english/
  .doudou-english-deploy
  releases/
    VERSION-A/
    VERSION-B/
  current -> releases/VERSION-B
```

Web 服务的网页根目录必须是 **/srv/doudou-english/current**，不能是项目源码、部署根目录或 releases。部署和回滚通常不需要重启静态 Web 服务；若服务缓存已解析的真实路径或文件句柄，需要调整缓存或重新加载。

更新时在电脑同步最新代码，再运行同一发布命令。新版本上传失败、缺少 index.html、目录不合法或已有发布锁时返回非零状态，切换前不会改动 current。旧版本全部保留。

## 4. 用 Python 内置 Web 服务试用

适合可信内网或通过受控 VPN 访问。Python 官方不推荐 http.server 用于生产环境，它只有基础安全检查；**不要直接开放到不受信任的公网**。[Python 官方说明](https://docs.python.org/3/library/http.server.html)

服务器需 Python 3.9+。首次发布成功后，在服务器终端执行：

```bash
python3 -m http.server 8080 \
  --bind 0.0.0.0 \
  --directory /srv/doudou-english/current
```

它以前台方式运行，Ctrl+C 停止，退出 SSH 会话通常也会停止。iPad 使用 `http://服务器内网地址:8080/` 访问；防火墙只允许可信内网/VPN 地址访问 8080，不要为了试用向所有公网地址放开。

只在服务器本机诊断时，把 `--bind` 改为 `127.0.0.1`；其他设备就不能直接访问。需要长期后台运行时，由管理员使用 systemd 管理此命令，设置普通服务用户、开机启动和退出重启；这不会把 Python HTTP 服务变成适合公网的生产服务。

必须用 `--directory .../current`，不要先 cd 到某个具体 release 再启动，否则版本切换后可能仍提供旧目录。Python 版本或系统 MIME 数据不同，.mjs 的类型可能不同；若浏览器提示模块 MIME 错误，按故障排查检查响应。

## 5. 可选：Nginx 或 Caddy

不必同时安装，已有哪个就用哪个。项目提供的配置是**示例**，需按实际域名、目录、端口及现有服务调整；不要覆盖已有总配置。当前开发环境未安装这两个服务，未实际加载示例配置，启用前必须在服务器验证。

### Nginx

配置见 [deploy/nginx.conf](../deploy/nginx.conf)。它是 http 块内的独立 server 块，示例监听 80，提供 current 目录，并为 .mjs/.wasm 设置正确 MIME。按你的发行版和现有 Nginx include 布局添加站点，修改 server_name 和 root。

管理员启用配置后，先检查，再重载：

```bash
sudo nginx -t
sudo systemctl reload nginx
```

检查失败时不要重载。示例只有 HTTP，公网正式使用应按现有证书管理流程增加 HTTPS；不在部署脚本里处理证书。[Nginx root 与 MIME 类型文档](https://nginx.org/en/docs/http/ngx_http_core_module.html#types)

### Caddy

配置见 [deploy/Caddyfile](../deploy/Caddyfile)，要求 Caddy 2。修改域名和根目录，将站点块合并到现有配置，不覆盖已有站点。公网域名的自动 HTTPS 需要正确 DNS、可达的验证端口及允许证书签发的网络环境，不保证在纯内网域名上自动获得公开证书。

假设管理员将配置合并到 /etc/caddy/Caddyfile：

```bash
sudo caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
sudo systemctl reload caddy
```

[Caddy 静态文件配置](https://caddyserver.com/docs/caddyfile/directives/file_server)、[自动 HTTPS 条件](https://caddyserver.com/docs/automatic-https)

上述两份示例都按网站根路径托管。现有网站子路径部署也可行，但须把 URL 前缀正确映射/去除，并使用带尾斜杠的访问地址（例如 /english/）；不要把子路径直接拼接到 current 后。构建中的资源地址是相对路径。

## 6. 验证访问、列出版本和回滚

文件切换成功不代表 DNS、防火墙、TLS 或 Web 服务已经正常。先在服务器检查根网页（以下按 Python 8080 示例），再在 iPad 实际打开：

```bash
curl -I http://127.0.0.1:8080/
```

预期 HTTP 200。页面应显示内置 11 组、161 项。试导入 [words.csv](../public/examples/words.csv)，预览应为两组、三项；再试文字 PDF。英音仍使用 Safari 实际提供的声音，部署不会把 Daniel 升级到高质量版。

在电脑列出远端版本（只读，不构建或上传）：

```bash
npm run deploy -- --list
```

输出 CURRENT 为当前版本，READY 为完整版本，INCOMPLETE 为失败/异常版本。从列表复制一个 READY 的实际版本 ID，再执行回滚（把 VERSION 改成该 ID）：

```bash
npm run deploy -- --rollback VERSION --dry-run
npm run deploy -- --rollback VERSION
```

回滚只切换 current，不重新构建或上传，也不恢复浏览器里的词表、设置或错词记录。HTTP→HTTPS、域名或端口变化会改变浏览器存储 origin，原记录不会自动迁移。

更新或回滚后刷新网页；旧标签页可能请求上一版的资源并出现 404。配置示例使用 no-cache，避免长期缓存入口页面，但不能替换已经打开页面的 JavaScript。历史版本不自动清理；人工清理前确认不删除当前版本和需要回滚的版本，不修改管理标记。

## 7. 失败排查与恢复

| 症状                      | 检查与处理                                                                                                                                      |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| SSH 认证失败/主机密钥失败 | 用同样用户名、端口先手动 SSH；检查密钥、ssh-agent、Host 配置和真实主机指纹，不关闭校验                                                          |
| mkdir/权限失败            | 检查 remoteDir 是否是专用目录、SSH 用户可写、Web 服务用户可读和父目录可遍历；不要对整个 /srv 或家目录递归 chmod                                 |
| 非空未标记目录            | 选择新的空应用目录；不要为了绕过校验手工放入管理标记                                                                                            |
| 路径/链接校验失败         | 检查目录、releases、current 是否被手工替换，使用实际绝对路径；不要绕过校验继续发布                                                              |
| 锁已存在                  | 先确认无发布会话；锁不按时间自动删除。异常断电/SIGKILL 可遗留空锁，确认目标后按下面说明解除                                                     |
| 首次发布初始化中断        | 若标记未写入但 releases 已创建，下一次会拒绝接管；管理员核对没有有效版本与无关数据后另选空目录，或恢复原有空目录，不伪造标记                    |
| 上传中断                  | current 在激活前不变，失败版本可留下；先 --list 确认现状。切换后 SSH 断线可能实际已发布，不能只据本地失败判断未发布                             |
| HTTP 403/404              | 检查 Web 根目录是否 current、服务用户权限、尾斜杠及子路径映射；不要把所有 404 回退成 index.html，否则会掩盖 worker 缺失                         |
| PDF 导入或 JS 模块失败    | 用浏览器网络面板检查 dist/assets/\*.mjs 类型为 application/javascript 或 text/javascript、wasm 为 application/wasm；404 则检查是否上传完整 dist |

若确认无其他发布进程，且锁是本应用的空目录，可在服务器执行以下只删除空目录的命令。先检查实际目录，必要时替换为自己的部署根目录；非空锁会拒绝删除：

```bash
ls -ld /srv/doudou-english/.deploy-lock
rmdir /srv/doudou-english/.deploy-lock
```

不要删除其他应用目录、releases 或 current。完成恢复后先 --list，再发布，并验证 HTTP。

## 验证范围与维护

脚本的配置、发布、失败保护、回滚和锁通过本地 Linux 临时目录及模拟 SSH 传输验证；Python 运行方式也用构建产物验证。没有连接你的服务器，未配置实际 Nginx/Caddy、域名/HTTPS 或防火墙，不声称完成生产部署。具体命令和结果见 [部署验证记录](deployment-verification.md)。

修改脚本字段、目录布局、CLI、导入限制或公开样例时，同步本文、[词表导入指南](word-list-import.md)及对应测试。
