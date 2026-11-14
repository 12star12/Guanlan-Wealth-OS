'use strict';

/* ============================================================
   观澜 · 渲染进程
   只负责展示与交互，所有计算在主进程完成
   ============================================================ */

const $ = (id) => document.getElementById(id);

let ACCOUNTS = [];

/* ---------------- 基础工具 ---------------- */

function money(fen) {
  const y = (fen || 0) / 100;
  return y.toLocaleString('zh-CN', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function pct(x, digits = 0) {
  if (x === null || x === undefined) return '—';
  return (x * 100).toFixed(digits);
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

const CN_DIGIT = ['〇', '一', '二', '三', '四', '五', '六', '七', '八', '九'];

function yearCN(y) {
  return String(y).split('').map((c) => CN_DIGIT[+c]).join('');
}

function numCN(n) {
  if (n <= 0) return '〇';
  if (n <= 10) return n === 10 ? '十' : CN_DIGIT[n];
  if (n < 20) return '十' + CN_DIGIT[n % 10];
  if (n < 100) {
    const t = Math.floor(n / 10);
    const o = n % 10;
    return CN_DIGIT[t] + '十' + (o ? CN_DIGIT[o] : '');
  }
  return String(n);
}

function pad2(n) { return String(n).padStart(2, '0'); }

function dateStr(d = new Date()) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function todayCN() {
  const d = new Date();
  const week = ['日', '一', '二', '三', '四', '五', '六'][d.getDay()];
  return `${yearCN(d.getFullYear())}年 ${numCN(d.getMonth() + 1)}月${numCN(d.getDate())}日<br>星期${week}`;
}

function clockCN() {
  const d = new Date();
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日 · ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function lunarSeal() {
  const now = new Date();
  const y = now.getFullYear();
  const gan = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸'];
  const zhi = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'];
  const m = now.getMonth() + 1;
  const mName = ['正', '二', '三', '四', '五', '六', '七', '八', '九', '十', '冬', '腊'][(m - 2 + 12) % 12];
  return `${gan[(y - 4) % 10]}${zhi[(y - 4) % 12]}年${mName}月`;
}

/* ---------------- 视图切换 ---------------- */

const navLinks = Array.from(document.querySelectorAll('nav a'));
const views = {
  ledger: $('view-ledger'),
  assets: $('view-assets'),
  add: $('view-add'),
  list: $('view-list'),
  report: $('view-report'),
};

function show(view) {
  navLinks.forEach((a) => a.classList.toggle('on', a.dataset.view === view));
  Object.entries(views).forEach(([k, el]) => { el.hidden = k !== view; });
  window.scrollTo(0, 0);
  if (view === 'assets') loadAssets();
  if (view === 'list') loadList();
  if (view === 'add') setTimeout(() => $('nl-input').focus(), 30);
  if (view === 'report') loadReport();
}

navLinks.forEach((a) => a.addEventListener('click', () => show(a.dataset.view)));

// 任何带 data-goto 的元素都能跳视图，例如首页的净资产
document.querySelectorAll('[data-goto]').forEach((el) => {
  el.addEventListener('click', () => show(el.dataset.goto));
});

/* ---------------- 账户 ---------------- */

const assetAccts = () => ACCOUNTS.filter((a) => a.type === 'asset' && !a.archived);
const liabAccts = () => ACCOUNTS.filter((a) => a.type === 'liability' && !a.archived);
const payAccts = () => [...assetAccts(), ...liabAccts()];
const catAccts = (kind) => ACCOUNTS.filter(
  (a) => a.type === (kind === 'income' ? 'income' : 'expense') && !a.archived
);

function nameOf(id) {
  return (ACCOUNTS.find((a) => a.id === id) || {}).name || id;
}

function fillSelect(sel, list, value) {
  const keep = value !== undefined ? value : sel.value;
  sel.innerHTML = list.map((a) => `<option value="${a.id}">${esc(a.name)}</option>`).join('');
  if (list.some((a) => a.id === keep)) sel.value = keep;
  else if (list.length) sel.value = list[0].id;
}

/* ---------------- 资产 ---------------- */

/** 数字：不带货币符号，负号用减号，整数不显示小数 */
function num(fen) {
  const y = Math.abs(fen || 0) / 100;
  const s = Number.isInteger(y)
    ? y.toLocaleString('zh-CN')
    : y.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (fen < 0 ? '−' : '') + s;
}

function aMsg(text) {
  const el = $('a-msg');
  el.textContent = text || '';
  clearTimeout(aMsg.timer);
  if (text) aMsg.timer = setTimeout(() => { el.textContent = ''; }, 2600);
}

async function loadAssets() {
  const v = await window.api.getAssets();
  renderAssets(v);
  return v;
}

/** 账户变了之后，记账页的下拉也要跟着变 */
async function refreshAccounts() {
  ACCOUNTS = await window.api.listAccounts();
  syncForm();
}

function renderAssets(v) {
  const box = $('a-list');
  box.innerHTML = '';

  const group = (title, list, total) => {
    const g = document.createElement('div');
    g.className = 'a-group';

    const head = document.createElement('div');
    head.className = 'a-head';
    head.innerHTML = `<span>${title}</span><span class="a-sum">${num(total)}</span>`;
    g.appendChild(head);

    if (!list.length) {
      const e = document.createElement('div');
      e.className = 'a-empty';
      e.textContent = '还没有';
      g.appendChild(e);
    }

    list.forEach((item) => g.appendChild(assetRow(item)));
    box.appendChild(g);
  };

  group('资 产', v.assets, v.totalAssets);
  group('负 债', v.liabilities, v.totalLiabilities);

  // 全零 = 还没填过，给一句提示；填过之后永远不再出现
  $('a-firstrun').hidden = !(v.totalAssets === 0 && v.totalLiabilities === 0);

  $('a-net').textContent = '¥' + num(v.netWorth);
}

function assetRow(item) {
  const row = document.createElement('div');
  row.className = 'a-row';
  row.dataset.id = item.id;

  const name = document.createElement('span');
  name.className = 'a-name';
  name.textContent = item.name;
  name.title = '点一下改名';
  name.addEventListener('click', () => editName(row, item));

  // 余额是一个常驻输入框，不是「点出来」的 —— 看不见入口等于不能改
  const field = document.createElement('input');
  field.className = 'a-field';
  field.inputMode = 'decimal';
  field.autocomplete = 'off';
  field.value = item.type === 'liability' ? `欠 ${num(item.balance)}` : num(item.balance);
  field.title = '直接改，回车或点别处存下';
  field.addEventListener('focus', () => {
    field.value = String(item.balance / 100);
    field.select();
  });
  field.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); field.blur(); }
    else if (e.key === 'Escape') { e.preventDefault(); field.value = item.type === 'liability' ? `欠 ${num(item.balance)}` : num(item.balance); field.blur(); }
  });
  field.addEventListener('blur', async () => {
    const raw = String(field.value).replace(/[,，\s¥￥欠]/g, '');
    const yuan = Number(raw);

    if (raw === '' || !Number.isFinite(yuan)) {
      field.value = item.type === 'liability' ? `欠 ${num(item.balance)}` : num(item.balance);
      aMsg('没看懂这个数');
      return;
    }

    if (Math.round(yuan * 100) === item.balance) {
      field.value = item.type === 'liability' ? `欠 ${num(item.balance)}` : num(item.balance);
      return;
    }

    const r = await window.api.setBalance({ id: item.id, amount: yuan });
    if (!r.ok) aMsg(r.reason || '没改成');

    const view = await loadAssets();
    await loadDashboard();
    // 重渲染之后焦点会丢，这里不抢焦点，等用户自己点下一个
    return view;
  });

  const del = document.createElement('button');
  del.className = 'a-del';
  del.textContent = '×';
  del.title = '移除';
  del.addEventListener('click', () => dropAccount(item));

  row.append(name, field, del);
  return row;
}

