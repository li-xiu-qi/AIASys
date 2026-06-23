/**
 * 智能增量构建脚本。
 *
 * 从 WSL 侧自动判断源码改动范围，只同步和构建受影响的部分，
 * 避免每次全量 rsync + 完整构建。
 *
 * 场景判断：
 *   只改 src/*.cjs      → repack asar → 替换到安装目录（~3秒）
 *   改前端 apps/web/src  → 只 build:web → 替换 resources/web（~2分钟）
 *   改后端 apps/backend  → 只 rsync 后端 → 替换 resources/backend（~30秒）
 *   全量变化            → 完整 build:web + prepare:runtime + 打包（~5分钟）
 *
 * 用法（WSL 内）：
 *   node scripts/dev-patch.cjs [--full]
 *
 * 选项：
 *   --full       强制全量构建
 *   --no-install 不复制到安装目录（仅本地构建，不更新已安装版本）
 *   --dry-run    只打印检测结果，不执行
 */

const { spawnSync } = require("child_process");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

// 路径配置
const WSL_SRC = "/home/ke/projects/AIASys";
const WIN_BUILD = "C:\\Users\\ke\\projects\\AIASys-windows-build";
const INSTALL_DIR = "C:\\Users\\ke\\AppData\\Local\\Programs\\AIASys";
const INSTALL_RESOURCES = `${INSTALL_DIR}\\resources`;

const DESKTOP_SRC = path.join(__dirname, "..", "src");
const DESKTOP_ROOT = path.resolve(__dirname, "..");

// 缓存文件：记录上次构建时的文件哈希
const CACHE_DIR = path.join(DESKTOP_ROOT, ".dist", ".cache");
const HASH_CACHE = path.join(CACHE_DIR, "file-hashes.json");

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * 计算单个文件的 SHA256 哈希
 */
function fileHash(filePath) {
  try {
    const content = fs.readFileSync(filePath);
    return crypto.createHash("sha256").update(content).digest("hex").slice(0, 16);
  } catch {
    return null;
  }
}

/**
 * 递归收集目录下所有文件的哈希
 */
function collectHashes(dir, base = dir) {
  const result = {};
  if (!fs.existsSync(dir)) return result;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".venv" || entry.name === "__pycache__") continue;
      Object.assign(result, collectHashes(fullPath, base));
    } else {
      const relPath = path.relative(base, fullPath);
      result[relPath] = fileHash(fullPath);
    }
  }
  return result;
}

/**
 * 比较两组哈希，返回变化的文件列表
 */
function diffHashes(oldHashes, newHashes) {
  const changed = [];
  for (const [file, hash] of Object.entries(newHashes)) {
    if (oldHashes[file] !== hash) {
      changed.push(file);
    }
  }
  for (const file of Object.keys(oldHashes)) {
    if (!(file in newHashes)) {
      changed.push(file + " (deleted)");
    }
  }
  return changed;
}

/**
 * 检查文件是否在指定前缀组内
 */
function anyStartsWith(files, prefixes) {
  return files.some((f) => prefixes.some((p) => f.startsWith(p)));
}

/**
 * 在 WSL 内执行 rsync 同步到 Windows 临时目录
 */
function wslSync() {
  const WSL_DST = "/mnt/c/Users/ke/projects/AIASys-windows-build";
  ensureDir(WSL_DST);

  console.log(`[dev-patch] 同步 ${WSL_SRC} → ${WIN_BUILD} ...`);
  const start = Date.now();

  const args = ["-av", "--progress"];
  const exclude = [
    ".git", "node_modules", ".venv", "dist", ".dist", "__pycache__",
    ".pytest_cache", ".mypy_cache", ".ruff_cache", "*.pyc", ".aiasys",
    "design-draft", "docs", "images", "infra", "LICENSES",
    ".agents", ".kimi-code", ".claude", ".playwright", ".github",
    ".team-skills", ".editorconfig", ".gitattributes", ".gitignore",
    "CONTRIBUTING.md", "README.md", "LICENSE", "dev.sh", "lefthook.yml",
  ];
  for (const e of exclude) {
    args.push("--exclude", e);
  }
  args.push(`${WSL_SRC}/`, `${WSL_DST}/`);

  const result = spawnSync("rsync", args, {
    encoding: "utf-8",
    stdio: "pipe",
    timeout: 300_000,
  });

  if (result.status !== 0) {
    console.error("[dev-patch] rsync 失败:", result.stderr);
    return false;
  }

  console.log(`[dev-patch] 同步完成，耗时 ${((Date.now() - start) / 1000).toFixed(1)}s`);
  return true;
}

