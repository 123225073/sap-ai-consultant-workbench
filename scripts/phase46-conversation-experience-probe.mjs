import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const appSource = await readFile(path.join(repoRoot, "apps/desktop/src/renderer/App.tsx"), "utf8");
const styles = await readFile(path.join(repoRoot, "apps/desktop/src/renderer/styles.css"), "utf8");

assert.match(appSource, /const submittedMessage = message;\s+const submittedContextKey = activeConversationKey;\s+setMessage\(""\)/, "发送时应保存原始内容和所属对话并立即清空输入框");
assert.match(appSource, /function restoreSubmittedMessage[\s\S]+activeConversationKeyRef\.current !== contextKey/, "发送失败时应把内容恢复到原对话而不是当前对话");
assert.match(appSource, /catch \{\s+restoreSubmittedMessage\(submittedContextKey, submittedMessage\);\s+if \(cancelRequestedRef\.current\)/, "IPC 抛出异常或任务取消时都应恢复原输入");
assert.match(appSource, /本次任务已停止，原消息已恢复到输入框/, "用户主动停止任务时应恢复未完成的原消息");
assert.match(appSource, /pendingStopRef\.current = true[\s\S]+任务启动后会立即停止/, "运行事件尚未返回时，停止请求必须排队而不是丢失");
assert.match(appSource, /cancelAgentTurn\(\{ requestId: run\.requestId \}\)/, "停止任务必须按当前 requestId 精确取消");
assert.match(appSource, /flow\.scrollTop = flow\.scrollHeight/, "对话应能自动滚动到最新消息");
assert.match(appSource, /followLatestRef\.current = nearBottom/, "用户向上阅读时应暂停自动跟随");
assert.match(appSource, /requestAnimationFrame\(\(\) => \{\s+if \(!force && !followLatestRef\.current\) return;/, "排队的滚动回调执行前应再次确认用户仍在跟随最新消息");
assert.match(appSource, /pendingStreamRef[\s\S]+requestAnimationFrame/, "流式增量应按动画帧合并刷新");
assert.match(appSource, /event\.nativeEvent\.isComposing/, "Enter 发送必须保留中文输入法组合态保护");
assert.match(appSource, /const MessageContent = memo/, "历史消息正文应避免在每个流式增量中重复解析");
assert.match(appSource, /import ReactMarkdown from ["']react-markdown["']/, "对话正文应使用成熟 Markdown 渲染器");
assert.match(appSource, /import remarkGfm from ["']remark-gfm["']/, "Markdown 表格和任务清单应支持 GFM");
assert.match(appSource, /<ReactMarkdown[\s\S]+remarkPlugins=\{\[remarkGfm\]\}/, "历史和流式回复都应渲染 Markdown，而不是显示原始标记");
assert.doesNotMatch(appSource, /rehypeRaw|dangerouslySetInnerHTML/, "对话 Markdown 不得放开原始 HTML 注入");
assert.match(appSource, /function readableHistoricalText[\s\S]+历史对话（编码异常）/, "明显损坏的旧聊天编码应以中文说明替代问号噪声");
assert.match(appSource, /className="conversation-content"/, "对话正文应使用稳定的居中阅读列");
assert.match(styles, /\.scroll-latest-button\s*\{/, "离开最新消息后应提供回到底部按钮");
assert.match(styles, /\.message-body\s*\{/, "助手回复应使用结构化正文排版");
assert.match(styles, /\.markdown-table-scroll\s*\{/, "Markdown 表格应提供受控横向滚动容器");
assert.match(styles, /\.user-message[\s\S]+width:\s*fit-content/, "用户消息应使用轻量自适应气泡");

console.log("phase46-conversation-experience-probe=ok");