function editName(row, item) {
  const cell = row.querySelector('.a-name');
  if (!cell || cell.querySelector('input')) return;

  const input = document.createElement('input');
  input.className = 'a-input a-input-name';
  input.value = item.name;
  cell.textContent = '';
  cell.appendChild(input);
  input.focus();
  input.select();

  let settled = false;
  const finish = async (save) => {
    if (settled) return;
    settled = true;

    const name = input.value.trim();
    if (!save || !name || name === item.name) { await loadAssets(); return; }

    const r = await window.api.renameAccount({ id: item.id, name });
    if (!r.ok) aMsg(r.reason || '没改成');

    await refreshAccounts();
    await loadAssets();
  };

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
  });
  input.addEventListener('blur', () => finish(true));
}

async function dropAccount(item) {
  const ok = confirm(`移除「${item.name}」？\n\n如果这个账户已经有记录，只会隐藏起来，历史账目不动。`);
  if (!ok) return;

  const r = await window.api.removeAccount({ id: item.id });
  if (!r.ok) { aMsg(r.reason || '没移除'); return; }

  aMsg(r.archived ? '已隐藏，历史还在' : '已移除');
  await refreshAccounts();
  await loadAssets();
  await loadDashboard();
}

$('btn-new').addEventListener('click', () => {
  const f = $('new-form');
  f.hidden = !f.hidden;
  if (!f.hidden) $('new-name').focus();
});

