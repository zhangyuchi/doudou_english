import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  readlink,
  readdir,
  symlink,
  chmod,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { spawnSync } from "node:child_process";
import { validateConfig, parseArgs, sshArgs } from "../scripts/deploy.mjs";

const project = resolve(import.meta.dirname, "..");
const remoteScript = join(project, "scripts/deploy-remote.sh");
const good = { host: "learning", remoteDir: "/srv/doudou-english" };

test("local CLI rejects build symlinks before sending any archive", async (t) => {
  const temp = await mkdtemp(join(tmpdir(), "dictation-artifact-"));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const scripts = join(temp, "scripts");
  const bin = join(temp, "bin");
  const dist = join(temp, "dist");
  for (const path of [scripts, bin, dist]) await mkdir(path);
  for (const name of ["deploy.mjs", "deploy-remote.sh"])
    await writeFile(
      join(scripts, name),
      await readFile(join(project, "scripts", name)),
    );
  await writeFile(join(dist, "index.html"), "valid");
  await symlink("/etc/passwd", join(dist, "unsafe.txt"));
  await writeFile(join(bin, "npm"), "#!/bin/bash\nexit 0\n");
  await chmod(join(bin, "npm"), 0o755);
  await writeFile(join(temp, "config.json"), JSON.stringify(good));
  const result = spawnSync(
    process.execPath,
    [join(scripts, "deploy.mjs"), "--config", join(temp, "config.json")],
    { encoding: "utf8", env: { ...process.env, PATH: bin } },
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /符号链接或特殊文件/);
});

test("deployment configuration accepts SSH aliases and rejects unsafe targets", () => {
  assert.deepEqual(validateConfig(good), good);
  assert.deepEqual(validateConfig({ ...good, user: "deploy", port: 2222 }), {
    ...good,
    user: "deploy",
    port: 2222,
  });
  for (const host of ["-bad", "host;touch", "host name", "user@host", ""])
    assert.throws(() => validateConfig({ ...good, host }));
  for (const remoteDir of [
    "/",
    "/srv",
    "/var/www",
    "/home/alice",
    "relative/site",
    "/srv/a/../b",
    "/srv/a/./b",
    "/srv//app",
    "/srv/app/",
    "/srv/app;bad",
    "/srv/app name",
  ])
    assert.throws(() => validateConfig({ ...good, remoteDir }));
  for (const port of [0, 65536, "22", 2.5])
    assert.throws(() => validateConfig({ ...good, port }));
  assert.throws(() => validateConfig({ ...good, user: "-root" }));
  assert.throws(() => validateConfig({ ...good, password: "no" }));
  assert.throws(() => validateConfig(null));
});

test("CLI actions and SSH arguments have no implicit shell configuration", () => {
  assert.deepEqual(parseArgs([]), {
    config: "deploy.config.json",
    action: "deploy",
    version: "",
    dryRun: false,
    help: false,
  });
  assert.equal(parseArgs(["--rollback", "release-1"]).action, "rollback");
  for (const args of [
    ["--list", "--rollback", "a"],
    ["--config"],
    ["--rollback", "../bad"],
    ["--unknown"],
    ["--list", "--list"],
  ])
    assert.throws(() => parseArgs(args));
  const args = sshArgs(
    { ...good, user: "deploy", port: 2222 },
    "rollback",
    "release-1",
    "printf '%s' \"$1\"",
  );
  assert.deepEqual(args.slice(0, -1), [
    "-T",
    "-o",
    "BatchMode=yes",
    "-o",
    "ConnectTimeout=15",
    "-p",
    "2222",
    "deploy@learning",
  ]);
  assert.match(args.at(-1), /bash -c /);
  assert.ok(!args.join(" ").includes("StrictHostKeyChecking=no"));
  const executed = spawnSync("bash", ["-c", args.at(-1)], { encoding: "utf8" });
  assert.equal(executed.status, 0, executed.stderr);
  assert.equal(executed.stdout, "rollback");
});

test("help and dry-run do not build, connect or change the project", async (t) => {
  const temp = await mkdtemp(join(tmpdir(), "dictation-cli-"));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const config = join(temp, "config.json");
  await writeFile(config, JSON.stringify(good));
  const help = spawnSync(
    process.execPath,
    [join(project, "scripts/deploy.mjs"), "--help"],
    { encoding: "utf8", env: { ...process.env, PATH: "" } },
  );
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /--rollback/);
  for (const action of [[], ["--list"], ["--rollback", "release-1"]]) {
    const result = spawnSync(
      process.execPath,
      [
        join(project, "scripts/deploy.mjs"),
        "--config",
        config,
        "--dry-run",
        ...action,
      ],
      { cwd: temp, encoding: "utf8", env: { ...process.env, PATH: "" } },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /DRY RUN/);
  }
  assert.deepEqual(await readdir(temp), ["config.json"]);
});

