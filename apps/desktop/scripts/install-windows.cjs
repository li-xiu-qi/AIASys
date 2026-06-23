#!/usr/bin/env node
/**
 * AIASys Windows 安装辅助脚本
 *
 * 设计目标：让 AI 和人都能安全、可预期地安装/升级 Windows 版 AIASys。
 * 使用绿色版 zip 包进行安装，避免 NSIS 安装程序在自动化环境中无响应或被杀毒拦截。
 *
 * 用法：
 *   node scripts/install-windows.cjs <zipPath> [targetDir]
 *
 * 默认安装到：C:\Users\<user>\AppData\Local\Programs\AIASys
 *
 * 行为：
 *   1. 检测并终止运行中的 AIASys 进程（按 PID，安全）
 *   2. 备份旧版本安装目录（重命名为 AIASys.bak.<timestamp>）
 *   3. 用 PowerShell Expand-Archive 解压 zip 到目标目录
 *   4. 创建/更新桌面和开始菜单快捷方式
 *   5. 验证安装结果（检查关键文件是否存在）
 *   6. 输出结构化日志，便于 AI 读取
 */

const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawnSync } = require("child_process");

function log(level, message) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] [${level}] ${message}`);
}

function fail(message, code = 1) {
  log("ERROR", message);
  process.exit(code);
}

function getRunningAiasysPids() {
  const result = spawnSync("tasklist", ["/FI", "IMAGENAME eq AIASys.exe", "/FO", "CSV", "/NH"], {
    encoding: "utf-8",
    stdio: "pipe",
    windowsHide: true,
  });
  if (result.status !== 0 || !result.stdout) return [];

  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      // CSV: "AIASys.exe","12345","Console","1","123,456 K"
      const match = line.match(/^"AIASys\.exe"\s*,\s*"(\d+)"/i);
      return match ? parseInt(match[1], 10) : null;
    })
    .filter((pid) => pid !== null);
}

function killAiasysProcesses() {
  const pids = getRunningAiasysPids();
  if (pids.length === 0) {
    log("INFO", "没有运行中的 AIASys 进程");
    return;
  }

  log("INFO", `发现运行中的 AIASys 进程: ${pids.join(", ")}，正在终止...`);
  const result = spawnSync("taskkill", ["/F", ...pids.flatMap((pid) => ["/PID", String(pid)])], {
    encoding: "utf-8",
    stdio: "pipe",
    windowsHide: true,
  });
  if (result.status !== 0) {
    log("WARN", `终止进程时出现问题: ${result.stderr || result.error || "未知错误"}`);
  } else {
    log("INFO", "已终止运行中的 AIASys 进程");
  }

  // 等待进程彻底退出
  for (let i = 0; i < 10; i++) {
    if (getRunningAiasysPids().length === 0) break;
    spawnSync("powershell", ["-Command", "Start-Sleep -Milliseconds 200"], { windowsHide: true });
  }
}

function extractZip(zipPath, targetDir) {
  log("INFO", `解压 ${zipPath} 到 ${targetDir}...`);
  fs.mkdirSync(targetDir, { recursive: true });

  // 通过临时 .ps1 文件执行 Expand-Archive，避免 -Command 参数传递的 shell 转义问题
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aiasys-install-"));
  const psScript = path.join(tmpDir, "extract.ps1");
  const scriptContent =
    `param([string]$ZipPath, [string]$DestPath)\n` +
    `Expand-Archive -Path $ZipPath -DestinationPath $DestPath -Force -ErrorAction Stop\n`;
  fs.writeFileSync(psScript, scriptContent, "utf-8");

  const result = spawnSync(
    "powershell",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", psScript, "-ZipPath", zipPath, "-DestPath", targetDir],
    { encoding: "utf-8", stdio: "pipe", windowsHide: true }
  );

  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // ignore cleanup error
  }

  if (result.status !== 0) {
    fail(`解压失败: ${result.stderr || result.error || "未知错误"}`);
  }
  log("INFO", "解压完成");
}

function createShortcuts(targetDir) {
  const exePath = path.join(targetDir, "AIASys.exe");
  if (!fs.existsSync(exePath)) {
    log("WARN", `未找到 ${exePath}，跳过创建快捷方式`);
    return;
  }

  const desktopPath = path.join(os.homedir(), "Desktop");
  const startMenuPath = path.join(
    os.homedir(),
    "AppData",
    "Roaming",
    "Microsoft",
    "Windows",
    "Start Menu",
    "Programs"
  );

  for (const dir of [desktopPath, startMenuPath]) {
    fs.mkdirSync(dir, { recursive: true });
    const shortcutPath = path.join(dir, "AIASys.lnk");
    const psCommand =
      "$WshShell = New-Object -ComObject WScript.Shell; " +
      `$Shortcut = $WshShell.CreateShortcut('${shortcutPath.replace(/'/g, "''")}'); ` +
      `$Shortcut.TargetPath = '${exePath.replace(/'/g, "''")}'; ` +
      `$Shortcut.WorkingDirectory = '${targetDir.replace(/'/g, "''")}'; ` +
      "$Shortcut.Save()";

    const result = spawnSync("powershell", ["-NoProfile", "-Command", psCommand], {
      encoding: "utf-8",
      stdio: "pipe",
      windowsHide: true,
    });
    if (result.status !== 0) {
      log("WARN", `创建快捷方式失败 ${shortcutPath}: ${result.stderr || result.error}`);
    } else {
      log("INFO", `已创建快捷方式: ${shortcutPath}`);
    }
  }
}