$('new-type').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  Array.from($('new-type').children).forEach((x) => x.classList.toggle('on', x === b));
});

async function addAccount() {
  const name = $('new-name').value.trim();
  if (!name) { aMsg('名字还没填'); return; }

  const type = document.querySelector('#new-type button.on').dataset.type;
  const r = await window.api.addAccount({ name, type });
  if (!r.ok) { aMsg(r.reason || '没加成'); return; }

  $('new-name').value = '';
  $('new-form').hidden = true;
  aMsg('加好了，点数字填余额');

  await refreshAccounts();
  await loadAssets();
}

$('btn-new-ok').addEventListener('click', addAccount);
$('new-name').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); addAccount(); }
});

/* ---------------- 账簿 ---------------- */

let lastDashboard = null;

async function loadDashboard() {
  const d = await window.api.getDashboard();
  lastDashboard = d;

  $('networth').textContent = '¥' + money(d.netWorth);
  $('networth-note').innerHTML = d.net >= 0
    ? `本月结余 <b>+ ¥${money(d.net)}</b>`
    : `本月结余 <i>− ¥${money(-d.net)}</i>`;

  $('runway').innerHTML = (d.runway === null || d.runway === undefined)
    ? '—'
    : `${d.runway.toFixed(1)}<span class="u">个月</span>`;

  $('debt').innerHTML = d.debtRatio === null
    ? '—'
    : `${pct(d.debtRatio)}<span class="u">%</span>`;

  $('debt-note').textContent = d.debtRatio === null
    ? '暂无资产可比'
    : (d.debtRatio < 0.3 ? '低 · 安全区间' : d.debtRatio < 0.6 ? '中 · 需留意' : '高 · 建议优先处理');

  if (d.quote) {
    $('q-text').textContent = d.quote.text;
    $('q-src').textContent = d.quote.author
      ? `${d.quote.author} · ${d.quote.source}`
      : d.quote.source;
    $('quote').hidden = false;
  }

  if (d.gainsLine) {
    $('gains-line').hidden = false;
    $('gains-text').textContent = d.gainsLine;
  } else {
    $('gains-line').hidden = true;
  }

  $('days-stamp').textContent = `本月已记 ${d.daysRecorded} 天`;
  $('ledger-sub').textContent = `本月 · 收入 ¥${money(d.inflow)}　支出 ¥${money(d.outflow)}`;

  renderRows($('recent-rows'), d.recent);
  $('notice').hidden = !d.hasDemo;

  return d;
}

