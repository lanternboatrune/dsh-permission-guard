/**
 * permission-guard —— 按目录与工具类型预先授权 DSH 的文件写入
 *
 * 背景：写项目外的固定开发目录（如 D:\Develop\SoC Tycoon）时，DSH 每次都要
 * 弹「允许本次操作使用 danger-full-access 权限」的审批。用户要的是：目录
 * 事先授权、写文件直接过、该目录里的命令（build/npm/git）也直接跑完，
 * 并且能在设置页里改。
 *
 * 机制（已核实，见 README §2）：
 * - `tools/execute` 是 around-dispatch waterfall：`(exec, next)`，可包住整个
 *   工具执行。插件只对 fs 写工具在 next() 期间把白名单根临时并入
 *   `sandboxPolicy.additionalWritableRoots`，finally 恢复。
 * - 不永久改字段：Windows ACL 沙箱遇到 workspace-write + additionalWritableRoots
 *   会抛 SandboxUnsupportedPolicyError（dsh-sandbox-local/lib/index.js:360），
 *   永久设置会让所有 pwsh/bash 命令失效。
 * - 命令工具（pwsh/bash/run_code）没有 additionalWritableRoots 这条路，只能升级
 *   模式；插件在 next() 期间临时包装 `sandboxPolicy.resolve()`，只对当前会话返回
 *   danger-full-access（dsh-tool-pwsh/lib/index.js:630 在 execute 内才 resolve）。
 * - `approval/request` 兜底：命令自己带 sandbox_permissions 时按 callId 白条静默
 *   应答；fs 写工具的自动批准另由 autoApproveDangerFullAccess 控制，默认关闭。
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defaultState, loadState, saveState, normalizeState, scanWorkspaceDirs, inspectRoot } from './lib/state.js'
import { FS_WRITE_TOOLS, SHELL_TOOLS, extractTargetPaths, anyWithin, uniquePaths, commandHitsRoots } from './lib/rules.js'
import { createGate } from './lib/gate.js'
import { applyIntegrity } from './lib/integrity.js'

export const name = 'permission-guard'
export const inject = ['webServer']

const PLUGIN_DIR = path.dirname(fileURLToPath(import.meta.url))
const STATE_FILE = path.join(PLUGIN_DIR, 'state.json')
const BRIDGE_PATH = '/permission-guard/bridge'

// ── 运行时 ──────────────────────────────────────────────────

function createRuntime(ctx) {
  let state = loadState(STATE_FILE)
  const log = []

  /** 引用计数：并发的 fs 写可能同时扩展/恢复 additionalWritableRoots。 */
  let inflight = 0
  let savedRoots

  /** fs 写窗口与命令工具互斥，避免 Windows ACL 看到非空的 additionalWritableRoots。 */
  const gate = createGate()
  let warnedRoots = new Set()

  /** 已决定静默放行的命令调用（callId），供 approval/request 兜底应答。 */
  const escalationAllowed = new Set()

  /** withFullAccess 的嵌套计数与原始 resolve（可能来自原型链）。 */
  let fullAccessDepth = 0
  let savedResolve
  let savedResolveOwn

  function remember(entry) {
    log.push({ at: Date.now(), ...entry })
    const limit = state.options?.logLimit ?? 200
    if (log.length > limit) log.splice(0, log.length - limit)
  }

  function reload() {
    state = loadState(STATE_FILE)
    return state
  }

  function update(nextState) {
    state = normalizeState(nextState)
    saveState(STATE_FILE, state)
    return state
  }

  function sandboxPolicy() {
    try {
      return ctx.get('sandboxPolicy')
    } catch {
      return undefined
    }
  }

  /** 最近一次见过工具调用的会话（工具钩子里实时更新，最贴近「当前在用的会话」）。 */
  let lastSession

  function noteSession(session) {
    if (session && typeof session === 'object' && session.header) lastSession = session
  }

  function service(name) {
    try {
      return ctx.get(name)
    } catch {
      return undefined
    }
  }

  /** 主会话（排除子代理会话）：按创建时间倒序。 */
  function liveSessions() {
    const store = service('sessions')
    if (!store || typeof store.list !== 'function') return []
    let list
    try {
      list = store.list()
    } catch {
      return []
    }
    if (!Array.isArray(list)) return []
    return list
      .filter((s) => s?.header?.cwd && !s.header.parentSession && s.header.origin !== 'subagent')
      .sort((a, b) => (b.header.createdAt ?? 0) - (a.header.createdAt ?? 0))
  }

  function directoryOf(session) {
    const wd = service('workingDirectory')
    if (wd && typeof wd.get === 'function') {
      try {
        const value = wd.get(session)
        if (typeof value === 'string' && value) return value
      } catch {
        // 回落
      }
    }
    if (typeof session?.header?.cwd === 'string' && session.header.cwd) return session.header.cwd
    return undefined
  }

  /**
   * 工作区根目录 + 来源。
   *
   * 注意：`sandboxPolicy.resolve()` 在没有会话上下文时回落到 host 进程的 cwd
   * （本机是 `~/.dsh/profiles/desktop`），所以绝不能把它当第一来源——必须先从
   * 会话拿 `header.cwd` / `workingDirectory.get(session)`。
   */
  function resolveWorkspace() {
    if (lastSession) {
      const dir = directoryOf(lastSession)
      if (dir) return { path: dir, source: 'session' }
    }
    for (const session of liveSessions()) {
      const dir = directoryOf(session)
      if (dir) return { path: dir, source: 'session' }
    }
    const wd = service('workingDirectory')
    if (typeof wd?.defaultDirectory === 'string' && wd.defaultDirectory) {
      return { path: wd.defaultDirectory, source: 'default' }
    }
    try {
      const resolved = sandboxPolicy()?.resolve?.()
      if (resolved?.workspaceRoot) return { path: resolved.workspaceRoot, source: 'default' }
    } catch {
      // 回落
    }
    return { path: process.cwd(), source: 'default' }
  }

  function workspaceRoot() {
    return resolveWorkspace().path
  }

  /**
   * DSH 可以有多个工作区（`workspaceRegistry` 是可持久注册表），
   * 每个工作区都要能单独设置子目录权限 —— 所以这里返回完整列表。
   * 注册表不可用时就退化成「当前会话工作区」一个。
   */
  function workspaceList() {
    const registry = service('workspaceRegistry')
    if (registry && typeof registry.list === 'function') {
      try {
        const list = registry.list()
        if (Array.isArray(list) && list.length > 0) {
          return list
            .filter((w) => typeof w?.path === 'string' && w.path)
            .map((w) => ({ id: String(w.id ?? w.path), path: w.path, title: typeof w.title === 'string' && w.title ? w.title : path.basename(w.path) }))
        }
      } catch {
        // 回落
      }
    }
    const fallback = resolveWorkspace().path
    return [{ id: fallback, path: fallback, title: path.basename(fallback) || fallback }]
  }

  /** 用户显式授权可写的目录（绝对路径，已校验真实存在且非 symlink 别名）。 */
  function writableRoots() {
    const candidates = state.roots
      .filter((r) => r.enabled !== false && r.access === 'write')
      .map((r) => r.path)
    // 工作区子目录授权：键就是绝对路径，多工作区天然不串台。
    for (const [abs, access] of Object.entries(state.workspaceSubdirs)) {
      if (access === 'write') candidates.push(abs)
    }
    // 常驻授权：整个工作区可写。注册表每次现取，所以新开的工作区也自动在内。
    if (state.options?.trustAllWorkspaces) {
      for (const ws of workspaceList()) candidates.push(ws.path)
    }
    const roots = []
    for (const candidate of uniquePaths(candidates)) {
      const checked = inspectRoot(candidate)
      if (checked.ok) {
        roots.push(checked.path)
        continue
      }
      // 只警告一次，避免每次写都刷日志；运行期不把非法目录并进策略。
      const key = `${candidate}|${checked.reason}`
      if (!warnedRoots.has(key)) {
        warnedRoots.add(key)
        remember({ kind: 'skip-root', path: candidate, reason: checked.reason })
      }
    }
    return roots
  }

  /**
   * 在 `fn()` 执行期间把 roots 临时并入 additionalWritableRoots。
   * 命令工具（pwsh/bash）不会经过这里，因此不受 Windows ACL 限制影响。
   */
  function withExtraRoots(roots, fn) {
    const policy = sandboxPolicy()
    if (!policy || roots.length === 0) return fn()
    if (inflight === 0) savedRoots = policy.additionalWritableRoots
    inflight += 1
    policy.additionalWritableRoots = Object.freeze(uniquePaths([...(savedRoots ?? []), ...roots]))
    const settle = () => {
      inflight -= 1
      if (inflight === 0) {
        policy.additionalWritableRoots = savedRoots
        savedRoots = undefined
      }
    }
    let result
    try {
      result = fn()
    } catch (error) {
      settle()
      throw error
    }
    return Promise.resolve(result).finally(settle)
  }

  /**
   * 在 `fn()` 执行期间，让**指定的这一个会话**解析到 danger-full-access。
   *
   * 为什么必须是这个办法：Windows ACL confinement 不支持 additionalWritableRoots
   * （dsh-sandbox-local/lib/index.js:360 会直接抛错），所以工作区外的命令只有
   * 「升级模式」一条路。而 `dsh-tool-pwsh` 在 execute 里才 `resolve()` 策略
   * （lib/index.js:630），包住 next() 就够了。
   *
   * 作用域：包装后的 `resolve()` 只放宽 `resolved.sessionId === sessionId`
   * 的调用；其他会话、agentless 调用、以及显式传了 `mode` 的调用一律原样返回。
   * 结束时恢复原方法（原型上的方法就删掉自有属性，避免留下补丁）。
   */
  function withFullAccess(sessionId, fn) {
    const policy = sandboxPolicy()
    if (!policy || typeof policy.resolve !== 'function' || !sessionId) return fn()
    if (fullAccessDepth === 0) {
      savedResolveOwn = Object.prototype.hasOwnProperty.call(policy, 'resolve')
      savedResolve = policy.resolve
      const base = savedResolve
      policy.resolve = function resolveWithFullAccess(request = {}) {
        const resolved = base.call(this, request)
        if (!resolved || typeof resolved !== 'object') return resolved
        if (request.mode !== undefined) return resolved
        if (resolved.sessionId !== sessionId) return resolved
        if (resolved.mode === 'danger-full-access') return resolved
        const { additionalWritableRoots, ...rest } = resolved
        return { ...rest, mode: 'danger-full-access' }
      }
    }
    fullAccessDepth += 1
    const settle = () => {
      fullAccessDepth -= 1
      if (fullAccessDepth > 0) return
      if (savedResolveOwn) policy.resolve = savedResolve
      else delete policy.resolve
      savedResolve = undefined
      savedResolveOwn = undefined
    }
    let result
    try {
      result = fn()
    } catch (error) {
      settle()
      throw error
    }
    return Promise.resolve(result).finally(settle)
  }

  /** 登记/取走「这次调用允许静默升级」。 */
  function allowEscalation(callId) {
    if (typeof callId !== 'string' || !callId) return
    escalationAllowed.add(callId)
    // 兜底：10 分钟后自动失效，避免异常路径留下永不过期的白条。
    const timer = setTimeout(() => escalationAllowed.delete(callId), 10 * 60 * 1000)
    timer.unref?.()
  }

  function takeEscalation(callId) {
    if (typeof callId !== 'string' || !escalationAllowed.has(callId)) return false
    escalationAllowed.delete(callId)
    return true
  }

  function forgetEscalation(callId) {
    if (typeof callId === 'string') escalationAllowed.delete(callId)
  }

  return {
    get state() {
      return state
    },
    log,
    gate,
    remember,
    reload,
    update,
    writableRoots,
    withExtraRoots,
    withFullAccess,
    allowEscalation,
    takeEscalation,
    forgetEscalation,
    workspaceRoot,
    resolveWorkspace,
    workspaceList,
    noteSession,
  }
}

