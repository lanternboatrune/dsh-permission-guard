/**
 * Client 半：设置页「完整守护」，权限预授权与完整性标签两套设置合并为一个页面。
 *
 * 所有读写都走宿主 `POST /permission-guard/bridge`，客户端不碰文件系统。
 * 页面结构：顶部固定「工作区 + 刷新 + 总开关」，下面横向标签页「目录 / 工具 / 日志」。
 */

window.__ModuleLoader__.load({
  id: '@local/permission-guard',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const NS = 'permission-guard';
    const BRIDGE = '/permission-guard/bridge';

    const ZH = {
      'settings.title': '完整守护',
      'page.intro':
        '在这里预先授权常用的开发目录：授权目录里的文件写入和命令执行都不再逐个弹窗。',
      'tab.dirs': '目录',
      'tab.tools': '工具',
      'tab.logs': '日志',
      'group.general': '总开关',
      'enabled': '启用',
      'enabledHint': '关闭后所有操作回到 DSH 默认的沙箱与审批流程。',
      'group.workspace': '工作区子文件夹',
      'workspaceHint': '每个工作区下列出深度 2 层的子目录，可单独设为只读或可写。',
      'workspaceEmpty': '工作区内没有可设置的子目录，或当前会话的工作区还没确定。',
      'workspaceFallback': '未确定会话，显示默认目录',
      'bulkLabel': '所有工作区',
      'bulkHint': '「全部可写」立即生效并保存；「常驻」还会覆盖以后新建的工作区，需要新版宿主。',
      'hostStale': '当前运行的宿主还是旧版：点「全部可写」会立刻生效，「常驻」需要重启 DSH 后才能用。',
      'bulkQueued': '已记下「常驻可写」：现在先按「全部可写」生效，重启 DSH 后会自动转为常驻（含以后新建的工作区）。',
      'bulk_off': '不放开',
      'bulk_once': '全部可写',
      'bulk_trust': '常驻可写',
      'wsAllWrite': '全部可写',
      'wsClear': '清除',
      'wsRootRow': '整个工作区（含全部子目录）',
      'wsCovered': '该工作区整棵树已可写，新建的子目录同样会放行。',
      'group.roots': '外部目录白名单',
      'rootsHint': '这些目录（包含全部子目录）内的文件写入都会被自动放行；命令是否放行见下方「命令工具」。',
      'group.tools': '按操作类型',
      'toolsHint': 'auto = 命中白名单时自动放行；ask = 交给正常审批；deny = 直接拒绝。',
      'group.shell': '命令工具',
      'shellHint': '命中的命令会临时升级沙箱并直接跑完（含 build 脚本、npm、git），不产生审批弹窗。',
      'shellSilent': '命令命中白名单时静默放行',
      'shellSilentHint': '判定依据：命令文本里出现白名单路径，或工作目录在白名单内。等同于信任该目录里的代码。',
      'group.audit': '审计日志',
      'auditHint': '最近 80 条自动决策记录。',
      'add': '添加',
      'remove': '移除',
      'save': '保存',
      'saving': '保存中…',
      'read': '只读',
      'write': '可写',
      'auto': '自动',
      'ask': '审批',
      'deny': '拒绝',
      'empty': '暂无记录',
      'refresh': '刷新',
      'workspaceRoot': '工作区',
      'error': '出错',
      'dangerTitle': '自动批准完整权限',
      'dangerHint': '默认关闭。开启后，文件写工具请求 danger-full-access 时会被自动允许（不推荐，审计日志会记录）。',
      'tab.integrity': '完整性',
      'ig.intro': '把不该带 Low 完整性标签的目录改回 Medium：桌面、下载、登记的其它工作区一旦被沙箱打上 Low，就在启动与会话结束时擦干净。',
      'ig.enabled': '启用完整性守护',
      'ig.enabledHint': '关闭后只保留权限预授权，不再扫描或修复完整性标签。',
      'ig.group.scope': '扫描范围',
      'ig.depth': '展开深度',
      'ig.depthHint': '从每个根往下展开几层，层数越大越慢。',
      'ig.homeFolders': '用户文件夹',
      'ig.extraRoots': '额外扫描的目录',
      'ig.extraHint': '除用户文件夹和已登记工作区外，还想检查的根目录。',
      'ig.allowedRoots': '允许保留 Low 的目录',
      'ig.allowedHint': '默认工作区应留在这里；把目录加进来就表示不要动它。',
      'ig.group.status': '状态',
      'ig.last': '最近扫描',
      'ig.scanNow': '立即扫描',
      'ig.scanning': '扫描中…',
      'ig.adminHint': '改回 Medium 需要管理员权限。普通权限下会被系统拒绝访问，失败原因已逐条列在下面。',
      'ig.repair': '以管理员修复',
      'ig.repairing': '正在准备…',
      'ig.repairLaunched': '已弹出 UAC，确认后会自动修复 {count} 个目录；完成后点「立即扫描」查看结果。',
      'ig.repairNone': '没有检测到需要修复的 Low 目录。',
      'ig.repairFailed': '提权进程启动失败：',
      'ig.group.log': '最近记录',
      'ig.empty': '还没有记录',
      'ig.checked': '检查',
      'ig.fixed': '修复',
      'ig.failed': '失败',
      'ig.took': '用时',
      'ig.dirs': '个目录',
    };

    const EN = {
      'settings.title': 'Complete Guard',
      'page.intro':
        'Pre-approve development directories here: file writes and shell commands inside approved roots skip the per-call approval prompt.',
      'tab.dirs': 'Paths',
      'tab.tools': 'Tools',
      'tab.logs': 'Log',
      'group.general': 'Enabled',
      'enabled': 'Enabled',
      'enabledHint': 'Turn off to restore the default sandbox and approval flow.',
      'group.workspace': 'Workspace subfolders',
      'workspaceHint': 'Subfolders up to two levels deep in each workspace; toggle each one to read-only or writable.',
      'workspaceEmpty': 'No subfolders found, or the current session workspace is not resolved yet.',
      'workspaceFallback': 'session unknown, showing the default directory',
      'wsAllWrite': 'Whole tree',
      'wsClear': 'Clear',
      'wsRootRow': 'Whole workspace (all subfolders)',
      'wsCovered': 'The whole tree is writable; subfolders created later are covered too.',
      'bulkLabel': 'All workspaces',
      'bulkHint': '"All writable" applies and saves immediately; "Always" also covers workspaces created later and needs the newer host.',
      'hostStale': 'The running host is still an older build: "All writable" works right away, "Always" becomes available after restarting DSH.',
      'bulkQueued': '"Always" is queued: for now it applies as "All writable", and after you restart DSH it switches to always-on (including workspaces created later).',
      'bulk_off': 'None',
      'bulk_once': 'All writable',
      'bulk_trust': 'Always',
      'group.roots': 'External roots',
      'rootsHint': 'File writes inside these directories (all subdirectories included) are allowed automatically; shell behaviour is set below.',
      'group.tools': 'By operation type',
      'toolsHint': 'auto = allow when a root matches; ask = normal approval; deny = always reject.',
      'group.shell': 'Shell tools',
      'shellHint': 'Matching commands (build scripts, npm, git) run to completion in a temporarily escalated sandbox — no approval prompt.',
      'shellSilent': 'Run matching commands silently',
      'shellSilentHint': 'A command matches when its text mentions an approved root, or its working directory is inside one. Equivalent to trusting the code in that directory.',
      'group.audit': 'Audit log',
      'auditHint': 'The most recent 80 automatic decisions.',
      'add': 'Add',
      'remove': 'Remove',
      'save': 'Save',
      'saving': 'Saving…',
      'read': 'Read',
      'write': 'Write',
      'auto': 'Auto',
      'ask': 'Ask',
      'deny': 'Deny',
      'empty': 'No entries',
      'refresh': 'Refresh',
      'workspaceRoot': 'Workspace',
      'error': 'Error',
      'dangerTitle': 'Auto-approve danger-full-access',
      'dangerHint': 'Off by default. When on, file-tool escalations to danger-full-access are approved automatically (audit-logged).',
      'tab.integrity': 'Integrity',
      'ig.intro': 'Reset stray Low integrity labels back to Medium: Desktop, Downloads and other registered workspaces are cleaned at startup and when sessions end.',
      'ig.enabled': 'Enable integrity guard',
      'ig.enabledHint': 'Turn off to keep only permission presets; integrity labels are no longer scanned or repaired.',
      'ig.group.scope': 'Scan scope',
      'ig.depth': 'Depth',
      'ig.depthHint': 'How many levels below each root to expand. Higher is slower.',
      'ig.homeFolders': 'Home folders',
      'ig.extraRoots': 'Extra roots',
      'ig.extraHint': 'Additional roots to inspect besides home folders and registered workspaces.',
      'ig.allowedRoots': 'Roots allowed to keep Low',
      'ig.allowedHint': 'The default workspace belongs here; adding a root means leave it alone.',
      'ig.group.status': 'Status',
      'ig.last': 'Last scan',
      'ig.scanNow': 'Scan now',
      'ig.scanning': 'Scanning…',
      'ig.adminHint': 'Resetting to Medium needs administrator rights. A normal process is denied access; each failure reason is listed below.',
      'ig.repair': 'Repair as administrator',
      'ig.repairing': 'Preparing…',
      'ig.repairLaunched': 'UAC prompt opened; {count} directories will be repaired after you confirm. Run "Scan now" afterwards to verify.',
      'ig.repairNone': 'No Low-labeled directories need repair.',
      'ig.repairFailed': 'Could not start the elevated process:',
      'ig.group.log': 'Recent entries',
      'ig.empty': 'No entries yet',
      'ig.checked': 'Checked',
      'ig.fixed': 'Fixed',
      'ig.failed': 'Failed',
      'ig.took': 'Took',
      'ig.dirs': 'dirs',
    };

    const S = {
      page: { display: 'flex', flexDirection: 'column', gap: 12 },
      intro: { margin: 0, fontSize: 12.5, lineHeight: 1.7, color: 'var(--dsw-alias-label-secondary)' },
      headBar: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
      headRight: { display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto' },
      tabs: {
        display: 'flex', gap: 4, alignItems: 'stretch', flexWrap: 'nowrap', overflowX: 'auto',
        borderBottom: '0.5px solid var(--dsw-alias-border-l1)', marginTop: 2, minHeight: 34,
      },
      tab: {
        font: 'inherit', fontSize: 13, lineHeight: 1.2, padding: '8px 10px', cursor: 'pointer',
        background: 'transparent', border: 'none', borderBottom: '2px solid transparent',
        color: 'var(--dsw-alias-label-tertiary)', whiteSpace: 'nowrap', flexShrink: 0,
        display: 'inline-flex', alignItems: 'center', transition: 'color .14s, box-shadow .14s',
      },
      tabOn: {
        color: 'var(--dsw-alias-brand-primary, #e8663d)',
        boxShadow: 'inset 0 -2px 0 var(--dsw-alias-brand-primary, #e8663d)',
        fontWeight: 600,
      },
      tabCount: { marginLeft: 6, fontSize: 11, opacity: 0.8 },
      pane: { display: 'flex', flexDirection: 'column', gap: 12 },
      group: {
        display: 'flex', flexDirection: 'column', gap: 10, padding: '14px 16px', borderRadius: 12,
        border: '0.5px solid var(--dsw-alias-border-l1)', background: 'var(--dsw-alias-bg-layer-2)',
      },
      groupHead: { margin: 0, fontSize: 13, fontWeight: 600, color: 'var(--dsw-alias-label-primary)' },
      groupHeadRow: { display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' },
      groupActions: { marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' },
      mini: {
        font: 'inherit', fontSize: 12, lineHeight: 1, padding: '5px 9px', borderRadius: 6, cursor: 'pointer',
        background: 'transparent', border: '0.5px solid var(--dsw-alias-border-l1)',
        color: 'var(--dsw-alias-label-secondary)',
      },
      miniOn: {
        color: 'var(--dsw-alias-button-primary-fill, var(--dsw-alias-brand-primary, #e8663d))',
        borderColor: 'currentColor',
      },
      banner: {
        display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '10px 12px',
        borderRadius: 10, background: 'var(--dsw-alias-bg-layer-1)',
        border: '0.5px solid var(--dsw-alias-border-l1)',
      },
      bannerText: { flex: 1, minWidth: 160, margin: 0, fontSize: 12, lineHeight: 1.6, color: 'var(--dsw-alias-label-secondary)' },
      bulkBar: {
        display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', padding: '10px 12px',
        borderRadius: 10, background: 'var(--dsw-alias-bg-layer-1)',
        border: '0.5px solid var(--dsw-alias-border-l1)',
      },
      groupNote: { fontSize: 11.5, color: 'var(--dsw-alias-label-tertiary)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
      row: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' },
      rowLabel: { fontSize: 13, color: 'var(--dsw-alias-label-secondary)' },
      hint: { margin: 0, fontSize: 12, lineHeight: 1.6, color: 'var(--dsw-alias-label-tertiary)' },
      toggle: {
        width: 38, height: 22, borderRadius: 999, padding: 2, cursor: 'pointer', border: 'none',
        background: 'var(--dsw-alias-border-l1)', display: 'inline-flex', alignItems: 'center',
        justifyContent: 'flex-start', transition: 'background .16s',
      },
      toggleOn: { background: 'var(--dsw-alias-brand-primary, #4fb98a)', justifyContent: 'flex-end' },
      knob: { width: 18, height: 18, borderRadius: '50%', background: '#fff', boxShadow: '0 1px 2px rgba(0,0,0,.2)' },
      seg: {
        display: 'inline-flex', padding: 2, borderRadius: 9, background: 'var(--dsw-alias-bg-layer-1)',
        border: '0.5px solid var(--dsw-alias-border-l1)',
      },
      segBtn: {
        font: 'inherit', fontSize: 12.5, lineHeight: 1, padding: '7px 12px', borderRadius: 7, cursor: 'pointer',
        background: 'transparent', border: 'none', color: 'var(--dsw-alias-label-secondary)',
      },
      segOn: {
        background: 'var(--dsw-alias-bg-layer-2)', color: 'var(--dsw-alias-label-primary)', fontWeight: 600,
        boxShadow: '0 1px 2px rgba(0,0,0,.12)',
      },
      pathList: { display: 'flex', flexDirection: 'column', gap: 6 },
      pathRow: {
        display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px 6px 10px', borderRadius: 8,
        background: 'var(--dsw-alias-bg-layer-1)', border: '0.5px solid var(--dsw-alias-border-l1)',
      },
      pathText: {
        flex: 1, minWidth: 0, fontFamily: 'ui-monospace, Consolas, monospace', fontSize: 12,
        color: 'var(--dsw-alias-label-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      },
      removeBtn: {
        font: 'inherit', fontSize: 12, lineHeight: 1, padding: '4px 8px', borderRadius: 6, cursor: 'pointer',
        background: 'transparent', border: 'none', color: 'var(--dsw-alias-label-tertiary)',
      },
      addRow: { display: 'flex', gap: 8, alignItems: 'center' },
      input: {
        flex: 1, minWidth: 0, font: 'inherit', fontSize: 12.5, padding: '8px 10px', borderRadius: 8,
        border: '0.5px solid var(--dsw-alias-border-l1)', background: 'var(--dsw-alias-bg-layer-1)',
        color: 'var(--dsw-alias-label-primary)',
      },
      action: {
        font: 'inherit', fontSize: 13, lineHeight: 1, padding: '8px 14px', borderRadius: 8, cursor: 'pointer',
        background: 'var(--dsw-alias-button-primary-fill, var(--dsw-alias-brand-primary, #4fb98a))',
        border: 'none', color: 'var(--dsw-alias-label-primary-foreground, #10241c)', fontWeight: 600,
      },
      actionOff: { opacity: 0.55, cursor: 'default' },
      note: { margin: 0, fontSize: 12, color: 'var(--dsw-alias-state-error-primary, #c4553f)' },
      logs: { display: 'flex', flexDirection: 'column', gap: 4 },
      logRow: { display: 'flex', gap: 8, alignItems: 'baseline', fontSize: 12, lineHeight: 1.5, color: 'var(--dsw-alias-label-secondary)' },
      logTime: { fontFamily: 'ui-monospace, Consolas, monospace', fontSize: 11, color: 'var(--dsw-alias-label-tertiary)', flexShrink: 0 },
      logKind: { flexShrink: 0, fontWeight: 600, color: 'var(--dsw-alias-label-primary)' },
      logPath: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
    };

    const IG_BRIDGE = '/integrity-guard/bridge';

    async function callAt(bridge, body) {
      const res = await fetch(bridge, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      let payload = null;
      try {
        payload = await res.json();
      } catch {
        payload = null;
      }
      if (!res.ok || !payload || payload.ok === false) {
        throw new Error((payload && (payload.error || payload.detail)) || `HTTP ${res.status}`);
      }
      return payload;
    }

    const call = (body) => callAt(BRIDGE, body);
    const igCall = (body) => callAt(IG_BRIDGE, body);

    function formatTime(ts) {
      if (!ts) return '';
      try {
        return new Date(ts).toLocaleTimeString();
      } catch {
        return '';
      }
    }

    function Toggle({ checked, onChange, label }) {
      return h('button', {
        type: 'button', role: 'switch', 'aria-checked': checked ? 'true' : 'false', 'aria-label': label, title: label,
        style: { ...S.toggle, ...(checked ? S.toggleOn : null) },
        onClick: () => onChange(!checked),
      }, h('span', { style: S.knob }));
    }

    function Seg({ values, value, onChange, render }) {
      return h('div', { style: S.seg }, values.map((item) =>
        h('button', {
          key: String(item), type: 'button', 'aria-pressed': item === value ? 'true' : 'false',
          style: { ...S.segBtn, ...(item === value ? S.segOn : null) },
          onClick: () => onChange(item),
        }, render ? render(item) : String(item))));
    }

    function Group({ title, note, actions, children }) {
      return h('div', { style: S.group }, [
        h('div', { key: 'head', style: S.groupHeadRow }, [
          h('h3', { key: 'title', style: S.groupHead }, title),
          note ? h('span', { key: 'note', style: S.groupNote }, note) : null,
          actions ? h('div', { key: 'actions', style: S.groupActions }, actions) : null,
        ]),
        ...children,
      ]);
    }

    const PENDING_TRUST = 'permission-guard.pendingTrust';
    function readPendingTrust() {
      try { return window.localStorage.getItem(PENDING_TRUST) === '1'; } catch { return false; }
    }
    function writePendingTrust(on) {
      try {
        if (on) window.localStorage.setItem(PENDING_TRUST, '1');
        else window.localStorage.removeItem(PENDING_TRUST);
      } catch { /* 隐私模式或无 localStorage 时忽略 */ }
    }

    function PermissionPage(props) {
      const t = typeof props.t === 'function' ? props.t : (key) => String(key);
      const [data, setData] = React.useState(null);
      const [error, setError] = React.useState('');
      const [busy, setBusy] = React.useState('');
      const [draft, setDraft] = React.useState('');
      const [tab, setTab] = React.useState('dirs');
      const [pendingTrust, setPendingTrust] = React.useState(() => readPendingTrust());

      const load = React.useCallback(async () => {
        try {
          setData(await call({ action: 'get' }));
          setError('');
        } catch (err) {
          setError(String((err && err.message) || err));
        }
      }, []);

      React.useEffect(() => {
        load();
      }, [load]);

      // 旧宿主不认 trustAllWorkspaces，勾了也存不住。把「想要常驻」记在本地，
      // 等重启后宿主换成新版，第一次打开设置页时自动补上——用户点一次就够。
      React.useEffect(() => {
        if (!data || !pendingTrust) return;
        if (!Array.isArray(data.workspaces)) return;
        const already = data.state && data.state.options && data.state.options.trustAllWorkspaces === true;
        if (already) {
          writePendingTrust(false);
          setPendingTrust(false);
          return;
        }
        writePendingTrust(false);
        setPendingTrust(false);
        patch({ options: { ...((data.state && data.state.options) || {}), trustAllWorkspaces: true } });
      }, [data, pendingTrust]);

      async function patch(next) {
        try {
          setBusy('save');
          setData(await call({ action: 'set', patch: next }));
          setError('');
        } catch (err) {
          setError(String((err && err.message) || err));
        } finally {
          setBusy('');
        }
      }

      if (!data) {
        return h('div', { style: S.page }, [
          error ? h('p', { key: 'e', style: S.note }, `${t('error')}: ${error}`) : h('p', { key: 'l', style: S.hint }, t('page.intro')),
        ]);
      }

      const state = data.state || {};
      const tools = state.tools || {};
      const options = state.options || {};
      const subdirs = state.workspaceSubdirs || {};
      const roots = Array.isArray(state.roots) ? state.roots : [];
      // 0.4.0+ 的宿主返回 workspaces；0.3.x 只返回 workspaceDirs，这里兜底成单工作区，
      // 避免宿主与客户端版本错位时「目录」页整块消失。
      const workspaces = Array.isArray(data.workspaces) && data.workspaces.length > 0
        ? data.workspaces
        : Array.isArray(data.workspaceDirs) && data.workspaceDirs.length > 0
          ? [{ id: 'legacy', title: data.workspaceRoot || '', path: data.workspaceRoot || '', dirs: data.workspaceDirs }]
          : [];
      const dirKey = (dir) => (dir && (dir.abs || dir.rel)) || '';

      const setSubdir = (abs, access) => {
        const next = { ...subdirs };
        if (access === 'none') delete next[abs];
        else next[abs] = access;
        patch({ workspaceSubdirs: next });
      };

      const addRoot = () => {
        const value = draft.trim();
        if (!value) return;
        patch({ roots: [...roots, { path: value, access: 'write', enabled: true }] });
        setDraft('');
      };

      const authorized = Object.keys(subdirs).filter((k) => subdirs[k] === 'read' || subdirs[k] === 'write').length;
      const log = Array.isArray(data.log) ? data.log : [];
      const tabs = [
        { id: 'dirs', label: t('tab.dirs'), count: roots.length + authorized },
        { id: 'tools', label: t('tab.tools'), count: 0 },
        { id: 'integrity', label: t('tab.integrity'), count: 0 },
        { id: 'logs', label: t('tab.logs'), count: log.length },
      ];

      // 「整个工作区」用一个前缀键表示：宿主按 isPathUnder 判定，所以它天然覆盖
      // 全部子目录（包括以后新建的），比逐个子目录打勾更省事也更不容易漏。
      // 旧宿主（0.3.x）只有相对键，没有 abs，此时退回逐个子目录累加。
      const workspaceRootKey = (ws) => (ws && ws.id !== 'legacy' && ws.path ? ws.path : '');
      const applyWorkspace = (next, ws, access) => {
        const rootKey = workspaceRootKey(ws);
        const keys = (ws.dirs || []).map(dirKey).filter(Boolean);
        if (rootKey) {
          if (access === 'none') delete next[rootKey];
          else next[rootKey] = access;
          for (const k of keys) delete next[k];
          return;
        }
        for (const k of keys) {
          if (access === 'none') delete next[k];
          else next[k] = access;
        }
      };
      const setWorkspace = (ws, access) => {
        const next = { ...subdirs };
        applyWorkspace(next, ws, access);
        patch({ workspaceSubdirs: next });
      };

      const trust = options.trustAllWorkspaces === true;
      const wsKeys = (ws) => {
        const rootKey = workspaceRootKey(ws);
        return rootKey ? [rootKey] : (ws.dirs || []).map(dirKey).filter(Boolean);
      };
      const allCovered = workspaces.length > 0 && workspaces.every((ws) => {
        const keys = wsKeys(ws);
        return keys.length > 0 && keys.every((k) => subdirs[k] === 'write');
      });
      const bulkMode = trust || pendingTrust ? 'trust' : allCovered ? 'once' : 'off';
      const hostStale = !Array.isArray(data.workspaces);
      const setBulkMode = (mode) => {
        const wantsTrust = mode === 'trust';
        // 旧宿主存不住常驻开关：本地记住意图，重启后第一次打开设置页自动补上。
        const queued = wantsTrust && hostStale;
        writePendingTrust(queued);
        setPendingTrust(queued);
        const nextOptions = { ...options, trustAllWorkspaces: wantsTrust && !hostStale };
        const next = { ...subdirs };
        for (const ws of workspaces) applyWorkspace(next, ws, mode === 'off' ? 'none' : 'write');
        patch({ options: nextOptions, workspaceSubdirs: next });
      };

      const dirsPane = h('div', { key: 'dirs', style: S.pane }, [
        h(Group, { key: 'roots', title: t('group.roots') }, [
          h('p', { key: 'h', style: S.hint }, t('rootsHint')),
          h('div', { key: 'list', style: S.pathList }, roots.map((root) =>
            h('div', { key: root.path, style: S.pathRow }, [
              h('span', { key: 'p', style: S.pathText, title: root.path }, root.path),
              h(Seg, {
                key: 'seg', values: ['read', 'write'], value: root.access,
                onChange: (v) => patch({ roots: roots.map((r) => (r.path === root.path ? { ...r, access: v } : r)) }),
                render: (v) => t(v),
              }),
              h('button', {
                key: 'x', type: 'button', style: S.removeBtn, title: t('remove'), 'aria-label': t('remove'),
                onClick: () => patch({ roots: roots.filter((r) => r.path !== root.path) }),
              }, '\u00d7'),
            ]))),
          h('div', { key: 'add', style: S.addRow }, [
            h('input', {
              key: 'i', style: S.input, value: draft, placeholder: 'D:\\Develop\\MyProject',
              onChange: (e) => setDraft(e.target.value),
              onKeyDown: (e) => { if (e.key === 'Enter') addRoot(); },
            }),
            h('button', { key: 'b', type: 'button', style: S.action, onClick: addRoot }, t('add')),
          ]),
        ]),
        workspaces.length > 0
          ? h('div', { key: 'bulk', style: S.bulkBar }, [
            h('div', { key: 'l', style: { display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0, flex: '1 1 220px' } }, [
              h('span', { key: 't', style: S.bannerText }, t('bulkLabel')),
              h('span', { key: 's', style: S.hint }, hostStale ? (pendingTrust ? t('bulkQueued') : t('hostStale')) : t('bulkHint')),
            ]),
            h(Seg, {
              key: 'seg',
              values: ['off', 'once', 'trust'],
              value: bulkMode,
              onChange: setBulkMode,
              render: (v) => t(`bulk_${v}`),
            }),
          ])
          : null,
        ...workspaces.map((ws, index) => {
          const rootKey = workspaceRootKey(ws);
          const keys = (ws.dirs || []).map(dirKey).filter(Boolean);
          const rootWrite = Boolean(rootKey) && subdirs[rootKey] === 'write';
          const allWrite = rootWrite || (keys.length > 0 && keys.every((k) => subdirs[k] === 'write'));
          return h(Group, {
            key: `workspace-${ws.id || index}`,
            title: ws.title || ws.path || t('group.workspace'),
            note: ws.path,
            actions: [
              h('button', {
                key: 'all', type: 'button', style: { ...S.mini, ...(allWrite ? S.miniOn : null) },
                onClick: () => setWorkspace(ws, allWrite ? 'none' : 'write'),
              }, allWrite ? t('wsClear') : t('wsAllWrite')),
            ],
          }, [
            h('p', { key: 'h', style: S.hint }, t('workspaceHint')),
            !ws.dirs || ws.dirs.length === 0
              ? h('p', { key: 'none', style: S.hint }, t('workspaceEmpty'))
              : null,
            rootKey
              ? h('div', { key: '__root', style: { ...S.row, borderBottom: '0.5px dashed var(--dsw-alias-border-l1)', paddingBottom: 6 } }, [
                h('span', { key: 'l', style: { ...S.rowLabel, fontWeight: 600 } }, t('wsRootRow')),
                h(Seg, {
                  key: 'seg',
                  values: ['none', 'read', 'write'],
                  value: subdirs[rootKey] || 'none',
                  onChange: (v) => setSubdir(rootKey, v),
                  render: (v) => (v === 'none' ? '—' : t(v)),
                }),
              ])
              : null,
            rootWrite
              ? h('p', { key: 'covered', style: S.hint }, t('wsCovered'))
              : (ws.dirs || []).slice(0, 40).map((dir) => {
                const key = dirKey(dir);
                const current = subdirs[key] || 'none';
                return h('div', { key, style: S.row }, [
                  h('span', { style: { ...S.pathText, flex: 1 }, title: dir.abs || dir.rel }, dir.rel || dir.name || key),
                  h(Seg, {
                    key: 'seg',
                    values: ['none', 'read', 'write'],
                    value: current,
                    onChange: (v) => setSubdir(key, v),
                    render: (v) => (v === 'none' ? '—' : t(v)),
                  }),
                ]);
              }),
          ]);
        }),
        ...(workspaces.length === 0
          ? [h(Group, { key: 'workspace-empty', title: t('group.workspace') }, [
            h('p', { key: 'h', style: S.hint }, t('workspaceEmpty')),
          ])]
          : []),
      ]);

      const toolsPane = h('div', { key: 'tools', style: S.pane }, [
        h(Group, { key: 'types', title: t('group.tools') }, [
          h('p', { key: 'h', style: S.hint }, t('toolsHint')),
          ...['write', 'edit', 'apply_patch', 'pwsh'].map((name) =>
            h('div', { key: name, style: S.row }, [
              h('span', { style: S.rowLabel }, name),
              h(Seg, {
                key: 'seg',
                values: name === 'pwsh' ? ['ask', 'deny'] : ['auto', 'ask', 'deny'],
                value: tools[name] || 'ask',
                onChange: (v) => patch({ tools: { ...tools, [name]: v } }),
                render: (v) => t(v),
              }),
            ])),
        ]),
        h(Group, { key: 'shell', title: t('group.shell') }, [
          h('p', { key: 'h', style: S.hint }, t('shellHint')),
          h('div', { key: 'row', style: S.row }, [
            h('div', { key: 'l' }, [
              h('div', { style: S.rowLabel }, t('shellSilent')),
              h('p', { style: S.hint }, t('shellSilentHint')),
            ]),
            h(Toggle, {
              key: 't',
              checked: options.shellSilent !== false,
              label: t('shellSilent'),
              onChange: (v) => patch({ options: { ...options, shellSilent: v } }),
            }),
          ]),
        ]),
      ]);

      const logsPane = h('div', { key: 'logs', style: S.pane }, [
        h(Group, { key: 'audit', title: t('group.audit'), note: `${log.length}` }, [
          h('p', { key: 'h', style: S.hint }, t('auditHint')),
          log.length === 0
            ? h('p', { key: 'empty', style: S.hint }, t('empty'))
            : h('div', { key: 'rows', style: S.logs }, log.slice().reverse().map((entry, index) =>
              h('div', { key: String(index), style: S.logRow }, [
                h('span', { key: 't', style: S.logTime }, formatTime(entry.at)),
                h('span', { key: 'k', style: S.logKind }, String(entry.kind || '')),
                h('span', { key: 'p', style: S.logPath, title: JSON.stringify(entry) },
                  [entry.toolName, ...(Array.isArray(entry.targets) ? entry.targets : []), entry.mode, entry.outcome].filter(Boolean).join(' · ')),
              ]))),
        ]),
      ]);

      return h('div', { style: S.page }, [
        h('p', { key: 'intro', style: S.intro }, t('page.intro')),
        h('div', { key: 'bar', style: S.headBar }, [
          h('span', { key: 'ws', style: S.hint, title: data.workspaceRoot || '' },
            `${t('workspaceRoot')}: ${data.workspaceRoot || ''}${data.workspaceSource === 'default' ? `（${t('workspaceFallback')}）` : ''}`),
          h('button', { key: 'r', type: 'button', style: S.segBtn, onClick: () => load() }, t('refresh')),
          h('div', { key: 'on', style: S.headRight }, [
            h('span', { key: 'l', style: S.rowLabel }, t('enabled')),
            h(Toggle, { key: 't', checked: state.enabled !== false, label: t('enabled'), onChange: (v) => patch({ enabled: v }) }),
          ]),
        ]),
        error ? h('p', { key: 'err', style: S.note }, `${t('error')}: ${error}`) : null,
        h('div', { key: 'tabs', style: S.tabs }, tabs.map((item) =>
          h('button', {
            key: item.id, type: 'button', 'aria-pressed': tab === item.id ? 'true' : 'false',
            style: { ...S.tab, ...(tab === item.id ? S.tabOn : null) },
            onClick: () => setTab(item.id),
          }, [item.label, item.count > 0 ? h('span', { key: 'c', style: S.tabCount }, String(item.count)) : null]))),
        tab === 'dirs' ? dirsPane : tab === 'tools' ? toolsPane : tab === 'integrity' ? h(IntegrityPane, { t }) : logsPane,
      ]);
    }

    function IntegrityPane({ t }) {
      const [data, setData] = React.useState(null);
      const [error, setError] = React.useState('');
      const [busy, setBusy] = React.useState('');
      const [draft, setDraft] = React.useState('');
      const [notice, setNotice] = React.useState('');

      const load = React.useCallback(async () => {
        try {
          setData(await igCall({ action: 'get' }));
          setError('');
        } catch (err) {
          setError(String((err && err.message) || err));
        }
      }, []);

      React.useEffect(() => {
        load();
      }, [load]);

      async function patch(next) {
        try {
          setBusy('save');
          setData(await igCall({ action: 'set', patch: next }));
          setError('');
        } catch (err) {
          setError(String((err && err.message) || err));
        } finally {
          setBusy('');
        }
      }

      async function scan() {
        try {
          setBusy('scan');
          setNotice('');
          setData(await igCall({ action: 'scan' }));
          setError('');
        } catch (err) {
          setError(String((err && err.message) || err));
        } finally {
          setBusy('');
        }
      }

      async function repair() {
        try {
          setBusy('repair');
          setNotice('');
          const result = await igCall({ action: 'repair' });
          setData(result);
          if (result.launched) {
            setNotice(t('ig.repairLaunched').replace('{count}', String(result.count || 0)));
          } else if (result.reason === 'none') {
            setNotice(t('ig.repairNone'));
          } else {
            setNotice(`${t('ig.repairFailed')} ${result.error || ''}`.trim());
          }
          setError('');
        } catch (err) {
          setError(String((err && err.message) || err));
        } finally {
          setBusy('');
        }
      }

      if (!data) {
        return h('div', { style: S.pane }, [
          error
            ? h('p', { key: 'e', style: S.note }, `${t('error')}: ${error}`)
            : h('p', { key: 'l', style: S.hint }, t('ig.intro')),
        ]);
      }

      const state = data.state || {};
      const last = data.lastScan || null;
      const entries = Array.isArray(data.log) ? data.log : [];
      const homeFolders = Array.isArray(state.homeFolders) ? state.homeFolders : [];
      const extraRoots = Array.isArray(state.extraRoots) ? state.extraRoots : [];
      const allowedRoots = Array.isArray(state.allowedRoots) ? state.allowedRoots : [];
      const depth = Number.isFinite(state.depth) ? state.depth : 2;

      const addPath = (key) => {
        const value = draft.trim();
        if (!value) return;
        const list = key === 'extraRoots' ? extraRoots : allowedRoots;
        patch({ [key]: [...list, value] });
        setDraft('');
      };
      const removePath = (key, value) => {
        const list = key === 'extraRoots' ? extraRoots : allowedRoots;
        patch({ [key]: list.filter((item) => item !== value) });
      };
      const pathList = (key, list) => (list.length === 0 ? null : h('div', { style: S.pathList }, list.map((item) =>
        h('div', { key: item, style: S.pathRow }, [
          h('span', { key: 'p', style: S.pathText, title: item }, item),
          h('button', {
            key: 'x', type: 'button', style: S.removeBtn, title: t('remove'), 'aria-label': t('remove'),
            onClick: () => removePath(key, item),
          }, '\u00d7'),
        ]))));

      return h('div', { key: 'integrity', style: S.pane }, [
        h('p', { key: 'intro', style: S.intro }, t('ig.intro')),
        h(Group, {
          key: 'scope',
          title: t('ig.group.scope'),
          actions: [
            h('button', {
              key: 'scan', type: 'button', style: S.action, disabled: busy === 'scan',
              onClick: scan,
            }, busy === 'scan' ? t('ig.scanning') : t('ig.scanNow')),
          ],
        }, [
          h('div', { key: 'enabled', style: S.row }, [
            h('div', { key: 'l' }, [
              h('div', { style: S.rowLabel }, t('ig.enabled')),
              h('p', { style: S.hint }, t('ig.enabledHint')),
            ]),
            h(Toggle, {
              key: 't', checked: state.enabled !== false, label: t('ig.enabled'),
              onChange: (v) => patch({ enabled: v }),
            }),
          ]),
          h('div', { key: 'depth', style: S.row }, [
            h('div', { key: 'l' }, [
              h('div', { style: S.rowLabel }, t('ig.depth')),
              h('p', { style: S.hint }, t('ig.depthHint')),
            ]),
            h(Seg, {
              key: 's', values: [0, 1, 2, 3, 4], value: depth,
              onChange: (v) => patch({ depth: v }), render: (v) => String(v),
            }),
          ]),
          h('div', { key: 'home', style: S.row }, [
            h('span', { key: 'l', style: S.rowLabel }, t('ig.homeFolders')),
            h('span', { key: 'v', style: { ...S.hint, flex: 1, textAlign: 'right' } }, homeFolders.join(' · ') || '—'),
          ]),
          h('div', { key: 'extra', style: S.row }, [
            h('span', { key: 'l', style: S.rowLabel }, t('ig.extraRoots')),
            h('span', { key: 'v', style: { ...S.hint, flex: 1, textAlign: 'right' } }, t('ig.extraHint')),
          ]),
          pathList('extraRoots', extraRoots),
          h('div', { key: 'add', style: S.addRow }, [
            h('input', {
              key: 'i', style: S.input, value: draft, placeholder: 'D:\\Projects',
              onChange: (e) => setDraft(e.target.value),
              onKeyDown: (e) => { if (e.key === 'Enter') addPath('extraRoots'); },
            }),
            h('button', { key: 'b', type: 'button', style: S.action, onClick: () => addPath('extraRoots') }, t('add')),
          ]),
          h('div', { key: 'allowed', style: S.row }, [
            h('span', { key: 'l', style: S.rowLabel }, t('ig.allowedRoots')),
            h('span', { key: 'v', style: { ...S.hint, flex: 1, textAlign: 'right' } }, t('ig.allowedHint')),
          ]),
          pathList('allowedRoots', allowedRoots),
        ]),
        h(Group, {
          key: 'status',
          title: t('ig.group.status'),
          actions: [
            h('button', {
              key: 'repair', type: 'button', style: S.action, disabled: busy === 'repair',
              onClick: repair,
            }, busy === 'repair' ? t('ig.repairing') : t('ig.repair')),
          ],
        }, [
          last
            ? h('p', { key: 's', style: S.hint },
              `${t('ig.last')}：${t('ig.checked')} ${last.checked} ${t('ig.dirs')} · ${t('ig.fixed')} ${last.fixed} · ${t('ig.failed')} ${last.errors} · ${t('ig.took')} ${last.tookMs} ms`)
            : h('p', { key: 's', style: S.hint }, t('ig.empty')),
          last && last.errors > 0 ? h('p', { key: 'admin', style: S.note }, t('ig.adminHint')) : null,
          notice ? h('p', { key: 'notice', style: S.hint }, notice) : null,
          error ? h('p', { key: 'err', style: S.note }, `${t('error')}: ${error}`) : null,
        ]),
        h(Group, { key: 'log', title: t('ig.group.log'), note: `${entries.length}` }, [
          entries.length === 0
            ? h('p', { key: 'empty', style: S.hint }, t('ig.empty'))
            : h('div', { key: 'rows', style: S.logs }, entries.slice(-40).reverse().map((entry, index) =>
              h('div', { key: String(index), style: S.logRow }, [
                h('span', { key: 't', style: S.logTime }, formatTime(entry.at)),
                h('span', { key: 'k', style: S.logKind }, String(entry.kind || '')),
                h('span', { key: 'p', style: S.logPath, title: entry.path || entry.message || '' },
                  entry.path ? `${entry.path}${entry.message ? ` — ${entry.message}` : ''}` : String(entry.message || '')),
              ]))),
        ]),
      ]);
    }

    function PermissionIcon() {
      return h('svg', { viewBox: '0 0 24 24', width: 16, height: 16, 'aria-hidden': 'true' }, [
        h('path', {
          key: 'p', fill: 'currentColor',
          d: 'M12 2 4 5v6.1c0 4.9 3.4 9.4 8 10.9 4.6-1.5 8-6 8-10.9V5l-8-3zm0 2.2 6 2.2v4.7c0 3.9-2.6 7.6-6 8.9-3.4-1.3-6-5-6-8.9V6.4l6-2.2zm-1 5.1v3.4H8v2h3v3.3h2v-3.3h3v-2h-3V9.3h-2z',
        }),
      ]);
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { zh: ZH, en: EN }), 'permission-guard: dictionaries');
        const settingsT = ctx.locale.bind(NS);

        ctx.effect(() => ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section',
          id: 'permission-guard',
          order: 41,
          label: () => settingsT('settings.title'),
          locale: NS,
        }, PermissionPage)), 'permission-guard: settings section');

        ctx.effect(() => ctx.slots.inject('settings.section.icon', () => ctx.slots.register({
          name: 'settings.section.icon',
          id: 'permission-guard',
        }, PermissionIcon)), 'permission-guard: settings nav icon');
      },
    };
  },
});
