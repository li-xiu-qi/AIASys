# Windows 跨平台 Shell 与进程管理策略

本文档汇总 AIASys 在 Windows 上的 Shell 解释器选型、编码处理、长路径处理、PTY/进程树终止、子 Agent 工具继承五个方面的设计决策，作为后续代码审查和新人上手的单一真相源。相关代码集中在 `apps/backend/app/services/shell_executor.py`、`app/core/encoding_utils.py`、`app/utils/path_utils.py`、`app/services/terminal/pty_manager.py`、`app/services/agent/runtime_backends/acp_client/session.py`、`app/services/agent/runtime_backends/aiasys/backend.py`。

## 1. 背景与参考

AIASys 的 Agent 工具（Shell、Python 运行时、终端会话）需要三端可用，但 Windows 的 Shell 生态和 POSIX 差异极大。立项前对照了三家同类产品的经验：

- **Hermes Agent**：POSIX-first 路线。早期直接用 `sh -c` 拼 POSIX 命令，在 Windows 上没有原生 sh 时退化成 cmd 兼容层，引号解析和参数传递频繁出错。结论是 POSIX-first 在 Windows 上不可持续，必须有显式的解释器探测和降级链，不能假设某个 Shell 一定存在。
- **Claude Code**：把终端层外包给 ConPTY（Windows 伪控制台）。它不自己在 Python 里实现 PTY，而是通过 ConPTY 拿到真实的终端行为，再在外面做命令完成检测和退出码捕获。代价是强依赖 Win10 1809+ 的 ConPTY，低版本系统跑不起来。可借鉴的点：终端会话应该用系统原生的 PTY 能力，而不是手搓伪终端。
- **Codex CLI**：用 Rust 实现终端层。Rust 侧直接绑定 ConPTY / PTY 系统调用，编码和进程树管理在 native 层完成，Python 侧只做编排。结论是终端层用 native 实现更稳，但 AIASys 是 Python 底座，不具备 Rust 重写的条件，只能在 Python 侧尽量靠拢 native 行为（pywinpty + taskkill）。

三家共同点：都不依赖 cmd.exe 做命令执行，都用系统原生 PTY 能力，都对编码做了显式处理。AIASys 的策略和它们一致。

## 2. Shell 解释器选型决策

### 2.1 为什么禁用 cmd.exe

cmd.exe 在 Agent 命令执行场景下有三个硬伤：

1. **引号解析不可靠**：`cmd /c` 对双引号、反斜杠、空格的解析规则特殊，带路径的命令字符串经常被解析坏，典型报错是 `os error 123`（文件名、目录名或卷标语法不正确）。
2. **不支持 POSIX 命令参数**：cmd 的 `mkdir` 不支持 `-p`，`rm` 不存在，`cp`/`ls` 都没有。Agent 生成的命令大量是 POSIX 风格，cmd 直接报 `[WinError 267] 目录名称无效`。
3. **无法提供 shell integration**：命令完成检测、cwd 跟踪、退出码捕获在 cmd 里都不可靠，无法支撑 Agent 的执行流编排。

GitHub Copilot 在 CHANGELOG 中明确记录了同样的决策：禁用 Command Prompt，强制使用 Windows PowerShell，理由是 cmd 无法提供 shell integration。AIASys 对齐这个策略。

### 2.2 auto 优先级链

`interpreter=auto` 时按以下顺序探测，找到第一个即用：

```
Git Bash → WSL → busybox-w32 → PowerShell → (无 cmd 兜底，抛 RuntimeError)
```

- **Git Bash** 优先：提供完整 POSIX 环境，Agent 生成的 `mkdir -p`、`rm -rf`、管道、重定向都能直接跑。探测顺序是环境变量 `AIASYS_SHELL_PATH` 覆盖 → git.exe 推断 → Windows 注册表 `SOFTWARE\GitForWindows` → 固定候选路径。
- **WSL** 次之：`C:\Windows\System32\bash.exe` 是 WSL 启动器，会被识别为 wsl family 而非普通 bash，避免和 Git Bash 混淆。
- **busybox-w32**：轻量 POSIX 工具集，作为 Git Bash 不可用时的备选。
- **PowerShell** 是最低要求：Windows 10/11 默认预装，可用性足够。PowerShell 语法和 POSIX 不同，命令适配层会做转换。
- **不再有 cmd 兜底**：四个都找不到时抛 `RuntimeError`，提示用户安装 Git for Windows、WSL、busybox-w32 或确认 PowerShell 在 PATH 中。宁可失败也不退化到 cmd。

