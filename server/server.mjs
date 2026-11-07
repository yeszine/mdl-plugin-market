#!/usr/bin/env node
/**
 * 本地服务：静态市场页 + JSON API。
 *
 * 账号、租户、可见性、审核、对象存储全部走 server/adapters 的适配层。
 * 本文件不保存业务状态，也不做密码校验；它只做 HTTP 编解码与根目录写入锁。
 */

import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  REPO_ROOT,
  MARKETPLACE_DIR,
  loadCatalog,
  findAsset,
  install,
  uninstall,
  statusList,
  resolveRoot,
  isRealRoot,
} from '../client/installer.mjs';
import { extractZip, findPackageRoot } from '../client/zip.mjs';
import { createMockAdapter } from './adapters/mock.mjs';
import { assertAdapter } from './adapters/contract.mjs';

const WEB_DIR = path.join(REPO_ROOT, 'web');
const CONTENT_DIR = path.join(REPO_ROOT, 'catalog', 'content');
const EXPORT_FILE = path.join(REPO_ROOT, 'export', 'assets.json');

function parseArgs(argv) {
  const args = { port: 4173, host: '127.0.0.1', root: null, allowReal: false, dryRun: false, stateDir: null, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--port') args.port = Number(argv[++i]);
    else if (token === '--host') args.host = argv[++i];
    else if (token === '--root') args.root = argv[++i];
    else if (token === '--allow-real') args.allowReal = true;
    else if (token === '--dry-run') args.dryRun = true;
    else if (token === '--state-dir') args.stateDir = argv[++i];
    else if (token === '--help' || token === '-h') args.help = true;
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));

if (args.help) {
  console.log(`用法：node server/server.mjs [选项]

  --port <n>        监听端口，默认 4173
  --host <addr>     监听地址，默认 127.0.0.1
  --root <dir>      WorkBuddy 根目录，默认 $WB_ROOT 或 ~/.workbuddy
  --allow-real      允许写入真实 ~/.workbuddy（默认只允许沙箱）
  --dry-run         所有安装/卸载强制演练
  --state-dir <dir> mock 适配层状态目录，默认 runtime/
`);
  process.exit(0);
}

const ROOT = resolveRoot(args.root);
const REAL = isRealRoot(ROOT);
const WRITE_ALLOWED = !REAL || args.allowReal;
const STATE_DIR = path.resolve(args.stateDir || process.env.WB_STATE_DIR || path.join(REPO_ROOT, 'runtime'));

const catalog = loadCatalog();
const adapter = assertAdapter(createMockAdapter({ catalog, stateDir: STATE_DIR }));

const digestByAsset = (() => {
  const map = new Map();
  if (!fs.existsSync(EXPORT_FILE)) return map;
  try {
    const doc = JSON.parse(fs.readFileSync(EXPORT_FILE, 'utf8'));
    for (const record of doc.assets || []) map.set(record.asset_id, record.digest);
  } catch {
    // 导出缺失或损坏不影响服务启动
  }
  return map;
})();

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

function sendJson(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Length': Buffer.byteLength(data),
  });
  res.end(data);
}

function sendError(res, status, code, message, extra = {}) {
  sendJson(res, status, { ok: false, error: { code, message }, ...extra });
}

function sendFile(res, file) {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return false;
  const data = fs.readFileSync(file);
  res.writeHead(200, {
    'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
    'Content-Length': data.length,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(data);
  return true;
}

function readJson(req, limit = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(Object.assign(new Error('请求体过大'), { code: 'TOO_LARGE' }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(Object.assign(new Error('请求体不是合法 JSON'), { code: 'BAD_REQUEST' }));
      }
    });
    req.on('error', reject);
  });
}