async function fixture(t) {
  const temp = await mkdtemp(join(tmpdir(), "dictation-remote-"));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const source = join(temp, "artifact");
  await mkdir(source);
  await writeFile(join(source, "index.html"), "first release");
  await mkdir(join(source, "assets"));
  await writeFile(join(source, "assets/app.js"), "console.log('ok')");
  const root = join(temp, "site");
  const archive = () => {
    const packed = spawnSync("tar", ["-czf", "-", "-C", source, "."]);
    assert.equal(packed.status, 0, packed.stderr?.toString());
    return packed.stdout;
  };
  const remote = (action, version = "", input) =>
    spawnSync("bash", [remoteScript, action, root, version], {
      input,
      encoding: "utf8",
    });
  return { temp, root, source, archive, remote };
}

test("real remote script publishes, lists and rolls back complete versions", async (t) => {
  const f = await fixture(t);
  assert.equal(f.remote("list").status, 1);
  assert.equal((await readdir(f.temp)).includes("site"), false);
  let result = f.remote("deploy", "release-1", f.archive());
  assert.equal(result.status, 0, result.stderr);
  assert.equal(await readlink(join(f.root, "current")), "releases/release-1");
  await writeFile(join(f.source, "index.html"), "second release");
  result = f.remote("deploy", "release-2", f.archive());
  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    await readFile(join(f.root, "current/index.html"), "utf8"),
    "second release",
  );
  result = f.remote("list");
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /CURRENT release-2/);
  assert.match(result.stdout, /release-1/);
  result = f.remote("rollback", "release-1");
  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    await readFile(join(f.root, "current/index.html"), "utf8"),
    "first release",
  );
  assert.equal((await readdir(join(f.root, "releases"))).length, 2);
  assert.equal((await readdir(f.root)).includes(".deploy-lock"), false);
});

test("failed archives and unavailable rollback targets never replace current", async (t) => {
  const f = await fixture(t);
  assert.equal(f.remote("deploy", "good", f.archive()).status, 0);
  for (const [action, version, input] of [
    ["deploy", "broken", Buffer.from("not gzip")],
    ["rollback", "missing"],
    ["rollback", "../good"],
    ["deploy", "good", f.archive()],
  ]) {
    const result = f.remote(action, version, input);
    assert.notEqual(result.status, 0, result.stdout);
    assert.equal(await readlink(join(f.root, "current")), "releases/good");
    assert.equal((await readdir(f.root)).includes(".deploy-lock"), false);
  }
  assert.notEqual(f.remote("rollback", "broken").status, 0);
  const listed = f.remote("list");
  assert.match(listed.stdout, /INCOMPLETE broken/);
});

test("unmanaged directories, replaced paths and busy locks are protected", async (t) => {
  const f = await fixture(t);
  await mkdir(f.root);
  await writeFile(join(f.root, "personal.txt"), "keep");
  assert.notEqual(f.remote("deploy", "one", f.archive()).status, 0);
  assert.equal(await readFile(join(f.root, "personal.txt"), "utf8"), "keep");
  await rm(join(f.root, "personal.txt"));
  assert.equal(f.remote("deploy", "one", f.archive()).status, 0);
  await mkdir(join(f.root, ".deploy-lock"));
  assert.notEqual(f.remote("deploy", "two", f.archive()).status, 0);
  assert.notEqual(f.remote("rollback", "one").status, 0);
  assert.equal(f.remote("list").status, 0);
  await rm(join(f.root, ".deploy-lock"), { recursive: true });
  await rm(join(f.root, "current"));
  await mkdir(join(f.root, "current"));
  assert.notEqual(f.remote("deploy", "two", f.archive()).status, 0);
  await rm(join(f.root, "current"), { recursive: true });
  await symlink("/tmp", join(f.root, "current"));
  assert.notEqual(f.remote("rollback", "one").status, 0);
  await rm(join(f.root, "current"));
  await symlink("releases/one", join(f.root, "current"));
  await symlink(f.source, join(f.root, "releases/evil"));
  assert.notEqual(f.remote("rollback", "evil").status, 0);
});

