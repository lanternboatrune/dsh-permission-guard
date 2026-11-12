/**
 * 规则匹配：判断一次文件写工具调用是否落在已授权的目录里。
 *
 * 设计要点：
 * - 只做「路径包含」判定，不做权限推断；是否授权由 state.json 决定。
 * - Windows 路径大小写不敏感，统一 lower-case 比较。
 * - realpath 在运行时尽量做（目录通常已存在），失败则回落到字面路径。
 */

import fs from 'node:fs'
import path from 'node:path'

/** 会写文件的工具（与 dsh-tool-fs 的工具名一致）。 */
export const FS_WRITE_TOOLS = new Set(['write', 'edit', 'apply_patch'])

/** 命令类工具：白名单不覆盖，仍走沙箱与审批。 */
export const SHELL_TOOLS = new Set(['pwsh', 'bash', 'run_code'])

/** 统一成比较用的键：绝对路径、去掉尾部分隔符、小写（Windows）。 */
export function pathKey(p) {
  if (typeof p !== 'string' || p.trim() === '') return ''
  let out = path.resolve(p)
  try {
    out = fs.realpathSync.native(out)
  } catch {
    // 目标可能还不存在（新建文件），保留 resolve 结果。
  }
  if (out.length > 3 && (out.endsWith(path.sep) || out.endsWith('/'))) out = out.slice(0, -1)
  return process.platform === 'win32' ? out.toLowerCase() : out
}

/** target 是否等于 root 或位于其下。 */
export function isWithin(target, root) {
  const t = pathKey(target)
  const r = pathKey(root)
  if (!t || !r) return false
  if (t === r) return true
  const prefix = r.endsWith(path.sep) ? r : r + path.sep
  return t.startsWith(prefix)
}

/** 任一 target 命中任一根。 */
export function anyWithin(targets, roots) {
  for (const target of targets) {
    for (const root of roots) {
      if (isWithin(target, root)) return true
    }
  }
  return false
}

/**
 * 从工具参数里抽出这次调用要写的路径。
 * @param {string} toolName
 * @param {unknown} args
 * @returns {string[]}
 */
export function extractTargetPaths(toolName, args) {
  if (!args || typeof args !== 'object') return []
  const a = /** @type {Record<string, unknown>} */ (args)
  if (toolName === 'write' || toolName === 'edit') {
    return typeof a.file_path === 'string' ? [a.file_path] : []
  }
  if (toolName === 'apply_patch') {
    const raw = typeof a.input === 'string' ? a.input : typeof a.patch === 'string' ? a.patch : ''
    if (!raw) return []
    // apply_patch 的补丁头：*** Add File: <path> / *** Update File: <path> / *** Delete File: <path>
    const out = []
    for (const line of raw.split(/\r?\n/)) {
      const m = /^\*\*\* (?:Add|Update|Delete) File:\s*(.+?)\s*$/.exec(line)
      if (m) out.push(m[1])
    }
    return out
  }
  return []
}

/**
 * 递归收集参数里的所有字符串（命令工具的 command / workdir / code 等字段名各版本不一）。
 * 只取字符串，不做语义解析：宁可粗一点，也不漏掉 `cd 'D:\x'` 这种写法。
 */
function collectText(value, out, depth = 0) {
  if (depth > 6 || value == null) return out
  if (typeof value === 'string') {
    if (value) out.push(value)
    return out
  }
  if (Array.isArray(value)) {
    for (const item of value) collectText(item, out, depth + 1)
    return out
  }
  if (typeof value === 'object') {
    for (const item of Object.values(value)) collectText(item, out, depth + 1)
  }
  return out
}

/** 路径之后允许出现的字符（视为路径边界）。 */
const BOUNDARY = new Set([
  '\\', '/', ' ', '\t', '\n', '\r', '"', "'", ',', ';', ')', ']', '}', ':', '=', '&', '|', '>', '<', '`', '!', '?', '*',
])

/**
 * 命令工具的参数里是否出现了某个已授权目录。
 *
 * 判定是**字面出现**（大小写不敏感、分隔符统一为 `\`），要求出现位置后紧跟
 * 路径边界，避免 `D:\Dev` 误命中 `D:\Develop`。这是保守的近似：命令里但凡
 * 提到白名单目录就算命中，宁严勿漏（用户明确选择「路径出现或 cwd 命中都算」）。
 *
 * @param {unknown} args 工具参数
 * @param {string[]} roots 已授权的可写目录
 * @returns {string[]} 命中的目录（原样返回，供审计日志）
 */
export function commandHitsRoots(args, roots) {
  if (!Array.isArray(roots) || roots.length === 0) return []
  const parts = collectText(args, [])
  if (parts.length === 0) return []
  const haystack = parts.join('\n').replace(/\//g, '\\').toLowerCase()
  const hits = []
  for (const root of roots) {
    const key = pathKey(root).replace(/\//g, '\\')
    // 盘符根（`d:\`）会匹配一切，拒绝它的白名单语义。
    if (!key || key.length <= 3) continue
    let from = 0
    let matched = false
    while (from <= haystack.length) {
      const at = haystack.indexOf(key, from)
      if (at === -1) break
      const after = at + key.length
      if (after >= haystack.length || BOUNDARY.has(haystack[after])) {
        matched = true
        break
      }
      from = at + 1
    }
    if (matched) hits.push(root)
  }
  return hits
}

/** 合并多个路径列表并去重（按 pathKey）。 */
export function uniquePaths(list) {
  const seen = new Set()
  const out = []
  for (const p of list) {
    if (typeof p !== 'string' || !p.trim()) continue
    const key = pathKey(p)
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(p)
  }
  return out
}
