# 合并重复代码要取并集，不能随手挑一份当基准

2026-08-11 修 AIASys lifecycle e2e 定位器腐烂时的实测事故。

11 份 spec 各自拷了一份 `openGlobalResourcesPanel`。我提取公共实现时，从其中一份
拷进 `e2e/lifecycle/support.ts`，结果把 canvas-preview-ctrl-wheel.spec.ts 里一条
**原本通过**的用例改成了 180s 超时。

根因：各份拷贝的新旧程度不同。canvas 那份是唯一跟上按钮改名的（可访问名从「全局资源」
改成了「全局工作区」，它写成两个都试），而我挑的那份只写旧名。**去重变成了用退化版本
覆盖已修好的版本。**

## 动作

合并 N 份重复实现前，先 diff 全部 N 份，取行为并集：
- 定位器、可访问名、选择器：全部保留为 `or` / 逗号选择器
- 前置等待（如 `await expect(page.locator("textarea")).toBeVisible()`）：有一份有就都要
- 断言：取最严的那份

判断哪份"更好"不能看代码整洁度，要看它是否包含其他份没有的兼容分支——那通常是修过 bug 的痕迹。

## 附带教训：`if (visible) A else B` 兜底会伪装失败

A 失效时不报错，转而走同样失效的 B，把「定位器过时」的失败伪装成「B 上等待超时」，
报错指向 B，完全看不出真实原因。这类兜底要么删，要么在两条都失败时显式抛出说明。

<!-- MEMORY_FIELDS {"version":1,"occurrences":1,"updated_at":"2026-08-11"} -->
