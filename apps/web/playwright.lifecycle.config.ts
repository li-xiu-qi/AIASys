import { defineConfig } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..");
// baseURL 必须写 127.0.0.1，不能写 localhost。2026-08-11 实测：
//   http://127.0.0.1:13000/ -> 200
//   http://[::1]:13000/     -> 连接被拒
// 因为 dev 脚本用 `vite --host 0.0.0.0`，而 0.0.0.0 是 IPv4 通配，**不绑 IPv6**
// （netstat 只有一条 0.0.0.0:13000）。Windows 上 localhost 同时解析到 ::1 和
// 127.0.0.1 且 ::1 通常在前，curl 会自己回退到 IPv4，但 playwright 的
// APIRequestContext 不保证回退，于是随机爆出：
//   apiRequestContext.get: connect ECONNREFUSED ::1:13000
// 全量跑一次实测有 24 条失败是这个原因造成的级联，与被测功能无关。
const baseURL = process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:13000";

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
  // 并行是实测决策，不是照搬默认值。2026-08-11 同一台 16 核机器上对比：
  //   workers=1（原配置）：61 用例 13.4 分钟
  //   workers=4 --fully-parallel：6.7 分钟
  // 失败集合比对（按测试标题，不按行号——行号会随编辑漂移）：并行只多出 2 条失败，
  // 都是 Ctrl+滚轮缩放、Ctrl+S 保存这类交互时序敏感的用例，不是数据隔离问题；
  // 没有任何一条因为「看见了别的用例的工作区」而失败。
  //
  // 为什么不给到 16：4 个 headless Chromium 加后端加 vite 已经在抢 CPU，
  // 再加只会放大上面那种时序抖动。CI 上给 2，因为 runner 通常只有 2 到 4 核。
  fullyParallel: true,
  workers: process.env.CI ? 2 : 4,
  // 交互时序类抖动用重试吸收，这是 playwright 官方 Best Practices 的做法。
  // 本地保持 0：本地要看到真实的红，不要被重试掩盖。
  retries: process.env.CI ? 1 : 0,
  // 从 120s 降到 60s：实测最慢的**通过**用例约 19 秒，60s 有三倍余量。
  // 而超时值直接决定失败的代价——并行下的总时长被最慢的那条失败用例托住，
  // 120s 时单条失败要烧 2 到 3 分钟，正是当前 6.7 分钟里的地板。
  timeout: 60_000,
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
    // retain-on-failure 的含义是「每条用例都录，通过了再删」——开销由 61 条全付，
    // 不是只有失败的那些付。官方 Best Practices 推荐的值是 on-first-retry：
    // 平时不记录，只有重试那一次才开，既省时间又保留了排查现场。
    // 截图很便宜（失败时才截一张），保留。
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "off",
    // 「复制绝对路径」这类用例要用 navigator.clipboard.readText() 核对复制结果，
    // 而 Chromium 默认拒绝读剪贴板，报 NotAllowedError: Read permission denied。
    // 这个错误会挡在断言之前，让人误以为是复制功能坏了——上一轮修那条用例的路径
    // 分隔符时就被它挡住，改对了也没验证到。
    permissions: ["clipboard-read", "clipboard-write"],
  },
  // 就绪门必须做成 setup project 而不是 globalSetup：webServer 只探测前端 13000，
  // 后端慢约 3 秒，冷启动时首个用例必然 ECONNREFUSED（2026-08-11 实测）。
  // 做成 project 依赖可保证它在 webServer 起来之后才执行，且失败信息明确指向就绪问题。
  projects: [
    {
      name: "readiness",
      testMatch: /readiness\.setup\.ts$/,
    },
    {
      name: "lifecycle",
      testIgnore: /readiness\.setup\.ts$/,
      dependencies: ["readiness"],
    },
  ],
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
