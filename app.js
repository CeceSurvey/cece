'use strict';

/* ============================================================
 * 测策 · 工程测量学习与实训系统
 * 逻辑层 v3.0.3
 * 版权所有 © 2026 陈昱晨（ChaiYiChai）
 * 采用 CC BY-NC 4.0 许可证授权，详见项目根目录 LICENSE 文件
 *
 * 目录
 *   0  基础工具
 *   1  存储层（本机 localStorage）
 *   2  设置层（点位分类）
 *   3  轻提示 / 对话框
 *   4  路由
 *   5  新建工作
 *   6  工作管理（按类型筛选 / 搜索 / 排序 / 批量）
 *   7  导入导出
 *   8  工作区公共部分
 *   9  全站仪测绘：表格
 *  10  全站仪测绘：平面图
 *  11  全站仪测绘：交互（连线 / 改色 / 改类型）
 *  12  水准测量
 *  13  角度测量（测回法）
 *  14  程序设置页
 *  15  数据分析（图表 / 图片 / CSV / 智能纸图）
 *  16  关于页
 *  17  事件绑定与启动
 * ============================================================ */

const APP_VERSION = '3.0.3';
const Core = window.CeceCore;

/* ------------------------------------------------------------
 * 0. 基础工具
 * ---------------------------------------------------------- */
const $  = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/** 两位补零：日期 / 时间 / 文件名共用的唯一实现 */
const pad2 = n => String(n).padStart(2, '0');

const uid = (prefix = 'p') =>
  prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

