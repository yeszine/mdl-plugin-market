const state = {
  entries: [],
  categories: [],
  marketplace: null,
  root: null,
  realRoot: false,
  writeAllowed: true,
  viewer: null,
  tab: 'discover',
  category: '',
  q: '',
  token: localStorage.getItem('mdl_token') || '',
  detailId: null,
  detail: null,
  loading: false,
};

const CATEGORY_ICON = {
  skill: '<path d="M12 2l2.4 6.4L21 11l-6.6 2.6L12 20l-2.4-6.4L3 11l6.6-2.6L12 2z"/>',
  expert: '<path d="M12 12a4 4 0 100-8 4 4 0 000 8z"/><path d="M4 21c0-3.3 3.6-6 8-6s8 2.7 8 6" fill="none" stroke="currentColor" stroke-width="2"/>',
  team: '<circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2.4"/><path d="M3 20c0-3 2.7-5 6-5s6 2 6 5M15 20c0-2.3 1.8-4 4-4 1.2 0 2.2.4 2 1" fill="none" stroke="currentColor" stroke-width="2"/>',
  connector: '<path d="M9 3v5M15 3v5M7 8h10v4a5 5 0 01-10 0V8zM12 17v4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  template: '<rect x="3" y="4" width="18" height="16" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M3 9h18M9 9v11" fill="none" stroke="currentColor" stroke-width="2"/>',
  'platform-extension': '<rect x="3" y="7" width="18" height="10" rx="5" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="16" cy="12" r="3"/>',
};

const $ = (selector) => document.querySelector(selector);

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function categoryTop(entry) {
  return entry.category.primary.split('/')[0];
}

function categoryLabel(id) {
  for (const root of state.categories) {
    if (root.id === id) return root.name.zh;
    const child = (root.children || []).find((item) => item.id === id);
    if (child) return child.name.zh;
  }
  return id;
}

function tofuTone(entry) {
  const palette = {
    skill: ['#e8f0ff', '#2b5cff'],
    expert: ['#eaf7ef', '#0f8a4c'],
    team: ['#f2ecff', '#6b3df5'],
    connector: ['#fff2e2', '#b8560a'],
    template: ['#e8f6fb', '#0a6f8f'],
    'platform-extension': ['#fdecec', '#b42318'],
  };
  return palette[categoryTop(entry)] || ['#eef1f6', '#475467'];
}

async function api(path, { method = 'GET', body, headers = {} } = {}) {
  const finalHeaders = { ...headers };
  if (state.token) finalHeaders.Authorization = `Bearer ${state.token}`;
  let payload = body;
  if (body && !(body instanceof Uint8Array)) {
    finalHeaders['Content-Type'] = 'application/json; charset=utf-8';
    payload = JSON.stringify(body);
  }
  const response = await fetch(path, { method, headers: finalHeaders, body: payload });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) {
    const error = new Error(data?.error?.message || `请求失败（${response.status}）`);
    error.code = data?.error?.code;
    error.status = response.status;
    throw error;
  }
  return data;
}

function toast(message, kind = 'ok') {
  const node = $('#toast');
  node.textContent = message;
  node.className = `toast ${kind}`;
  node.classList.remove('hidden');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => node.classList.add('hidden'), 3200);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('已复制到剪贴板');
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    document.body.appendChild(area);
    area.select();
    document.execCommand('copy');
    area.remove();
    toast('已复制到剪贴板');
  }
}

function iconSvg(entry) {
  const path = CATEGORY_ICON[categoryTop(entry)] || CATEGORY_ICON.skill;
  return `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${path}</svg>`;
}

function coverHtml(entry, large = false) {
  if (entry.showcase?.thumbnail) {
    return `<img class="cover-img" src="/content/${encodeURI(entry.showcase.thumbnail.replace(/^catalog\/content\//, ''))}" alt="${escapeHtml(entry.name.zh)}">`;
  }
  const [bg, fg] = tofuTone(entry);
  return `<div class="cover-tofu ${large ? 'large' : ''}" style="background:${bg};color:${fg}">
    ${iconSvg(entry)}
    <span>${escapeHtml(entry.name.zh.slice(0, 1))}</span>
  </div>`;
}

function modeLabel(modes) {
  return (modes || [])
    .map((mode) => ({ direct: '直接安装', prompt: '提示词', toggle: '开关' }[mode] || mode))
    .join(' + ');
}

function installBadge(entry) {
  if (entry.install?.installed) return '<span class="pill installed">已安装</span>';
  if (entry.capabilities.install.modes.includes('toggle')) {
    const value = entry.install?.toggleValue;
    return `<span class="pill">开关 ${value === undefined ? '默认' : value ? '开' : '关'}</span>`;
  }
  if (!entry.capabilities.install.modes.includes('direct')) return '<span class="pill prompt">提示词使用</span>';
  return '<span class="pill">未安装</span>';
}

