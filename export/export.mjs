#!/usr/bin/env node
/**
 * 确定性导出：catalog/assets.json → export/assets.json
 *
 * 不变量：
 *   - 资产按 category 顺序（skill → expert → team → connector → template → platform-extension）+ asset_id 排序
 *   - 每个资产的文件按 path 排序，逐个真算 sha256
 *   - digest = sha256(asset_id + version + 全部 path:sha256)
 *   - generated_at 优先 --generated-at，其次 SOURCE_DATE_EPOCH，再次 catalog.marketplace.updated_at
 *   - commit 优先 GIT_COMMIT，其次 git HEAD
 * 因此同一输入连跑两次，产物字节一致。
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_OUT,
  buildExport,
  serializeExport,
} from './lib.mjs';

function parseArgs(argv) {
  const args = { out: DEFAULT_OUT, generatedAt: null, check: false, quiet: false };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--out' || token === '-o') {
      args.out = path.resolve(process.cwd(), argv[++i] || '');
      if (!argv[i]) fail('--out 缺少路径');
    } else if (token === '--generated-at') {
      args.generatedAt = argv[++i];
      if (!args.generatedAt || Number.isNaN(Date.parse(args.generatedAt))) fail('--generated-at 需要合法 ISO 时间');
    } else if (token === '--check') {
      args.check = true;
    } else if (token === '--quiet') {
      args.quiet = true;
    } else if (token === '--help' || token === '-h') {
      printHelp();
      process.exit(0);
    } else {
      fail(`未知参数：${token}`);
    }
  }
  return args;
}

function printHelp() {
  console.log(`用法：node export/export.mjs [选项]

  -o, --out <file>       输出路径，默认 export/assets.json
      --generated-at <iso> 固定生成时间
      --check            只比对，不写盘；有差异时退出码 1
      --quiet            只输出错误与摘要

环境变量：
  SOURCE_DATE_EPOCH  未传 --generated-at 时作为生成时间（秒）
  GIT_COMMIT         覆盖 source.commit
`);
}

function fail(message) {
  console.error(`[export] ${message}`);
  process.exit(1);
}

const args = parseArgs(process.argv.slice(2));

let doc;
try {
  doc = buildExport({ generatedAt: args.generatedAt });
} catch (error) {
  fail(error.message);
}

const output = serializeExport(doc);

if (args.check) {
  const existing = fs.existsSync(args.out) ? fs.readFileSync(args.out, 'utf8') : '';
  if (existing !== output) {
    console.error(`[export] 产物与 ${path.relative(process.cwd(), args.out)} 不一致`);
    process.exit(1);
  }
  if (!args.quiet) console.log(`[export] 一致：${doc.counts.total} 条资产`);
  process.exit(0);
}

fs.mkdirSync(path.dirname(args.out), { recursive: true });
fs.writeFileSync(args.out, output);

if (!args.quiet) {
  const counts = Object.entries(doc.counts.by_category)
    .map(([key, value]) => `${key} ${value}`)
    .join(' / ');
  console.log(`[export] ${doc.counts.total} 条资产（${counts}）→ ${path.relative(process.cwd(), args.out)}`);
  console.log(`[export] generated_at=${doc.generated_at} commit=${doc.commit}`);
}