function escHTML(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function fmtTime(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function nowHM() {
  const d = new Date();
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function defaultWorkName() {
  const d = new Date();
  return `测量工作 ${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function safeFileName(name) {
  return String(name).replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 60) || 'cece';
}

const numOrNull = v => Core.num(v);
const m3  = v => Core.fmt(v, 3);
const m3s = v => (v == null || !Number.isFinite(v)) ? '—' : (v >= 0 ? v.toFixed(3) : '-' + Math.abs(v).toFixed(3));
const mm1 = v => (v == null || !Number.isFinite(v)) ? '—' : (Math.abs(v) < 0.05 ? 0 : v).toFixed(1);

/**
 * 数字格统一三位小数：56.1 → 56.100
 * 空着就留白，非数字原样保留（用户可能还在输入「45.」这类中间态）
 */
function dec3(v) {
  const s = String(v == null ? '' : v).trim();
  if (!s) return '';
  const n = Core.num(s);
  if (n === null) return s;
  return n.toFixed(3);
}

const KINDS = {
  total: { name: '全站仪测绘', short: '全站仪' },
  level: { name: '水准测量',   short: '水准' },
  angle: { name: '角度测量',   short: '角度' }
};

/* ------------------------------------------------------------
 * 1. 存储层
 * ---------------------------------------------------------- */
const Store = {
  INDEX_KEY: 'cece:index',
  PREFIX: 'cece:project:',
  SETTING_KEY: 'cece:settings',

  list() {
    try {
      const raw = JSON.parse(localStorage.getItem(this.INDEX_KEY) || '[]');
      return Array.isArray(raw) ? raw : [];
    } catch { return []; }
  },

  _saveIndex(list) {
    try { localStorage.setItem(this.INDEX_KEY, JSON.stringify(list)); } catch {}
  },

  get(id) {
    try {
      const raw = localStorage.getItem(this.PREFIX + id);
      if (!raw) return null;
      return normalizeProject(JSON.parse(raw));
    } catch { return null; }
  },

  put(project) {
    ensureShape(project);
    project.updatedAt = new Date().toISOString();
    if (!project.createdAt) project.createdAt = project.updatedAt;

    try {
      localStorage.setItem(this.PREFIX + project.id, JSON.stringify(project));
    } catch (err) {
      toast('保存失败：本地存储空间不足');
      return false;
    }

    const list = this.list();
    const i = list.findIndex(x => x.id === project.id);
    const meta = {
      id: project.id,
      name: project.name,
      kind: project.kind,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
      count: (project.rows || []).length,
      points: project.kind === 'total'
        ? (project.rows || []).filter(r => Core.num(r.n) !== null && Core.num(r.e) !== null).length
        : 0,
      links: project.kind === 'total' ? (project.links || []).length : 0
    };
    if (i >= 0) list[i] = meta; else list.unshift(meta);
    this._saveIndex(list);
    return true;
  },

  remove(id) {
    try { localStorage.removeItem(this.PREFIX + id); } catch {}
    this._saveIndex(this.list().filter(x => x.id !== id));
  },

  rename(id, name) {
    const p = this.get(id);
    if (!p) return false;
    p.name = name;
    return this.put(p);
  },

  /* 设置 */
  loadSettings() {
    try {
      const raw = JSON.parse(localStorage.getItem(this.SETTING_KEY) || 'null');
      if (raw && Array.isArray(raw.pointTypes) && raw.pointTypes.length) return raw;
    } catch {}
    return null;
  },

  saveSettings(s) {
    try { localStorage.setItem(this.SETTING_KEY, JSON.stringify(s)); } catch {}
  },

  /** 老版本索引缺 kind，启动时补一次 */
  migrateIndex() {
    const list = this.list();
    let changed = false;
    list.forEach(m => {
      if (!m.kind) {
        const p = this.get(m.id);
        if (p) {
          m.kind = p.kind;
          m.links = p.links ? p.links.length : 0;
          changed = true;
        }
      }
    });
    if (changed) this._saveIndex(list);
  }
};

/** 保存前的最小结构校验：只补字段，不替换行对象，避免编辑中的引用失效 */
function ensureShape(p) {
  if (!p.kind || !KINDS[p.kind]) p.kind = 'total';
  if (!Array.isArray(p.rows)) p.rows = [];
  if (!Array.isArray(p.links)) p.links = [];
  if (p.kind === 'level' && (!p.meta || typeof p.meta !== 'object')) p.meta = { startH: '', endH: '' };
  return p;
}

/**
 * 把任意历史版本的数据补成 v2 结构（用于读取与导入）。
 * v1 的点行用 row.link 表示连线，v2 改为独立 links 数组（支持颜色、一个点多条线）。
 */
function normalizeProject(p) {
  if (!p || typeof p !== 'object') return p;

  if (!p.kind || !KINDS[p.kind]) p.kind = 'total';

  const rawRows = Array.isArray(p.rows) ? p.rows : [];
  const hadLinks = Array.isArray(p.links);

  if (p.kind === 'total') {
    p.rows = rawRows.map(r => ({
      id: r.id || uid('r'),
      no: r.no == null ? '' : String(r.no),
      prism: r.prism == null ? '' : String(r.prism),
      n: r.n == null ? '' : String(r.n),
      e: r.e == null ? '' : String(r.e),
      h: r.h == null ? '' : String(r.h),
      remark: r.remark == null ? '' : String(r.remark),
      typeId: r.typeId || '',
      typeManual: !!r.typeManual
    }));

    if (!hadLinks) {
      // v1 → v2：把每行的 link 转成连线对象，端点沿用原始行 id
      p.links = [];
      rawRows.forEach(r => {
        if (r && r.link) {
          p.links.push({ id: uid('l'), a: r.id, b: r.link, color: LINK_COLORS[0].value });
        }
      });
      // 去掉悬空端点
      const ids = new Set(p.rows.map(r => r.id));
      p.links = p.links.filter(l => ids.has(l.a) && ids.has(l.b));
    }
  } else if (p.kind === 'level') {
    p.rows = rawRows.map(r => ({
      id: r.id || uid('r'),
      no: r.no == null ? '' : String(r.no),
      bs: r.bs == null ? '' : String(r.bs),
      fs: r.fs == null ? '' : String(r.fs),
      dist: r.dist == null ? '' : String(r.dist),
      fsDist: r.fsDist == null ? '' : String(r.fsDist),
      bsF: r.bsF == null ? '' : String(r.bsF),
      fsB: r.fsB == null ? '' : String(r.fsB)
    }));
    if (!p.meta || typeof p.meta !== 'object') p.meta = {};
    p.meta.startH = p.meta.startH == null ? '' : String(p.meta.startH);
    p.meta.endH = p.meta.endH == null ? '' : String(p.meta.endH);
    p.meta.tol = p.meta.tol == null || p.meta.tol === '' ? defaultTol() : String(p.meta.tol);
  } else if (p.kind === 'angle') {
    let stNo = 0;
    let prev = null;
    p.rows = rawRows.map((r, i) => {
      const name = r.station == null ? '' : String(r.station);
      // 老数据没有 stNo：按「测站名变化」推断（同名相邻的测回归为一站）
      if (i === 0) { stNo = 1; }
      else if (name !== prev) { stNo += 1; }
      prev = name;
      return {
        id: r.id || uid('r'),
        no: r.no == null ? '' : String(r.no),
        station: name,
        stNo: r.stNo == null ? stNo : Math.max(1, Math.round(Number(r.stNo) || 1)),
        aL: r.aL == null ? '' : String(r.aL),
        bL: r.bL == null ? '' : String(r.bL),
        aR: r.aR == null ? '' : String(r.aR),
        bR: r.bR == null ? '' : String(r.bR)
      };
    });
  }

  if (!Array.isArray(p.links)) p.links = [];
  p.version = 2;
  return p;
}

/* ------------------------------------------------------------
 * 2. 设置层：点位分类
 * ---------------------------------------------------------- */
const DEFAULT_TYPES = [
  { id: 't_bu', name: '碎部点', color: '#14454d', keywords: ['碎部'], isDefault: true },
  { id: 't_kz', name: '控制点', color: '#1f6fd0', keywords: ['控制', '原'] },
  { id: 't_cz', name: '测站点', color: '#d97706', keywords: ['测站'] },
  { id: 't_fz', name: '辅助点', color: '#7c3aed', keywords: ['辅助', '搬站'] }
];

const SETTINGS_V = 3;
/** v1 内置类型 id：若用户从未增删过类型，迁移时直接替换为新的默认集合 */
const LEGACY_TYPE_IDS = ['t_bu', 't_kz', 't_cz', 't_hs', 't_zd'];

/** 上一版内置关键词：仅当用户没改过时才替换成新默认，避免覆盖自定义 */
const LEGACY_KEYWORDS = {
  t_bu: ['碎部'],
  t_kz: ['控制', '导线点', '已知点'],
  t_cz: ['测站'],
  t_fz: ['辅助', '后视', '定向']
};

const COLOR_PRESET = [
  '#14454d', '#1f6fd0', '#c0392b', '#e0803a', '#d4a017',
  '#2e9e5b', '#7c3aed', '#0f5f6b', '#64777c', '#c2185b'
];

const LINK_COLORS = [
  { name: '黑', value: '#1f2a2c' },
  { name: '红', value: '#c0392b' },
  { name: '橘', value: '#e0803a' },
  { name: '黄', value: '#d4a017' },
  { name: '绿', value: '#2e9e5b' },
  { name: '蓝', value: '#2f6fd0' },
  { name: '紫', value: '#7c3aed' },
  { name: '主题', value: '#0f5f6b' }
];

let settings = Store.loadSettings() || { v: SETTINGS_V, pointTypes: DEFAULT_TYPES.map(t => ({ ...t })) };

function saveSettings() {
  Store.saveSettings(settings);
}

/** 默认类型有且只有一个：没有就补第一个，多了就只留第一个 */
function ensureSingleDefault() {
  const list = settings.pointTypes;
  if (!list.length) return null;
  const i = list.findIndex(t => t.isDefault);
  const keep = i < 0 ? 0 : i;
  list.forEach((t, k) => { t.isDefault = k === keep; });
  return list[keep];
}

/** 老设置迁移：内置类型未被改动过则整体换成新默认集合，否则只补齐默认关系 */
function migrateSettings() {
  if (!settings || !Array.isArray(settings.pointTypes) || !settings.pointTypes.length) {
    settings = { v: SETTINGS_V, pointTypes: DEFAULT_TYPES.map(t => ({ ...t })) };
    saveSettings();
    return;
  }

  if (!(settings.v >= SETTINGS_V)) {
    const ids = settings.pointTypes.map(t => t.id);
    const untouched = ids.length > 0 && ids.every(id => LEGACY_TYPE_IDS.includes(id));
    if (untouched) {
      settings.pointTypes = DEFAULT_TYPES.map(t => ({ ...t }));
    } else {
      // 有自定义类型时只同步「关键词没被改过」的内置类型
      settings.pointTypes.forEach(t => {
        const def = DEFAULT_TYPES.find(d => d.id === t.id);
        const old = LEGACY_KEYWORDS[t.id];
        if (!def || !old || !Array.isArray(t.keywords)) return;
        if (t.keywords.join('|') === old.join('|')) t.keywords = def.keywords.slice();
      });
    }
    settings.v = SETTINGS_V;
  }

  ensureSingleDefault();
  saveSettings();
}

function setDefaultType(id) {
  const list = settings.pointTypes;
  if (!list.some(t => t.id === id)) return false;
  list.forEach(t => { t.isDefault = t.id === id; });
  saveSettings();
  return true;
}

function pointTypes() {
  return settings.pointTypes;
}

function typeById(id) {
  return settings.pointTypes.find(t => t.id === id) || null;
}

function defaultType() {
  return settings.pointTypes.find(t => t.isDefault) || settings.pointTypes[0] || null;
}

function defaultTypeId() {
  const t = defaultType();
  return t ? t.id : '';
}

function typeColorOf(id) {
  const t = typeById(id) || defaultType();
  return t ? t.color : '#14454d';
}

/**
 * 按备注关键词重新判定点位类型
 * 命中唯一类型 → 采用；命中多类（冲突）→ 保持不变；无命中 → 回到默认类型
 */
function applyPointType(row, force) {
  if (!row) return;
  if (row.typeManual && !force) return;
  const r = Core.matchPointType(row.remark, settings.pointTypes);
  if (r.typeId) row.typeId = r.typeId;
  else if (!r.conflict) row.typeId = defaultTypeId();
}

/**
 * 只读场景（数据分析 / 智能纸图）用的类型判定：
 * 不写入存储，但结果与工作区里看到的点号颜色一致
 */
function effectiveTypeId(row) {
  if (!row) return defaultTypeId();
  if (row.typeManual) return row.typeId || defaultTypeId();
  const r = Core.matchPointType(row.remark, settings.pointTypes);
  if (r.typeId) return r.typeId;
  if (r.conflict) return row.typeId || defaultTypeId();
  return defaultTypeId();
}

/* ------------------------------------------------------------
 * 3. 轻提示 / 对话框
 * ---------------------------------------------------------- */
let toastTimer = 0;
function toast(msg) {
  const el = $('#toast');
  if (!el) return;
  el.textContent = msg;
  el.hidden = false;
  requestAnimationFrame(() => el.classList.add('is-show'));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.classList.remove('is-show');
    setTimeout(() => { el.hidden = true; }, 220);
  }, 1900);
}

let modalCleanup = null;

/**
 * 通用对话框
 * @returns {Promise<any>} 点确定 → true；点取消/遮罩 → null；onMount 里 finish(v) → v
 */
function showModal(opt) {
  const o = opt || {};
  return new Promise(resolve => {
    if (modalCleanup) modalCleanup();

    const modal = $('#modal');
    const titleEl = $('#modalTitle');
    const bodyEl = $('#modalBody');
    const actions = $('#modalActions');
    const okBtn = $('#modalOk');

    titleEl.textContent = o.title || '';
    bodyEl.innerHTML = o.body || '';
    okBtn.textContent = o.okText || '确定';
    okBtn.className = 'btn ' + (o.danger ? 'btn-danger' : 'btn-primary');
    const cancelBtn = $('.modal-actions [data-close]', modal);
    if (cancelBtn) {
      cancelBtn.textContent = o.cancelText || '取消';
      cancelBtn.hidden = !!o.hideCancel;
    }
    actions.hidden = !!o.hideActions;
    okBtn.hidden = !!o.hideOk;
    modal.hidden = false;

    const closeBtns = $$('[data-close]', modal);

    const finish = val => {
      modal.hidden = true;
      okBtn.removeEventListener('click', onOk);
      closeBtns.forEach(b => b.removeEventListener('click', onCancel));
      document.removeEventListener('keydown', onKey);
      modalCleanup = null;
      resolve(val);
    };

    function onOk() { finish(true); }
    function onCancel() { finish(false); }
    function onKey(e) {
      if (e.key === 'Escape') onCancel();
      else if (e.key === 'Enter' && bodyEl.querySelector('input[type="text"], input:not([type])')) {
        if (document.activeElement && document.activeElement.tagName === 'INPUT') onOk();
      }
    }

    modalCleanup = () => finish(false);

    okBtn.addEventListener('click', onOk);
    closeBtns.forEach(b => b.addEventListener('click', onCancel));
    document.addEventListener('keydown', onKey);

    if (typeof o.onMount === 'function') o.onMount(bodyEl, finish);

    setTimeout(() => {
      const inp = bodyEl.querySelector('input');
      if (inp && !o.noAutoFocus) { inp.focus(); inp.select(); }
    }, 60);
  });
}

/* ------------------------------------------------------------
 * 4. 路由
 * ---------------------------------------------------------- */
let currentScreen = 'home';

const SCREENS = ['home', 'new', 'works', 'export', 'analysis', 'settings', 'about', 'project'];

function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '');
  const parts = raw.split('/').filter(Boolean);
  if (!parts.length) return { screen: 'home' };
  if (parts[0] === 'project' && parts[1]) {
    return { screen: 'project', id: decodeURIComponent(parts[1]), readonly: parts[2] === 'ro' };
  }
  if (parts[0] === 'analysis' && parts[1]) {
    return { screen: 'analysis', id: decodeURIComponent(parts[1]) };
  }
  return { screen: SCREENS.includes(parts[0]) ? parts[0] : 'home' };
}

function showScreen(name) {
  $$('.screen').forEach(s => s.classList.toggle('is-active', s.dataset.screen === name));
  const active = $('.screen.is-active');
  if (active && name !== 'project') active.scrollTop = 0;
}

function navigate(route) {
  const target = '#/' + route;
  if (location.hash === target) handleRoute();
  else location.hash = target;
}

function handleRoute() {
  if (currentScreen === 'project' && ws.project && ws.dirty) saveNow();

  const r = parseHash();

  if (r.screen === 'project') {
    openWork(r.id, r.readonly);
    currentScreen = 'project';
    return;
  }

  // 离开工作区：清掉引用，避免后台残留
  if (currentScreen === 'project') closeWork();

  if (r.screen === 'works') renderWorks();
  if (r.screen === 'export') renderExport();
  if (r.screen === 'analysis') renderAnalysis(r.id);
  if (r.screen === 'new') prepareNewForm();
  if (r.screen === 'settings') renderSettings();
  if (r.screen === 'home') renderHomeFoot();

  showScreen(r.screen);
  currentScreen = r.screen;
}

/* ------------------------------------------------------------
 * 5. 新建工作
 * ---------------------------------------------------------- */
let newKind = 'total';

function prepareNewForm() {
  const nameEl = $('#newName');
  if (nameEl && !nameEl.value.trim()) nameEl.value = defaultWorkName();
  pickKind(newKind);
}

function syncKindFields() {
  const box = $('#kindFields');
  if (!box) return;
  box.hidden = newKind !== 'level';
}

function pickKind(kind) {
  newKind = kind;
  $$('#kindPicker .kind-card').forEach(b => {
    b.setAttribute('aria-checked', b.dataset.kind === kind ? 'true' : 'false');
  });
  syncKindFields();
}

function makeTotalRow() {
  return { id: uid('r'), no: '', prism: '', n: '', e: '', h: '', remark: '', typeId: defaultTypeId(), typeManual: false };
}

function makeLevelRow(no) {
  // dist = 后视距，fsDist = 前视距；bsF / fsB 为「不常用那一侧」的读数格，只留档、不参与计算
  return { id: uid('r'), no: no || '', bs: '', fs: '', dist: '', fsDist: '', bsF: '', fsB: '' };
}

function makeAngleRow(no) {
  // stNo = 测站号：同一测站的多个测回共用；站名只是显示用
  return { id: uid('r'), no: no || '', station: '', stNo: 1, aL: '', bL: '', aR: '', bR: '' };
}

function createWork() {
  const nameEl = $('#newName');
  const name = (nameEl.value || '').trim() || defaultWorkName();

  const project = {
    id: uid('w'),
    name,
    kind: newKind,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    version: 2,
    rows: [],
    links: []
  };

  if (newKind === 'total') {
    for (let i = 0; i < 5; i++) project.rows.push(makeTotalRow());
  } else if (newKind === 'level') {
    const startH = ($('#newStartH') && $('#newStartH').value || '').trim();
    const tol = ($('#newTol') && $('#newTol').value || '').trim();
    // 默认 2 站 → 3 个点号格；点号默认留空，由用户按外业手簿填写
    // 终点高程先留空 = 闭合；填了不同的值程序会自动按附合处理
    project.meta = {
      startH,
      endH: '',
      tol: tol === '' ? defaultTol() : tol,
      ptNames: ['', '', ''],
      ptNotes: ['', '', '']
    };
    for (let i = 0; i < 2; i++) project.rows.push(makeLevelRow(''));
  } else {
    for (let i = 0; i < 1; i++) project.rows.push(makeAngleRow(String(i + 1)));
  }

  if (!Store.put(project)) return;

  if (nameEl) nameEl.value = '';
  if ($('#newStartH')) $('#newStartH').value = '';
  if ($('#newTol')) $('#newTol').value = defaultTol();

  location.hash = '#/project/' + encodeURIComponent(project.id);
}

/* ------------------------------------------------------------
 * 6. 工作管理
 * ---------------------------------------------------------- */
const worksUI = {
  q: '',
  kind: 'all',
  sort: 'updated',
  batch: false,
  sel: new Set()
};

function renderHomeFoot() {
  const el = $('.home-foot');
  if (el) el.textContent = `数据保存在本机存储 · v${APP_VERSION}`;
}

function filteredWorks() {
  const q = worksUI.q.trim().toLowerCase();
  let list = Store.list();

  if (worksUI.kind !== 'all') list = list.filter(m => (m.kind || 'total') === worksUI.kind);
  if (q) list = list.filter(m => String(m.name || '').toLowerCase().includes(q));

  const by = worksUI.sort;
  list.sort((a, b) => {
    if (by === 'name') return String(a.name || '').localeCompare(String(b.name || ''), 'zh-Hans-CN');
    if (by === 'created') return String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
    if (by === 'kind') {
      const ka = String(a.kind || 'total'), kb = String(b.kind || 'total');
      if (ka !== kb) return ka.localeCompare(kb);
      return String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''));
    }
    return String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''));
  });
  return list;
}

const ICON_FILE = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
  <path d="M6 3.5h7l5 5v12H6z"/><path d="M13 3.5v5h5"/><path d="M9 13h6M9 16.5h4"/></svg>`;

const ICON_CHECK = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 13l4 4L19 7"/></svg>`;

function renderFilterBar() {
  const bar = $('#filterBar');
  if (!bar) return;

  const all = Store.list();
  const kindCount = k => all.filter(m => (m.kind || 'total') === k).length;

  let html = `<button class="filter-chip${worksUI.kind === 'all' ? ' is-on' : ''}" data-fkind="all">全部<span class="chip-n">${all.length}</span></button>`;
  ['total', 'level', 'angle'].forEach(k => {
    html += `<button class="filter-chip${worksUI.kind === k ? ' is-on' : ''}" data-fkind="${k}">${KINDS[k].name}<span class="chip-n">${kindCount(k)}</span></button>`;
  });

  bar.innerHTML = html;
}

function metaText(meta) {
  const c = Number(meta.count || 0);
  const kind = meta.kind || 'total';
  if (kind === 'level') return `${c} 个测段`;
  if (kind === 'angle') return `${c} 个测回`;
  const p = Number(meta.points || 0);
  return `${c} 行 · ${p} 个有效点`;
}

function renderWorks() {
  renderFilterBar();

  const list = filteredWorks();
  const total = Store.list().length;
  const countEl = $('#archiveCount');
  if (countEl) {
    const filtered = list.length !== total || worksUI.q || worksUI.kind !== 'all';
    countEl.textContent = filtered ? `筛出 ${list.length} / ${total} 个工作` : `共 ${total} 个工作`;
  }

  const box = $('#archiveList');
  if (!box) return;

  // 清理已不存在的选中项
  const alive = new Set(Store.list().map(m => m.id));
  Array.from(worksUI.sel).forEach(id => { if (!alive.has(id)) worksUI.sel.delete(id); });
  syncBatchUI();

  if (!total) {
    box.innerHTML = `
      <div class="archive-empty">
        <p class="empty-title">还没有任何工作</p>
        <p class="empty-sub">新建一份工作开始测量，<br/>或从本地导入已有的工作文件。</p>
        <button class="btn btn-primary" id="emptyNew">新建工作</button>
      </div>`;
    const b = $('#emptyNew');
    if (b) b.addEventListener('click', () => navigate('new'));
    return;
  }

  if (!list.length) {
    box.innerHTML = `
      <div class="archive-empty">
        <p class="empty-title">没有匹配的工作</p>
        <p class="empty-sub">换个关键词，或把筛选条件切回「全部」。</p>
      </div>`;
    return;
  }

  const frag = document.createDocumentFragment();

  list.forEach(meta => {
    const kind = meta.kind || 'total';
    const card = document.createElement('div');
    card.className = 'archive-card' + (worksUI.batch ? ' is-batch' : '') +
      (worksUI.sel.has(meta.id) ? ' is-selected' : '');
    card.dataset.id = meta.id;

    card.innerHTML = `
      <div class="archive-main">
        ${worksUI.batch ? `<span class="pick-box" aria-hidden="true">${ICON_CHECK}</span>` : ''}
        <span class="archive-ico">${ICON_FILE}</span>
        <div class="archive-info">
          <p class="archive-name"></p>
          <p class="archive-meta">
            <span class="badge">${escHTML(KINDS[kind].short)}</span>
            <span>${escHTML(metaText(meta))}</span>
            <span>改 ${escHTML(fmtTime(meta.updatedAt))}</span>
          </p>
        </div>
      </div>
      <div class="archive-ops" ${worksUI.batch ? 'hidden' : ''}>
        <button class="op-btn is-primary" data-act="open">编辑</button>
        <button class="op-btn" data-act="readonly">只读</button>
        <button class="op-btn" data-act="rename">重命名</button>
        <button class="op-btn is-danger" data-act="delete">删除</button>
      </div>`;

    $('.archive-name', card).textContent = meta.name || '未命名工作';

    card.addEventListener('click', e => {
      if (worksUI.batch) {
        toggleSelect(meta.id);
        return;
      }
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      const act = btn.dataset.act;
      if (act === 'open') location.hash = '#/project/' + encodeURIComponent(meta.id);
      else if (act === 'readonly') location.hash = '#/project/' + encodeURIComponent(meta.id) + '/ro';
      else if (act === 'rename') renameWork(meta);
      else if (act === 'delete') deleteWork(meta);
    });

    frag.appendChild(card);
  });

  box.innerHTML = '';
  box.appendChild(frag);
}

function toggleSelect(id) {
  if (worksUI.sel.has(id)) worksUI.sel.delete(id);
  else worksUI.sel.add(id);

  const card = $(`.archive-card[data-id="${id}"]`);
  if (card) card.classList.toggle('is-selected', worksUI.sel.has(id));
  syncBatchUI();
}

function syncBatchUI() {
  const bar = $('#batchBar');
  const info = $('#batchInfo');
  const allBtn = $('#selectAllBtn');
  if (bar) bar.hidden = !worksUI.batch;
  if (info) info.textContent = `已选 ${worksUI.sel.size} 项`;
  if (allBtn) {
    allBtn.hidden = !worksUI.batch;
    const list = filteredWorks();
    const allSel = list.length > 0 && list.every(m => worksUI.sel.has(m.id));
    allBtn.textContent = allSel ? '取消全选' : '全选';
  }
}

function exitBatch() {
  worksUI.batch = false;
  worksUI.sel.clear();
  renderWorks();
}

async function renameWork(meta) {
  const ok = await showModal({
    title: '重命名工作',
    body: `<input class="text-input" id="renameInput" type="text" maxlength="40" autocomplete="off"
             value="${escHTML(meta.name || '')}" />`,
    okText: '保存'
  });
  if (!ok) return;

  const inp = $('#renameInput');
  const val = (inp ? inp.value : '').trim();
  if (!val) { toast('名称不能为空'); return; }
  if (val === meta.name) return;

  Store.rename(meta.id, val);
  if (ws.project && ws.project.id === meta.id) {
    const nameEl = $('#wsName');
    if (nameEl) nameEl.textContent = val;
  }
  renderWorks();
  toast('已重命名');
}

async function deleteWork(meta) {
  const ok = await showModal({
    title: '删除工作',
    body: `确定删除「<b>${escHTML(meta.name || '未命名工作')}</b>」吗？<br/>删除后无法恢复，建议先导出备份。`,
    okText: '删除',
    danger: true
  });
  if (!ok) return;

  Store.remove(meta.id);
  if (ws.project && ws.project.id === meta.id) {
    ws.project = null;
    ws.readonly = true;
  }
  renderWorks();
  toast('已删除');
}

async function batchDelete() {
  const ids = Array.from(worksUI.sel);
  if (!ids.length) { toast('请先选择工作'); return; }

  const ok = await showModal({
    title: '批量删除',
    body: `确定删除选中的 <b>${ids.length}</b> 个工作吗？<br/>删除后无法恢复，建议先导出备份。`,
    okText: '删除',
    danger: true
  });
  if (!ok) return;

  ids.forEach(id => Store.remove(id));
  worksUI.sel.clear();
  renderWorks();
  toast(`已删除 ${ids.length} 个工作`);
}

/* ------------------------------------------------------------
 * 7. 导入导出
 * ---------------------------------------------------------- */
function downloadJSON(payload, fileName) {
  // 原生壳：<a download> 在 WebView 中无效，交给原生写入「下载/测策」
  if (window.CeceAndroid && window.CeceAndroid.saveArchive) {
    try {
      const msg = window.CeceAndroid.saveArchive(fileName, JSON.stringify(payload, null, 2));
      toast(msg || '已导出');
    } catch (e) {
      toast('导出失败：' + (e.message || '原生保存异常'));
    }
    return;
  }

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
  toast('已导出到下载目录');
}

function exportProject(project) {
  if (!project) return;
  const payload = {
    app: 'cece',
    format: 'cece-work',
    version: 2,
    exportedAt: new Date().toISOString(),
    project
  };
  downloadJSON(payload, safeFileName(project.name) + '.cece.json');
}

function exportBundle(ids) {
  const items = ids.map(id => Store.get(id)).filter(Boolean);
  if (!items.length) { toast('没有可导出的工作'); return; }
  const payload = {
    app: 'cece',
    format: 'cece-bundle',
    version: 2,
    exportedAt: new Date().toISOString(),
    items
  };
  const stamp = new Date();
  const name = `测策备份-${stamp.getFullYear()}${pad2(stamp.getMonth() + 1)}${pad2(stamp.getDate())}-${pad2(stamp.getHours())}${pad2(stamp.getMinutes())}`;
  downloadJSON(payload, safeFileName(name) + '.cece.json');
}

/** 导入：单个工作，或一次导入多个（备份包） */
async function importFile(file) {
  try {
    const text = await file.text();
    const obj = JSON.parse(text);
    const items = Array.isArray(obj && obj.items) ? obj.items
      : (obj && obj.project ? [obj.project] : [obj]);

    let count = 0;
    for (const raw of items) {
      if (!raw || !Array.isArray(raw.rows)) continue;

      const project = normalizeProject(JSON.parse(JSON.stringify(raw)));
      project.id = uid('w');
      project.name = String(project.name || file.name.replace(/\.cece\.json$|\.json$/i, '') || '导入的工作').slice(0, 40);
      project.createdAt = raw.createdAt || new Date().toISOString();
      project.updatedAt = new Date().toISOString();

      // 行 id 重建，连线按新 id 重新映射
      const idMap = new Map();
      project.rows.forEach(r => { const old = r.id; r.id = uid('r'); idMap.set(old, r.id); });
      project.links = (project.links || []).map(l => ({
        id: l.id || uid('l'),
        a: idMap.get(l.a) || '',
        b: idMap.get(l.b) || '',
        color: l.color || LINK_COLORS[0].value
      })).filter(l => l.a && l.b);

      if (project.kind === 'total' && !project.rows.length) project.rows.push(makeTotalRow());
      Store.put(project);
      count++;
    }

    if (!count) throw new Error('不是有效的测策工作文件');

    renderWorks();
    toast(count > 1 ? `已导入 ${count} 个工作` : '已导入：' + items[0].name);
  } catch (err) {
    toast('导入失败：' + (err.message || '文件格式不正确'));
  }
}

/* ------------------------------------------------------------
 * 8. 工作区公共
 * ---------------------------------------------------------- */
const ws = {
  project: null,
  readonly: false,
  kind: '',
  dirty: false,
  saveTimer: 0,
  drawRaf: 0,
  dataRaf: 0,
  statsRaf: 0,
  building: false,
  pointsCache: null,
  view: { s: 0, fitS: 0, cx: 0, cy: 0, ready: false, manual: false }
};

function markDirty() {
  if (ws.readonly || ws.building) return;
  ws.dirty = true;
  const st = $('#wsStatus');
  if (st) { st.textContent = '未保存…'; st.classList.add('is-dirty'); }
  const btn = $('#wsSave');
  if (btn) btn.classList.add('is-dirty');
  clearTimeout(ws.saveTimer);
  ws.saveTimer = setTimeout(saveNow, 700);
}

function saveNow(opts) {
  const force = !!(opts && opts.force);
  if (!ws.project || ws.readonly) return false;
  clearTimeout(ws.saveTimer);
  ws.saveTimer = 0;
  if (!ws.dirty && !force) return true;

  if (Store.put(ws.project)) {
    ws.dirty = false;
    const st = $('#wsStatus');
    if (st) { st.textContent = '已保存'; st.classList.remove('is-dirty'); }
    const btn = $('#wsSave');
    if (btn) btn.classList.remove('is-dirty');
    return true;
  }
  return false;
}

function manualSave() {
  if (!ws.project) return;
  if (ws.readonly) { toast('只读模式下无法保存'); return; }
  if (!saveNow({ force: true })) return;
  toast(`已保存 · ${nowHM()}`);
}

function openWork(id, readonly) {
  const p = Store.get(id);
  if (!p) {
    toast('工作不存在或已被删除');
    location.hash = '#/works';
    return;
  }

  ws.building = true;
  ws.project = p;
  ws.readonly = !!readonly;
  ws.kind = p.kind;
  ws.dirty = false;
  ws.pointsCache = null;
  ws.view = { s: 0, fitS: 0, cx: 0, cy: 0, ready: false, manual: false };

  const nameEl = $('#wsName');
  if (nameEl) nameEl.textContent = p.name || '未命名工作';
  const st = $('#wsStatus');
  if (st) {
    st.textContent = ws.readonly ? '只读模式' : '已保存';
    st.classList.remove('is-dirty');
  }
  const btn = $('#wsSave');
  if (btn) {
    btn.hidden = ws.readonly;
    btn.classList.remove('is-dirty');
  }
  const screenEl = $('.screen-workspace');
  if (screenEl) screenEl.dataset.readonly = ws.readonly ? '1' : '0';

  if (ws.kind === 'total') buildTotal();
  else if (ws.kind === 'level') buildLevel();
  else buildAngle();

  ws.building = false;
  showScreen('project');
}

function closeWork() {
  ws.building = true;
  clearTimeout(ws.saveTimer);
  cancelAnimationFrame(ws.drawRaf);
  cancelAnimationFrame(ws.dataRaf);
  cancelAnimationFrame(ws.statsRaf);
  ws.saveTimer = 0;
  ws.drawRaf = 0;
  ws.dataRaf = 0;
  ws.statsRaf = 0;
  ws.project = null;
  ws.pointsCache = null;
  chart.reset();
  const host = $('#wsBody');
  if (host) host.innerHTML = '';
  ws.building = false;
}

/* ------------------------------------------------------------
 * 9. 全站仪测绘：表格
 * ---------------------------------------------------------- */
const FIELDS = [
  { key: 'no',     kind: 'text' },
  { key: 'prism',  kind: 'decimal' },
  { key: 'n',      kind: 'decimal' },
  { key: 'e',      kind: 'decimal' },
  { key: 'h',      kind: 'decimal' },
  { key: 'remark', kind: 'text' }
];

const totalUI = {
  rowEls: []
};

function totalHTML() {
  return `
  <div class="workspace">
    <section class="panel panel-input">
      <div class="panel-head">
        <h3 class="panel-title">点位数据</h3>
        <span class="panel-meta" id="rowCount">0 行</span>
      </div>

      <div class="table-scroll">
        <div class="grid-table">
          <div class="grid-head" role="row">
            <div class="cell c-order">排序</div>
            <div class="cell c-no">点号</div>
            <div class="cell c-prism">棱镜高</div>
            <div class="cell c-n">N(X)</div>
            <div class="cell c-e">E(Y)</div>
            <div class="cell c-h">H(Z)</div>
            <div class="cell c-remark">备注</div>
          </div>
          <div class="grid-body" id="rowList"></div>
          <button class="add-row" id="addRow">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 6v12M6 12h12"/></svg>
            增加一行
          </button>
        </div>
      </div>

      <div class="grid-stats" id="gridStats"></div>
    </section>

    <section class="panel panel-chart">
      <div class="panel-head">
        <h3 class="panel-title">平面图</h3>
        <div class="chart-tools">
          <button class="tool-btn tool-btn-wide" id="editPointBtn" title="点选一个点，再次点击可改它的类型">编辑点</button>
          <button class="tool-btn tool-btn-wide" id="linkModeBtn" title="依次点选多个点后连线；点线可选中改色或删除">连线</button>
          <button class="tool-btn" id="zoomOut" aria-label="缩小">−</button>
          <button class="tool-btn" id="zoomIn" aria-label="放大">＋</button>
          <button class="tool-btn tool-btn-wide" id="fitBtn">自适应</button>
        </div>
      </div>

      <div class="chart-wrap" id="chartWrap">
        <svg id="chart" xmlns="http://www.w3.org/2000/svg"></svg>
        <div class="chart-empty" id="chartEmpty">
          <div class="empty-ico" aria-hidden="true">
            <svg viewBox="0 0 64 64" fill="none">
              <path d="M16 12v38h38" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" opacity=".55"/>
              <circle cx="40" cy="27" r="4" fill="currentColor" opacity=".55"/>
            </svg>
          </div>
          <p class="empty-title">等待坐标数据</p>
          <p class="empty-sub">在表格中填入 N 坐标与 E 坐标后<br/>此处将实时绘制点位平面图</p>
        </div>
        <div class="chart-badge" id="chartBadge">N↑ / E→ 单位：m</div>
        <div class="chart-fab" id="chartFab" hidden>
          <span class="fab-text" id="fabText"></span>
          <button class="fab-btn" id="fabCancel" aria-label="取消">✕</button>
          <button class="fab-btn is-ok" id="fabOk" aria-label="确认连线" disabled>✓</button>
        </div>
      </div>
    </section>
  </div>`;
}

function buildTotal() {
  const host = $('#wsBody');
  host.innerHTML = totalHTML();

  totalUI.rowEls = [];
  chart.reset();

  // 历史数据/导入数据：按备注把类型补算一遍，保证点号颜色正确
  ws.project.rows.forEach(r => { if (!r.typeManual) applyPointType(r, true); });

  renderTotalRows();
  bindTotalEvents();

  requestAnimationFrame(() => {
    chart.init();
    drawChart({ fit: true });
  });
}

function renderTotalRows() {
  const box = $('#rowList');
  if (!box) return;

  const frag = document.createDocumentFragment();
  totalUI.rowEls = [];

  ws.project.rows.forEach(row => {
    const el = buildRow(row);
    totalUI.rowEls.push(el);
    frag.appendChild(el);
  });

  box.innerHTML = '';
  box.appendChild(frag);

  const rc = $('#rowCount');
  if (rc) rc.textContent = `${ws.project.rows.length} 行 · 单位 m`;
  invalidatePoints();
}

function buildRow(row) {
  const el = document.createElement('div');
  el.className = 'row';
  el.dataset.id = row.id;

  /* 排序把手 */
  const orderCell = document.createElement('div');
  orderCell.className = 'cell c-order';

  const grip = document.createElement('button');
  grip.type = 'button';
  grip.className = 'grip';
  grip.setAttribute('aria-label', '拖动调整行顺序');
  grip.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="9" cy="6" r="1.55"/><circle cx="15" cy="6" r="1.55"/>
      <circle cx="9" cy="12" r="1.55"/><circle cx="15" cy="12" r="1.55"/>
      <circle cx="9" cy="18" r="1.55"/><circle cx="15" cy="18" r="1.55"/>
    </svg>`;

  if (!ws.readonly) grip.addEventListener('pointerdown', ev => beginDrag(ev, el));

  orderCell.appendChild(grip);
  el.appendChild(orderCell);

  FIELDS.forEach(f => {
    const cell = document.createElement('div');
    cell.className = 'cell c-' + f.key;

    const input = document.createElement('input');
    input.type = 'text';
    input.inputMode = f.kind === 'decimal' ? 'decimal' : 'text';
    const isDec = f.kind === 'decimal';
    // 数字格一律三位小数显示：56.1 → 56.100（空行保持留白）
    input.value = row[f.key] == null ? '' : (isDec ? dec3(row[f.key]) : row[f.key]);
    input.disabled = ws.readonly;
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.dataset.key = f.key;

    if (f.key === 'no') {
      paintNoColor(input, row);
      bindNoInput(input, row, el);
    }

    input.addEventListener('input', () => {
      row[f.key] = input.value;

      if (f.key === 'remark') {
        applyPointType(row);
        const noInput = el.querySelector('.c-no input');
        if (noInput) paintNoColor(noInput, row);
      }
      if (f.key === 'no') paintNoColor(input, row);

      markDirty();
      invalidatePoints();
      scheduleDraw();
      scheduleStats();
    });

    if (isDec) {
      input.addEventListener('blur', () => {
        const v = dec3(input.value);
        if (v === input.value) return;
        input.value = v;
        row[f.key] = v;
        markDirty();
        invalidatePoints();
        scheduleDraw();
        scheduleStats();
      });
    }

    cell.appendChild(input);
    el.appendChild(cell);
  });

  return el;
}

function paintNoColor(input, row) {
  const color = typeColorOf(row.typeId);
  input.style.color = color;
}

/** 点号：获得焦点时用浅灰显示预测值，离焦未填则落为实际点号 */
function bindNoInput(input, row, el) {
  if (ws.readonly) return;

  input.addEventListener('focus', () => {
    if (input.value.trim()) return;
    const idx = totalUI.rowEls.indexOf(el);
    const p = Core.predictNo(ws.project.rows, idx < 0 ? 0 : idx);
    if (!p) return;
    input.dataset.predict = p;
    input.placeholder = p;
    input.classList.add('is-predict');
  });

  const commit = () => {
    if (ws.building || !ws.project || ws.project.rows.indexOf(row) < 0) return;
    const p = input.dataset.predict;
    delete input.dataset.predict;
    input.classList.remove('is-predict');
    input.placeholder = '';
    if (!p) return;
    if (input.value.trim()) return;

    row.no = p;
    input.value = p;
    paintNoColor(input, row);
    markDirty();
    invalidatePoints();
    scheduleDraw();
  };

  input.addEventListener('blur', commit);
  input.addEventListener('input', () => {
    delete input.dataset.predict;
    input.classList.remove('is-predict');
    input.placeholder = '';
  });
}

function bindTotalEvents() {
  const addBtn = $('#addRow');
  if (addBtn) {
    addBtn.addEventListener('click', () => {
      if (ws.readonly || !ws.project) return;
      const row = makeTotalRow();
      ws.project.rows.push(row);

      const el = buildRow(row);
      totalUI.rowEls.push(el);
      $('#rowList').appendChild(el);

      const rc = $('#rowCount');
      if (rc) rc.textContent = `${ws.project.rows.length} 行 · 单位 m`;

      markDirty();
      invalidatePoints();
      scheduleDraw();
      scheduleStats();

      const scroller = $('.table-scroll');
      if (scroller) scroller.scrollTop = scroller.scrollHeight;
      const inputs = el.querySelectorAll('input');
      if (inputs[0]) inputs[0].focus();
    });
  }

  const editBtn = $('#editPointBtn');
  if (editBtn) {
    if (ws.readonly) editBtn.hidden = true;
    else editBtn.addEventListener('click', () => setChartMode('edit'));
  }

  const btn = $('#linkModeBtn');
  if (btn) {
    if (ws.readonly) btn.hidden = true;
    else btn.addEventListener('click', () => setChartMode('link'));
  }

  const zi = $('#zoomIn'), zo = $('#zoomOut'), ft = $('#fitBtn');
  if (zi) zi.addEventListener('click', () => zoomCenter(1.28));
  if (zo) zo.addEventListener('click', () => zoomCenter(1 / 1.28));
  if (ft) ft.addEventListener('click', resetView);

  const fabOk = $('#fabOk'), fabCancel = $('#fabCancel');
  if (fabOk) fabOk.addEventListener('click', confirmLink);
  if (fabCancel) fabCancel.addEventListener('click', clearSelection);
}

/* ---------- 拖拽排序 ---------- */
function beginDrag(ev, rowEl) {
  if (ws.readonly || !ws.project) return;
  ev.preventDefault();

  const handle = ev.currentTarget;
  const index = totalUI.rowEls.indexOf(rowEl);
  if (index < 0) return;

  const rowH = rowEl.getBoundingClientRect().height || 46;
  const startY = ev.clientY;
  let target = index;
  let moved = false;

  handle.setPointerCapture(ev.pointerId);
  rowEl.classList.add('is-dragging');

  const onMove = e => {
    const dy = e.clientY - startY;
    if (Math.abs(dy) > 3) moved = true;

    target = clamp(index + Math.round(dy / rowH), 0, totalUI.rowEls.length - 1);

    totalUI.rowEls.forEach((el, i) => {
      if (el === rowEl) {
        el.style.transform = `translateY(${dy}px)`;
        el.style.zIndex = '10';
        return;
      }
      let dy2 = 0;
      if (index < target && i > index && i <= target) dy2 = -rowH;
      else if (index > target && i < index && i >= target) dy2 = rowH;
      el.style.transform = dy2 ? `translateY(${dy2}px)` : '';
    });

    const scroller = $('.table-scroll');
    if (scroller) {
      const r = scroller.getBoundingClientRect();
      if (e.clientY < r.top + 34) scroller.scrollTop -= 10;
      else if (e.clientY > r.bottom - 34) scroller.scrollTop += 10;
    }
  };

  const onUp = () => {
    handle.removeEventListener('pointermove', onMove);
    handle.removeEventListener('pointerup', onUp);
    handle.removeEventListener('pointercancel', onUp);
    try { handle.releasePointerCapture(ev.pointerId); } catch {}

    rowEl.classList.remove('is-dragging');
    totalUI.rowEls.forEach(el => { el.style.transform = ''; el.style.zIndex = ''; });

    if (moved && target !== index) {
      const rows = ws.project.rows;
      const els = totalUI.rowEls;

      const [movedRow] = rows.splice(index, 1);
      rows.splice(target, 0, movedRow);
      const [movedEl] = els.splice(index, 1);
      els.splice(target, 0, movedEl);

      // 只移动 DOM 节点，不重建整张表
      const box = $('#rowList');
      const next = els[target + 1];
      if (box) box.insertBefore(movedEl, next || null);

      markDirty();
      invalidatePoints();
      scheduleDraw();
      scheduleStats();
    }
  };

  handle.addEventListener('pointermove', onMove);
  handle.addEventListener('pointerup', onUp);
  handle.addEventListener('pointercancel', onUp);
}

/* ------------------------------------------------------------
 * 10. 全站仪测绘：平面图
 * ---------------------------------------------------------- */
const SVGNS = 'http://www.w3.org/2000/svg';
const MIN_SPAN = 1.0;
/** 点按与拖动的分界位移（px）：小于此位移视为点按，不移动视图 */
const TAP_SLOP = 8;
/** 连线的默认命中容差（px）；已选中某条线时放宽到 LINK_HIT_TOL_PICKED */
const LINK_HIT_TOL = 11;
const LINK_HIT_TOL_PICKED = 22;

function svgEl(tag, cls) {
  const el = document.createElementNS(SVGNS, tag);
  if (cls) el.setAttribute('class', cls);
  return el;
}

const chart = {
  svg: null,
  plotG: null,
  gridLayer: null,
  linkLayer: null,
  previewLayer: null,
  dotLayer: null,
  labelLayer: null,
  selLayer: null,
  tickLayer: null,
  clipRect: null,

  pools: null,

  // 命中测试用的屏幕坐标缓存
  hitPts: [],
  hitLinks: [],

  // 图上操作模式：'' 普通 / 'link' 连线 / 'edit' 编辑点
  mode: '',
  sel: [],
  pickedLink: '',

  // 手势
  pointers: new Map(),
  gesture: null,
  lastTap: null,
  multiTouch: false,

  reset() {
    this.svg = null;
    this.hitPts = [];
    this.hitLinks = [];
    this.mode = '';
    this.sel = [];
    this.pickedLink = '';
    this.pointers.clear();
    this.gesture = null;
    this.lastTap = null;
    this.multiTouch = false;
    this.pools = null;
  },

  init() {
    const svg = $('#chart');
    if (!svg) return;
    this.svg = svg;

    svg.innerHTML = '';

    // clipPath 必须挂在 <defs> 上，才能被引用
    const defs = svgEl('defs');
    const clip = svgEl('clipPath');
    clip.setAttribute('id', 'plotClip');
    this.clipRect = svgEl('rect');
    clip.appendChild(this.clipRect);
    defs.appendChild(clip);
    svg.appendChild(defs);

    this.plotG = svgEl('g');
    this.plotG.setAttribute('clip-path', 'url(#plotClip)');

    this.gridLayer = svgEl('g');
    this.linkLayer = svgEl('g');
    this.previewLayer = svgEl('g');
    this.dotLayer = svgEl('g');
    this.labelLayer = svgEl('g');
    this.selLayer = svgEl('g');

    this.plotG.append(
      this.gridLayer, this.linkLayer, this.previewLayer,
      this.dotLayer, this.labelLayer, this.selLayer
    );
    svg.appendChild(this.plotG);

    this.tickLayer = svgEl('g');
    svg.appendChild(this.tickLayer);

    this.pools = {
      grid: [], ticks: [], links: [], preview: [], dots: [], labels: [], hits: [], sel: []
    };

    bindChartGestures(svg);
  }
};

function invalidatePoints() {
  ws.pointsCache = null;
}

/** 缓存点位列表：只有数据变动时才重建 */
function getPoints() {
  if (!ws.project) return [];
  if (ws.pointsCache) return ws.pointsCache;

  const out = [];
  ws.project.rows.forEach((r, i) => {
    const n = Core.num(r.n);
    const e = Core.num(r.e);
    if (n === null || e === null) return;
    out.push({
      id: r.id,
      no: (r.no || '').trim() || String(i + 1),
      n, e,
      color: typeColorOf(r.typeId)
    });
  });

  ws.pointsCache = out;
  return out;
}

function scheduleDraw() {
  if (!ws.project || ws.kind !== 'total') return;
  if (ws.drawRaf) return;
  ws.drawRaf = requestAnimationFrame(() => {
    ws.drawRaf = 0;
    drawChart();
  });
}

function scheduleStats() {
  if (ws.statsRaf) return;
  ws.statsRaf = requestAnimationFrame(() => {
    ws.statsRaf = 0;
    updateStats();
  });
}

function chartMetrics() {
  const svg = chart.svg;
  if (!svg) return { W: 0, H: 0, M: {}, pw: 0, ph: 0 };
  const rect = svg.getBoundingClientRect();
  const W = Math.max(1, Math.round(rect.width));
  const H = Math.max(1, Math.round(rect.height));
  const M = { l: 62, r: 22, t: 34, b: 40 };
  return { W, H, M, pw: Math.max(1, W - M.l - M.r), ph: Math.max(1, H - M.t - M.b) };
}

function niceStep(span, targetTicks) {
  const raw = span / Math.max(1, targetTicks);
  if (!Number.isFinite(raw) || raw <= 0) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  let m = 10;
  if (norm <= 1) m = 1;
  else if (norm <= 2) m = 2;
  else if (norm <= 5) m = 5;
  return m * mag;
}

function decimalsFor(step) {
  if (step >= 1) return 0;
  return clamp(Math.ceil(-Math.log10(step) - 1e-9), 0, 3);
}

function poolAt(pool, i, tag, cls, parent) {
  let n = pool[i];
  if (!n) {
    n = svgEl(tag, cls);
    parent.appendChild(n);
    pool[i] = n;
  } else if (n.style.display === 'none') {
    n.style.display = '';
  }
  return n;
}

function hidePool(pool, from) {
  for (let i = from; i < pool.length; i++) {
    if (pool[i]) pool[i].style.display = 'none';
  }
}

/* ---------- 标注重叠检测：均匀网格哈希，O(N) ---------- */
function makeBoxIndex(cellSize) {
  const map = new Map();
  const key = (gx, gy) => gx + ',' + gy;

  return {
    add(r) {
      const gx0 = Math.floor(r.x1 / cellSize), gx1 = Math.floor(r.x2 / cellSize);
      const gy0 = Math.floor(r.y1 / cellSize), gy1 = Math.floor(r.y2 / cellSize);
      for (let gx = gx0; gx <= gx1; gx++) {
        for (let gy = gy0; gy <= gy1; gy++) {
          const k = key(gx, gy);
          let arr = map.get(k);
          if (!arr) { arr = []; map.set(k, arr); }
          arr.push(r);
        }
      }
    },
    hit(r) {
      const gx0 = Math.floor(r.x1 / cellSize), gx1 = Math.floor(r.x2 / cellSize);
      const gy0 = Math.floor(r.y1 / cellSize), gy1 = Math.floor(r.y2 / cellSize);
      for (let gx = gx0; gx <= gx1; gx++) {
        for (let gy = gy0; gy <= gy1; gy++) {
          const arr = map.get(key(gx, gy));
          if (!arr) continue;
          for (let i = 0; i < arr.length; i++) {
            const b = arr[i];
            if (r.x1 < b.x2 && r.x2 > b.x1 && r.y1 < b.y2 && r.y2 > b.y1) return true;
          }
        }
      }
      return false;
    }
  };
}

function drawChart(opt) {
  const o = opt || {};
  if (!ws.project || ws.kind !== 'total') return;

  const svg = chart.svg || $('#chart');
  if (!svg) return;
  if (!chart.svg) chart.init();
  if (!chart.svg) return;

  const { W, H, M, pw, ph } = chartMetrics();
  if (W < 40 || H < 40) return;

  const pts = getPoints();
  const emptyEl = $('#chartEmpty');
  if (emptyEl) emptyEl.hidden = pts.length > 0;

  updateStats();

  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('width', W);
  svg.setAttribute('height', H);

  const P = chart.pools;
  if (!P) return;

  if (!pts.length) {
    hidePool(P.grid, 0);
    hidePool(P.links, 0);
    hidePool(P.preview, 0);
    hidePool(P.dots, 0);
    hidePool(P.labels, 0);
    hidePool(P.ticks, 0);
    hidePool(P.sel, 0);
    chart.hitPts = [];
    chart.hitLinks = [];
    return;
  }

  let minN = Infinity, maxN = -Infinity, minE = Infinity, maxE = -Infinity;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    if (p.n < minN) minN = p.n;
    if (p.n > maxN) maxN = p.n;
    if (p.e < minE) minE = p.e;
    if (p.e > maxE) maxE = p.e;
  }

  if (maxN - minN < MIN_SPAN) {
    const c = (minN + maxN) / 2;
    minN = c - MIN_SPAN / 2; maxN = c + MIN_SPAN / 2;
  }
  if (maxE - minE < MIN_SPAN) {
    const c = (minE + maxE) / 2;
    minE = c - MIN_SPAN / 2; maxE = c + MIN_SPAN / 2;
  }

  if (o.fit || !ws.view.ready || !ws.view.s) {
    const padX = Math.max(pw * 0.10, 26);
    const padY = Math.max(ph * 0.13, 24);
    const s = Math.min(
      (pw - padX * 2) / (maxE - minE),
      (ph - padY * 2) / (maxN - minN)
    );
    ws.view.s = Math.max(s, 1e-6);
    ws.view.fitS = ws.view.s;
    ws.view.cx = (minE + maxE) / 2;
    ws.view.cy = (minN + maxN) / 2;
    ws.view.ready = true;
    if (o.fit) ws.view.manual = false;
  }

  const s = ws.view.s;
  const cx = ws.view.cx;
  const cy = ws.view.cy;

  const originX = M.l + pw / 2;
  const originY = M.t + ph / 2;
  const toX = e => originX + (e - cx) * s;
  const toY = n => originY - (n - cy) * s;

  const e0 = cx - (pw / 2) / s;
  const e1 = cx + (pw / 2) / s;
  const n0 = cy - (ph / 2) / s;
  const n1 = cy + (ph / 2) / s;

  /* clip */
  chart.clipRect.setAttribute('x', M.l);
  chart.clipRect.setAttribute('y', M.t);
  chart.clipRect.setAttribute('width', pw);
  chart.clipRect.setAttribute('height', ph);

  /* ---------- 网格与刻度 ---------- */
  const span = Math.max(e1 - e0, n1 - n0);
  const step = niceStep(span, 6);
  const dec = decimalsFor(step);
  const fmt = v => v.toFixed(dec);
  const axisFont = (dec > 0 || Math.abs(e0) > 99999) ? 9 : 10;

  let gi = 0, ti = 0;

  const iE0 = Math.ceil(e0 / step);
  const iE1 = Math.floor(e1 / step);
  for (let i = iE0; i <= iE1; i++) {
    const v = i * step;
    const x = Math.round(toX(v)) + 0.5;
    if (x < M.l - 0.5 || x > M.l + pw + 0.5) continue;

    const ln = poolAt(P.grid, gi++, 'line', 'grid-line', chart.gridLayer);
    ln.setAttribute('x1', x); ln.setAttribute('y1', M.t);
    ln.setAttribute('x2', x); ln.setAttribute('y2', M.t + ph);

    const tx = poolAt(P.ticks, ti++, 'text', 'tick-label', chart.tickLayer);
    tx.setAttribute('font-size', axisFont);
    tx.setAttribute('x', x);
    tx.setAttribute('y', M.t + ph + 15);
    tx.setAttribute('text-anchor', 'middle');
    tx.textContent = fmt(v);
  }

  const iN0 = Math.ceil(n0 / step);
  const iN1 = Math.floor(n1 / step);
  for (let i = iN0; i <= iN1; i++) {
    const v = i * step;
    const y = Math.round(toY(v)) + 0.5;
    if (y < M.t - 0.5 || y > M.t + ph + 0.5) continue;

    const ln = poolAt(P.grid, gi++, 'line', 'grid-line', chart.gridLayer);
    ln.setAttribute('x1', M.l); ln.setAttribute('y1', y);
    ln.setAttribute('x2', M.l + pw); ln.setAttribute('y2', y);

    const tx = poolAt(P.ticks, ti++, 'text', 'tick-label', chart.tickLayer);
    tx.setAttribute('font-size', axisFont);
    tx.setAttribute('x', M.l - 9);
    tx.setAttribute('y', y + 3.5);
    tx.setAttribute('text-anchor', 'end');
    tx.textContent = fmt(v);
  }

  /* 坐标轴（原点可见时加粗） */
  if (0 >= e0 && 0 <= e1) {
    const ax = Math.round(toX(0)) + 0.5;
    const ln = poolAt(P.grid, gi++, 'line', 'axis-line', chart.gridLayer);
    ln.setAttribute('x1', ax); ln.setAttribute('y1', M.t);
    ln.setAttribute('x2', ax); ln.setAttribute('y2', M.t + ph);
  }
  if (0 >= n0 && 0 <= n1) {
    const ay = Math.round(toY(0)) + 0.5;
    const ln = poolAt(P.grid, gi++, 'line', 'axis-line', chart.gridLayer);
    ln.setAttribute('x1', M.l); ln.setAttribute('y1', ay);
    ln.setAttribute('x2', M.l + pw); ln.setAttribute('y2', ay);
  }

  hidePool(P.grid, gi);
  hidePool(P.ticks, ti);

  /* ---------- 连线 ---------- */
  const byId = new Map();
  for (let i = 0; i < pts.length; i++) byId.set(pts[i].id, pts[i]);

  chart.hitLinks = [];
  let li = 0;

  const links = ws.project.links || [];
  for (let i = 0; i < links.length; i++) {
    const l = links[i];
    const a = byId.get(l.a);
    const b = byId.get(l.b);
    if (!a || !b) continue;

    const x1 = toX(a.e), y1 = toY(a.n);
    const x2 = toX(b.e), y2 = toY(b.n);
    if (Math.abs(x1 - x2) < 0.5 && Math.abs(y1 - y2) < 0.5) continue;

    const picked = chart.mode === 'link' && chart.pickedLink === l.id;

    // 选中时先铺一层半透明光带，再画本线
    if (picked) {
      const hl = poolAt(P.links, li++, 'line', 'link-hl', chart.linkLayer);
      hl.setAttribute('class', 'link-hl');
      hl.setAttribute('x1', x1.toFixed(2));
      hl.setAttribute('y1', y1.toFixed(2));
      hl.setAttribute('x2', x2.toFixed(2));
      hl.setAttribute('y2', y2.toFixed(2));
    }

    const ln = poolAt(P.links, li++, 'line', 'link-line', chart.linkLayer);
    ln.setAttribute('class', picked ? 'link-line is-picked' : 'link-line');
    ln.setAttribute('x1', x1.toFixed(2));
    ln.setAttribute('y1', y1.toFixed(2));
    ln.setAttribute('x2', x2.toFixed(2));
    ln.setAttribute('y2', y2.toFixed(2));
    ln.setAttribute('stroke', l.color || LINK_COLORS[0].value);

    chart.hitLinks.push({ id: l.id, x1, y1, x2, y2 });
  }
  hidePool(P.links, li);

  /* ---------- 待连折线预览（连线模式下已选 ≥2 点） ---------- */
  let pi = 0;
  if (chart.mode === 'link' && chart.sel.length >= 2) {
    const pts2 = chart.sel.map(id => byId.get(id)).filter(Boolean);
    if (pts2.length >= 2) {
      const pl = poolAt(P.preview, pi++, 'polyline', 'link-preview', chart.previewLayer);
      pl.setAttribute('points', pts2.map(p => `${toX(p.e).toFixed(1)},${toY(p.n).toFixed(1)}`).join(' '));
    }
  }
  hidePool(P.preview, pi);

  /* ---------- 点位与标注 ---------- */
  const boxes = makeBoxIndex(48);

  // 先占住所有点位，避免标签压在别的点上
  for (let i = 0; i < pts.length; i++) {
    const x = toX(pts[i].e);
    const y = toY(pts[i].n);
    pts[i].sx = x;
    pts[i].sy = y;
    boxes.add({ x1: x - 6, y1: y - 6, x2: x + 6, y2: y + 6 });
  }

  let di = 0, li2 = 0;
  chart.hitPts = [];

  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const x = p.sx, y = p.sy;
    const label = String(p.no);
    const w = label.length * 7.2 + 3;

    const cands = [
      [x + 9,  y - 9,  'start'],
      [x - 9,  y - 9,  'end'],
      [x + 9,  y + 16, 'start'],
      [x - 9,  y + 16, 'end'],
      [x,      y - 11, 'middle'],
      [x,      y + 19, 'middle'],
      [x + 10, y + 4,  'start'],
      [x - 10, y + 4,  'end']
    ];

    let chosen = null;
    for (let c = 0; c < cands.length; c++) {
      const cx2 = cands[c][0], cy2 = cands[c][1], anchor = cands[c][2];
      const x1 = anchor === 'end' ? cx2 - w : anchor === 'middle' ? cx2 - w / 2 : cx2;
      const rect = { x1, x2: x1 + w, y1: cy2 - 10, y2: cy2 + 3 };
      if (rect.x1 < M.l + 2 || rect.x2 > M.l + pw - 2) continue;
      if (rect.y1 < M.t + 2 || rect.y2 > M.t + ph - 2) continue;
      if (boxes.hit(rect)) continue;
      chosen = { rect, lx: cx2, ly: cy2, anchor };
      break;
    }
    if (!chosen) {
      const cx2 = cands[0][0], cy2 = cands[0][1];
      chosen = { rect: { x1: cx2, x2: cx2 + w, y1: cy2 - 10, y2: cy2 + 3 }, lx: cx2, ly: cy2, anchor: 'start' };
    }
    boxes.add(chosen.rect);

    const dot = poolAt(P.dots, di++, 'circle', 'pt-dot', chart.dotLayer);
    dot.setAttribute('cx', x.toFixed(2));
    dot.setAttribute('cy', y.toFixed(2));
    dot.setAttribute('r', 4.6);
    dot.setAttribute('fill', p.color);

    const lb = poolAt(P.labels, li2++, 'text', 'pt-label', chart.labelLayer);
    lb.setAttribute('x', chosen.lx.toFixed(2));
    lb.setAttribute('y', chosen.ly.toFixed(2));
    lb.setAttribute('text-anchor', chosen.anchor);
    lb.setAttribute('fill', p.color);
    lb.textContent = label;

    chart.hitPts.push({ id: p.id, x, y });
  }

  hidePool(P.dots, di);
  hidePool(P.labels, li2);

  /* ---------- 选中高亮 ---------- */
  let si = 0;
  chart.sel.forEach(id => {
    const p = byId.get(id);
    if (!p) return;
    const x = toX(p.e), y = toY(p.n);
    const ring = poolAt(P.sel, si++, 'circle', 'pt-ring', chart.selLayer);
    ring.setAttribute('cx', x.toFixed(2));
    ring.setAttribute('cy', y.toFixed(2));
    ring.setAttribute('r', 12);
    const halo = poolAt(P.sel, si++, 'circle', 'pt-halo', chart.selLayer);
    halo.setAttribute('cx', x.toFixed(2));
    halo.setAttribute('cy', y.toFixed(2));
    halo.setAttribute('r', 17);
  });
  hidePool(P.sel, si);

  updateFab();
}

/* ---------- 统计条 ---------- */
let lastStats = '';

function updateStats() {
  const el = $('#gridStats');
  if (!el || !ws.project) return;

  const pts = getPoints();
  if (!pts.length) {
    const html = `<span class="stat-empty">填入 N、E 坐标后，这里会自动汇总坐标范围</span>`;
    if (html !== lastStats) { el.innerHTML = html; lastStats = html; }
    return;
  }

  let minN = Infinity, maxN = -Infinity, minE = Infinity, maxE = -Infinity;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    if (p.n < minN) minN = p.n;
    if (p.n > maxN) maxN = p.n;
    if (p.e < minE) minE = p.e;
    if (p.e > maxE) maxE = p.e;
  }

  let hMin = Infinity, hMax = -Infinity;
  ws.project.rows.forEach(r => {
    const v = Core.num(r.h);
    if (v === null) return;
    if (v < hMin) hMin = v;
    if (v > hMax) hMax = v;
  });

  const items = [
    ['有效点位', `${pts.length} / ${ws.project.rows.length}`],
    ['N 范围', `${minN.toFixed(3)} ~ ${maxN.toFixed(3)}`],
    ['E 范围', `${minE.toFixed(3)} ~ ${maxE.toFixed(3)}`]
  ];
  if (hMin !== Infinity) items.push(['Z 范围', `${hMin.toFixed(3)} ~ ${hMax.toFixed(3)}`]);

  const html = items.map(([k, v]) =>
    `<div class="stat"><span class="stat-k">${escHTML(k)}</span><span class="stat-v">${escHTML(v)}</span></div>`
  ).join('');

  if (html !== lastStats) { el.innerHTML = html; lastStats = html; }
}

/* ---------- 缩放 / 平移 ---------- */
function zoomAt(px, py, factor) {
  if (!ws.view.s) return;
  const { M, pw, ph } = chartMetrics();
  const originX = M.l + pw / 2;
  const originY = M.t + ph / 2;

  const s0 = ws.view.s;
  const minS = Math.max(ws.view.fitS * 0.08, 1e-6);
  const maxS = Math.max(ws.view.fitS * 80, 1e-3);
  const s1 = clamp(s0 * factor, minS, maxS);
  if (Math.abs(s1 - s0) < 1e-9) return;

  const wx = ws.view.cx + (px - originX) / s0;
  const wy = ws.view.cy - (py - originY) / s0;

  ws.view.s = s1;
  ws.view.cx = wx - (px - originX) / s1;
  ws.view.cy = wy + (py - originY) / s1;
  ws.view.manual = true;

  scheduleDraw();
}

function zoomCenter(factor) {
  const { M, pw, ph } = chartMetrics();
  zoomAt(M.l + pw / 2, M.t + ph / 2, factor);
}

function resetView() {
  ws.view.manual = false;
  ws.view.ready = false;
  drawChart({ fit: true });
}

function bindChartGestures(svg) {
  svg.addEventListener('pointerdown', e => {
    if (!ws.view.s) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    try { svg.setPointerCapture(e.pointerId); } catch {}
    chart.pointers.set(e.pointerId, {
      x: e.clientX, y: e.clientY,
      sx: e.clientX, sy: e.clientY,
      moved: false, t: Date.now()
    });
    // 本次手势出现过第二根手指（缩放），整个手势序列结束时不再判定为点按
    if (chart.pointers.size > 1) chart.multiTouch = true;
    svg.classList.add('is-grabbing');
    startGesture();
  });

  svg.addEventListener('pointermove', e => {
    const p = chart.pointers.get(e.pointerId);
    if (!p) return;
    p.x = e.clientX; p.y = e.clientY;
    if (!p.moved && Math.abs(p.x - p.sx) + Math.abs(p.y - p.sy) > TAP_SLOP) p.moved = true;
    // 单指必须确认是「拖动」才平移，避免轻微手抖把点按变成平移、并误置视角为手动
    if (p.moved || chart.pointers.size > 1) updateGesture();
  });

  const end = e => {
    const p = chart.pointers.get(e.pointerId);
    if (!p) return;
    chart.pointers.delete(e.pointerId);
    try { svg.releasePointerCapture(e.pointerId); } catch {}
    if (chart.pointers.size === 0) svg.classList.remove('is-grabbing');
    startGesture();

    const wasMulti = chart.multiTouch;
    if (chart.pointers.size === 0) chart.multiTouch = false;

    // 点按判定只看「按下到抬起之间没有拖动」，与按住时长无关：
    // 原先的 700ms 上限会让按得稍慢的点击被丢弃，表现为「轻点无效、按住才生效」。
    // 双指缩放序列的收尾不参与点按判定，避免缩放后误选。
    if (!p.moved && !wasMulti && chart.pointers.size === 0) {
      handleTap(e.clientX, e.clientY);
    }
  };

  svg.addEventListener('pointerup', end);
  svg.addEventListener('pointercancel', end);

  // 长按 / 右键不弹出系统菜单，避免打断点选与拖动
  svg.addEventListener('contextmenu', e => e.preventDefault());

  svg.addEventListener('wheel', e => {
    if (!ws.view.s) return;
    e.preventDefault();
    const rect = svg.getBoundingClientRect();
    const factor = Math.pow(1.0016, -e.deltaY);
    zoomAt(e.clientX - rect.left, e.clientY - rect.top, factor);
  }, { passive: false });
}

function startGesture() {
  const p = Array.from(chart.pointers.values());
  if (p.length === 1) {
    chart.gesture = { mode: 'pan', sx: p[0].x, sy: p[0].y, cx: ws.view.cx, cy: ws.view.cy };
  } else if (p.length === 2) {
    const [a, b] = p;
    chart.gesture = {
      mode: 'pinch',
      dist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
      s: ws.view.s,
      cx: ws.view.cx,
      cy: ws.view.cy,
      mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
    };
  } else {
    chart.gesture = null;
  }
}

function updateGesture() {
  const g = chart.gesture;
  if (!g || !ws.view.s) return;

  const p = Array.from(chart.pointers.values());
  const { M, pw, ph } = chartMetrics();
  const originX = M.l + pw / 2;
  const originY = M.t + ph / 2;

  if (g.mode === 'pan' && p.length === 1) {
    const dx = p[0].x - g.sx;
    const dy = p[0].y - g.sy;

    if (!g.started) {
      // 未越过点按阈值前不平移，保证「轻点」不会让视角抖动
      if (Math.abs(dx) + Math.abs(dy) < TAP_SLOP) return;
      // 首次确认是拖动：起点对齐到当前位置，后续平移量从零累计，避免视角一次性跳变
      g.started = true;
      g.sx = p[0].x; g.sy = p[0].y;
      g.cx = ws.view.cx; g.cy = ws.view.cy;
      return;
    }

    if (dx === 0 && dy === 0) return;
    ws.view.cx = g.cx - dx / ws.view.s;
    ws.view.cy = g.cy + dy / ws.view.s;
    ws.view.manual = true;
    scheduleDraw();
    return;
  }

  if (g.mode === 'pinch' && p.length === 2) {
    const d = Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y) || 1;
    const ratio = d / g.dist;

    const rect = chart.svg.getBoundingClientRect();
    const mx0 = g.mid.x - rect.left;
    const my0 = g.mid.y - rect.top;
    const wx = g.cx + (mx0 - originX) / g.s;
    const wy = g.cy - (my0 - originY) / g.s;

    const minS = Math.max(ws.view.fitS * 0.08, 1e-6);
    const maxS = Math.max(ws.view.fitS * 80, 1e-3);
    const newS = clamp(g.s * ratio, minS, maxS);

    const curMid = { x: (p[0].x + p[1].x) / 2, y: (p[0].y + p[1].y) / 2 };
    const dmx = curMid.x - g.mid.x;
    const dmy = curMid.y - g.mid.y;

    let ncx = wx - (mx0 - originX) / newS;
    let ncy = wy + (my0 - originY) / newS;
    ncx -= dmx / newS;
    ncy += dmy / newS;

    ws.view.s = newS;
    ws.view.cx = ncx;
    ws.view.cy = ncy;
    ws.view.manual = true;
    scheduleDraw();
  }
}

/* ------------------------------------------------------------
 * 11. 全站仪测绘：图上的点选、连线、改色、改类型
 * ---------------------------------------------------------- */
function hitPoint(x, y) {
  let best = null;
  let bestD = 16 * 16;
  for (let i = 0; i < chart.hitPts.length; i++) {
    const p = chart.hitPts[i];
    const d = (p.x - x) * (p.x - x) + (p.y - y) * (p.y - y);
    if (d < bestD) { bestD = d; best = p; }
  }
  return best;
}

function distToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-6) return Math.hypot(px - x1, py - y1);
  let t = ((px - x1) * dx + (py - y1) * dy) / len2;
  t = clamp(t, 0, 1);
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

function hitLink(x, y, tol) {
  let best = null;
  let bestD = tol || LINK_HIT_TOL;
  for (let i = 0; i < chart.hitLinks.length; i++) {
    const l = chart.hitLinks[i];
    const d = distToSegment(x, y, l.x1, l.y1, l.x2, l.y2);
    if (d < bestD) { bestD = d; best = l; }
  }
  return best;
}

function handleTap(clientX, clientY) {
  if (!ws.project || ws.kind !== 'total') return;
  const rect = chart.svg.getBoundingClientRect();
  const x = clientX - rect.left;
  const y = clientY - rect.top;

  const pt = hitPoint(x, y);

  /* ---------- 连线模式：选点连线 / 选线改色 ---------- */
  if (chart.mode === 'link') {
    if (pt) { selectPoint(pt.id); return; }

    // 已选中某条线时，优先判断是否又点回了它（容差放宽），让「再点一次」可靠触发编辑
    let lk = null;
    if (chart.pickedLink) {
      const own = chart.hitLinks.find(l => l.id === chart.pickedLink);
      if (own && distToSegment(x, y, own.x1, own.y1, own.x2, own.y2) <= LINK_HIT_TOL_PICKED) {
        lk = own;
      }
    }
    if (!lk) lk = hitLink(x, y, LINK_HIT_TOL);

    if (lk) {
      if (chart.pickedLink === lk.id) {
        chart.pickedLink = '';
        openLinkColor(lk.id);
      } else {
        chart.pickedLink = lk.id;
        drawChart();
        toast('已选中连线，再点它一次可改颜色或删除');
      }
      return;
    }

    // 点空白：取消已选中的连线
    if (chart.pickedLink) { chart.pickedLink = ''; drawChart(); }
    return;
  }

  /* ---------- 编辑点模式：选点 → 再次点击改类型 ---------- */
  if (chart.mode === 'edit') {
    if (!pt) return;
    if (chart.sel[0] === pt.id) {
      if (ws.readonly) { toast('只读模式下无法修改点位类型'); return; }
      chart.sel = [];
      openTypePicker(pt.id);
    } else {
      chart.sel = [pt.id];
      drawChart();
      toast('已选中点，再次点击可改类型');
    }
    return;
  }

  /* ---------- 普通模式：空白处双击 → 自适应 ---------- */
  if (pt || hitLink(x, y, LINK_HIT_TOL)) return;

  const lt = chart.lastTap;
  if (lt && !lt.id && Date.now() - lt.t < 340) {
    chart.lastTap = null;
    resetView();
    return;
  }
  chart.lastTap = { id: '', x, y, t: Date.now() };
}

/** 切换图上操作模式：'' / 'link' / 'edit'，两种模式互斥 */
function setChartMode(mode) {
  if (!ws.project || ws.kind !== 'total') return;
  if (mode === 'link' && ws.readonly) { toast('只读模式下无法编辑连线'); return; }
  if (mode === 'edit' && ws.readonly) { toast('只读模式下无法修改点位类型'); return; }

  const next = chart.mode === mode ? '' : mode;
  chart.mode = next;
  chart.sel = [];
  chart.pickedLink = '';
  chart.lastTap = null;
  chart.multiTouch = false;

  const linkBtn = $('#linkModeBtn');
  const editBtn = $('#editPointBtn');
  if (linkBtn) linkBtn.classList.toggle('is-on', next === 'link');
  if (editBtn) editBtn.classList.toggle('is-on', next === 'edit');
  if (chart.svg) chart.svg.classList.toggle('is-picking', !!next);

  drawChart();
  updateFab();

  if (next === 'link') toast('依次点选多个点（至少 2 个）再点 ✓ 确认；点线选中后再点它一次可改色或删除');
  else if (next === 'edit') toast('点选一个点，再次点击可修改它的类型');
}

/** 连线模式下按点击顺序累加点；再点已选中的点 = 取消该点 */
function selectPoint(id) {
  const i = chart.sel.indexOf(id);
  if (i >= 0) chart.sel.splice(i, 1);
  else chart.sel.push(id);
  drawChart();
  updateFab();
}

function clearSelection() {
  chart.sel = [];
  chart.pickedLink = '';
  drawChart();
  updateFab();
}

function updateFab() {
  const fab = $('#chartFab');
  if (!fab) return;
  if (chart.mode !== 'link' || chart.sel.length === 0) { fab.hidden = true; return; }

  fab.hidden = false;

  const text = $('#fabText');
  const ok = $('#fabOk');
  const pts = getPoints();
  const nameOf = id => {
    const p = pts.find(x => x.id === id);
    return p ? p.no : '?';
  };
  const names = chart.sel.map(nameOf);

  if (text) {
    let chain;
    if (names.length <= 4) chain = names.join(' → ');
    else chain = `${names[0]} → ${names[1]} → … → ${names[names.length - 1]}`;

    text.textContent = names.length === 1
      ? `已选 ${chain}，继续点选下一个点`
      : `${chain}（${names.length - 1} 段）`;
  }
  if (ok) ok.disabled = chart.sel.length < 2;
}

/** 按选中顺序把相邻两点依次连成折线 */
function confirmLink() {
  if (!ws.project || chart.sel.length < 2) return;
  if (!Array.isArray(ws.project.links)) ws.project.links = [];

  const links = ws.project.links;
  let added = 0, dup = 0;

  for (let i = 0; i < chart.sel.length - 1; i++) {
    const a = chart.sel[i], b = chart.sel[i + 1];
    if (a === b) continue;
    const exists = links.some(l => (l.a === a && l.b === b) || (l.a === b && l.b === a));
    if (exists) { dup++; continue; }
    links.push({ id: uid('l'), a, b, color: LINK_COLORS[0].value });
    added++;
  }

  chart.sel = [];
  if (added) markDirty();
  drawChart();
  updateFab();

  if (!added) toast('这些点之间已经有连线了');
  else toast(`已连线 ${added} 段${dup ? `，另有 ${dup} 段已存在` : ''}`);
}

function openLinkColor(linkId) {
  if (ws.readonly) { toast('只读模式下无法修改连线'); return; }
  const link = (ws.project.links || []).find(l => l.id === linkId);
  if (!link) return;

  const current = link.color || LINK_COLORS[0].value;

  showModal({
    title: '连线 · 颜色与删除',
    hideCancel: true,
    okText: '确认',
    body: `
      <p class="opt-label">连线颜色</p>
      <div class="color-grid">
        ${LINK_COLORS.map(c => `
          <button type="button" class="color-dot${c.value === current ? ' is-on' : ''}"
                  data-color="${c.value}" title="${c.name}"
                  style="background:${c.value}"></button>`).join('')}
      </div>
      ${ws.readonly ? '' : `
      <div class="opt-list" style="margin-top:16px">
        <button type="button" class="opt-item is-danger" data-del="1">
          <span class="opt-name">删除这条连线</span>
          <span class="opt-sub">删除后需要重新点选两点才能连回来</span>
        </button>
      </div>`}`
    ,
    onMount: (body, finish) => {
      $$('[data-color]', body).forEach(b => {
        b.addEventListener('click', () => {
          if (ws.readonly) return;
          link.color = b.dataset.color;
          markDirty();
          drawChart();
          $$('[data-color]', body).forEach(x => x.classList.toggle('is-on', x === b));
        });
      });
      const del = $('[data-del]', body);
      if (del) del.addEventListener('click', () => {
        ws.project.links = ws.project.links.filter(l => l.id !== linkId);
        markDirty();
        drawChart();
        finish(true);
        toast('已删除连线');
      });
    }
  }).then(() => {
    chart.pickedLink = '';
    drawChart();
  }, () => {
    chart.pickedLink = '';
    drawChart();
  });
}

function openTypePicker(pointId) {
  const row = ws.project.rows.find(r => r.id === pointId);
  if (!row) return;

  chart.sel = [pointId];
  drawChart();

  const finishClean = () => { chart.sel = []; drawChart(); };

  const typeRows = () => pointTypes().map(t => `
    <button type="button" class="opt-item${t.id === row.typeId ? ' is-on' : ''}" data-type="${t.id}">
      <span class="opt-dot" style="background:${escHTML(t.color)}"></span>
      <span class="opt-name">${escHTML(t.name)}</span>
      <span class="opt-tag" data-tag="${escHTML(t.id)}"${t.isDefault ? '' : ' hidden'}>新建时默认</span>
    </button>`).join('');

  showModal({
    title: `点位类型 · ${row.no || '未命名'}`,
    hideOk: true,
    body: `
      <div class="opt-list">${typeRows()}</div>
      <div class="opt-list" style="margin-top:10px">
        <button type="button" class="opt-item" data-auto="1">
          <span class="opt-name">按备注自动识别</span>
        </button>
      </div>
      <p class="kw-hint">只改这一个点；默认点类型请到「程序设置」里调整。</p>`,
    onMount: (body, finish) => {
      $$('[data-type]', body).forEach(b => {
        b.addEventListener('click', () => {
          if (ws.readonly) { finish(false); return; }
          row.typeId = b.dataset.type;
          row.typeManual = true;
          invalidatePoints();
          syncRowTypeVisual(row);
          markDirty();
          drawChart();
          finish(true);
          toast('已修改点位类型');
        });
      });

      const auto = $('[data-auto]', body);
      if (auto) auto.addEventListener('click', () => {
        row.typeManual = false;
        applyPointType(row, true);
        invalidatePoints();
        syncRowTypeVisual(row);
        markDirty();
        drawChart();
        finish(true);
        toast('已按备注重新识别');
      });
    }
  }).then(finishClean, finishClean);
}

/** 表格里点号颜色跟随类型 */
function syncRowTypeVisual(row) {
  const el = totalUI.rowEls.find(e => e.dataset.id === row.id);
  if (!el) return;
  const input = el.querySelector('.c-no input');
  if (input) paintNoColor(input, row);
}

/* ------------------------------------------------------------
 * 12. 水准测量
 * ---------------------------------------------------------- */
function levelHTML() {
  const ro = ws.readonly;
  const meta = ws.project.meta || {};
  return `
  <div class="ws-scroll">
    <div class="card">
      <div class="card-head">
        <h3 class="card-title">水准测量记录</h3>
        <div class="head-tools">
          <label class="mini-field" title="终点已知高程：留空或与起点相同按闭合处理；填了不同的值按附合处理">
            <span class="mini-field-k">H终</span>
            <input type="text" id="lvEndH" class="mini-input" inputmode="decimal" autocomplete="off"
              value="${escHTML(meta.endH || '')}" placeholder="留空"${ro ? ' disabled' : ''} />
          </label>
          <span class="mini-chip" id="lvMode" title="程序按 H终 与 H始 的关系自动判定">${isLoopLevel(meta) ? '闭合' : '附合'}</span>
          <button type="button" class="mini-btn" id="lvTolBtn"${ro ? ' disabled' : ''}
            title="容许闭合差系数：fh允 = 系数 × √L">容差 ${trimNum(levelTol(meta), 2)}√L</button>
        </div>
      </div>
      <div class="sheet-wrap">
        <table class="sheet sheet--lv">
          <thead>
            <tr>
              <th>测站</th>
              <th>点号</th>
              <th>视距<br/>/m</th>
              <th>后视读数<br/>a/m</th>
              <th>前视读数<br/>b/m</th>
              <th>高差<br/>h/m</th>
              <th>高程<br/>H/m</th>
              <th>备注</th>
              ${ro ? '' : '<th class="th-ops">管理</th>'}
            </tr>
          </thead>
          <tbody id="lvBody"></tbody>
          <tfoot>
            <tr class="foot-sum">
              <td class="name" rowspan="2">检核</td>
              <td class="name">Σ</td>
              <td id="lvSumDist"></td>
              <td id="lvSumA"></td>
              <td id="lvSumB"></td>
              <td id="lvSumH"></td>
              <td></td>
              <td></td>
              ${ro ? '' : '<td class="ops"></td>'}
            </tr>
            <tr class="foot-check">
              <td colspan="${ro ? 7 : 8}" class="foot-check-cell">
                <span class="ck"><i>Σa−Σb =</i><b id="lvSumAB"></b></span>
                <span class="ck-dot"></span>
                <span class="ck"><i>Σh =</i><b id="lvSumH2"></b></span>
                <span class="ck-dot"></span>
                <span class="ck"><i>H终−H始 =</i><b id="lvSumDH"></b></span>
              </td>
            </tr>
          </tfoot>
        </table>
        ${ro ? '' : `<button class="table-add" id="lvAdd">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 6v12M6 12h12"/></svg>
          增加测站
        </button>`}
      </div>
      <p class="check-note" id="lvCheckNote"></p>
    </div>

    <div class="card">
      <div class="card-head">
        <h3 class="card-title">水准测量成果</h3>
        <span class="badge">改正值 mm · 其余 m</span>
      </div>
      <div class="sheet-wrap">
        <table class="sheet sheet--lv sheet--lvres">
          <thead>
            <tr>
              <th>测段<br/>编号</th>
              <th>点号</th>
              <th>测段距离<br/>/m</th>
              <th>测段观测<br/>高差/m</th>
              <th>高差改正<br/>值/mm</th>
              <th>改正后<br/>高差/m</th>
              <th>高程<br/>H/m</th>
              <th>备注</th>
            </tr>
          </thead>
          <tbody id="lvResult"></tbody>
          <tfoot id="lvResultFoot"></tfoot>
        </table>
      </div>
      <div class="check-grid" id="lvChecks"></div>
    </div>
  </div>`;
}

/**
 * 闭合 / 附合：由数据自动判定，不再手动切换
 *   终点高程留空（或填得与起点相同）→ 闭合（终点回到起点）
 *   终点高程与起点不同            → 附合
 */
function isLoopLevel(meta) {
  const endH = Core.num(meta && meta.endH);
  if (endH === null) return true;
  const startH = Core.num(meta && meta.startH);
  if (startH === null) return false;
  return Math.abs(endH - startH) < 0.0005;
}

/** 容许闭合差系数的默认值（如 40 → fh允 = 40√L，L 以 km 计） */
function defaultTol() { return '40'; }

/** 容许闭合差系数：读不出数就按默认 40 */
function levelTol(meta) {
  const v = Core.num(meta && meta.tol);
  return v === null || v <= 0 ? Number(defaultTol()) : v;
}

/** 改容许闭合差系数（新建时填过，这里还能再改） */
function openTolDialog() {
  if (ws.readonly) { toast('只读模式下不能修改'); return; }
  const meta = ws.project.meta || (ws.project.meta = {});
  showModal({
    title: '容许闭合差系数',
    okText: '保存',
    body: `
      <label class="field">
        <span class="field-label">系数 c　（f_h允 = c × √L）</span>
        <input class="text-input" id="tolInput" type="text" inputmode="decimal"
          value="${escHTML(String(levelTol(meta)))}" placeholder="如 40" />
      </label>
      <p class="kw-hint">L 为测段距离合计（km）。等外水准常用 40√L，四等常用 20√L；改完成果表的 f_h允 会立即重算。</p>`,
    noAutoFocus: false
  }).then(ok => {
    if (!ok) return;
    const el = $('#tolInput');
    const v = el ? String(el.value || '').trim() : '';
    const n = Core.num(v);
    if (n === null || n <= 0) {
      toast('系数要填一个大于 0 的数，已保留原值');
      return;
    }
    meta.tol = String(n);
    markDirty();
    buildLevel();
    toast('已更新容许闭合差系数');
  });
}

/**
 * 容许闭合差 fh允 = 系数 × √L，L 为测段距离总和（km）
 * 返回 { L, km, tol, allow }（allow 单位 mm，距离合计为 0 时返回 null）
 * 注：成果表「测段距离」列同一测段的后视距 / 前视距分开显示，
 * 故 L 取该列所有值之和（Σ(后视距 + 前视距)），与记录表 Σ 视距一致。
 */
function levelAllow(rows, meta) {
  const tol = levelTol(meta);
  let sumM = 0, has = false;
  (rows || []).forEach(r => {
    const d = Core.levelDist(r);
    if (d !== null && d > 0) { sumM += d; has = true; }
  });
  if (!has) return { L: 0, km: 0, tol, allow: null };
  const km = sumM / 1000;
  return { L: sumM, km, tol, allow: tol * Math.sqrt(km) };
}

/** 水准点号：只读用户填的，不自动生成（空着就留白） */
function levelPointNames(rows, meta) {
  const stored = Array.isArray(meta && meta.ptNames) ? meta.ptNames : [];
  const out = [];
  for (let i = 0; i <= rows.length; i++) out.push(String(stored[i] == null ? '' : stored[i]).trim());
  return out;
}

function levelPointNotes(rows, meta) {
  const arr = Array.isArray(meta.ptNotes) ? meta.ptNotes : [];
  const out = [];
  for (let i = 0; i <= rows.length; i++) out.push(arr[i] == null ? '' : String(arr[i]));
  return out;
}

/** 参与计算的高程：闭合时终点即起点 */
function levelCalcMeta(meta) {
  return { startH: meta.startH, endH: isLoopLevel(meta) ? meta.startH : meta.endH };
}

function buildLevel() {
  const p = ws.project;
  if (!p.meta) p.meta = {};
  const meta = p.meta;

  const host = $('#wsBody');
  host.innerHTML = levelHTML();

  // 终点已知高程：留空 = 闭合；填了不同的值 = 附合（由数据自动判定，无需切换）
  const endInp = $('#lvEndH');
  if (endInp && !ws.readonly) {
    endInp.addEventListener('input', () => {
      meta.endH = endInp.value;
      markDirty();
      scheduleLevelCalc();
    });
    endInp.addEventListener('blur', () => {
      const v = dec3(endInp.value);
      if (v === endInp.value) return;
      endInp.value = v;
      meta.endH = v;
      markDirty();
      scheduleLevelCalc();
    });
  }

  const tolBtn = $('#lvTolBtn');
  if (tolBtn && !ws.readonly) tolBtn.addEventListener('click', openTolDialog);

  const add = $('#lvAdd');
  if (add) add.addEventListener('click', () => {
    if (ws.readonly) return;
    p.rows.push(makeLevelRow(''));
    markDirty();
    renderLevelRows();
    const scroller = $('.ws-scroll');
    if (scroller) scroller.scrollTop = scroller.scrollHeight;
  });

  renderLevelRows();
}

function renderLevelRows() {
  const body = $('#lvBody');
  if (!body) return;

  const rows = ws.project.rows;
  const meta = ws.project.meta || (ws.project.meta = {});
  const ro = ws.readonly;
  const names = levelPointNames(rows, meta);
  const notes = levelPointNotes(rows, meta);

  // 点号 / 备注落库，保证分析与导出拿到同一份
  if (!Array.isArray(meta.ptNames)) meta.ptNames = [];
  if (!Array.isArray(meta.ptNotes)) meta.ptNotes = [];
  names.forEach((v, k) => { if (meta.ptNames[k] === undefined) meta.ptNames[k] = v; });
  notes.forEach((v, k) => { if (meta.ptNotes[k] === undefined) meta.ptNotes[k] = v; });

  body.innerHTML = '';

  const mkInput = (val, ph, onInput, key, dec) => {
    const inp = document.createElement('input');
    inp.className = 'cell-input';
    inp.type = 'text';
    inp.value = val == null ? '' : (dec ? dec3(val) : val);
    if (ph) inp.placeholder = ph;
    inp.disabled = ro;
    if (key) inp.dataset.k = key;
    inp.addEventListener('input', () => onInput(inp.value));
    // 数字格离焦时补足三位小数（56.1 → 56.100；空着不补）
    if (dec) {
      inp.addEventListener('blur', () => {
        const v = dec3(inp.value);
        if (v === inp.value) return;
        inp.value = v;
        onInput(v);
      });
    }
    return inp;
  };

  // 同一个点会出现在相邻两站（上一站前视 / 下一站后视），改一处要同步另一处
  const pointNameInput = (k) => {
    const inp = mkInput(meta.ptNames[k], '', v => {
      meta.ptNames[k] = v;
      $$(`[data-ptname="${k}"]`).forEach(el => { if (el !== inp) el.value = v; });
      markDirty();
      updateLevel();
    });
    inp.dataset.ptname = String(k);
    return inp;
  };

  const pointNoteInput = (k) => {
    const inp = mkInput(meta.ptNotes[k], '', v => {
      meta.ptNotes[k] = v;
      $$(`[data-ptnote="${k}"]`).forEach(el => { if (el !== inp) el.value = v; });
      markDirty();
      updateLevel();
    });
    inp.dataset.ptnote = String(k);
    return inp;
  };

  const addCell = (tr, cls, rowspan, node) => {
    const td = document.createElement('td');
    if (cls) td.className = cls;
    if (rowspan > 1) td.rowSpan = rowspan;
    if (node) td.appendChild(node);
    tr.appendChild(td);
    return td;
  };

  rows.forEach((row, i) => {
    /* ---------- 后视点行 ---------- */
    const trB = document.createElement('tr');
    trB.className = 'pt-row pt-bs';

    addCell(trB, 'st', 2, mkInput(row.no || '', String(i + 1), v => {
      row.no = v;
      markDirty();
      scheduleLevelCalc();
    }));
    addCell(trB, 'pno', 1, pointNameInput(i));
    addCell(trB, 'dist', 1, mkInput(row.dist || '', '', v => {
      row.dist = v;
      markDirty();
      scheduleLevelCalc();
    }, 'dist', true));
    addCell(trB, 'rd', 1, mkInput(row.bs || '', '', v => {
      row.bs = v;
      markDirty();
      scheduleLevelCalc();
    }, 'bs', true));
    // 后视点行的「前视读数」格：照样可以填（对着手簿抄），只是不参与本站高差
    addCell(trB, 'rd', 1, mkInput(row.bsF || '', '', v => {
      row.bsF = v;
      markDirty();
      scheduleLevelCalc();
    }, 'bsF', true));
    addCell(trB, 'hcalc', 2, null).dataset.h = String(i);

    // 高程：起点由用户填写，其余由程序推算
    const isStart = i === 0;
    const tdH0 = addCell(trB, 'hgt' + (isStart ? ' is-known' : ''), 1, isStart
      ? mkInput(meta.startH || '', '', v => {
        meta.startH = v;
        markDirty();
        scheduleLevelCalc();
      }, '', true)
      : null);
    if (!isStart) tdH0.dataset.hgt = String(i);

    addCell(trB, 'note', 1, pointNoteInput(i));

    if (!ro) {
      const tdOps = addCell(trB, 'ops', 2, null);
      const man = document.createElement('button');
      man.className = 'row-manage';
      man.type = 'button';
      man.textContent = '编辑';
      man.setAttribute('aria-label', `编辑第 ${i + 1} 站，可排序或删除`);
      man.addEventListener('click', () => manageLevelStation(i));
      tdOps.appendChild(man);
    }

    body.appendChild(trB);

    /* ---------- 前视点行 ---------- */
    const trF = document.createElement('tr');
    trF.className = 'pt-row pt-fs';

    addCell(trF, 'pno', 1, pointNameInput(i + 1));
    addCell(trF, 'dist', 1, mkInput(row.fsDist || '', '', v => {
      row.fsDist = v;
      markDirty();
      scheduleLevelCalc();
    }, 'fsDist', true));
    // 前视点行的「后视读数」格：同样允许填写，不参与本站高差
    addCell(trF, 'rd', 1, mkInput(row.fsB || '', '', v => {
      row.fsB = v;
      markDirty();
      scheduleLevelCalc();
    }, 'fsB', true));
    addCell(trF, 'rd', 1, mkInput(row.fs || '', '', v => {
      row.fs = v;
      markDirty();
      scheduleLevelCalc();
    }, 'fs', true));

    // 高程：只有起点是已知输入格，终点已知高程在标题栏「H终」里填，其余由程序推算
    const tdH1 = addCell(trF, 'hgt', 1, null);
    tdH1.dataset.hgt = String(i + 1);

    addCell(trF, 'note', 1, pointNoteInput(i + 1));

    body.appendChild(trF);
  });

  scheduleLevelCalc();
}

/** 测站管理：删除（二次确认） */
/** 水准测站排序：与相邻一站交换（读数、视距、备注整站一起走） */
function moveLevelStation(i, dir) {
  const rows = ws.project.rows;
  const j = i + dir;
  if (j < 0 || j >= rows.length) return false;
  const tmp = rows[i];
  rows[i] = rows[j];
  rows[j] = tmp;
  return true;
}

function manageLevelStation(i) {
  if (ws.readonly) { toast('只读模式下不能修改'); return; }
  const rows = ws.project.rows;
  const row = rows[i];
  if (!row) return;
  const meta = ws.project.meta || (ws.project.meta = {});
  const label = String(row.no || '').trim() || String(i + 1);
  const isFirst = i === 0;
  const isLast = i === rows.length - 1;

  showModal({
    title: `测站 ${label} · 编辑`,
    hideOk: true,
    cancelText: '关闭',
    body: `
      <div class="opt-list">
        <button type="button" class="opt-item" data-act="up"${isFirst ? ' disabled' : ''}>
          <span class="opt-name">上移一站</span>
          <span class="opt-sub">${isFirst ? '已在最前' : '与上一站交换顺序'}</span>
        </button>
        <button type="button" class="opt-item" data-act="down"${isLast ? ' disabled' : ''}>
          <span class="opt-name">下移一站</span>
          <span class="opt-sub">${isLast ? '已在最后' : '与下一站交换顺序'}</span>
        </button>
      </div>
      <div class="opt-list" style="margin-top:10px">
        <button type="button" class="opt-item is-danger" data-act="del">
          <span class="opt-name">删除本测站</span>
          <span class="opt-sub">后视、前视读数与本站点号一并删除</span>
        </button>
      </div>
      <p class="kw-hint">排序只调换测站先后，点号按原顺序保留；删除会再确认一次，确认后不可撤销。</p>`,
    onMount: (body, finish) => {
      ['up', 'down', 'del'].forEach(act => {
        const b = $(`[data-act="${act}"]`, body);
        if (!b || b.disabled) return;
        b.addEventListener('click', () => finish(act));
      });
    }
  }).then(act => {
    if (!act) return;

    if (act === 'up' || act === 'down') {
      if (!moveLevelStation(i, act === 'up' ? -1 : 1)) return;
      markDirty();
      renderLevelRows();
      toast(act === 'up' ? '已上移一站' : '已下移一站');
      return;
    }

    showModal({
      title: '确认删除这一站？',
      body: `<p class="confirm-text">第 <b>${escHTML(label)}</b> 站的后视、前视读数与点号将被删除，成果表也会一并重算。</p>`,
      okText: '删除',
      cancelText: '再想想',
      danger: true
    }).then(ok => {
      if (!ok) return;
      rows.splice(i, 1);
      if (Array.isArray(meta.ptNames) && meta.ptNames.length > i + 1) meta.ptNames.splice(i + 1, 1);
      if (Array.isArray(meta.ptNotes) && meta.ptNotes.length > i + 1) meta.ptNotes.splice(i + 1, 1);
      if (!rows.length) rows.push(makeLevelRow(''));
      markDirty();
      renderLevelRows();
      toast('已删除该测站');
    });
  });
}

/* ------------------------------------------------------------
 * 13. 角度测量（测回法）
 * ---------------------------------------------------------- */

/* ---------- 角度表：按站排序 / 删除单个测回 ---------- */

/** 某个测回所属测站占据的行区间 [s, e] */
function angleStationRange(ri) {
  const rows = ws.project.rows;
  const stNo = rows[ri] && rows[ri].stNo;
  let s = ri, e = ri;
  while (s > 0 && rows[s - 1].stNo === stNo) s--;
  while (e < rows.length - 1 && rows[e + 1].stNo === stNo) e++;
  return { s, e, stNo };
}

/** 重排站号与测回序号：站 1..n，每站测回 1..k */
function renumberAngleStations() {
  const rows = ws.project.rows;
  let st = 0, prev = null, k = 0;
  rows.forEach(r => {
    const old = r.stNo;
    if (old !== prev) { st += 1; prev = old; k = 0; }
    k += 1;
    r.stNo = st;
    r.no = String(k);
  });
}

/** 整站上移 / 下移（该站的所有测回一起走） */
function moveAngleStation(ri, dir) {
  const rows = ws.project.rows;
  const { s, e } = angleStationRange(ri);
  const len = e - s + 1;
  if (dir < 0) {
    if (s === 0) return false;
    let ps = s - 1;
    while (ps > 0 && rows[ps - 1].stNo === rows[s - 1].stNo) ps--;
    const block = rows.splice(s, len);
    rows.splice(ps, 0, ...block);
  } else {
    if (e === rows.length - 1) return false;
    let ne = e + 1;
    while (ne < rows.length - 1 && rows[ne + 1].stNo === rows[e + 1].stNo) ne++;
    const block = rows.splice(s, len);
    rows.splice(ne + 1 - len, 0, ...block);
  }
  renumberAngleStations();
  return true;
}

function manageAngleTurn(ri) {
  if (ws.readonly) { toast('只读模式下不能修改'); return; }
  const rows = ws.project.rows;
  const row = rows[ri];
  if (!row) return;
  const { s, e } = angleStationRange(ri);

  const order = [];
  rows.forEach(r => { if (order.indexOf(r.stNo) < 0) order.push(r.stNo); });
  const stIdx = order.indexOf(row.stNo) + 1;
  const stationLabel = String(row.station || '').trim() || `测站 ${stIdx}`;
  const isFirst = s === 0;
  const isLast = e === rows.length - 1;

  showModal({
    title: `测回 ${row.no || ''} · ${stationLabel} · 编辑`,
    hideOk: true,
    cancelText: '关闭',
    body: `
      <div class="opt-list">
        <button type="button" class="opt-item" data-act="up"${isFirst ? ' disabled' : ''}>
          <span class="opt-name">测站上移</span>
          <span class="opt-sub">${isFirst ? '已在最前' : `把「${escHTML(stationLabel)}」整站移到上一站前面`}</span>
        </button>
        <button type="button" class="opt-item" data-act="down"${isLast ? ' disabled' : ''}>
          <span class="opt-name">测站下移</span>
          <span class="opt-sub">${isLast ? '已在最后' : `把「${escHTML(stationLabel)}」整站移到下一站后面`}</span>
        </button>
      </div>
      <div class="opt-list" style="margin-top:10px">
        <button type="button" class="opt-item is-danger" data-act="del">
          <span class="opt-name">删除本测回</span>
          <span class="opt-sub">只删这一测回（4 行读数），同站其他测回保留</span>
        </button>
      </div>
      <p class="kw-hint">排序按测站整站移动，站号与测回数会自动重排；删除会再确认一次。</p>`,
    onMount: (body, finish) => {
      ['up', 'down', 'del'].forEach(act => {
        const b = $(`[data-act="${act}"]`, body);
        if (!b || b.disabled) return;
        b.addEventListener('click', () => finish(act));
      });
    }
  }).then(act => {
    if (!act) return;

    if (act === 'up' || act === 'down') {
      if (!moveAngleStation(ri, act === 'up' ? -1 : 1)) return;
      markDirty();
      renderAngleRows();
      toast(act === 'up' ? '测站已上移' : '测站已下移');
      return;
    }

    showModal({
      title: '确认删除这一测回？',
      body: `<p class="confirm-text">「<b>${escHTML(stationLabel)}</b>」第 <b>${escHTML(String(row.no || ''))}</b> 测回的四行读数将被删除；同站其他测回与平均角值会自动重算。</p>`,
      okText: '删除',
      cancelText: '再想想',
      danger: true
    }).then(ok => {
      if (!ok) return;
      rows.splice(ri, 1);
      if (!rows.length) rows.push(makeAngleRow('1'));
      renumberAngleStations();
      markDirty();
      renderAngleRows();
      toast('已删除该测回');
    });
  });
}

function scheduleLevelCalc() {
  if (ws.dataRaf) return;
  ws.dataRaf = requestAnimationFrame(() => {
    ws.dataRaf = 0;
    if (ws.kind === 'level') updateLevel();
  });
}

function updateLevel() {
  const rows = ws.project.rows;
  const meta = ws.project.meta || {};
  const calcMeta = levelCalcMeta(meta);
  const lv = Core.computeLevel(rows, calcMeta);
  const res = Core.computeLevelResult(rows, calcMeta, lv);
  const names = levelPointNames(rows, meta);
  const notes = levelPointNotes(rows, meta);
  const root = $('#wsBody') || document.body;

  const setText = (el, v, neg) => {
    if (!el) return;
    el.textContent = v == null ? '' : v;
    if (neg !== undefined) el.classList.toggle('neg', !!neg);
  };

  // 数据表：高差与推算高程
  $$('[data-h]', root).forEach(el => {
    const r = lv.rows[+el.dataset.h];
    setText(el, r && r.h !== null ? m3s(r.h) : '', r && r.h !== null && r.h < 0);
  });
  $$('[data-hgt]', root).forEach(el => {
    const k = +el.dataset.hgt;
    const H = k === 0 ? lv.startH : (lv.rows[k - 1] ? lv.rows[k - 1].H : null);
    setText(el, H === null || H === undefined ? '' : m3(H), H !== null && H < 0);
  });

  // 检核行
  const sv = lv.sum;

  // 闭合 / 附合：跟着 H终 的值自动变，不提供手动切换
  const modeEl = $('#lvMode');
  if (modeEl) {
    const loopNow = isLoopLevel(meta);
    if (modeEl.textContent !== (loopNow ? '闭合' : '附合')) modeEl.textContent = loopNow ? '闭合' : '附合';
    modeEl.classList.toggle('is-acc', !loopNow);
  }
  const setTxt = (id, v, neg) => setText(document.getElementById(id), v, neg);
  setTxt('lvSumA', sv.a === null ? '' : m3(sv.a));
  setTxt('lvSumB', sv.b === null ? '' : m3(sv.b));
  setTxt('lvSumAB', sv.aMinusB === null ? '' : m3s(sv.aMinusB), sv.aMinusB !== null && sv.aMinusB < 0);
  setTxt('lvSumH', sv.h === null ? '' : m3s(sv.h), sv.h !== null && sv.h < 0);
  setTxt('lvSumH2', sv.h === null ? '' : m3s(sv.h), sv.h !== null && sv.h < 0);
  // H终−H始：取高程 H 列「测站行」内的第一个值与最后一个值（非检核行）
  {
    const firstH = lv.startH;
    let lastH = null;
    for (let i = lv.rows.length - 1; i >= 0; i--) {
      const H = lv.rows[i] && lv.rows[i].H;
      if (H !== null && H !== undefined) { lastH = H; break; }
    }
    const dh = (firstH !== null && firstH !== undefined && lastH !== null && lastH !== undefined)
      ? (lastH - firstH) : null;
    setTxt('lvSumDH', dh === null ? '' : m3s(dh), dh !== null && dh < 0);
  }

  let sumDist = 0, hasDist = false;
  rows.forEach(r => {
    const d = Core.levelDist ? Core.levelDist(r) : Core.num(r.dist);
    if (d !== null && d > 0) { sumDist += d; hasDist = true; }
  });
  setTxt('lvSumDist', hasDist ? m3(sumDist) : '');

  // 成果表
  const rbody = $('#lvResult');
  if (rbody) {
    let html = '';
    res.rows.forEach((r, i) => {
      const hNeg = r.h !== null && r.h < 0;
      const vNeg = r.v !== null && r.v < 0;
      const adjNeg = r.hAdj !== null && r.hAdj < 0;
      const Hstart = i === 0 ? lv.startH : (res.rows[i - 1] ? res.rows[i - 1].H : null);
      const Hend = r.H;
      // 测段距离：同一测段的后视距 / 前视距可能不同，分开显示、不再合并
      const bsDist = Core.num(rows[i] && rows[i].dist);
      const fsDist = Core.num(rows[i] && rows[i].fsDist);

      html += `<tr class="pt-row pt-bs">
        <td class="st" rowspan="2">${escHTML(String(rows[i] && rows[i].no ? rows[i].no : i + 1))}</td>
        <td class="pno">${escHTML(names[i] || '')}</td>
        <td class="dist">${bsDist === null ? '' : m3(bsDist)}</td>
        <td class="hcalc${hNeg ? ' neg' : ''}" rowspan="2">${r.h === null ? '' : m3s(r.h)}</td>
        <td class="calc${vNeg ? ' neg' : ''}" rowspan="2">${r.v === null ? '' : mm1(r.v)}</td>
        <td class="hcalc${adjNeg ? ' neg' : ''}" rowspan="2">${r.hAdj === null ? '' : m3s(r.hAdj)}</td>
        <td class="hgt">${Hstart === null || Hstart === undefined ? '' : m3(Hstart)}</td>
        <td class="note">${escHTML(notes[i] || '')}</td>
      </tr>
      <tr class="pt-row pt-fs">
        <td class="pno">${escHTML(names[i + 1] || '')}</td>
        <td class="dist">${fsDist === null ? '' : m3(fsDist)}</td>
        <td class="hgt">${Hend === null || Hend === undefined ? '' : m3(Hend)}</td>
        <td class="note">${escHTML(notes[i + 1] || '')}</td>
      </tr>`;
    });
    rbody.innerHTML = html;
  }

  // 成果表检核行：f_h 与 f_h允 都算出来（f_h允 = 容许闭合差系数 × √L，L 为测段距离合计 km）
  const rfoot = $('#lvResultFoot');
  if (rfoot) {
    // 成果表「测段距离」列同一测段的后视距 / 前视距分开显示，故 Σ 取该列所有值之和，
    // 即 Σ(后视距 + 前视距)，与记录表的视距总和一致。
    let sumD = 0, hasD = false;
    rows.forEach(r => {
      const d = Core.levelDist(r);
      if (d !== null && d > 0) { sumD += d; hasD = true; }
    });
    const hasData = sv.h !== null;
    const clamp0 = v => (v !== null && Math.abs(v) < 0.0005 ? 0 : v);
    const fh = sv.closure === null ? '' : mm1(sv.closure * 1000) + ' mm';
    const over = sv.closure !== null && Math.abs(sv.closure) > 0.0005;

    const allowInfo = levelAllow(rows, meta);
    const allowTxt = allowInfo.allow === null ? '' : mm1(allowInfo.allow) + ' mm';
    const allowOver = allowInfo.allow !== null && sv.closure !== null
      && Math.abs(sv.closure * 1000) > allowInfo.allow + 0.05;
    const allowNote = allowInfo.allow === null ? '' : `（${trimNum(allowInfo.tol, 2)}√L，L = ${trimNum(allowInfo.km, 4)} km）`;

    rfoot.innerHTML = `<tr class="foot-sum">
        <td class="name" rowspan="2">检核</td>
        <td class="name">Σ</td>
        <td>${hasD ? m3(sumD) : ''}</td>
        <td class="${sv.h !== null && sv.h < 0 ? 'neg' : ''}">${sv.h === null ? '' : m3s(sv.h)}</td>
        <td>${hasData ? mm1(res.sum.v) : ''}</td>
        <td>${res.sum.hAdj === null ? '' : m3s(clamp0(res.sum.hAdj))}</td>
        <td></td>
        <td></td>
      </tr>
      <tr class="foot-check">
        <td colspan="7" class="foot-check-cell">
          <span class="ck"><i>f_h =</i><b${over ? ' class="neg"' : ''}>${escHTML(fh)}</b></span>
          <span class="ck-dot"></span>
          <span class="ck"><i>f_h允 =</i><b${allowOver ? ' class="neg"' : ''}>${escHTML(allowTxt)}</b></span>
          ${allowNote ? `<span class="ck-note">${escHTML(allowNote)}</span>` : ''}
        </td>
      </tr>`;
  }

  // 概览指标
  const box = $('#lvChecks');
  if (box) {
    const fh = sv.closure === null ? '' : mm1(sv.closure * 1000) + ' mm';
    const warn = sv.closure !== null && Math.abs(sv.closure) > 0.0005;
    box.innerHTML = `
      <div class="check-item${warn ? ' is-warn' : ''}">
        <span class="check-k">闭合差 fh</span>
        <span class="check-v">${escHTML(fh) || '—'}</span>
      </div>
      <div class="check-item">
        <span class="check-k">有效测站数</span>
        <span class="check-v">${lv.count.h} 站</span>
      </div>`;
  }

  const note = $('#lvCheckNote');
  if (note) {
    const stName = (r, i) => String(r.no || '').trim() || String(i + 1);
    const halfFilled = [];
    const offSide = [];
    rows.forEach((r, i) => {
      const a = Core.num(r.bs), b = Core.num(r.fs);
      if ((a === null) !== (b === null)) halfFilled.push(stName(r, i));
      if (String(r.bsF || '').trim() || String(r.fsB || '').trim()) offSide.push(stName(r, i));
    });

    let msg;
    const loopMode = isLoopLevel(meta);
    if (lv.sum.closure === null) {
      msg = loopMode
        ? '填好<b>起点高程</b>与各站读数后，程序自动算出高差、闭合差，并按距离比例反号分配改正数。'
        : '填好<b>起点、终点已知高程</b>与各站读数后，程序自动算出高差、闭合差，并按距离比例反号分配改正数。';
    } else {
      const ok = Math.abs(lv.sum.closure) <= 0.0005;
      const modeTxt = loopMode ? '闭合水准' : '附合水准';
      msg = ok
        ? `${modeTxt}：闭合差为 0，成果可直接使用。`
        : `${modeTxt}：闭合差 <b>${mm1(lv.sum.closure * 1000)} mm</b>，成果表已按距离比例反号分配改正数。`;
    }
    if (halfFilled.length) {
      msg += `<br/>第 <b>${escHTML(halfFilled.join('、'))}</b> 站只填了后视或前视读数，高差暂未计算。`;
    }
    if (offSide.length) {
      msg += `<br/>第 <b>${escHTML(offSide.join('、'))}</b> 站的读数填在了不对应的列（后视点的前视读数 / 前视点的后视读数），只留档、未参与计算。`;
    }
    const bothDist = rows.some(r => Core.num(r.dist) !== null && Core.num(r.fsDist) !== null);
    if (bothDist) {
      msg += '<br/>Σ 视距 = 各站后视距 + 前视距之和；成果表的<b>测段距离</b>按后视距 / 前视距分开显示，其总和与 Σ 视距一致。';
    }
    note.innerHTML = msg;
  }
}

function angleHTML() {
  const ro = ws.readonly;
  return `
  <div class="ws-scroll">
    <div class="card">
      <div class="card-head">
        <h3 class="card-title">角度测量记录</h3>
        <span class="badge">测回法 · 每测站可多个测回</span>
      </div>
      <div class="sheet-wrap">
        <table class="sheet sheet--ag">
          <thead>
            <tr>
              <th rowspan="2">测站</th>
              <th rowspan="2">测回数</th>
              <th rowspan="2">竖盘<br/>位置</th>
              <th rowspan="2">目标</th>
              <th colspan="3">水平度盘读数</th>
              <th rowspan="2">半测回<br/>角值</th>
              <th rowspan="2">角度之差</th>
              <th rowspan="2">一测回<br/>角值</th>
              <th rowspan="2">角度之差</th>
              <th rowspan="2">各测回<br/>平均角值</th>
              ${ro ? '' : '<th rowspan="2" class="th-ops">管理</th>'}
            </tr>
            <tr>
              <th>°</th><th>′</th><th>″</th>
            </tr>
          </thead>
          <tbody id="agBody"></tbody>
        </table>
        ${ro ? '' : `<div class="table-add-row">
        <button class="table-add" id="agAdd">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 6v12M6 12h12"/></svg>
          增加测回
        </button>
        <button class="table-add" id="agAddStation">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 6v12M6 12h12"/></svg>
          增加测站
        </button>
        </div>`}
      </div>
    </div>

    <div class="card">
      <p class="check-note" id="agNote" style="margin:0;padding:0 16px 14px"></p>
    </div>
  </div>`;
}

/** 角度值 → 度 / 分 / 秒 三格 */
function angleToParts(v) {
  const deg = Core.parseAngle(v);
  if (deg === null) return { d: '', m: '', s: '' };
  const totalSec = Math.round(Math.abs(deg) * 36000) / 10;   // 保留 0.1″
  const d = Math.floor(totalSec / 3600);
  const rest = totalSec - d * 3600;
  const m = Math.floor(rest / 60);
  const s = Math.round((rest - m * 60) * 10) / 10;
  return {
    d: String(d),
    m: String(m),
    s: String(s % 1 === 0 ? s : s.toFixed(1))
  };
}

function joinAngleParts(p) {
  const seg = ['d', 'm', 's']
    .map(k => String(p[k] == null ? '' : p[k]).trim())
    .filter(v => v !== '');
  return seg.join(' ');
}

function buildAngle() {
  const host = $('#wsBody');
  host.innerHTML = angleHTML();

  const add = $('#agAdd');
  if (add) add.addEventListener('click', () => {
    if (ws.readonly) return;
    const rows = ws.project.rows;
    const last = rows[rows.length - 1];
    const row = makeAngleRow(String(rows.length + 1));
    row.station = last ? String(last.station || '') : '';
    row.stNo = last ? (last.stNo || 1) : 1;   // 同一站再加一个测回
    rows.push(row);
    markDirty();
    renderAngleRows();
  });

  const addStation = $('#agAddStation');
  if (addStation) addStation.addEventListener('click', () => {
    if (ws.readonly) return;
    const rows = ws.project.rows;
    const maxNo = rows.reduce((m, r) => Math.max(m, Number(r.stNo) || 1), 0);
    const row = makeAngleRow(String(rows.length + 1));
    row.station = '';
    row.stNo = maxNo + 1;                     // 新的一站
    rows.push(row);
    markDirty();
    renderAngleRows();
  });

  renderAngleRows();
}

function renderAngleRows() {
  const body = $('#agBody');
  if (!body) return;

  const rows = ws.project.rows;
  const ro = ws.readonly;

  // 测站分组：按测站号分块（「增加测站」才开新站，同一站可以多个测回）
  const groups = [];
  rows.forEach((r, i) => {
    const no = Number(r.stNo) || 1;
    const last = groups[groups.length - 1];
    if (last && last.stNo === no) last.items.push(i);
    else groups.push({ stNo: no, station: String(r.station == null ? '' : r.station), items: [i] });
  });

  body.innerHTML = '';

  const mkReadInput = (row, key, part) => {
    const inp = document.createElement('input');
    inp.className = 'cell-input is-angle';
    inp.type = 'text';
    inp.inputMode = 'numeric';
    inp.value = angleToParts(row[key])[part];
    inp.disabled = ro;
    inp.dataset.k = key;
    inp.dataset.part = part;
    inp.addEventListener('input', () => {
      const p = angleToParts(row[key]);
      p[part] = inp.value;
      row[key] = joinAngleParts(p);
      markDirty();
      scheduleAngleCalc();
    });
    return inp;
  };

  const stationInput = (g) => {
    const inp = document.createElement('input');
    inp.className = 'cell-input';
    inp.type = 'text';
    inp.value = g.station;
    inp.placeholder = '测站';
    inp.disabled = ro;
    inp.addEventListener('input', () => {
      g.station = inp.value;
      g.items.forEach(k => { rows[k].station = inp.value; });
      markDirty();
      updateAngle();
    });
    return inp;
  };

  groups.forEach(g => {
    const groupRows = g.items.length * 4;   // 每测回 4 行：左 A / 左 B / 右 A / 右 B

    g.items.forEach((ri, pos) => {
      const row = rows[ri];
      const trs = [];

      const makeRow = (cls) => {
        const tr = document.createElement('tr');
        tr.className = 'pt-row ' + cls;
        trs.push(tr);
        return tr;
      };

      const cell = (tr, cls, rowspan, node) => {
        const td = document.createElement('td');
        if (cls) td.className = cls;
        if (rowspan > 1) td.rowSpan = rowspan;
        if (node) td.appendChild(node);
        tr.appendChild(td);
        return td;
      };

      /* 左盘：A、B */
      const trLA = makeRow('pt-bs');
      // 测站格：整站一格，站内各测回共用
      if (pos === 0) cell(trLA, 'st', groupRows, stationInput(g));
      cell(trLA, 'turn', 4, document.createTextNode(String(pos + 1)));
      cell(trLA, 'face', 2, document.createTextNode('左'));
      cell(trLA, 'target', 1, document.createTextNode('A'));
      cell(trLA, 'rd', 1, mkReadInput(row, 'aL', 'd'));
      cell(trLA, 'rd', 1, mkReadInput(row, 'aL', 'm'));
      cell(trLA, 'rd', 1, mkReadInput(row, 'aL', 's'));
      cell(trLA, 'calc', 2, null).dataset.half = ri + ':L';
      // 角度之差（半测回较差）/ 一测回角值：同一测回内合并（跨左右盘 4 行）
      cell(trLA, 'calc', 4, null).dataset.gap = String(ri);
      cell(trLA, 'calc', 4, null).dataset.one = String(ri);
      // 角度之差（测回间较差）/ 各测回平均角值：同一测站内合并（跨整站）
      if (pos === 0) {
        cell(trLA, 'calc', groupRows, null).dataset.gap2 = String(ri);
        cell(trLA, 'calc', groupRows, null).dataset.avg = String(ri);
      }
      if (!ro) {
        const tdOps = cell(trLA, 'ops', 4, null);
        const man = document.createElement('button');
        man.className = 'row-manage';
        man.type = 'button';
        man.textContent = '编辑';
        man.setAttribute('aria-label', '编辑本测回，可排序或删除');
        man.addEventListener('click', () => manageAngleTurn(ri));
        tdOps.appendChild(man);
      }

      const trLB = makeRow('pt-fs');
      cell(trLB, 'target', 1, document.createTextNode('B'));
      cell(trLB, 'rd', 1, mkReadInput(row, 'bL', 'd'));
      cell(trLB, 'rd', 1, mkReadInput(row, 'bL', 'm'));
      cell(trLB, 'rd', 1, mkReadInput(row, 'bL', 's'));

      /* 右盘：A、B */
      const trRA = makeRow('pt-bs');
      cell(trRA, 'face', 2, document.createTextNode('右'));
      cell(trRA, 'target', 1, document.createTextNode('A'));
      cell(trRA, 'rd', 1, mkReadInput(row, 'aR', 'd'));
      cell(trRA, 'rd', 1, mkReadInput(row, 'aR', 'm'));
      cell(trRA, 'rd', 1, mkReadInput(row, 'aR', 's'));
      cell(trRA, 'calc', 2, null).dataset.half = ri + ':R';

      const trRB = makeRow('pt-fs');
      cell(trRB, 'target', 1, document.createTextNode('B'));
      cell(trRB, 'rd', 1, mkReadInput(row, 'bR', 'd'));
      cell(trRB, 'rd', 1, mkReadInput(row, 'bR', 'm'));
      cell(trRB, 'rd', 1, mkReadInput(row, 'bR', 's'));

      trs.forEach(tr => body.appendChild(tr));
    });
  });

  scheduleAngleCalc();
}

function scheduleAngleCalc() {
  if (ws.dataRaf) return;
  ws.dataRaf = requestAnimationFrame(() => {
    ws.dataRaf = 0;
    if (ws.kind === 'angle') updateAngle();
  });
}

function updateAngle() {
  const rows = ws.project.rows;
  const ag = Core.computeAngle(rows);
  const root = $('#wsBody') || document.body;

  const fmt = v => (v === null || v === undefined) ? '' : Core.formatAngle(v, 0);

  $$('[data-half]', root).forEach(el => {
    const [i, side] = el.dataset.half.split(':');
    const r = ag.rows[+i];
    el.textContent = r ? fmt(side === 'L' ? r.beL : r.beR) : '';
  });

  $$('[data-gap]', root).forEach(el => {
    const r = ag.rows[+el.dataset.gap];
    if (!r || r.halfDiff === null) { el.textContent = ''; el.classList.remove('neg'); return; }
    el.textContent = (r.halfDiff > 0 ? '+' : '') + r.halfDiff + '″';
    el.classList.toggle('neg', Math.abs(r.halfDiff) > ag.check.halfLimit);
  });

  $$('[data-one]', root).forEach(el => {
    const r = ag.rows[+el.dataset.one];
    el.textContent = r ? fmt(r.one) : '';
  });

  $$('[data-gap2]', root).forEach(el => {
    const ri = +el.dataset.gap2;
    const r = ag.rows[ri];
    if (!r) { el.textContent = ''; el.classList.remove('neg'); return; }
    // 同一测站合并成一格：显示该站测回间较差的最大值（绝对值最大、保留符号）
    const stNo = r.stNo;
    let best = null;
    ag.rows.forEach(x => {
      if (x.stNo === stNo && x.gap !== null) {
        if (best === null || Math.abs(x.gap) > Math.abs(best)) best = x.gap;
      }
    });
    if (best === null) { el.textContent = ''; el.classList.remove('neg'); return; }
    el.textContent = (best > 0 ? '+' : '') + best + '″';
    el.classList.toggle('neg', Math.abs(best) > ag.check.gapLimit);
  });

  $$('[data-avg]', root).forEach(el => {
    const r = ag.rows[+el.dataset.avg];
    el.textContent = r ? fmt(r.avg) : '';
  });

  const note = $('#agNote');
  if (note) {
    if (!ag.valid) {
      note.innerHTML = '填完 A、B 两个目标的盘左与盘右读数后，程序自动算出半测回角值、一测回角值与各测回平均角值。';
    } else {
      const half = ag.check.maxHalf;
      const gap = ag.check.maxGap;
      const okHalf = half <= ag.check.halfLimit;
      const okGap = gap <= ag.check.gapLimit;
      note.innerHTML = `半测回较差最大 <b>${half}″</b>（限差 ±${ag.check.halfLimit}″，${okHalf ? '合格' : '超限'}）；
        测回间较差最大 <b>${gap}″</b>（限差 ±${ag.check.gapLimit}″，${okGap ? '合格' : '超限'}）。`;
    }
  }
}

/* ------------------------------------------------------------
 * 14. 程序设置页
 * ---------------------------------------------------------- */
function renderSettings() {
  const box = $('#typeList');
  if (!box) return;

  if (!settings.pointTypes.length) {
    settings.pointTypes = DEFAULT_TYPES.map(t => ({ ...t }));
    saveSettings();
  }
  ensureSingleDefault();

  box.innerHTML = settings.pointTypes.map(t => `
    <div class="type-row" data-id="${escHTML(t.id)}">
      <span class="type-swatch" style="background:${escHTML(t.color)}"></span>
      <div class="type-main">
        <p class="type-name">
          ${escHTML(t.name)}
          ${t.isDefault ? '<span class="tag-dflt">默认</span>' : ''}
        </p>
        <p class="type-kw">关键词：${(t.keywords || []).length ? escHTML((t.keywords || []).join(' / ')) : '（未设置）'}</p>
      </div>
      <div class="type-ops">
        <button class="op-btn" data-edit="${escHTML(t.id)}">修改</button>
        <button class="op-btn is-danger" data-del="${escHTML(t.id)}">删除</button>
      </div>
    </div>`).join('');

  $$('[data-edit]', box).forEach(b => b.addEventListener('click', () => editType(b.dataset.edit)));
  $$('[data-del]', box).forEach(b => b.addEventListener('click', () => removeType(b.dataset.del)));
}

async function editType(id) {
  const isNew = !id;
  const t = isNew
    ? { id: uid('t'), name: '', color: COLOR_PRESET[0], keywords: [] }
    : { ...typeById(id), keywords: [...(typeById(id).keywords || [])] };
  if (!t) return;

  let color = t.color;
  // 默认点只能有一个：这里只是「把本类型设为默认」的开关，
  // 保存时由 setDefaultType 把其他类型的默认标记清掉
  let asDefault = !!t.isDefault;

  const ok = await showModal({
    title: isNew ? '新建点位类型' : '修改点位类型',
    okText: '保存',
    body: `
      <label class="field">
        <span class="field-label">类型名称</span>
        <input class="text-input" id="typeName" type="text" maxlength="12" value="${escHTML(t.name)}" placeholder="如 控制点" />
      </label>
      <p class="field-label" style="margin-top:16px">显示颜色</p>
      <div class="color-grid" id="typeColors">
        ${COLOR_PRESET.map(c => `<button type="button" class="color-dot${c === color ? ' is-on' : ''}" data-color="${c}" style="background:${c}"></button>`).join('')}
      </div>
      <label class="field" style="margin-top:16px; display:block">
        <span class="field-label">关键词（用空格或逗号分隔）</span>
        <input class="text-input" id="typeKw" type="text" value="${escHTML((t.keywords || []).join(' '))}" placeholder="如 控制 导线点 已知点" />
      </label>
      <p class="kw-hint">备注中出现任一关键词时，该点自动归为此类；同时命中多个类型时不自动分类。</p>
      <div class="opt-list" style="margin-top:14px">
        <button type="button" class="opt-item opt-item--pick${asDefault ? ' is-on' : ''}${t.isDefault ? ' is-locked' : ''}" data-dflt="1">
          <span class="opt-mark" aria-hidden="true"></span>
          <span class="opt-name">选择该点为默认点</span>
          <span class="opt-sub">${t.isDefault ? '当前默认点' : '新建点位默认用这个类型'}</span>
        </button>
      </div>
      <p class="kw-hint">默认点只能有一个：设了新的默认点，原来的会自动取消。</p>`,
    onMount: (body) => {
      $$('[data-color]', body).forEach(b => {
        b.addEventListener('click', () => {
          color = b.dataset.color;
          $$('[data-color]', body).forEach(x => x.classList.toggle('is-on', x === b));
        });
      });
      const d = $('[data-dflt]', body);
      if (d && !d.classList.contains('is-locked')) {
        d.addEventListener('click', () => {
          asDefault = !asDefault;
          d.classList.toggle('is-on', asDefault);
          const sub = $('.opt-sub', d);
          if (sub) sub.textContent = asDefault ? '保存后成为默认点' : '新建点位默认用这个类型';
        });
      }
    }
  });
  if (!ok) return;

  const nameEl = $('#typeName');
  const name = (nameEl ? nameEl.value : '').trim();
  if (!name) { toast('类型名称不能为空'); return; }

  const kwEl = $('#typeKw');
  const kws = (kwEl ? kwEl.value : '')
    .split(/[\s,，、;；]+/)
    .map(s => s.trim())
    .filter(Boolean);

  if (isNew) {
    settings.pointTypes.push({ id: t.id, name, color, keywords: kws });
  } else {
    const target = typeById(id);
    if (!target) return;
    target.name = name;
    target.color = color;
    target.keywords = kws;
  }
  if (asDefault) setDefaultType(t.id);

  saveSettings();
  renderSettings();
  toast(asDefault ? '已保存，并设为默认点' : (isNew ? '已新建类型' : '已保存'));
}

async function removeType(id) {
  const t = typeById(id);
  if (!t) return;

  if (settings.pointTypes.length <= 1) { toast('至少保留一个点位类型'); return; }

  const ok = await showModal({
    title: '删除点位类型',
    body: `确定删除「<b>${escHTML(t.name)}</b>」吗？<br/>
      ${t.isDefault ? '它是默认类型，删除后程序会把第一个类型作为默认。' : ''}
      已有工作中属于该类型的点，会回到默认类型。`,
    okText: '删除',
    danger: true
  });
  if (!ok) return;

  settings.pointTypes = settings.pointTypes.filter(x => x.id !== id);
  ensureSingleDefault();

  saveSettings();
  renderSettings();
  toast('已删除类型');
}

/* ------------------------------------------------------------
 * 15. 数据分析：图表、图片、CSV 与智能纸图
 * ---------------------------------------------------------- */
const expUI = { id: '', kind: 'all', paperW: 20, paperH: 15 };

const ICON_IMAGE = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
  <rect x="3.2" y="4.4" width="17.6" height="15.2" rx="2.4"/><circle cx="8.6" cy="9.6" r="1.7"/>
  <path d="m4.6 17.6 4.8-4.4 3.2 2.8 2.8-2.4 3.6 3.6"/></svg>`;

const ICON_TABLE = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
  <rect x="3.4" y="4.6" width="17.2" height="14.8" rx="2.2"/><path d="M3.6 9.6h16.8M3.6 14.4h16.8M9.6 9.7v9.6"/></svg>`;

const ICON_PAPER = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
  <rect x="3.6" y="3.6" width="16.8" height="16.8" rx="2"/><path d="M3.6 9.6h16.8M9.6 3.6v16.8"/>
  <path d="M13.4 20 20 13.4"/></svg>`;

const SVG_FONT = '"Microsoft YaHei", "PingFang SC", "Noto Sans SC", "Heiti SC", sans-serif';

/* ---------- 小工具 ---------- */
/** 去掉多余小数零：2.000 → 2，0.600 → 0.6 */
function trimNum(v, d = 3) {
  if (v == null || !Number.isFinite(v)) return '—';
  let s = Number(v).toFixed(d);
  if (s.indexOf('.') >= 0) s = s.replace(/0+$/, '').replace(/\.$/, '');
  return s === '-0' ? '0' : s;
}

/** 把任意「米 / 厘米」换算比，向上取到一个好看的整数（1、1.2、1.5、2、2.5…×10ⁿ） */
function niceScale(v) {
  if (!(v > 0)) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / mag;
  const list = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];
  const m = list.find(s => n <= s + 1e-9) || 10;
  return Number((m * mag).toPrecision(6));
}

function linkColorName(v) {
  const c = LINK_COLORS.find(x => x.value === (v || LINK_COLORS[0].value));
  return c ? c.name : '自定义';
}

/* ---------- 页面骨架 ---------- */
/** 数据分析列表页：只列工作，点开才进该工作的详情页 */
function renderExport() {
  const box = $('#expList');
  const kindBar = $('#expKindBar');
  const hint = $('#expPickHint');
  if (!box) return;

  // 列表页不展示任何工作数据：清掉上一份工作的分析结果
  const rep = $('#expReport');
  if (rep) rep.innerHTML = '';

  const all = Store.list();
  const kindOf = m => m.kind || 'total';

  if (!all.length) {
    if (kindBar) kindBar.innerHTML = '';
    if (hint) hint.textContent = '';
    box.innerHTML = `
      <div class="card exp-empty">
        <p class="empty-title">还没有可分析的工作</p>
        <p class="empty-sub">先新建一份工作并录入数据，<br/>再回到这里看图、出表与出图。</p>
        <button class="btn btn-primary" data-nav="new">新建工作</button>
      </div>`;
    return;
  }

  const countOf = k => all.filter(m => kindOf(m) === k).length;

  // 选中的类型已被清空（工作被删或改了类型）→ 回到全部，避免停在空分类上
  if (expUI.kind !== 'all' && !countOf(expUI.kind)) expUI.kind = 'all';

  if (kindBar) {
    kindBar.innerHTML =
      `<button class="filter-chip${expUI.kind === 'all' ? ' is-on' : ''}" data-ekind="all">全部<span class="chip-n">${all.length}</span></button>` +
      ['total', 'level', 'angle'].map(k => {
        const n = countOf(k);
        return `<button class="filter-chip${expUI.kind === k ? ' is-on' : ''}${n ? '' : ' is-zero'}" data-ekind="${k}">` +
          `${KINDS[k].short}<span class="chip-n">${n}</span></button>`;
      }).join('');
  }

  const list = expUI.kind === 'all' ? all : all.filter(m => kindOf(m) === expUI.kind);

  if (hint) {
    hint.textContent = expUI.kind === 'all'
      ? `共 ${all.length} 个工作`
      : `${KINDS[expUI.kind].name} · ${list.length} 个工作`;
  }

  if (!list.length) {
    box.innerHTML = `
      <div class="card exp-empty">
        <p class="empty-title">「${KINDS[expUI.kind].name}」还没有工作存档</p>
        <p class="empty-sub">可以切回「全部」看看其他类型，<br/>或者直接新建一份${KINDS[expUI.kind].name}工作。</p>
        <div class="exp-empty-ops">
          <button class="btn btn-ghost" data-ekind="all">查看全部类型</button>
          <button class="btn btn-primary" data-nav="new" data-kind="${expUI.kind}">新建${KINDS[expUI.kind].short}工作</button>
        </div>
      </div>`;
    return;
  }

  // 按类型分组列出（全部）或单组列出
  const group = k => list.filter(m => kindOf(m) === k);
  const groups = expUI.kind === 'all'
    ? ['total', 'level', 'angle'].filter(k => group(k).length).map(k => ({ k, items: group(k) }))
    : [{ k: expUI.kind, items: list }];

  const itemHTML = m => {
    return `<button class="exp-item" data-exp="${escHTML(m.id)}">
      <span class="exp-item-main">
        <span class="exp-item-name">${escHTML(m.name || '未命名工作')}</span>
        <span class="exp-item-sub">${escHTML(workBrief(m))} · 更新 ${escHTML(fmtTime(m.updatedAt))}</span>
      </span>
      <span class="row-link-caret" aria-hidden="true">›</span>
    </button>`;
  };

  box.innerHTML = `<div class="card exp-groups">${groups.map(g => `
    <div class="exp-group">
      <div class="exp-group-head">
        <span class="exp-group-title">${escHTML(KINDS[g.k].name)}</span>
        <span class="exp-group-n">${g.items.length} 个</span>
      </div>
      <div class="exp-group-list">${g.items.map(itemHTML).join('')}</div>
    </div>`).join('')}</div>`;
}

/** 列表里的一行说明：几站 / 几测回 / 几个点 */
function workBrief(m) {
  const k = m.kind || 'total';
  const n = Number(m.count) || 0;
  if (k === 'level') return `${n} 个测站`;
  if (k === 'angle') return `${n} 个测回`;
  return `${n} 个点位`;
}

/** 单份工作的数据分析详情页 */
function renderAnalysis(id) {
  const p = id ? Store.get(id) : null;
  if (!p) {
    navigate('export');
    return;
  }
  expUI.id = id;
  const titleEl = $('#expTitle');
  if (titleEl) titleEl.textContent = p.name || '数据分析';
  renderExportReport(id);
}

function renderExportReport(id) {
  const box = $('#expReport');
  if (!box) return;

  const p = Store.get(id);
  if (!p) { box.innerHTML = ''; return; }

  const kind = p.kind || 'total';
  const model = kind === 'level' ? expLevelModel(p)
    : kind === 'angle' ? expAngleModel(p)
    : expTotalModel(p);

  const canPaper = kind !== 'angle';

  box.innerHTML = `
    <div class="card exp-card">
      <div class="exp-head">
        <div class="exp-head-text">
          <h3 class="exp-title">${escHTML(p.name || '未命名工作')}</h3>
          <p class="exp-sub">${escHTML(KINDS[kind].name)} · 更新 ${escHTML(fmtTime(p.updatedAt))}</p>
        </div>
        <span class="badge">${escHTML(KINDS[kind].short)}</span>
      </div>
      ${expKpis(model.kpis)}
      ${model.summary ? `<p class="exp-summary">${escHTML(model.summary)}</p>` : ''}
      ${model.chart
        ? `<div class="exp-figure">${model.chart}
        <p class="exp-cap">${escHTML(model.caption)}</p></div>`
        : `<div class="exp-figure is-empty"><p class="exp-none">${escHTML(model.emptyHint || '数据不足，暂无法绘图')}</p></div>`}
    </div>

    <div class="card exp-tools">
      <div class="card-head">
        <h3 class="card-title">处理与导出</h3>
      </div>
      <div class="tool-list">
        <button class="tool-row" id="expImage"${model.chart ? '' : ' disabled'}>
          <span class="tool-row-ico">${ICON_IMAGE}</span>
          <span class="tool-row-main">
            <span class="tool-row-title">导出为图片</span>
            <span class="tool-row-sub">${escHTML(model.imageHint)}</span>
          </span>
          <span class="tool-row-caret" aria-hidden="true">›</span>
        </button>

        <button class="tool-row" id="expCsv">
          <span class="tool-row-ico">${ICON_TABLE}</span>
          <span class="tool-row-main">
            <span class="tool-row-title">导出为 CSV</span>
            <span class="tool-row-sub">表格数据，合并单元格按列对齐</span>
          </span>
          <span class="tool-row-caret" aria-hidden="true">›</span>
        </button>

        <button class="tool-row" id="expPaperBtn"${canPaper ? '' : ' disabled'}>
          <span class="tool-row-ico">${ICON_PAPER}</span>
          <span class="tool-row-main">
            <span class="tool-row-title">智能纸图</span>
            <span class="tool-row-sub">${canPaper
              ? '按纸张尺寸换算比例，生成可照抄的坐标轴大图'
              : '仅支持水准测量与全站仪测绘'}</span>
          </span>
          <span class="tool-row-caret" aria-hidden="true">›</span>
        </button>
      </div>
    </div>

    <div class="card">
      <div class="card-head">
        <h3 class="card-title">表格数据</h3>
        <span class="badge">${model.rowCount} 行</span>
      </div>
      ${model.tables.map(t => expTableBlock(t)).join('')}
      <div class="exp-actions">
        <button class="btn btn-ghost" id="expCopy">复制表格</button>
      </div>
    </div>

    <div id="expPaper"></div>`;

  const copyBtn = $('#expCopy');
  if (copyBtn) copyBtn.addEventListener('click', () => copyTable(model));

  const csvBtn = $('#expCsv');
  if (csvBtn) csvBtn.addEventListener('click', () => exportCSV(p, model));

  const imgBtn = $('#expImage');
  if (imgBtn) imgBtn.addEventListener('click', () => exportPNG(p, model));

  const paperBtn = $('#expPaperBtn');
  if (paperBtn) paperBtn.addEventListener('click', () => openPaperDialog());
}

/* ---------- 概览指标 / 表格 ---------- */
function expKpis(list) {
  return `<div class="exp-kpis">${list.map(k => `
    <div class="kpi">
      <span class="kpi-v">${escHTML(k.v)}</span>
      <span class="kpi-k">${escHTML(k.k)}</span>
    </div>`).join('')}</div>`;
}

/** 合并单元格在表格里用 colspan，导出 CSV 时再展开成空列，保证列不错位 */
function expandCells(cells) {
  const out = [];
  cells.forEach(c => {
    out.push(c.t == null ? '' : String(c.t));
    for (let i = 1; i < (c.colspan || 1); i++) out.push('');
  });
  return out;
}

function expTableBlock(t) {
  let html = `<p class="exp-table-title">${escHTML(t.title)}</p>`;
  if (!t.rows || !t.rows.length) return html + '<p class="exp-none">暂无数据</p>';

  html += `<div class="sheet-wrap"><table class="exp-table${t.head.length >= 8 ? ' exp-table--wide' : ''}">
    <thead><tr>${t.head.map(h => `<th>${escHTML(h)}</th>`).join('')}</tr></thead>
    <tbody>${t.rows.map(r => `<tr>${r.map(c => `<td>${escHTML(c == null ? '' : String(c))}</td>`).join('')}</tr>`).join('')}</tbody>`;

  if (t.foot && t.foot.length) {
    html += `<tfoot>${t.foot.map(row => `<tr>${row.cells.map(c =>
      `<td${c.colspan ? ` colspan="${c.colspan}"` : ''}${c.rowspan ? ` rowspan="${c.rowspan}"` : ''}${c.cls ? ` class="${c.cls}"` : ''}>${escHTML(c.t)}</td>`
    ).join('')}</tr>`).join('')}</tfoot>`;
  }

  return html + '</table></div>';
}

function expTableText(model) {
  const lines = [];
  model.tables.forEach((t, i) => {
    if (i) lines.push('');
    lines.push(t.title);
    lines.push(t.head.join('\t'));
    (t.rows || []).forEach(r => lines.push(r.map(c => (c == null ? '' : String(c))).join('\t')));
    (t.foot || []).forEach(fr => lines.push(expandCells(fr.cells).join('\t')));
  });
  return lines.join('\n');
}

async function copyTable(model) {
  const text = expTableText(model);
  if (!text.trim()) { toast('没有可复制的内容'); return; }
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      toast('已复制表格，可直接粘贴到 Excel / WPS');
      return;
    }
  } catch {}
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch {}
  ta.remove();
  toast(ok ? '已复制表格，可直接粘贴到 Excel / WPS' : '复制失败，请改用「导出为 CSV」');
}

/* ---------- 导出为 CSV ---------- */
function csvCell(v) {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function expCSVText(p, model) {
  const kind = p.kind || 'total';
  const lines = [
    csvCell(`工作名称：${p.name || '未命名工作'}`),
    csvCell(`工作类型：${KINDS[kind].name}`),
    csvCell(`导出时间：${fmtTime(new Date().toISOString())}`)
  ];

  model.tables.forEach(t => {
    lines.push('');
    lines.push(csvCell(t.title));
    lines.push(t.head.map(csvCell).join(','));
    (t.rows || []).forEach(r => lines.push(r.map(csvCell).join(',')));
    // 合并单元格：内容写在首列，其余列留空，保证与上方表头对齐
    (t.foot || []).forEach(fr => lines.push(expandCells(fr.cells).map(csvCell).join(',')));
  });

  return '\ufeff' + lines.join('\r\n');
}

function saveTextFile(fileName, text, mime) {
  if (window.CeceAndroid && window.CeceAndroid.saveArchive) {
    try {
      toast(window.CeceAndroid.saveArchive(fileName, text) || '已导出');
    } catch (e) {
      toast('导出失败：' + (e.message || '原生保存异常'));
    }
    return;
  }

  try {
    if (typeof URL.createObjectURL !== 'function') throw new Error('no-blob');
    const blob = new Blob([text], { type: (mime || 'text/plain') + ';charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
    toast('已导出到下载目录');
  } catch {
    toast('当前环境不支持直接下载，请改用「复制表格」');
  }
}

function exportCSV(p, model) {
  if (!model.tables.some(t => t.rows && t.rows.length)) { toast('没有可导出的内容'); return; }
  saveTextFile(safeFileName(p.name || '工作') + '.csv', expCSVText(p, model), 'text/csv');
}

/* ---------- 导出为图片 ---------- */
function svgSize(svg) {
  const m = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svg || '');
  return m ? { w: parseFloat(m[1]), h: parseFloat(m[2]) } : { w: 380, h: 300 };
}

function loadSvgImage(svg) {
  return new Promise((resolve, reject) => {
    if (typeof URL.createObjectURL !== 'function') { reject(new Error('当前环境不支持图片导出')); return; }
    const src = String(svg).replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ');
    const url = URL.createObjectURL(new Blob([src], { type: 'image/svg+xml;charset=utf-8' }));
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('图形渲染失败')); };
    img.src = url;
  });
}

function canvasToBlob(canvas) {
  return new Promise(resolve => {
    if (typeof canvas.toBlob === 'function') canvas.toBlob(b => resolve(b), 'image/png');
    else resolve(null);
  });
}

/** 把画好的 canvas 送去保存：原生桥 → 浏览器下载 → 预览长按保存 */
async function deliverCanvas(canvas, fileName) {
  const bridge = window.CeceAndroid;

  if (bridge && typeof bridge.saveImage === 'function') {
    try {
      const msg = bridge.saveImage(fileName, canvas.toDataURL('image/png').split(',')[1]);
      toast(msg || '已保存图片');
    } catch (e) {
      toast('保存失败：' + (e.message || '原生保存异常'));
    }
    return;
  }

  if (bridge && typeof bridge.saveArchive === 'function') {
    let dataUrl = '';
    try { dataUrl = canvas.toDataURL('image/png'); } catch {}
    if (dataUrl) { showImagePreview(dataUrl, fileName); return; }
    toast('当前安装包不支持保存图片，请更新版本');
    return;
  }

  const blob = await canvasToBlob(canvas);
  if (blob && typeof URL.createObjectURL === 'function') {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
    toast('已导出到下载目录');
    return;
  }

  let dataUrl = '';
  try { dataUrl = canvas.toDataURL('image/png'); } catch {}
  if (dataUrl) showImagePreview(dataUrl, fileName);
  else toast('当前环境不支持导出图片');
}

function showImagePreview(dataUrl, fileName) {
  showModal({
    title: '导出为图片',
    hideOk: true,
    okText: '关闭',
    body: `
      <p class="img-hint">在手机上长按图片即可保存到相册；电脑上可右键另存为。</p>
      <img class="export-img" src="${dataUrl}" alt="${escHTML(fileName)}" />`
  });
}

/** 报告图 + 标题栏 → canvas */
async function reportCanvas(p, model) {
  const { w, h } = svgSize(model.chart);
  const scale = 3;
  const padX = 22, padTop = 58, padBottom = 34;
  const W = w + padX * 2;
  const H = h + padTop + padBottom;

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(W * scale);
  canvas.height = Math.round(H * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('当前环境不支持图片导出');

  ctx.scale(scale, scale);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);

  const kind = p.kind || 'total';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#123a44';
  ctx.font = `600 15px ${SVG_FONT}`;
  ctx.fillText(String(p.name || '未命名工作').slice(0, 32), padX, 26);

  ctx.fillStyle = '#5f757a';
  ctx.font = `11px ${SVG_FONT}`;
  ctx.fillText(`${KINDS[kind].name} · ${model.caption.replace(/^图\s*\d+\s*　?/, '')}`, padX, 44);

  const img = await loadSvgImage(model.chart);
  ctx.drawImage(img, padX, padTop, w, h);

  ctx.fillStyle = '#93a3a7';
  ctx.font = `10px ${SVG_FONT}`;
  ctx.textAlign = 'right';
  ctx.fillText('测策 · 工程测量', W - padX, H - 12);

  return canvas;
}

async function exportPNG(p, model) {
  if (!model.chart) { toast('数据不足，暂无法生成图片'); return; }
  let canvas;
  try { canvas = await reportCanvas(p, model); }
  catch (e) { toast('图片生成失败：' + (e.message || '当前环境不支持')); return; }
  await deliverCanvas(canvas, safeFileName(p.name || '工作') + '-图.png');
}

/* ---------- 数据模型：全站仪测绘 ---------- */
function expTotalModel(p) {
  const rows = p.rows || [];
  const pts = [];
  rows.forEach((r, i) => {
    const n = Core.num(r.n), e = Core.num(r.e);
    if (n === null || e === null) return;
    pts.push({
      id: r.id,
      no: (r.no || '').trim() || String(i + 1),
      n, e,
      color: typeColorOf(effectiveTypeId(r))
    });
  });

  const kindName = id => {
    const t = typeById(id) || defaultType();
    return t ? t.name : '—';
  };
  const nameOf = id => {
    const i = rows.findIndex(x => x.id === id);
    if (i < 0) return '—';
    return (rows[i].no || '').trim() || String(i + 1);
  };

  const pointRows = rows.map(r => [
    (r.no || '').trim() || '—',
    r.prism || '',
    r.n || '',
    r.e || '',
    r.h || '',
    kindName(effectiveTypeId(r)),
    r.remark || ''
  ]);

  const links = p.links || [];
  const linkRows = links.map((l, i) => [
    String(i + 1),
    nameOf(l.a),
    nameOf(l.b),
    linkColorName(l.color)
  ]);

  let dN = '—', dE = '—';
  if (pts.length) {
    const ns = pts.map(x => x.n), es = pts.map(x => x.e);
    dN = m3(Math.max(...ns) - Math.min(...ns));
    dE = m3(Math.max(...es) - Math.min(...es));
  }

  let summary;
  if (!pts.length) {
    summary = '还没有有效的坐标数据，填入 N/E 后即会自动生成平面坐标图。';
  } else {
    const cnt = {};
    rows.forEach(r => {
      const n = Core.num(r.n), e = Core.num(r.e);
      if (n === null || e === null) return;
      const nm = kindName(effectiveTypeId(r));
      cnt[nm] = (cnt[nm] || 0) + 1;
    });
    const parts = Object.keys(cnt).map(k => `${k} ${cnt[k]} 个`).join('、');
    summary = `共 ${pts.length} 个有效点（${parts}），${links.length} 条连线；` +
      `南北跨度 ${dN} m，东西跨度 ${dE} m。`;
  }

  return {
    tables: [
      { title: '点位数据', head: ['点号', '棱镜高', 'N(X)', 'E(Y)', 'H(Z)', '类型', '备注'], rows: pointRows },
      { title: '连线', head: ['序号', '起点', '终点', '颜色'], rows: linkRows }
    ],
    rowCount: pointRows.length,
    summary,
    kpis: [
      { v: String(pts.length), k: '有效点位' },
      { v: String(links.length), k: '连线' },
      { v: dN, k: '南北跨度 ΔN (m)' },
      { v: dE, k: '东西跨度 ΔE (m)' }
    ],
    chart: expPlanChart(p, pts),
    caption: '图 1　点位平面坐标图（N 向上、E 向右，单位 m）',
    imageHint: '平面坐标图 · PNG',
    emptyHint: '还没有有效坐标点，填入 N/E 后即可出图'
  };
}

function expPlanChart(p, pts) {
  if (!pts.length) return '';

  const W = 400, H = 320;
  const M = { l: 42, r: 20, t: 20, b: 32 };
  const pw = W - M.l - M.r;
  const ph = H - M.t - M.b;

  let minN = Math.min(...pts.map(x => x.n)), maxN = Math.max(...pts.map(x => x.n));
  let minE = Math.min(...pts.map(x => x.e)), maxE = Math.max(...pts.map(x => x.e));

  const padSpan = (lo, hi) => {
    if (hi - lo < MIN_SPAN) { const c = (lo + hi) / 2; return [c - 0.5, c + 0.5]; }
    return [lo, hi];
  };
  [minN, maxN] = padSpan(minN, maxN);
  [minE, maxE] = padSpan(minE, maxE);

  const s = Math.min(pw / (maxE - minE), ph / (maxN - minN));
  const cx = (minE + maxE) / 2, cy = (minN + maxN) / 2;
  const ox = M.l + pw / 2, oy = M.t + ph / 2;
  const X = e => ox + (e - cx) * s;
  const Y = n => oy - (n - cy) * s;

  const e0 = cx - pw / 2 / s, e1 = cx + pw / 2 / s;
  const step = niceStep(Math.max(e1 - e0, ph / s), 4);
  const dec = decimalsFor(step);

  let g = '';

  for (let v = Math.ceil(e0 / step) * step; v <= e1 + 1e-9; v += step) {
    const x = X(v).toFixed(1);
    g += `<line x1="${x}" y1="${M.t}" x2="${x}" y2="${M.t + ph}" stroke="#eef3f4" stroke-width="1"/>`;
    g += `<text x="${x}" y="${M.t + ph + 15}" font-size="9.5" fill="#93a3a7" text-anchor="middle">${v.toFixed(dec)}</text>`;
  }
  const nLow = cy - ph / 2 / s, nHigh = cy + ph / 2 / s;
  for (let v = Math.ceil(nLow / step) * step; v <= nHigh + 1e-9; v += step) {
    const y = Y(v).toFixed(1);
    g += `<line x1="${M.l}" y1="${y}" x2="${M.l + pw}" y2="${y}" stroke="#eef3f4" stroke-width="1"/>`;
    g += `<text x="${M.l - 7}" y="${(+y + 3.5).toFixed(1)}" font-size="9.5" fill="#93a3a7" text-anchor="end">${v.toFixed(dec)}</text>`;
  }

  g += `<rect x="${M.l}" y="${M.t}" width="${pw}" height="${ph}" fill="none" stroke="#dbe3e6" stroke-width="1"/>`;

  const byId = new Map(pts.map(x => [x.id, x]));
  (p.links || []).forEach(l => {
    const a = byId.get(l.a), b = byId.get(l.b);
    if (!a || !b) return;
    g += `<line x1="${X(a.e).toFixed(1)}" y1="${Y(a.n).toFixed(1)}" x2="${X(b.e).toFixed(1)}" y2="${Y(b.n).toFixed(1)}" stroke="${l.color || LINK_COLORS[0].value}" stroke-width="1.6" stroke-linecap="round" stroke-opacity=".9"/>`;
  });

  const showLabel = pts.length <= 60;
  pts.forEach(pt => {
    const x = X(pt.e), y = Y(pt.n);
    g += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4.2" fill="${pt.color}" stroke="#ffffff" stroke-width="1.2"/>`;
    if (showLabel) {
      const anchor = x > M.l + pw - 32 ? 'end' : 'start';
      const dx = anchor === 'end' ? -7 : 7;
      g += `<text x="${(x + dx).toFixed(1)}" y="${(y - 7).toFixed(1)}" font-size="10" fill="${pt.color}" text-anchor="${anchor}" font-weight="600" style="paint-order:stroke;stroke:#fff;stroke-width:3px;stroke-linejoin:round">${escHTML(pt.no)}</text>`;
    }
  });

  g += `<text x="${M.l + 4}" y="${M.t + 13}" font-size="9.5" fill="#64777c">N↑</text>`;
  g += `<text x="${M.l + pw - 2}" y="${M.t + ph + 15}" font-size="9.5" fill="#64777c" text-anchor="end" opacity="0">E→</text>`;

  return `<svg class="exp-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" font-family='${SVG_FONT}' role="img" aria-label="点位平面坐标图">${g}</svg>`;
}

/* ---------- 数据模型：水准测量 ---------- */
function expLevelModel(p) {
  const rows = p.rows || [];
  const meta = p.meta || {};
  const calcMeta = levelCalcMeta(meta);
  const lv = Core.computeLevel(rows, calcMeta);
  const res = Core.computeLevelResult(rows, calcMeta, lv);
  const names = levelPointNames(rows, meta);
  const notes = levelPointNotes(rows, meta);

  const Hstart = i => (i === 0
    ? (lv.startH === null ? '' : m3(lv.startH))
    : (lv.rows[i - 1] && lv.rows[i - 1].H !== null ? m3(lv.rows[i - 1].H) : ''));
  const Hend = i => (lv.rows[i] && lv.rows[i].H !== null ? m3(lv.rows[i].H) : '');
  const rst = i => (i === 0
    ? (lv.startH === null ? '' : m3(lv.startH))
    : (res.rows[i - 1] && res.rows[i - 1].H !== null ? m3(res.rows[i - 1].H) : ''));
  const ren = i => (res.rows[i] && res.rows[i].H !== null ? m3(res.rows[i].H) : '');

  const dataRows = [];
  rows.forEach((r, i) => {
    const c = lv.rows[i] || {};
    dataRows.push([
      (r.no || '').trim() || String(i + 1),
      names[i] || '', r.dist || '', r.bs || '', r.bsF || '',
      c.h == null ? '' : m3s(c.h), Hstart(i), notes[i]
    ]);
    dataRows.push([
      '', names[i + 1] || '', r.fsDist || '', r.fsB || '', r.fs || '',
      '', Hend(i), notes[i + 1]
    ]);
  });

  const sum = lv.sum;
  const fh = sum.closure === null ? '' : mm1(sum.closure * 1000) + ' mm';
  const allowInfo = levelAllow(rows, meta);
  const allowTxt = allowInfo.allow === null ? '' : mm1(allowInfo.allow) + ' mm';

  let totalDist = 0, hasDist = false;
  rows.forEach(r => {
    const d = Core.levelDist(r);
    if (d !== null && d > 0) { totalDist += d; hasDist = true; }
  });

  const dataFoot = rows.length ? [
    { cells: [
      { t: '检核', rowspan: 2 },
      { t: 'Σ' },
      { t: hasDist ? m3(totalDist) : '' },
      { t: sum.a === null ? '' : m3(sum.a) },
      { t: sum.b === null ? '' : m3(sum.b) },
      { t: sum.h === null ? '' : m3s(sum.h) },
      { t: '' },
      { t: '' }
    ] },
    { cells: [
      { t: `Σa−Σb = ${sum.aMinusB === null ? '' : m3s(sum.aMinusB)}　　Σh = ${sum.h === null ? '' : m3s(sum.h)}　　H终−H始 = ${sum.hMinus === null ? '' : m3s(sum.hMinus)}`, colspan: 7 }
    ] }
  ] : [];

  const resRows = [];
  rows.forEach((r, i) => {
    const rr = res.rows[i] || {};
    resRows.push([
      (r.no || '').trim() || String(i + 1),
      names[i] || '', (rr.dist == null ? '' : m3(rr.dist)),
      rr.h == null ? '' : m3s(rr.h),
      rr.v == null ? '' : mm1(rr.v),
      rr.hAdj == null ? '' : m3s(rr.hAdj),
      rst(i), notes[i]
    ]);
    resRows.push(['', names[i + 1] || '', '', '', '', '', ren(i), notes[i + 1]]);
  });

  const resFoot = resRows.length ? [
    { cells: [
      { t: '检核', rowspan: 2 },
      { t: 'Σ' },
      { t: hasDist ? m3(totalDist) : '' },
      { t: res.sum.h == null ? '' : m3s(res.sum.h) },
      { t: res.sum.h == null ? '' : mm1(res.sum.v) },
      { t: res.sum.hAdj == null ? '' : m3s(Math.abs(res.sum.hAdj) < 0.0005 ? 0 : res.sum.hAdj) },
      { t: '' },
      { t: '' }
    ] },
    { cells: [
      { t: `f_h = ${fh}　　f_h允 = ${allowTxt}`, colspan: 7 }
    ] }
  ] : [];

  return {
    tables: [
      {
        title: '水准测量记录',
        head: ['测站', '点号', '视距/m', '后视读数 a/m', '前视读数 b/m', '高差 h/m', '高程 H/m', '备注'],
        rows: dataRows, foot: dataFoot
      },
      {
        title: '水准测量成果',
        head: ['测段编号', '点号', '测段距离/m', '测段观测高差/m', '高差改正值/mm', '改正后高差/m', '高程 H/m', '备注'],
        rows: resRows, foot: resFoot
      }
    ],
    rowCount: dataRows.length,
    summary: rows.length
      ? `共 ${rows.length} 个测站${hasDist ? `，总距离 ${m3(totalDist)} m` : ''}；` +
        `实测高差总和 ${sum.h === null ? '—' : m3s(sum.h) + ' m'}` +
        (sum.hMinus === null ? '。' : `，已知高差 ${m3s(sum.hMinus)} m，闭合差 ${fh || '—'}。`)
      : '还没有录入测站数据，填入后视、前视读数后即会自动计算。',
    kpis: [
      { v: String(rows.length), k: '测站' },
      { v: sum.h === null ? '—' : m3s(sum.h), k: 'Σh (m)' },
      { v: hasDist ? m3(totalDist) : '—', k: '总距离 (m)' },
      { v: fh || '—', k: '闭合差 fh' }
    ],
    chart: expLevelChart(lv, rows),
    caption: hasDist
      ? '图 1　里程—高程坐标图（横轴里程 / m，纵轴高程 / m）'
      : '图 1　高程剖面（横轴为测站序号，纵轴高程 / m）',
    imageHint: '里程—高程坐标图 · PNG',
    emptyHint: '数据不足，填完起点高程与测站读数后可出图'
  };
}

function expLevelChart(lv, rows) {
  const dists = (rows || []).map(r => Core.levelSegDist(r));
  const allDist = dists.length > 0 && dists.every(d => d !== null && d > 0);

  const pts = [];
  if (lv.startH !== null) pts.push({ x: 0, H: lv.startH, label: 'H始' });

  let cum = 0;
  lv.rows.forEach((r, i) => {
    if (allDist) cum += dists[i];
    if (r.H === null) return;
    pts.push({ x: allDist ? cum : i + 1, H: r.H, label: allDist ? trimNum(cum, 1) : String(i + 1) });
  });

  if (pts.length < 2) return '';

  const W = 400, H = 280;
  const M = { l: 48, r: 20, t: 22, b: 42 };
  const pw = W - M.l - M.r;
  const ph = H - M.t - M.b;

  const xs = pts.map(p => p.x), hs = pts.map(p => p.H);
  const xMax = Math.max(1e-6, Math.max(...xs));

  let hMin = Math.min(...hs), hMax = Math.max(...hs);
  const padH = Math.max((hMax - hMin) * 0.2, 0.08);
  hMin -= padH;
  hMax += padH;

  const X = x => M.l + (x / xMax) * pw;
  const Y = h => M.t + ph - ((h - hMin) / (hMax - hMin)) * ph;

  let g = '';

  const stepY = niceStep(hMax - hMin, 4);
  const decY = decimalsFor(stepY);
  for (let v = Math.ceil(hMin / stepY) * stepY; v <= hMax + 1e-9; v += stepY) {
    const y = Y(v).toFixed(1);
    g += `<line x1="${M.l}" y1="${y}" x2="${M.l + pw}" y2="${y}" stroke="#eef3f4" stroke-width="1"/>`;
    g += `<text x="${M.l - 8}" y="${(+y + 3.5).toFixed(1)}" font-size="9.5" fill="#93a3a7" text-anchor="end">${v.toFixed(decY)}</text>`;
  }

  if (allDist) {
    const stepX = niceStep(xMax, 4);
    const decX = decimalsFor(stepX);
    for (let v = 0; v <= xMax + 1e-9; v += stepX) {
      const x = X(v).toFixed(1);
      g += `<line x1="${x}" y1="${M.t}" x2="${x}" y2="${M.t + ph}" stroke="#f2f7f7" stroke-width="1"/>`;
      g += `<text x="${x}" y="${M.t + ph + 16}" font-size="9.5" fill="#93a3a7" text-anchor="middle">${v.toFixed(decX)}</text>`;
    }
  } else {
    pts.forEach((p, i) => {
      const x = X(p.x).toFixed(1);
      g += `<text x="${x}" y="${M.t + ph + 16}" font-size="9.5" fill="#93a3a7" text-anchor="middle">${i === 0 ? 'H始' : p.label}</text>`;
    });
  }

  g += `<rect x="${M.l}" y="${M.t}" width="${pw}" height="${ph}" fill="none" stroke="#dbe3e6" stroke-width="1"/>`;

  const line = pts.map(p => `${X(p.x).toFixed(1)},${Y(p.H).toFixed(1)}`).join(' ');
  g += `<polyline points="${line}" fill="none" stroke="#0f5f6b" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;

  pts.forEach((p, i) => {
    const x = X(p.x), y = Y(p.H);
    g += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.6" fill="#fff" stroke="#0f5f6b" stroke-width="1.8"/>`;
    if (i === 0 || i === pts.length - 1 || pts.length <= 8) {
      g += `<text x="${x.toFixed(1)}" y="${(y - 10).toFixed(1)}" font-size="9.5" fill="#0a4750" text-anchor="middle" font-weight="600" style="paint-order:stroke;stroke:#fff;stroke-width:3px">${m3(p.H)}</text>`;
    }
  });

  g += `<text x="${M.l + pw}" y="${M.t + ph + 33}" font-size="9.5" fill="#64777c" text-anchor="end">${allDist ? '里程 / m' : '测段序号'}</text>`;
  g += `<text x="${M.l + 4}" y="${M.t + 13}" font-size="9.5" fill="#64777c">高程 / m</text>`;

  return `<svg class="exp-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" font-family='${SVG_FONT}' role="img" aria-label="里程高程坐标图">${g}</svg>`;
}