function renderRows(container, rows, opts = {}) {
  container.innerHTML = '';
  container.classList.toggle('with-del', !!opts.deletable);

  if (!rows.length) {
    container.innerHTML = '<div class="row empty">还没有记录</div>';
    return;
  }

  rows.forEach((r) => {
    const el = document.createElement('div');
    el.className = 'row';

    const plain = r.kind === 'transfer' || r.kind === 'opening' || r.kind === 'adjust';
    const sign = plain ? '' : (r.isIncome ? '+' : '−');
    el.innerHTML = `
      <div class="d">${esc(r.day)}</div>
      <div class="t">${esc(r.title)}</div>
      <div class="tagcell"><span class="tag ${r.cls}">${esc(r.tag)}</span></div>
      <div class="a ${r.isIncome ? 'in' : 'out'}">${sign}${money(Math.abs(r.amount))}</div>
    `;

    if (opts.deletable) {
      const b = document.createElement('button');
      b.className = 'del';
      b.textContent = '×';
      b.title = '删除这一笔';
      b.addEventListener('click', () => opts.onDelete(r));
      el.appendChild(b);
    }

    container.appendChild(el);
  });
}

/* ---------------- 流水 ---------------- */

async function loadList() {
  const rows = await window.api.listTransactions({ limit: 500 });
  renderRows($('all-rows'), rows, {
    deletable: true,
    onDelete: async (r) => {
      const ok = confirm(`删除「${r.title}」这笔记录？\n\n删除后余额会重新计算。`);
      if (!ok) return;
      await window.api.deleteTransaction(r.id);
      await loadList();
      await loadDashboard();
    },
  });

  $('list-sub').textContent = `共 ${rows.length} 笔 · 悬停行可删除`;
  const inflow = rows.filter((r) => r.isIncome).reduce((s, r) => s + r.amount, 0);
  const outflow = rows.filter((r) => !r.isIncome && r.kind !== 'transfer' && r.kind !== 'opening')
    .reduce((s, r) => s + r.amount, 0);
  $('list-sum').innerHTML = `收 ¥${money(inflow)}　支 ¥${money(outflow)}`;
}

/* ============================================================
   记一笔
   ============================================================ */

const form = {
  kind: 'expense',
  amount: null,           // 元
  categoryId: 'life',
  accountId: 'bank',
  fromAccountId: 'bank',
  toAccountId: 'alipay',
  date: dateStr(),
  note: '',
  touched: new Set(),     // 用户手动改过的字段，解析结果不再覆盖
};

const recentAdded = [];

function defaultCat(kind) {
  const list = catAccts(kind);
  return list.length ? list[0].id : (kind === 'income' ? 'salary' : 'life');
}

function syncForm() {
  // 类型
  document.querySelectorAll('#seg-kind button').forEach((b) => {
    b.classList.toggle('on', b.dataset.kind === form.kind);
  });

  // 显示哪些行
  $('row-cat').hidden = form.kind === 'transfer';
  $('row-to').hidden = form.kind !== 'transfer';
  $('lbl-acc').textContent = form.kind === 'transfer' ? '转出' : '账户';

  // 金额
  $('f-amount').value = form.amount === null ? '' : String(form.amount);

  // 分类
  if (form.kind !== 'transfer') {
    const list = catAccts(form.kind);
    if (!list.some((a) => a.id === form.categoryId)) form.categoryId = defaultCat(form.kind);
    fillSelect($('f-cat'), list, form.categoryId);
  }

  // 账户
  fillSelect($('f-acc'), payAccts(), form.kind === 'transfer' ? form.fromAccountId : form.accountId);
  if (form.kind === 'transfer') {
    fillSelect($('f-to'), payAccts(), form.toAccountId);
  }

  // 日期
  $('f-date').value = form.date;
  const today = dateStr();
  document.querySelectorAll('#seg-date button').forEach((b) => {
    const d = new Date();
    d.setDate(d.getDate() - Number(b.dataset.d));
    b.classList.toggle('on', dateStr(d) === form.date);
  });

  // 备注
  $('f-note').value = form.note;

  renderChips();
}

