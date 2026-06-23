/**
 * WSL → Windows 同步辅助脚本（git 版本）。
 *
 * 将 WSL 源码通过 bare git repo 同步到 Windows 构建目录。
 * 基于 git fetch + reset，天然支持增量、统计变更、排除项由 .gitignore 控制。
 *
 * 用法：
 *   node scripts/wsl-sync.cjs [--force]
 *
 * 选项：
 *   --force   强制 reset --hard，丢弃本地未提交改动
 *
 * 前置条件：
 *   - WSL 侧已创建 bare repo：C:/Users/ke/projects/AIASys-bare.git
 *   - WSL 侧 main 分支已 push 到 bare repo
 *   - Windows 构建目录已 clone 自 bare repo
 */

const { spawnSync } = require("child_process");
const path = require("path");
const fs = require("fs");

const BARE_REPO = "C:/Users/ke/projects/AIASys-bare.git";
const WIN_BUILD = "C:/Users/ke/projects/AIASys-windows-build";

function runGit(args, cwd) {
  const result = spawnSync("git", args, { cwd, encoding: "utf-8", stdio: "pipe" });
  if (result.error) {
    return { stdout: "", stderr: result.error.message, status: result.status };
  }
  return { stdout: result.stdout.trim(), stderr: result.stderr.trim(), status: result.status };
}

function printChangeSummary() {
  const status = runGit(["status", "--short"], WIN_BUILD);
  if (status.status !== 0 || !status.stdout) {
    return;
  }
  const lines = status.stdout.split("\n").filter(Boolean);
  const added = lines.filter((l) => l.startsWith("A ") || l.startsWith("??")).length;
  const modified = lines.filter((l) => l.startsWith(" M") || l.startsWith("M ")).length;
  const deleted = lines.filter((l) => l.startsWith("D ") || l.startsWith(" R")).length;
  console.log(`[wsl-sync] 变更统计: +${added} 新增, ~${modified} 修改, -${deleted} 删除`);

  const diffStat = runGit(["diff", "--stat", "HEAD"], WIN_BUILD);
  if (diffStat.status === 0 && diffStat.stdout) {
    console.log(`[wsl-sync] 变更详情:`);

    // 解析 diff stat，统计总行数
    let totalLines = 0;
    const fileLines = [];
    diffStat.stdout.split("\n").forEach((line) => {
      if (!line.trim()) return;
      console.log(`[wsl-sync]   ${line}`);
      const match = line.match(/^[\s\d]+\|\s+(\d+)/);
      if (match) {
        totalLines += parseInt(match[1], 10);
        fileLines.push(line);
      }
    });
    console.log(`[wsl-sync] 共变更 ${fileLines.length} 个文件，${totalLines} 行`);
  }
}

function sync() {
  const force = process.argv.includes("--force");

  if (!fs.existsSync(WIN_BUILD)) {
    console.log(`[wsl-sync] Windows 构建目录不存在，执行 git clone...`);
    const cloneResult = runGit(["clone", BARE_REPO, WIN_BUILD]);
    if (cloneResult.status !== 0) {
      console.error(`[wsl-sync] git clone 失败: ${cloneResult.stderr}`);
      process.exit(1);
    }
    console.log(`[wsl-sync] clone 完成: ${WIN_BUILD}`);
    return;
  }

  console.log(`[wsl-sync] 从 bare repo 同步到 Windows 构建目录...`);

  // 1. fetch 最新变更
  const fetchResult = runGit(["fetch", "origin"], WIN_BUILD);
  if (fetchResult.status !== 0) {
    console.error(`[wsl-sync] git fetch 失败: ${fetchResult.stderr}`);
    process.exit(1);
  }

  // 2. 查看当前 HEAD 与远程的差异
  const localHead = runGit(["rev-parse", "HEAD"], WIN_BUILD);
  const remoteHead = runGit(["rev-parse", "origin/main"], WIN_BUILD);

  if (localHead.status !== 0 || remoteHead.status !== 0) {
    console.error(`[wsl-sync] 获取 commit 失败`);
    process.exit(1);
  }

  if (localHead.stdout === remoteHead.stdout && !force) {
    console.log(`[wsl-sync] 已是最新，无需同步 (${localHead.stdout.slice(0, 8)})`);
    return;
  }

  // 3. reset --hard
  const resetArgs = force
    ? ["reset", "--hard", "origin/main"]
    : ["reset", "--hard", "origin/main"];

  const resetResult = runGit(resetArgs, WIN_BUILD);
  if (resetResult.status !== 0) {
    console.error(`[wsl-sync] git reset --hard 失败: ${resetResult.stderr}`);
    process.exit(1);
  }

  console.log(`[wsl-sync] 同步完成: ${localHead.stdout.slice(0, 8)} -> ${remoteHead.stdout.slice(0, 8)}`);

  // 4. 打印变更统计
  printChangeSummary();
}

sync();
