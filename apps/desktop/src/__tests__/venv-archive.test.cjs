const fs = require("fs");
const path = require("path");
const os = require("os");
const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert");
const tar = require("tar");

const {
  _readVenvManifest,
  _extractVenvArchive,
  _preparePackagedVenv,
  _bootstrapVenvFromScratch,
  _resolveBundledUvPath,
} = require("../service-manager.cjs");

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function createFakeVenv(dir) {
  const venvDir = path.join(dir, ".venv");
  const binDir = path.join(venvDir, "bin");
  const libDir = path.join(venvDir, "lib", "python3.12", "site-packages");
  fs.mkdirSync(binDir, { recursive: true });
  fs.mkdirSync(libDir, { recursive: true });
  fs.writeFileSync(path.join(binDir, "python3"), "#!/usr/bin/env python3\n", "utf-8");
  fs.writeFileSync(path.join(libDir, "module.py"), "print('hello')\n", "utf-8");
  fs.writeFileSync(
    path.join(venvDir, "pyvenv.cfg"),
    "home = python\nversion = 3.12.0\n",
    "utf-8",
  );
  return venvDir;
}

describe("venv archive", () => {
  let tmpDir = null;

  beforeEach(() => {
    tmpDir = tempDir("desktop-venv-archive-test-");
  });

  afterEach(() => {
    if (tmpDir) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      tmpDir = null;
    }
  });

  it("readVenvManifest 读取有效的 manifest", () => {
    const backendRoot = tmpDir;
    fs.writeFileSync(
      path.join(backendRoot, ".venv.manifest.json"),
      JSON.stringify({ entries: 42, compressedSize: 12345 }),
      "utf-8",
    );
    const manifest = _readVenvManifest(backendRoot);
    assert.strictEqual(manifest.entries, 42);
    assert.strictEqual(manifest.compressedSize, 12345);
  });

  it("readVenvManifest 对缺失/损坏文件返回 null", () => {
    assert.strictEqual(_readVenvManifest(tmpDir), null);

    fs.writeFileSync(
      path.join(tmpDir, ".venv.manifest.json"),
      "not json",
      "utf-8",
    );
    assert.strictEqual(_readVenvManifest(tmpDir), null);
  });

  it("extractVenvArchive 解压压缩包并报告进度", async () => {
    const backendRoot = tmpDir;
    const venvDir = createFakeVenv(backendRoot);
    const archivePath = path.join(backendRoot, ".venv.tar.gz");

    await tar.create(
      { gzip: true, file: archivePath, cwd: backendRoot },
      [".venv"],
    );

    const extractRoot = path.join(tmpDir, "extracted");
    fs.mkdirSync(extractRoot, { recursive: true });

    const progressEvents = [];
    await _extractVenvArchive(archivePath, extractRoot, 8, (event) => {
      progressEvents.push(event);
    });

    const extractedVenv = path.join(extractRoot, ".venv");
    assert.strictEqual(fs.existsSync(extractedVenv), true);
    assert.strictEqual(
      fs.existsSync(path.join(extractedVenv, "bin", "python3")),
      true,
    );
    assert.strictEqual(
      fs.existsSync(path.join(extractedVenv, "pyvenv.cfg")),
      true,
    );

    // 进度事件应包含 percent，且最后为 100
    assert.ok(progressEvents.length > 0);
    const lastEvent = progressEvents[progressEvents.length - 1];
    assert.strictEqual(lastEvent.percent, 100);
  });

  it("preparePackagedVenv 优先解压压缩包", async () => {
    const backendRoot = tmpDir;
    const venvDir = createFakeVenv(backendRoot);
    const archivePath = path.join(backendRoot, ".venv.tar.gz");

    await tar.create(
      { gzip: true, file: archivePath, cwd: backendRoot },
      [".venv"],
    );
    fs.rmSync(venvDir, { recursive: true, force: true });

    fs.writeFileSync(
      path.join(backendRoot, ".venv.manifest.json"),
      JSON.stringify({ entries: 8 }),
      "utf-8",
    );

    const runtimeStateRoot = path.join(tmpDir, "runtime");
    fs.mkdirSync(runtimeStateRoot, { recursive: true });

    const progressEvents = [];
    await _preparePackagedVenv(
      backendRoot,
      runtimeStateRoot,
      (event) => {
        progressEvents.push(event);
      },
    );

    const writableVenv = path.join(runtimeStateRoot, ".venv");
    assert.strictEqual(fs.existsSync(writableVenv), true);
    assert.strictEqual(
      fs.existsSync(path.join(writableVenv, "bin", "python3")),
      true,
    );
    assert.ok(progressEvents.length > 0);
    assert.strictEqual(progressEvents[progressEvents.length - 1].percent, 100);
  });

  it("preparePackagedVenv 无压缩包时回退到逐文件复制", async () => {
    const backendRoot = tmpDir;
    createFakeVenv(backendRoot);

    const runtimeStateRoot = path.join(tmpDir, "runtime");
    fs.mkdirSync(runtimeStateRoot, { recursive: true });

    const progressEvents = [];
    await _preparePackagedVenv(
      backendRoot,
      runtimeStateRoot,
      (event) => {
        progressEvents.push(event);
      },
    );

    const writableVenv = path.join(runtimeStateRoot, ".venv");
    assert.strictEqual(fs.existsSync(writableVenv), true);
    assert.strictEqual(
      fs.existsSync(path.join(writableVenv, "bin", "python3")),
      true,
    );
  });

  it("preparePackagedVenv 对已存在的完整 .venv 直接复用", async () => {
    const backendRoot = tmpDir;
    createFakeVenv(backendRoot);

    const runtimeStateRoot = path.join(tmpDir, "runtime");
    const writableVenv = path.join(runtimeStateRoot, ".venv");
    fs.mkdirSync(path.join(writableVenv, "bin"), { recursive: true });
    fs.writeFileSync(path.join(writableVenv, "bin", "python3"), "#!/bin/sh\necho ok", "utf-8");
    fs.writeFileSync(path.join(writableVenv, "existing"), "yes", "utf-8");

    let called = false;
    await _preparePackagedVenv(backendRoot, runtimeStateRoot, () => {
      called = true;
    });

    assert.strictEqual(called, false);
    assert.strictEqual(fs.readFileSync(path.join(writableVenv, "existing"), "utf-8"), "yes");
  });

  it("preparePackagedVenv Light 模式：无 .venv 时走 bootstrap 路径", async () => {
    const backendRoot = tmpDir;
    // 确保没有 .venv.tar.gz 也没有 .venv 目录
    assert.strictEqual(fs.existsSync(path.join(backendRoot, ".venv.tar.gz")), false);
    assert.strictEqual(fs.existsSync(path.join(backendRoot, ".venv")), false);

    const runtimeStateRoot = path.join(tmpDir, "runtime");
    fs.mkdirSync(runtimeStateRoot, { recursive: true });

    // Light 模式无 bundled uv 时，应抛出明确错误
    await assert.rejects(
      _preparePackagedVenv(backendRoot, runtimeStateRoot, () => {}),
      (err) => {
        assert.ok(err.message.includes("bundled uv"));
        assert.ok(err.message.includes("Light/Portable"));
        return true;
      },
    );
  });

  it("preparePackagedVenv 压缩包损坏时级联到 bootstrap", async () => {
    const backendRoot = tmpDir;
    const runtimeStateRoot = path.join(tmpDir, "runtime");
    fs.mkdirSync(runtimeStateRoot, { recursive: true });

    // 创建一个损坏的 .venv.tar.gz（只有 archive 没有 manifest，且无 .venv 目录）
    fs.writeFileSync(path.join(backendRoot, ".venv.tar.gz"), "corrupted garbage", "utf-8");
    // 确保没有 .venv 目录
    assert.strictEqual(fs.existsSync(path.join(backendRoot, ".venv")), false);

    // 解压应失败，然后因为没有 .venv 目录可降级，最终走 bootstrap
    await assert.rejects(
      _preparePackagedVenv(backendRoot, runtimeStateRoot, () => {}),
      (err) => {
        assert.ok(err.message.includes("bundled uv"));
        return true;
      },
    );
  });

  it("bootstrapVenvFromScratch 无 bundled uv 时抛出错误", async () => {
    const backendRoot = tmpDir;
    const runtimeStateRoot = path.join(tmpDir, "runtime");
    fs.mkdirSync(runtimeStateRoot, { recursive: true });

    await assert.rejects(
      _bootstrapVenvFromScratch(backendRoot, runtimeStateRoot, () => {}),
      (err) => {
        assert.ok(err.message.includes("bundled uv"));
        return true;
      },
    );
  });

  it("bootstrapVenvFromScratch 使用真实 uv 创建环境（需要 uv 可用）", { skip: !hasRealUv() }, async () => {
    const uvBin = findRealUv();
    const backendRoot = tmpDir;
    const runtimeStateRoot = path.join(tmpDir, "runtime");
    fs.mkdirSync(runtimeStateRoot, { recursive: true });

    // 创建 bundled uv 目录结构
    const uvSubDir = resolveUvPlatformDir();
    const vendorUvDir = path.join(backendRoot, "vendor", "uv", uvSubDir);
    fs.mkdirSync(vendorUvDir, { recursive: true });
    const uvName = process.platform === "win32" ? "uv.exe" : "uv";
    fs.copyFileSync(uvBin, path.join(vendorUvDir, uvName));
    fs.chmodSync(path.join(vendorUvDir, uvName), 0o755);

    // 创建最小 pyproject.toml（无依赖，加速 uv sync）
    fs.writeFileSync(
      path.join(backendRoot, "pyproject.toml"),
      [
        "[project]",
        'name = "test-bootstrap"',
        'version = "0.1.0"',
        'requires-python = ">=3.12"',
        "dependencies = []",
      ].join("\n"),
      "utf-8",
    );

    const progressEvents = [];
    await _bootstrapVenvFromScratch(backendRoot, runtimeStateRoot, (event) => {
      progressEvents.push(event);
    });

    const writableVenv = path.join(runtimeStateRoot, ".venv");
    assert.strictEqual(fs.existsSync(writableVenv), true);
    assert.strictEqual(
      fs.existsSync(path.join(writableVenv, "pyvenv.cfg")),
      true,
    );

    // 进度事件应包含 three steps + done
    assert.ok(progressEvents.length >= 4);
    const steps = progressEvents.map((e) => e.step);
    assert.ok(steps.includes("python"));
    assert.ok(steps.includes("venv"));
    assert.ok(steps.includes("deps"));
    assert.ok(steps.includes("done"));
    assert.strictEqual(progressEvents[progressEvents.length - 1].percent, 100);
  });

  it("resolveBundledUvPath 正确解析平台路径", () => {
    const backendRoot = tmpDir;
    const uvSubDir = resolveUvPlatformDir();
    const uvName = process.platform === "win32" ? "uv.exe" : "uv";
    const expectedPath = path.join(backendRoot, "vendor", "uv", uvSubDir, uvName);

    // 创建目录结构使 fs.existsSync 通过
    fs.mkdirSync(path.dirname(expectedPath), { recursive: true });
    fs.writeFileSync(expectedPath, "fake uv", "utf-8");

    const resolved = _resolveBundledUvPath(backendRoot);
    assert.strictEqual(resolved, expectedPath);
  });

  it("resolveBundledUvPath 对不支持的平台返回 null", () => {
    const originalPlatform = process.platform;
    const originalArch = process.arch;
    // 临时覆盖 platform/arch 以测试未知平台分支
    Object.defineProperty(process, "platform", { value: "freebsd" });
    Object.defineProperty(process, "arch", { value: "ia32" });
    try {
      const result = _resolveBundledUvPath(tmpDir);
      assert.strictEqual(result, null);
    } finally {
      Object.defineProperty(process, "platform", { value: originalPlatform });
      Object.defineProperty(process, "arch", { value: originalArch });
    }
  });

  it("preparePackagedVenv 三种模式端到端：Full(tar.gz) → Full(目录) → Light(bootstrap)", async () => {
    // 子场景 1: Full 模式 — .venv.tar.gz 优先
    {
      const backendRoot = path.join(tmpDir, "full-archive");
      const runtimeRoot = path.join(tmpDir, "full-archive-runtime");
      fs.mkdirSync(runtimeRoot, { recursive: true });
      createFakeVenv(backendRoot);
      const archivePath = path.join(backendRoot, ".venv.tar.gz");
      await tar.create({ gzip: true, file: archivePath, cwd: backendRoot }, [".venv"]);
      fs.rmSync(path.join(backendRoot, ".venv"), { recursive: true, force: true });
      fs.writeFileSync(
        path.join(backendRoot, ".venv.manifest.json"),
        JSON.stringify({ entries: 8 }),
        "utf-8",
      );

      await _preparePackagedVenv(backendRoot, runtimeRoot, () => {});
      assert.strictEqual(
        fs.existsSync(path.join(runtimeRoot, ".venv", "bin", "python3")),
        true,
      );
    }

    // 子场景 2: Full 模式降级 — 只有 .venv 目录，无压缩包
    {
      const backendRoot = path.join(tmpDir, "full-dir");
      const runtimeRoot = path.join(tmpDir, "full-dir-runtime");
      fs.mkdirSync(runtimeRoot, { recursive: true });
      createFakeVenv(backendRoot);
      // 确保无压缩包
      assert.strictEqual(fs.existsSync(path.join(backendRoot, ".venv.tar.gz")), false);

      await _preparePackagedVenv(backendRoot, runtimeRoot, () => {});
      assert.strictEqual(
        fs.existsSync(path.join(runtimeRoot, ".venv", "bin", "python3")),
        true,
      );
    }

    // 子场景 3: Light 模式 — 无 .venv 也无 .venv.tar.gz，走 bootstrap
    {
      const backendRoot = path.join(tmpDir, "light");
      const runtimeRoot = path.join(tmpDir, "light-runtime");
      fs.mkdirSync(runtimeRoot, { recursive: true });

      // 确保无 .venv 和 .venv.tar.gz
      assert.strictEqual(fs.existsSync(path.join(backendRoot, ".venv")), false);
      assert.strictEqual(fs.existsSync(path.join(backendRoot, ".venv.tar.gz")), false);

      // 无 bundled uv 时抛出错误（预期行为）
      await assert.rejects(
        _preparePackagedVenv(backendRoot, runtimeRoot, () => {}),
        (err) => err.message.includes("bundled uv"),
      );
    }
  });
});

