---
name: cross-env-project-registry
description: |
  WSL ↔ Windows 跨环境联调项目注册表。
  当 Agent 需要快速定位"两边都在维护"的项目、查找项目在 WSL 和 Windows 的对应路径、
  判断用哪个侧作为事实源、或执行跨环境同步/联调时触发。
  不替代 wsl-windows-bridge（操作规范）和 skill-management（分发管理），
  只解决"这些项目到底在哪里、关系是什么"的定位问题。
---

# cross-env-project-registry

**定位**: AIASys 项目团队共享的跨环境联调项目注册表
**适用范围**: 所有涉及 WSL ↔ Windows 双环境并行维护的项目定位与路径查询

---

## 说明

本 Skill 为 AIASys 项目团队入口索引，完整规范维护在 **pkm-hub 私人 Skill 仓库**：

**完整源码**：[`pkm-hub/resources/xiaoke-skill-development/skills/_global/cross-env-project-registry/SKILL.md`](C:/Users/ke/Documents/projects/obsidian_projects/pkm-hub/resources/xiaoke-skill-development/skills/_global/cross-env-project-registry/SKILL.md)

> 团队版仅保留快速索引与 AIASys 特定约定。完整注册表、判断逻辑和维护规范请读取上述链接。

---

## 快速索引

| 主题 | 位置 |
|------|------|
| AIASys 项目路径与约束 | pkm-hub `cross-env-project-registry` 注册表 |
| wenyan-cli 项目路径 | pkm-hub `cross-env-project-registry` 注册表 |
| 其他 WSL-Native 项目 | pkm-hub `cross-env-project-registry` 注册表 |
| 判断逻辑（如何识别项目归属） | pkm-hub `cross-env-project-registry` 判断逻辑 |
| 维护规范（新增联调项目） | pkm-hub `cross-env-project-registry` 维护规范 |

---

## AIASys 项目约定

### 项目存储

| 项目 | 存放位置 | 说明 |
|------|---------|------|
| AIASys（活跃开发） | WSL `/home/ke/projects/AIASys` | 唯一事实源 |
| Windows 符号链接入口 | `pkm-hub/Projects/CodeProjects/WSL-Native/AIASys` | 仅用于 Obsidian/编辑器跳转 |
| Windows 打包目录 | `C:\Users\ke\projects\AIASys-windows-build\` | 独立目录，不放在 WSL-Native |
| 已安装版 | `C:\Users\ke\AppData\Local\Programs\AIASys\` | 安装包产物，测试用 |

### 同步脚本

AIASys 项目使用 git 同步：

```bash
# WSL → Windows（修改后）
git push win main

# Windows 侧同步
cd C:\Users\ke\projects\AIASys-windows-build
node scripts/wsl-sync.cjs
```

脚本位置：`apps/desktop/scripts/wsl-sync.cjs`

**约定**：代码修改统一在 WSL 侧进行，Windows 侧仅做同步和打包。

### 打包约束

- WSL 侧：`npm run build`（前端静态产物）+ `npm run dist:linux:dir`（Linux 包）
- Windows 侧：`node scripts/prepare-runtime.cjs`（创建 Windows 版 .venv）+ `npx electron-builder --win dir`
- **禁止在 WSL 内执行 `electron-builder --win`**

---

## 关联 Skill

- **wsl-windows-bridge**：WSL ↔ Windows 跨环境操作规范
- **aiasys-cross-platform**：AIASys 跨平台兼容性规范（已合并至 wsl-windows-bridge 第七章）
- **pkm-skill-distribution**：Skill 分发管理
