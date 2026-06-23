#!/usr/bin/env bash

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
FRONTEND_PORT="${AIASYS_FRONTEND_PORT:-13000}"
BACKEND_PORT="${AIASYS_BACKEND_PORT:-13001}"
BACKEND_URL="http://127.0.0.1:${BACKEND_PORT}"
FRONTEND_URL="http://127.0.0.1:${FRONTEND_PORT}"

command_name="${1:-start}"
if [[ "$#" -gt 0 ]]; then
  shift
fi

print_usage() {
  cat <<EOF
Usage:
  ./dev.sh setup          一键安装依赖并准备开发环境（AI Agent 可用）
  ./dev.sh                启动前后端开发服务
  ./dev.sh start          启动前后端开发服务
  ./dev.sh status         查看前后端端口与健康状态
  ./dev.sh design-lint    校验根目录 DESIGN.md
  ./dev.sh design-export-css [output]
                          从 DESIGN.md 生成 Tailwind 4 CSS 变量草案
  ./dev.sh design-export-runtime
                          生成当前运行时变量候选主题和映射说明
  ./dev.sh setup-hooks    启用仓库内置 Git hooks
EOF
}

check_url_ready() {
  local url="$1"
  curl -fsS "$url" >/dev/null 2>&1
}

# 端口探测：返回 0 表示空闲，1 表示被占用
probe_port() {
  local host="$1" port="$2"
  local nc_rc=0 py_rc=0

  if command -v nc >/dev/null 2>&1; then
    if nc -z "$host" "$port" 2>/dev/null; then
      return 1  # 端口可达 = 被占用
    else
      return 0  # 端口不可达 = 空闲
    fi
  elif command -v python3 >/dev/null 2>&1; then
    python3 -c "
import socket
s = socket.socket()
s.settimeout(1)
try:
    s.connect(('$host', $port))
    s.close()
except:
    exit(1)
" 2>/dev/null
    py_rc=$?
    if [[ $py_rc -eq 0 ]]; then
      return 1  # 端口可达 = 被占用
    else
      return 0  # 端口不可达 = 空闲
    fi
  else
    return 1
  fi
}

# 查找可用端口
find_available_port() {
  local host="$1" start="$2" max="${3:-200}"
  for ((p = start; p < start + max; p++)); do
    if probe_port "$host" "$p"; then
      echo "$p"
      return 0
    fi
  done
  return 1
}

status_command() {
  local frontend_status="down"
  local backend_status="down"

  if check_url_ready "${FRONTEND_URL}/"; then
    frontend_status="up"
  fi

  if check_url_ready "${BACKEND_URL}/health"; then
    backend_status="up"
  fi

  echo "frontend ${FRONTEND_URL}: ${frontend_status}"
  echo "backend  ${BACKEND_URL}: ${backend_status}"

  if [[ "${frontend_status}" == "up" && "${backend_status}" == "up" ]]; then
    return 0
  fi

  return 1
}

start_backend() {
  (
    cd "${PROJECT_ROOT}/apps/backend"
    exec .venv/bin/uvicorn app.main:app --host 0.0.0.0 --port "${BACKEND_PORT}"
  ) &
  BACKEND_PID=$!
}

start_frontend() {
  (
    cd "${PROJECT_ROOT}/apps/web"
    export VITE_API_TARGET="${BACKEND_URL}"
    exec npm run dev -- --host 0.0.0.0 --port "${FRONTEND_PORT}"
  ) &
  FRONTEND_PID=$!
}

cleanup_children() {
  local exit_code=$?

  if [[ -n "${FRONTEND_PID:-}" ]]; then
    kill "${FRONTEND_PID}" >/dev/null 2>&1 || true
  fi
  if [[ -n "${BACKEND_PID:-}" ]]; then
    kill "${BACKEND_PID}" >/dev/null 2>&1 || true
  fi

  wait "${FRONTEND_PID:-}" >/dev/null 2>&1 || true
  wait "${BACKEND_PID:-}" >/dev/null 2>&1 || true

  exit "${exit_code}"
}

# ============================================
# setup 命令：一键安装依赖、准备开发环境
# 设计为 AI Agent 友好：幂等、可重入、逐步骤报告
# ============================================

# 检查命令是否存在
have_cmd() { command -v "$1" >/dev/null 2>&1; }

# 获取 Python 主版本号
python_major_version() {
  "$1" -c "import sys; print(sys.version_info.major)" 2>/dev/null || echo "0"
}

# 获取 Node.js 主版本号
node_major_version() {
  node -e "console.log(process.versions.node.split('.')[0])" 2>/dev/null || echo "0"
}

