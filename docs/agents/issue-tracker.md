# 问题跟踪（Issue tracker）：GitHub

这个仓库的需求、缺陷和 PRD 默认记录在 GitHub Issues：`123225073/sap-ai-consultant-workbench`。

如果本机已安装并登录 `gh` CLI，就用它操作 issue。创建本配置时，本机 PATH 中没有检测到 `gh`，所以后续 Agent 在声称“已创建/已更新 issue”前，必须先验证 `gh` 可用。

## 常用命令

- 创建 issue：`gh issue create --title "..." --body "..."`
- 查看 issue：`gh issue view <number> --comments`
- 列出 issue：`gh issue list --state open --json number,title,body,labels,comments`
- 评论 issue：`gh issue comment <number> --body "..."`
- 添加或移除 label：`gh issue edit <number> --add-label "..."` / `--remove-label "..."`
- 关闭 issue：`gh issue close <number> --comment "..."`

在当前 clone 内运行时，可以通过 `git remote -v` 推断仓库。

如果 `gh` 不可用，必须直接说明，不要假装已经更新了 issue tracker。

## PR 是否作为分类入口（triage）

PRs as a request surface：no。

这个仓库不把外部 PR 当作需求入口处理。工程技能的需求和 triage 队列使用 GitHub Issues。

## 当技能要求 `publish to the issue tracker`

创建一个 GitHub issue。

## 当技能要求 `fetch the relevant ticket`

运行：

```powershell
gh issue view <number> --comments
```