// ── 钩子 ────────────────────────────────────────────────────

function installHooks(ctx, rt) {
  /** 命中白名单的命令工具自己发起的升级请求：直接放行，不惊动 UI。 */
  const takeEscalation = (req) => {
    if (!req?.callId) return false
    if (!rt.takeEscalation(req.callId)) return false
    rt.remember({ kind: 'approval', toolName: req.toolName, mode: 'silent', outcome: 'allowed-once' })
    return true
  }

  // L2：fs 写工具执行期间临时扩充可写根 → 免弹窗
  try {
    ctx.effect(
      function* () {
        yield ctx.on(
          'tools/execute',
          async (exec, next) => {
            rt.noteSession(exec.agent?.session)
            if (!rt.state.enabled) return next()
            if (!FS_WRITE_TOOLS.has(exec.name)) return next()
            // run_code 内部的嵌套调用：外层已受 ACL 约束，注入只会制造不一致。
            if (exec.parent) return next()
            // 只有 auto 才参与目录白名单；ask 走正常审批，deny 由 pre-execute 拦。
            if (rt.state.tools?.[exec.name] !== 'auto') return next()
            const targets = extractTargetPaths(exec.name, exec.arguments)
            if (targets.length === 0) return next()
            const roots = rt.writableRoots()
            if (!anyWithin(targets, roots)) return next()
            const hits = roots.filter((root) => anyWithin(targets, [root]))
            rt.remember({ kind: 'extend', toolName: exec.name, targets, roots: hits })
            // shared：多个 fs 写可并发；命令工具（exclusive）会等窗口关闭。
            const release = await rt.gate.acquire('shared')
            try {
              return await rt.withExtraRoots(hits, () => next())
            } finally {
              release()
            }
          },
          { prepend: true },
        )
      },
      'permission-guard: fs dispatch',
    )
  } catch (error) {
    rt.remember({ kind: 'error', message: `注册 tools/execute 失败：${error?.message ?? error}` })
  }

  // L2b：命令工具 —— 独占执行；命中白名单则静默升级，模型用不着再请求 full access
  try {
    ctx.effect(
      function* () {
        yield ctx.on(
          'tools/execute',
          async (exec, next) => {
            rt.noteSession(exec.agent?.session)
            if (!rt.state.enabled) return next()
            if (!SHELL_TOOLS.has(exec.name)) return next()
            if (exec.parent) return next()
            const silent = rt.state.options?.shellSilent !== false && rt.state.tools?.[exec.name] !== 'deny'
            const sessionId = exec.agent?.session?.id
            let hits = []
            if (silent && sessionId) {
              const roots = rt.writableRoots()
              if (roots.length > 0) hits = commandHitsRoots(exec.arguments, roots)
            }
            const release = await rt.gate.acquire('exclusive')
            try {
              if (hits.length === 0) return await next()
              // 先挂白条：命令自己带 sandbox_permissions 时，pwsh 会在 execute 内部
              // 走 approveEscalation，L3 靠这张白条直接应答，不进 UI。
              rt.allowEscalation(exec.callId)
              rt.remember({ kind: 'shell-silent', toolName: exec.name, roots: hits })
              try {
                return await rt.withFullAccess(sessionId, () => next())
              } finally {
                rt.forgetEscalation(exec.callId)
              }
            } finally {
              release()
            }
          },
          { prepend: true },
        )
      },
      'permission-guard: shell dispatch',
    )
  } catch (error) {
    rt.remember({ kind: 'error', message: `注册 shell 执行钩子失败：${error?.message ?? error}` })
  }

  // L1：类型规则 —— deny 直接拦截；ask/auto 交给下游
  try {
    ctx.effect(
      function* () {
        yield ctx.on(
          'tools/pre-execute',
          async (exec, next) => {
            rt.noteSession(exec.agent?.session)
            if (!rt.state.enabled) return next()
            if (rt.state.tools?.[exec.name] !== 'deny') return next()
            rt.remember({ kind: 'deny', toolName: exec.name })
            return { kind: 'deny', reason: `permission-guard: tool "${exec.name}" is disabled by the permission-guard settings` }
          },
          { prepend: true },
        )
      },
      'permission-guard: type rules',
    )
  } catch (error) {
    rt.remember({ kind: 'error', message: `注册 tools/pre-execute 失败：${error?.message ?? error}` })
  }

  // L3：审批兜底（默认关闭 danger-full-access 自动批准）
  try {
    ctx.effect(
      function* () {
        yield ctx.on(
          'approval/request',
          async (req, next) => {
            if (!rt.state.enabled) return next()
            // 命令工具命中白名单：静默应答它自己发起的 escalation，不进 UI。
            if (takeEscalation(req)) return 'allowed-once'
            if (!rt.state.options?.autoApproveDangerFullAccess) return next()
            const reason = typeof req.reason === 'string' ? req.reason : ''
            const matched = /^escalate sandbox to ([\w-]+)/.exec(reason)
            if (!matched) return next()
            const mode = matched[1]
            if (mode !== 'danger-full-access' && mode !== 'workspace-write') return next()
            if (!FS_WRITE_TOOLS.has(req.toolName)) return next()
            if (rt.writableRoots().length === 0) return next()
            rt.remember({ kind: 'approval', toolName: req.toolName, mode, outcome: 'allowed-once' })
            return 'allowed-once'
          },
          { prepend: true },
        )
      },
      'permission-guard: approval fallback',
    )
  } catch (error) {
    rt.remember({ kind: 'error', message: `注册 approval/request 失败：${error?.message ?? error}` })
  }
}