/* ---------- 数据模型：角度测量 ---------- */
function expAngleModel(p) {
  const rows = p.rows || [];
  const ang = Core.computeAngle(rows);

  const fa = v => (v === null || v === undefined) ? '' : Core.formatAngle(v, 0);
  const diffStr = v => (v === null || v === undefined) ? '' : (v > 0 ? '+' : '') + v + '″';

  // 测站分组（按测站号，与记录表一致）
  const groups = [];
  rows.forEach((r, i) => {
    const no = Number(r.stNo) || 1;
    const last = groups[groups.length - 1];
    if (last && last.stNo === no) last.items.push(i);
    else groups.push({ stNo: no, station: String(r.station == null ? '' : r.station).trim(), items: [i] });
  });
  const posOf = new Map();
  groups.forEach(g => g.items.forEach((ri, k) => posOf.set(ri, { pos: k, first: k === 0 })));

  const dataRows = [];
  rows.forEach((r, i) => {
    const c = ang.rows[i] || {};
    const g = posOf.get(i) || { pos: 0, first: true };
    const st = g.first ? (String(r.station || '').trim() || '') : '';
    const turn = String(g.pos + 1);
    const aL = angleToParts(r.aL), bL = angleToParts(r.bL);
    const aR = angleToParts(r.aR), bR = angleToParts(r.bR);

    // 角度之差 / 一测回角值 / 角度之差 只写在「右」那一块（与记录表一致）
    dataRows.push([st, turn, '左', 'A', aL.d, aL.m, aL.s, fa(c.beL), '', '', '', g.first ? fa(c.avg) : '']);
    dataRows.push(['', '', '', 'B', bL.d, bL.m, bL.s, '', '', '', '', '']);
    dataRows.push(['', '', '右', 'A', aR.d, aR.m, aR.s, fa(c.beR), diffStr(c.halfDiff), fa(c.one), diffStr(c.gap), '']);
    dataRows.push(['', '', '', 'B', bR.d, bR.m, bR.s, '', '', '', '', '']);
  });

  const avg = ang.avg === null ? '—' : Core.formatAngle(ang.avg, 0);
  const maxHalf = ang.valid ? mm1(ang.check.maxHalf) + '″' : '—';
  const maxGap = ang.valid ? mm1(ang.check.maxGap) + '″' : '—';
  const gCount = (ang.groups || []).length;

  return {
    tables: [
      {
        title: '角度测量记录',
        head: ['测站', '测回数', '竖盘位置', '目标', '°', '′', '″', '半测回角值', '角度之差', '一测回角值', '角度之差', '各测回平均角值'],
        rows: dataRows
      }
    ],
    rowCount: dataRows.length,
    summary: ang.valid
      ? `共 ${gCount > 1 ? `${gCount} 个测站、` : ''}${ang.valid} 个有效测回，平均角值 ${avg}；` +
        `半测回最大较差 ${maxHalf}、测回间最大较差 ${maxGap}，` +
        (ang.check.overHalf || ang.check.overGap ? '存在超限测回，请复核观测值。' : '均在限差内。')
      : '还没有完整的测回读数，四个方向值填齐后即会自动计算。',
    kpis: [
      { v: String(ang.valid), k: '有效测回' },
      { v: avg, k: '平均角值' },
      { v: maxHalf, k: '半测回最大较差' },
      { v: maxGap, k: '测回间最大较差' }
    ],
    chart: expAngleSketch(ang),
    caption: '图 1　模拟角度图（∠AOB 为各测回平均角值）',
    imageHint: '模拟角度图 · PNG',
    emptyHint: '还没有完整的测回读数，填齐四个方向值后可出图'
  };
}