### 2.3 显式 cmd 降级到 PowerShell

对齐 Copilot 的更激进策略：即使用户显式传 `interpreter=cmd`，ShellExecutor 也不再真正调用 cmd.exe，而是自动降级到 PowerShell。理由是 cmd 的三个硬伤在显式调用场景同样存在，保留显式 cmd 入口只会让 Agent 踩坑。`cmd` 这个关键字保留为兼容输入，但内部映射到 PowerShell 解释器，并在日志中标记为降级。Windows 10/11 默认已预装 PowerShell，视为最低系统要求。

> 注：`interpreter=powershell` 仍可直接使用，`interpreter=bash`/`wsl`/`busybox` 仍走各自的探测逻辑。

## 3. smart_decode 编码降级链

Windows 子进程的 stdout/stderr 编码不固定：UTF-8、UTF-16LE（管道重定向时偶发，以 `FF FE` BOM 开头）、cp936/GBK（中文 Windows 默认）都可能遇到。硬编码 `.decode("utf-8")` 在 GBK 输出上直接 `UnicodeDecodeError`。

`app/core/encoding_utils.py` 的 `smart_decode()` 按以下顺序尝试，全程 `errors="replace"` 保证不抛异常：

```
UTF-8 → UTF-16LE (BOM) → locale.getpreferredencoding() → GBK
```

- 优先 UTF-8：绝大多数现代工具输出 UTF-8。
- UTF-16LE BOM 检测：Windows 管道重定向时偶发，以 `FF FE` 开头。
- 系统 locale 编码：`locale.getpreferredencoding(do_setlocale=False)`，Windows 上通常是 cp936；若本身就是 UTF-8 则跳过避免重复。
- GBK 最终兜底：中文 Windows 的最后防线。

**硬性约束**：所有 subprocess 输出解码必须走 `smart_decode()`，禁止 `proc.stdout.decode("utf-8")` 或任何硬编码编码。`shlex.quote` 在 Windows 上行为不对，命令拼接改用双引号或 `subprocess.list2cmdline`。

## 4. as_system_path 长路径处理

Windows 默认 MAX_PATH 限制 260 字符。AIASys 工作区路径嵌套深（`workspaces/{user_id}/{workspace_id}/.aiasys/session/{session_id}/...`），加上用户目录前缀很容易超限，导致 `FileNotFoundError` 或 `[WinError 3]`。

`app/utils/path_utils.py` 提供 `as_system_path()` 作为文件 IO 的统一入口：

