---
name: commit-history-audit
description: |
  Commit 历史审计与提交规范。当用户要求检查 commit 历史、审计提交质量、
  合并/压缩 commit（squash）、整理 git log、删除 stale 分支、
  或发现 commit 历史过于冗长/混乱时触发。
  触发词："检查 commit 历史"、"审计提交"、"整理 commit"、"合并 commit"、
  "commit 太多了"、"git log 很乱"、"历史提交有问题"。
  与 aiasys-git-workflow 互补：git-workflow 管提交规范，本 Skill 管历史审计。
---

# Commit 历史审计

Git 提交历史的质量审计、问题诊断和清理规范。帮你发现重复提交、stale 分支、
不规范消息等问题，给出安全的清理建议。

## 核心原则

1. **审计优于重写**：先看清楚问题在哪，再决定是否动手
2. **安全第一**：已推送的历史不动，只清理能清理的
3. **规范预防**：建立流程防止问题重复发生

---

## 审计流程

### Step 1: 统计总览

```bash
# 总提交数
git log --oneline --all | wc -l

# 各分支提交数
for b in $(git branch -a | sed 's/^..//'); do
  echo "$b: $(git log --oneline "$b" | wc -l)"
done
```

### Step 2: 检测重复消息

两个不同 hash 的 commit 有相同的 message，通常是同时在两个分支上提交了同一批改动。

```bash
# 列出所有重复消息（不含 merge commits）
git log --all --format="%h %s" --no-merges | sort -k2 | uniq -d -f1

# 统计重复消息数量
git log --all --format="%h %s" --no-merges | sort -k2 | uniq -d -f1 | wc -l
```

### Step 3: 检测 Stash 产物

`git stash` 会产生以 `On <branch>:` 或 `index on <branch>:` 开头的 commit message。
如果这些混入了正式历史，说明 stash 被误提交了。

```bash
# 搜索可能的 stash 产物
git log --all --oneline --grep="^On .*branch:" --grep="^index on" --grep="^untracked files"
```

### Step 4: Stale 分支检测

找出远程分支中可能已合并或废弃的。

```bash
# 列出所有远程分支及其最后提交日期
git for-each-ref --format="%(refname:short) %(committerdate:short)" refs/remotes/

# 检查某分支是否还有 dev 没有的内容
git log --oneline dev..origin/<branch-name>   # stale 分支独有
git log --oneline origin/<branch-name>..dev   # dev 独有

# 如果 dev..origin/<branch> 为空，说明分支完全被 dev 包含，可安全删除
```

### Step 5: 生成报告

整理输出为结构化报告（见 `references/audit-checklist.md` 模板）。

---

## 安全红线

| 操作 | 是否允许 | 条件 |
|------|:---:|------|
| 删除本地 stale 分支 | ✅ | 确认内容已在 dev/main |
| 删除远程 stale 分支 | ✅ | `git log dev..origin/<branch>` 为空 |
| 本地未推送分支做 squash/rebase | ✅ | 还没 push 过 |
| force push 到 main/dev | ❌ | **绝对禁止** |
| 对已推送超过 1 天的分支 rebase | ❌ | 会破坏协作者仓库 |
| `git filter-repo` 全量重写 | ❌ | 只在密钥泄露应急时使用 |

**删除远程分支前必须：**
```bash
# 1. 确认分支无独有内容
git log --oneline dev..origin/<branch> | wc -l  # 必须为 0

# 2. 确认 dev 有该分支的内容
git diff dev origin/<branch> --stat             # 必须为空
```

---

## 提交规范（预防重复）

这些规范与 `aiasys-git-workflow` 互补。git-workflow 管怎么写 commit message，
本 Skill 管怎么防止 commit 历史膨胀。

### 一个功能一个分支

```
feature/xxx → PR → squash merge → dev → 立即删除 feature/xxx
```

- ❌ 不要在 dev 和 feature 分支上**同时**提交相同改动
- ❌ 不要 PR 合并后继续在旧分支上开发
- ✅ PR 合并后立即删除远程分支

### 合并策略

| 场景 | 策略 | 说明 |
|------|------|------|
| 功能分支 → dev | **squash merge** | 整个功能压成一个干净 commit |
| dev → main | **merge commit** | 保留 dev 的完整历史 |
| 多 commit 的 PR | **squash merge** | 避免碎 commit 污染主分支 |

### 碎 commit 自查

以下模式的 commit 应该 squash 后再提交：
- "fix typo" + 2 分钟后 "fix typo again"
- "WIP" / "tmp" / "test" 等临时标记
- 同一文件反复修改但没有独立意义的 commit

---

## 审计报告模板

每次审计后输出以下结构：

```
## Commit 历史审计报告

**审计时间**: YYYY-MM-DD
**总提交数**: N
**重复消息数**: N（占比 X%）

### 发现的问题

| 类型 | 数量 | 严重度 | 建议 |
|------|------|--------|------|
| 消息重复 | N | 🟡 | 来自双分支同步，历史不重写 |
| Stash 产物 | N | 🟢 | 孤儿对象，自然清理 |
| Stale 分支 | N | 🟡 | 建议删除 origin/xxx |

### 可安全执行的清理命令

```bash
# 删除 stale 远程分支
git push origin --delete <branch>
```

### 不可执行但未来需注意

- 已推送的双分支重复：不重写历史，靠 squash merge 预防
- 某类 commit 粒度问题：未来 PR 合并时用 squash
```

---

## 与 aiasys-git-workflow 的关系

| 维度 | commit-history-audit | aiasys-git-workflow |
|------|---------------------|---------------------|
| 关注点 | 历史已有的问题 | 每次提交怎么做 |
| 时机 | 定期检查 / 按需 | 每次 commit 前 |
| 操作 | 诊断 + 安全清理 | 暂存 + 提交 |
| 输出 | 审计报告 | commit message |

两个 Skill 互补使用。日常提交走 git-workflow，定期检查走 commit-history-audit。

---

## 快速检查命令（一键审计）

```bash
#!/bin/bash
# 一键 commit 历史健康检查
echo "=== Commit 历史健康检查 ==="
echo ""
echo "总提交数: $(git log --oneline --all | wc -l)"
echo "重复消息: $(git log --all --format='%s' --no-merges | sort | uniq -d | wc -l)"
echo ""
echo "=== 远程分支 ==="
git for-each-ref --format="  %(refname:short) | %(committerdate:short)" refs/remotes/
echo ""
echo "=== 近 10 条提交 ==="
git log --oneline -10
```

---

*审计是为了看清楚问题，不是为了追求完美历史。已推送的不用动，未来用规范预防。*