/** 两条射线 OA、OB 夹出实测角度的示意图 */
function expAngleSketch(ang) {
  const beta = ang.avg;
  if (beta === null || beta === undefined) return '';

  const W = 400, H = 300;
  const rad = d => d * Math.PI / 180;

  const reflex = beta > 185;
  const ox = reflex ? W / 2 : 86;
  const oy = reflex ? H / 2 + 6 : H - 62;
  const R = reflex
    ? Math.min(W / 2 - 52, H / 2 - 32)
    : Math.min(W - ox - 62, oy - 34);

  const pt = t => ({ x: ox + R * Math.cos(rad(t)), y: oy - R * Math.sin(rad(t)) });
  const A = pt(0), B = pt(beta);
  const large = beta > 180 ? 1 : 0;

  let g = '';

  // 角弧
  g += `<path d="M ${A.x.toFixed(1)} ${A.y.toFixed(1)} A ${R} ${R} 0 ${large} 0 ${B.x.toFixed(1)} ${B.y.toFixed(1)}" fill="none" stroke="#0f5f6b" stroke-opacity=".3" stroke-width="1.6"/>`;

  // 两条射线
  g += `<line x1="${ox}" y1="${oy}" x2="${A.x.toFixed(1)}" y2="${A.y.toFixed(1)}" stroke="#0f5f6b" stroke-width="2.2" stroke-linecap="round"/>`;
  g += `<line x1="${ox}" y1="${oy}" x2="${B.x.toFixed(1)}" y2="${B.y.toFixed(1)}" stroke="#c0392b" stroke-width="2.2" stroke-linecap="round"/>`;

  // 顶点 O
  g += `<circle cx="${ox}" cy="${oy}" r="4.2" fill="#fff" stroke="#123a44" stroke-width="2"/>`;
  g += `<text x="${ox - 12}" y="${oy + 16}" font-size="11" fill="#123a44" text-anchor="middle" font-weight="700" style="paint-order:stroke;stroke:#fff;stroke-width:3px">O</text>`;

  // A / B 端点
  const labelAt = (p, t, color) => {
    const dx = Math.cos(rad(t)) * 16, dy = -Math.sin(rad(t)) * 16;
    return `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3.4" fill="${color}"/>` +
      `<text x="${(p.x + dx).toFixed(1)}" y="${(p.y + dy + 4).toFixed(1)}" font-size="11.5" fill="${color}" text-anchor="middle" font-weight="700" style="paint-order:stroke;stroke:#fff;stroke-width:3px">${t === 0 ? 'A' : 'B'}</text>`;
  };
  g += labelAt(A, 0, '#0f5f6b');
  g += labelAt(B, beta, '#c0392b');

  // 角度标注（放在半角方向的弧内侧）
  const mid = beta / 2;
  const lx = ox + R * 0.52 * Math.cos(rad(mid));
  const ly = oy - R * 0.52 * Math.sin(rad(mid));
  const txt = `β = ${Core.formatAngle(beta, 0)}`;
  const tw = 12 + txt.length * 7;
  g += `<rect x="${(lx - tw / 2).toFixed(1)}" y="${(ly - 14).toFixed(1)}" width="${tw}" height="20" rx="5" fill="#ffffff" fill-opacity=".86"/>`;
  g += `<text x="${lx.toFixed(1)}" y="${(ly + 1).toFixed(1)}" font-size="11.5" fill="#123a44" text-anchor="middle" font-weight="700">${txt}</text>`;

  return `<svg class="exp-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" font-family='${SVG_FONT}' role="img" aria-label="模拟角度图">${g}</svg>`;
}

