/**
 * 客户端安装器：只依据 capabilities.install.modes 与 target 决定行为，
 * 不按 category / slug 分支。
 *
 *   direct → 复制目录并登记（技能写 _user_meta.json，插件写注册表）
 *   prompt → 不落盘，返回「安装方法 + 提示词」整段文本
 *   toggle → 不落盘，改写宿主设置键
 *
 * 所有写入都限制在 root 内。服务端另有一层真实根目录锁（默认只允许沙箱）。
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HERE, '..');
export const CATALOG_FILE = path.join(REPO_ROOT, 'catalog', 'assets.json');
export const MARKETPLACE_ID = 'mdl-plugin-market';
export const MARKETPLACE_DIR = path.join(REPO_ROOT, 'catalog', 'content', 'marketplace');
export const DEFAULT_ROOT = path.join(os.homedir(), '.workbuddy');

const NAME_RE = /^[a-z0-9][a-z0-9._-]*$/;
const VERSION_RE = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
const MAX_VERSIONS = 3;

function assertName(name) {
  if (!NAME_RE.test(name || '')) throw new Error(`名称不合规：${name}`);
}

function assertVersion(version) {
  if (!VERSION_RE.test(version || '')) throw new Error(`版本不合规：${version}`);
}

function assertInside(root, target, label) {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(target);
  if (resolved !== resolvedRoot && !resolved.startsWith(resolvedRoot + path.sep)) {
    throw new Error(`${label}越界：${target}`);
  }
  return resolved;
}

function exists(file) {
  return fs.existsSync(file);
}

function readJson(file, fallback) {
  if (!exists(file)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function writeText(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, value, 'utf8');
}

function copyDir(source, target) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.cpSync(source, target, { recursive: true });
}

function backupPath(root, label) {
  const dir = path.join(root, 'backups', label);
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`);
}

function backupFile(root, file) {
  if (!exists(file)) return null;
  const target = backupPath(root, 'files') + path.extname(file);
  fs.copyFileSync(file, target);
  return target;
}

function backupDir(root, target, label) {
  if (!exists(target)) return null;
  const dest = backupPath(root, label);
  fs.cpSync(target, dest, { recursive: true });
  return dest;
}

function pluginsDir(root) {
  return path.join(root, 'plugins');
}

function installedFile(root) {
  return path.join(pluginsDir(root), 'installed_plugins.json');
}

function knownFile(root) {
  return path.join(pluginsDir(root), 'known_marketplaces.json');
}

function settingsFile(root) {
  return path.join(root, 'settings.json');
}

function loadInstalled(root) {
  const value = readJson(installedFile(root), null);
  if (value && typeof value === 'object') return value;
  return { version: 2, plugins: {} };
}

function loadKnown(root) {
  const value = readJson(knownFile(root), null);
  return value && typeof value === 'object' ? value : {};
}

export function resolveRoot(explicit) {
  return path.resolve(explicit || process.env.WB_ROOT || DEFAULT_ROOT);
}

export function isRealRoot(root) {
  const normalized = path.resolve(root).toLowerCase();
  return normalized === path.resolve(DEFAULT_ROOT).toLowerCase();
}

export function loadCatalog(file = CATALOG_FILE) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export function findAsset(id, catalog = loadCatalog()) {
  const asset = catalog.assets.find((item) => item.asset_id === id || item.slug === id);
  if (!asset) throw new Error(`未知资产：${id}`);
  return asset;
}

export function resolveTarget(asset) {
  const target = asset.capabilities?.install?.target;
  if (!target) return null;
  return target
    .replaceAll('{name}', asset.slug)
    .replaceAll('{version}', asset.version)
    .replaceAll('{market}', MARKETPLACE_ID);
}

function assetSource(asset, sourceDir) {
  if (sourceDir) return path.resolve(sourceDir);
  const relative = asset.capabilities?.install?.source;
  if (!relative) throw new Error(`资产 ${asset.asset_id} 没有安装源`);
  return path.join(REPO_ROOT, relative);
}

function dependencyPrompt(asset, catalog) {
  const dependencies = asset.capabilities?.install?.dependencies || [];
  if (!dependencies.length) return '';
  const lines = dependencies.map((dependency) => {
    const target = catalog.assets.find((item) => item.asset_id === dependency.asset_id);
    return `- ${target?.name?.zh || dependency.asset_id} ${dependency.version}${dependency.optional ? '（可选）' : ''}`;
  });
  return `依赖技能：\n${lines.join('\n')}\n\n`;
}

export function buildPrompt(asset, { catalog = loadCatalog(), reason = '' } = {}) {
  const title = asset.name?.zh || asset.slug;
  const prompt = asset.same_as?.prompt || asset.examples?.[0]?.prompt || '请按这个资产说明的方式帮我完成任务。';
  const install = asset.capabilities?.install || {};
  const modes = install.modes || [];
  const how = modes.includes('direct')
    ? `在 WorkBuddy 市场中搜索「${asset.slug}」并安装（${install.target || '客户端内置路径'}）。\n如果当前客户端无法安装，直接把下面的提示词发给 AI，让它在当前会话里按同等能力工作。`
    : '这条资产以提示词方式使用，不需要安装包。';
  return [
    `【${title}】${reason ? `（${reason}）` : ''}`,
    '',
    asset.summary?.zh || '',
    '',
    '安装方法：',
    how,
    '',
    dependencyPrompt(asset, catalog),
    '提示词：',
    prompt,
  ]
    .filter((line) => line !== undefined)
    .join('\n')
    .trim();
}

function promptResult(asset, catalog) {
  return {
    ok: true,
    asset_id: asset.asset_id,
    mode: 'prompt',
    prompt: buildPrompt(asset, { catalog }),
    actions: [],
  };
}

function setNested(object, keyPath, value) {
  const parts = keyPath.split('.');
  let cursor = object;
  for (const part of parts.slice(0, -1)) {
    if (!cursor[part] || typeof cursor[part] !== 'object') cursor[part] = {};
    cursor = cursor[part];
  }
  cursor[parts[parts.length - 1]] = value;
  return object;
}

function getNested(object, keyPath) {
  return keyPath.split('.').reduce((node, part) => (node == null ? undefined : node[part]), object);
}

function applyToggle(asset, root, { dryRun, value }) {
  const toggle = asset.capabilities.toggle;
  if (!toggle?.supported || !toggle.key) throw new Error(`资产 ${asset.asset_id} 没有可用的 toggle 配置`);
  const next = typeof value === 'boolean' ? value : true;
  const file = settingsFile(root);
  const actions = [
    { op: 'write-file', to: file, note: `${toggle.key} = ${next}` },
  ];
  if (dryRun) return { ok: true, dryRun: true, mode: 'toggle', key: toggle.key, value: next, actions };

  const backups = [backupFile(root, file)].filter(Boolean);
  const settings = readJson(file, {});
  setNested(settings, toggle.key, next);
  writeJson(file, settings);
  return {
    ok: true,
    asset_id: asset.asset_id,
    mode: 'toggle',
    key: toggle.key,
    value: next,
    settingsPath: file,
    actions,
    backups,
  };
}

function installedRecord(asset, root) {
  const modes = asset.capabilities?.install?.modes || [];
  if (modes.includes('toggle')) {
    const file = settingsFile(root);
    const settings = readJson(file, {});
    const value = getNested(settings, asset.capabilities.toggle.key);
    return {
      installed: value !== undefined,
      version: null,
      installPath: value !== undefined ? file : null,
      toggleValue: value,
    };
  }

  if (!modes.includes('direct')) {
    return { installed: false, version: null, installPath: null, promptOnly: true };
  }

  const target = resolveTarget(asset);
  if (!target) return { installed: false, version: null, installPath: null };
  const abs = assertInside(root, path.join(root, target), '安装目录');

  if (target.startsWith('skills/')) {
    return exists(abs)
      ? { installed: true, version: asset.version, installPath: abs }
      : { installed: false, version: null, installPath: null };
  }

  const registry = loadInstalled(root);
  const records = registry.plugins?.[`${asset.slug}@${MARKETPLACE_ID}`];
  const record = Array.isArray(records) ? records.find((item) => item.version === asset.version) : null;
  if (record && exists(record.installPath)) {
    return { installed: true, version: record.version, installPath: record.installPath };
  }
  return exists(abs)
    ? { installed: true, version: asset.version, installPath: abs }
    : { installed: false, version: null, installPath: null };
}

export function install(asset, root, { dryRun = false, mode = null, sourceDir = null, catalog = loadCatalog(), toggleValue = undefined } = {}) {
  const modes = asset.capabilities?.install?.modes || [];
  const chosen = mode || (modes.includes('direct') ? 'direct' : modes.includes('toggle') ? 'toggle' : 'prompt');

  if (chosen === 'prompt') return promptResult(asset, catalog);
  if (chosen === 'toggle') return applyToggle(asset, root, { dryRun, value: toggleValue });
  if (!modes.includes('direct')) throw new Error(`资产 ${asset.asset_id} 不支持直接安装`);

  const target = resolveTarget(asset);
  if (!target) throw new Error(`资产 ${asset.asset_id} 缺少安装 target`);
  assertName(asset.slug);
  assertVersion(asset.version);
  const targetAbs = assertInside(root, path.join(root, target), '安装目录');
  const source = assetSource(asset, sourceDir);
  if (!exists(source)) throw new Error(`安装源不存在：${source}`);

  if (target.startsWith('skills/')) {
    const actions = [
      { op: 'copy-dir', from: source, to: targetAbs },
      { op: 'write-file', to: path.join(targetAbs, '_user_meta.json') },
    ];
    if (dryRun) return { ok: true, dryRun: true, mode: 'direct', actions };

    const backups = [backupDir(root, targetAbs, 'skills')].filter(Boolean);
    if (exists(targetAbs)) fs.rmSync(targetAbs, { recursive: true, force: true });
    copyDir(source, targetAbs);
    writeJson(path.join(targetAbs, '_user_meta.json'), {
      name: asset.name?.zh || asset.slug,
      installedAt: Date.now(),
      source: 'userImport',
      marketplace: MARKETPLACE_ID,
      asset_id: asset.asset_id,
      version: asset.version,
    });
    return { ok: true, asset_id: asset.asset_id, mode: 'direct', installPath: targetAbs, version: asset.version, actions, backups };
  }

  if (!target.startsWith('plugins/cache/')) {
    throw new Error(`无法识别的安装目标：${target}`);
  }

  const actions = [
    { op: 'register-marketplace', to: knownFile(root) },
    { op: 'copy-dir', from: source, to: targetAbs },
    { op: 'write-file', to: path.join(targetAbs, '.downloaded_at') },
    { op: 'upsert-registry', to: `${installedFile(root)} → plugins["${asset.slug}@${MARKETPLACE_ID}"]` },
  ];
  if (dryRun) return { ok: true, dryRun: true, mode: 'direct', actions };

  const backups = [backupFile(root, installedFile(root)), backupFile(root, knownFile(root))].filter(Boolean);

  const known = loadKnown(root);
  known[MARKETPLACE_ID] = {
    manifestName: MARKETPLACE_ID,
    type: 'directory',
    source: { source: 'directory', path: MARKETPLACE_DIR },
    installLocation: MARKETPLACE_DIR,
    description: 'MDL 插件市场（本地目录源）',
    lastUpdated: new Date().toISOString(),
    autoUpdate: false,
    isBuiltIn: false,
  };
  writeJson(knownFile(root), known);

  if (exists(targetAbs)) fs.rmSync(targetAbs, { recursive: true, force: true });
  copyDir(source, targetAbs);
  writeText(path.join(targetAbs, '.downloaded_at'), `${new Date().toISOString()}\n`);

  const registry = loadInstalled(root);
  registry.version = registry.version || 2;
  registry.plugins = registry.plugins || {};
  const key = `${asset.slug}@${MARKETPLACE_ID}`;
  const now = new Date().toISOString();
  const records = Array.isArray(registry.plugins[key]) ? registry.plugins[key] : [];
  const kept = records.filter((record) => record.version !== asset.version);
  kept.push({ scope: 'user', installPath: targetAbs, version: asset.version, installedAt: now, lastUpdated: now });
  registry.plugins[key] = kept
    .sort((a, b) => Date.parse(b.lastUpdated || 0) - Date.parse(a.lastUpdated || 0))
    .slice(0, MAX_VERSIONS);
  writeJson(installedFile(root), registry);

  return { ok: true, asset_id: asset.asset_id, mode: 'direct', installPath: targetAbs, version: asset.version, actions, backups };
}

export function uninstall(asset, root, { dryRun = false, mode = null } = {}) {
  const modes = asset.capabilities?.install?.modes || [];
  const chosen = mode || (modes.includes('direct') ? 'direct' : modes.includes('toggle') ? 'toggle' : 'prompt');
  if (chosen === 'prompt') return { ok: true, asset_id: asset.asset_id, mode: 'prompt', alreadyRemoved: true, actions: [] };
  if (chosen === 'toggle') {
    const toggle = asset.capabilities.toggle;
    const actions = [{ op: 'write-file', to: settingsFile(root), note: `${toggle.key} = ${toggle.default}` }];
    if (dryRun) return { ok: true, dryRun: true, mode: 'toggle', actions };
    const settings = readJson(settingsFile(root), {});
    setNested(settings, toggle.key, toggle.default);
    writeJson(settingsFile(root), settings);
    return { ok: true, asset_id: asset.asset_id, mode: 'toggle', key: toggle.key, value: toggle.default, actions };
  }

  const current = installedRecord(asset, root);
  if (!current.installed) return { ok: true, asset_id: asset.asset_id, alreadyRemoved: true, actions: [] };

  const target = resolveTarget(asset);
  const targetAbs = assertInside(root, path.join(root, target), '安装目录');
  const actions = target.startsWith('skills/')
    ? [{ op: 'remove-dir', to: targetAbs }]
    : [
        { op: 'remove-dir', to: path.dirname(targetAbs) },
        { op: 'remove-registry-entry', to: `${installedFile(root)} → plugins["${asset.slug}@${MARKETPLACE_ID}"]` },
      ];
  if (dryRun) return { ok: true, dryRun: true, mode: 'direct', actions };

  if (target.startsWith('skills/')) {
    const backups = [backupDir(root, targetAbs, 'skills')].filter(Boolean);
    fs.rmSync(targetAbs, { recursive: true, force: true });
    return { ok: true, asset_id: asset.asset_id, mode: 'direct', removed: targetAbs, actions, backups };
  }

  const backups = [backupFile(root, installedFile(root))].filter(Boolean);
  const registry = loadInstalled(root);
  const key = `${asset.slug}@${MARKETPLACE_ID}`;
  let registryUpdated = false;
  if (registry.plugins?.[key]) {
    delete registry.plugins[key];
    writeJson(installedFile(root), registry);
    registryUpdated = true;
  }
  const cache = assertInside(root, path.join(root, path.dirname(target)), '插件缓存目录');
  fs.rmSync(cache, { recursive: true, force: true });
  return { ok: true, asset_id: asset.asset_id, mode: 'direct', removed: cache, registryUpdated, actions, backups };
}

export function statusList(assets, root) {
  const known = loadKnown(root);
  const registration = known[MARKETPLACE_ID];
  return {
    root,
    realRoot: isRealRoot(root),
    marketplace: registration && registration.installLocation === MARKETPLACE_DIR
      ? { registered: true, installLocation: registration.installLocation }
      : { registered: false },
    entries: assets.map((asset) => {
      const record = installedRecord(asset, root);
      const modes = asset.capabilities?.install?.modes || [];
      return {
        asset_id: asset.asset_id,
        mode: modes.includes('direct') ? 'direct' : modes.includes('toggle') ? 'toggle' : 'prompt',
        modes,
        installed: record.installed,
        installedVersion: record.version || null,
        installPath: record.installPath || null,
        toggleValue: record.toggleValue,
      };
    }),
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = { command: argv[0] || 'list', id: argv[1] || null, root: null, dryRun: false, mode: null, allowReal: false, json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--root') args.root = argv[++i];
    else if (token === '--dry-run') args.dryRun = true;
    else if (token === '--mode') args.mode = argv[++i];
    else if (token === '--allow-real') args.allowReal = true;
    else if (token === '--json') args.json = true;
    else if (token === '--help' || token === '-h') args.help = true;
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(`用法：node client/installer.mjs <list|status|install|uninstall> [asset_id] [选项]

  --root <dir>   沙箱根目录，默认 $WB_ROOT 或 ~/.workbuddy
  --dry-run      只输出计划，不落盘
  --mode <mode>  direct | prompt | toggle，默认按资产能力自动选择
  --allow-real   允许写真实 ~/.workbuddy（默认拒绝）
  --json         输出 JSON
`);
    return;
  }

  const catalog = loadCatalog();
  const root = resolveRoot(args.root);

  if (['install', 'uninstall'].includes(args.command) && isRealRoot(root) && !args.allowReal) {
    console.error(`[lock] 根目录是真实 ~/.workbuddy，默认拒绝写入。请用 --root <沙箱目录>，或显式加 --allow-real。`);
    process.exit(3);
  }

  if (args.command === 'list') {
    const data = catalog.assets.map((asset) => ({ asset_id: asset.asset_id, category: asset.category.primary, modes: asset.capabilities.install.modes }));
    if (args.json) console.log(JSON.stringify(data, null, 2));
    else for (const item of data) console.log(`${item.asset_id}\t${item.category}\t${item.modes.join('+')}`);
    return;
  }

  if (args.command === 'status') {
    const result = statusList(catalog.assets, root);
    if (args.json) console.log(JSON.stringify(result, null, 2));
    else {
      console.log(`root=${result.root} realRoot=${result.realRoot} marketplace=${result.marketplace.registered}`);
      for (const item of result.entries) console.log(`${item.installed ? 'installed' : 'missing'}\t${item.asset_id}\t${item.mode}${item.installedVersion ? ` ${item.installedVersion}` : ''}`);
    }
    return;
  }

  if (!args.id) {
    console.error('[error] 缺少 asset_id');
    process.exit(1);
  }
  const asset = findAsset(args.id, catalog);

  const result = args.command === 'install'
    ? install(asset, root, { dryRun: args.dryRun, mode: args.mode })
    : args.command === 'uninstall'
      ? uninstall(asset, root, { dryRun: args.dryRun, mode: args.mode })
      : null;

  if (!result) {
    console.error(`[error] 未知命令：${args.command}`);
    process.exit(1);
  }
  if (args.json) console.log(JSON.stringify(result, null, 2));
  else if (result.mode === 'prompt') console.log(result.prompt);
  else console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`[error] ${error.message}`);
    process.exit(1);
  });
}