/* 解析预览 */
function renderChips(reason) {
  const row = $('parse-row');
  row.innerHTML = '<span class="chip k">解 析</span>';

  if (reason) {
    const s = document.createElement('span');
    s.className = 'chip muted';
    s.textContent = reason;
    row.appendChild(s);
    return;
  }

  if (form.amount === null) return;

  const kindName = { expense: '支出', income: '收入', transfer: '转账' }[form.kind];
  const chips = [kindName];

  if (form.kind === 'transfer') {
    chips.push(`${nameOf(form.fromAccountId)} → ${nameOf(form.toAccountId)}`);
  } else {
    chips.push(nameOf(form.categoryId), nameOf(form.accountId));
  }
  chips.push(`¥${form.amount}`);

  // 日期不是今天时单独标出来，避免记错日子
  if (form.date !== dateStr()) chips.push(form.date.slice(5).replace('-', '·'));

  chips.forEach((c) => {
    const s = document.createElement('span');
    s.className = 'chip';
    s.textContent = c;
    row.appendChild(s);
  });
}

let parseTimer = null;

$('nl-input').addEventListener('input', () => {
  clearTimeout(parseTimer);
  parseTimer = setTimeout(runParse, 90);
  setMsg('', '');
});

async function runParse() {
  const text = $('nl-input').value.trim();
  if (!text) { syncForm(); return; }

  const r = await window.api.parseTxn(text);
  if (!r.ok) { syncForm(); return; }

  const d = r.data;
  const T = form.touched;

  if (!T.has('kind')) form.kind = d.kind;
  if (!T.has('amount')) form.amount = d.amount / 100;

  if (d.kind === 'transfer') {
    if (!T.has('from')) form.fromAccountId = d.fromAccountId;
    if (!T.has('to')) form.toAccountId = d.toAccountId;
    form.accountId = form.fromAccountId;
  } else {
    if (!T.has('account')) form.accountId = d.accountId;
    if (!T.has('category')) form.categoryId = d.categoryId;
  }

  if (!T.has('note')) form.note = cleanNote(d.note);

  syncForm();
}

/** 「午饭25」→「午饭」：备注里不该重复金额 */
function cleanNote(raw) {
  return String(raw || '').replace(/\d+(?:\.\d{1,2})?/, '').replace(/\s+/g, ' ').trim();
}

/* 表单交互 */
$('seg-kind').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  form.kind = b.dataset.kind;
  form.touched.add('kind');
  form.categoryId = defaultCat(form.kind);
  form.touched.delete('category');
  syncForm();
});

$('seg-date').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  const d = new Date();
  d.setDate(d.getDate() - Number(b.dataset.d));
  form.date = dateStr(d);
  form.touched.add('date');
  syncForm();
});

$('f-date').addEventListener('change', () => {
  if ($('f-date').value) {
    form.date = $('f-date').value;
    form.touched.add('date');
    syncForm();
  }
});

$('f-amount').addEventListener('input', () => {
  const v = parseFloat($('f-amount').value);
  form.amount = Number.isFinite(v) ? v : null;
  form.touched.add('amount');
  renderChips();
});

$('f-cat').addEventListener('change', () => {
  form.categoryId = $('f-cat').value;
  form.touched.add('category');
  renderChips();
});

$('f-acc').addEventListener('change', () => {
  if (form.kind === 'transfer') {
    form.fromAccountId = $('f-acc').value;
    form.touched.add('from');
  } else {
    form.accountId = $('f-acc').value;
    form.touched.add('account');
  }
  renderChips();
});

$('f-to').addEventListener('change', () => {
  form.toAccountId = $('f-to').value;
  form.touched.add('to');
  renderChips();
});

$('f-note').addEventListener('input', () => {
  form.note = $('f-note').value;
  form.touched.add('note');
});

$('nl-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.isComposing) submit();
});

$('f-amount').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') submit();
});

$('f-note').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') submit();
});

$('btn-add').addEventListener('click', submit);

async function submit() {
  if (!(form.amount > 0)) {
    setMsg('先写个金额，比如「午饭25」', 'err');
    $('nl-input').focus();
    return;
  }
  if (form.kind === 'transfer' && form.fromAccountId === form.toAccountId) {
    setMsg('转出和转入是同一个账户', 'err');
    return;
  }

  const payload = {
    kind: form.kind,
    amount: form.amount,
    date: form.date,
    note: form.note,
    accountId: form.accountId,
    categoryId: form.categoryId,
    fromAccountId: form.fromAccountId,
    toAccountId: form.toAccountId,
  };

  const r = await window.api.addTxn(payload);
  if (!r.ok) {
    setMsg(r.reason || '没记上', 'err');
    return;
  }

  recentAdded.unshift(r.tx);
  renderRecentAdded();
  renderReceipt(r.receipt);

  // 不再单独报一句「净资产 ¥…」：回执本身就是回执，
  // 把钱的数字摆在收获前面，目光就又跑回钱上了。
  setMsg('', '');

  // 清掉金额和备注，表单其余部分保留；下次开始输入时解析结果可以重新覆盖
  form.amount = null;
  form.note = '';
  form.touched = new Set();
  $('nl-input').value = '';
  syncForm();
  $('nl-input').focus();

  await loadDashboard();
  if (!$('view-list').hidden) await loadList();
}

