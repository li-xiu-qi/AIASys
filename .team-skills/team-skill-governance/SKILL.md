---
name: team-skill-governance
description: |
  AIASys 团队 Skill 治理规则与管理指南。
  明确 `.team-skills/` 是项目团队直接在 AIASys 仓库中维护的共享 Skill 池，与私人 Skill 解耦；
  规定 Team Skill 的准入标准、生命周期、写作规范和维护流程。
  当需要决定某个 Skill 是否适合进团队池、如何维护团队 Skill、或处理团队 Skill 与私人 Skill 边界时触发。
---

# 团队 Skill 治理

## 定位

`.team-skills/` 是 **AIASys 项目团队的共享 Skill 池**，直接在 AIASys 仓库中维护（git 跟踪）。

它回答的问题是："**AIASys 项目团队需要共同遵守哪些规则、掌握哪些方法？**"

它里面放的 Skill 满足以下特征：

- **项目专用**：与 AIASys 的技术栈、开发流程、协作方式直接相关。
- **团队共享**：团队里多个成员在 AIASys 开发时都用得上。
- **去个人化**：不绑定任何个人的环境、账号、私有路径或个人偏好。
- **直接维护**：Team Skill 直接在 `.team-skills/` 里创建和编辑，不从 pkm-hub 私人 Skill 自动分发。

**它不是**：

- 私人 Skill 的备份或复制。
- 从 pkm-hub 私人 Skill 自动部署出来的产物。
- 管理员个人的工作流手册。
- 任何人的个人收藏夹或偏好集合。

---

## 核心关系：Team Skill 与私人 Skill 解耦

```
私人 Skill（pkm-hub skills/ → .kimi-code/skills/ 索引卡片）
        │
        │  个人工作核心，自由迭代、调优、保留个人偏好
        │  修改入口：pkm-hub 源码仓库 → deploy.py → .kimi-code/skills/
        │
        ▼
   实战沉淀出项目通用经验
        │
        │  不是复制，而是提炼后重写
        │
        ▼
Team Skill（.team-skills/）
        │
        │  项目团队共享，去个人化，直接维护
        │  修改入口：直接在 AIASys 仓库的 .team-skills/ 中编辑
        │
        ▼
   团队成员可以参考、吸收到自己的私人 Skill
```

**关键规则**：

1. **不直接分发**：不把私人 Skill 原样搬入 `.team-skills/`。
2. **不反向同步**：`.team-skills/` 的改动不回写到任何私人 Skill。
3. **允许互相启发**：私人 Skill 里的好经验可以激发新的 Team Skill；Team Skill 里的好方法也可以被吸收进私人 Skill。但这是**手动提炼**，不是自动同步。
4. **AI 读取优先级**：AI 执行 AIASys 任务时，优先读取 `.kimi-code/skills/` 里的私人 Skill；遇到团队共享规则类问题时，也读取 `.team-skills/`。

---

## 谁能改 `.team-skills/`？

| 操作 | 团队成员 | 管理员 |
|------|---------|--------|
| 阅读 `.team-skills/` Skill | ✅ | ✅ |
| 在 `.team-skills/` 中直接创建/编辑 Team Skill | ✅（经团队共识） | ✅ |
| 把私人 Skill 直接复制到 `.team-skills/` | ❌ | ❌ |
| 提议新增/修改 Team Skill | ✅ | ✅ |

**核心原则**：任何人都可以为团队 Skill 池贡献，但贡献的是**去个人化的项目经验**，不是自己的私人 Skill。

---

## 准入标准：什么适合进 `.team-skills/`？

进入团队共享池前，必须同时满足：

| 检查项 | 通过标准 | 应排除的示例 |
|--------|---------|------------|
| **项目相关** | 与 AIASys 技术栈或协作流程直接相关 | 其他项目的专属 Skill |
| **团队通用** | 团队里多人在 AIASys 开发时能用得上 | 只符合个人习惯的流程 |
| **去个人化** | 不含个人身份、画像、偏好、私有路径 | 个人账号、个人电脑路径 |
| **去环境化** | 不绑定特定个人开发环境或私有工具链 | 仅 WSL/Windows 个人环境可用 |
| **跨系统** | 默认适用于 Windows、macOS、Linux；提及某系统时必须说明三个系统如何处理 | 只给 Linux 命令而不提 Windows/macOS |
| **去敏感** | 不涉及网盘、支付、个人账号、私有仓库地址 | 个人网盘、私有 CI 密钥 |
| **可独立使用** | 团队成员拿到就能用，不需要了解你的私人配置 | 依赖你的个人 Skill 才能看懂 |

**判定口诀**：这是"AIASys 项目需要大家知道的事"，不是"我个人怎么顺手的事"。

### 内容边界示例

**适合放进 `.team-skills/` 的内容**：

