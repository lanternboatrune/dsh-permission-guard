# dsh-permission-guard · 完整守护

> 状态：**已注册，真机已加载**（2026-11-12）。代码 M1–M5 完成、`npm test` 70 项通过、已以 `link:` 注册到 `~/.dsh/profiles/desktop` 并追加进 `dsh.profile.bundles`；设置页已在真实 DSH 里正常渲染。M5（真机验证放行效果）进行中。
> 0.6.0 起并入原 `integrity-guard`：权限预授权与完整性标签守护合为一个插件、一个设置页，显示名「完整守护」。
> 目标：让 DSH 的权限从「每次弹窗点允许」变成「按目录和操作类型预先授权」，并给一个设置页管理。

## 1. 为什么做这个

用户痛点（2026-11-12）：

- 写项目外的目录（如 `D:\Develop\SoC Tycoon\app\index.html`）时，DSH 要求 `danger-full-access` 完整权限，弹窗频繁；
- 「又不出工作区」—— 明明是固定几个开发目录，不该每次重新批准；
- 需要一个**可解释、可审计、确定性**的权限控制，而不是模型审查（官方 auto-review 耗 token 且不确定）。

## 2. 已核实的 DSH 机制（写代码前必读）

以下结论均来自 `D:\Deepseek\resources\app.asar` 解包源码（提取副本在 `scratch\20261112-asar-dump\pkg\`）。

### 2.1 权限链

1. 工具执行前 waterfall：`tools/pre-execute(exec, next) -> PreToolDecision = {kind:'allow'|'deny'|'cancel'|'ask'}`；
2. 真正执行时可被 **around-dispatch** waterfall 包住：`tools/execute(exec, next) -> ToolExecutionResult`，`exec.name` / `exec.arguments` / `exec.agent` 都可见；
3. 工具 body 内若需要更宽沙箱，会带 `sandbox_permissions` + `justification` 调 `approval.approver.request()` → waterfall `approval/request(req, next)`，`req` 只有 `toolName / callId / reason / displayReason / signal`，**不带工具参数**；
4. `ApprovalOutcome` 只有 `allowed-once / rejected / cancelled / unavailable`，没有「永久允许」；`ApprovalPolicy` 只有 `ask / never`。

### 2.2 文件沙箱

- `dsh-fs-sandbox/lib/index.js:176` `checkedTarget(target, sandboxPolicy)`：`policy = sandboxPolicy ?? ctx.sandboxPolicy.resolve()`；
  `workspace-write` 时 `writableRoots(policy)` 必须包含目标（canonical realpath 比较）。
- `dsh-sandbox/lib/index.js:225` `workspaceWritableRoots(policy)` = `[canonical(workspaceRoot), ...(policy.additionalWritableRoots ?? []).map(additionalRoot)]`；`writableRoots` 再加 `/tmp` 与 `os.tmpdir()`。
- `dsh-sandbox-policy/lib/index.js:166` `resolve(request)` **每次调用都读 `this.additionalWritableRoots`** → 插件运行时整体重赋值该字段即可生效，无需改配置/重启。
- `dsh-tool-fs/lib/index.js:1904` `resolvePolicy()` = `this.policy.resolve({ session })`，再把结果传给 `ctx.fs.writeText(..., sandboxPolicy)`。
- **Windows 硬约束**：`dsh-sandbox-local/lib/index.js:360`
  `if (policy.mode === 'workspace-write' && (policy.additionalWritableRoots?.length ?? 0) > 0) throw new SandboxUnsupportedPolicyError('Windows ACL confinement does not support additional writable directories...')`
  → 在 Windows 上**全局**设置 `additionalWritableRoots` 会让所有命令（pwsh/bash）直接抛错。

### 2.3 结论

「扩充可写目录」必须**只对文件工具（write/edit/apply_patch）临时生效**：

```
tools/execute (fs 写工具)
  ├─ 命中白名单根 → 临时把 root 并进 sandboxPolicy.additionalWritableRoots（引用计数）
  ├─ await next()   ← 这里 write/edit 的 checkedTarget 看到的是扩充后的 policy
  └─ finally 恢复    ← 命令工具（pwsh）永远看不到 additionalWritableRoots，不会触发 Windows 限制
```

不采用「永久改字段」：那会让 pwsh 全面失效，而 pwsh 写外部目录本来也绕不过 Windows ACL 限制。

### 2.3b 命令工具只能走「升级模式」

`dsh-tool-pwsh/lib/index.js:630` 在 **execute 内部**才 `resolveSandboxPolicy(exec)`，然后

```js
const approvedMode = args.sandbox_permissions && args.justification
  ? await approvePwshEscalation(...)   // → approval/request → 弹窗
  : undefined
