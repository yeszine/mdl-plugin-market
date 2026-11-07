/**
 * 极简 JSON Schema 校验器。
 *
 * 只覆盖本项目 schema 用到的子集：type / required / properties / additionalProperties
 * / items / enum / const / pattern / minItems / maxItems / minLength / uniqueItems
 * / allOf / anyOf / oneOf / if-then-else / contains / $ref（仅本地 #/...）。
 *
 * 不追求完整实现，目的是在没有 npm 依赖的前提下把契约校验真跑起来。
 */

function typeOf(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function matchesType(value, expected) {
  const actual = typeOf(value);
  if (expected === 'integer') return actual === 'number' && Number.isInteger(value);
  if (expected === 'number') return actual === 'number' && Number.isFinite(value);
  return actual === expected;
}

function resolveRef(root, ref) {
  if (!ref.startsWith('#/')) throw new Error(`只支持本地 $ref：${ref}`);
  return ref
    .slice(2)
    .split('/')
    .map((part) => part.replace(/~1/g, '/').replace(/~0/g, '~'))
    .reduce((node, part) => (node == null ? undefined : node[part]), root);
}

function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function validate(value, schema, { root = schema, path = '$' } = {}) {
  const errors = [];

  if (schema.$ref) {
    const target = resolveRef(root, schema.$ref);
    if (!target) return [`${path}: 无法解析 $ref ${schema.$ref}`];
    return validate(value, target, { root, path });
  }

  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((type) => matchesType(value, type))) {
      errors.push(`${path}: 期望类型 ${types.join(' | ')}，实际 ${typeOf(value)}`);
      return errors;
    }
  }

  if ('const' in schema && !deepEqual(value, schema.const)) {
    errors.push(`${path}: 期望常量 ${JSON.stringify(schema.const)}，实际 ${JSON.stringify(value)}`);
  }

  if (schema.enum && !schema.enum.some((option) => deepEqual(value, option))) {
    errors.push(`${path}: 取值 ${JSON.stringify(value)} 不在枚举 ${JSON.stringify(schema.enum)} 内`);
  }

  if (typeof value === 'string') {
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) {
      errors.push(`${path}: 字符串不匹配 ${schema.pattern}`);
    }
    if (schema.minLength != null && value.length < schema.minLength) {
      errors.push(`${path}: 字符串长度小于 ${schema.minLength}`);
    }
  }

  if (Array.isArray(value)) {
    if (schema.minItems != null && value.length < schema.minItems) {
      errors.push(`${path}: 数组至少 ${schema.minItems} 项`);
    }
    if (schema.maxItems != null && value.length > schema.maxItems) {
      errors.push(`${path}: 数组最多 ${schema.maxItems} 项`);
    }
    if (schema.uniqueItems) {
      const seen = new Set(value.map((item) => JSON.stringify(item)));
      if (seen.size !== value.length) errors.push(`${path}: 数组存在重复项`);
    }
    if (schema.items) {
      value.forEach((item, index) => {
        errors.push(...validate(item, schema.items, { root, path: `${path}[${index}]` }));
      });
    }
    if (schema.contains) {
      const hit = value.some((item) => validate(item, schema.contains, { root, path }).length === 0);
      if (!hit) errors.push(`${path}: 数组中没有元素满足 contains`);
    }
  }

  if (value && typeOf(value) === 'object') {
    for (const key of schema.required || []) {
      if (!(key in value)) errors.push(`${path}: 缺少必需字段 ${key}`);
    }
    const props = schema.properties || {};
    for (const [key, subSchema] of Object.entries(props)) {
      if (key in value) {
        errors.push(...validate(value[key], subSchema, { root, path: `${path}.${key}` }));
      }
    }
    const extra = Object.keys(value).filter((key) => !(key in props));
    if (schema.additionalProperties === false) {
      for (const key of extra) errors.push(`${path}: 不允许的额外字段 ${key}`);
    } else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
      for (const key of extra) {
        errors.push(...validate(value[key], schema.additionalProperties, { root, path: `${path}.${key}` }));
      }
    }
  }

  for (const sub of schema.allOf || []) {
    errors.push(...validate(value, sub, { root, path }));
  }
  if (schema.anyOf) {
    const results = schema.anyOf.map((sub) => validate(value, sub, { root, path }));
    if (!results.some((result) => result.length === 0)) {
      errors.push(`${path}: 不满足 anyOf 中任何一支`);
    }
  }
  if (schema.oneOf) {
    const hits = schema.oneOf.filter((sub) => validate(value, sub, { root, path }).length === 0).length;
    if (hits !== 1) errors.push(`${path}: oneOf 命中 ${hits} 支，期望 1 支`);
  }
  if (schema.if) {
    const ok = validate(value, schema.if, { root, path }).length === 0;
    if (ok && schema.then) errors.push(...validate(value, schema.then, { root, path }));
    if (!ok && schema.else) errors.push(...validate(value, schema.else, { root, path }));
  }

  return errors;
}
