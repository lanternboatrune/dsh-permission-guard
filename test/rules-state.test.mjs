import { extractTargetPaths, isWithin, commandHitsRoots } from '../lib/rules.js';
import { normalizeState, scanWorkspaceDirs, inspectRoot } from '../lib/state.js';

let pass = 0;
let fail = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) pass += 1;
  else fail += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label} -> ${JSON.stringify(actual)}`);
};

check('write file_path', extractTargetPaths('write', { file_path: 'D:\\Develop\\SoC Tycoon\\app\\index.html' }), [
  'D:\\Develop\\SoC Tycoon\\app\\index.html',
]);

check('edit file_path', extractTargetPaths('edit', { file_path: 'C:\\a\\b.txt', old_string: 'x', new_string: 'y' }), ['C:\\a\\b.txt']);

const patch = [
  '*** Begin Patch',
  '*** Update File: D:\\Develop\\SoC Tycoon\\app\\index.html',
  '@@',
  '-old',
  '+new',
  '*** Add File: D:\\Develop\\SoC Tycoon\\meta\\x.json',
  '+{}',
  '*** End Patch',
].join('\n');
check('apply_patch targets', extractTargetPaths('apply_patch', { input: patch }), [
  'D:\\Develop\\SoC Tycoon\\app\\index.html',
  'D:\\Develop\\SoC Tycoon\\meta\\x.json',
]);

check('isWithin child', isWithin('D:\\Develop\\X\\a.txt', 'D:\\Develop\\X'), true);
check('isWithin prefix trap', isWithin('D:\\Develop\\XY\\a.txt', 'D:\\Develop\\X'), false);
check('isWithin case', isWithin('d:\\develop\\x\\A.TXT', 'D:\\Develop\\X'), true);
check('isWithin self', isWithin('D:\\Develop\\X', 'D:\\Develop\\X'), true);

const normalized = normalizeState({
  enabled: 'nope',
  roots: [
    { path: 'D:\\ok', access: 'write' },
    { path: 'D:\\ok', access: 'read' },
    { path: '  ', access: 'write' },
    { path: 'D:\\bad', access: 'weird' },
  ],
  tools: { write: 'deny', pwsh: 'auto', bogus: 'deny' },
  options: { autoApproveDangerFullAccess: 1, logLimit: -5 },
});
check('normalize roots', normalized.roots, [
  { path: 'D:\\ok', access: 'write', enabled: true },
  { path: 'D:\\bad', access: 'read', enabled: true },
]);
check('normalize tools', normalized.tools, { write: 'deny', edit: 'auto', apply_patch: 'auto', pwsh: 'ask' });
check('normalize options', normalized.options, { autoApproveDangerFullAccess: false, shellSilent: true, trustAllWorkspaces: false, logLimit: 200 });
check('normalize enabled', normalized.enabled, true);
check(
  'normalize shellSilent strict boolean',
  normalizeState({ options: { shellSilent: 'yes' } }).options.shellSilent,
  true,
);
check(
  'normalize shellSilent false kept',
  normalizeState({ options: { shellSilent: false } }).options.shellSilent,
  false,
);
check(
  'normalize trustAllWorkspaces strict boolean',
  normalizeState({ options: { trustAllWorkspaces: 1 } }).options.trustAllWorkspaces,
  false,
);
check(
  'normalize trustAllWorkspaces true kept',
  normalizeState({ options: { trustAllWorkspaces: true } }).options.trustAllWorkspaces,
  true,
);

// 命令文本匹配：用户选择「命令里出现白名单路径，或 cwd 在白名单内」
const ROOT = 'D:\\Develop\\SoC Tycoon';
check('shell: cd into root', commandHitsRoots({ command: `cd '${ROOT}'; node scripts/build.mjs` }, [ROOT]), [ROOT]);
check('shell: absolute path argument', commandHitsRoots({ command: `node "${ROOT}\\scripts\\build.mjs"` }, [ROOT]), [ROOT]);
check('shell: workdir inside root', commandHitsRoots({ command: 'npm run build', workdir: `${ROOT}\\app` }, [ROOT]), [ROOT]);
check('shell: forward slashes', commandHitsRoots({ command: 'node D:/Develop/SoC Tycoon/build.mjs' }, [ROOT]), [ROOT]);
check('shell: case insensitive', commandHitsRoots({ command: `cd 'd:\\develop\\soc tycoon'` }, [ROOT]), [ROOT]);
check('shell: prefix trap does not match', commandHitsRoots({ command: 'cd D:\\Develop\\SoC TycoonOld' }, [ROOT]), []);
check('shell: unrelated command', commandHitsRoots({ command: 'Get-Date' }, [ROOT]), []);
check('shell: read-only root ignored upstream', commandHitsRoots({ command: `cd '${ROOT}'` }, []), []);

const workspace = process.cwd();
const dirs = scanWorkspaceDirs(workspace, 1);
console.log(`scan depth1 -> ${dirs.length} dirs`);
check('inspectRoot accepts workspace', inspectRoot(workspace).ok, true);
check('inspectRoot rejects missing dir', inspectRoot('D:\\definitely-not-a-real-dir-20261112').ok, false);
check('inspectRoot rejects empty', inspectRoot('  ').ok, false);
// 多工作区：子目录授权必须按绝对路径存，相对键一律丢弃（否则跨工作区串台）。
const multi = normalizeState({
  workspaceSubdirs: {
    'D:\\Develop\\SoC Tycoon\\app': 'write',
    'D:\\Develop\\SoC Tycoon\\docs': 'read',
    'develop-plugins': 'write',
    'C10': 'read',
  },
});
check('subdirs: absolute write kept', multi.workspaceSubdirs['D:\\Develop\\SoC Tycoon\\app'], 'write');
check('subdirs: absolute read kept', multi.workspaceSubdirs['D:\\Develop\\SoC Tycoon\\docs'], 'read');
check('subdirs: relative keys dropped', Object.keys(multi.workspaceSubdirs).length, 2);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
