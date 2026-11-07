#!/usr/bin/env node
/**
 * 目录与契约校验。
 *
 * 检查项：
 *   1. catalog/assets.json 结构、数量、唯一性
 *   2. 分类树与 category.primary 的对应关系
 *   3. 能力位与安装模式的一致性
 *   4. 安装源目录、入口文件、依赖资产是否存在
 *   5. 导出记录是否符合 asset-record/3.0 schema
 *   6. 仓库内是否残留旧仓库绝对路径、沙箱绝对路径或凭证样式
 */

import fs from 'node:fs';
import path from 'node:path';
import { validate } from './lib/schema.mjs';
import {
  REPO_ROOT,
  CATALOG_FILE,
  SCHEMA_FILE,
  loadCatalog,
  buildExport,
  readJson,
  collectFiles,
} from '../export/lib.mjs';

const quiet = process.argv.includes('--quiet');
const problems = [];
const notes = [];

function fail(message) {
  problems.push(message);
}

function ok(message) {
  notes.push(message);
}

const catalog = loadCatalog();
const schema = readJson(SCHEMA_FILE);

if (catalog.schema_version !== 'asset-catalog/3.0') fail(`catalog.schema_version 期望 asset-catalog/3.0，实际 ${catalog.schema_version}`);
if (!catalog.marketplace?.id) fail('catalog.marketplace.id 缺失');

// 分类树
const categoryIds = new Set();
for (const root of catalog.categories || []) {
  categoryIds.add(root.id);
  for (const child of root.children || []) categoryIds.add(child.id);
}

// 资产
const assets = catalog.assets || [];
const ids = new Set();
const slugs = new Set();
const counts = {};

for (const asset of assets) {
  const label = asset.asset_id || asset.slug || '(unknown)';
  if (ids.has(asset.asset_id)) fail(`${label}: asset_id 重复`);
  if (slugs.has(asset.slug)) fail(`${label}: slug 重复`);
  ids.add(asset.asset_id);
  slugs.add(asset.slug);

  if (!categoryIds.has(asset.category?.primary)) fail(`${label}: category.primary ${asset.category?.primary} 不在分类树中`);
  const top = asset.category?.primary?.split('/')[0];
  counts[top] = (counts[top] || 0) + 1;

  const install = asset.capabilities?.install;
  if (!install) {
    fail(`${label}: 缺少 capabilities.install`);
    continue;
  }
  const modes = install.modes || [];
  if (!modes.length) fail(`${label}: install.modes 为空`);
  if (modes.some((mode) => !['direct', 'prompt', 'toggle'].includes(mode))) fail(`${label}: install.modes 含未知值 ${modes.join(',')}`);

  const toggle = asset.capabilities.toggle;
  if (modes.includes('toggle')) {
    if (!toggle?.supported) fail(`${label}: 含 toggle 模式但 toggle.supported 为 false`);
    if (!toggle?.key) fail(`${label}: 含 toggle 模式但未声明配置键`);
  } else if (toggle?.supported) {
    fail(`${label}: toggle.supported 为 true 但 install.modes 不含 toggle`);
  }

  if (modes.includes('direct')) {
    if (!install.target) fail(`${label}: direct 模式缺少 target`);
    else if (!/^(skills\/|plugins\/cache\/)/.test(install.target)) fail(`${label}: direct target 必须以 skills/ 或 plugins/cache/ 开头，实际 ${install.target}`);
    if (!install.source) fail(`${label}: direct 模式缺少 source`);
  }

  if (install.source) {
    const sourceAbs = path.join(REPO_ROOT, install.source);
    if (!fs.existsSync(sourceAbs)) {
      fail(`${label}: 安装源不存在 ${install.source}`);
    } else if (install.entry) {
      const entryAbs = path.join(sourceAbs, install.entry);
      if (!fs.existsSync(entryAbs)) fail(`${label}: 入口文件不存在 ${install.source}/${install.entry}`);
    }
  }

  for (const dependency of install.dependencies || []) {
    if (!ids.has(dependency.asset_id)) {
      // 依赖可能出现在后面的记录里，先记录，最后统一复查
      notes.push(`__dep__${dependency.asset_id}`);
    }
  }

  if (asset.showcase) {
    for (const key of ['artifact_url', 'thumbnail', ...(asset.showcase.screenshots || [])]) {
      if (typeof key === 'string' && /^(catalog|data|bundles)\//.test(key) && !fs.existsSync(path.join(REPO_ROOT, key))) {
        fail(`${label}: showcase 文件不存在 ${key}`);
      }
    }
  }

  if (asset.same_as) {
    for (const dependency of asset.same_as.dependent_assets || []) {
      if (!assets.some((item) => item.asset_id === dependency.asset_id)) fail(`${label}: same_as 依赖不存在 ${dependency.asset_id}`);
    }
  }

  for (const value of [asset.asset_id, asset.slug, install?.source, install?.target, install?.entry]) {
    if (typeof value === 'string' && (path.isAbsolute(value) || value.startsWith('~') || /^[A-Za-z]:\\/.test(value))) {
      fail(`${label}: 出现绝对路径或用户目录 ${value}`);
    }
  }
}

