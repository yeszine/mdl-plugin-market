/**
 * 适配层契约。
 *
 * 服务端只依赖这里列出的方法；本地开发用 adapters/mock.mjs（内存 + 本地对象目录）。
 * 接入 MDL 时，用 HTTP 客户端实现同名方法即可，HTTP 层与 Web 前端不需要改。
 *
 * 术语与 MDL 对齐：
 *   account  账号（手机号唯一，密码由 MDL 侧校验）
 *   org      企业 / 租户
 *   viewer   { account_id, org_id, role }，role ∈ platform_admin | org_admin | member
 *   asset    统一资产记录（asset-record/3.0），含 visibility / review / storage
 *
 * 方法（全部 async）：
 *   health()                                          → { ok, adapter, storage }
 *   login({ phone, password })                        → { token, account }
 *   getAccount(token)                                 → account | null
 *   getOrg(orgId)                                     → org | null
 *   listAssets({ viewer, category, q })               → asset[]（按可见性过滤，仅返回已上架）
 *   getAsset({ viewer, assetId })                     → asset | null
 *   listMyAssets({ viewer })                          → asset[]
 *   listReviewQueue({ viewer, status })               → asset[]（管理员）
 *   createUpload({ viewer, fileName, buffer, meta })  → asset（review= pending）
 *   reviewAsset({ viewer, assetId, action, note })    → asset（管理员；action ∈ approve | reject）
 *   createDownloadLink({ viewer, assetId, ttlSeconds }) → { url, exp, sig, sha256, size, fileName }
 *   readDownload({ assetId, exp, sig })               → { buffer, fileName, sha256, size }
 *   recordInstall({ viewer, assetId, version, mode, host }) → receipt
 *   listInstallReceipts({ viewer })                   → receipt[]
 *   getMetrics(assetId)                               → { downloads, installs, rating }
 *   listMembers({ viewer })                           → account[]（管理员）
 *   setMemberStatus({ viewer, accountId, status })    → account（管理员）
 *   readObject(sha256)                                → Buffer | null（仅服务端内部使用）
 */

export const ADAPTER_METHODS = [
  'health',
  'login',
  'getAccount',
  'getOrg',
  'listAssets',
  'getAsset',
  'listMyAssets',
  'listReviewQueue',
  'createUpload',
  'reviewAsset',
  'createDownloadLink',
  'readDownload',
  'recordInstall',
  'listInstallReceipts',
  'getMetrics',
  'listMembers',
  'setMemberStatus',
  'readObject',
];

export function assertAdapter(adapter) {
  const missing = ADAPTER_METHODS.filter((name) => typeof adapter?.[name] !== 'function');
  if (missing.length) throw new Error(`适配器缺少方法：${missing.join(', ')}`);
  return adapter;
}