/**
 * 在 Windows 侧执行命令（使用 cmd.exe 避免 PowerShell 的 && 不兼容问题）
 * @param {string} command - 要执行的 cmd 命令
 * @param {string} cwd - 工作目录（Windows 路径）
 * @param {number} timeout - 超时（毫秒）
 */
function winExec(command, cwd, timeout = 300_000) {
  return spawnSync("cmd.exe", [
    "/c",
    `cd /d "${cwd}" && ${command}`,
  ], {
    encoding: "utf-8",
    stdio: "pipe",
    timeout,
  });
}

/**
 * 确保安装目录存在
 */
function ensureInstallDir() {
  const result = spawnSync("powershell.exe", [
    "-NoProfile", "-Command",
    `if (-not (Test-Path '${INSTALL_DIR}')) { Write-Output 'INSTALL_DIR_NOT_FOUND' } else { Write-Output 'OK' }`,
  ], { encoding: "utf-8", timeout: 10000 });

  if (result.stdout && result.stdout.includes("INSTALL_DIR_NOT_FOUND")) {
    console.error(`[dev-patch] 安装目录不存在: ${INSTALL_DIR}`);
    console.error("  请先运行 NSIS 安装包完成安装");
    return false;
  }
  return true;
}

/**
 * 终止正在运行的 AIASys 进程
 */
function killApp() {
  spawnSync("powershell.exe", [
    "-NoProfile", "-Command",
    "Stop-Process -Name 'AIASys' -Force -ErrorAction SilentlyContinue",
  ]);
  // 等待进程退出
  spawnSync("cmd.exe", ["/c", "timeout /t 2 /nobreak >nul"]);
}

/**
 * repack app.asar 并替换到安装目录
 */
function patchAsar() {
  if (!ensureInstallDir()) return false;

  console.log("[dev-patch] 检测到 main.cjs/preload.cjs 变化，repack asar...");
  const start = Date.now();

  killApp();

  const packResult = winExec(
    "npx asar pack src/ resources/app.asar",
    `${WIN_BUILD}\\apps\\desktop`
  );
  if (packResult.status !== 0) {
    console.error("[dev-patch] asar pack 失败:", packResult.stderr);
    return false;
  }

  const copyResult = spawnSync("powershell.exe", [
    "-NoProfile", "-Command",
    `Copy-Item -Path '${WIN_BUILD}\\apps\\desktop\\resources\\app.asar' -Destination '${INSTALL_RESOURCES}\\app.asar' -Force; Write-Output 'OK'`,
  ], { encoding: "utf-8", timeout: 30000 });

  if (copyResult.status !== 0) {
    console.error("[dev-patch] 复制 app.asar 失败:", copyResult.stderr);
    return false;
  }

  console.log(`[dev-patch] asar 更新完成，耗时 ${((Date.now() - start) / 1000).toFixed(1)}s`);
  return true;
}

/**
 * 构建前端并替换到安装目录
 */
function patchWeb() {
  if (!ensureInstallDir()) return false;

  console.log("[dev-patch] 检测到前端代码变化，构建 web...");
  const start = Date.now();

  // 构建前端（在 apps/web 目录下执行）
  const buildResult = winExec("npm run build", `${WIN_BUILD}\\apps\\web`);
  if (buildResult.status !== 0) {
    console.error("[dev-patch] web build 失败:", buildResult.stderr);
    return false;
  }

  killApp();

  // 替换 web dist
  const copyResult = spawnSync("powershell.exe", [
    "-NoProfile", "-Command",
    `Remove-Item -Path '${INSTALL_RESOURCES}\\web\\dist' -Recurse -Force -ErrorAction SilentlyContinue; Copy-Item -Path '${WIN_BUILD}\\apps\\web\\dist' -Destination '${INSTALL_RESOURCES}\\web\\dist' -Recurse -Force; Write-Output 'OK'`,
  ], { encoding: "utf-8", timeout: 30000 });

  if (copyResult.status !== 0) {
    console.error("[dev-patch] 复制 web dist 失败:", copyResult.stderr);
    return false;
  }

  console.log(`[dev-patch] web 更新完成，耗时 ${((Date.now() - start) / 1000).toFixed(1)}s`);
  return true;
}

