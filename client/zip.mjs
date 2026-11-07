// 零依赖 zip 解压：读取 EOCD + 中央目录，支持 store(0) / deflate(8)。
// 移植自 ai-asset-hub 的 skill/scripts/zip.js，保留路径穿越防护，并增加总解压体积上限。

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const EOCD_SIG = 0x06054b50;
const CENTRAL_SIG = 0x02014b50;
const LOCAL_SIG = 0x04034b50;
const MAX_TOTAL_BYTES = 200 * 1024 * 1024;

function findEocd(buf) {
  const min = Math.max(0, buf.length - 66000);
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) {
      return {
        count: buf.readUInt16LE(i + 10),
        size: buf.readUInt32LE(i + 12),
        offset: buf.readUInt32LE(i + 16),
      };
    }
  }
  throw new Error('不是有效的 zip：找不到中央目录');
}

function safeJoin(dest, name) {
  const target = path.resolve(dest, name);
  const root = path.resolve(dest);
  if (target !== root && !target.startsWith(root + path.sep)) {
    throw new Error(`zip 路径越界：${name}`);
  }
  return target;
}

export function extractZip(buffer, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  const eocd = findEocd(buffer);
  let offset = eocd.offset;
  let total = 0;
  const files = [];

  for (let i = 0; i < eocd.count; i++) {
    if (buffer.readUInt32LE(offset) !== CENTRAL_SIG) throw new Error('zip 中央目录损坏');
    const method = buffer.readUInt16LE(offset + 10);
    const compSize = buffer.readUInt32LE(offset + 20);
    const uncompSize = buffer.readUInt32LE(offset + 24);
    const nameLen = buffer.readUInt16LE(offset + 28);
    const extraLen = buffer.readUInt16LE(offset + 30);
    const commentLen = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLen);
    offset += 46 + nameLen + extraLen + commentLen;

    if (name.endsWith('/')) continue;
    if (compSize === 0xffffffff || uncompSize === 0xffffffff) throw new Error(`不支持 zip64：${name}`);

    if (buffer.readUInt32LE(localOffset) !== LOCAL_SIG) throw new Error(`zip 本地头损坏：${name}`);
    const localNameLen = buffer.readUInt16LE(localOffset + 26);
    const localExtraLen = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    const raw = buffer.subarray(dataStart, dataStart + compSize);
    let data;
    if (method === 0) data = raw;
    else if (method === 8) data = zlib.inflateRawSync(raw);
    else throw new Error(`不支持的 zip 压缩方式 ${method}：${name}`);

    total += data.length;
    if (total > MAX_TOTAL_BYTES) throw new Error('zip 解压后体积过大');
    const target = safeJoin(destDir, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, data);
    files.push(name);
  }
  return files;
}

export function findPackageRoot(dir, marker) {
  const direct = path.join(dir, marker);
  if (fs.existsSync(direct)) return dir;
  const entries = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory());
  if (entries.length === 1) {
    const nested = path.join(dir, entries[0].name);
    if (fs.existsSync(path.join(nested, marker))) return nested;
  }
  return null;
}