/** 回执卡：主语是「换来了什么」，金额是脚注 */
function renderReceipt(rec) {
  const box = $('receipt');
  if (!rec) { box.hidden = true; return; }

  box.hidden = false;
  box.dataset.tone = rec.tone || 'plain';

  $('r-badge').textContent = rec.badge;
  $('r-amt').textContent = (rec.tone === 'income' ? '+ ' : '') + '¥' + money(rec.amount);
  $('r-amt').className = 'r-amt' + (rec.tone === 'income' ? ' in' : '');

  const hasTitle = !!rec.title;
  $('r-kicker').hidden = !hasTitle;
  $('r-title').hidden = !hasTitle;
  if (hasTitle) $('r-title').textContent = rec.title;

  $('r-body').innerHTML = rec.lines
    .map((l, i) => `<div class="r-l${i ? ' dim' : ''}">${esc(l)}</div>`)
    .join('');
}

function renderRecentAdded() {
  const box = $('recent-add');
  $('recent-add-title').hidden = recentAdded.length === 0;
  box.hidden = recentAdded.length === 0;

  renderRows(box, recentAdded, {
    deletable: true,
    onDelete: async (r) => {
      await window.api.deleteTransaction(r.id);
      const i = recentAdded.findIndex((x) => x.id === r.id);
      if (i >= 0) recentAdded.splice(i, 1);
      renderRecentAdded();
      setMsg('已撤销', '');
      await loadDashboard();
    },
  });
}

function setMsg(text, type) {
  const el = $('msg');
  el.textContent = text;
  el.className = 'msg ' + (type || '');
}

$('btn-goto-ledger').addEventListener('click', () => show('ledger'));

/* ============================================================
   月度财报
   ============================================================ */

let reportMonth = null;

async function loadReport() {
  if (!reportMonth) {
    const n = new Date();
    reportMonth = { year: n.getFullYear(), month: n.getMonth() + 1 };
  }
  const r = await window.api.getReport(reportMonth);
  renderReport(r);
}

function shiftMonth(delta) {
  const d = new Date(reportMonth.year, reportMonth.month - 1 + delta, 1);
  reportMonth = { year: d.getFullYear(), month: d.getMonth() + 1 };
  loadReport();
}

$('m-prev').addEventListener('click', () => shiftMonth(-1));
$('m-next').addEventListener('click', () => shiftMonth(1));
$('btn-print').addEventListener('click', () => window.print());

/** 变化量：绿色 = 对净资产有利的方向，红色 = 相反。
 *  支出增加不利于净资产，所以它的「好方向」是向下。 */
function deltaCell(v, upGood = true) {
  if (v === 0) return '<span class="d-flat">持平</span>';
  const up = v > 0;
  const good = up === upGood;
  return `<span class="${good ? 'd-up' : 'd-down'}">${up ? '↑' : '↓'} ${money(Math.abs(v))}</span>`;
}

