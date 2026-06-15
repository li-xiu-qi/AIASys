# Commit 历史审计检查清单

> 每次审计 commit 历史时按此清单逐项检查，输出结构化报告。

## 一、基础统计

| 指标 | 命令 | 值 |
|------|------|----|
| 总提交数 | `git log --oneline --all \| wc -l` | |
| dev 提交数 | `git log --oneline dev \| wc -l` | |
| main 提交数 | `git log --oneline main \| wc -l` | |
| 远程分支数 | `git branch -r \| wc -l` | |

## 二、重复检测

| 检查项 | 命令 | 结果 |
|--------|------|------|
| 重复消息数 | `git log --all --format="%h %s" --no-merges \| sort -k2 \| uniq -d -f1 \| wc -l` | |
| 重复消息列表 | `git log --all --format="%h %s" --no-merges \| sort -k2 \| uniq -d -f1` | |
| 重复率 | 重复消息数 / (总提交数 - merge commits) | % |

## 三、Stash 产物检测

```bash
git log --all --oneline --grep="On .*:" | grep -E "(index on|untracked files)"
```

| Commit | 消息 | 所在分支 | 建议 |
|--------|------|---------|------|
| | | | |

## 四、Stale 分支检测

对每个远程分支检查：

```bash
# 对每个远程分支
for branch in $(git branch -r | grep -v "HEAD\|main\|dev" | sed 's/^..//'); do
  ahead=$(git log --oneline dev.."$branch" 2>/dev/null | wc -l)
  behind=$(git log --oneline "$branch"..dev 2>/dev/null | wc -l)
  echo "$branch | ahead=$ahead | behind=$behind"
done
```

| 分支 | dev 缺失 commit 数 | 分支缺失 commit 数 | 最后更新 | 建议 |
|------|:---:|:---:|------|------|
| | | | | |

**判定规则**：
- `ahead=0` → 分支完全被 dev 包含，**可安全删除**
- `ahead>0` → 分支有 dev 没的内容，需要先 cherry-pick 再删
- `behind=0` → dev 完全被分支包含（不太正常）

## 五、近 30 天提交质量抽查

随机抽查近 30 天内的 10 个 commit：

```bash
git log --oneline --since="30 days ago" | head -10
```

| Commit | 消息 | 是否符合规范 | 备注 |
|--------|------|:---:|------|
| | | | |

**规范标准**：`<type>(<scope>): <subject>` 格式 + 中文消息

## 六、安全评估

| 检查项 | 状态 | 备注 |
|--------|:---:|------|
| 是否需要对 main/dev force push？ | | 如果是，禁止 |
| 是否有未推送的本地 commit？ | | |
| 是否有已推送超过 1 天的分支需要 rebase？ | | 如果是，禁止 |
| 删除远程分支前是否确认了 `git diff dev origin/<branch>` 为空？ | | |

## 七、总结与建议

**本次审计结论**：

**可立即执行的清理**：
```bash
# 粘贴具体命令
```

**不可执行但需建立规范**：

**下次审计时间建议**：