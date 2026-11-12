/**
 * 读写闸门：把「临时扩充可写根」的窗口与命令工具的执行窗口互斥。
 *
 * 为什么需要：L2 在 fs 写工具执行期间把 `additionalWritableRoots` 设为非空，
 * 而 Windows ACL 沙箱（`dsh-sandbox-local/lib/index.js:360`）一旦看到该字段
 * 非空就会让 pwsh/bash 直接抛 `SandboxUnsupportedPolicyError`。两个会话并发
 * 时会出现「A 在写文件、B 在跑命令」的重叠，所以：
 *
 *   - fs 写窗口 = shared（可并发多个写，互相不阻塞）
 *   - 命令工具 = exclusive（等所有写窗口结束才进入，期间不许开新窗口）
 *
 * 公平队列：先到先得，exclusive 排到队首后，后来的 shared 不会插队饿死它。
 */

/**
 * @returns {{ acquire: (mode: 'shared' | 'exclusive') => Promise<() => void> }}
 */
export function createGate() {
  let active = 0
  let exclusiveHeld = false
  /** @type {{ mode: 'shared' | 'exclusive', resolve: (release: () => void) => void }[]} */
  const waiters = []

  function makeRelease() {
    let released = false
    return () => {
      if (released) return
      released = true
      active -= 1
      if (active === 0) exclusiveHeld = false
      pump()
    }
  }

  function pump() {
    while (waiters.length > 0) {
      const head = waiters[0]
      if (head.mode === 'exclusive') {
        if (active > 0) return
        waiters.shift()
        exclusiveHeld = true
        active = 1
        head.resolve(makeRelease())
        return
      }
      // shared：只要没有 exclusive 持有，就尽量多放行
      if (exclusiveHeld) return
      waiters.shift()
      active += 1
      head.resolve(makeRelease())
    }
  }

  return {
    acquire(mode) {
      return new Promise((resolve) => {
        waiters.push({ mode, resolve })
        if (waiters.length === 1) pump()
      })
    },
  }
}