# 安装 uv（跨平台）
install_uv() {
  echo "  ↳ 正在安装 uv..."
  if [[ "$(uname -s)" == "Linux" || "$(uname -s)" == "Darwin" ]]; then
    curl -LsSf https://astral.sh/uv/install.sh | sh >/dev/null 2>&1
  elif [[ "$(uname -s)" == MINGW* || "$(uname -s)" == MSYS* ]]; then
    powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex" >/dev/null 2>&1
  else
    echo "  ✗ 无法自动安装 uv，请手动安装: https://astral.sh/uv/"
    return 1
  fi
  # 刷新 PATH（uv 安装脚本可能已更新 shell profile，但当前进程需要手动加）
  export PATH="$HOME/.cargo/bin:$HOME/.local/bin:$PATH"
  if have_cmd uv; then
    echo "  ✓ uv 安装成功: $(uv --version 2>/dev/null || echo 'ok')"
  else
    echo "  ✗ uv 安装后仍不可用，请重新打开终端或手动添加 ~/.cargo/bin 到 PATH"
    return 1
  fi
}

setup_command() {
  local all_ok=true
  local need_start=false

  echo ""
  echo "══════════════════════════════════════════════"
  echo "  AIASys 开发环境一键安装"
  echo "══════════════════════════════════════════════"
  echo ""

  # Step 1: Python
  echo "◆ Step 1/5: 检查 Python 3.12+"
  local python_bin=""
  if have_cmd python3.12; then
    python_bin="python3.12"
  elif have_cmd python3; then
    local ver
    ver=$(python_major_version python3)
    if [[ "$ver" -ge 12 ]]; then
      python_bin="python3"
    fi
  fi
  if [[ -z "$python_bin" ]]; then
    echo "  ✗ 未找到 Python 3.12+"
    echo "    请安装 Python 3.12+: https://www.python.org/downloads/"
    echo "    或使用 uv: uv python install 3.12"
    all_ok=false
  else
    echo "  ✓ $python_bin ($($python_bin --version 2>&1))"
  fi
  echo ""

  # Step 2: uv
  echo "◆ Step 2/5: 检查 uv"
  if ! have_cmd uv; then
    echo "  ✗ 未找到 uv"
    if ! install_uv; then
      all_ok=false
    fi
  else
    echo "  ✓ uv $(uv --version 2>/dev/null || echo 'ok')"
  fi
  echo ""

  # Step 3: Node.js
  echo "◆ Step 3/5: 检查 Node.js 22+"
  if ! have_cmd node; then
    echo "  ✗ 未找到 Node.js"
    echo "    请安装 Node.js 22+: https://nodejs.org/"
    all_ok=false
  else
    local node_ver
    node_ver=$(node_major_version)
    if [[ "$node_ver" -ge 22 ]]; then
      echo "  ✓ Node.js v$(node --version)"
    else
      echo "  ✗ Node.js version $(node --version) (< 22), 请升级"
      all_ok=false
    fi
  fi
  echo ""

  # Step 4: 后端依赖
  echo "◆ Step 4/5: 安装后端依赖 (uv sync)"
  if [[ -f "${PROJECT_ROOT}/apps/backend/pyproject.toml" ]]; then
    # 幂等：uv sync 检测已有环境时仅验证，不重复安装
    if (cd "${PROJECT_ROOT}/apps/backend" && uv sync); then
      echo "  ✓ 后端依赖就绪"
    else
      echo "  ✗ 后端依赖安装失败"
      all_ok=false
    fi
  else
    echo "  ✗ 未找到 apps/backend/pyproject.toml，请确认仓库完整"
    all_ok=false
  fi
  echo ""

  # Step 5: 前端依赖
  echo "◆ Step 5/5: 安装前端依赖 (npm ci)"
  if [[ -f "${PROJECT_ROOT}/apps/web/package-lock.json" ]]; then
    if (cd "${PROJECT_ROOT}/apps/web" && npm ci); then
      echo "  ✓ 前端依赖就绪"
    else
      echo "  ✗ 前端依赖安装失败"
      all_ok=false
    fi
  else
    echo "  ✗ 未找到 apps/web/package-lock.json，请确认仓库完整"
    all_ok=false
  fi
  echo ""

  # 创建 config.toml（如果不存在）
  if [[ -f "${PROJECT_ROOT}/apps/backend/config.toml" ]]; then
    echo "  ✓ config.toml 已存在，跳过创建"
  elif [[ -f "${PROJECT_ROOT}/apps/backend/config.example.toml" ]]; then
    cp "${PROJECT_ROOT}/apps/backend/config.example.toml" "${PROJECT_ROOT}/apps/backend/config.toml"
    echo "  ✓ 已从 config.example.toml 创建 config.toml"
    echo "  ⚠ 请编辑 apps/backend/config.toml 填入你的 API Key"
  fi
  echo ""

  # 输出结果
  echo "══════════════════════════════════════════════"
  if $all_ok; then
    echo "  ✓ 开发环境安装完成！"
    echo ""
    echo "  下一步:"
    echo "    1. 编辑 apps/backend/config.toml 填入模型 API Key"
    echo "    2. 运行 ./dev.sh 启动开发服务"
    echo "    3. 打开 http://localhost:13000/workspace"
    echo ""
    echo "  或在界面中配置模型:"
    echo "    左侧边栏 → 工作区工具 → 模型配置"
  else
    echo "  ✗ 部分依赖安装失败，请根据上面的提示修复后重试"
    echo "  ./dev.sh setup 可重复执行，已安装的依赖不会重复安装"
  fi
  echo "══════════════════════════════════════════════"
  echo ""

  $all_ok || exit 1
}

