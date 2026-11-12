/**
 * 集成测试：用 mock ctx 驱动三层闸门，不需要安装插件或重启 DSH。
 *
 * 覆盖：白名单注入与还原、ask 不注入、deny 拦截、命令工具排队、审批兜底、嵌套调用放行。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PLUGIN = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const STATE_FILE = path.join(PLUGIN, 'state.json');
const WORKSPACE = path.dirname(PLUGIN);
const WRITE_ROOT = path.dirname(WORKSPACE);

const mod = await import(pathToFileURL(path.join(PLUGIN, 'index.js')).href);

let pass = 0;
let fail = 0;
const ok = (label, cond, extra = '') => {
  if (cond) pass += 1;
  else fail += 1;
  console.log(`${cond ? 'PASS' : 'FAIL'} ${label}${extra ? ` :: ${extra}` : ''}`);
};
const lower = (p) => String(p).toLowerCase();

function makeCtx() {
  const policy = {
    additionalWritableRoots: undefined,
    defaultMode: 'workspace-write',
    resolve(request = {}) {
      const out = { mode: this.defaultMode, workspaceRoot: WORKSPACE };
      if (this.additionalWritableRoots !== undefined) out.additionalWritableRoots = this.additionalWritableRoots;
      if (request.session !== undefined) out.sessionId = request.session.id;
      return out;
    },
  };
  const originalResolve = policy.resolve;
  const listeners = [];
  const ctx = {
    services: { sandboxPolicy: policy, workingDirectory: { get: () => WORKSPACE } },
    get(name) {
      return this.services[name];
    },
    on(event, fn) {
      listeners.push({ event, fn });
      return () => {};
    },
    effect(fn) {
      const result = fn();
      if (result && typeof result.next === 'function') {
        for (const item of result) void item;
      }
      return () => {};
    },
    inject(_deps, cb) {
      cb(ctx);
    },
  };
  return { ctx, policy, listeners, originalResolve };
}

async function waterfall(listeners, event, args, terminal) {
  const chain = listeners.filter((l) => l.event === event).map((l) => l.fn);
  let index = 0;
  const next = async () => {
    if (index >= chain.length) return terminal ? await terminal() : undefined;
    return await chain[index++](...args, next);
  };
  return next();
}

function writeState(patch) {
  fs.writeFileSync(STATE_FILE, JSON.stringify({ version: 1, ...patch }), 'utf8');
}

const BASE = {
  enabled: true,
  roots: [{ path: WRITE_ROOT, access: 'write', enabled: true }],
  tools: { write: 'auto', edit: 'auto', apply_patch: 'auto', pwsh: 'ask' },
  options: { autoApproveDangerFullAccess: false },
};

const original = fs.existsSync(STATE_FILE) ? fs.readFileSync(STATE_FILE, 'utf8') : null;

try {
  // S1: auto + 白名单 → 注入并还原
  writeState(BASE);
  {
    const { ctx, policy, listeners } = makeCtx();
    mod.installHooks(ctx, mod.createRuntime(ctx));
    let during;
    const result = await waterfall(listeners, 'tools/execute', [{ name: 'write', arguments: { file_path: path.join(WRITE_ROOT, 'app', 'index.html') } }], () => {
      during = policy.additionalWritableRoots;
      return { kind: 'allow' };
    });
    ok('S1 white-listed write is allowed', result?.kind === 'allow');
    ok('S1 roots injected during call', Array.isArray(during) && during.some((p) => lower(p) === lower(WRITE_ROOT)), JSON.stringify(during));
    ok('S1 roots restored after call', policy.additionalWritableRoots === undefined);
  }

  // S2: ask → 不注入
  writeState({ ...BASE, tools: { ...BASE.tools, write: 'ask' } });
  {
    const { ctx, policy, listeners } = makeCtx();
    mod.installHooks(ctx, mod.createRuntime(ctx));
    let during;
    await waterfall(listeners, 'tools/execute', [{ name: 'write', arguments: { file_path: path.join(WRITE_ROOT, 'a.txt') } }], () => {
      during = policy.additionalWritableRoots;
      return { kind: 'allow' };
    });
    ok('S2 ask does not inject', during === undefined);
  }

  // S3: deny → pre-execute 拦截
  writeState({ ...BASE, tools: { ...BASE.tools, write: 'deny' } });
  {
    const { ctx, listeners } = makeCtx();
    mod.installHooks(ctx, mod.createRuntime(ctx));
    const decision = await waterfall(listeners, 'tools/pre-execute', [{ name: 'write', arguments: { file_path: path.join(WRITE_ROOT, 'a.txt') } }], () => ({ kind: 'allow' }));
    ok('S3 deny blocks write', decision?.kind === 'deny', JSON.stringify(decision));
  }

  // S4: 写窗口打开期间命令工具排队
  writeState(BASE);
  {
    const { ctx, listeners } = makeCtx();
    mod.installHooks(ctx, mod.createRuntime(ctx));
    const order = [];
    const writing = waterfall(listeners, 'tools/execute', [{ name: 'write', arguments: { file_path: path.join(WRITE_ROOT, 'a.txt') } }], async () => {
      order.push('write:start');
      await new Promise((r) => setTimeout(r, 80));
      order.push('write:end');
      return { kind: 'allow' };
    });
    await new Promise((r) => setTimeout(r, 10));
    const shell = waterfall(listeners, 'tools/execute', [{ name: 'pwsh', arguments: { command: 'echo hi' } }], async () => {
      order.push('shell:start');
      return { kind: 'allow' };
    });
    await Promise.all([writing, shell]);
    ok('S4 shell waits for write window', order.join(',') === 'write:start,write:end,shell:start', order.join(','));
  }

  // S5: 审批兜底（开 / 关）
  writeState({ ...BASE, options: { autoApproveDangerFullAccess: true } });
  {
    const { ctx, listeners } = makeCtx();
    mod.installHooks(ctx, mod.createRuntime(ctx));
    const outcome = await waterfall(listeners, 'approval/request', [{ toolName: 'write', reason: 'escalate sandbox to danger-full-access: write a file' }], () => 'unavailable');
    ok('S5 auto-approve escalation when enabled', outcome === 'allowed-once', String(outcome));
  }
  writeState(BASE);
  {
    const { ctx, listeners } = makeCtx();
    mod.installHooks(ctx, mod.createRuntime(ctx));
    const outcome = await waterfall(listeners, 'approval/request', [{ toolName: 'write', reason: 'escalate sandbox to danger-full-access: write a file' }], () => 'unavailable');
    ok('S5 disabled leaves approval to downstream', outcome === 'unavailable', String(outcome));
  }

  // S6: 嵌套调用（run_code 内部）不注入
  writeState(BASE);
  {
    const { ctx, policy, listeners } = makeCtx();
    mod.installHooks(ctx, mod.createRuntime(ctx));
    let during;
    await waterfall(listeners, 'tools/execute', [{ name: 'write', parent: { callId: 'root' }, arguments: { file_path: path.join(WRITE_ROOT, 'a.txt') } }], () => {
      during = policy.additionalWritableRoots;
      return { kind: 'allow' };
    });
    ok('S6 nested call is not injected', during === undefined);
  }

  // S7: 命令命中白名单 → 本会话静默升级到 full access，结束后完全还原
  writeState(BASE);
  {
    const { ctx, policy, listeners, originalResolve } = makeCtx();
    mod.installHooks(ctx, mod.createRuntime(ctx));
    const exec = { callId: 'c7', name: 'pwsh', agent: { session: { id: 's1' } }, arguments: { command: `cd '${WRITE_ROOT}'`, description: 'build' } };
    let during;
    const result = await waterfall(listeners, 'tools/execute', [exec], () => {
      during = policy.resolve({ session: { id: 's1' } });
      return { kind: 'allow' };
    });
    ok('S7 shell command is allowed', result?.kind === 'allow');
    ok('S7 matching session runs with full access', during?.mode === 'danger-full-access', during?.mode);
    ok('S7 policy restored after command', policy.resolve({ session: { id: 's1' } }).mode === 'workspace-write');
    ok('S7 resolve method restored', policy.resolve === originalResolve);
  }

  // S8: 其他会话不受影响（作用域只在本次会话）
  writeState(BASE);
  {
    const { ctx, policy, listeners } = makeCtx();
    mod.installHooks(ctx, mod.createRuntime(ctx));
    const exec = { callId: 'c8', name: 'pwsh', agent: { session: { id: 's1' } }, arguments: { command: `cd '${WRITE_ROOT}'` } };
    let other;
    await waterfall(listeners, 'tools/execute', [exec], () => {
      other = policy.resolve({ session: { id: 's2' } });
      return { kind: 'allow' };
    });
    ok('S8 other sessions keep workspace-write', other?.mode === 'workspace-write', other?.mode);
  }

  // S9: 命令自己带 sandbox_permissions 时，审批白条静默应答（不进 UI）
  writeState(BASE);
  {
    const { ctx, listeners } = makeCtx();
    mod.installHooks(ctx, mod.createRuntime(ctx));
    const exec = {
      callId: 'c9',
      name: 'pwsh',
      agent: { session: { id: 's1' } },
      arguments: { command: `cd '${WRITE_ROOT}'; node scripts/build.mjs`, sandbox_permissions: 'danger-full-access', justification: 'build' },
    };
    let outcome;
    await waterfall(listeners, 'tools/execute', [exec], async () => {
      // 模拟 dsh-tool-pwsh：execute 内部才走 approveEscalation
      outcome = await waterfall(listeners, 'approval/request', [{ toolName: 'pwsh', callId: 'c9', reason: 'escalate sandbox to danger-full-access: build' }], () => 'unavailable');
      return { kind: 'allow' };
    });
    ok('S9 own escalation request is answered silently', outcome === 'allowed-once', String(outcome));
  }

  // S10: 命令没提到白名单 → 不升级；shellSilent 关掉 → 同样不升级
  writeState(BASE);
  {
    const { ctx, policy, listeners, originalResolve } = makeCtx();
    mod.installHooks(ctx, mod.createRuntime(ctx));
    let during;
    await waterfall(listeners, 'tools/execute', [{ callId: 'c10', name: 'pwsh', agent: { session: { id: 's1' } }, arguments: { command: 'Get-Date' } }], () => {
      during = policy.resolve({ session: { id: 's1' } });
      return { kind: 'allow' };
    });
    ok('S10 unrelated command keeps workspace-write', during?.mode === 'workspace-write', during?.mode);
    ok('S10 unrelated command leaves resolve untouched', policy.resolve === originalResolve);
  }
  writeState({ ...BASE, options: { ...BASE.options, shellSilent: false } });
  {
    const { ctx, policy, listeners } = makeCtx();
    mod.installHooks(ctx, mod.createRuntime(ctx));
    let during;
    await waterfall(listeners, 'tools/execute', [{ callId: 'c11', name: 'pwsh', agent: { session: { id: 's1' } }, arguments: { command: `cd '${WRITE_ROOT}'` } }], () => {
      during = policy.resolve({ session: { id: 's1' } });
      return { kind: 'allow' };
    });
    ok('S10 shellSilent=false disables silent escalation', during?.mode === 'workspace-write', during?.mode);
  }

  // S11: 工作区优先取会话 cwd（host 进程的 cwd 是 profiles 目录，不能当工作区）
  {
    const session = { header: { id: 'sx', cwd: 'D:\\Demo\\proj', createdAt: 7 } };
    const other = { header: { id: 'sub', cwd: 'D:\\Demo\\proj', createdAt: 9, parentSession: 'sx', origin: 'subagent' } };
    const ctx = {
      services: {
        sessions: { list: () => [session, other] },
        workingDirectory: { get: (s) => s?.header?.cwd, defaultDirectory: 'D:\\fallback' },
      },
      get(name) {
        return this.services[name];
      },
      on: () => () => {},
      effect: () => () => {},
    };
    const rt = mod.createRuntime(ctx);
    const resolved = rt.resolveWorkspace();
    ok('S11 workspace resolves from session cwd', resolved.path === 'D:\\Demo\\proj', resolved.path);
    ok('S11 workspace source is session', resolved.source === 'session', resolved.source);
    ok('S11 subagent sessions are ignored', rt.resolveWorkspace().path !== 'D:\\Demo\\proj\\sub');
  }

  // S12: 没有会话时回落到默认目录；最后一个会话可通过工具调用被记住
  {
    const session = { header: { id: 'sy', cwd: 'D:\\Live\\proj', createdAt: 3 } };
    const ctx = {
      services: {
        sessions: { list: () => [] },
        workingDirectory: { get: (s) => s?.header?.cwd, defaultDirectory: 'D:\\fallback' },
      },
      get(name) {
        return this.services[name];
      },
      on: () => () => {},
      effect: () => () => {},
    };
    const rt = mod.createRuntime(ctx);
    ok('S12 fallback uses defaultDirectory', rt.resolveWorkspace().path === 'D:\\fallback', rt.resolveWorkspace().path);
    ok('S12 fallback source is default', rt.resolveWorkspace().source === 'default');
    rt.noteSession(session);
    ok('S12 noted session wins over fallback', rt.resolveWorkspace().path === 'D:\\Live\\proj', rt.resolveWorkspace().path);
  }
  // S13: 多工作区 —— 子目录授权按绝对路径存，跨工作区不串台
  {
    const other = path.join(path.dirname(WRITE_ROOT), 'another-workspace');
    writeState({ ...BASE, workspaceSubdirs: { [WRITE_ROOT]: 'write', [path.join(WORKSPACE, 'sub')]: 'read' } });
    const { ctx, listeners, originalResolve } = makeCtx();
    const rt = mod.createRuntime(ctx);
    mod.installHooks(ctx, rt);
    ok('S13 writable subdirs are absolute', rt.writableRoots().includes(WRITE_ROOT), JSON.stringify(rt.writableRoots()));
    ok('S13 read-only subdir is not a writable root', !rt.writableRoots().includes(path.join(WORKSPACE, 'sub')));
    let during;
    await waterfall(listeners, 'tools/execute', [{ callId: 'c13', name: 'write', agent: { session: { id: 's1' } }, arguments: { file_path: path.join(WRITE_ROOT, 'x.txt') } }], () => {
      during = ctx.services.sandboxPolicy.additionalWritableRoots;
      return { kind: 'allow' };
    });
    ok('S13 absolute subdir grant injects the root', Array.isArray(during) && during.includes(WRITE_ROOT), JSON.stringify(during));
    ok('S13 other workspace stays untouched', !(during || []).includes(other));
    ok('S13 policy restored after the call', ctx.services.sandboxPolicy.additionalWritableRoots === undefined);
    ok('S13 resolve method restored', ctx.services.sandboxPolicy.resolve === originalResolve);
  }
  // S14: 常驻开关 —— 不用逐个勾选，工作区根自动可写
  {
    writeState({ ...BASE, options: { ...(BASE.options || {}), trustAllWorkspaces: true }, workspaceSubdirs: {} });
    const { ctx, listeners, originalResolve } = makeCtx();
    const rt = mod.createRuntime(ctx);
    mod.installHooks(ctx, rt);
    const roots = rt.writableRoots().map((r) => lower(r));
    ok('S14 trust-all includes the workspace root', roots.includes(lower(WORKSPACE)), JSON.stringify(rt.writableRoots()));
    let during;
    await waterfall(listeners, 'tools/execute', [{ callId: 'c14', name: 'write', agent: { session: { id: 's2' } }, arguments: { file_path: path.join(WORKSPACE, 'plain.txt') } }], () => {
      during = ctx.services.sandboxPolicy.additionalWritableRoots;
      return { kind: 'allow' };
    });
    ok('S14 trust-all injects the workspace root', Array.isArray(during) && during.map(lower).includes(lower(WORKSPACE)), JSON.stringify(during));
    ok('S14 policy restored after the call', ctx.services.sandboxPolicy.additionalWritableRoots === undefined);
    ok('S14 resolve method restored', ctx.services.sandboxPolicy.resolve === originalResolve);
    // 关掉之后必须立刻失效（用空白名单，避免 BASE 自带的写根混淆结论）
    writeState({ ...BASE, roots: [], options: { ...(BASE.options || {}), trustAllWorkspaces: false }, workspaceSubdirs: {} });
    const second = mod.createRuntime(ctx);
    ok('S14 disabled trust-all grants nothing', second.writableRoots().length === 0, JSON.stringify(second.writableRoots()));
  }
} finally {
  if (original === null) fs.rmSync(STATE_FILE, { force: true });
  else fs.writeFileSync(STATE_FILE, original, 'utf8');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
