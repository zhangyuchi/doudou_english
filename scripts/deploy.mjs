import { spawnSync } from "node:child_process";
import { readFile, readdir, lstat, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { randomBytes } from "node:crypto";

const project = resolve(import.meta.dirname, "..");
const versionPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const broadPaths = new Set([
  "/",
  "/srv",
  "/var",
  "/var/www",
  "/home",
  "/root",
  "/opt",
  "/tmp",
  "/usr",
  "/etc",
  "/run",
  "/boot",
  "/dev",
  "/proc",
  "/sys",
]);

/**
 * Validate the small deployment configuration before any build or SSH operation.
 * Values never become executable configuration; broad directories and option injection are rejected.
 */
export function validateConfig(value) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("部署配置必须是 JSON 对象。");
  for (const key of Object.keys(value))
    if (!["host", "user", "port", "remoteDir"].includes(key))
      throw new Error(`未知部署配置字段：${key}`);
  if (
    typeof value.host !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value.host)
  )
    throw new Error(
      "host 必须是主机名、IPv4 地址或 SSH Host 别名，不含用户名或空格。",
    );
  if (
    value.user !== undefined &&
    (typeof value.user !== "string" ||
      !/^[A-Za-z_][A-Za-z0-9_-]*$/.test(value.user))
  )
    throw new Error(
      "user 必须是合法 SSH 用户名；使用 SSH 配置时请省略此字段。",
    );
  if (
    value.port !== undefined &&
    (!Number.isInteger(value.port) || value.port < 1 || value.port > 65535)
  )
    throw new Error("port 必须是 1—65535 的整数。");
  const dir = value.remoteDir;
  if (
    typeof dir !== "string" ||
    !/^\/(?:[A-Za-z0-9_-][A-Za-z0-9._-]*\/)+[A-Za-z0-9_-][A-Za-z0-9._-]*$/.test(
      dir,
    ) ||
    broadPaths.has(dir) ||
    /^\/home\/[^/]+$/.test(dir) ||
    /^\/(?:etc|usr|bin|sbin|boot|dev|proc|sys|run)(?:\/|$)/.test(dir)
  )
    throw new Error(
      "remoteDir 必须是应用专用绝对目录，例如 /srv/doudou-english；拒绝宽泛目录、空格、尾斜杠和路径穿越。",
    );
  return { ...value };
}

/** Parse mutually exclusive CLI actions; missing values and unknown flags fail explicitly. */
export function parseArgs(argv) {
  const options = {
    config: "deploy.config.json",
    action: "deploy",
    version: "",
    dryRun: false,
    help: false,
  };
  const seen = new Set();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (seen.has(arg)) throw new Error(`重复参数：${arg}`);
    seen.add(arg);
    if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--config" || arg === "--rollback") {
      const value = argv[++i];
      if (!value || value.startsWith("--"))
        throw new Error(`${arg} 缺少参数。`);
      if (arg === "--config") options.config = value;
      else {
        if (options.action !== "deploy" || !versionPattern.test(value))
          throw new Error(
            "--rollback 需要合法版本，且不能与 --list 同时使用。",
          );
        options.action = "rollback";
        options.version = value;
      }
    } else if (arg === "--list") {
      if (options.action !== "deploy")
        throw new Error("--list 与 --rollback 不能同时使用。");
      options.action = "list";
    } else throw new Error(`未知参数：${arg}`);
  }
  return options;
}

/** Quote a single argument for the login shell that OpenSSH invokes remotely. */
function shellQuote(value) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

/** Build SSH argv without a local shell; quote every remote command argument independently. */
export function sshArgs(config, action, version, script) {
  validateConfig(config);
  if (
    !["deploy", "list", "rollback"].includes(action) ||
    (action !== "list" && !versionPattern.test(version))
  )
    throw new Error("非法发布动作或版本。");
  const args = ["-T", "-o", "BatchMode=yes", "-o", "ConnectTimeout=15"];
  if (config.port !== undefined) args.push("-p", String(config.port));
  args.push(config.user ? `${config.user}@${config.host}` : config.host);
  args.push(
    [
      "bash",
      "-c",
      shellQuote(script),
      "--",
      shellQuote(action),
      shellQuote(config.remoteDir),
      shellQuote(version),
    ].join(" "),
  );
  return args;
}