| 类型 | 示例 |
|------|------|
| 项目架构约定 | `aiasys-frontend-architecture`、`aiasys-system-design` |
| 开发流程规范 | `api-dev`、`sop-workflow`、`aiasys-git-workflow` |
| 团队协作规则 | `team-skill-governance`、`pr-check` |

**不适合放进 `.team-skills/` 的内容**：

| 类型 | 反例 | 原因 |
|------|------|------|
| 个人开发环境 | WSL/Windows 专属命令、个人路径 | 去环境化要求 |
| 个人账号/密钥 | API key、个人 token、私有仓库地址 | 去敏感要求 |
| 个人偏好 | 自己喜欢的 commit 格式、快捷键 | 去个人化要求 |
| 私人工作流 | 个人 Skill 部署、个人知识库管理 | 这是私人 Skill 的事 |
| 仅管理员操作 | deploy.py、私人 Skill 源码仓库管理 | 团队 Skill 不管这个 |

---

## Team Skill 的生命周期

### 创建

1. 在 `.team-skills/` 下新建目录，目录名即 Skill 名。
2. 编写 `SKILL.md`，frontmatter 中写清楚触发条件和适用场景。
3. 自检：是否去个人化？是否项目相关？团队是否用得上？
4. 提交到 AIASys git，通知团队。

### 更新

1. 发现 Team Skill 需要改进（使用中暴露问题、项目流程变化等）。
2. 直接在 `.team-skills/<skill>/SKILL.md` 中修改。
3. 提交到 AIASys git，说明变更原因。

### 从私人 Skill 中提炼团队 Skill

1. 在个人环境中长期使用某个私人 Skill，验证其价值。
2. 去除个人身份、私有路径、敏感工具和个人偏好。
3. 以项目通用视角重写，不直接复制原文。
4. 放入 `.team-skills/<skill>/SKILL.md`。
5. 提交到 AIASys git。

### 移除/归档

1. 如果某个 Team Skill 不再适用、被其他 Skill 覆盖、或发现不适合团队共享：
   - 在 `SKILL.md` 顶部添加 `# ⚠️ 已归档（ARCHIVED）`。
   - 移动到 `.team-skills/_archived/<skill>/`。
   - 提交到 AIASys git。

---

## 写作规范

Team Skill 的 `SKILL.md` 应遵循：

1. **项目视角**：用"AIASys 项目"做主语，不用"我"。
2. **跨系统优先**：默认写作要同时适用于 Windows、macOS、Linux。如果必须提及某个系统，必须说明三个系统分别怎么处理，除非本 Skill 就是专门讲该系统的。
3. **去环境化**：不写特定个人操作系统或开发环境的命令。
4. **去个人化**：不出现个人姓名、账号、私有路径。
5. **自包含**：不依赖 `.team-skills/` 外的 Skill 才能看懂。
6. **可操作**：给出明确的触发条件、执行步骤、验收标准。

---

## 最小自检清单

新增或修改 Team Skill 前，确认：

- [ ] 内容与 AIASys 项目直接相关
- [ ] 团队里多人能用得上
- [ ] 不含个人身份、私有路径、个人账号
- [ ] 不绑定特定开发环境（如 WSL/Windows 专属）
- [ ] 不引用外部私有资源
- [ ] 不泄露敏感信息
- [ ] 不直接复制私人 Skill 原文

---

## 与私人 Skill 的重复怎么办？

允许重复，但各自独立：

- 私人 Skill 可以保留个人化版本（更快、更顺手、绑定个人环境）。
- Team Skill 保留团队通用版本（去敏、去个人化、多人可用）。
- 两者不自动同步。私人 Skill 更新了，Team Skill 不需要跟进；Team Skill 更新了，私人 Skill 也不需要跟进。
- 如果个人认为 Team Skill 的某个改进很好，可以手动吸收到自己的私人 Skill 里。

---

## 常见反模式

- **把私人 Skill 直接复制到 `.team-skills/`**：团队 Skill 必须重写为项目通用视角。
- **在 `.team-skills/` 里放个人偏好**：比如"我喜欢的 commit message 格式""我常用的快捷键"。
- **试图让 `.team-skills/` 和私人 Skill 保持同步**：两者解耦，不需要同步。
- **把不适合团队的内容硬塞进团队池**：比如绑定个人环境、私有账号的 Skill。
- **Skill 名与项目无关**：团队 Skill 名建议带 `aiasys-` 前缀以表明项目归属，通用技术 Skill 可不带。

---

## 输出规范

被调用时，AI 应：

1. 说明 `.team-skills/` 是项目团队共享池，与私人 Skill 解耦。
2. 强调 Team Skill 直接在 `.team-skills/` 中维护，不来自私人 Skill 分发。
3. 根据用户问题给出具体建议：是否适合进团队池、怎么维护、是否该归档。