const expectedCounts = { skill: 6, expert: 3, team: 2, connector: 2, template: 1, 'platform-extension': 1 };
for (const [key, value] of Object.entries(expectedCounts)) {
  if (counts[key] !== value) fail(`分类 ${key} 期望 ${value} 条，实际 ${counts[key] || 0} 条`);
}
if (assets.length !== 15) fail(`资产总数期望 15，实际 ${assets.length}`);

// 依赖复查
for (const asset of assets) {
  for (const dependency of asset.capabilities?.install?.dependencies || []) {
    if (!ids.has(dependency.asset_id)) fail(`${asset.asset_id}: 依赖资产不存在 ${dependency.asset_id}`);
  }
  for (const dependency of asset.same_as?.dependent_assets || []) {
    if (!ids.has(dependency.asset_id)) fail(`${asset.asset_id}: same_as 依赖不存在 ${dependency.asset_id}`);
  }
}

// 导出 schema 校验
let exported;
try {
  exported = buildExport({ catalog, schema });
  ok(`导出校验通过：${exported.counts.total} 条资产（${Object.entries(exported.counts.by_category).map(([k, v]) => `${k} ${v}`).join(' / ')}）`);
} catch (error) {
  fail(error.message);
}

// 禁止残留
const SKIP_DIRS = new Set(['.git', 'node_modules', 'runtime', 'dist']);
const TEXT_EXT = new Set(['.json', '.md', '.mjs', '.js', '.html', '.css', '.svg', '.txt', '.yml', '.yaml', '.sql', '.sh', '.ps1']);
const FORBIDDEN = [
  { pattern: /D:\\GitHub\\dsh-fmcg-index/i, label: '旧仓库 dsh-fmcg-index 的绝对路径' },
  { pattern: /D:\\GitHub\\ai-asset-hub/i, label: '旧仓库 ai-asset-hub 的绝对路径' },
  { pattern: /C:\\Users\\/i, label: '本机用户目录绝对路径' },
  { pattern: /AppData\\Local\\Temp/i, label: '本机临时目录绝对路径' },
  { pattern: /%TEMP%\\wb-/i, label: '沙箱临时目录残留' },
  { pattern: /(?:password|passwd|secret|token)\s*[:=]\s*["'][^"']{8,}["']/i, label: '疑似明文凭证' },
];

function scan(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      scan(abs);
      continue;
    }
    const ext = path.extname(entry.name).toLowerCase();
    if (!TEXT_EXT.has(ext)) continue;
    const text = fs.readFileSync(abs, 'utf8');
    for (const rule of FORBIDDEN) {
      if (rule.pattern.test(text)) fail(`${path.relative(REPO_ROOT, abs)}: 发现${rule.label}`);
    }
  }
}
scan(REPO_ROOT);

if (!quiet) {
  for (const note of notes.filter((item) => !item.startsWith('__dep__'))) console.log(`[ok] ${note}`);
}

if (problems.length) {
  console.error('[error] 校验未通过：');
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

console.log(`[ok] 校验通过：${assets.length} 条资产，分类 ${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(' / ')}`);
