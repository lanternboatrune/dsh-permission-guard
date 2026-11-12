# CHANGELOG

## 0.6.0 — 2026-11-12

- **并入 `integrity-guard`**：显示名改「完整守护」，设置页仍是同一个入口，新增「完整性」标签页；`/integrity-guard/bridge` 与原有 `/permission-guard/bridge` 并行注册，互不影响。
- 完整性逻辑搬到 `lib/integrity.js`，依赖 `lib/acl.js`、`lib/scan-paths.js`；状态存 `integrity-state.json`，与权限的 `state.json` 分开。
- 设置页「完整性」页：总开关、展开深度 0–4、额外扫描根、允许保留 Low 的根、最近扫描摘要、立即扫描与最近记录；错误行带拒绝原因，失败数大于 0 时提示需要管理员权限。
- 包元数据：version 0.6.0，`files` 补 `lib/integrity.js`、`lib/acl.js`、`lib/scan-paths.js`，`keywords` 加 `integrity`、`acl`，`locale` 改 `meta` 标题「完整守护」。
- 测试仍为 70 项（29 + 6 + 35），全部通过。
- 修失败原因乱码：`icacls` 输出按系统代码页解码（中文 Windows 为 GBK），日志不再显示问号串，拒绝原因可读。
- 设置页新增「以管理员修复」：先收集真正带 Low 的目录，写成临时 PowerShell 脚本，用 `Start-Process -Verb RunAs` 触发 UAC 一次性改回 Medium；取消 UAC 会提示原因，脚本不会残留。

## 0.5.2 — 2026-11-12

- 修「常驻可写按不了」：旧宿主（0.3.x）不认 `options.trustAllWorkspaces`，提交后立刻被归一化丢掉，选中态又退回「全部可写」。现在把意图暂存在 `localStorage`（键 `permission-guard.pendingTrust`）：点「常驻可写」后**立即按全部可写生效**，选中态保持，并提示「重启 DSH 后自动转为常驻」；重启后宿主换成新版，第一次打开设置页时自动补上 `trustAllWorkspaces: true` 并清掉暂存。
- 三态控件的提示文案按「旧宿主 / 已排队 / 新宿主」三种情形分别显示。

## 0.5.1 — 2026-11-12

- 修「一键授权区看着有两个开关、且点了没反应」：原来是一个无文字的圆形 `Toggle` + 两个按钮，语义重叠；现改为单个三态控件「不放开 / 全部可写 / 常驻可写」，说明文字从两行合并成一行。
- **兼容旧宿主**：宿主没有 `workspaces` 字段（0.3.x）时，banner 直接提示「常驻需要重启 DSH 后才可用」，而「全部可写」仍然立刻写入 `workspaceSubdirs` 并落盘——旧宿主本来就认得这个字段，所以点击能看到真实效果，不会「按了没反应」。
- 清理不再使用的 `setAllWorkspaces` 与 `allWrite/allClear/allWriteHint/trustAll/trustAllHint` 文案键。

## 0.5.0 — 2026-11-12

- **整工作区一键授权**：目录页顶部 banner 提供「全部可写 / 全部清除」，每个工作区块头提供「全部可写 / 清除」。授权键直接取工作区根目录的绝对路径，宿主按前缀判定，因此一个键覆盖整棵树（含以后新建的子目录）。
- **常驻开关** `options.trustAllWorkspaces`（默认关）：打开后不必逐项勾选，`writableRoots()` 每次现查 `workspaceRegistry`，注册表里所有工作区整棵树可写，新建的工作区自动在内。严格布尔归一化。
- 工作区块内新增「整个工作区（含全部子目录）」三态行；根键设为可写后，逐个子目录的行收成一句「已覆盖」提示，避免一屏几十行。
- 客户端兼容：旧宿主只有 `workspaceDirs`（相对键）时，一键操作退回逐个子目录累加，不会写错键。
- 测试：29 + 6 + 35 = 70 项（新增 S14 常驻开关的注入与关闭后失效）。

## 0.4.2 — 2026-11-12

- **兼容旧宿主**：客户端优先读 `data.workspaces`，缺失时用 `data.workspaceDirs` 兜底成单工作区（`dirKey = abs || rel`），修掉「宿主 0.3.x + 客户端 0.4.x」时「目录」页整块空白的问题。
- 工作区列表为空时也渲染一块说明，不再留白。