/* ------------------------------------------------------------
 * 15.1 智能纸图：按纸张尺寸换算比例，生成可照抄的坐标轴大图
 * ---------------------------------------------------------- */
const PAPER_M = { l: 1.9, r: 0.7, t: 1.4, b: 1.7 };   // 纸张页边距，单位 cm
const PAPER_LABEL_MAX = 60;                            // 点数超过此值时纸图只画点，省略点号与密集辅助线

function paperPlot(Wcm, Hcm) {
  return {
    plotW: Wcm - PAPER_M.l - PAPER_M.r,
    plotH: Hcm - PAPER_M.t - PAPER_M.b
  };
}

/** 单轴：给定数据范围与可用纸面，选一个整比 k（米/厘米）与刻度步长 */
function fitAxis(min, max, plot) {
  if (max - min < 1e-9) { const c = (min + max) / 2; min = c - 0.5; max = c + 0.5; }

  let k = niceScale((max - min) / plot * 1.12);
  let step = 1, lo = min, hi = max;

  for (let it = 0; it < 9; it++) {
    step = niceStep(k * 1.6, 1);
    lo = Math.floor(min / step + 1e-9) * step;
    hi = Math.ceil(max / step - 1e-9) * step;
    if (hi - lo < step * 1.2) { lo -= step; hi += step; }
    const need = (hi - lo) / plot;
    const k2 = niceScale(need);
    if (Math.abs(k2 - k) < 1e-9) break;
    k = k2;
  }

  if ((hi - lo) / plot > k) k = niceScale((hi - lo) / plot);
  return { k, step, lo, hi };
}