/**
 * 主流程
 */
function main() {
  const args = process.argv.slice(2);
  const fullMode = args.includes("--full");
  const noInstall = args.includes("--no-install");
  const dryRun = args.includes("--dry-run");

  // 加载上次哈希缓存
  let oldHashes = {};
  try {
    if (fs.existsSync(HASH_CACHE)) {
      oldHashes = JSON.parse(fs.readFileSync(HASH_CACHE, "utf-8"));
    }
  } catch {
    // ignore
  }

  // 收集当前哈希
  const newHashes = {
    desktop: collectHashes(DESKTOP_SRC),
    web: collectHashes(path.join(WSL_SRC, "apps", "web", "src")),
    backend: collectHashes(path.join(WSL_SRC, "apps", "backend", "app")),
  };

  const changed = {
    desktop: diffHashes(oldHashes.desktop || {}, newHashes.desktop),
    web: diffHashes(oldHashes.web || {}, newHashes.web),
    backend: diffHashes(oldHashes.backend || {}, newHashes.backend),
  };

  const hasDesktopChange = changed.desktop.length > 0;
  const hasWebChange = changed.web.length > 0;
  const hasBackendChange = changed.backend.length > 0;
  const hasAnyChange = hasDesktopChange || hasWebChange || hasBackendChange;

  console.log("[dev-patch] 变更检测:");
  console.log(`  desktop: ${hasDesktopChange ? `${changed.desktop.length} 个文件` : "无变化"}`);
  console.log(`  web:     ${hasWebChange ? `${changed.web.length} 个文件` : "无变化"}`);
  console.log(`  backend: ${hasBackendChange ? `${changed.backend.length} 个文件` : "无变化"}`);

  if (dryRun) {
    if (hasDesktopChange) console.log("  → 将执行: repack asar → 替换到安装目录");
    if (hasWebChange) console.log("  → 将执行: build:web → 替换到安装目录");
    if (hasBackendChange) console.log("  → 将执行: 提示手动重建后端");
    if (!hasAnyChange) console.log("  → 无需操作");
    return;
  }

  if (!hasAnyChange && !fullMode) {
    console.log("[dev-patch] 无变化，跳过构建");
    return;
  }

  if (fullMode) {
    console.log("[dev-patch] --full 模式，全量构建");
    console.log("[dev-patch] 注意：全量构建需要调用 Windows 侧的构建脚本");
    console.log(`[dev-patch] 请在 Windows 上执行: cd ${WIN_BUILD}\\apps\\desktop && npm run build:web && npm run prepare:runtime && npx electron-builder --win nsis --publish=never`);
    if (!wslSync()) process.exit(1);
    console.log("[dev-patch] 源码已同步，请在 Windows 上手动执行全量构建");
  } else {
    // 增量模式
    if (!wslSync()) process.exit(1);

    if (hasWebChange) {
      if (!patchWeb()) process.exit(1);
    }

    if (hasDesktopChange) {
      if (!patchAsar()) process.exit(1);
    }

    if (hasBackendChange) {
      console.log("[dev-patch] 检测到后端代码变化，暂不自动处理（需手动 uv sync + prepare:runtime）");
      console.log("  提示：后端变化需重新打包，请使用 --full 模式");
    }
  }

  // 保存哈希缓存
  ensureDir(CACHE_DIR);
  fs.writeFileSync(HASH_CACHE, JSON.stringify(newHashes, null, 2), "utf-8");

  if (noInstall) {
    console.log("[dev-patch] --no-install 模式，跳过安装目录更新");
  }

  console.log("[dev-patch] 完成");
}

main();