function verifyInstallation(targetDir) {
  const required = ["AIASys.exe", "resources", "resources/app.asar"];
  for (const rel of required) {
    const fullPath = path.join(targetDir, rel);
    if (!fs.existsSync(fullPath)) {
      fail(`安装验证失败: 缺少 ${fullPath}`);
    }
  }

  // 读取打包版本
  const packageJsonPath = path.join(targetDir, "resources", "app.asar");
  log("INFO", `安装验证通过: ${targetDir}`);
}

function main() {
  const args = process.argv.slice(2);
  if (args.length < 1) {
    console.log(`
用法: node scripts/install-windows.cjs <zipPath> [targetDir]

参数:
  zipPath     AIASys Windows 绿色版 zip 文件路径
  targetDir   安装目标目录（默认: C:\\Users\\<user>\\AppData\\Local\\Programs\\AIASys）

示例:
  node scripts/install-windows.cjs dist/AIASys-0.4.25-win.zip
  node scripts/install-windows.cjs dist/AIASys-0.4.25-win.zip "C:\\Program Files\\AIASys"
`);
    process.exit(0);
  }

  const zipPath = path.resolve(args[0]);
  const targetDir = args[1]
    ? path.resolve(args[1])
    : path.join(os.homedir(), "AppData", "Local", "Programs", "AIASys");

  log("INFO", `开始安装 AIASys`);
  log("INFO", `安装包: ${zipPath}`);
  log("INFO", `目标目录: ${targetDir}`);

  if (!fs.existsSync(zipPath)) {
    fail(`安装包不存在: ${zipPath}`);
  }

  killAiasysProcesses();

  // 备份旧版本
  if (fs.existsSync(targetDir)) {
    const backupDir = `${targetDir}.bak.${Date.now()}`;
    try {
      fs.renameSync(targetDir, backupDir);
      log("INFO", `已备份旧版本到: ${backupDir}`);
    } catch (err) {
      fail(`备份旧版本失败: ${err.message}。可能是目录被占用，请关闭 AIASys 后重试。`);
    }
  }

  // 解压新版本
  extractZip(zipPath, targetDir);

  // 创建快捷方式
  createShortcuts(targetDir);

  // 验证
  verifyInstallation(targetDir);

  log("INFO", "AIASys 安装/升级完成");
  log("INFO", `可以通过以下方式启动:`);
  log("INFO", `  - 双击桌面快捷方式 "AIASys"`);
  log("INFO", `  - 运行: ${path.join(targetDir, "AIASys.exe")}`);
}

main();