function filteredEntries() {
  let list = state.entries;
  if (state.tab === 'installed') list = list.filter((entry) => entry.install?.installed);
  if (state.category) {
    list = list.filter((entry) => entry.category.primary === state.category || entry.category.primary.startsWith(`${state.category}/`));
  }
  if (state.q) {
    const q = state.q.toLowerCase();
    list = list.filter((entry) =>
      [entry.name.zh, entry.name.en, entry.summary.zh, entry.slug, ...(entry.tags || []), ...(entry.category.labels || [])]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(q)
    );
  }
  return list;
}

function renderSidebar() {
  const counts = new Map();
  for (const entry of state.entries) {
    const top = categoryTop(entry);
    counts.set(top, (counts.get(top) || 0) + 1);
    counts.set(entry.category.primary, (counts.get(entry.category.primary) || 0) + 1);
  }
  const items = [
    `<button class="cat ${state.category === '' ? 'active' : ''}" data-category="">全部<span>${state.entries.length}</span></button>`,
    ...state.categories.map((root) => {
      const children = (root.children || [])
        .map((child) => `<button class="cat child ${state.category === child.id ? 'active' : ''}" data-category="${escapeHtml(child.id)}">${escapeHtml(child.name.zh)}<span>${counts.get(child.id) || 0}</span></button>`)
        .join('');
      return `<div class="cat-group">
        <button class="cat root ${state.category === root.id ? 'active' : ''}" data-category="${escapeHtml(root.id)}">${escapeHtml(root.name.zh)}<span>${counts.get(root.id) || 0}</span></button>
        ${children}
      </div>`;
    }),
  ];
  $('#category-tree').innerHTML = items.join('');
  $('#category-tree').querySelectorAll('[data-category]').forEach((button) => {
    button.addEventListener('click', () => {
      state.category = button.dataset.category;
      renderSidebar();
      renderGrid();
    });
  });
}

function renderGrid() {
  const list = filteredEntries();
  $('#tab-discover').classList.toggle('active', state.tab === 'discover');
  $('#tab-installed').classList.toggle('active', state.tab === 'installed');
  $('#tab-discover').setAttribute('aria-selected', state.tab === 'discover');
  $('#tab-installed').setAttribute('aria-selected', state.tab === 'installed');
  $('#result-meta').textContent = `${list.length} 条资产${state.category ? ` · ${categoryLabel(state.category)}` : ''}`;
  $('#empty').classList.toggle('hidden', list.length > 0);

  $('#grid').innerHTML = list
    .map((entry) => {
      const metrics = entry.metrics || { downloads: 0, installs: 0 };
      return `<article class="card" data-id="${escapeHtml(entry.asset_id)}">
        <div class="card-cover">${coverHtml(entry)}</div>
        <div class="card-body">
          <div class="card-top">
            <span class="chip">${escapeHtml(categoryLabel(entry.category.primary))}</span>
            ${installBadge(entry)}
          </div>
          <h3>${escapeHtml(entry.name.zh)}</h3>
          <p class="summary">${escapeHtml(entry.summary.zh)}</p>
          <div class="tags">${(entry.tags || []).slice(0, 4).map((tag) => `<span>${escapeHtml(tag)}</span>`).join('')}</div>
          <div class="card-foot">
            <span class="meta">v${escapeHtml(entry.version)} · 安装 ${metrics.installs} · 下载 ${metrics.downloads}</span>
            <div class="card-actions">
              <button class="btn ghost" type="button" data-open="${escapeHtml(entry.asset_id)}">详情</button>
              <button class="btn primary" type="button" data-install="${escapeHtml(entry.asset_id)}">${entry.install?.installed ? '重新安装' : entry.capabilities.install.modes.includes('direct') ? '安装' : '获取提示词'}</button>
            </div>
          </div>
        </div>
      </article>`;
    })
    .join('');

  $('#grid').querySelectorAll('[data-open]').forEach((button) => {
    button.addEventListener('click', () => openDetail(button.dataset.open));
  });
  $('#grid').querySelectorAll('[data-install]').forEach((button) => {
    button.addEventListener('click', () => {
      const entry = state.entries.find((item) => item.asset_id === button.dataset.install);
      if (entry) doInstall(entry);
    });
  });
}