// ── 本地 HTTP 桥（设置页用） ────────────────────────────────

const isLocal = (req) => {
  const addr = req?.socket?.remoteAddress ?? ''
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1'
}

const readJsonBody = (req) =>
  new Promise((resolve) => {
    const chunks = []
    let size = 0
    let done = false
    const finish = (value) => {
      if (done) return
      done = true
      resolve(value)
    }
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > 1024 * 1024) {
        req.destroy()
        finish(null)
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      try {
        finish(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch {
        finish(null)
      }
    })
    req.on('error', () => finish(null))
  })

const writeJson = (res, status, payload) => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(payload))
}

function snapshot(rt, extra = {}) {
  const resolved = rt.resolveWorkspace()
  const workspaces = rt.workspaceList().map((ws) => ({
    id: ws.id,
    title: ws.title,
    path: ws.path,
    dirs: scanWorkspaceDirs(ws.path).map((dir) => ({ rel: dir.rel, abs: path.join(ws.path, dir.rel) })),
  }))
  return {
    ok: true,
    state: rt.state,
    workspaceRoot: resolved.path,
    workspaceSource: resolved.source,
    workspaces,
    log: rt.log.slice(-80),
    ...extra,
  }
}

function registerBridge(ctx, rt) {
  ctx.inject(['webServer'], (sctx) => {
    sctx.effect(
      () =>
        sctx.webServer.register({
          kind: 'exact',
          path: BRIDGE_PATH,
          handler: async (req, res) => {
            if (!isLocal(req)) {
              writeJson(res, 403, { ok: false, error: 'local requests only' })
              return
            }
            if (req.method !== 'POST') {
              writeJson(res, 405, { ok: false, error: 'POST only' })
              return
            }
            const body = await readJsonBody(req)
            if (!body || typeof body !== 'object') {
              writeJson(res, 400, { ok: false, error: 'malformed JSON body' })
              return
            }
            const action = body.action === undefined ? 'get' : body.action

            if (action === 'get') {
              writeJson(res, 200, snapshot(rt))
              return
            }
            if (action === 'set') {
              const patch = body.patch && typeof body.patch === 'object' ? body.patch : {}
              const next = { ...rt.state, ...patch }
              // 数组/对象字段整体替换，避免浅合并出脏数据
              for (const key of ['roots', 'workspaceSubdirs', 'tools', 'options']) {
                if (patch[key] !== undefined) next[key] = patch[key]
              }
              const normalized = normalizeState(next)
              // 新增/改写的可写目录必须真实存在且不是 symlink 别名，否则运行期会抛错。
              const invalid = [
                ...normalized.roots
                  .filter((r) => r.enabled !== false && r.access === 'write')
                  .map((r) => r.path),
                ...Object.entries(normalized.workspaceSubdirs)
                  .filter(([, access]) => access === 'write')
                  .map(([abs]) => abs),
              ]
                .map((p) => ({ path: p, checked: inspectRoot(p) }))
                .filter((item) => !item.checked.ok)
              if (invalid.length > 0) {
                writeJson(res, 400, {
                  ok: false,
                  error: `invalid writable root(s): ${invalid
                    .map((item) => `${item.path} (${item.checked.reason})`)
                    .join('; ')}`,
                  invalid: invalid.map((item) => ({ path: item.path, reason: item.checked.reason })),
                })
                return
              }
              rt.update(normalized)
              writeJson(res, 200, snapshot(rt))
              return
            }
            if (action === 'reload') {
              rt.reload()
              writeJson(res, 200, snapshot(rt))
              return
            }
            writeJson(res, 400, { ok: false, error: `unknown action "${String(action)}"` })
          },
        }),
      'permission-guard.bridge()',
    )
  })
}

// ── 插件入口 ────────────────────────────────────────────────

export function apply(ctx) {
  const rt = createRuntime(ctx)
  installHooks(ctx, rt)
  registerBridge(ctx, rt)
  applyIntegrity(ctx)
}

// 供本地测试直接驱动（不注册 profile、不依赖真实 DSH 运行时）。
export { createRuntime, installHooks, registerBridge }
