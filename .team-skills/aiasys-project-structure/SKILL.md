---
name: aiasys-project-structure
description: |
  AIASys 仓库项目结构与辅助产物管理规范。约束 scripts/、docs/、AIASys-design-draft/、apps/*/scripts/ 等目录的落位原则，
  以及临时脚本、工具脚本、测试辅助脚本的生命周期管理。
---

# AIASys 项目结构规范

## 定位

本 Skill 约束 AIASys 仓库内**非业务代码文件**的落位与生命周期：

- 工具脚本放哪里
- 临时脚本怎么处理
- 文档与配图怎么组织
- 什么该归档、什么该删除

与 `aiasys-frontend-architecture`、`aiasys-system-design`、`aiasys-tool-dev` 等 Skill 互补：那些 Skill 管业务代码，本 Skill 管仓库骨架与辅助产物。

---

## 核心原则

1. **业务代码与辅助脚本分离**：业务逻辑在 `apps/` 内；项目级工具脚本在 `scripts/` 内；一次性脚本不进入版本控制。
2. **临时产物不进仓库**：截图、中间数据、个人调试脚本放 `AIASys-design-draft/` 或 `.runtime/`，两者均已 gitignore。
3. **脚本目录保持精简**：`scripts/` 根目录只保留通用、可复用的项目级工具；带硬编码 session_id / 个人路径 / 一次性输出的脚本必须归档或删除。

---

## 目录落位

### `scripts/` — 项目级通用工具脚本

保留原则：**通用、可复用、无硬编码个人数据**。

| 子目录 | 用途 | 示例 |
|--------|------|------|
| `scripts/dev/` | 开发环境、生命周期、Git hooks | `cli.sh`、`setup-hooks.sh` |
| `scripts/design/` | 设计基线校验与 CSS 导出 | `validate-design-md.sh` |
| `scripts/security/` | 安全扫描 | `scan-secrets.sh` |
| `scripts/` 根目录 | 跨域通用工具 | `count_code.py`、`batch_agent_tests.py` |

**禁止留在 `scripts/` 根目录的脚本**：

- 硬编码 session_id 的 Agent 测试脚本
- 输出路径指向个人主目录的截图/数据处理脚本
- 为某一次 Demo、README 配图、UX 审计编写的脚本
- 仅在当前机器能跑、依赖本地文件/数据库的脚本

这些脚本应**归档到 `AIASys-design-draft/archive/scripts/<主题>-<YYYYMMDD>/`**，或删除。

### `apps/*/scripts/` — 应用内脚本

- `apps/backend/scripts/`：后端业务脚本（如 vendor 二进制下载）
- `apps/desktop/scripts/`：桌面端构建与启动脚本
- `apps/web/scripts/`：前端构建辅助脚本

应用内脚本只服务本应用，不跨应用复用。

### `AIASys-design-draft/` — 临时产物与归档

已 gitignore。用途：

- 设计稿、临时截图、测试日志
- 已完成的临时任务脚本归档
- 不进入版本控制的个人调试产物

归档时按主题+日期命名子目录：

```
AIASys-design-draft/archive/scripts/ux-audit-20250608/
AIASys-design-draft/archive/scripts/demo-qa-20250618/
```

### `docs/` — 对外公开文档

只保留面向用户/贡献者的正式文档。临时设计思考、内部会议纪要不放这里。

### `images/readme/` — README 正式配图

README 引用的正式配图放这里。生成这些配图的临时脚本不放在这里，也不应留在 `scripts/` 根目录。

---

## 脚本生命周期

```
编写临时脚本
    │
    ▼
判断是否需要长期保留
    │
    ├─ 是，且通用可复用 ──→ 移动到 scripts/ 合适子目录，补充 README 说明
    │
    ├─ 是，但仅本次任务/个人调试 ──→ 归档到 AIASys-design-draft/archive/scripts/
    │
    └─ 否 ──→ 删除
```

**清理检查点**：

- [ ] 脚本是否硬编码了个人路径或 session_id？
- [ ] 脚本输出是否指向 AIASys-design-draft/ 或本地临时目录？
- [ ] 脚本是否只在当前机器/当前任务有用？
- [ ] 脚本是否有通用 CLI 参数，能在别人机器上跑？
- [ ] 脚本是否已在 `scripts/README.md` 中说明？

---

## 关联 Skill

- `workspace-ops`：通用文件目录与临时文件管理
- `aiasys-frontend-architecture`：前端代码结构
- `aiasys-tool-dev`：Agent 工具开发规范
- `aiasys-git-workflow`：Git 提交规范