function renderDetail(entry) {
  const detail = state.detail;
  const metrics = detail?.metrics || entry.metrics || { downloads: 0, installs: 0 };
  const version = detail?.versions?.[0] || { version: entry.version, digest: null, released_at: entry.updated_at };
  const modes = entry.capabilities.install.modes;
  const permissions = entry.permissions;
  const dependencies = entry.capabilities.install.dependencies || [];
  const same = entry.same_as;
  const showcase = entry.showcase;

  const examples = (entry.examples || [])
    .map(
      (example, index) => `<div class="example">
        <div class="example-head"><strong>${escapeHtml(example.label)}</strong><button class="btn tiny" type="button" data-copy="${index}">复制</button></div>
        <pre>${escapeHtml(example.prompt)}</pre>
      </div>`
    )
    .join('');

  const useCases = (entry.use_cases || [])
    .map((item) => `<div class="case"><h4>${escapeHtml(item.title)}</h4><p>${escapeHtml(item.summary)}</p></div>`)
    .join('');

  $('#drawer-body').innerHTML = `
    <header class="detail-head">
      <div class="detail-cover">${coverHtml(entry, true)}</div>
      <div class="detail-title">
        <div class="card-top">
          <span class="chip">${escapeHtml(categoryLabel(entry.category.primary))}</span>
          ${installBadge(entry)}
        </div>
        <h2 id="drawer-title">${escapeHtml(entry.name.zh)}</h2>
        <p class="en">${escapeHtml(entry.name.en)}</p>
        <p class="summary">${escapeHtml(entry.summary.zh)}</p>
        <div class="metrics">
          <div><span>版本</span><strong>v${escapeHtml(version.version)}</strong></div>
          <div><span>安装量</span><strong>${metrics.installs}</strong></div>
          <div><span>下载量</span><strong>${metrics.downloads}</strong></div>
          <div><span>使用方式</span><strong>${escapeHtml(modeLabel(modes))}</strong></div>
        </div>
        <div class="detail-actions">
          <button class="btn primary" type="button" data-detail-install="${escapeHtml(entry.asset_id)}">${entry.install?.installed ? '重新安装' : modes.includes('direct') ? '安装到沙箱' : '获取提示词'}</button>
          ${entry.install?.installed ? `<button class="btn danger ghost" type="button" data-detail-uninstall="${escapeHtml(entry.asset_id)}">卸载</button>` : ''}
          <button class="btn ghost" type="button" data-detail-prompt="${escapeHtml(entry.asset_id)}">查看安装说明 / 提示词</button>
        </div>
      </div>
    </header>

    <section class="detail-section">
      <h3>它能做什么</h3>
      <p class="description">${escapeHtml(entry.description.zh)}</p>
      <ul class="highlights">${(entry.highlights || []).map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
    </section>

    ${showcase ? `<section class="detail-section">
      <h3>案例成品</h3>
      <div class="showcase">
        <a class="showcase-media" href="/content/${encodeURI(showcase.artifact_url.replace(/^catalog\/content\//, ''))}" target="_blank" rel="noreferrer">
          <img src="/content/${encodeURI(showcase.thumbnail.replace(/^catalog\/content\//, ''))}" alt="${escapeHtml(entry.name.zh)} 成品预览">
          <span class="play">查看可交互成品</span>
        </a>
        <div class="showcase-info">
          <h4>这条案例需要准备</h4>
          <ul>${(showcase.data_required || []).map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
          ${same ? `<p class="muted">依赖：${(same.dependent_assets || []).map((item) => escapeHtml(item.asset_id)).join('、')}</p>
          <button class="btn primary" type="button" data-same="${escapeHtml(entry.asset_id)}">做同款</button>` : ''}
        </div>
      </div>
    </section>` : ''}

    ${examples ? `<section class="detail-section"><h3>示例提示词</h3><div class="examples">${examples}</div></section>` : ''}
    ${useCases ? `<section class="detail-section"><h3>使用案例</h3><div class="cases">${useCases}</div></section>` : ''}

    <section class="detail-section">
      <h3>安装与能力</h3>
      <table class="kv">
        <tr><th>安装模式</th><td>${escapeHtml(modes.join(' / '))}</td></tr>
        <tr><th>安装目标</th><td><code>${escapeHtml(entry.capabilities.install.target || '不落盘')}</code></td></tr>
        <tr><th>支持宿主</th><td>${escapeHtml(entry.capabilities.install.hosts.join(', '))}</td></tr>
        ${entry.capabilities.toggle.supported ? `<tr><th>开关键</th><td><code>${escapeHtml(entry.capabilities.toggle.key)}</code>（默认 ${entry.capabilities.toggle.default}）</td></tr>` : ''}
        <tr><th>依赖</th><td>${dependencies.length ? dependencies.map((dep) => `${escapeHtml(dep.asset_id)} ${escapeHtml(dep.version)}`).join('<br>') : '无'}</td></tr>
        <tr><th>权限</th><td>文件 ${escapeHtml(permissions.filesystem)} · 网络 ${permissions.network ? '是' : '否'} · Shell ${permissions.shell ? '是' : '否'} · 凭证 ${permissions.credentials ? '是' : '否'}</td></tr>
        <tr><th>数据范围</th><td>${escapeHtml((permissions.data_scope || []).join('、') || '无')}</td></tr>
        <tr><th>资产 ID</th><td><code>${escapeHtml(entry.asset_id)}</code></td></tr>
        <tr><th>内容摘要</th><td><code>${escapeHtml(version.digest || '未导出')}</code></td></tr>
        <tr><th>审核</th><td>${escapeHtml(entry.review.state)} · ${escapeHtml(entry.review.reviewer || '—')}</td></tr>
        <tr><th>许可</th><td>${escapeHtml(entry.license)}</td></tr>
      </table>
    </section>
  `;

  $('#drawer-body').querySelectorAll('[data-copy]').forEach((button) => {
    button.addEventListener('click', () => copyText(entry.examples[Number(button.dataset.copy)].prompt));
  });
  $('#drawer-body').querySelector('[data-detail-install]')?.addEventListener('click', () => doInstall(entry));
  $('#drawer-body').querySelector('[data-detail-uninstall]')?.addEventListener('click', () => doUninstall(entry));
  $('#drawer-body').querySelector('[data-detail-prompt]')?.addEventListener('click', () => showPrompt(entry));
  $('#drawer-body').querySelector('[data-same]')?.addEventListener('click', () => copySame(entry));
}

async function openDetail(assetId) {
  const entry = state.entries.find((item) => item.asset_id === assetId);
  if (!entry) return;
  state.detailId = assetId;
  state.detail = null;
  $('#drawer').classList.remove('hidden');
  document.body.classList.add('no-scroll');
  renderDetail(entry);
  try {
    state.detail = await api(`/api/assets/${encodeURIComponent(assetId)}`);
    if (state.detailId === assetId) renderDetail(entry);
  } catch {
    // 详情接口失败时保留目录里的基础信息
  }
}

function closeDrawer() {
  state.detailId = null;
  state.detail = null;
  $('#drawer').classList.add('hidden');
  document.body.classList.remove('no-scroll');
}

async function doInstall(entry, mode = null) {
  try {
    const body = { asset_id: entry.asset_id, dryRun: false };
    if (mode) body.mode = mode;
    const result = await api('/api/install', { method: 'POST', body });
    if (result.mode === 'prompt') {
      showPromptText(result.prompt, entry);
      return;
    }
    if (result.mode === 'toggle') {
      toast(`${entry.name.zh}：${result.key} = ${result.value}`);
    } else if (result.dryRun) {
      toast('演练完成，未写入磁盘');
    } else {
      toast(`${entry.name.zh} 已安装`);
    }
    await loadCatalog();
    if (state.detailId === entry.asset_id) {
      state.detail = await api(`/api/assets/${encodeURIComponent(entry.asset_id)}`).catch(() => null);
      renderDetail(state.entries.find((item) => item.asset_id === entry.asset_id) || entry);
    }
  } catch (error) {
    if (error.code === 'REAL_ROOT_LOCKED') {
      toast('真实 ~/.workbuddy 已锁定：请用沙箱根目录或显式 --allow-real', 'error');
    } else {
      toast(error.message, 'error');
    }
  }
}

async function doUninstall(entry) {
  try {
    const result = await api('/api/uninstall', { method: 'POST', body: { asset_id: entry.asset_id, dryRun: false } });
    toast(result.alreadyRemoved ? '当前未安装' : `${entry.name.zh} 已卸载`);
    await loadCatalog();
    const fresh = state.entries.find((item) => item.asset_id === entry.asset_id) || entry;
    renderDetail(fresh);
  } catch (error) {
    toast(error.message, 'error');
  }
}

function showPrompt(entry) {
  const prompt = entry.same_as?.prompt || entry.examples?.[0]?.prompt || entry.summary.zh;
  const text = [
    `【${entry.name.zh}】`,
    '',
    '安装方法：',
    entry.capabilities.install.modes.includes('direct')
      ? `在 WorkBuddy 中搜索「${entry.slug}」安装；无法安装时，把下面的提示词直接发给 AI。`
      : '这条资产以提示词方式使用，不需要安装包。',
    '',
    '提示词：',
    prompt,
  ].join('\n');
  showPromptText(text, entry);
}

function showPromptText(text, entry) {
  $('#modal-body').innerHTML = `
    <h2 id="modal-title">${escapeHtml(entry?.name?.zh || '使用提示词')}</h2>
    <p class="muted">把下面整段内容复制给 AI，即可在无法安装时按同等能力工作。</p>
    <pre class="prompt-block">${escapeHtml(text)}</pre>
    <div class="modal-actions"><button class="btn primary" type="button" id="copy-prompt">复制整段</button></div>
  `;
  $('#modal').classList.remove('hidden');
  document.body.classList.add('no-scroll');
  $('#copy-prompt').addEventListener('click', () => copyText(text));
}

function copySame(entry) {
  const text = entry.same_as?.prompt || '';
  if (!text) return;
  const missing = (entry.same_as?.dependent_assets || []).filter((dep) => {
    const target = state.entries.find((item) => item.asset_id === dep.asset_id);
    return target && !target.install?.installed;
  });
  copyText(text);
  if (missing.length) toast(`提示词已复制；建议先安装：${missing.map((dep) => dep.asset_id).join('、')}`, 'warn');
}

function showLogin() {
  if (state.viewer) {
    state.token = '';
    state.viewer = null;
    localStorage.removeItem('mdl_token');
    $('#login-btn').textContent = '登录';
    loadCatalog();
    toast('已退出登录');
    return;
  }
  $('#modal-body').innerHTML = `
    <h2 id="modal-title">登录（mock 适配层）</h2>
    <p class="muted">这里只演示账号、租户与审核链路；接入 MDL 后由 MDL 校验密码。</p>
    <form id="login-form" class="form">
      <label>手机号<input name="phone" value="13900000000" autocomplete="username"></label>
      <label>密码<input name="password" value="demo" type="password" autocomplete="current-password"></label>
      <button class="btn primary" type="submit">登录</button>
    </form>
    <div class="demo-accounts">
      <strong>演示账号（密码 demo）</strong>
      <p>13800000000 平台管理员 · 13900000000 可上传成员 · 13700000000 待审核成员</p>
    </div>
  `;
  $('#modal').classList.remove('hidden');
  document.body.classList.add('no-scroll');
  $('#login-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      const result = await api('/api/auth/login', { method: 'POST', body: { phone: form.get('phone'), password: form.get('password') } });
      state.token = result.token;
      state.viewer = result.account;
      localStorage.setItem('mdl_token', result.token);
      $('#login-btn').textContent = result.account.name;
      $('#modal').classList.add('hidden');
      document.body.classList.remove('no-scroll');
      toast(`已登录：${result.account.name}`);
      await loadCatalog();
      if (state.detailId) openDetail(state.detailId);
    } catch (error) {
      toast(error.message, 'error');
    }
  });
}

