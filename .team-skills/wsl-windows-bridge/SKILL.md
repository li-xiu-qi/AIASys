---
name: wsl-windows-bridge
description: |
  WSL 与 Windows 双环境互相操作的桥接方法论。
  当 Agent 需要在 WSL 中操作 Windows 文件（或反之）、跨环境修改配置、同步文件、
  路径转换、命令行工具选择时触发。
  覆盖 WSL→Windows 路径映射（/mnt/c/ → C:\）、Windows→WSL 路径映射（\\wsl$\）、
  Shell 工具选择策略、常见跨环境错误与规避方法、代码项目存储设计规范。
---

# WSL ↔ Windows 桥接操作 Skill（AIASys 团队版）

**定位**: AIASys 项目团队共享的跨环境操作规范
**适用范围**: 所有涉及跨 WSL/Windows 边界的文件读写、命令执行、配置修改、项目存储决策场景

---

## 说明

本 Skill 为 AIASys 团队入口索引，完整规范维护在 **pkm-hub 私人 Skill 仓库**：

**完整源码**：[`pkm-hub/resources/xiaoke-skill-development/skills/_global/wsl-windows-bridge/SKILL.md`](C:/Users/ke/Documents/projects/obsidian_projects/pkm-hub/resources/xiaoke-skill-development/skills/_global/wsl-windows-bridge/SKILL.md)

> 团队版仅保留快速索引与 AIASys 特定约定。完整操作规范、脚本工具、故障排查流程请读取上述链接。

---

## 快速索引

| 主题 | 位置 |
|------|------|
| 文件存储设计规范 | pkm-hub `wsl-windows-bridge` 第一章 |
| 核心操作原则 | pkm-hub `wsl-windows-bridge` 第二章 |
| 路径映射速查表 | pkm-hub `wsl-windows-bridge` 第三章 |
| 常见错误与规避 | pkm-hub `wsl-windows-bridge` 第四章 |
| 开发联调工作流 | pkm-hub `wsl-windows-bridge` 第五章 |
| 跨环境配置同步 | pkm-hub `wsl-windows-bridge` 第六章 |
| AIASys 跨平台编码规范速查 | pkm-hub `wsl-windows-bridge` 第七章 |
| Git Bash 注意事项 | pkm-hub `wsl-windows-bridge` 第六章 |

---

## AIASys 项目约定

### 项目存储

| 项目 | 存放位置 | 说明 |
|------|---------|------|
| AIASys（活跃开发） | WSL `/home/ke/projects/AIASys` | 唯一事实源 |
| Windows 符号链接入口 | `pkm-hub/Projects/CodeProjects/WSL-Native/AIASys` | 仅用于 Obsidian/编辑器跳转 |
| Windows 打包目录 | `C:\Users\ke\projects\AIASys-windows-build\` | 独立目录，不放在 WSL-Native |

### 同步脚本

AIASys 项目使用专用同步脚本：

```bash
# WSL → Windows（打包前）
bash sync-aiasys.sh --quick

# Windows → WSL（调试前端/桌面端）
bash sync-aiasys.sh --quick-reverse
```

脚本位置：`apps/desktop/scripts/sync-aiasys.cjs`

### 打包约束

- WSL 侧：`npm run build`（前端静态产物）+ `npm run dist:linux:dir`（Linux 包）
- Windows 侧：`node scripts/prepare-runtime.cjs`（创建 Windows 版 .venv）+ `npx electron-builder --win dir`
- **禁止在 WSL 内执行 `electron-builder --win`**

---

## 脚本工具

| 脚本 | 用途 |
|------|------|
| `scripts/delete-reparse-points.sh` | WSL 内递归清理损坏的 reparse point |
| `scripts/force-restart-wsl.ps1` | 管理员权限强制终止僵死的 WSL VM 进程并重启服务 |
| `scripts/sync-aiasys.sh` | AIASys WSL ↔ Windows 双向同步 |

---

## 关联 Skill

- **aiasys-cross-platform**：AIASys 跨平台兼容性规范（已合并至 `wsl-windows-bridge` 第七章）
- **aiasys-git-workflow**：AIASys Git 工作流
- **pkm-skill-distribution**：Skill 分发管理