/** 平面图：X、Y 共用一个比例，保证「正确比例」 */
function fitPlane(eMin, eMax, nMin, nMax, plotW, plotH) {
  if (eMax - eMin < 1) { const c = (eMin + eMax) / 2; eMin = c - 0.5; eMax = c + 0.5; }
  if (nMax - nMin < 1) { const c = (nMin + nMax) / 2; nMin = c - 0.5; nMax = c + 0.5; }

  let k = niceScale(Math.max((eMax - eMin) / plotW, (nMax - nMin) / plotH) * 1.08);
  let step = 1, e0 = eMin, e1 = eMax, n0 = nMin, n1 = nMax;

  for (let it = 0; it < 9; it++) {
    step = niceStep(k * 1.4, 1);
    e0 = Math.floor(eMin / step + 1e-9) * step;
    e1 = Math.ceil(eMax / step - 1e-9) * step;
    n0 = Math.floor(nMin / step + 1e-9) * step;
    n1 = Math.ceil(nMax / step - 1e-9) * step;
    if (e1 - e0 < step * 1.4) { e0 -= step; e1 += step; }
    if (n1 - n0 < step * 1.4) { n0 -= step; n1 += step; }
    const need = Math.max((e1 - e0) / plotW, (n1 - n0) / plotH);
    const k2 = niceScale(need);
    if (Math.abs(k2 - k) < 1e-9) break;
    k = k2;
  }

  const needF = Math.max((e1 - e0) / plotW, (n1 - n0) / plotH);
  if (needF > k) k = niceScale(needF);

  return { k, step, e0, e1, n0, n1 };
}