function closeModal() {
  $('#modal').classList.add('hidden');
  if ($('#drawer').classList.contains('hidden')) document.body.classList.remove('no-scroll');
}

async function loadCatalog() {
  if (state.loading) return;
  state.loading = true;
  try {
    const data = await api('/api/catalog');
    state.entries = data.entries || [];
    state.categories = data.categories || [];
    state.marketplace = data.marketplace;
    state.root = data.root;
    state.realRoot = data.realRoot;
    state.writeAllowed = data.writeAllowed;
    state.viewer = data.viewer;
    $('#lock-badge').textContent = data.realRoot ? (data.writeAllowed ? '真实根目录' : '真实根目录已锁定') : '沙箱根目录';
    $('#lock-badge').className = `badge ${data.realRoot && !data.writeAllowed ? 'locked' : ''}`;
    $('#login-btn').textContent = data.viewer?.name || (state.token ? '账号' : '登录');
    renderSidebar();
    renderGrid();
  } catch (error) {
    toast(error.message, 'error');
  } finally {
    state.loading = false;
  }
}

function bind() {
  $('#tab-discover').addEventListener('click', () => {
    state.tab = 'discover';
    renderGrid();
  });
  $('#tab-installed').addEventListener('click', () => {
    state.tab = 'installed';
    renderGrid();
  });
  let timer;
  $('#search').addEventListener('input', (event) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      state.q = event.target.value.trim();
      renderGrid();
    }, 120);
  });
  $('#login-btn').addEventListener('click', showLogin);
  document.querySelectorAll('[data-close]').forEach((node) => {
    node.addEventListener('click', () => (node.dataset.close === 'drawer' ? closeDrawer() : closeModal()));
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      if (!$('#modal').classList.contains('hidden')) closeModal();
      else if (!$('#drawer').classList.contains('hidden')) closeDrawer();
    }
  });
}

bind();
loadCatalog();
