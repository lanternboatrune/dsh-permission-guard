/**
 * 状态持久化与工作区目录扫描。
 *
 * state.json 放在插件目录下（与 integrity-guard 相同的位置），
 * 由 host 侧读写，client 只通过 bridge 间接访问。
 */

import fs from 'node:fs'
import path from 'node:path'

/** 扫描工作区时跳过的目录名。 */
const SKIP_DIRS = new Set(['node_modules', '.git', '.dsh-backup', 'dist', 'build', 'out'])

export function defaultState() {
  return {
    version: 1,
    enabled: true,
    roots: [],
    workspaceSubdirs: {},
    tools: {
      write: 'auto',
      edit: 'auto',
      apply_patch: 'auto',
      pwsh: 'ask',
    },
    options: {
      autoApproveDangerFullAccess: false,
      // 命令工具（pwsh/bash/run_code）提到白名单目录时静默升级沙箱，不再弹审批。
      shellSilent: true,
      // 常驻授权：每个工作区（含以后新建的）整体可写，覆盖其全部子目录。
      trustAllWorkspaces: false,
      logLimit: 200,
    },
  }
}

/** 把任意读到的 JSON 收敛成合法状态（防御手改配置文件）。 */
export function normalizeState(raw) {
  const base = defaultState()
  if (!raw || typeof raw !== 'object') return base
  const out = { ...base, ...raw }

  out.enabled = out.enabled !== false
  const seen = new Set()
  out.roots = Array.isArray(raw.roots)
    ? raw.roots
        .filter((r) => r && typeof r === 'object' && typeof r.path === 'string' && r.path.trim())
        .map((r) => ({
          path: r.path.trim(),
          // 只有明确写 write 才升级；未知/缺省一律降级为只读，避免手改配置误放权。
          access: r.access === 'write' ? 'write' : 'read',
          enabled: r.enabled !== false,
        }))
        .filter((r) => {
          const key = r.path.replace(/\//g, '\\').toLowerCase()
          if (seen.has(key)) return false
          seen.add(key)
          return true
        })
    : []

  // 工作区子目录授权按**绝对路径**存：DSH 可以有多个工作区，
  // 用相对路径会在多工作区之间串台。旧版本的相对键直接丢弃（当时列表是空的，
  // 真实用户数据只会是绝对路径）。
  out.workspaceSubdirs =
    raw.workspaceSubdirs && typeof raw.workspaceSubdirs === 'object' && !Array.isArray(raw.workspaceSubdirs)
      ? Object.fromEntries(
          Object.entries(raw.workspaceSubdirs)
            .filter(([k, v]) => typeof k === 'string' && path.isAbsolute(k) && (v === 'read' || v === 'write'))
            .map(([k, v]) => [k.trim(), v]),
        )
      : {}

  out.tools = { ...base.tools }
  if (raw.tools && typeof raw.tools === 'object') {
    for (const key of Object.keys(base.tools)) {
      const v = raw.tools[key]
      // pwsh 没有 auto：命令工具不参与目录白名单自动放行。
      const allowed = key === 'pwsh' ? ['ask', 'deny'] : ['auto', 'ask', 'deny']
      if (allowed.includes(v)) out.tools[key] = v
    }
  }

  out.options = { ...base.options }
  if (raw.options && typeof raw.options === 'object') {
    if (typeof raw.options.autoApproveDangerFullAccess === 'boolean') {
      out.options.autoApproveDangerFullAccess = raw.options.autoApproveDangerFullAccess
    }
    if (typeof raw.options.shellSilent === 'boolean') {
      out.options.shellSilent = raw.options.shellSilent
    }
    if (typeof raw.options.trustAllWorkspaces === 'boolean') {
      out.options.trustAllWorkspaces = raw.options.trustAllWorkspaces
    }
    if (Number.isFinite(raw.options.logLimit) && raw.options.logLimit > 0) {
      out.options.logLimit = Math.min(2000, Math.floor(raw.options.logLimit))
    }
  }
  return out
}

/**
 * 校验一个待授权的目录是否可安全并入 `additionalWritableRoots`。
 *
 * `dsh-sandbox` 的 `additionalRoot()` 要求：目录存在、且 `realpath === resolve`
 * （不允许 symlink 别名）。不满足时运行期会直接抛错，所以保存前先查。
 *
 * @param {string} input
 * @returns {{ ok: true, path: string } | { ok: false, reason: string }}
 */
export function inspectRoot(input) {
  if (typeof input !== 'string' || !input.trim()) return { ok: false, reason: 'empty path' }
  const resolved = path.resolve(input.trim())
  let real
  try {
    real = fs.realpathSync.native(resolved)
  } catch {
    return { ok: false, reason: 'directory does not exist' }
  }
  let stat
  try {
    stat = fs.statSync(real)
  } catch {
    return { ok: false, reason: 'cannot stat the directory' }
  }
  if (!stat.isDirectory()) return { ok: false, reason: 'not a directory' }
  // Windows 上 realpath 可能改大小写，按小写比较；真正的 symlink 会得到不同路径。
  if (real.toLowerCase() !== resolved.toLowerCase()) {
    return { ok: false, reason: `resolves to a different path (${real}); use the real path` }
  }
  return { ok: true, path: resolved }
}

export function loadState(file) {
  try {
    return normalizeState(JSON.parse(fs.readFileSync(file, 'utf8')))
  } catch {
    return defaultState()
  }
}

export function saveState(file, state) {
  const tmp = `${file}.tmp`
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8')
  fs.renameSync(tmp, file)
}

/**
 * 扫描工作区下的目录，给设置页做「子文件夹一键切换」。
 * @param {string} workspaceRoot
 * @param {number} depth 1 表示只列直接子目录
 * @returns {{ rel: string, name: string }[]}
 */
export function scanWorkspaceDirs(workspaceRoot, depth = 2) {
  const out = []
  const walk = (dir, rel, level) => {
    if (level > depth) return
    let entries
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue
      const childRel = rel ? `${rel}/${entry.name}` : entry.name
      out.push({ rel: childRel, name: entry.name })
      walk(path.join(dir, entry.name), childRel, level + 1)
    }
  }
  walk(workspaceRoot, '', 1)
  return out
}