/**
 * 纸面 SVG：坐标轴、刻度、每点贯穿的浅灰虚线、点与标注
 * cfg: { Wcm,Hcm,left,top,fw,fh, xMin,xMax,yMin,yMax, xStep,yStep, kx,ky,
 *        pts:[{x,y,no}], segs:[{a,b}], title, subtitle, xTitle, yTitle }
 */
function paperSvg(cfg) {
  const { Wcm, Hcm, left, top, fw, fh, xMin, xMax, yMin, yMax, xStep, yStep, kx, ky } = cfg;
  const X = v => left + (v - xMin) / kx;
  const Y = v => top + fh - (v - yMin) / ky;

  const F = { title: 0.44, sub: 0.27, tick: 0.26, pt: 0.28, axis: 0.27 };
  const bottom = top + fh;
  const right = left + fw;

  let g = '';

  // 纸面
  g += `<rect x="0" y="0" width="${Wcm}" height="${Hcm}" fill="#ffffff" stroke="#c6d2d5" stroke-width="0.03"/>`;

  // 标题
  g += `<text x="${PAPER_M.l}" y="0.84" font-size="${F.title}" font-weight="700" fill="#123a44">${escHTML(cfg.title)}</text>`;
  g += `<text x="${PAPER_M.l}" y="1.22" font-size="${F.sub}" fill="#5f757a">${escHTML(cfg.subtitle)}</text>`;

  // 图框（四边即坐标轴）
  g += `<rect x="${left}" y="${top}" width="${fw}" height="${fh}" fill="none" stroke="#b9c7ca" stroke-width="0.03"/>`;

  // 每点：平行于坐标轴的浅灰虚线，贯穿整个图框
  // 点数很多时按间隔取，避免虚线糊成一片网格
  const guideStride = cfg.pts.length <= PAPER_LABEL_MAX ? 1 : Math.ceil(cfg.pts.length / 24);
  for (let i = 0; i < cfg.pts.length; i += guideStride) {
    const pt = cfg.pts[i];
    g += `<line x1="${left.toFixed(2)}" y1="${pt.y.toFixed(2)}" x2="${right.toFixed(2)}" y2="${pt.y.toFixed(2)}" stroke="#d3dcde" stroke-width="0.017" stroke-dasharray="0.17 0.13"/>`;
    g += `<line x1="${pt.x.toFixed(2)}" y1="${top.toFixed(2)}" x2="${pt.x.toFixed(2)}" y2="${bottom.toFixed(2)}" stroke="#d3dcde" stroke-width="0.017" stroke-dasharray="0.17 0.13"/>`;
  }

  // 线段
  cfg.segs.forEach(s => {
    g += `<line x1="${s.a.x.toFixed(2)}" y1="${s.a.y.toFixed(2)}" x2="${s.b.x.toFixed(2)}" y2="${s.b.y.toFixed(2)}" stroke="#41636b" stroke-width="0.032" stroke-linecap="round"/>`;
  });

  // 坐标轴加粗（左 / 下）
  g += `<line x1="${left}" y1="${bottom}" x2="${right}" y2="${bottom}" stroke="#41636b" stroke-width="0.045"/>`;
  g += `<line x1="${left}" y1="${top}" x2="${left}" y2="${bottom}" stroke="#41636b" stroke-width="0.045"/>`;

  // X 轴刻度
  const xStart = Math.ceil((xMin - 1e-9) / xStep) * xStep;
  for (let v = xStart; v <= xMax + 1e-9; v += xStep) {
    const x = X(v).toFixed(2);
    g += `<line x1="${x}" y1="${bottom}" x2="${x}" y2="${(bottom + 0.13).toFixed(2)}" stroke="#8fa3a7" stroke-width="0.02"/>`;
    g += `<text x="${x}" y="${(bottom + 0.42).toFixed(2)}" font-size="${F.tick}" fill="#5f757a" text-anchor="middle">${trimNum(v, 2)}</text>`;
  }

  // Y 轴刻度
  const yStart = Math.ceil((yMin - 1e-9) / yStep) * yStep;
  for (let v = yStart; v <= yMax + 1e-9; v += yStep) {
    const y = Y(v).toFixed(2);
    g += `<line x1="${(left - 0.13).toFixed(2)}" y1="${y}" x2="${left}" y2="${y}" stroke="#8fa3a7" stroke-width="0.02"/>`;
    g += `<text x="${(left - 0.2).toFixed(2)}" y="${(+y + 0.09).toFixed(2)}" font-size="${F.tick}" fill="#5f757a" text-anchor="end">${trimNum(v, 2)}</text>`;
  }

  // 轴名
  g += `<text x="${left}" y="${(top - 0.16).toFixed(2)}" font-size="${F.axis}" fill="#123a44">${escHTML(cfg.yTitle)}</text>`;
  g += `<text x="${right}" y="${(bottom + 0.84).toFixed(2)}" font-size="${F.axis}" fill="#123a44" text-anchor="end">${escHTML(cfg.xTitle)}</text>`;

  // 点与标注（标注做避让，白描边保证不被虚线压住）
  const showLabels = cfg.pts.length <= PAPER_LABEL_MAX;
  const boxes = makeBoxIndex(1.2);
  cfg.pts.forEach(pt => boxes.add({ x1: pt.x - 0.13, y1: pt.y - 0.13, x2: pt.x + 0.13, y2: pt.y + 0.13 }));

  cfg.pts.forEach(pt => {
    const dotFill = pt.color || '#123a44';
    if (!showLabels) {
      g += `<circle cx="${pt.x.toFixed(2)}" cy="${pt.y.toFixed(2)}" r="0.1" fill="${escHTML(dotFill)}"/>`;
      return;
    }

    const label = String(pt.no);
    const w = label.length * 0.16 + 0.05;

    const cands = [
      [pt.x + 0.2, pt.y - 0.16, 'start'],
      [pt.x - 0.2, pt.y - 0.16, 'end'],
      [pt.x + 0.2, pt.y + 0.32, 'start'],
      [pt.x - 0.2, pt.y + 0.32, 'end'],
      [pt.x, pt.y - 0.26, 'middle'],
      [pt.x, pt.y + 0.38, 'middle']
    ];

    let chosen = null;
    for (let c = 0; c < cands.length; c++) {
      const cx2 = cands[c][0], cy2 = cands[c][1], anchor = cands[c][2];
      const x1 = anchor === 'end' ? cx2 - w : anchor === 'middle' ? cx2 - w / 2 : cx2;
      const rect = { x1, x2: x1 + w, y1: cy2 - 0.28, y2: cy2 + 0.08 };
      if (rect.x1 < left + 0.05 || rect.x2 > right - 0.05) continue;
      if (rect.y1 < top + 0.04 || rect.y2 > bottom - 0.02) continue;
      if (boxes.hit(rect)) continue;
      chosen = { rect, lx: cx2, ly: cy2, anchor };
      break;
    }
    if (!chosen) {
      const cx2 = cands[0][0], cy2 = cands[0][1];
      chosen = { rect: { x1: cx2, x2: cx2 + w, y1: cy2 - 0.28, y2: cy2 + 0.08 }, lx: cx2, ly: cy2, anchor: 'start' };
    }
    boxes.add(chosen.rect);

    g += `<circle cx="${pt.x.toFixed(2)}" cy="${pt.y.toFixed(2)}" r="0.1" fill="${escHTML(dotFill)}"/>`;
    g += `<circle cx="${pt.x.toFixed(2)}" cy="${pt.y.toFixed(2)}" r="0.1" fill="none" stroke="#ffffff" stroke-width="0.022"/>`;
    g += `<text x="${chosen.lx.toFixed(2)}" y="${chosen.ly.toFixed(2)}" font-size="${F.pt}" fill="#123a44" text-anchor="${chosen.anchor}" font-weight="600" style="paint-order:stroke;stroke:#ffffff;stroke-width:0.1;stroke-linejoin:round">${escHTML(label)}</text>`;
  });

  const pxW = Math.max(460, Math.round(Wcm * 26));
  const pxH = Math.round(pxW * Hcm / Wcm);

  return `<svg class="paper-svg" viewBox="0 0 ${Wcm} ${Hcm}" width="${pxW}" height="${pxH}" preserveAspectRatio="xMidYMid meet" font-family='${SVG_FONT}' role="img" aria-label="智能纸图">${g}</svg>`;
}