## 0.4.1 — 2026-11-12

- 设置页改为「顶部固定 + 横向标签页」：总开关常驻顶部，内容拆成「目录 / 工具 / 日志」三页，标签带条数，样式对齐 DSH 会话面板的页签（选中项品牌色 + 2px 下划线）。
- 「外部目录白名单」提到目录页第一块，工作区子目录挪到其后；日志空态显示「暂无记录」。
- 顺带修掉 `rootsHint` 里「命令是否放行见下方」的跨块指向（现在指向「工具」页）。

## 0.4.0 — 2026-11-12

- **多工作区**：DSH 可以有多个工作区。设置页改为按 `ctx.workspaceRegistry.list()` 逐工作区渲染（标题 + 真实路径），子目录授权键从「相对路径」改成「绝对路径」，跨工作区不再串台；注册表不可用时退化为当前会话工作区一块。
- `writableRoots()` 直接用 `workspaceSubdirs` 的绝对键，不再依赖单一 workspace 根。
- 桥返回 `workspaces: [{id,title,path,dirs:[{rel,abs}]}]`；保存时对 `workspaceSubdirs` 里的 write 项同样跑 `inspectRoot` 校验。
- `normalizeState` 丢弃非绝对路径的子目录键（旧版本相对键）。
- 测试：27 + 6 + 30 = 63 项（新增 S13 多工作区隔离、绝对键归一化）。

## 0.3.1 — 2026-11-12

- 修复设置页「工作区」显示成 host 进程 cwd（`~/.dsh/profiles/desktop`）的问题：改为优先取最近活跃会话的 `header.cwd`，其次 `workingDirectory.defaultDirectory`，最后才回落沙箱策略。子代理会话被排除。
- 设置页返回 `workspaceSource`（`session` / `default`），回落时有「未确定会话，显示默认目录」提示。
- 「外部目录白名单」文案写明**包含全部子目录**（实现本来就是前缀匹配，只是没写清）。
- 「工作区子文件夹」为空时给出空状态说明，不再只剩标题。

## 0.3.0 — 2026-11-12

- 新增**命令工具静默放行**：命中白名单的 `pwsh` / `bash` / `run_code` 在 `tools/execute` 期间让当前会话解析到 `danger-full-access`（临时包装 `sandboxPolicy.resolve()`，按 `sessionId` 过滤，结束还原），不再弹出 `danger-full-access` 审批。
- 新增 `commandHitsRoots`（`lib/rules.js`）：命令文本或 workdir 里出现白名单路径即命中，大小写/斜杠不敏感，带路径边界判断（`D:\Dev` 不命中 `D:\Develop`），盘符根不参与匹配。
- 新增 callId 白条：命令自带 `sandbox_permissions` 时 `approval/request` 直接应答 `allowed-once`，不进 UI；10 分钟自动过期。
- 新增设置项 `options.shellSilent`（默认开）与设置页「命令工具」分组。
- 单测：规则与状态 24、闸门 6、集成 18（新增 S7–S10 覆盖会话作用域、还原、白条、关闭开关）。

## 0.2.0 — 2026-11-12

- 新增 `lib/gate.js` 公平读写锁：fs 写窗口 shared、命令工具 exclusive，消除 Windows ACL 并发抛错（README §8.5）。
- 新增 `inspectRoot`：保存前校验目录存在 / 是目录 / `realpath === resolve`；运行期非法根跳过并记 `skip-root`。
- L2 只对 `tools[name] === 'auto'` 生效（修复「设成 ask/deny 仍被放行」）。
- 嵌套调用（`exec.parent`）两层闸门直接放行，避免 `run_code` 自锁。
- 单测：`npm test` 三套件 14 + 6 + 9 = 29 项全过（规则与状态、闸门、mock ctx 集成）。
- 已注册到 `~/.dsh/profiles/desktop`（`link:` + bundles 第 15 项），pnpm 安装通过，`import('@local/permission-guard')` 可加载；下次启动 DSH 生效。
- 仓库 `git init`，首提交 `2ae699d`。

## 0.1.0 — 2026-11-12（草稿）

- 初版设计稿与可运行骨架：目录白名单 + `tools/execute` 临时扩充 `additionalWritableRoots` + 设置页。
- 未注册 profile，未安装。