function readRaw(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(Object.assign(new Error('文件超过 100MB 上限'), { code: 'TOO_LARGE' }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function bearer(req) {
  const raw = req.headers.authorization || '';
  const match = /^Bearer\s+(.+)$/i.exec(raw);
  return match ? match[1] : null;
}

async function currentAccount(req) {
  const token = bearer(req);
  if (!token) return null;
  return adapter.getAccount(token);
}

function toViewer(account) {
  if (!account) return null;
  return { account_id: account.id, org_id: account.org_id, role: account.role, status: account.status, name: account.name };
}

async function requireAccount(req, res) {
  const account = await currentAccount(req);
  if (!account) {
    sendError(res, 401, 'UNAUTHORIZED', '请先登录');
    return null;
  }
  if (account.status === 'blocked') {
    sendError(res, 403, 'MEMBER_BLOCKED', '该成员已被停用');
    return null;
  }
  return account;
}

async function requireAdmin(req, res) {
  const account = await requireAccount(req, res);
  if (!account) return null;
  if (!['platform_admin', 'org_admin'].includes(account.role)) {
    sendError(res, 403, 'FORBIDDEN', '需要管理员权限');
    return null;
  }
  return account;
}

function headerText(req, name, fallback = '') {
  const raw = req.headers[name];
  if (!raw) return fallback;
  try {
    return decodeURIComponent(String(raw));
  } catch {
    return String(raw);
  }
}

function installStatusMap(assets) {
  return new Map(statusList(assets, ROOT).entries.map((entry) => [entry.asset_id, entry]));
}

function withInstall(asset, statusMap) {
  return { ...asset, install: statusMap.get(asset.asset_id) || { installed: false } };
}

function contentPath(relative) {
  const target = path.resolve(CONTENT_DIR, relative);
  const root = path.resolve(CONTENT_DIR);
  return target === root || target.startsWith(root + path.sep) ? target : null;
}

async function extractUploaded(asset) {
  if (!asset.storage?.sha256) throw Object.assign(new Error('上传资产缺少对象'), { code: 'NO_OBJECT' });
  const buffer = await adapter.readObject(asset.storage.sha256);
  if (!buffer) throw Object.assign(new Error('上传对象不存在'), { code: 'NOT_FOUND' });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mdl-install-'));
  try {
    extractZip(buffer, tmp);
    const sourceDir = findPackageRoot(tmp, asset.capabilities.install.entry);
    if (!sourceDir) throw Object.assign(new Error(`包结构不符合要求：缺少 ${asset.capabilities.install.entry}`), { code: 'BAD_PACKAGE' });
    return { tmp, sourceDir };
  } catch (error) {
    fs.rmSync(tmp, { recursive: true, force: true });
    throw error;
  }
}

async function resolveAssetForWrite(assetId, viewer) {
  const fromCatalog = catalog.assets.find((item) => item.asset_id === assetId || item.slug === assetId);
  if (fromCatalog) return fromCatalog;
  const uploaded = await adapter.getAsset({ viewer, assetId });
  if (uploaded) return uploaded;
  return null;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = decodeURIComponent(url.pathname);

  try {
    // ----- 静态资源 -----
    if (req.method === 'GET' && pathname === '/') {
      return sendFile(res, path.join(WEB_DIR, 'index.html'));
    }
    if (req.method === 'GET' && (pathname === '/app.js' || pathname === '/styles.css')) {
      return sendFile(res, path.join(WEB_DIR, pathname.slice(1)));
    }
    if (req.method === 'GET' && pathname.startsWith('/content/')) {
      const file = contentPath(pathname.slice('/content/'.length));
      if (file && sendFile(res, file)) return;
      return sendError(res, 404, 'NOT_FOUND', '内容不存在');
    }

    // ----- 健康检查 -----
    if (req.method === 'GET' && pathname === '/api/health') {
      return sendJson(res, 200, {
        ok: true,
        root: ROOT,
        realRoot: REAL,
        writeAllowed: WRITE_ALLOWED,
        dryRunDefault: args.dryRun,
        marketplaceDir: MARKETPLACE_DIR,
        stateDir: STATE_DIR,
        adapter: await adapter.health(),
        counts: catalog.assets.reduce((acc, asset) => {
          const key = asset.category.primary.split('/')[0];
          acc[key] = (acc[key] || 0) + 1;
          return acc;
        }, {}),
      });
    }

    // ----- 市场目录 -----
    if (req.method === 'GET' && pathname === '/api/catalog') {
      const account = await currentAccount(req);
      const viewer = toViewer(account);
      const listed = await adapter.listAssets({
        viewer,
        category: url.searchParams.get('category'),
        q: url.searchParams.get('q') || '',
      });
      const statusMap = installStatusMap(listed);
      return sendJson(res, 200, {
        ok: true,
        marketplace: catalog.marketplace,
        categories: catalog.categories,
        root: ROOT,
        realRoot: REAL,
        writeAllowed: WRITE_ALLOWED,
        viewer: viewer ? { account_id: viewer.account_id, name: viewer.name, role: viewer.role, org_id: viewer.org_id } : null,
        entries: listed.map((asset) => withInstall(asset, statusMap)),
      });
    }

    // ----- 我的上传（必须排在 /api/assets/:id 之前）-----
    if (req.method === 'GET' && pathname === '/api/assets/mine') {
      const account = await requireAccount(req, res);
      if (!account) return;
      return sendJson(res, 200, { ok: true, assets: await adapter.listMyAssets({ viewer: toViewer(account) }) });
    }

    // ----- 资产详情 -----
    if (req.method === 'GET' && /^\/api\/assets\/[^/]+$/.test(pathname)) {
      const assetId = decodeURIComponent(pathname.slice('/api/assets/'.length));
      const account = await currentAccount(req);
      const viewer = toViewer(account);
      const asset = await adapter.getAsset({ viewer, assetId });
      if (!asset) return sendError(res, 404, 'NOT_FOUND', '资产不存在');
      const statusMap = installStatusMap([asset]);
      return sendJson(res, 200, {
        ok: true,
        asset: withInstall(asset, statusMap),
        versions: [
          {
            version: asset.version,
            channel: 'stable',
            released_at: asset.updated_at,
            digest: digestByAsset.get(asset.asset_id) || null,
          },
        ],
        metrics: await adapter.getMetrics(asset.asset_id),
      });
    }

    // ----- 登录 / 当前账号 -----
    if (req.method === 'POST' && pathname === '/api/auth/login') {
      const body = await readJson(req);
      if (!body.phone || !body.password) return sendError(res, 400, 'BAD_REQUEST', '需要手机号和密码');
      const result = await adapter.login({ phone: String(body.phone), password: String(body.password) });
      if (!result) return sendError(res, 401, 'LOGIN_FAILED', '手机号或密码不正确');
      return sendJson(res, 200, { ok: true, token: result.token, account: result.account });
    }
    if (req.method === 'GET' && pathname === '/api/auth/me') {
      const account = await requireAccount(req, res);
      if (!account) return;
      const viewer = toViewer(account);
      return sendJson(res, 200, {
        ok: true,
        account,
        org: await adapter.getOrg(account.org_id),
        uploads: await adapter.listMyAssets({ viewer }),
      });
    }

    // ----- 成员审核 -----
    if (req.method === 'GET' && pathname === '/api/members') {
      const account = await requireAdmin(req, res);
      if (!account) return;
      return sendJson(res, 200, { ok: true, members: await adapter.listMembers({ viewer: toViewer(account) }) });
    }
    if (req.method === 'POST' && /^\/api\/members\/[^/]+\/status$/.test(pathname)) {
      const account = await requireAdmin(req, res);
      if (!account) return;
      const accountId = decodeURIComponent(pathname.split('/')[3]);
      const body = await readJson(req);
      const updated = await adapter.setMemberStatus({ viewer: toViewer(account), accountId, status: body.status });
      return sendJson(res, 200, { ok: true, member: updated });
    }

    // ----- 上传与资产审核 -----
    if (req.method === 'POST' && pathname === '/api/assets') {
      const account = await requireAccount(req, res);
      if (!account) return;
      const buffer = await readRaw(req, 100 * 1024 * 1024);
      if (!buffer.length) return sendError(res, 400, 'BAD_REQUEST', '请求体为空');
      const asset = await adapter.createUpload({
        viewer: toViewer(account),
        fileName: headerText(req, 'x-file-name', 'upload.zip'),
        buffer,
        meta: {
          slug: headerText(req, 'x-asset-slug'),
          title: headerText(req, 'x-asset-title'),
          summary: headerText(req, 'x-asset-summary'),
          version: headerText(req, 'x-asset-version'),
          packageType: headerText(req, 'x-package-type'),
          publisher: account.name,
        },
      });
      return sendJson(res, 201, { ok: true, asset });
    }
    if (req.method === 'GET' && pathname === '/api/admin/assets') {
      const account = await requireAdmin(req, res);
      if (!account) return;
      const status = url.searchParams.get('status') || 'pending';
      return sendJson(res, 200, { ok: true, assets: await adapter.listReviewQueue({ viewer: toViewer(account), status }) });
    }
    if (req.method === 'POST' && /^\/api\/admin\/assets\/[^/]+\/review$/.test(pathname)) {
      const account = await requireAdmin(req, res);
      if (!account) return;
      const assetId = decodeURIComponent(pathname.split('/')[4]);
      const body = await readJson(req);
      const asset = await adapter.reviewAsset({ viewer: toViewer(account), assetId, action: body.action, note: body.note || null });
      return sendJson(res, 200, { ok: true, asset });
    }

    // ----- 签名下载 -----
    if (req.method === 'GET' && /^\/api\/assets\/[^/]+\/link$/.test(pathname)) {
      const account = await currentAccount(req);
      const assetId = decodeURIComponent(pathname.split('/')[3]);
      const link = await adapter.createDownloadLink({ viewer: toViewer(account), assetId, ttlSeconds: 600 });
      return sendJson(res, 200, { ok: true, ...link });
    }
    if (req.method === 'GET' && /^\/api\/assets\/[^/]+\/download$/.test(pathname)) {
      const assetId = decodeURIComponent(pathname.split('/')[3]);
      const result = await adapter.readDownload({
        assetId,
        exp: url.searchParams.get('exp'),
        sig: url.searchParams.get('sig'),
      });
      res.writeHead(200, {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(result.fileName)}"`,
        'Content-Length': result.buffer.length,
        'X-Checksum-Sha256': result.sha256,
        'Cache-Control': 'no-store',
      });
      return res.end(result.buffer);
    }

    // ----- 安装 / 卸载 -----
    if (req.method === 'POST' && (pathname === '/api/install' || pathname === '/api/uninstall')) {
      const body = await readJson(req);
      const assetId = body.asset_id || body.assetId;
      if (!assetId) return sendError(res, 400, 'BAD_REQUEST', '缺少 asset_id');
      const dryRun = body.dryRun ?? args.dryRun;
      if (!dryRun && !WRITE_ALLOWED) {
        return sendError(res, 403, 'REAL_ROOT_LOCKED', '当前根目录是真实的 ~/.workbuddy，默认禁止写入。请改用沙箱根目录，或显式加 --allow-real。', { root: ROOT });
      }

      const account = await currentAccount(req);
      const viewer = toViewer(account);
      const asset = await resolveAssetForWrite(String(assetId), viewer);
      if (!asset) return sendError(res, 404, 'NOT_FOUND', `未知资产：${assetId}`);

      if (pathname === '/api/install') {
        let source = null;
        try {
          if (asset.storage) source = await extractUploaded(asset);
          const result = install(asset, ROOT, {
            dryRun,
            mode: body.mode || null,
            sourceDir: source?.sourceDir,
            catalog,
          });
          if (!dryRun && result.ok && ['direct', 'toggle'].includes(result.mode)) {
            await adapter.recordInstall({ viewer, assetId: asset.asset_id, version: asset.version, mode: result.mode, host: 'workbuddy' });
          }
          return sendJson(res, 200, { ...result, root: ROOT, realRoot: REAL });
        } finally {
          if (source?.tmp) fs.rmSync(source.tmp, { recursive: true, force: true });
        }
      }

      const result = uninstall(asset, ROOT, { dryRun, mode: body.mode || null });
      return sendJson(res, 200, { ...result, root: ROOT, realRoot: REAL });
    }

    if (req.method === 'GET' && pathname === '/api/install-receipts') {
      const account = await requireAccount(req, res);
      if (!account) return;
      return sendJson(res, 200, { ok: true, receipts: await adapter.listInstallReceipts({ viewer: toViewer(account) }) });
    }

    if (pathname.startsWith('/api/')) return sendError(res, 404, 'NOT_FOUND', '接口不存在');
    return sendError(res, 404, 'NOT_FOUND', '资源不存在');
  } catch (error) {
    const code = error.code || 'INTERNAL';
    const status = code === 'FORBIDDEN' ? 403 : code === 'UNAUTHORIZED' ? 401 : code === 'NOT_FOUND' ? 404 : code === 'CONFLICT' ? 409 : code === 'TOO_LARGE' ? 413 : 500;
    return sendError(res, status, code, error.message);
  }
});

server.listen(args.port, args.host, () => {
  console.log(`[server] http://${args.host}:${args.port}`);
  console.log(`[server] root=${ROOT} realRoot=${REAL} writeAllowed=${WRITE_ALLOWED}`);
  console.log(`[server] state=${STATE_DIR} adapter=mock assets=${catalog.assets.length}`);
});
