import { defineConfig } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..");
const baseURL = process.env.PLAYWRIGHT_BASE_URL || "http://localhost:13000";

// Windows 上 playwright 通过 cmd.exe spawn webServer，而 cmd 既不认 shell 脚本也不
// 认 ./ 前缀，实测直接失败：
//
//   [WebServer] '.' is not recognized as an internal or external command
//   Error: Process from config.webServer was not able to start. Exit code: 1
//
// 这是 lifecycle e2e 在 Windows 上从未运行过的第二道障碍（第一道是 cli.sh 写死
// .venv/bin/uvicorn 与端口探测误判，已在 2026-08-10 修掉）。主力开发在 Windows，
// 于是这 30 个测试长期只能靠人工点界面代替。
//
// 显式走 bash。留一个已知风险在这里：Windows 的 `where bash` 实测返回两条——
//   C:\Program Files\Git\usr\bin\bash.exe   （Git Bash，本机排在前）
//   C:\Windows\System32\bash.exe            （WSL 入口）
// 命中哪个取决于 PATH 顺序。若解析到 WSL 的那个，脚本会在 WSL 文件系统语义下执行
// （项目路径变成 /mnt/c/...），表现为一连串诡异失败而非明确报错。真遇到时判别方法
// 是在 dev.sh 里 echo "$(uname -r)"：含 microsoft 即为 WSL。
const devServerCommand =
  process.platform === "win32" ? "bash ./dev.sh" : "./dev.sh";

export default defineConfig({
  testDir: "./e2e/lifecycle",
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  expect: {
    timeout: 15_000,
  },
  outputDir: "./test-results/lifecycle",
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: "./playwright-report/lifecycle" }],
  ],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  webServer: {
    command: devServerCommand,
    cwd: repoRoot,
    url: baseURL,
    reuseExistingServer: true,
    timeout: 240_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
