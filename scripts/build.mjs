#!/usr/bin/env node
// Build index.json from data/market.json + data/plugins.json.
//
// The official validator (@deepseek-ai/dsh-plugin-market-index) runs as a final
// gate when installed; in CI it always is. Without node_modules the built-in
// approximation still catches undeclared category/label ids, bad SemVer, and
// unpinned sources.

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { validateMarketIndex } from './lib/format.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

const args = process.argv.slice(2);
const checkOnly = args.includes('--check');
const outFlag = args.indexOf('--out');
const outputPath = path.resolve(root, outFlag === -1 ? 'index.json' : args[outFlag + 1]);
const indexUrlFlag = args.indexOf('--index-url');
const indexUrl =
  indexUrlFlag === -1
    ? 'https://yeszine.github.io/mdl-plugin-market/index.json'
    : args[indexUrlFlag + 1];

async function readJson(relative) {
  const file = path.join(root, relative);
  const text = (await readFile(file, 'utf8')).replace(/^\uFEFF/u, '');
  try {
    return JSON.parse(text);
  } catch (error) {
    console.error(`[error] ${relative} 不是合法 JSON：${error.message}`);
    process.exit(1);
  }
}

let officialParse;
try {
  ({ parseMarketIndex: officialParse } = await import('@deepseek-ai/dsh-plugin-market-index'));
} catch {
  console.warn(
    '[warn] 未安装官方校验器 @deepseek-ai/dsh-plugin-market-index，使用内置近似校验。' +
      ' CI 会安装依赖并跑官方校验器。',
  );
}

const market = await readJson('data/market.json');
const plugins = await readJson('data/plugins.json');

if (!Array.isArray(plugins)) {
  console.error('[error] data/plugins.json 必须是数组');
  process.exit(1);
}

const index = {
  format: 1,
  title: market.title,
  ...(market.description === undefined ? {} : { description: market.description }),
  metadata: market.metadata ?? { categories: {}, labels: {}, sortKeys: {} },
  plugins: structuredClone(plugins),
};

let stats;
try {
  stats = validateMarketIndex(index, indexUrl);
} catch (error) {
  console.error(`[error] 索引校验失败：${error.message}`);
  if (error.path) console.error(`        位置：${error.path}`);
  process.exit(1);
}

if (officialParse) {
  try {
    officialParse(index, indexUrl);
    console.log('[ok] 官方校验器通过');
  } catch (error) {
    console.error(`[error] 官方校验器拒绝该索引：${error.message}`);
    process.exit(1);
  }
}

if (checkOnly) {
  console.log(
    `[ok] 校验通过：${stats.plugins} 个插件，npm ${stats.versionsTotal.npm} / git ${stats.versionsTotal.git}`,
  );
  process.exit(0);
}

const json = `${JSON.stringify(index, null, 2)}\n`;
await writeFile(outputPath, json, 'utf8');
const bytes = Buffer.byteLength(json);

console.log(`[ok] 已生成 ${path.relative(root, outputPath)}（${(bytes / 1024).toFixed(1)} KiB）`);
console.log(`     插件 ${stats.plugins} 个：npm ${stats.versionsTotal.npm} / git ${stats.versionsTotal.git}`);
console.log(`     分类：${stats.categoriesUsed.join(', ') || '（无）'}`);
console.log(`     标签：${stats.labelsUsed.join(', ') || '（无）'}`);

const missingEngines = index.plugins.filter((plugin) =>
  plugin.versions.every((version) => version.engines?.dsh === undefined),
);
if (missingEngines.length > 0) {
  console.warn(
    `[warn] ${missingEngines.length} 个插件没有声明 engines.dsh，` +
      'DSH 会回落到 @deepseek-ai/dsh* peer 判定，建议补上验证过的版本范围：',
  );
  for (const plugin of missingEngines) console.warn(`       - ${plugin.name}`);
}
