import { spawn } from "child_process";
import { chromium } from "playwright";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __filename = fileURLToPath(import.meta.url);
const ROOT = resolve(dirname(__filename), "..");
const EVAL_ROOT = resolve(ROOT, "..", "AIASys-eval");

const BACKEND_URL = "http://127.0.0.1:13001";
const FRONTEND_URL = "http://127.0.0.1:13000";

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function log(...args) {
  console.log("[orchestrator]", ...args);
}

function getApiKey() {
  const configPath = resolve(EVAL_ROOT, "l2-user-scenario-tests/scripts/config.py");
  const text = readFileSync(configPath, "utf-8");
  const envMatch = text.match(/STEPFUN_API_KEY\s*=\s*os\.environ\.get\(\s*"([^"]+)"/);
  if (envMatch && process.env[envMatch[1]]) {
    return process.env[envMatch[1]];
  }
  const fallbackMatch = text.match(/"[^"]+"\s*,?\s*\)\s*$/m);
  if (fallbackMatch) {
    const key = fallbackMatch[0].replace(/[",)\s]/g, "");
    if (key && !key.startsWith("your-")) return key;
  }
  throw new Error("无法从 config.py 读取 STEPFUN_API_KEY");
}

async function waitForUrl(url, maxMs = 25000) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    try {
      const res = await fetch(url, { method: "HEAD" });
      if (res.ok || res.status === 200 || res.status === 304) return true;
    } catch {}
    await wait(500);
  }
  return false;
}

function spawnProcess(cmd, args, opts) {
  const child = spawn(cmd, args, {
    stdio: ["ignore", "pipe", "pipe"],
    detached: false,
    ...opts,
  });
  child.stdout.on("data", (d) => {
    const line = d.toString().trim();
    if (line) console.log(`[${opts.label}]`, line.slice(0, 200));
  });
  child.stderr.on("data", (d) => {
    const line = d.toString().trim();
    if (line) console.log(`[${opts.label} err]`, line.slice(0, 200));
  });
  return child;
}

