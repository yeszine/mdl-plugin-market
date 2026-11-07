// Built-in approximation of the DeepSeek Harness plugin-market index format 1
// validator. The official package (@deepseek-ai/dsh-plugin-market-index) is the
// source of truth and runs in CI; this module keeps the repo usable without
// `npm install` (the DSH desktop install does not ship npm).
//
// It mirrors the rules that matter for curation:
//   - format: 1, title must contain `en`
//   - metadata categories/labels/sortKeys declarations
//   - plugin name is a valid npm package name and unique
//   - every version is exact SemVer, with an integer publishTimestamp and a
//     pinned npm/Git source (40-hex commit for Git)

const NUMERIC = '(?:0|[1-9]\\d*)';
const PRERELEASE_PART = `(?:${NUMERIC}|\\d*[a-zA-Z-][0-9a-zA-Z-]*)`;
const SEMVER = new RegExp(
  `^${NUMERIC}\\.${NUMERIC}\\.${NUMERIC}(?:-${PRERELEASE_PART}(?:\\.${PRERELEASE_PART})*)?(?:\\+[0-9a-zA-Z-]+(?:\\.[0-9a-zA-Z-]+)*)?$`,
  'u',
);
const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/u;
const COMMIT = /^[0-9a-f]{40}$/u;
const LANGUAGE_ID = /^[a-z]{2,8}(?:-[a-z0-9]{1,8})*$/u;
const PATH_SEGMENT = /^[A-Za-z0-9._@+-]+$/u;
const MAX_PACKAGE_NAME = 214;
const MAX_PUBLISH_TIMESTAMP = 1e11;

export class FormatError extends Error {
  constructor(path, reason) {
    super(`${path} ${reason}`);
    this.name = 'FormatError';
    this.path = path;
    this.reason = reason;
  }
}

function fail(path, reason) {
  throw new FormatError(path, reason);
}

function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function objectAt(value, path) {
  if (!isObject(value)) fail(path, 'must be an object');
  return value;
}

function stringAt(value, path) {
  if (typeof value !== 'string' || value.trim() === '') {
    fail(path, 'must be a string with a non-whitespace character');
  }
  return value;
}

function optional(object, key, path, read) {
  return Object.hasOwn(object, key) ? read(object[key], `${path}.${key}`) : undefined;
}

function localizedText(value, path) {
  if (typeof value === 'string') return stringAt(value, path);
  objectAt(value, path);
  for (const [language, text] of Object.entries(value)) {
    if (!LANGUAGE_ID.test(language)) fail(`${path}.${language}`, 'must be keyed by a lowercase language id');
    stringAt(text, `${path}.${language}`);
  }
  if (!Object.hasOwn(value, 'en')) fail(path, 'must contain en');
  return value;
}

function httpUrl(value, path, protocols) {
  const text = stringAt(value, path);
  let url;
  try {
    url = new URL(text);
  } catch {
    fail(path, 'must be an absolute URL');
  }
  if (!protocols.includes(url.protocol)) fail(path, `must use ${protocols.join(' or ')}`);
  if (url.username !== '' || url.password !== '') fail(path, 'must not contain credentials');
  if (url.href.includes('?') || url.href.includes('#')) fail(path, 'must not contain a query or fragment');
  return url.href;
}