case "${command_name}" in
  setup)
    setup_command
    ;;
  start)
    trap cleanup_children EXIT INT TERM

    # 检查后端端口
    BACKEND_LOCKED=false
    if [[ -n "${AIASYS_BACKEND_PORT:-}" ]]; then
      BACKEND_LOCKED=true
    fi
    if ! probe_port "127.0.0.1" "${BACKEND_PORT}"; then
      if ${BACKEND_LOCKED}; then
        echo "❌ 后端端口 ${BACKEND_PORT} 已被占用，且 AIASYS_BACKEND_PORT 已锁定" >&2
        exit 1
      fi
      NEW_BACKEND_PORT=$(find_available_port "127.0.0.1" "$((BACKEND_PORT + 1))")
      if [[ -z "${NEW_BACKEND_PORT}" ]]; then
        echo "❌ 无法为后端找到可用端口（起始: ${BACKEND_PORT}）" >&2
        exit 1
      fi
      echo "⚠ 后端端口 ${BACKEND_PORT} 被占用，自动切换到 ${NEW_BACKEND_PORT}"
      BACKEND_PORT="${NEW_BACKEND_PORT}"
      BACKEND_URL="http://127.0.0.1:${BACKEND_PORT}"
    fi

    # 检查前端端口
    FRONTEND_LOCKED=false
    if [[ -n "${AIASYS_FRONTEND_PORT:-}" ]]; then
      FRONTEND_LOCKED=true
    fi
    if ! probe_port "127.0.0.1" "${FRONTEND_PORT}"; then
      if ${FRONTEND_LOCKED}; then
        echo "❌ 前端端口 ${FRONTEND_PORT} 已被占用，且 AIASYS_FRONTEND_PORT 已锁定" >&2
        exit 1
      fi
      NEW_FRONTEND_PORT=$(find_available_port "127.0.0.1" "$((FRONTEND_PORT + 1))")
      if [[ -z "${NEW_FRONTEND_PORT}" ]]; then
        echo "❌ 无法为前端找到可用端口（起始: ${FRONTEND_PORT}）" >&2
        exit 1
      fi
      echo "⚠ 前端端口 ${FRONTEND_PORT} 被占用，自动切换到 ${NEW_FRONTEND_PORT}"
      FRONTEND_PORT="${NEW_FRONTEND_PORT}"
      FRONTEND_URL="http://127.0.0.1:${FRONTEND_PORT}"
    fi

    start_backend
    start_frontend
    # Wait for any background job to finish (bash 3.2 compatible alternative to wait -n)
    while true; do
      for pid in $(jobs -p); do
        if ! kill -0 "$pid" 2>/dev/null; then
          break 2
        fi
      done
      sleep 0.5
    done
    ;;
  status)
    status_command
    ;;
  design-lint)
    exec "${PROJECT_ROOT}/scripts/design/validate-design-md.sh" "$@"
    ;;
  design-export-css)
    exec node "${PROJECT_ROOT}/scripts/design/export-tailwind4-css.mjs" "$@"
    ;;
  design-export-runtime)
    exec node "${PROJECT_ROOT}/scripts/design/export-runtime-theme-candidate.mjs" "$@"
    ;;
  setup-hooks)
    exec "${PROJECT_ROOT}/scripts/dev/setup-hooks.sh"
    ;;
  help|-h|--help)
    print_usage
    ;;
  *)
    echo "Unknown command: ${command_name}" >&2
    print_usage >&2
    exit 1
    ;;
esac