function renderReport(r) {
  const now = new Date();
  const isCurrent = reportMonth.year === now.getFullYear() && reportMonth.month === now.getMonth() + 1;
  $('m-next').disabled = isCurrent;

  $('m-label').textContent = `${r.year} · ${r.month} 月`;
  $('report-sub').textContent = r.isEmpty
    ? '本月还没有记录'
    : `${r.txnCount} 笔记录 · ${r.daysRecorded} 天`;

  const assetRows = r.assets.length
    ? r.assets.map((a) => `<tr><td>${esc(a.name)}${a.liquid ? '' : '<i class="sub">非流动</i>'}</td>
        <td class="n">${money(a.amount)}</td></tr>`).join('')
    : '<tr><td class="nil">暂无资产</td><td class="n">—</td></tr>';

  const liabRows = r.liabilities.length
    ? r.liabilities.map((a) => `<tr><td>${esc(a.name)}</td><td class="n">${money(a.amount)}</td></tr>`).join('')
    : '<tr><td class="nil">暂无负债</td><td class="n">0</td></tr>';

  const incomeRows = r.income.length
    ? r.income.map((x) => `<tr><td>${esc(x.name)}</td><td class="n">${money(x.amount)}</td></tr>`).join('')
    : '<tr><td class="nil">本月没有收入记录</td><td class="n">—</td></tr>';

  const expenseRows = r.expense.length
    ? r.expense.map((x) => `<tr><td>${esc(x.name)}</td><td class="n">${money(x.amount)}</td></tr>`).join('')
    : '<tr><td class="nil">本月没有支出记录</td><td class="n">—</td></tr>';

  const total = r.totalExpense || 0;

  // 这个月换来了什么 —— 财报的第二主角，排在收支明细之前
  const gains = r.gains || [];
  const growthInfo = r.growth;
  const gainRows = gains.map((g) => {
    const p = Math.round(g.share * 100);
    let note = `${g.count} 笔 · ${g.line}`;
    if (g.label === '能力' && growthInfo && growthInfo.daysSinceFirst >= 60) {
      note += ` 最早一次在 ${growthInfo.daysSinceFirst} 天前，至今 ${growthInfo.allCount} 次。`;
    }
    return `<div class="gain" data-label="${esc(g.label)}">
      <div class="g-head">
        <span class="g-label">${esc(g.label)}</span>
        <span class="g-amt">¥${money(g.amount)}</span>
        <span class="g-pct">${p}%</span>
      </div>
      <div class="bar"><i style="width:${p}%"></i></div>
      <div class="g-note">${esc(note)}</div>
    </div>`;
  }).join('');

  const largestRows = r.largest.length
    ? r.largest.map((x) => `<tr><td class="day">${esc(x.day)}</td><td>${esc(x.note)}</td>
        <td class="n">${money(x.amount)}</td></tr>`).join('')
    : '<tr><td colspan="3" class="nil">本月没有支出</td></tr>';

  const compare = [
    { label: '净资产', cur: r.netWorth, prev: r.prev.netWorth, d: r.delta.netWorth, upGood: true },
    { label: '收入', cur: r.totalIncome, prev: r.prev.totalIncome, d: r.delta.totalIncome, upGood: true },
    { label: '支出', cur: r.totalExpense, prev: r.prev.totalExpense, d: r.delta.totalExpense, upGood: false },
    { label: '结余', cur: r.net, prev: r.prev.net, d: r.delta.net, upGood: true },
  ];

  const compareRows = compare.map((c) => `<tr>
      <td>${c.label}</td>
      <td class="n">${money(c.prev)}</td>
      <td class="n">${money(c.cur)}</td>
      <td class="n">${deltaCell(c.d, c.upGood)}</td>
    </tr>`).join('');

  $('report-body').innerHTML = `
  <div class="rpt">

    <header class="rpt-head">
      <div>
        <div class="rpt-brand">观 澜 · 月 度 财 报</div>
        <div class="rpt-period">${yearCN(r.year)} 年 ${numCN(r.month)} 月</div>
      </div>
      <div class="rpt-seal">${esc(lunarSeal())}</div>
    </header>

    <div class="rpt-kpis">
      <div>
        <span>期 末 净 资 产</span>
        <b>¥${money(r.netWorth)}</b>
        <em>${r.startNetWorth === r.netWorth ? '与期初持平' : `期初 ¥${money(r.startNetWorth)}`}</em>
      </div>
      <div>
        <span>本 月 结 余</span>
        <b>${r.net >= 0 ? '+' : '−'} ¥${money(Math.abs(r.net))}</b>
        <em>储蓄率 ${r.savingsRate === null ? '—' : pct(r.savingsRate) + '%'}</em>
      </div>
      <div>
        <span>生 存 月 数</span>
        <b>${r.runway === null ? '—' : r.runway.toFixed(1)}</b>
        <em>流动资产 ¥${money(r.liquid)}</em>
      </div>
      <div>
        <span>负 债 率</span>
        <b>${r.debtRatio === null ? '—' : pct(r.debtRatio) + '%'}</b>
        <em>负债 ¥${money(r.totalLiabilities)}</em>
      </div>
    </div>

    <section class="rpt-sec">
      <h3><i>一</i>资产与负债</h3>
      <div class="two-col">
        <table class="led">
          <thead><tr><th>资产</th><th class="n">金额</th></tr></thead>
          <tbody>${assetRows}</tbody>
          <tfoot><tr class="total"><td>资产合计</td><td class="n">${money(r.totalAssets)}</td></tr></tfoot>
        </table>
        <table class="led">
          <thead><tr><th>负债</th><th class="n">金额</th></tr></thead>
          <tbody>${liabRows}</tbody>
          <tfoot><tr class="total"><td>负债合计</td><td class="n">${money(r.totalLiabilities)}</td></tr></tfoot>
        </table>
      </div>
      <table class="led grand">
        <tbody><tr><td>净资产 = 资产 − 负债</td><td class="n">¥${money(r.netWorth)}</td></tr></tbody>
      </table>
    </section>

    <section class="rpt-sec">
      <h3><i>二</i>这个月换来了什么</h3>
      ${total > 0
        ? `<p class="lead">这个月，你的钱换来了 ${gains.length} 样东西。</p>
           <div class="gains">${gainRows}</div>`
        : '<p class="nil">本月没有支出记录。</p>'}
    </section>

    <section class="rpt-sec">
      <h3><i>三</i>本月收支</h3>
      <div class="two-col">
        <table class="led">
          <thead><tr><th>收入来源</th><th class="n">金额</th></tr></thead>
          <tbody>${incomeRows}</tbody>
          <tfoot><tr class="total"><td>收入合计</td><td class="n">${money(r.totalIncome)}</td></tr></tfoot>
        </table>
        <table class="led">
          <thead><tr><th>支出分类</th><th class="n">金额</th></tr></thead>
          <tbody>${expenseRows}</tbody>
          <tfoot><tr class="total"><td>支出合计</td><td class="n">${money(r.totalExpense)}</td></tr></tfoot>
        </table>
      </div>
      ${r.largest.length ? `
      <table class="led small">
        <thead><tr><th colspan="2">最大的几笔</th><th class="n">金额</th></tr></thead>
        <tbody>${largestRows}</tbody>
      </table>` : ''}
    </section>

    <section class="rpt-sec">
      <h3><i>四</i>与上月相比</h3>
      <table class="led">
        <thead><tr><th>项目</th><th class="n">上月</th><th class="n">本月</th><th class="n">变化</th></tr></thead>
        <tbody>${compareRows}</tbody>
      </table>
    </section>

    <section class="rpt-sec">
      <h3><i>五</i>小结</h3>
      <p class="narration">${esc(r.narration)}</p>
    </section>

    <footer class="rpt-foot">
      <span>观澜 · 个人账簿</span>
      <span>${dateStr()} 生成</span>
    </footer>

  </div>`;
}

/* ---------------- 清空示例 ---------------- */

$('btn-clear-demo').addEventListener('click', async () => {
  const ok = confirm('清空示例数据？\n\n这会删除所有标注为示例的记录，你自己记的不受影响。');
  if (!ok) return;
  await window.api.clearDemo();
  await loadDashboard();
  if (!$('view-list').hidden) loadList();
  if (!$('view-report').hidden) loadReport();
});

/* ---------------- 启动 ---------------- */

(async function boot() {
  ACCOUNTS = await window.api.listAccounts();

  $('today').innerHTML = todayCN();
  $('add-time').textContent = clockCN();
  $('seal').textContent = lunarSeal();

  form.categoryId = defaultCat('expense');
  syncForm();

  window.api.onDataChanged(() => loadDashboard());
  await loadDashboard();
})();