test("remote validation rejects broad paths and symlinked roots or release stores", async (t) => {
  const f = await fixture(t);
  for (const root of ["/", "/srv", "/var/www", "/home/alice", "/tmp/a/../b"]) {
    const result = spawnSync("bash", [remoteScript, "deploy", root, "one"], {
      input: f.archive(),
      encoding: "utf8",
    });
    assert.notEqual(result.status, 0);
  }
  await symlink(f.source, f.root);
  assert.notEqual(f.remote("deploy", "one", f.archive()).status, 0);
  await rm(f.root);
  assert.equal(f.remote("deploy", "one", f.archive()).status, 0);
  await rm(join(f.root, "current"));
  await rm(join(f.root, "releases"), { recursive: true });
  await symlink(f.source, join(f.root, "releases"));
  assert.notEqual(f.remote("deploy", "two", f.archive()).status, 0);
  assert.equal(
    await readFile(join(f.source, "index.html"), "utf8"),
    "first release",
  );
});

test("missing index and truncated archive cannot be activated or rolled back to", async (t) => {
  const f = await fixture(t);
  const packed = f.archive();
  assert.equal(f.remote("deploy", "good", packed).status, 0);
  assert.notEqual(
    f.remote("deploy", "truncated", packed.subarray(0, 12)).status,
    0,
  );
  await rm(join(f.source, "index.html"));
  assert.notEqual(f.remote("deploy", "no-index", f.archive()).status, 0);
  assert.notEqual(f.remote("rollback", "no-index").status, 0);
  assert.equal(await readlink(join(f.root, "current")), "releases/good");
});

test("failed link creation preserves a conflicting path and the active release", async (t) => {
  const f = await fixture(t);
  assert.equal(f.remote("deploy", "good", f.archive()).status, 0);
  const bin = join(f.temp, "bin");
  await mkdir(bin);
  const ln = join(bin, "ln");
  const outside = join(f.temp, "outside");
  await mkdir(outside);
  // Simulate another writer placing the candidate link just before real ln rejects it.
  await writeFile(
    ln,
    `#!/bin/bash\n/bin/ln -s '${outside}' "${"${@: -1}"}"\nexec /bin/ln "$@"\n`,
  );
  await chmod(ln, 0o755);
  const result = spawnSync("bash", [remoteScript, "deploy", f.root, "new"], {
    input: f.archive(),
    encoding: "utf8",
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
  });
  assert.notEqual(result.status, 0);
  assert.equal(await readlink(join(f.root, "current")), "releases/good");
  const candidates = (await readdir(f.root)).filter((name) =>
    name.startsWith(".current-new-"),
  );
  assert.equal(candidates.length, 1);
  assert.equal(await readlink(join(f.root, candidates[0])), outside);
  assert.deepEqual(await readdir(outside), []);
  assert.equal((await readdir(f.root)).includes(".deploy-lock"), false);
});

test("local CLI builds and archives through a simulated SSH transport; failures propagate", async (t) => {
  const f = await fixture(t);
  const bin = join(f.temp, "bin");
  await mkdir(bin);
  const ssh = join(bin, "ssh");
  await writeFile(
    ssh,
    '#!/bin/bash\nif [[ "${FAKE_SSH_FAIL:-}" == 1 ]]; then exit 23; fi\nexec /bin/bash -c "${@: -1}"\n',
  );
  await chmod(ssh, 0o755);
  const config = join(f.temp, "config.json");
  await writeFile(
    config,
    JSON.stringify({ host: "simulated-only", remoteDir: f.root }),
  );
  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    TMPDIR: f.temp,
  };
  const cli = (args = [], extra = {}) =>
    spawnSync(
      process.execPath,
      [join(project, "scripts/deploy.mjs"), "--config", config, ...args],
      { encoding: "utf8", env: { ...env, ...extra }, timeout: 30000 },
    );
  const deployed = cli();
  assert.equal(deployed.status, 0, deployed.stderr + deployed.stdout);
  const current = await readlink(join(f.root, "current"));
  assert.match(
    await readFile(join(f.root, "current/index.html"), "utf8"),
    /听写时光/,
  );
  assert.match(cli(["--list"]).stdout, /READY/);
  assert.notEqual(cli([], { FAKE_SSH_FAIL: "1" }).status, 0);
  assert.equal(await readlink(join(f.root, "current")), current);
  const fakeNpm = join(bin, "npm");
  await writeFile(fakeNpm, "#!/bin/bash\nexit 17\n");
  await chmod(fakeNpm, 0o755);
  const failedBuild = cli();
  assert.equal(failedBuild.status, 1);
  assert.match(failedBuild.stderr, /退出码 17/);
  assert.equal(await readlink(join(f.root, "current")), current);
  assert.ok(
    !(await readdir(f.temp)).some((name) => name.startsWith("doudou-deploy-")),
  );
});