async function main() {
  const caseDirArg = process.argv[2];
  const caseTitle = process.argv[3] || caseDirArg;
  if (!caseDirArg) {
    console.error("用法: node run-eval-screenshot.mjs <case_dir_name> [title]");
    process.exit(1);
  }

  const caseDir = resolve(EVAL_ROOT, "l2-user-scenario-tests/cases", caseDirArg);
  if (!caseDir.match(/demo-\d+/)) {
    console.error("case 目录名应以 demo-XXX 开头");
    process.exit(1);
  }

  const apiKey = getApiKey();
  log("API key loaded, length:", apiKey.length);

  const cleanEnv = {
    ...process.env,
    AIASYS_LLM_PROVIDER_STEPFUN_API_KEY: apiKey,
    ALL_PROXY: "",
    HTTP_PROXY: "",
    HTTPS_PROXY: "",
    http_proxy: "",
    https_proxy: "",
    all_proxy: "",
    NO_PROXY: "127.0.0.1,localhost,::1",
  };

  let backend, frontend, browser, context, page;

  try {
    log("Starting backend...");
    backend = spawnProcess(
      resolve(ROOT, "apps/backend/.venv/bin/uvicorn"),
      ["app.main:app", "--host", "0.0.0.0", "--port", "13001"],
      { cwd: resolve(ROOT, "apps/backend"), env: cleanEnv, label: "backend" }
    );
    if (!(await waitForUrl(`${BACKEND_URL}/health`))) {
      throw new Error("Backend did not become ready");
    }
    log("Backend ready");

    log("Starting frontend...");
    frontend = spawnProcess("npx", ["vite", "--port", "13000", "--host", "0.0.0.0"], {
      cwd: resolve(ROOT, "apps/web"),
      env: { ...cleanEnv, VITE_API_TARGET: BACKEND_URL },
      label: "frontend",
    });
    if (!(await waitForUrl(`${FRONTEND_URL}/`))) {
      throw new Error("Frontend did not become ready");
    }
    log("Frontend ready");

    log(`Running L2 case: ${caseDirArg}`);
    const caseResult = await new Promise((resolve, reject) => {
      const child = spawnProcess(
        "python3",
        ["run_case.py", caseDir, caseTitle],
        {
          cwd: resolve(EVAL_ROOT, "l2-user-scenario-tests/scripts"),
          env: cleanEnv,
          label: "case",
        }
      );
      let stdout = "";
      child.stdout.on("data", (d) => {
        stdout += d.toString();
      });
      child.on("close", (code) => {
        resolve({ code, stdout });
      });
      child.on("error", reject);
      // 全局超时 260s，给截图留 30s
      setTimeout(() => {
        child.kill("SIGTERM");
        reject(new Error("Case runner timeout (260s)"));
      }, 260000);
    });

    log(`Case runner exited with code ${caseResult.code}`);

    const wsMatch = caseResult.stdout.match(/workspace_id:\s*([a-f0-9-]+)/);
    const ssMatch = caseResult.stdout.match(/session_id:\s*([a-f0-9-]+)/);
    if (!wsMatch || !ssMatch) {
      throw new Error("无法从 case 输出中解析 workspace_id/session_id");
    }
    const workspaceId = wsMatch[1];
    const sessionId = ssMatch[1];
    log(`Workspace: ${workspaceId}, Session: ${sessionId}`);

    log("Taking screenshots...");
    browser = await chromium.launch({
      headless: true,
      args: ["--single-process", "--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
    });
    context = await browser.newContext({
      viewport: { width: 1600, height: 1000 },
      deviceScaleFactor: 2,
    });
    page = await context.newPage();

    async function screenshot(name, urlPath, waitMs = 5000) {
      const url = `${FRONTEND_URL}${urlPath}`;
      log(`Screenshot: ${name}`);
      try {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
      } catch (e) {
        log("goto warning:", e.message.slice(0, 80));
      }
      await wait(waitMs);
      const fileName = `demo-${caseDirArg.replace(/^demo-/, "")}-${name}.png`;
      const path = resolve(ROOT, "images/readme", fileName);
      await page.screenshot({ path, type: "png", timeout: 15000 });
      log(`Saved: ${path}`);
      return fileName;
    }

    const files = [];
    files.push(await screenshot("overview", `/workspace?workspace_id=${workspaceId}&session_id=${sessionId}`, 6000));

    // 根据 case 类型截图特定 overlay
    if (caseDirArg.includes("notebook")) {
      files.push(await screenshot("notebook", `/workspace?workspace_id=${workspaceId}&session_id=${sessionId}`, 4000));
    }
    if (caseDirArg.includes("autotask")) {
      files.push(await screenshot("autotask", `/workspace?workspace_id=${workspaceId}&session_id=${sessionId}`, 4000));
    }
    if (caseDirArg.includes("subagent")) {
      files.push(await screenshot("subagent", `/workspace?workspace_id=${workspaceId}&session_id=${sessionId}`, 4000));
    }
    if (caseDirArg.includes("knowledge-base")) {
      files.push(await screenshot("kb", `/workspace?workspace_id=${workspaceId}&overlay=knowledge_base`, 5000));
    }

    log("Screenshots done:", files.join(", "));
  } catch (e) {
    log("ERROR:", e.message);
    console.error(e);
    process.exitCode = 1;
  } finally {
    if (page) await page.close().catch(() => {});
    if (context) await context.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
    if (frontend) {
      frontend.kill("SIGTERM");
      await wait(500);
      if (!frontend.killed) frontend.kill("SIGKILL");
    }
    if (backend) {
      backend.kill("SIGTERM");
      await wait(500);
      if (!backend.killed) backend.kill("SIGKILL");
    }
  }
  log("Done");
  process.exit(process.exitCode || 0);
}

main();
