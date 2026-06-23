---
name: aiasys-cross-platform
description: |
  AIASys 项目跨平台兼容性规范（团队版）。当涉及路径处理、文件 IO、进程管理、
  编码转换、Shell 命令执行、依赖选型时触发。覆盖三端（Windows、macOS、Linux）
  差异陷阱、常见错误模式、正确做法和项目内已有的跨平台基础设施。
  触发于：新增文件 IO 操作、使用 subprocess、引入新依赖、处理路径字符串、
  遇到平台相关 bug、或需要判断某个 API 是否跨平台安全时。
---

# AIASys 跨平台兼容性规范

## 定位

AIASys 三端支持（Windows、macOS、Linux），本 Skill 记录项目内已验证的跨平台陷阱和正确做法。

**核心原则**：优先用跨平台纯 Python/纯 JS 库，代码层消灭平台分支。平台差异推到构建/打包阶段，不推到运行时代码。

---

## 权威文档

**完整规范已合并至**：[`wsl-windows-bridge` Skill 第七章](C:/Users/ke/Documents/projects/obsidian_projects/pkm-hub/resources/xiaoke-skill-development/skills/_global/wsl-windows-bridge/SKILL.md#七aiasys-跨平台编码规范速查)

> 本节仅保留索引导航作用。编写跨平台代码时，请直接阅读上述 `wsl-windows-bridge` 第七章获取完整速查表。

---

## 快速索引

| 主题 | 速查位置 |
|------|---------|
| 依赖选型红线 | `wsl-windows-bridge` 7.2 |
| 路径处理 (`as_system_path`) | `wsl-windows-bridge` 7.3 |
| 编码处理 (`smart_decode`) | `wsl-windows-bridge` 7.4 |
| 进程管理（POSIX/Windows 双路径） | `wsl-windows-bridge` 7.5 |
| Shell 命令执行 | `wsl-windows-bridge` 7.6 |
| 常见错误模式 | `wsl-windows-bridge` 7.7 |
| 快速检查清单 | `wsl-windows-bridge` 7.8 |

---

## 项目内已接入 `as_system_path` 的模块

以下模块已正确接入，新增类似操作时参考：

- `file_history.py` — 文件版本管理全部 IO
- `memory/store.py`、`memory/resolver.py` — Memory 子系统
- `diff_service.py` — 差异对比
- `file_tools.py`、`file_tools_read.py`、`file_tools_write.py` — Agent 文件工具
- `workspaces_resources_files.py` — 工作区文件 API
- `sqlite_vec.py` — 数据库连接
- `session_execution_journal.py` — 执行日志
- `subagent_storage.py` — 子 Agent 存储
- `files_core.py` — 文件核心端点
- `sessions_branches.py` — 会话分支

---

*跨平台兼容性是 AIASys 三端支持的基础，代码层消灭平台分支，差异推到构建/打包阶段。*
