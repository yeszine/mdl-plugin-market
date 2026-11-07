import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validate } from '../scripts/lib/schema.mjs';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const CATALOG_FILE = path.join(REPO_ROOT, 'catalog', 'assets.json');
export const SCHEMA_FILE = path.join(REPO_ROOT, 'export', 'schema', 'asset-record.schema.json');
export const DEFAULT_OUT = path.join(REPO_ROOT, 'export', 'assets.json');

export const CATEGORY_ORDER = ['skill', 'expert', 'team', 'connector', 'template', 'platform-extension'];

export function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

export function toPosix(value) {
  return value.split(path.sep).join('/');
}

export function git(args) {
  try {
    return execFileSync('git', args, {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
}

export function resolveCommit() {
  // 只认显式环境变量，避免每次提交后导出产物都变脏。
  // CI / 发布时设置 GIT_COMMIT=<sha>，导出即可复现同一条记录。
  return process.env.GIT_COMMIT || 'unknown';
}

export function resolveGeneratedAt(catalog, cliValue) {
  if (cliValue) return cliValue;
  const epoch = process.env.SOURCE_DATE_EPOCH;
  if (epoch && Number.isFinite(Number(epoch))) return new Date(Number(epoch) * 1000).toISOString();
  const declared = catalog.marketplace?.updated_at;
  if (declared) return declared;
  const commitDate = git(['log', '-1', '--format=%cI']);
  if (commitDate) return commitDate;
  return '1970-01-01T00:00:00Z';
}

export function loadCatalog(file = CATALOG_FILE) {
  return readJson(file);
}

function walk(root, base, output) {
  const entries = fs
    .readdirSync(root, { withFileTypes: true })
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const entry of entries) {
    const abs = path.join(root, entry.name);
    if (entry.isDirectory()) walk(abs, base, output);
    else if (entry.isFile()) output.push(toPosix(path.relative(base, abs)));
  }
  return output;
}

export function collectFiles(sourceRelative) {
  if (!sourceRelative) return [];
  const abs = path.join(REPO_ROOT, sourceRelative);
  if (!fs.existsSync(abs)) throw new Error(`资产目录不存在：${sourceRelative}`);
  const stat = fs.statSync(abs);
  const base = stat.isDirectory() ? abs : path.dirname(abs);
  const relativeFiles = stat.isDirectory() ? walk(abs, base, []) : [path.basename(abs)];
  return relativeFiles.sort().map((relativePath) => {
    const file = stat.isDirectory() ? path.join(abs, ...relativePath.split('/')) : abs;
    const buffer = fs.readFileSync(file);
    return {
      path: toPosix(path.join(sourceRelative, relativePath)),
      size: buffer.length,
      sha256: sha256(buffer),
    };
  });
}

export function buildDigest(record) {
  const payload = [record.asset_id, record.version, ...record.files.map((file) => `${file.path}:${file.sha256}`)].join('\n');
  return sha256(Buffer.from(payload, 'utf8'));
}

export function categoryId(record) {
  return record.category.primary.split('/')[0];
}

export function sortAssets(assets) {
  return [...assets].sort((a, b) => {
    const rank = CATEGORY_ORDER.indexOf(categoryId(a)) - CATEGORY_ORDER.indexOf(categoryId(b));
    if (rank !== 0) return rank;
    return a.asset_id < b.asset_id ? -1 : a.asset_id > b.asset_id ? 1 : 0;
  });
}

export function buildExport({ catalog = loadCatalog(), generatedAt, commit, schema = readJson(SCHEMA_FILE) } = {}) {
  const at = generatedAt || resolveGeneratedAt(catalog);
  const head = commit || resolveCommit();
  const counts = { total: 0, by_category: {} };

  const assets = sortAssets(catalog.assets).map((source) => {
    const files = collectFiles(source.capabilities.install.source);
    const record = {
      ...source,
      files,
      digest: '',
      source: {
        repo: 'mdl-plugin-market',
        commit: head,
        path: source.capabilities.install.source,
        exported_at: at,
      },
    };
    record.digest = buildDigest(record);
    const errors = validate(record, schema);
    if (errors.length) {
      throw new Error(`资产 ${source.asset_id} 不符合 schema：\n  - ${errors.join('\n  - ')}`);
    }
    counts.total += 1;
    const category = categoryId(record);
    counts.by_category[category] = (counts.by_category[category] || 0) + 1;
    return record;
  });

  return {
    schema_version: 'asset-record-set/3.0',
    marketplace: catalog.marketplace,
    generated_at: at,
    commit: head,
    counts,
    assets,
  };
}

export function serializeExport(doc) {
  return `${JSON.stringify(doc, null, 2)}\n`;
}