- 非 Windows 平台原样返回。
- 已带 `\\?\` 或 `\\?\UNC\` 前缀的原样返回。
- 相对路径不加前缀（长路径前缀只支持绝对路径）。
- 先 `resolve()` 转反斜杠去尾斜杠，长度超过 240 字符才加 `\\?\` 前缀，避免污染常规路径。

配套 `atomic_write_text()` 也走 `as_system_path`，先写临时文件再 `os.replace` 原子替换。

**硬性约束**：所有涉及用户工作区路径的文件 IO 必须走 `as_system_path()`，而非直接用 `Path` 或原始字符串。涉及文件系统的 service 层（file_history、diff_service、memory 等）都已接入。

## 5. PTY / 进程树终止策略

Windows 没有进程组（process group）语义，`os.killpg` 不可用。子进程派生的孙进程不会被父进程终止连带杀掉，会变成孤儿进程。AIASys 在三个位置统一用 `taskkill /T /F` 终止进程树：

### 5.1 ShellExecutor 两阶段 taskkill

`shell_executor.py` 超时后的终止流程：

1. 第一阶段：`taskkill /T /PID {pid}`（不带 /F，给进程优雅退出的机会），等待 `SIGTERM_GRACE_SECONDS`（5 秒）。
2. 第二阶段：若第一阶段不生效，`taskkill /T /F /PID {pid}` 强制终止整个进程树。

`/T` 表示终止指定进程及其子进程（tree），`/F` 表示强制。POSIX 侧对应 `os.killpg(SIGTERM)` → grace → `os.killpg(SIGKILL)`。

### 5.2 PTY Manager close 前 taskkill

`pty_manager.py` 的 `PtySession.close()` 在 Windows 路径上：先 `taskkill /T /F /PID {pid}` 杀进程树，再调 `winpty_proc.close()` 关闭 PTY。顺序不能反，否则 winpty close 只终止 PTY 通道，子进程树会残留为孤儿。

**硬性约束**：PTY Manager 在 Windows 上 `close()` 前必须 taskkill 杀进程树。

### 5.3 ACP Client 用 taskkill

`acp_client/session.py` 的 `cancel()` 和 `close()` 在 Windows 上都用 `taskkill /T /F /PID {pid}`，POSIX 侧用 `proc.terminate()`。ACP Client 是 Agent 与外部 ACP 协议运行时通信的会话层，同样需要保证子进程树不残留。

## 6. SubAgent 工具继承机制

子 Agent 的工具集通过 `tool_policy` 字段控制，实现在 `runtime_backends/aiasys/backend.py` 的会话创建流程中：

- **inherit（默认）**：直接从 `spec.parent_registry` 复制工具实例。遍历父注册表的 OpenAI schema，对每个工具调 `parent_registry.get_tool(name)` 拿到已实例化的对象，注册到子 Agent 的 registry。继承模式下工具实例是共享引用，不重新实例化，保证配置和状态一致。
- **denylist**：和 inherit 走同一条复制路径，但额外按 `exclude_tools` 列表过滤。排除匹配支持 schema name、short name（去掉 `:` 和 `.` 前缀）、运行时 name、类名四种形式，避免命名路径不一致导致排除失效。
- **allowlist**：不走复制路径，改为从 manifest 实例化。遍历 `agent_manifest["tools"]` 声明的 tool_path，调 `_instantiate_tool()` 加载符号并构造实例。`_instantiate_tool` 会检查构造参数，需要额外参数的工具（如 `AskUser` 需要 session_id）走专用分支，无参可构造的才用 `tool_cls()`。

兜底机制：allowlist 模式下，如果某个 tool_path 实例化失败（缺少构造参数、类不存在），会尝试从 `parent_registry.get_tool(tool_path)` 取已实例化的对象；仍取不到则跳过并记日志，不让单个工具加载失败阻断整个子 Agent 启动。MCP/动态工具在 inherit 模式下保留运行时名称，后续从 parent_registry 复制，不重新连接 MCP server。

## 7. 已知限制

- **Python ptyprocess 不如 Node node-pty 成熟**：AIASys Windows 终端用 pywinpty，相比 Node.js 的 node-pty（直接绑定 ConPTY C API）在稳定性、resize、编码处理上有差距。Codex CLI 用 Rust native 绑定 ConPTY 是更稳的方案，但 AIASys 是 Python 底座，不具备重写条件，只能在 Python 侧尽量靠拢。
- **ConPTY 需 Win10 1809+**：pywinpty 的 ConPTY 后端要求 Windows 10 版本 1809（2018 年 10 月）及以上。更老的系统会退化到 winpty 后端，行为有差异。AIASys 桌面端目标环境是完整 Windows 10/11，视为最低要求。
- **PowerShell 语法差异**：降级到 PowerShell 后，Agent 生成的 POSIX 风格命令（`&&`、`||`、`$VAR`、管道）需要命令适配层转换。PowerShell 5.1（Windows 自带）和 PowerShell 7（pwsh）语法有细微差别，适配层以 5.1 为基线。
- **taskkill 依赖**：进程树终止完全依赖 `taskkill.exe` 在系统 PATH 中。精简版 Windows（如 Server Core）理论上自带，但极端裁剪环境可能缺失，此时进程树终止会静默失败。
