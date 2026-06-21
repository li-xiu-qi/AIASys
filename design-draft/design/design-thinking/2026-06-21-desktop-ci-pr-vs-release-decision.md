# Desktop CI：PR 验证与 Release 编译策略决策

## 日期

2026-06-21

## 背景

当前 `.github/workflows/ci-desktop.yml` 只在以下两种场景触发：

1. `push` 到 `v*` tag（自动发布 Release）
2. 手动 `workflow_dispatch`（可选 stable/beta）

PR 合入 `main` 时不会触发桌面打包，导致第一次完整的桌面端编译验证发生在打 tag 之后。v0.4.22 的第一次发布就因为前端 `tsc -b` 类型错误在 CI 上直接失败。

## 讨论过的方案

### 方案 A：PR 也跑完整桌面打包，Release 复用产物或重新打包

- 优点：问题在合并前暴露，Release 更稳。
- 缺点：
  - GitHub Actions artifact 对免费账号有容量限制（单个 artifact 500MB），web dist + 三平台产物容易触线。
  - PR 和 Release 都跑完整三平台打包，总耗时和排队时间翻倍。
  - 当前 0-1 阶段改动频繁，PR 全量打包性价比不高。

### 方案 B：PR 只做轻量验证（type-check / lint / build-sanity），Release 才正式打包

- 优点：PR 快速，不重复完整打包。
- 缺点：
  - `electron-builder` 的真实问题（签名、runtime 准备、平台二进制）仍要等到 Release 才能暴露。
  - 仍然需要在 PR 工作流里维护一套独立的构建脚本。

### 方案 C：维持现状，Release tag 触发三平台完整打包

- 优点：实现最简单，不增加 CI 复杂度，不占用 artifact 配额。
- 缺点：打包问题只能在 tag 后发现，需要通过 hotfix tag 修复。

## 决策

**采用方案 C：维持现状。**

- 桌面端 CI 继续只在 `push v*` tag 和 `workflow_dispatch` 时触发三平台完整打包。
- 不额外增加 PR 桌面打包验证。
- 发布前由维护者在本地或 fork 仓库手动跑通 `npm run build`（即 `tsc -b && vite build`）以及桌面端单元测试，作为人工卡口。

## 决策理由

1. **0-1 阶段优先简单可控**：当前产品仍在快速迭代，CI 配置越简单越不容易成为发布阻塞点。
2. **Artifact 容量限制**：三平台桌面产物每个都在百 MB 级别，PR 阶段缓存或传递产物容易触达 GitHub 免费配额，反而增加排错成本。
3. **本地 lefthook 已覆盖基础检查**：pre-commit 会跑前端 type-check、lint、后端 ruff、editorconfig 等，能拦截大部分低级错误。
4. ** hotfix 成本低**：如果 tag 后 CI 失败，可以删除并重新打同名 tag（无 Release 发布时）或打一个补丁版本；v0.4.22 就是通过 hotfix PR + 重打 tag 快速修复的。
5. **未来可 revisit**：当进入 1-N 稳定期、贡献者增多、或升级到付费 GitHub 计划后，再评估是否引入 PR build-sanity 或完整 PR 打包。

## 风险与缓解

| 风险 | 缓解措施 |
|---|---|
| tag 后才发现 TypeScript / 打包错误 | 维护者发布前在本地跑 `npm run build` 和桌面单元测试 |
| 贡献者 PR 引入破坏桌面构建的改动 | 代码审查时要求说明是否影响桌面端；重大改动先在 fork 或个人分支验证 |
| 重复 hotfix tag 污染历史 | 仅在未发布 Release 时重打 tag；已发布则走补丁版本 |

## 触发条件（后续可重新评估）

满足以下任一条件时，应重新评估本决策：

- 项目进入稳定维护期，每周发布节奏固定。
- 外部贡献者显著增多，人工预审成本超过 CI 成本。
- 升级到 GitHub Teams/Enterprise，artifact 和并发限制放宽。
- 出现第三次以上因未在 PR 阶段发现而导致 tag 后构建失败的情况。

## 相关文件

- `.github/workflows/ci-desktop.yml`
- `lefthook.yml`
- `docs/changelog/v0.4.22_2026-06-21.md`