/** Run one owning subprocess; report spawn failures, signals and nonzero exits without retrying. */
function run(command, args, input) {
  const result = spawnSync(command, args, {
    cwd: project,
    stdio: input === undefined ? "inherit" : ["pipe", "inherit", "inherit"],
    input,
  });
  if (result.error)
    throw new Error(`${command} 启动失败：${result.error.message}`);
  if (result.status !== 0)
    throw new Error(
      `${command} 失败（${result.signal || `退出码 ${result.status}`}）。`,
    );
}

/**
 * Require a regular-file-only build tree before packaging it for a trusted remote extractor.
 * This prevents build-tree symlinks from publishing unrelated local files or remote write targets.
 */
async function validateArtifact(dir) {
  const stat = await lstat(dir);
  if (!stat.isDirectory() || stat.isSymbolicLink())
    throw new Error(`构建目录类型错误：${dir}`);
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) await validateArtifact(join(dir, entry.name));
    else if (!entry.isFile())
      throw new Error(`构建产物不能包含符号链接或特殊文件：${entry.name}`);
  }
}

/**
 * Execute the requested deployment action from this project, keeping real credentials outside it.
 * Dry-run is side-effect free; deploy cleans only its own temporary archive, never remote releases.
 */
async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(
      "用法：npm run deploy -- [--config FILE] [--dry-run] [--list | --rollback VERSION]\n默认：构建并发布。--list 只读；--rollback 切换已有完整版本；--dry-run 不构建、不连接。\n配置默认 deploy.config.json；SSH 使用密钥/已有 Host 配置。",
    );
    return;
  }
  let config;
  try {
    config = validateConfig(
      JSON.parse(await readFile(resolve(options.config), "utf8")),
    );
  } catch (error) {
    throw new Error(`读取配置 ${options.config} 失败：${error.message}`);
  }
  if (options.dryRun) {
    console.log(
      `DRY RUN: ${options.action} ${config.user ? `${config.user}@` : ""}${config.host}${config.port ? `:${config.port}` : ""} → ${config.remoteDir}${options.version ? ` / ${options.version}` : ""}\n未构建、未连接服务器、未改变任何部署文件。`,
    );
    return;
  }
  const script = await readFile(
    join(project, "scripts/deploy-remote.sh"),
    "utf8",
  );
  if (options.action !== "deploy") {
    run(
      "ssh",
      sshArgs(config, options.action, options.version, script),
      Buffer.alloc(0),
    );
    return;
  }
  run("npm", ["run", "build"]);
  const dist = join(project, "dist");
  await validateArtifact(dist);
  const index = await lstat(join(dist, "index.html"));
  if (!index.isFile() || !index.size)
    throw new Error("构建产物缺少有效 index.html。");
  const temp = await mkdtemp(join(tmpdir(), "doudou-deploy-"));
  try {
    const archive = join(temp, "site.tar.gz");
    run("tar", ["-czf", archive, "-C", dist, "."]);
    const version = `${new Date().toISOString().replace(/[-:.]/g, "")}-${randomBytes(4).toString("hex")}`;
    console.log(`发布版本 ${version} 到 ${config.host}:${config.remoteDir}`);
    run(
      "ssh",
      sshArgs(config, "deploy", version, script),
      await readFile(archive),
    );
    console.log(
      "文件版本已切换。请按部署指南检查 HTTP 访问；这不代表 Web 服务已配置。",
    );
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  main().catch((error) => {
    console.error(`部署失败：${error.message}`);
    process.exitCode = 1;
  });
}