/** 全站仪：平面坐标纸图 */
function paperTotalModel(p, Wcm, Hcm) {
  const pts = [];
  (p.rows || []).forEach((r, i) => {
    const n = Core.num(r.n), e = Core.num(r.e);
    if (n === null || e === null) return;
    pts.push({
      id: r.id,
      no: (r.no || '').trim() || String(i + 1),
      n, e,
      color: typeColorOf(effectiveTypeId(r))
    });
  });
  if (!pts.length) return { error: '还没有有效的坐标点，先在数据表里填好 N / E。' };

  const { plotW, plotH } = paperPlot(Wcm, Hcm);
  if (plotW < 4 || plotH < 4) return { error: '纸张太小，宽高都请设到 8 cm 以上。' };

  const ax = fitPlane(
    Math.min(...pts.map(x => x.e)), Math.max(...pts.map(x => x.e)),
    Math.min(...pts.map(x => x.n)), Math.max(...pts.map(x => x.n)),
    plotW, plotH
  );

  const { k, e0, e1, n0, n1 } = ax;
  const fw = (e1 - e0) / k;
  const fh = (n1 - n0) / k;
  const left = PAPER_M.l + (plotW - fw) / 2;
  const top = PAPER_M.t + (plotH - fh) / 2;

  const X = e => left + (e - e0) / k;
  const Y = n => top + fh - (n - n0) / k;

  const mPts = pts.map(pt => ({
    id: pt.id,
    no: pt.no,
    n: pt.n,
    e: pt.e,
    color: pt.color,
    x: X(pt.e),
    y: Y(pt.n),
    ax: (pt.e - e0) / k,
    ay: (pt.n - n0) / k
  }));

  const byId = new Map(mPts.map(x => [x.id, x]));
  const segs = (p.links || []).map(l => {
    const a = byId.get(l.a), b = byId.get(l.b);
    return (a && b) ? { a, b } : null;
  }).filter(Boolean);

  // 坐标轴直接标纸面尺寸（cm）：图框左边为 0，向右 / 向上数到 fw、fh
  const cmStep = fw <= 12 ? 1 : fw <= 24 ? 2 : 5;
  const cmStepY = fh <= 12 ? 1 : fh <= 24 ? 2 : 5;

  const svg = paperSvg({
    Wcm, Hcm, left, top, fw, fh,
    xMin: 0, xMax: fw, yMin: 0, yMax: fh,
    xStep: cmStep, yStep: cmStepY, kx: 1, ky: 1,
    pts: mPts, segs,
    title: `${p.name || '未命名工作'} · 平面坐标图`,
    subtitle: `比例 1:${Math.round(k * 100)}　纸上 1 cm = ${trimNum(k)} m　图幅 ${trimNum(Wcm, 1)} × ${trimNum(Hcm, 1)} cm`,
    xTitle: '距左轴 / cm',
    yTitle: '距下轴 / cm'
  });

  return {
    svg,
    width: trimNum(Wcm, 1),
    height: trimNum(Hcm, 1),
    dense: mPts.length > PAPER_LABEL_MAX,
    scaleText: `比例 1:${Math.round(k * 100)}（纸上 1 cm = ${trimNum(k)} m）`,
    pointTable: {
      head: ['点号', '距左轴 (cm)', '距下轴 (cm)', 'N (m)', 'E (m)'],
      rows: mPts.map(pt => [pt.no, pt.ax.toFixed(2), pt.ay.toFixed(2), m3(pt.n), m3(pt.e)])
    },
    segText: segs.map(s => `${s.a.no}→${s.b.no}　${Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y).toFixed(2)} cm`)
  };
}

/** 水准测量：里程—高程纸图（纵横比例可不同） */
function paperLevelModel(p, Wcm, Hcm) {
  const rows = p.rows || [];
  const meta = p.meta || {};
  const lv = Core.computeLevel(rows, levelCalcMeta(meta));
  const names = levelPointNames(rows, meta);

  if (lv.startH === null) return { error: '还没有起点高程 H始，先填上才能按比例出图。' };

  const dists = rows.map(r => Core.levelSegDist(r));
  const missing = dists.filter(d => !(d > 0)).length;
  if (missing) return { error: `还有 ${missing} 个测段没填距离；按比例出图要求每段都有距离。` };

  let cum = 0;
  const pts = [{ x: 0, H: lv.startH, no: names[0] || '起点' }];
  lv.rows.forEach((r, i) => {
    cum += dists[i];
    if (r.H === null) return;
    pts.push({ x: cum, H: r.H, no: names[i + 1] || (rows[i].no || '').trim() || String(i + 1) });
  });
  if (pts.length < 2) return { error: '至少要有两个点（起点 + 一个测段）才能画出剖面。' };

  const { plotW, plotH } = paperPlot(Wcm, Hcm);
  if (plotW < 4 || plotH < 4) return { error: '纸张太小，宽高都请设到 8 cm 以上。' };

  const xMaxRaw = pts[pts.length - 1].x;
  const hs = pts.map(t => t.H);
  const hMinRaw = Math.min(...hs), hMaxRaw = Math.max(...hs);

  const axisX = fitAxis(0, xMaxRaw, plotW);
  const axisY = fitAxis(hMinRaw, hMaxRaw, plotH);
  const { k: kh, step: xStep, lo: x0, hi: x1 } = axisX;
  const { k: kv, step: yStep, lo: y0, hi: y1 } = axisY;

  const fw = (x1 - x0) / kh;
  const fh = (y1 - y0) / kv;
  const left = PAPER_M.l + (plotW - fw) / 2;
  const top = PAPER_M.t + (plotH - fh) / 2;

  const X = v => left + (v - x0) / kh;
  const Y = v => top + fh - (v - y0) / kv;

  const mPts = pts.map(pt => ({
    no: pt.no,
    mile: pt.x,
    elev: pt.H,
    x: X(pt.x),
    y: Y(pt.H),
    ax: (pt.x - x0) / kh,
    ay: (pt.H - y0) / kv
  }));

  const segs = [];
  for (let i = 1; i < mPts.length; i++) segs.push({ a: mPts[i - 1], b: mPts[i] });

  const exagg = kh / kv;

  // 坐标轴标纸面尺寸（cm）：图框左边 0，向右到 fw；下边 0，向上到 fh
  const cmStepX = fw <= 12 ? 1 : fw <= 24 ? 2 : 5;
  const cmStepY = fh <= 12 ? 1 : fh <= 24 ? 2 : 5;

  const svg = paperSvg({
    Wcm, Hcm, left, top, fw, fh,
    xMin: 0, xMax: fw, yMin: 0, yMax: fh,
    xStep: cmStepX, yStep: cmStepY, kx: 1, ky: 1,
    pts: mPts, segs,
    title: `${p.name || '未命名工作'} · 里程-高程剖面`,
    subtitle: `横向 1:${Math.round(kh * 100)}（1 cm = ${trimNum(kh)} m）　纵向 1:${Math.round(kv * 100)}（1 cm = ${trimNum(kv)} m）${exagg > 1.05 ? `　纵向放大 ${trimNum(exagg, 1)} 倍` : ''}`,
    xTitle: '距左轴 / cm',
    yTitle: '距下轴 / cm'
  });

  return {
    svg,
    width: trimNum(Wcm, 1),
    height: trimNum(Hcm, 1),
    dense: mPts.length > PAPER_LABEL_MAX,
    scaleText: `横向 1 cm = ${trimNum(kh)} m　纵向 1 cm = ${trimNum(kv)} m`,
    note: exagg > 1.05 ? `纵向放大 ${trimNum(exagg, 1)} 倍` : '',
    verticalNote: exagg > 1.05,
    pointTable: {
      head: ['点号', '里程 (m)', '高程 (m)', '距左轴 (cm)', '距下轴 (cm)'],
      rows: mPts.map(pt => [pt.no, m3(pt.mile), m3(pt.elev), pt.ax.toFixed(2), pt.ay.toFixed(2)])
    },
    segText: segs.map(s => {
      const dx = Math.abs(s.b.x - s.a.x).toFixed(2);
      const dy = Math.abs(s.b.y - s.a.y).toFixed(2);
      return `${s.a.no}→${s.b.no}　横 ${dx} / 竖 ${dy} cm`;
    })
  };
}

/* ---------- 智能纸图：弹窗与渲染 ---------- */
function openPaperDialog() {
  const p = Store.get(expUI.id);
  if (!p) return;

  const kind = p.kind || 'total';
  if (kind === 'angle') { toast('智能纸图仅支持水准测量与全站仪测绘'); return; }

  showModal({
    title: '智能纸图',
    okText: '生成纸图',
    body: `
      <p class="paper-lead">输入你打算在纸上画多大（单位 cm）。程序据此选一个整比比例，并算出每个点、每条线在纸上的实际长度。</p>
      <div class="paper-presets">
        <button type="button" class="dflt-chip" data-preset="26,18">A4 横 26×18</button>
        <button type="button" class="dflt-chip" data-preset="18,26">A4 竖 18×26</button>
        <button type="button" class="dflt-chip" data-preset="16,11">手册 16×11</button>
      </div>
      <div class="field-row" style="margin-top:12px">
        <label class="field">
          <span class="field-label">纸宽 (cm)</span>
          <input id="paperW" class="text-input" type="text" inputmode="decimal" value="${expUI.paperW}" />
        </label>
        <label class="field">
          <span class="field-label">纸高 (cm)</span>
          <input id="paperH" class="text-input" type="text" inputmode="decimal" value="${expUI.paperH}" />
        </label>
      </div>
      <p class="kw-hint">提示：图框的左边与下边就是 N 轴和 E 轴（水准为高程轴和里程轴），绘制时先画框、再按「距轴 cm」逐点量取。</p>`,
    onMount: (body) => {
      $$('[data-preset]', body).forEach(b => {
        b.addEventListener('click', () => {
          const [w, h] = b.dataset.preset.split(',');
          const we = $('#paperW', body), he = $('#paperH', body);
          if (we) we.value = w;
          if (he) he.value = h;
        });
      });
    }
  }).then(ok => {
    if (!ok) return;
    const we = $('#paperW'), he = $('#paperH');
    const Wcm = clamp(Core.num(we ? we.value : null) || 20, 8, 120);
    const Hcm = clamp(Core.num(he ? he.value : null) || 15, 8, 120);
    expUI.paperW = Wcm;
    expUI.paperH = Hcm;

    const model = kind === 'level' ? paperLevelModel(p, Wcm, Hcm) : paperTotalModel(p, Wcm, Hcm);
    renderPaper(model);

    if (!model.error) {
      const box = $('#expPaper');
      if (box && box.scrollIntoView) box.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });
}

function renderPaper(model) {
  const box = $('#expPaper');
  if (!box) return;

  if (!model || model.error) {
    box.innerHTML = model && model.error
      ? `<div class="card"><p class="exp-none">${escHTML(model.error)}</p></div>`
      : '';
    return;
  }

  box.innerHTML = `
    <div class="card exp-card">
      <div class="exp-head">
        <div class="exp-head-text">
          <h3 class="exp-title">智能纸图 · ${model.width} × ${model.height} cm</h3>
          <p class="exp-sub">${escHTML(model.scaleText)}${model.note ? ' · ' + escHTML(model.note) : ''}</p>
        </div>
        <span class="badge">按比例</span>
      </div>

      <p class="paper-lead">图框左边与下边就是坐标轴，浅灰虚线是每个点平行于坐标轴的辅助线。先按尺寸画好图框，再用直尺照下表量取；${model.verticalNote ? '纵横比例不同，量取请分别按「横」「竖」两列；' : ''}${model.dense ? '点数较多，图上只画点，辅助虚线按间隔抽取，点号请看下表；' : ''}图幅较宽时可左右滑动查看。</p>

      <div class="paper-wrap">${model.svg}</div>

      <div class="exp-actions">
        <button class="btn btn-ghost" id="paperReset">改尺寸</button>
        <button class="btn btn-primary" id="paperPng">导出为图片</button>
      </div>

      <p class="exp-table-title">纸上量取（单位 cm）</p>
      <div class="sheet-wrap"><table class="exp-table">
        <thead><tr>${model.pointTable.head.map(h => `<th>${escHTML(h)}</th>`).join('')}</tr></thead>
        <tbody>${model.pointTable.rows.map(r => `<tr>${r.map(c => `<td>${escHTML(c)}</td>`).join('')}</tr>`).join('')}</tbody>
      </table></div>

      ${model.segText.length ? `
        <p class="exp-table-title">线段纸上长度</p>
        <p class="paper-segs">${model.segText.map(s => `<span>${escHTML(s)}</span>`).join('')}</p>` : ''}
    </div>`;

  const png = $('#paperPng');
  if (png) png.addEventListener('click', () => exportPaperPNG(model));

  const reset = $('#paperReset');
  if (reset) reset.addEventListener('click', () => openPaperDialog());
}

async function exportPaperPNG(model) {
  const { w, h } = svgSize(model.svg);   // 单位 cm
  const S = 56;                          // 每厘米 56 px，A4 横向约 1450 px
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * S);
  canvas.height = Math.round(h * S);

  const ctx = canvas.getContext('2d');
  if (!ctx) { toast('当前环境不支持导出图片'); return; }

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  let img;
  try { img = await loadSvgImage(model.svg); }
  catch (e) { toast('图片生成失败：' + (e.message || '当前环境不支持')); return; }

  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  const p = Store.get(expUI.id);
  const name = p ? (p.name || '工作') : '工作';
  await deliverCanvas(canvas, safeFileName(name) + '-智能纸图.png');
}

/* ------------------------------------------------------------
 * 16. 关于页：使用说明
 * ---------------------------------------------------------- */
function showGuide() {
  showModal({
    title: '如何使用「测策」',
    hideOk: true,
    okText: '知道了',
    body: `
      <p><b>① 全站仪测绘</b></p>
      <p>在表格里填点号、N/E 坐标，右侧（竖屏为下方）会实时成点并自动缩放到合适视野。</p>
      <p>· 点号留空时，程序会按"上一个数字点号 +1"给一个浅灰预测值，直接跳到别的格子就会把它落成实际点号。<br/>
         · 点「连线」后可依次点选多个点，程序按点选顺序把相邻两点连成折线，点 ✓ 确认（再点一次已选点可取消它）。<br/>
         · 连线模式下点中一条线会高亮，再点一次可改颜色或删除。<br/>
         · 点「编辑点」后点中一个点，再点一次可修改它的点位类型，点号颜色随之改变。<br/>
         · 备注里写"控制""原""搬站"等关键词，程序会自动归类。<br/>
         · 新建点位默认用哪个类型，到「关于程序 → 程序设置」点「修改」，勾上<b>「选择该点为默认点」</b>即可；默认点只保留一个，设了新的，旧的自动取消。</p>
      <p><b>② 水准测量</b></p>
      <p>新建时填<b>起点高程</b>与<b>容许闭合差系数</b>（如 40 → f_h允 = 40√L，L 为测段距离合计 km）。表按手簿样式排：每测站占两行（后视点 / 前视点），<b>两行的视距各填各的</b>，后视读数与前视读数四格都能填——填错位置或只填一边时，表下会提示哪一站还算不出高差。点号默认<b>留空</b>，照着外业手簿填即可。<br/>闭合还是附合<b>不用切</b>：标题栏的「H终」留空（或填得与起点相同）就按<b>闭合</b>算，填了不同的终点已知高程就自动按<b>附合</b>算，旁边的标记会跟着变。只有起点「高程」格是输入格，其余点由程序推算。每站右侧「编辑」可上下移动该站（排序）或删除（会再确认一次）；「容差」按钮随时可改容许闭合差系数。</p>
      <p><b>③ 角度测量</b></p>
      <p>表按手簿样式排：每个测回占四行（左 A / 左 B / 右 A / 右 B），读数按「度 / 分 / 秒」分三格填。<b>「增加测回」留在同一测站，「增加测站」另起一站</b>；测站整站共享一格，「各测回平均角值」按站各自一格，不会跨站合并。半测回角值、角度之差、一测回角值、测回间较差都写在「右」那一块，左块只出半测回角值。每行的「编辑」可把整站上下移动，或删掉这一测回（会再确认一次）。</p>
      <p><b>④ 数据分析</b></p>
      <p>先按<b>工作类型</b>（全部 / 全站仪 / 水准 / 角度）缩小范围，再点开某一份工作，进入它<b>自己的分析页</b>——那一页只放这份工作的图、表与导出，不会再出现别的工作。<br/>可导出为图片、导出为 CSV；水准与全站仪还能生成「智能纸图」，按你输入的纸张尺寸换算比例，坐标轴直接用纸面 cm 标度，照着在纸上画即可。</p>
      <p><b>⑤ 数据安全</b></p>
      <p>所有数据都存在本机。换设备或卸载前，记得在工作页右上角「导出」备份。</p>`
  });
}

/* ------------------------------------------------------------
 * 17. 事件绑定与启动
 * ---------------------------------------------------------- */
function bindEvents() {
  /* 全局导航 */
  document.addEventListener('click', e => {
    // 数据分析列表页：切换工作类型
    const kindBtn = e.target.closest('[data-ekind]');
    if (kindBtn) {
      e.preventDefault();
      if (expUI.kind !== kindBtn.dataset.ekind) {
        expUI.kind = kindBtn.dataset.ekind;
        renderExport();
      }
      return;
    }

    // 数据分析列表页：点开某份工作 → 进入它自己的分析页
    const expItem = e.target.closest('[data-exp]');
    if (expItem) {
      e.preventDefault();
      navigate('analysis/' + encodeURIComponent(expItem.dataset.exp));
      return;
    }

    const nav = e.target.closest('[data-nav]');
    if (nav) {
      // 空分类里的「新建某类型工作」：先把类型预选好
      if (nav.dataset.kind) newKind = nav.dataset.kind;
      navigate(nav.dataset.nav);
      return;
    }
  });

  window.addEventListener('hashchange', handleRoute);

  /* 新建工作 */
  const picker = $('#kindPicker');
  if (picker) {
    picker.addEventListener('click', e => {
      const card = e.target.closest('.kind-card');
      if (card) pickKind(card.dataset.kind);
    });
  }

  const createBtn = $('#createBtn');
  if (createBtn) createBtn.addEventListener('click', createWork);

  const nameEl = $('#newName');
  if (nameEl) nameEl.addEventListener('keydown', e => { if (e.key === 'Enter') createWork(); });

  /* 工作管理 */
  const importBtn = $('#importBtn');
  const importFileEl = $('#importFile');
  if (importBtn && importFileEl) {
    importBtn.addEventListener('click', () => importFileEl.click());
    importFileEl.addEventListener('change', e => {
      const file = e.target.files && e.target.files[0];
      if (file) importFile(file);
      e.target.value = '';
    });
  }

  const search = $('#searchInput');
  if (search) {
    search.addEventListener('input', () => {
      worksUI.q = search.value;
      const clr = $('#searchClear');
      if (clr) clr.hidden = !search.value;
      renderWorks();
    });
  }

  const searchClear = $('#searchClear');
  if (searchClear) {
    searchClear.addEventListener('click', () => {
      const s = $('#searchInput');
      if (s) s.value = '';
      worksUI.q = '';
      searchClear.hidden = true;
      renderWorks();
    });
  }

  const sortSel = $('#sortSelect');
  if (sortSel) {
    sortSel.addEventListener('change', () => {
      worksUI.sort = sortSel.value;
      renderWorks();
    });
  }

  const filterBar = $('#filterBar');
  if (filterBar) {
    filterBar.addEventListener('click', e => {
      const b = e.target.closest('.filter-chip');
      if (!b) return;
      if (b.dataset.fkind) worksUI.kind = b.dataset.fkind;
      renderWorks();
    });
  }

  const batchBtn = $('#batchBtn');
  if (batchBtn) {
    batchBtn.addEventListener('click', () => {
      worksUI.batch = !worksUI.batch;
      if (!worksUI.batch) worksUI.sel.clear();
      renderWorks();
    });
  }

  const selectAll = $('#selectAllBtn');
  if (selectAll) {
    selectAll.addEventListener('click', () => {
      const list = filteredWorks();
      const allSel = list.length > 0 && list.every(m => worksUI.sel.has(m.id));
      if (allSel) list.forEach(m => worksUI.sel.delete(m.id));
      else list.forEach(m => worksUI.sel.add(m.id));
      renderWorks();
    });
  }

  const bDel = $('#batchDelete'), bExp = $('#batchExport'), bExit = $('#batchExit');
  if (bDel) bDel.addEventListener('click', batchDelete);
  if (bExp) bExp.addEventListener('click', () => {
    const ids = Array.from(worksUI.sel);
    if (!ids.length) { toast('请先选择工作'); return; }
    exportBundle(ids);
  });
  if (bExit) bExit.addEventListener('click', exitBatch);

  /* 工作区顶栏 */
  const wsBack = $('#wsBack');
  if (wsBack) wsBack.addEventListener('click', () => { saveNow(); navigate('works'); });

  const wsSave = $('#wsSave');
  if (wsSave) wsSave.addEventListener('click', manualSave);

  const wsExport = $('#wsExport');
  if (wsExport) {
    wsExport.addEventListener('click', () => {
      if (!ws.project) return;
      saveNow();
      exportProject(ws.project);
    });
  }

  /* 设置页 */
  const addType = $('#addTypeBtn');
  if (addType) addType.addEventListener('click', () => editType(''));

  /* 数据分析 */
  const expBack = $('#expBack');
  if (expBack) expBack.addEventListener('click', () => navigate('export'));

  /* 关于页 */
  const guide = $('#openGuide');
  if (guide) guide.addEventListener('click', showGuide);

  /* 窗口尺寸 */
  let resizeTimer = 0;
  const onResize = () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (currentScreen !== 'project' || ws.kind !== 'total') return;
      ws.view.manual = false;
      ws.view.ready = false;
      drawChart({ fit: true });
    }, 90);
  };
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', onResize);
  if (window.visualViewport) window.visualViewport.addEventListener('resize', onResize);

  /* 快捷键 */
  document.addEventListener('keydown', e => {
    if (currentScreen !== 'project') return;
    const tag = (e.target.tagName || '').toUpperCase();
    const inField = tag === 'INPUT' || tag === 'TEXTAREA';

    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      manualSave();
      return;
    }
    if (inField) return;
    if (ws.kind !== 'total') return;

    if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomCenter(1.28); }
    else if (e.key === '-' || e.key === '_') { e.preventDefault(); zoomCenter(1 / 1.28); }
    else if (e.key === '0') { e.preventDefault(); resetView(); }
  });

  /* 离开前保存 */
  window.addEventListener('beforeunload', () => {
    if (ws.project && ws.dirty) saveNow();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && ws.project && ws.dirty) saveNow();
  });
}

function boot() {
  if (!Core) {
    document.body.innerHTML = '<p style="padding:24px;font-family:sans-serif">资源加载失败：缺少 core.js，请重新安装程序。</p>';
    return;
  }

  Store.migrateIndex();
  migrateSettings();
  renderHomeFoot();
  bindEvents();

  if (!location.hash) history.replaceState(null, '', '#/');
  handleRoute();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