const policy = approvedMode ? {...standingPolicy, mode: approvedMode} : standingPolicy
```

所以命令工具（pwsh/bash/run_code）**没有** `additionalWritableRoots` 这条路，唯一手段是模式升级。插件在 `next()` 期间临时包装 `sandboxPolicy.resolve()`：只对 `resolved.sessionId === 当前会话` 的调用返回 `danger-full-access`，结束后恢复原方法（原型方法则删除自有属性）。命令若自带 `sandbox_permissions`，其 `approval/request` 由 callId 白条静默应答，不进 UI。

## 3. 方案：四层闸门

| 层 | 钩子 | 作用 |
|---|---|---|
| L1 类型规则 | `tools/pre-execute` | 只做一件事：`state.tools[name] === 'deny'` → `{kind:'deny', reason}`；其余一律 `next()`。`ask` 不需要在这里表达——不注入白名单就等于走正常审批 |
| L2 白名单注入 | `tools/execute` | **仅当** `FS_WRITE_TOOLS` 且 `tools[name] === 'auto'` 且目标命中白名单根时，临时扩充 `additionalWritableRoots`（见 2.3），实现**免弹窗** |
| L2b 命令放行 | `tools/execute` | **仅当** `SHELL_TOOLS`（`pwsh`/`bash`/`run_code`）时独占 `lib/gate.js` 的 exclusive 锁；若命令文本提到白名单目录（或 workdir 在其内）且 `options.shellSilent !== false`，在 `next()` 期间让本会话解析到 `danger-full-access`（见 2.3b），并挂 callId 白条 |
| L3 审批兜底 | `approval/request` | 两级：① 命令工具的 callId 白条 → `allowed-once`（静默，不进 UI）；② `options.autoApproveDangerFullAccess === true` 时，fs 写工具请求 `danger-full-access`/`workspace-write` 且白名单非空 → `allowed-once`。其余 `next()` |

`lib/gate.js` 是公平读写锁：fs 写窗口 = `shared`（多个写并发），命令工具 = `exclusive`（等窗口全关才进入，且排队期间后来者不插队）。嵌套调用（`exec.parent` 存在，即 `run_code` 内部）两层闸门都直接放行，避免自锁。

命令匹配（`lib/rules.js:commandHitsRoots`）是**字面近似**：大小写不敏感、`/` 归一为 `\`、要求路径后紧跟边界字符（`D:\Dev` 不命中 `D:\Develop`）；盘符根（`D:\`）不参与匹配。命令里只要**提到**白名单目录就算命中，宁严勿漏——代价是日志里打印了该路径的命令也会被放行。

## 4. 规则模型（state.json）

```jsonc
{
  "version": 1,
  "enabled": true,
  // 目录级授权
  "roots": [
    { "path": "D:\\Develop\\SoC Tycoon", "access": "write", "enabled": true },
    { "path": "D:\\Develop\\Servers",     "access": "read",  "enabled": true }
  ],
  // 工作区子目录一键切换：键是**绝对路径**（DSH 可以有多个工作区，
  // 用相对路径会串台），值 read|write
  "workspaceSubdirs": {
    "C:\\Users\\wuyux\\Documents\\deepseek-harness\\default-workspace\\develop-plugins": "write",
    "D:\\Develop\\OtherWorkspace\\app": "write"
  },
  // 工具类型开关
  "tools": {
    "write": "auto",        // auto | ask | deny
    "edit": "auto",
    "apply_patch": "auto",
    "pwsh": "ask"           // ask | deny（命令放行由 options.shellSilent 控制）
  },
  // 安全选项
  "options": {
    "autoApproveDangerFullAccess": false,
    "shellSilent": true,    // 命令命中白名单时静默升级，默认开
    "trustAllWorkspaces": false, // 常驻：每个工作区（含以后新建的）整棵树可写
    "logLimit": 200
  }
}
```

> 「整个工作区可写」不必逐个子目录勾选：直接把**工作区根目录的绝对路径**写进 `workspaceSubdirs`（`"D:\\Develop\\ProjectA": "write"`）即可，宿主用前缀判定，天然覆盖全部子目录（包括以后新建的）。`options.trustAllWorkspaces` 则是常驻版：每次计算可写目录时现查 `workspaceRegistry`，新加的工作区自动在内。

- `access` 语义：
  - `read`：只允许读（当前沙箱不限制读，留作未来 enforcement）；
  - `write`：允许写（= 进入 `additionalWritableRoots`）；
  - 不配置的目录 = 原行为。
- **归一化是保守的**（`lib/state.js` `normalizeState`）：只有明确写 `"write"` 才升级；缺省或未知值**降级为 `read`**；路径去重（大小写/斜杠不敏感）；`pwsh` 只接受 `ask`/`deny`，写成 `auto` 会被纠正回 `ask`；`autoApproveDangerFullAccess` 只认严格 `true`（手改成 `1` 视为关闭）。

## 5. 设置页（client.js）

注册 `settings.section`（与 integrity-guard 同模板）。页面分两层，避免一屏塞满：

**顶部固定**：一句话说明 + 当前工作区（含 `workspaceSource` 回落标注）+「刷新」+ 右侧「启用」开关。

**横向标签页**（样式对齐 DSH 会话面板的「对话 / 阅读 / 轨迹」）：

1. **目录**（默认页，标签上带「外部目录 + 已授权子目录」的条数）：
   - 外部目录白名单：路径输入添加（回车或按钮）、`只读/可写` 切换、`×` 删除；
   - 顶部一条 banner：**三态控件「不放开 / 全部可写 / 常驻可写」**。「全部可写」立刻把注册表里各工作区的根键写进 `workspaceSubdirs` 并保存；「常驻可写」另外打开 `options.trustAllWorkspaces`（常驻，含以后新建的工作区）。宿主是旧版（没有 `workspaces` 字段）时，「常驻」的意图会先暂存在 `localStorage: permission-guard.pendingTrust`，当次仍按「全部可写」生效，重启 DSH 换上新宿主后第一次打开设置页自动补写并清掉暂存；
   - 工作区：按 `ctx.workspaceRegistry.list()` 列出的**每个工作区**各渲染一块（标题=工作区标题，副标题=真实路径）。块头右侧有「全部可写 / 清除」，块内第一行是「整个工作区（含全部子目录）」三态行（授权键=工作区根绝对路径，一个键覆盖整棵树）；这一行设为可写后，下面逐个子目录的行会收成一句「已覆盖」提示，不再逐条列出。未覆盖时列出该工作区下 2 层目录（跳过 `node_modules/.git/.dsh-backup/dist/build/out` 与点目录），每行三态 `— / 只读 / 可写`，点一下即存；空列表时有说明文案。注册表不可用时退化成「当前会话工作区」一块。
2. **工具**：按操作类型（`write / edit / apply_patch` 三态 `auto/ask/deny`，`pwsh` 两态 `ask/deny`）+ 命令工具开关（`options.shellSilent`，默认开）。
3. **日志**（标签上带条数）：最近 80 条审计记录，空时显示「暂无记录」。

页签状态存在组件内，切走再回来仍是上次那一页。

宿主桥：单端点 `POST /permission-guard/bridge`（`{action:'get'|'set'|'reload', patch?}`），仅接受本地回环地址（`isLocal`），响应附带 `state / workspaces / workspaceRoot / workspaceSource / log`。

## 6. 安全边界（写进实现）

- 白名单目录 = 用户**显式**授权整棵子树可写，插件只执行、不推断；
- **命令放行 = 信任该目录里的代码**：`shellSilent` 开启后，命中白名单的命令以 `danger-full-access` 运行（Windows 上没有更窄的路，见 2.3b）。关掉它只影响命令，文件写入仍免弹窗；
- `danger-full-access` 对 fs 写工具默认**不**自动批准，避免「一次配置 = 全盘授权」；
- 作用域只在**当前会话**：`resolve()` 包装按 `sessionId` 过滤，其他会话与 agentless 调用不受影响；
- 所有自动决策写审计日志（`shell-silent` / `approval` / `extend` / `deny` / `skip-root`）；
- 插件不改 `sandboxPolicy.mode`、不改 approval 政策，只做「目录 + 工具类型」这一层。

## 7. 里程碑

| 阶段 | 内容 | 状态 |
|---|---|---|
| M0 | 核实机制、写设计稿（本文件） | 完成 |
| M1 | host 侧：规则加载 + `tools/execute` 白名单注入 + 审计日志 | 完成（冒烟 11/11） |
| M2 | 设置页 UI（读写 state、扫描工作区子目录） | 完成（未在真实 DSH 里渲染过） |
| M3 | `approval/request` 兜底 + 类型规则 + 并发闸门 | 完成（规则 24/24、闸门 6/6、集成 18/18） |
| M4 | 命令工具静默放行（`withFullAccess` + callId 白条 + 设置项） | 完成（2026-11-12，测试覆盖 S7–S10） |
| M5 | 多工作区 + 页签化设置页 + 整工作区一键授权 / 常驻授权 | 完成（0.5.0，测试 70 项，覆盖 S11–S14） |
| M6 | 注册 profile（已完成 2026-11-12）、重启验证放行效果 | 待重启验证 |

## 8. 待验证问题 / 已知风险

1. `apply_patch` 在 `dsh-tool-fs` 里是 `Config.applyPatch` 默认 `false`（源码已核实）；若当前 profile 未启用，`lib/rules.js` 的补丁路径解析就是死代码，不影响 `write`/`edit`；
2. 引用计数：两个 fs 写并发时 `inflight` 0→1→2，只有最后一次 settle 恢复 `savedRoots`，不会互相覆盖（已按此实现，未做并发压测）；
3. `tools/execute` 里改字段对 `checkedTarget` 是否立即可见：`dsh-fs-sandbox` 每次 `policy.resolve()` 读字段，**应**可见；这是 M4 真机验证的第一项，失败则整条 L2 思路要换；
4. 设置页 slots API 版本与 integrity-guard 同机同版本，预期一致，但 `settings.section.icon` 是否存在需真机确认；
5. **Windows 并发（已缓解）**：L2 的临时窗口内 `additionalWritableRoots` 非空；若此时另一个会话跑 `pwsh`，`dsh-sandbox-local:360` 会抛 `SandboxUnsupportedPolicyError`。现在由 `lib/gate.js` 串行化：命令工具独占、fs 写窗口共享，且嵌套调用放行避免自锁。代价是**长命令运行期间文件写入会排队等待**（正确性换延迟）；若体验不可接受，替代方案是让命令工具只在 `confine` 前短暂独占，但 `confine` 发生在工具 body 内部，插件拿不到那个时刻，故未采用。
6. 保存时校验：可写目录必须存在、是目录、且 `realpath === resolve`（非 symlink/8.3 别名），否则 `POST /bridge` 返回 400 和逐条原因；手改 state.json 的非法目录会在运行期被 `writableRoots()` 跳过并记一条 `skip-root` 日志。
7. 审批兜底（L3 第二级）的 `ApprovalRequestEvent` 不带目标路径，所以它只能按「工具类型 + 白名单非空」放行，粒度比 L2 粗 —— 这也是默认关闭它的原因。第一级（callId 白条）不受此限：白条由 `tools/execute` 在看见完整参数后登记，10 分钟自动过期。
8. `withFullAccess` 包装的是**服务实例上的 `resolve` 方法**（可能来自原型链，恢复时区分自有属性）。它在进程内是共享的，因此包装期间的其他会话理论上会看到被包装的 `resolve`；作用域过滤（`sessionId` + 显式 `mode` 直通）保证它们拿到的策略不变。
9. 命令匹配是字面近似：**字符串里出现白名单路径就算命中**（例如命令 `echo "D:\Develop\SoC Tycoon"`）。宁可多放行也不漏放行是用户明确选择；如果以后想收紧，可改成只认 `cd` / `workdir` / 已知参数位。
10. 静默放行的命令以 full access 运行，**不受沙箱保护**：它能写任何位置。这是「信任该目录的代码」的直接后果，不是插件能消除的——Windows ACL confinement 不支持附加可写目录（2.2），而命令需要写外部目录只能升级。

## 9. 本地验证（不需要安装）

```bash
cd develop-plugins/dsh-permission-guard
npm test        # 三个套件：规则与状态 29 项、闸门 6 项、mock 集成 35 项（共 70）
node --check index.js && node --check client.js
```

`test/hooks.test.mjs` 用一个 mock `ctx`（`get / on / effect / inject` + 假 `sandboxPolicy`）驱动真实的 `installHooks`，断言：白名单命中时注入、`ask` 不注入、`deny` 拦截、写窗口期间命令工具排队、审批兜底开/关两种结果、嵌套调用不注入。它不会加载 DSH 运行时，也不碰 profile。

## 10. 完整性标签守护（0.6.0 并入）

原 `integrity-guard` 的全部能力已搬进 `lib/integrity.js`（配 `lib/acl.js`、`lib/scan-paths.js`），宿主 `apply()` 里直接调 `applyIntegrity(ctx)`；桥接路由仍为 `/integrity-guard/bridge`，状态另存 `integrity-state.json`，与权限的 `state.json` 互不覆盖。

它解决的是另一个问题：DSH 沙箱会把会话工作区标成 Low 完整性，标签会继承给整棵目录树，从这些目录跑出来的安装器写不了 `%TEMP%` / `%AppData%`。插件在启动后 15 秒、会话全部结束、以及收到 `agent/disposed` / `session/disposed` 后扫一遍，把不该带 Low 的目录改回 Medium；默认工作区、活动会话目录与插件自身永不触碰。

- 扫描范围：用户文件夹六项 + 所有登记工作区 + 设置里追加的根，按 `depth` 展开，每轮最多 400 个目录。
- 改标签需要管理员权限：普通进程执行 `icacls /setintegritylevel` 会被拒绝。插件会把失败原因逐条显示，并提示需要管理员；设置页的「以管理员修复」会弹 UAC，确认后由提权进程一次性改回 Medium，取消则保留原状并给出原因。
- 设置页在「完整性」标签页：总开关、展开深度、额外根、允许保留 Low 的根、最近扫描摘要与最近记录。