function homepageUrl(value, path) {
  const text = stringAt(value, path);
  let url;
  try {
    url = new URL(text);
  } catch {
    fail(path, 'must be an absolute URL');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') fail(path, 'must use https: or http:');
  return url.href;
}

function packagePath(value, path) {
  const text = stringAt(value, path);
  for (const segment of text.split('/')) {
    if (segment === '.' || segment === '..' || !PATH_SEGMENT.test(segment)) {
      fail(path, 'must be a relative directory of letters, digits, and ._@+- segments without . or ..');
    }
  }
  return text;
}

function declarations(value, path) {
  objectAt(value, path);
  for (const [id, member] of Object.entries(value)) {
    if (id === '') fail(path, 'must not declare an empty id');
    objectAt(member, `${path}.${id}`);
    localizedText(member.title, `${path}.${id}.title`);
    if (path.endsWith('.sortKeys')) {
      if (member.order !== 'asc' && member.order !== 'desc') {
        fail(`${path}.${id}.order`, 'must be "asc" or "desc"');
      }
    }
  }
}

function metadataOf(index, path) {
  const metadata = index.metadata === undefined ? {} : objectAt(index.metadata, path);
  declarations(optional(metadata, 'categories', path, (v) => v) ?? {}, `${path}.categories`);
  declarations(optional(metadata, 'labels', path, (v) => v) ?? {}, `${path}.labels`);
  declarations(optional(metadata, 'sortKeys', path, (v) => v) ?? {}, `${path}.sortKeys`);
  return {
    categories: metadata.categories ?? {},
    labels: metadata.labels ?? {},
    sortKeys: metadata.sortKeys ?? {},
  };
}

export function validateMarketIndex(index, indexUrl = 'https://example.github.io/index.json') {
  try {
    // eslint-disable-next-line no-new
    new URL(indexUrl);
  } catch {
    fail('$', `index URL ${JSON.stringify(indexUrl)} must be an absolute URL`);
  }

  objectAt(index, '$');
  if (index.format !== 1) fail('$.format', 'must be 1');
  localizedText(index.title, '$.title');
  optional(index, 'description', '$', (v, p) => localizedText(v, p));
  const declarationsValue = metadataOf(index, '$.metadata');

  if (!Array.isArray(index.plugins)) fail('$.plugins', 'must be an array');

  const seenNames = new Set();
  const categoriesUsed = new Set();
  const labelsUsed = new Set();
  const versionsTotal = { npm: 0, git: 0 };

  index.plugins.forEach((plugin, position) => {
    const path = `$.plugins[${String(position)}]`;
    objectAt(plugin, path);

    const name = stringAt(plugin.name, `${path}.name`);
    if (name.length > MAX_PACKAGE_NAME || !PACKAGE_NAME.test(name)) {
      fail(`${path}.name`, 'must be a valid npm package name');
    }
    if (seenNames.has(name)) fail(`${path}.name`, `duplicates ${name}`);
    seenNames.add(name);

    optional(plugin, 'title', path, (v, p) => localizedText(v, p));
    optional(plugin, 'description', path, (v, p) => localizedText(v, p));
    optional(plugin, 'icon', path, (v, p) => stringAt(v, p));
    optional(plugin, 'author', path, (v, p) => stringAt(v, p));
    optional(plugin, 'homepage', path, (v, p) => homepageUrl(v, p));

    optional(plugin, 'repository', path, (value, repositoryPath) => {
      const repository = objectAt(value, repositoryPath);
      httpUrl(repository.url, `${repositoryPath}.url`, ['https:', 'http:']);
      optional(repository, 'directory', repositoryPath, (v, p) => packagePath(v, p));
    });

    optional(plugin, 'metadata', path, (value, metadataPath) => {
      const metadata = objectAt(value, metadataPath);
      optional(metadata, 'category', metadataPath, (category, at) => {
        if (typeof category !== 'string' || category === '') fail(at, 'must be a non-empty string');
        if (!Object.hasOwn(declarationsValue.categories, category)) {
          fail(at, `references undeclared id ${JSON.stringify(category)}`);
        }
        categoriesUsed.add(category);
      });
      optional(metadata, 'keywords', metadataPath, (keywords, at) => {
        if (!Array.isArray(keywords)) fail(at, 'must be an array');
        keywords.forEach((keyword, i) => {
          if (typeof keyword !== 'string') fail(`${at}[${String(i)}]`, 'must be a string');
        });
      });
      optional(metadata, 'labels', metadataPath, (labels, at) => {
        if (!Array.isArray(labels)) fail(at, 'must be an array');
        const seen = new Set();
        labels.forEach((label, i) => {
          if (typeof label !== 'string') fail(`${at}[${String(i)}]`, 'must be a string');
          if (!Object.hasOwn(declarationsValue.labels, label)) {
            fail(`${at}[${String(i)}]`, `references undeclared id ${JSON.stringify(label)}`);
          }
          if (seen.has(label)) fail(at, 'must not repeat a label');
          seen.add(label);
          labelsUsed.add(label);
        });
      });
      optional(metadata, 'sortKeys', metadataPath, (sortKeys, at) => {
        const values = objectAt(sortKeys, at);
        for (const [id, value] of Object.entries(values)) {
          if (!Object.hasOwn(declarationsValue.sortKeys, id)) {
            fail(`${at}.${id}`, `references undeclared id ${JSON.stringify(id)}`);
          }
          if (typeof value !== 'number' || !Number.isFinite(value)) {
            fail(`${at}.${id}`, 'must be a finite number');
          }
        }
      });
    });

    if (!Array.isArray(plugin.versions) || plugin.versions.length === 0) {
      fail(`${path}.versions`, 'must be a non-empty array');
    }
    const seenVersions = new Set();
    plugin.versions.forEach((version, i) => {
      const at = `${path}.versions[${String(i)}]`;
      objectAt(version, at);
      if (typeof version.version !== 'string' || !SEMVER.test(version.version)) {
        fail(`${at}.version`, 'must be an exact SemVer version');
      }
      if (seenVersions.has(version.version)) fail(`${at}.version`, `duplicates ${version.version}`);
      seenVersions.add(version.version);

      if (
        !Number.isInteger(version.publishTimestamp) ||
        version.publishTimestamp < 0 ||
        version.publishTimestamp >= MAX_PUBLISH_TIMESTAMP
      ) {
        fail(`${at}.publishTimestamp`, 'must be an integer number of Unix seconds in [0, 10^11)');
      }

      const source = objectAt(version.source, `${at}.source`);
      if (source.type === 'npm') {
        optional(source, 'registry', `${at}.source`, (v, p) => httpUrl(v, p, ['https:', 'http:']));
        versionsTotal.npm += 1;
      } else if (source.type === 'git') {
        stringAt(source.commit, `${at}.source.commit`);
        if (!COMMIT.test(source.commit)) fail(`${at}.source.commit`, 'must be a lowercase 40-hex-digit commit SHA');
        const url = httpUrl(source.url, `${at}.source.url`, ['https:']);
        if (url !== source.url) fail(`${at}.source.url`, 'must be a canonical URL');
        if (!/^(?:\/[^/]+){2,}$/u.test(new URL(source.url).pathname)) {
          fail(`${at}.source.url`, 'must name a repository with at least two path segments');
        }
        if (/\.(?:tgz|tar\.gz)$/iu.test(new URL(source.url).pathname)) {
          fail(`${at}.source.url`, 'must name a repository, not a tarball');
        }
        optional(source, 'path', `${at}.source`, (v, p) => packagePath(v, p));
        versionsTotal.git += 1;
      } else {
        fail(`${at}.source.type`, 'must be "npm" or "git"');
      }

      optional(version, 'engines', at, (value, enginesPath) => {
        const engines = objectAt(value, enginesPath);
        optional(engines, 'dsh', enginesPath, (range, rangePath) => {
          if (typeof range !== 'string' || range.trim() === '') fail(rangePath, 'must be a SemVer range string');
          if (range.startsWith('workspace:')) fail(rangePath, 'must not be a workspace: range');
        });
      });
    });
  });

  return {
    plugins: index.plugins.length,
    categoriesUsed: [...categoriesUsed].sort(),
    labelsUsed: [...labelsUsed].sort(),
    versionsTotal,
  };
}
