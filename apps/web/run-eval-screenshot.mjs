import { spawn } from "child_process";
import { chromium } from "playwright";
import { readFileSync, readdirSync, statSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __filename = fileURLToPath(import.meta.url);
const ROOT = resolve(dirname(__filename), "..", "..");
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
      const res = await fetch(url, { method: "GET" });
      // 任何 HTTP 响应（包括 405）都说明服务已启动
      if (res.status && res.status < 500) return true;
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

async function getLatestWorkspaceAndSession() {
  const workspacesDir = resolve(ROOT, "apps/backend/data/workspaces/local_default");
  try {
    const entries = readdirSync(workspacesDir).filter((name) => {
      const wsPath = resolve(workspacesDir, name);
      const wsJson = resolve(wsPath, ".aiasys/workspace/workspace.json");
      try {
        const st = statSync(wsJson);
        return st.isFile();
      } catch {
        return false;
      }
    });
    if (!entries.length) return null;
    // 按 workspace.json 修改时间取最新
    const sorted = entries
      .map((id) => {
        const wsJson = resolve(workspacesDir, id, ".aiasys/workspace/workspace.json");
        const mtime = statSync(wsJson).mtimeMs;
        return { id, mtime };
      })
      .sort((a, b) => b.mtime - a.mtime);
    const workspaceId = sorted[0].id;
    const sessionJson = resolve(workspacesDir, workspaceId, ".aiasys/session/_active/context.jsonl");
    let sessionId = null;
    try {
      const lines = readFileSync(sessionJson, "utf-8").trim().split("\n").filter(Boolean);
      // 取第一行中的 session_id
      const first = lines[0] || "";
      const m = first.match(/"session_id"\s*:\s*"([a-f0-9]+)"/);
      if (m) sessionId = m[1];
    } catch {}
    if (!sessionId) {
      // fallback 用 workspace.json 里的 current_conversation_id
      try {
        const ws = JSON.parse(readFileSync(resolve(workspacesDir, workspaceId, ".aiasys/workspace/workspace.json"), "utf-8"));
        sessionId = ws.current_conversation_id;
      } catch {}
    }
    return { workspaceId, sessionId };
  } catch (e) {
    log("getLatestWorkspaceAndSession error:", e.message);
    return null;
  }
}

async function cleanupPorts() {
  try {
    await new Promise((r) => {
      const p = spawn("pkill", ["-f", "vite --port 13000"], { stdio: "ignore" });
      p.on("close", r);
      setTimeout(r, 1000);
    });
  } catch {}
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

  await cleanupPorts();

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
    const runCaseScript = resolve(EVAL_ROOT, "l2-user-scenario-tests/scripts/run_case.py");
    const caseCwd = resolve(EVAL_ROOT, "l2-user-scenario-tests/scripts");
    log(`case runner: python3 ${runCaseScript} ${caseDir} "${caseTitle}" cwd=${caseCwd}`);

    let caseStdout = "";
    let caseStderr = "";
    let caseCode = null;
    let caseTimedOut = false;

    const caseResult = await new Promise((resolve) => {
      const child = spawnProcess(
        "python3",
        [runCaseScript, caseDir, caseTitle],
        {
          cwd: caseCwd,
          env: cleanEnv,
          label: "case",
        }
      );
      child.stdout.on("data", (d) => {
        caseStdout += d.toString();
      });
      child.stderr.on("data", (d) => {
        caseStderr += d.toString();
      });
      child.on("close", (code) => {
        caseCode = code;
        resolve({ code, timedOut: false });
      });
      const timeout = setTimeout(() => {
        caseTimedOut = true;
        child.kill("SIGTERM");
        resolve({ code: null, timedOut: true });
      }, 240000); // 240s 后强制结束 case，留 50s 截图
    });

    log("case stdout length:", caseStdout.length);
    log("case stderr length:", caseStderr.length);
    log("case exit code:", caseCode);
    if (caseResult.timedOut) {
      log("[WARN] Case runner timed out, will try to screenshot partial results");
    } else {
      log(`Case runner exited with code ${caseCode}`);
    }

    let workspaceId = null;
    let sessionId = null;
    const wsMatch = caseStdout.match(/workspace_id:\s*([a-f0-9-]+)/);
    const ssMatch = caseStdout.match(/session_id:\s*([a-f0-9-]+)/);
    if (wsMatch && ssMatch) {
      workspaceId = wsMatch[1];
      sessionId = ssMatch[1];
    } else {
      // 超时 case 未打印 id，从后端数据目录最新工作区推断
      const latest = await getLatestWorkspaceAndSession();
      if (latest) {
        workspaceId = latest.workspaceId;
        sessionId = latest.sessionId;
        log(`[WARN] Case output missing ids, falling back to latest workspace/session: ${workspaceId}/${sessionId}`);
      }
    }
    if (!workspaceId || !sessionId) {
      throw new Error("无法从 case 输出或后端数据中解析 workspace_id/session_id");
    }
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