/**
 * 检查系统是否有可用的 uv。
 */
function hasRealUv() {
  try {
    const { spawnSync } = require("child_process");
    const result = spawnSync("uv", ["--version"], {
      encoding: "utf-8",
      timeout: 5000,
      windowsHide: process.platform === "win32",
    });
    return result.status === 0;
  } catch {
    return false;
  }
}

/**
 * 查找 uv 可执行文件路径。
 */
function findRealUv() {
  const { spawnSync } = require("child_process");
  if (process.platform === "win32") {
    const result = spawnSync("where", ["uv"], { encoding: "utf-8", windowsHide: true });
    if (result.status === 0) return result.stdout.trim().split("\n")[0].trim();
  } else {
    const result = spawnSync("which", ["uv"], { encoding: "utf-8" });
    if (result.status === 0) return result.stdout.trim();
  }
  throw new Error("uv not found");
}

/**
 * 将当前平台映射到 vendor 下的 uv 子目录名。
 */
function resolveUvPlatformDir() {
  const map = {
    "darwin-arm64": "darwin-arm64",
    "darwin-x64": "darwin-x64",
    "linux-arm64": "linux-arm64",
    "linux-x64": "linux-x64",
    "win32-x64": "windows-x64",
  };
  const key = `${process.platform}-${process.arch}`;
  return map[key] || "linux-x64";
}
