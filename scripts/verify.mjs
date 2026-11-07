#!/usr/bin/env node
/**
 * 端到端验证。全部在临时沙箱内运行，不会写真实 ~/.workbuddy。
 *
 *   node scripts/verify.mjs [--keep]
 *
 * 覆盖：
 *   1. 目录 / schema 校验
 *   2. 导出确定性（连续两次字节一致，且与仓库产物一致）
 *   3. 四类可直装资产在沙箱内装卸；dry-run；prompt；toggle
 *   4. 真实根目录锁（CLI 退出码 3；HTTP 403）
 *   5. DSH 索引构建（format 1，与仓库 index.json 字节一致）
 *   6. 上传 → 审核 → 上架 → 签名链接 → 下载哈希 → 安装 → 卸载（mock 适配器）
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import {
  REPO_ROOT,
  loadCatalog,
  findAsset,
  install,
  uninstall,
  statusList,
  isRealRoot,
} from '../client/installer.mjs';

const KEEP = process.argv.includes('--keep');
const results = [];
const cleanup = [];

function record(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? '[pass]' : '[fail]'} ${name}${detail ? ` — ${detail}` : ''}`);
}

async function step(name, fn) {
  try {
    const detail = await fn();
    record(name, true, detail || '');
  } catch (error) {
    record(name, false, error.message);
  }
}

function tmpDir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  cleanup.push(dir);
  return dir;
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function runNode(args, options = {}) {
  return spawnSync(process.execPath, args, {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: { ...process.env, ...options.env },
  });
}

// ---------------------------------------------------------------------------
// 最小 zip 写入（store，无压缩），用于 E2E 上传
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function makeZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, content] of Object.entries(entries)) {
    const nameBuf = Buffer.from(name, 'utf8');
    const data = Buffer.from(content, 'utf8');
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBuf, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);

    offset += local.length + nameBuf.length + data.length;
  }
  const centralBuf = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(Object.keys(entries).length, 8);
  eocd.writeUInt16LE(Object.keys(entries).length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([...locals, centralBuf, eocd]);
}

// ---------------------------------------------------------------------------
// 服务进程
// ---------------------------------------------------------------------------

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function waitFor(url, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return response;
    } catch {
      // 服务还没起来
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`服务未在 ${timeoutMs}ms 内就绪：${url}`);
}

function startServer(port, root, stateDir) {
  const child = spawn(
    process.execPath,
    ['server/server.mjs', '--port', String(port), '--root', root, '--state-dir', stateDir],
    { cwd: REPO_ROOT, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let output = '';
  child.stdout.on('data', (chunk) => {
    output += chunk;
  });
  child.stderr.on('data', (chunk) => {
    output += chunk;
  });
  cleanup.push({ child });
  return { child, log: () => output };
}

async function jsonFetch(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }
  return { status: response.status, body, headers: response.headers };
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------

const catalog = loadCatalog();

await step('目录与 schema 校验', () => {
  const result = runNode(['scripts/validate.mjs']);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const line = result.stdout.trim().split('\n').pop();
  return line.replace('[ok] ', '');
});

await step('导出确定性（连续两次字节一致）', () => {
  const dir = tmpDir('mdl-export-');
  const a = path.join(dir, 'a.json');
  const b = path.join(dir, 'b.json');
  const env = { SOURCE_DATE_EPOCH: '1794038400', GIT_COMMIT: 'verify-fixture' };
  for (const out of [a, b]) {
    const result = runNode(['export/export.mjs', '--out', out, '--quiet'], { env });
    assert.equal(result.status, 0, result.stderr);
  }
  assert.equal(sha256(fs.readFileSync(a)), sha256(fs.readFileSync(b)));
  const doc = JSON.parse(fs.readFileSync(a, 'utf8'));
  assert.equal(doc.counts.total, 15);
  assert.equal(doc.commit, 'verify-fixture');
  assert.equal(doc.generated_at, new Date(Number(env.SOURCE_DATE_EPOCH) * 1000).toISOString());
  return `${doc.counts.total} 条，sha256=${sha256(fs.readFileSync(a)).slice(0, 12)}…`;
});

await step('仓库导出产物与当前目录一致', () => {
  const result = runNode(['export/export.mjs', '--check', '--quiet']);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return 'export/assets.json 未漂移';
});

await step('四类可直装资产沙箱装卸', () => {
  const root = tmpDir('mdl-install-');
  const ids = [
    'mdl.skill.business-ops-analysis',
    'mdl.expert.fmcg-order-advisor',
    'mdl.team.fmcg-business-review-team',
    'mdl.connector.fmcg-erp-readonly',
  ];
  const installed = [];
  for (const id of ids) {
    const asset = findAsset(id, catalog);
    const result = install(asset, root, { catalog });
    assert.equal(result.ok, true);
    assert.equal(result.mode, 'direct');
    const status = statusList([asset], root).entries[0];
    assert.equal(status.installed, true, `${id} 未显示为已安装`);
    installed.push(path.relative(root, result.installPath));
  }
  for (const id of ids) {
    const asset = findAsset(id, catalog);
    const result = uninstall(asset, root, { catalog });
    assert.equal(result.ok, true);
    const status = statusList([asset], root).entries[0];
    assert.equal(status.installed, false, `${id} 卸载后仍显示已安装`);
  }
  const skillsDir = path.join(root, 'skills');
  const leftovers = fs.existsSync(skillsDir) ? fs.readdirSync(skillsDir) : [];
  assert.equal(leftovers.length, 0, `技能目录残留：${leftovers.join(',')}`);
  return installed.join(' / ');
});

await step('dry-run 不落盘', () => {
  const root = tmpDir('mdl-dry-');
  const asset = findAsset('mdl.skill.xlsx', catalog);
  const result = install(asset, root, { catalog, dryRun: true });
  assert.equal(result.dryRun, true);
  assert.equal(result.actions.length, 2);
  assert.equal(fs.existsSync(path.join(root, 'skills', 'xlsx')), false);
  return '返回 2 个计划动作，目录未创建';
});

await step('提示词注入模式', () => {
  const root = tmpDir('mdl-prompt-');
  const asset = findAsset('mdl.template.business-dashboard', catalog);
  const result = install(asset, root, { catalog });
  assert.equal(result.mode, 'prompt');
  assert.match(result.prompt, /安装方法/);
  assert.match(result.prompt, /提示词/);
  assert.match(result.prompt, /经销商经营看板/);
  return `提示词 ${result.prompt.length} 字`;
});

await step('平台扩展开关模式', () => {
  const root = tmpDir('mdl-toggle-');
  const asset = findAsset('mdl.platform-extension.market-entry', catalog);
  install(asset, root, { catalog });
  const settings = JSON.parse(fs.readFileSync(path.join(root, 'settings.json'), 'utf8'));
  assert.equal(settings.market.entry.enabled, true);
  uninstall(asset, root, { catalog });
  const reset = JSON.parse(fs.readFileSync(path.join(root, 'settings.json'), 'utf8'));
  assert.equal(reset.market.entry.enabled, true);
  return 'settings.json market.entry.enabled 可开关';
});

await step('真实根目录锁（CLI）', () => {
  const real = path.join(os.homedir(), '.workbuddy');
  assert.equal(isRealRoot(real), true);
  const result = runNode(['client/installer.mjs', 'install', 'mdl.skill.xlsx']);
  assert.equal(result.status, 3, `期望退出码 3，实际 ${result.status}`);
  assert.match(result.stderr, /REAL_ROOT|真实/);
  return '退出码 3，未写入';
});

await step('DSH 索引构建（format 1）', () => {
  const out = path.join(tmpDir('mdl-dsh-'), 'index.json');
  const result = runNode(['scripts/build.mjs', '--out', out]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const built = fs.readFileSync(out);
  const committed = fs.readFileSync(path.join(REPO_ROOT, 'index.json'));
  assert.equal(sha256(built), sha256(committed), '构建产物与仓库 index.json 不一致');
  const doc = JSON.parse(built.toString('utf8'));
  assert.equal(doc.format, 1);
  assert.ok(Array.isArray(doc.plugins) && doc.plugins.length > 0);
  assert.ok(doc.metadata && doc.metadata.categories);
  return `format=1，${doc.plugins.length} 个插件，与仓库产物字节一致`;
});

// ---- E2E ----
const e2eRoot = tmpDir('mdl-e2e-root-');
const e2eState = tmpDir('mdl-e2e-state-');
const port = await freePort();
const server = startServer(port, e2eRoot, e2eState);
const base = `http://127.0.0.1:${port}`;
let memberToken = null;
let adminToken = null;
let uploadedId = null;
let zipBuffer = null;
let linkSha = null;

await step('服务启动与健康检查', async () => {
  await waitFor(`${base}/api/health`);
  const { body } = await jsonFetch(`${base}/api/health`);
  assert.equal(body.ok, true);
  assert.equal(body.realRoot, false);
  assert.equal(body.writeAllowed, true);
  assert.equal(body.counts.skill, 6);
  return `adapter=${body.adapter.adapter}，root 是沙箱`;
});

await step('市场目录与详情', async () => {
  const list = await jsonFetch(`${base}/api/catalog`);
  assert.equal(list.status, 200);
  assert.equal(list.body.entries.length, 15);
  const detail = await jsonFetch(`${base}/api/assets/mdl.skill.business-ops-analysis`);
  assert.equal(detail.status, 200);
  assert.equal(detail.body.asset.asset_id, 'mdl.skill.business-ops-analysis');
  assert.ok(detail.body.versions[0].digest);
  return `15 条；详情 digest=${String(detail.body.versions[0].digest).slice(0, 12)}…`;
});

await step('登录（mock 适配器）', async () => {
  const member = await jsonFetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ phone: '13900000000', password: 'demo' }),
  });
  assert.equal(member.status, 200, JSON.stringify(member.body));
  memberToken = member.body.token;
  const admin = await jsonFetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ phone: '13800000000', password: 'demo' }),
  });
  assert.equal(admin.status, 200, JSON.stringify(admin.body));
  adminToken = admin.body.token;
  assert.equal(admin.body.account.role, 'platform_admin');
  return `${member.body.account.name} / ${admin.body.account.name}`;
});

await step('上传资产包', async () => {
  zipBuffer = makeZip({
    'SKILL.md': [
      '---',
      'name: e2e-sample',
      'description: Verification sample skill for the upload pipeline.',
      'version: 1.0.0',
      '---',
      '',
      '# E2E Sample',
      '',
      'Generated by scripts/verify.mjs.',
      '',
    ].join('\n'),
    'references/note.md': 'verification fixture\n',
  });
  const response = await jsonFetch(`${base}/api/assets`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${memberToken}`,
      'content-type': 'application/zip',
      'x-file-name': 'e2e-sample.zip',
      'x-asset-slug': 'e2e-sample',
      'x-asset-title': encodeURIComponent('端到端样例'),
      'x-asset-summary': encodeURIComponent('验证上传、审核、分发与安装链路'),
      'x-asset-version': '1.0.0',
      'x-package-type': 'skill',
    },
    body: zipBuffer,
  });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  assert.equal(response.body.asset.review.state, 'pending');
  uploadedId = response.body.asset.asset_id;
  return `${uploadedId}，对象 ${response.body.asset.storage.sha256.slice(0, 12)}…`;
});

await step('审核队列与上架', async () => {
  const queue = await jsonFetch(`${base}/api/admin/assets?status=pending`, {
    headers: { authorization: `Bearer ${adminToken}` },
  });
  assert.equal(queue.status, 200);
  assert.ok(queue.body.assets.some((item) => item.asset_id === uploadedId));
  const review = await jsonFetch(`${base}/api/admin/assets/${uploadedId}/review`, {
    method: 'POST',
    headers: { authorization: `Bearer ${adminToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'approve', note: 'verify' }),
  });
  assert.equal(review.status, 200, JSON.stringify(review.body));
  assert.equal(review.body.asset.review.state, 'approved');
  return 'pending → approved';
});

await step('签名链接与下载哈希', async () => {
  const link = await jsonFetch(`${base}/api/assets/${uploadedId}/link`, {
    headers: { authorization: `Bearer ${memberToken}` },
  });
  assert.equal(link.status, 200, JSON.stringify(link.body));
  assert.ok(link.body.url.includes('sig='));
  linkSha = link.body.sha256;
  const download = await fetch(`${base}${link.body.url}`);
  assert.equal(download.status, 200);
  const buffer = Buffer.from(await download.arrayBuffer());
  assert.equal(sha256(buffer), linkSha);
  assert.equal(sha256(buffer), sha256(zipBuffer));
  assert.equal(download.headers.get('x-checksum-sha256'), linkSha);
  return `sha256=${linkSha.slice(0, 12)}… 一致`;
});

await step('安装上传资产并登记回执', async () => {
  const result = await jsonFetch(`${base}/api/install`, {
    method: 'POST',
    headers: { authorization: `Bearer ${memberToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ asset_id: uploadedId, mode: 'direct' }),
  });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.mode, 'direct');
  const skillFile = path.join(result.body.installPath, 'SKILL.md');
  assert.equal(fs.existsSync(skillFile), true);
  const receipts = await jsonFetch(`${base}/api/install-receipts`, {
    headers: { authorization: `Bearer ${memberToken}` },
  });
  assert.ok(receipts.body.receipts.some((item) => item.asset_id === uploadedId));
  return path.relative(e2eRoot, result.body.installPath);
});

await step('卸载上传资产', async () => {
  const result = await jsonFetch(`${base}/api/uninstall`, {
    method: 'POST',
    headers: { authorization: `Bearer ${memberToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ asset_id: uploadedId, mode: 'direct' }),
  });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(fs.existsSync(path.join(e2eRoot, 'skills', 'e2e-sample')), false);
  return '目录已清理';
});

await step('真实根目录锁（HTTP 403）', async () => {
  const realRoot = path.join(os.homedir(), '.workbuddy');
  const stateDir = tmpDir('mdl-lock-state-');
  const lockPort = await freePort();
  const lockServer = startServer(lockPort, realRoot, stateDir);
  try {
    await waitFor(`http://127.0.0.1:${lockPort}/api/health`);
    const response = await jsonFetch(`http://127.0.0.1:${lockPort}/api/install`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ asset_id: 'mdl.skill.xlsx', dryRun: false }),
    });
    assert.equal(response.status, 403, JSON.stringify(response.body));
    assert.equal(response.body.error.code, 'REAL_ROOT_LOCKED');
    return '403 REAL_ROOT_LOCKED';
  } finally {
    lockServer.child.kill();
  }
});

await step('仓库无旧路径 / 凭证残留', () => {
  const result = runNode(['scripts/validate.mjs', '--quiet']);
  assert.equal(result.status, 0, result.stderr);
  return 'validate 静态扫描通过';
});

// 收尾
server.child.kill();
for (const item of cleanup) {
  if (item?.child && !item.child.killed) item.child.kill();
}
if (!KEEP) {
  for (const dir of cleanup) {
    if (typeof dir === 'string') fs.rmSync(dir, { recursive: true, force: true });
  }
}

const failed = results.filter((item) => !item.ok);
console.log('');
console.log(`[verify] ${results.length - failed.length}/${results.length} 通过${failed.length ? `，${failed.length} 个失败` : ''}`);
if (failed.length) {
  for (const item of failed) console.error(`  - ${item.name}: ${item.detail}`);
  process.exit(1);
}
console.log('[verify] 全部通过');
