'use strict';

/* ============================================================
   观澜 · 渲染进程
   只负责展示与交互，所有计算在主进程完成
   ============================================================ */

const $ = (id) => document.getElementById(id);

const CAT_NAME = {
  food: '餐饮', traffic: '交通', growth: '成长', fun: '娱乐', life: '日用',
  salary: '工资', side: '副业收入', bank: '银行卡', alipay: '支付宝',
  wechat: '微信', cash: '现金', credit: '信用卡', fund: '基金',
};

/* ---------------- 视图切换 ---------------- */
const navLinks = document.querySelectorAll('nav a');
const views = {
  ledger: $('view-ledger'),
  add: $('view-add'),
  list: $('view-list'),
  report: $('view-report'),
};

navLinks.forEach((a) => {
  a.addEventListener('click', () => {
    navLinks.forEach((x) => x.classList.remove('on'));
    a.classList.add('on');
    const v = a.dataset.view;
    Object.entries(views).forEach(([k, el]) => { el.hidden = k !== v; });
    if (v === 'list') loadList();
    if (v === 'add') setTimeout(() => $('nl-input').focus(), 30);
    if (v === 'report') loadReport();
  });
});

/* ---------------- 工具 ---------------- */
function money(fen, opts = {}) {
  const y = (fen || 0) / 100;
  const s = y.toLocaleString('zh-CN', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  return (opts.sign && fen > 0 ? '+' : '') + s;
}

function pct(x, digits = 0) {
  if (x === null || x === undefined) return '—';
  return (x * 100).toFixed(digits);
}

/* 中文数字：年份逐位读，月日按数值读 */
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

function todayCN() {
  const d = new Date();
  const week = ['日', '一', '二', '三', '四', '五', '六'][d.getDay()];
  return `${yearCN(d.getFullYear())}年 ${numCN(d.getMonth() + 1)}月${numCN(d.getDate())}日<br>星期${week}`;
}

function clockCN() {
  const d = new Date();
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日 · ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/* ---------------- 账簿 ---------------- */
async function loadDashboard() {
  const d = await window.api.getDashboard();

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

  // 名言
  if (d.quote) {
    $('q-text').textContent = d.quote.text;
    $('q-src').textContent = `${d.quote.author} · ${d.quote.source}`;
    $('quote').hidden = false;
  }

  $('days-stamp').textContent = `本月已记 ${d.daysRecorded} 天`;
  $('ledger-sub').textContent = `本月 · 收入 ¥${money(d.inflow)}　支出 ¥${money(d.outflow)}`;

  renderRows($('recent-rows'), d.recent);
  $('notice').hidden = !d.hasDemo;

  return d;
}

function renderRows(container, rows) {
  container.innerHTML = '';
  if (!rows.length) {
    container.innerHTML = '<div class="row"><div></div><div class="t" style="color:#8C8477">还没有记录</div><div></div><div></div></div>';
    return;
  }
  rows.forEach((r) => {
    const el = document.createElement('div');
    el.className = 'row';
    const sign = r.kind === 'transfer' ? '' : (r.isIncome ? '+' : '−');
    el.innerHTML = `
      <div class="d">${r.day}</div>
      <div class="t">${escapeHtml(r.title)}</div>
      <div class="tagcell"><span class="tag ${r.cls}">${r.tag}</span></div>
      <div class="a ${r.isIncome ? 'in' : 'out'}">${sign}${money(Math.abs(r.amount))}</div>
    `;
    container.appendChild(el);
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

/* ---------------- 流水 ---------------- */
async function loadList() {
  const rows = await window.api.listTransactions({ limit: 200 });
  renderRows($('all-rows'), rows);
  $('list-sub').textContent = `共 ${rows.length} 笔`;
  const inflow = rows.filter((r) => r.isIncome).reduce((s, r) => s + r.amount, 0);
  const outflow = rows.filter((r) => !r.isIncome && r.kind !== 'transfer')
    .reduce((s, r) => s + r.amount, 0);
  $('list-sum').innerHTML = `收 ¥${money(inflow)}　支 ¥${money(outflow)}`;
}

/* ---------------- 报告 ---------------- */
async function loadReport() {
  const d = await window.api.getDashboard();
  $('r-in').textContent = '¥' + money(d.inflow);
  $('r-out').textContent = '¥' + money(d.outflow);
  $('r-net').textContent = '¥' + money(d.net);
  $('r-rate').textContent = d.savingsRate === null ? '—' : pct(d.savingsRate) + '%';
  const now = new Date();
  $('report-sub').textContent = `${now.getFullYear()} 年 ${now.getMonth() + 1} 月`;
}

/* ---------------- 记一笔 ---------------- */
const nlInput = $('nl-input');

/** 前端预览解析（与主进程规则一致，仅用于即时反馈） */
function preview(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  const m = raw.match(/(\d+(?:\.\d{1,2})?)/);
  if (!m) return null;
  const amount = parseFloat(m[1]);
  if (!(amount > 0)) return null;

  const has = (ws) => ws.some((w) => raw.includes(w));
  const INCOME = ['工资', '薪', '稿费', '奖金', '收入', '红包', '分成', '结算', '到账', '赚'];
  const TRANSFER = ['转', '转账', '还款'];
  const RULES = [
    ['food',    ['饭', '午餐', '晚餐', '早餐', '早饭', '午饭', '晚饭', '吃', '外卖', '奶茶', '咖啡', '零食', '餐', '水果']],
    ['traffic', ['地铁', '公交', '打车', '车费', '油', '停车', '高铁', '火车', '机票', '单车']],
    ['growth',  ['书', '课程', '网课', '学习', '培训', '会员', '订阅', '资料']],
    ['fun',     ['电影', '游戏', '娱乐', '演出', '门票']],
    ['life',    ['超市', '日用', '纸', '房租', '水电', '话费', '网费', '快递']],
  ];

  if (has(TRANSFER)) {
    const to = has(['支付宝']) ? 'alipay' : has(['微信']) ? 'wechat' : has(['信用卡']) ? 'credit' : 'alipay';
    return { kind: '转账', cat: CAT_NAME[to], amount, acc: '银行卡' };
  }
  if (has(INCOME)) {
    const isSide = has(['稿', '兼职', '项目', '外包', '副业']);
    return { kind: '收入', cat: isSide ? '副业收入' : '工资', amount, acc: has(['支付宝']) ? '支付宝' : has(['微信']) ? '微信' : '银行卡' };
  }
  const hit = RULES.find(([, ws]) => has(ws));
  const cat = hit ? CAT_NAME[hit[0]] : '日用';
  const acc = has(['支付宝']) ? '支付宝' : has(['微信']) ? '微信' : has(['现金']) ? '现金' : '银行卡';
  return { kind: '支出', cat, amount, acc };
}

function renderParse() {
  const row = $('parse-row');
  row.innerHTML = '<span class="chip k">解 析</span>';
  const p = preview(nlInput.value);
  if (!p) return;

  const chips = [p.kind, p.cat, `¥${p.amount.toFixed(2)}`, p.acc];
  chips.forEach((c) => {
    const s = document.createElement('span');
    s.className = 'chip';
    s.textContent = c;
    row.appendChild(s);
  });
}

nlInput.addEventListener('input', () => {
  renderParse();
  $('msg').textContent = '';
  $('msg').className = 'msg';
});

nlInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') submitQuick();
});

$('btn-add').addEventListener('click', submitQuick);

async function submitQuick() {
  const text = nlInput.value.trim();
  if (!text) {
    setMsg('写点什么，比如「午饭25」', 'err');
    return;
  }

  const r = await window.api.addQuick(text);
  if (!r.ok) {
    setMsg(r.reason || '没看懂这句', 'err');
    return;
  }

  setMsg('已记下', 'ok');
  nlInput.value = '';
  renderParse();
  await loadDashboard();

  // 记完回账簿看一眼变化
  setTimeout(() => {
    navLinks.forEach((x) => x.classList.remove('on'));
    document.querySelector('nav a[data-view="ledger"]').classList.add('on');
    Object.entries(views).forEach(([k, el]) => { el.hidden = k !== 'ledger'; });
    const before = $('networth').textContent;
    loadDashboard().then(() => {
      $('networth').animate(
        [{ opacity: 0.35, transform: 'translateY(3px)' }, { opacity: 1, transform: 'none' }],
        { duration: 420, easing: 'ease-out' }
      );
    });
  }, 520);
}

function setMsg(text, type) {
  const el = $('msg');
  el.textContent = text;
  el.className = 'msg ' + (type || '');
}

/* ---------------- 清空示例 ---------------- */
$('btn-clear-demo').addEventListener('click', async () => {
  const ok = confirm('清空示例数据？\n\n这会删除所有标注为示例的记录，你自己记的不受影响。');
  if (!ok) return;
  await window.api.clearDemo();
  await loadDashboard();
});

/* ---------------- 启动 ---------------- */
$('today').innerHTML = todayCN();
$('add-time').textContent = clockCN();
$('seal').textContent = lunarSeal();

window.api.onDataChanged(() => loadDashboard());

loadDashboard();

/* 农历纪年（简化：干支年 + 近似农历月） */
function lunarSeal() {
  const now = new Date();
  const y = now.getFullYear();
  const gan = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸'];
  const zhi = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'];
  const g = gan[(y - 4) % 10];
  const z = zhi[(y - 4) % 12];
  // 公历月约等于农历月 + 1
  const m = now.getMonth() + 1;
  const mName = ['正', '二', '三', '四', '五', '六', '七', '八', '九', '十', '冬', '腊'][(m - 2 + 12) % 12];
  return `${g}${z}年${mName}月`;
}
