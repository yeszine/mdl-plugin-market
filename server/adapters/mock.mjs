/**
 * 本地开发适配器：内存账号 / 租户 / 审核状态 + 本地对象目录。
 *
 * 它不是生产实现。接入 MDL 时实现同一组方法（见 contract.mjs），
 * 把账号、租户、可见性、审核、对象存储换成 MDL 的接口即可。
 *
 * 演示账号（密码默认 demo，可用 MOCK_PASSWORD 覆盖）：
 *   13800000000  平台管理员
 *   13900000000  企业成员（可上传）
 *   13700000000  企业成员（待审核，不可上传）
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

const DEMO_PASSWORD = process.env.MOCK_PASSWORD || 'demo';
const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;
const VERSION_RE = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function clone(value) {
  return structuredClone(value);
}

function normalizeCategory(category) {
  if (!category) return null;
  return category.endsWith('/') ? category.slice(0, -1) : category;
}

function matchesCategory(asset, category) {
  const target = normalizeCategory(category);
  if (!target) return true;
  const primary = asset.category.primary;
  return primary === target || primary.startsWith(`${target}/`);
}

function matchesQuery(asset, query) {
  if (!query) return true;
  const haystack = [
    asset.name?.zh,
    asset.name?.en,
    asset.summary?.zh,
    asset.summary?.en,
    asset.slug,
    ...(asset.tags || []),
    ...(asset.category?.labels || []),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return haystack.includes(query.toLowerCase());
}

export function createMockAdapter({ catalog, stateDir = path.join(process.cwd(), 'runtime'), seed = true }) {
  const objectsDir = path.join(stateDir, 'objects');
  fs.mkdirSync(objectsDir, { recursive: true });

  const secret = process.env.WB_SIGN_SECRET || crypto.randomBytes(32).toString('hex');
  const orgs = new Map();
  const accounts = new Map();
  const sessions = new Map();
  const assets = new Map();
  const metrics = new Map();
  const receipts = [];

  function addOrg(org) {
    orgs.set(org.id, org);
  }

  function addAccount(account) {
    accounts.set(account.id, account);
  }

  addOrg({ id: 'org_demo', key: 'demo-distributor', name: '示例经销商', status: 'active' });
  addAccount({ id: 'acc_admin', phone: '13800000000', name: '平台管理员', role: 'platform_admin', org_id: 'org_demo', status: 'active' });
  addAccount({ id: 'acc_member', phone: '13900000000', name: '门店运营', role: 'member', org_id: 'org_demo', status: 'active' });
  addAccount({ id: 'acc_pending', phone: '13700000000', name: '待审核成员', role: 'member', org_id: 'org_demo', status: 'pending' });

  if (seed) {
    for (const source of catalog.assets) {
      assets.set(source.asset_id, {
        ...clone(source),
        state: source.review.state === 'approved' ? 'listed' : 'draft',
        storage: null,
      });
    }
  }

  function viewerOf(account) {
    if (!account) return null;
    return { account_id: account.id, org_id: account.org_id, role: account.role, status: account.status };
  }

  function isAdmin(viewer) {
    return viewer && ['platform_admin', 'org_admin'].includes(viewer.role);
  }

  function isActive(viewer) {
    return viewer && viewer.status === 'active';
  }

  function visible(asset, viewer) {
    if (!asset || asset.state === 'archived') return false;
    if (asset.review.state !== 'approved') {
      if (!viewer) return false;
      return isAdmin(viewer) || asset.owner?.user_id === viewer.account_id;
    }
    if (asset.visibility === 'public') return true;
    if (!viewer) return false;
    if (asset.visibility === 'org') return asset.owner?.org_id === viewer.org_id;
    return asset.owner?.user_id === viewer.account_id;
  }

  function objectPath(digest) {
    if (!/^[a-f0-9]{64}$/.test(digest || '')) throw new Error('对象哈希不合规');
    return path.join(objectsDir, `${digest}.zip`);
  }

  function writeObject(buffer) {
    const digest = sha256(buffer);
    const file = objectPath(digest);
    if (!fs.existsSync(file)) {
      const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
      fs.writeFileSync(tmp, buffer);
      fs.renameSync(tmp, file);
    }
    return { digest, size: buffer.length };
  }

  function accountOf(token) {
    const accountId = sessions.get(token);
    return accountId ? accounts.get(accountId) || null : null;
  }

  function sign(assetId, exp) {
    return crypto.createHmac('sha256', secret).update(`${assetId}.${exp}`).digest('hex');
  }

  function metricOf(assetId, fallback) {
    const value = metrics.get(assetId);
    if (value) return { ...fallback, ...value };
    return { ...fallback };
  }

  const adapter = {
    name: 'mock',

    async health() {
      return {
        ok: true,
        adapter: 'mock',
        storage: { driver: 'local', objectsDir, objects: fs.readdirSync(objectsDir).length },
        accounts: accounts.size,
        orgs: orgs.size,
      };
    },

    async login({ phone, password }) {
      const account = [...accounts.values()].find((item) => item.phone === phone);
      if (!account || password !== DEMO_PASSWORD) return null;
      if (account.status === 'blocked') return null;
      const token = crypto.randomBytes(24).toString('hex');
      sessions.set(token, account.id);
      return { token, account: clone(account) };
    },

    async getAccount(token) {
      const account = accountOf(token);
      return account ? clone(account) : null;
    },

    async getOrg(orgId) {
      const org = orgs.get(orgId);
      return org ? clone(org) : null;
    },

    async listAssets({ viewer = null, category = null, q = '' } = {}) {
      return [...assets.values()]
        .filter((asset) => asset.review.state === 'approved')
        .filter((asset) => visible(asset, viewer))
        .filter((asset) => matchesCategory(asset, category))
        .filter((asset) => matchesQuery(asset, q))
        .map((asset) => ({ ...clone(asset), metrics: metricOf(asset.asset_id, asset.metrics) }));
    },

    async getAsset({ viewer = null, assetId }) {
      const asset = assets.get(assetId);
      if (!asset || !visible(asset, viewer)) return null;
      return { ...clone(asset), metrics: metricOf(asset.asset_id, asset.metrics) };
    },

    async listMyAssets({ viewer }) {
      return [...assets.values()]
        .filter((asset) => asset.owner?.user_id === viewer.account_id)
        .map((asset) => clone(asset));
    },

    async listReviewQueue({ viewer, status = 'pending' }) {
      if (!isAdmin(viewer)) throw Object.assign(new Error('需要管理员权限'), { code: 'FORBIDDEN' });
      return [...assets.values()]
        .filter((asset) => asset.review.state === status)
        .map((asset) => clone(asset));
    },

    async createUpload({ viewer, fileName, buffer, meta = {} }) {
      if (!isActive(viewer)) throw Object.assign(new Error('成员未通过审核'), { code: 'MEMBER_NOT_APPROVED' });
      const slug = String(meta.slug || '').trim();
      const version = String(meta.version || '').trim();
      const packageType = String(meta.packageType || '').trim();
      if (!SLUG_RE.test(slug)) throw Object.assign(new Error('slug 不合规'), { code: 'BAD_REQUEST' });
      if (!VERSION_RE.test(version)) throw Object.assign(new Error('version 不合规'), { code: 'BAD_REQUEST' });
      if (!['skill', 'plugin'].includes(packageType)) throw Object.assign(new Error('packageType 必须是 skill 或 plugin'), { code: 'BAD_REQUEST' });
      if ([...assets.values()].some((asset) => asset.slug === slug)) throw Object.assign(new Error('同名资产已存在'), { code: 'CONFLICT' });

      const written = writeObject(buffer);
      const now = new Date().toISOString();
      const isSkill = packageType === 'skill';
      const assetId = `mdl.upload.${slug}`;
      const record = {
        schema_version: 'asset-record/3.0',
        kind: 'asset',
        asset_id: assetId,
        slug,
        version,
        name: { zh: String(meta.title || slug), en: String(meta.title || slug) },
        summary: { zh: String(meta.summary || '用户上传资产'), en: String(meta.summary || 'User upload') },
        description: { zh: String(meta.summary || '用户上传资产'), en: String(meta.summary || 'User upload') },
        category: { primary: isSkill ? 'skill/analysis' : 'expert/order', labels: ['用户上传'] },
        tags: ['用户上传'],
        highlights: [],
        examples: [],
        owner: { org_id: viewer.org_id, user_id: viewer.account_id },
        publisher: { name: String(meta.publisher || '企业成员'), verification: 'community' },
        visibility: 'org',
        license: 'unspecified',
        pricing: { model: 'free', price: null },
        scan: { state: 'passed', checked_at: now, issues: [] },
        review: { state: 'pending', reviewer: null, reviewed_at: null, notes: null },
        capabilities: {
          install: {
            modes: ['direct', 'prompt'],
            hosts: ['workbuddy'],
            entry: isSkill ? 'SKILL.md' : '.codebuddy-plugin/plugin.json',
            target: isSkill ? 'skills/{name}' : 'plugins/cache/mdl-plugin-market/{name}/{version}',
            source: null,
            dependencies: [],
          },
          toggle: { supported: false, key: null, default: false, scope: 'user' },
          exhibit: { showcase: false, same_as: false },
          runtime: { client_side: true, server_side: false },
        },
        scopes: [],
        permissions: { filesystem: isSkill ? 'read' : 'read', network: false, shell: false, credentials: false, data_scope: [] },
        secrets_policy: { allow_hardcoded: false, source: 'none' },
        compatibility: { mdl_core: '>=0.3.0', hosts: ['workbuddy'], min_version: '1.0.0', runtime: 'node>=18' },
        metrics: { downloads: 0, installs: 0, rating: null },
        updated_at: now,
        state: 'draft',
        storage: { sha256: written.digest, size: written.size, fileName, uploaded_at: now, uploaded_by: viewer.account_id },
      };
      assets.set(assetId, record);
      return clone(record);
    },

    async reviewAsset({ viewer, assetId, action, note = null }) {
      if (!isAdmin(viewer)) throw Object.assign(new Error('需要管理员权限'), { code: 'FORBIDDEN' });
      const asset = assets.get(assetId);
      if (!asset) throw Object.assign(new Error('资产不存在'), { code: 'NOT_FOUND' });
      if (!['approve', 'reject'].includes(action)) throw Object.assign(new Error('action 必须是 approve 或 reject'), { code: 'BAD_REQUEST' });
      asset.review = {
        state: action === 'approve' ? 'approved' : 'rejected',
        reviewer: viewer.account_id,
        reviewed_at: new Date().toISOString(),
        notes: note,
      };
      asset.state = action === 'approve' ? 'listed' : 'rejected';
      return clone(asset);
    },

    async createDownloadLink({ viewer, assetId, ttlSeconds = 600 }) {
      const asset = assets.get(assetId);
      if (!asset || !visible(asset, viewer)) throw Object.assign(new Error('资产不存在或不可见'), { code: 'NOT_FOUND' });
      if (asset.review.state !== 'approved') throw Object.assign(new Error('资产尚未上架'), { code: 'ASSET_NOT_APPROVED' });
      if (!asset.storage) throw Object.assign(new Error('该资产没有可下载的对象'), { code: 'NO_OBJECT' });
      const exp = Math.floor(Date.now() / 1000) + Math.max(30, Math.min(ttlSeconds, 3600));
      const sig = sign(assetId, exp);
      return {
        url: `/api/assets/${encodeURIComponent(assetId)}/download?exp=${exp}&sig=${sig}`,
        exp,
        sig,
        sha256: asset.storage.sha256,
        size: asset.storage.size,
        fileName: asset.storage.fileName,
      };
    },

    async readDownload({ assetId, exp, sig }) {
      const asset = assets.get(assetId);
      if (!asset || asset.review.state !== 'approved') throw Object.assign(new Error('资产不存在'), { code: 'NOT_FOUND' });
      const expires = Number(exp);
      if (!Number.isFinite(expires) || expires < Math.floor(Date.now() / 1000)) throw Object.assign(new Error('链接已过期'), { code: 'LINK_EXPIRED' });
      const expected = sign(assetId, expires);
      const a = Buffer.from(String(sig || ''));
      const b = Buffer.from(expected);
      if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw Object.assign(new Error('签名无效'), { code: 'BAD_SIGNATURE' });
      if (!asset.storage) throw Object.assign(new Error('对象不存在'), { code: 'NOT_FOUND' });
      const file = objectPath(asset.storage.sha256);
      if (!fs.existsSync(file)) throw Object.assign(new Error('对象文件缺失'), { code: 'NOT_FOUND' });
      const buffer = fs.readFileSync(file);
      if (sha256(buffer) !== asset.storage.sha256) throw Object.assign(new Error('对象哈希校验失败'), { code: 'CHECKSUM_MISMATCH' });
      const current = metricOf(assetId, asset.metrics);
      current.downloads += 1;
      metrics.set(assetId, current);
      return { buffer, fileName: asset.storage.fileName, sha256: asset.storage.sha256, size: buffer.length };
    },

    async recordInstall({ viewer, assetId, version, mode, host }) {
      const asset = assets.get(assetId);
      if (!asset) throw Object.assign(new Error('资产不存在'), { code: 'NOT_FOUND' });
      const current = metricOf(assetId, asset.metrics);
      current.installs += 1;
      metrics.set(assetId, current);
      const receipt = {
        id: `rcpt_${crypto.randomBytes(8).toString('hex')}`,
        asset_id: assetId,
        version: version || asset.version,
        mode: mode || 'direct',
        host: host || 'workbuddy',
        account_id: viewer?.account_id || null,
        org_id: viewer?.org_id || null,
        created_at: new Date().toISOString(),
      };
      receipts.unshift(receipt);
      return receipt;
    },

    async listInstallReceipts({ viewer }) {
      if (!viewer) return [];
      return receipts.filter((item) => item.org_id === viewer.org_id || isAdmin(viewer));
    },

    async getMetrics(assetId) {
      const asset = assets.get(assetId);
      return metricOf(assetId, asset?.metrics || { downloads: 0, installs: 0, rating: null });
    },

    async listMembers({ viewer }) {
      if (!isAdmin(viewer)) throw Object.assign(new Error('需要管理员权限'), { code: 'FORBIDDEN' });
      return [...accounts.values()].map((account) => clone(account));
    },

    async setMemberStatus({ viewer, accountId, status }) {
      if (!isAdmin(viewer)) throw Object.assign(new Error('需要管理员权限'), { code: 'FORBIDDEN' });
      if (!['pending', 'active', 'blocked'].includes(status)) throw Object.assign(new Error('status 不合规'), { code: 'BAD_REQUEST' });
      const account = accounts.get(accountId);
      if (!account) throw Object.assign(new Error('成员不存在'), { code: 'NOT_FOUND' });
      account.status = status;
      return clone(account);
    },

    async readObject(digest) {
      const file = objectPath(digest);
      return fs.existsSync(file) ? fs.readFileSync(file) : null;
    },
  };

  return { ...adapter, _internal: { viewerOf, assets, accounts, orgs, metrics, receipts, objectsDir, secret } };
}
