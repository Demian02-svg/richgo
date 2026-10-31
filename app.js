'use strict';
/* =========================================================
   Rich Go - 임대료 납부 관리 (PWA, 기기 내 저장)
   ========================================================= */

/* ---------- 날짜 유틸 (모두 'YYYY-MM-DD' 문자열, 기기 현지 시간 기준) ---------- */
const pad = n => String(n).padStart(2, '0');
const ymd = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
const dim = (y, m) => new Date(y, m, 0).getDate();               // m: 1~12
const parseD = s => { const [y, m, d] = s.split('-').map(Number); return { y, m, d }; };
const today = () => { const d = new Date(); return ymd(d.getFullYear(), d.getMonth() + 1, d.getDate()); };
const dayNum = s => { const { y, m, d } = parseD(s); return Math.round(Date.UTC(y, m - 1, d) / 86400000); };
const diff = (a, b) => dayNum(b) - dayNum(a);                      // b - a (일)
const addDays = (s, n) => { const { y, m, d } = parseD(s); const t = new Date(Date.UTC(y, m - 1, d + n)); return ymd(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()); };
const addMonths = (s, n) => { const { y, m, d } = parseD(s); const t = y * 12 + (m - 1) + n; const ny = Math.floor(t / 12), nm = t % 12 + 1; return ymd(ny, nm, Math.min(d, dim(ny, nm))); };
const WD = ['일', '월', '화', '수', '목', '금', '토'];
const fmtDot = s => { const { y, m, d } = parseD(s); return `${y}.${pad(m)}.${pad(d)}`; };
const fmtMD = s => { const { m, d } = parseD(s); return `${m}월 ${d}일`; };
const fmtK = s => { const { y, m, d } = parseD(s); return `${m}월 ${d}일 (${WD[new Date(y, m - 1, d).getDay()]})`; };

/* ---------- 금액/문자열 ---------- */
const won = n => `${(n || 0).toLocaleString('ko-KR')}원`;
const short = n => (n >= 10000 && n % 10000 === 0) ? `${(n / 10000).toLocaleString('ko-KR')}만` : (n || 0).toLocaleString('ko-KR');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const numFmt = n => (n === null || n === undefined || n === '') ? '' : Number(n).toLocaleString('ko-KR');
const telClean = s => String(s || '').replace(/[^\d+]/g, '');

/* ---------- 데이터 ---------- */
const DEFAULT_SMS = '{세입자}님 안녕하세요. {호실} {월} 임대료 {금액}이(가) 납부일({납입일})까지 확인되지 않아 안내드립니다. 확인 부탁드립니다.';
const defaults = () => ({
  v: 2, seq: 1,
  buildings: [], units: [], leases: [], payments: [],
  settings: {
    pin: null, sms: DEFAULT_SMS, lastBackup: null,
    notifications: {
      enabled: false,
      time: "09:00",
      d3: true,
      d1: true,
      today: true,
      overdue: true,
      partial: false,
      buildings: "all",
      lastSentDate: null
    }
  }
});
let S = defaults();
let IX = null;
const nid = () => S.seq++;

function ix() {
  if (!IX) IX = {
    b: new Map(S.buildings.map(x => [x.id, x])),
    u: new Map(S.units.map(x => [x.id, x])),
    l: new Map(S.leases.map(x => [x.id, x]))
  };
  return IX;
}
function ctxOf(p) {
  const { b, u, l } = ix();
  const lease = l.get(p.leaseId), unit = lease && u.get(lease.unitId), bld = unit && b.get(unit.buildingId);
  return { lease, unit, bld };
}

/* ---------- 청구/상태 규칙 ---------- */
const total = p => (p.rent || 0) + (p.fee || 0);
const remain = p => Math.max(0, total(p) - (p.paidAmount || 0));
const RANK = { paid: 1, wait: 2, part: 3, late: 4 };

// 납부 / 부분납부 / 대기 / 연체  (저장하지 않고 항상 계산)
function status(p, t = today()) {
  const paid = p.paidAmount || 0;
  if (p.paidDate && paid >= total(p)) return 'paid';
  if (t > p.due) return 'late';          // 납입일 다음 날부터 연체 (부분납부 포함)
  if (paid > 0) return 'part';
  return 'wait';
}
function topStatus(list) {
  let best = null, r = 0;
  for (const p of list) { const s = status(p); if (RANK[s] > r) { r = RANK[s]; best = s; } }
  return best;
}

/* ---------- Phase 1: 납부 알림 센터 (인앱) ---------- */
function getNotifications(t = today()) {
  const pays = visiblePays().filter(p => ctxOf(p).lease);
  const out = [];
  for (const p of pays) {
    const { lease, unit, bld } = ctxOf(p);
    if (!lease || !unit || !bld) continue;
    const st = status(p, t);
    if (st === 'paid') continue;
    const daysUntil = diff(t, p.due); // +면 미래, -면 과거
    const daysOver = diff(p.due, t);  // +면 연체일수
    if (st === 'late') {
      out.push({
        type: 'overdue',
        payment: p,
        days: daysOver,
        title: `${bld.name} ${unit.name} · ${lease.tenant}`,
        desc: `${daysOver}일 연체 · ${won(remain(p))} 미납 · ${fmtMD(p.due)} 예정`,
        urgency: 1000 + daysOver
      });
    } else if (st === 'part') {
      out.push({
        type: 'partial',
        payment: p,
        days: daysUntil,
        title: `${bld.name} ${unit.name} · ${lease.tenant}`,
        desc: `부분납부 · ${won(remain(p))} 남음 · ${daysUntil===0?'오늘 마감':`D-${daysUntil}`}`,
        urgency: 300 + (daysUntil<=0?100:0)
      });
    } else if (st === 'wait') {
      if (daysUntil === 0) {
        out.push({
          type: 'today',
          payment: p,
          days: 0,
          title: `${bld.name} ${unit.name} · ${lease.tenant}`,
          desc: `오늘 납부일 · ${won(total(p))}`,
          urgency: 800
        });
      } else if (daysUntil >=1 && daysUntil <=3) {
        out.push({
          type: 'soon',
          payment: p,
          days: daysUntil,
          title: `${bld.name} ${unit.name} · ${lease.tenant}`,
          desc: `D-${daysUntil} · ${fmtMD(p.due)} · ${won(total(p))}`,
          urgency: 500 - daysUntil
        });
      }
    }
  }
  out.sort((a,b) => b.urgency - a.urgency);
  return out;
}

/* ---------- Phase 2: 시스템 알림 (브라우저 Notification) ---------- */
function canNotify() {
  return typeof window !== 'undefined' && 'Notification' in window;
}
function notifPermission() {
  if (!canNotify()) return 'unsupported';
  return Notification.permission;
}
async function requestNotifPermission() {
  if (!canNotify()) { toast('이 브라우저는 알림을 지원하지 않아요'); return false; }
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') { toast('브라우저 설정에서 알림을 허용해 주세요'); return false; }
  const p = await Notification.requestPermission();
  if (p === 'granted') { toast('알림 권한을 허용했어요'); render(); return true; }
  else { toast('알림 권한이 거부됐어요'); render(); return false; }
}

function getSystemNotifs(t = today()) {
  const ns = S.settings.notifications;
  if (!ns) return [];
  let pays = S.payments.filter(p => ctxOf(p).lease);
  if (ns.buildings !== 'all' && ns.buildings != null && ns.buildings !== '') {
    const bid = +ns.buildings;
    if (!isNaN(bid)) pays = pays.filter(p => { const c = ctxOf(p); return c.unit && c.unit.buildingId === bid; });
  }
  const out = [];
  for (const p of pays) {
    const { lease, unit, bld } = ctxOf(p);
    if (!lease || !unit || !bld) continue;
    const st = status(p, t);
    if (st === 'paid') continue;
    const daysUntil = diff(t, p.due);
    const daysOver = diff(p.due, t);
    if (st === 'late') {
      if (!ns.overdue) continue;
      out.push({ type: 'overdue', payment: p, days: daysOver, title: `${bld.name} ${unit.name} · ${lease.tenant}`, desc: `${daysOver}일 연체 · ${won(remain(p))}`, urgency: 1000 + daysOver });
    } else if (st === 'part') {
      if (!ns.partial) continue;
      out.push({ type: 'partial', payment: p, days: daysUntil, title: `${bld.name} ${unit.name} · ${lease.tenant}`, desc: `부분납부 ${won(remain(p))} 남음`, urgency: 300 });
    } else if (st === 'wait') {
      if (daysUntil === 0) {
        if (!ns.today) continue;
        out.push({ type: 'today', payment: p, days: 0, title: `${bld.name} ${unit.name} · ${lease.tenant}`, desc: `오늘 납부일 ${won(total(p))}`, urgency: 800 });
      } else if (daysUntil === 1) {
        if (!ns.d1) continue;
        out.push({ type: 'soon', payment: p, days: daysUntil, title: `${bld.name} ${unit.name} · ${lease.tenant}`, desc: `내일 납부 ${won(total(p))}`, urgency: 600 });
      } else if (daysUntil >=2 && daysUntil <=3) {
        if (!ns.d3) continue;
        out.push({ type: 'soon', payment: p, days: daysUntil, title: `${bld.name} ${unit.name} · ${lease.tenant}`, desc: `D-${daysUntil} ${won(total(p))}`, urgency: 500 - daysUntil });
      }
    }
  }
  out.sort((a,b) => b.urgency - a.urgency);
  return out;
}

function sendSystemNotification(notifs) {
  if (!canNotify() || Notification.permission !== 'granted') return false;
  if (!notifs.length) return false;
  const cOver = notifs.filter(n=>n.type==='overdue').length;
  const cToday = notifs.filter(n=>n.type==='today').length;
  const cSoon = notifs.filter(n=>n.type==='soon').length;
  const cPart = notifs.filter(n=>n.type==='partial').length;
  const parts = [];
  if (cOver) parts.push(`연체 ${cOver}건`);
  if (cToday) parts.push(`오늘 ${cToday}건`);
  if (cSoon) parts.push(`예정 ${cSoon}건`);
  if (cPart) parts.push(`부분납부 ${cPart}건`);
  const title = `Rich Go 알림 ${notifs.length}건`;
  const body = parts.join(' · ') + '\n탭하면 앱에서 확인';
  const detail = notifs.slice(0,2).map(n=>`• ${n.title} - ${n.desc}`).join('\n');
  const fullBody = body + (detail ? '\n' + detail : '');

  if (navigator.serviceWorker && navigator.serviceWorker.ready) {
    navigator.serviceWorker.ready.then(reg => {
      reg.showNotification(title, {
        body: fullBody,
        icon: './icon-192.png',
        badge: './icon-192.png',
        tag: 'richgo-daily',
        renotify: false,
        requireInteraction: false,
        data: { url: './' }
      });
    });
  } else {
    new Notification(title, { body: fullBody, icon: './icon-192.png' });
  }
  return true;
}

function shouldSendToday(force=false) {
  const ns = S.settings.notifications;
  if (!ns || !ns.enabled) return false;
  if (!force && ns.lastSentDate === today()) return false;
  if (!force) {
    const now = new Date();
    const [h,m] = (ns.time||"09:00").split(':').map(Number);
    const nowMin = now.getHours()*60+now.getMinutes();
    const targetMin = h*60+m;
    if (nowMin < targetMin) return false;
  }
  return true;
}

async function checkAndSendDailyNotifs(force=false) {
  try {
    if (!S.settings.notifications?.enabled) return;
    if (!canNotify() || Notification.permission !== 'granted') return;
    if (!shouldSendToday(force)) return;
    const notifs = getSystemNotifs(today());
    if (!notifs.length) return;
    const ok = sendSystemNotification(notifs);
    if (ok) {
      S.settings.notifications.lastSentDate = today();
      await saveState();
      render();
    }
  } catch(e) { console.error(e); }
}


function chipOf(p) {
  const s = status(p), t = today();
  if (s === 'paid') return { cls: 'paid', label: '납부' };
  if (s === 'late') return { cls: 'late', label: `연체 ${diff(p.due, t)}일` };
  if (s === 'part') return { cls: 'part', label: '부분납부' };
  const n = diff(t, p.due);
  return { cls: 'wait', label: n === 0 ? '오늘 납부일' : `대기 D-${n}` };
}

// 계약 기간의 월별 청구 생성. 청구 기간 k = 계약일 + k개월, 계약일~만료일 안에 시작하는 기간마다 1건
function buildPayments(l) {
  const out = [];
  for (let k = 0; k < 600; k++) {
    const ps = addMonths(l.start, k);
    if (ps > l.end) break;
    const y = +ps.slice(0, 4), m = +ps.slice(5, 7);
    let dy = y, dm = m;
    if (l.mode === 'post') { dm++; if (dm > 12) { dm = 1; dy++; } }       // 후불: 다음 달 납입일
    let due = ymd(dy, dm, Math.min(l.payDay, dim(dy, dm)));              // 29~31일 → 말일 보정
    if (l.mode === 'pre' && k === 0 && due < l.start) due = l.start;    // 첫 청구는 계약일 이후
    out.push({ id: nid(), leaseId: l.id, month: `${y}-${pad(m)}`, due, rent: l.rent, fee: l.fee, paidDate: null, paidAmount: 0, memo: '' });
  }
  return out;
}

// 납부 기록 없는 미래 청구는 새 조건으로 다시 생성, 납부 기록/이미 지난 청구는 유지
function syncPayments(l, markPastPaid = false) {
  const t = today();
  S.payments = S.payments.filter(p => !(p.leaseId === l.id && !(p.paidAmount > 0) && p.due >= t));
  const have = new Set(S.payments.filter(p => p.leaseId === l.id).map(p => p.month));
  for (const np of buildPayments(l)) {
    if (have.has(np.month)) continue;
    if (markPastPaid && np.due < t) { np.paidDate = np.due; np.paidAmount = total(np); np.memo = '기존 계약 일괄 처리'; }
    S.payments.push(np);
  }
}

function leaseOfUnit(unitId) { return S.leases.find(l => l.unitId === unitId && l.status === 'active'); }
function unitChip(unit) {
  const lease = leaseOfUnit(unit.id);
  if (!lease) return { chips: '<span class="chip gray">공실</span>', lease: null };
  const t = today(), key = t.slice(0, 7);
  const ps = S.payments.filter(p => p.leaseId === lease.id);
  const late = ps.filter(p => status(p) === 'late');
  let c;
  if (late.length) c = `<span class="chip late">연체 ${late.length}건</span>`;
  else if (ps.some(p => p.due.slice(0, 7) <= key && status(p) !== 'paid')) c = '<span class="chip wait">대기</span>';
  else c = '<span class="chip paid">정상</span>';
  const d = diff(t, lease.end);
  if (d < 0) c += ' <span class="chip late">만료 지남</span>';
  else if (d <= 60) c += ` <span class="chip soft">만료 D-${d}</span>`;
  return { chips: c, lease };
}

/* ---------- 저장 (IndexedDB 한 건으로 통째 저장) ---------- */
function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('richgo', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function loadState() {
  try {
    const db = await idb();
    return await new Promise(res => {
      const q = db.transaction('kv').objectStore('kv').get('state');
      q.onsuccess = () => res(q.result || null);
      q.onerror = () => res(null);
    });
  } catch (e) { return null; }
}
async function saveState() {
  const db = await idb();
  return new Promise((res, rej) => {
    const t = db.transaction('kv', 'readwrite');
    t.objectStore('kv').put(JSON.parse(JSON.stringify(S)), 'state');
    t.oncomplete = () => res();
    t.onerror = () => rej(t.error);
  });
}
function normalize(d) {
  const base = defaults();
  const o = Object.assign(base, d || {});
  o.settings = Object.assign(base.settings, (d && d.settings) || {});
  o.settings.notifications = Object.assign({}, base.settings.notifications, (d && d.settings && d.settings.notifications) || {});
  if (!o.settings.notifications.time) o.settings.notifications.time = "09:00";
  if (o.settings.notifications.buildings === undefined) o.settings.notifications.buildings = "all";
  ['buildings', 'units', 'leases', 'payments'].forEach(k => { if (!Array.isArray(o[k])) o[k] = []; });
  const maxId = Math.max(0, ...['buildings', 'units', 'leases', 'payments'].flatMap(k => o[k].map(x => x.id || 0)));
  if (!o.seq || o.seq <= maxId) o.seq = maxId + 1;
  return o;
}

/* =========================================================
   화면 (브라우저에서만 실행)
   ========================================================= */
const ui = { tab: 'home', month: null, sel: null, filter: 'all' };
let cur = null;                // 열려 있는 시트 정보
let deferredInstall = null;
let unlocked = false, hiddenAt = 0;

const $ = s => document.querySelector(s);

function toast(msg) {
  const el = $('#toast'); el.textContent = msg; el.classList.add('on');
  clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove('on'), 2300);
}
async function commit(msg) {
  IX = null;
  try { await saveState(); } catch (e) { toast('저장에 실패했어요. 저장 공간을 확인해 주세요.'); }
  render();
  if (msg) toast(msg);
}

function initMonth() {
  const t = today();
  ui.month = { y: +t.slice(0, 4), m: +t.slice(5, 7) };
  ui.sel = t;
}

function visiblePays() {
  if (ui.filter === 'all') return S.payments.filter(p => ctxOf(p).lease);
  return S.payments.filter(p => { const c = ctxOf(p); return c.unit && c.unit.buildingId === +ui.filter; });
}

/* ---------- 렌더링 ---------- */
function render() {
  IX = null;
  document.querySelectorAll('.tab').forEach(b => b.classList.toggle('on', b.dataset.tab === ui.tab));
  $('#view').innerHTML = ui.tab === 'home' ? homeView() : ui.tab === 'units' ? unitsView() : settingsView();
  renderTop();
  try {
    const n = S.payments.filter(p => status(p) === 'late' && ctxOf(p).lease).length;
    if (navigator.setAppBadge) { n ? navigator.setAppBadge(n) : navigator.clearAppBadge(); }
  } catch (e) { /* 배지 미지원 */ }
}

function renderTop() {
  const el = $('#topRight');
  if (ui.tab === 'home' && S.buildings.length > 1) {
    el.innerHTML = `<select id="flt" aria-label="건물 필터"><option value="all">전체 건물</option>${S.buildings.map(b => `<option value="${b.id}" ${String(ui.filter) === String(b.id) ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}</select>`;
  } else el.innerHTML = '';
}

function sheetLinks(lease, p) {
  const tel = telClean(lease.phone);
  if (!tel) return '';
  const body = p ? `?body=${encodeURIComponent(smsBody(p))}` : '';
  return `<a class="btn" href="tel:${tel}">📞 전화</a><a class="btn" href="sms:${tel}${body}">💬 문자</a>`;
}
function smsBody(p) {
  const { lease, unit, bld } = ctxOf(p);
  const r = (s, k, v) => s.replace(new RegExp(`\\{${k}\\}`, 'g'), () => v);
  let s = S.settings.sms || DEFAULT_SMS;
  s = r(s, '세입자', lease.tenant);
  s = r(s, '호실', `${bld.name} ${unit.name}`);
  s = r(s, '월', `${+p.month.slice(5)}월`);
  s = r(s, '금액', won(remain(p) || total(p)));
  s = r(s, '납입일', fmtMD(p.due));
  return s;
}

function payCard(p) {
  const { lease, unit, bld } = ctxOf(p);
  if (!lease) return '';
  const st = status(p), c = chipOf(p);
  const paid = p.paidAmount || 0;
  return `<div class="pc ${st}" data-act="pay" data-id="${p.id}">
    <div class="row between">
      <div class="grow"><div class="t">${esc(bld.name)} ${esc(unit.name)} · ${esc(lease.tenant)}</div>
        <div class="small muted">${+p.month.slice(5)}월분 · 월세 ${short(p.rent)} + 관리비 ${short(p.fee)}${paid > 0 && st !== 'paid' ? ` · 납부 ${short(paid)}` : ''}</div></div>
      <div class="right"><div class="amt">${won(st === 'paid' ? total(p) : remain(p))}</div><span class="chip ${c.cls}">${c.label}</span></div>
    </div>
    <div class="acts"><button class="btn pri" data-act="pay" data-id="${p.id}">${st === 'paid' ? '내역 보기' : '납부 처리'}</button>${sheetLinks(lease, p)}</div>
  </div>`;
}

function homeView() {
  const t = today(), { y, m } = ui.month, key = `${y}-${pad(m)}`;
  const pays = visiblePays();
  const byDate = {};
  pays.forEach(p => (byDate[p.due] = byDate[p.due] || []).push(p));

  const lates = pays.filter(p => status(p) === 'late');
  const lateSum = lates.reduce((a, p) => a + remain(p), 0);
  const notifs = getNotifications(t);


  const first = new Date(y, m - 1, 1).getDay(), n = dim(y, m);
  let cells = '';
  for (let i = 0; i < first; i++) cells += '<div class="day empty"></div>';
  for (let d = 1; d <= n; d++) {
    const ds = ymd(y, m, d), list = byDate[ds] || [], top = topStatus(list);
    const dow = (first + d - 1) % 7;
    cells += `<button class="day ${ds === ui.sel ? 'sel' : ''} ${ds === t ? 'today' : ''} ${dow === 0 ? 'sun' : ''}" data-act="selday" data-date="${ds}" aria-label="${m}월 ${d}일 ${list.length}건">
      <span class="dn ${top ? 'c-' + top : ''}">${d}</span>${list.length > 1 ? `<span class="bd">${list.length}</span>` : ''}</button>`;
  }

  const inMonth = pays.filter(p => p.due.startsWith(key));
  const bill = inMonth.reduce((a, p) => a + total(p), 0);
  const got = inMonth.reduce((a, p) => a + Math.min(p.paidAmount || 0, total(p)), 0);

  const dayList = (byDate[ui.sel] || []).slice().sort((a, b) => RANK[status(b)] - RANK[status(a)]);
  const dayTotal = dayList.reduce((a, p) => a + total(p), 0);

  let notes = '';
  if (!S.buildings.length) notes = `<div class="empty-state"><div class="big">🏠</div><p><b>Rich Go에 오신 것을 환영해요</b><br>먼저 '호실' 탭에서 건물과 호실, 계약을 등록하면<br>납부일이 캘린더에 표시됩니다.</p><button class="btn pri" data-act="tab" data-tab="units">건물 등록하러 가기</button> <button class="btn" data-act="sample">샘플 데이터로 둘러보기</button></div>`;
  const stale = S.buildings.length && (!S.settings.lastBackup || diff(S.settings.lastBackup, t) > 30);
  if (stale) notes += `<div class="note">💾 ${S.settings.lastBackup ? `마지막 백업이 ${diff(S.settings.lastBackup, t)}일 전이에요.` : '아직 백업한 적이 없어요.'} 폰을 바꾸거나 브라우저 데이터를 지우면 기록이 사라질 수 있어요. <a href="#" data-act="tab" data-tab="settings">백업하러 가기</a></div>`;

  // Phase 1 알림 카드
  let notifCard = '';
  if (notifs.length) {
    const cOver = notifs.filter(n=>n.type==='overdue').length;
    const cToday = notifs.filter(n=>n.type==='today').length;
    const cSoon = notifs.filter(n=>n.type==='soon').length;
    const cPart = notifs.filter(n=>n.type==='partial').length;
    const parts = [];
    if (cOver) parts.push(`연체 ${cOver}건`);
    if (cToday) parts.push(`오늘 ${cToday}건`);
    if (cSoon) parts.push(`${cSoon}건 3일 이내`);
    if (cPart) parts.push(`부분납부 ${cPart}건`);
    notifCard = `<div class="card notif-card" data-act="openNotifs" role="button" tabindex="0">
      <div class="row between"><div class="row" style="gap:8px"><span style="font-size:18px">🔔</span><b>알림 ${notifs.length}건</b></div><span class="muted">›</span></div>
      <div class="small muted" style="margin-top:6px">${parts.join(' · ')}</div>
    </div>`;
  }

  return `${notes}
  ${notifCard}
  ${lates.length ? `<button class="banner" data-act="overdue">⚠️ 연체 ${lates.length}건 · 미수 ${won(lateSum)} <span style="margin-left:auto">보기 ›</span></button>` : ''}
  <div class="card">
    <div class="mhead"><button class="ib" data-act="prevMonth" aria-label="이전 달">‹</button>
      <div class="row"><h2>${y}년 ${m}월</h2><button class="todaybtn" data-act="thisMonth">오늘</button></div>
      <button class="ib" data-act="nextMonth" aria-label="다음 달">›</button></div>
    <div class="wk">${WD.map(w => `<div>${w}</div>`).join('')}</div>
    <div class="grid">${cells}</div>
    <div class="legend"><span><i class="dot wait"></i>대기</span><span><i class="dot paid"></i>납부</span><span><i class="dot part"></i>부분납부</span><span><i class="dot late"></i>연체</span></div>
  </div>
  <div class="card"><div class="sum">
    <div><small>이번 달 청구</small><b>${numFmt(bill) || 0}</b></div>
    <div><small>수납</small><b>${numFmt(got) || 0}</b></div>
    <div class="${bill - got > 0 ? 'late' : ''}"><small>미수</small><b>${numFmt(bill - got) || 0}</b></div></div></div>
  <div class="row between" style="margin:4px 2px 8px"><b>${fmtK(ui.sel)}</b><span class="muted small">${dayList.length ? `${dayList.length}건 · ${won(dayTotal)}` : ''}</span></div>
  ${dayList.length ? dayList.map(payCard).join('') : '<div class="card muted small" style="text-align:center">이 날은 납부 예정이 없어요</div>'}`;
}

function unitsView() {
  if (!S.buildings.length) {
    return `<div class="empty-state"><div class="big">🏢</div><p>등록된 건물이 없어요.<br>건물 → 호실 → 계약 순서로 등록해 보세요.</p>
      <button class="btn pri" data-act="addBuilding">+ 건물 추가</button> <button class="btn" data-act="sample">샘플 데이터</button></div>`;
  }
  let h = '';
  for (const b of S.buildings) {
    const units = S.units.filter(u => u.buildingId === b.id);
    h += `<div class="bh"><div><h3>🏢 ${esc(b.name)}</h3>${b.address ? `<div class="small muted">${esc(b.address)}</div>` : ''}</div>
      <div class="row"><button class="btn sm" data-act="editBuilding" data-id="${b.id}">수정</button><button class="btn sm pri" data-act="addUnit" data-id="${b.id}">+ 호실</button></div></div>`;
    if (!units.length) h += '<div class="card muted small" style="text-align:center">호실을 추가해 주세요</div>';
    for (const u of units) {
      const { chips, lease } = unitChip(u);
      h += `<div class="ur" data-act="openUnit" data-id="${u.id}">
        <div class="grow"><div class="nm">${esc(u.name)}</div>
          <div class="small muted">${lease ? `${esc(lease.tenant)} · ${short(lease.rent)} + ${short(lease.fee)}` : '세입자 없음'}</div></div>
        <div class="chips">${chips}</div></div>`;
    }
  }
  return h + `<button class="btn block" style="margin-top:14px" data-act="addBuilding">+ 건물 추가</button>`;
}

function settingsView() {
  const s = S.settings, t = today();
  const ns = s.notifications || { enabled:false, time:"09:00", d3:true, d1:true, today:true, overdue:true, partial:false, buildings:"all", lastSentDate:null };
  const perm = (typeof Notification !== 'undefined') ? Notification.permission : 'unsupported';
  return `
  <div class="card" style="border-left:4px solid var(--brand)"><b>🔔 납부 알림 (Phase 2)</b>
    <p class="small muted">매일 설정한 시간에 연체·납부 예정을 폰 상단 알림으로 띄워요. 서버 없이 기기 안에서만 동작해요. iOS는 앱이 열려 있을 때만 표시돼요.</p>
    <div class="f"><label class="chk"><input type="checkbox" data-act="toggleNotifEnabled" ${ns.enabled?'checked':''}><span><b>시스템 알림 사용</b> <span class="small muted">(${perm})</span></span></label></div>
    <div style="${ns.enabled?'':'opacity:.5;pointer-events:none'}">
      <div class="f2">
        <div class="f"><label>알림 시간</label><input type="time" value="${ns.time||'09:00'}" data-act="notifTime" data-type="time"></div>
        <div class="f"><label>건물 필터</label><select data-act="notifBuilding"><option value="all" ${ns.buildings==='all'?'selected':''}>전체 건물</option>${S.buildings.map(b=>`<option value="${b.id}" ${String(ns.buildings)===String(b.id)?'selected':''}>${esc(b.name)}</option>`).join('')}</select></div>
      </div>
      <div class="f" style="gap:8px">
        <label class="small muted">알림 종류</label>
        <label class="chk"><input type="checkbox" data-act="toggleNotifType" data-type="overdue" ${ns.overdue?'checked':''}><span>연체</span></label>
        <label class="chk"><input type="checkbox" data-act="toggleNotifType" data-type="today" ${ns.today?'checked':''}><span>오늘 납부일</span></label>
        <label class="chk"><input type="checkbox" data-act="toggleNotifType" data-type="d1" ${ns.d1?'checked':''}><span>D-1 (내일)</span></label>
        <label class="chk"><input type="checkbox" data-act="toggleNotifType" data-type="d3" ${ns.d3?'checked':''}><span>D-3 (2~3일 전)</span></label>
        <label class="chk"><input type="checkbox" data-act="toggleNotifType" data-type="partial" ${ns.partial?'checked':''}><span>부분납부</span></label>
      </div>
      <div class="row" style="flex-wrap:wrap;margin-top:8px">
        <button class="btn pri" data-act="testNotif">🔔 지금 테스트 알림</button>
        <button class="btn" data-act="requestNotifPerm">권한 요청</button>
      </div>
      <div class="small muted" style="margin-top:8px">마지막 발송: ${ns.lastSentDate||'없음'} · 권한: ${perm} · ${ns.enabled ? (perm==='granted' ? '정상 작동' : '권한이 필요해요') : '꺼짐'}</div>
    </div>
  </div>

  <div class="card"><b>🔒 앱 잠금</b>
    <p class="small muted">PIN 4자리로 앱을 잠가요. 세입자 개인정보 보호용입니다.</p>
    <div class="row"><button class="btn" data-act="setPin">${s.pin ? 'PIN 변경' : 'PIN 설정'}</button>${s.pin ? '<button class="btn danger" data-act="clearPin">잠금 해제</button>' : ''}</div></div>

  <div class="card"><b>💬 연체 안내 문자 문구</b>
    <form data-form="sms" style="margin-top:8px">
      <div class="f"><textarea name="sms">${esc(s.sms)}</textarea>
      <div class="hint">쓸 수 있는 말: {세입자} {호실} {월} {금액} {납입일}</div></div>
      <div class="row"><button class="btn pri" type="submit">저장</button><button class="btn" type="button" data-act="resetSms">기본 문구로</button></div></form></div>

  <div class="card"><b>💾 백업 / 복원</b>
    <p class="small muted">데이터는 이 폰의 브라우저에만 저장돼요. 정기적으로 백업 파일을 저장해 두세요.<br>마지막 백업: ${s.lastBackup ? `${fmtDot(s.lastBackup)} (${diff(s.lastBackup, t)}일 전)` : '없음'}</p>
    <div class="row" style="flex-wrap:wrap">
      <button class="btn pri" data-act="exportJson">백업 파일 저장</button>
      ${(navigator.canShare) ? '<button class="btn" data-act="shareJson">공유로 보내기</button>' : ''}
      <button class="btn" data-act="importJson">복원</button>
      <button class="btn" data-act="exportCsv">CSV 내보내기</button></div></div>

  <div class="card"><b>📲 설치</b>
    <p class="small muted">Chrome 메뉴(⋮) → '홈 화면에 추가'(또는 '앱 설치')를 누르면 앱처럼 쓸 수 있어요.</p>
    ${deferredInstall ? '<button class="btn pri" data-act="install">홈 화면에 설치</button>' : ''}</div>

  <div class="card"><b>🧰 데이터</b>
    <div class="row" style="flex-wrap:wrap;margin-top:8px"><button class="btn" data-act="sample">샘플 데이터 넣기</button><button class="btn danger" data-act="wipe">전체 삭제</button></div>
    <p class="small muted" style="margin-bottom:0">건물 ${S.buildings.length} · 호실 ${S.units.length} · 계약 ${S.leases.length} · 청구 ${S.payments.length}</p></div>
  <p class="small muted" style="text-align:center">Rich Go v1.0</p>`;
}

/* ---------- 시트(팝업) ---------- */
function openSheet(title, html, opts = {}) {
  cur = { title, opts };
  const el = $('#sheet');
  el.innerHTML = `<div class="scrim" data-act="closeSheet"></div><div class="panel">
    <div class="ph">${opts.back ? '<button class="ib" data-act="sheetBack" aria-label="뒤로">‹</button>' : '<span></span>'}<h2>${esc(title)}</h2><button class="ib" data-act="closeSheet" aria-label="닫기">✕</button></div>
    <div class="pb">${html}</div></div>`;
  el.classList.add('open'); document.body.classList.add('noscroll');
  const pb = el.querySelector('.pb'); if (pb) pb.scrollTop = 0;
}
function closeSheet() { cur = null; const el = $('#sheet'); el.classList.remove('open'); el.innerHTML = ''; document.body.classList.remove('noscroll'); }
function finish() { const b = cur && cur.opts.back; if (b) b(); else closeSheet(); }

function openOverdue() {
  const list = S.payments.filter(p => status(p) === 'late' && ctxOf(p).lease).sort((a, b) => a.due.localeCompare(b.due));
  const sum = list.reduce((a, p) => a + remain(p), 0);
  openSheet('연체 목록', `<div class="card"><b>총 ${list.length}건 · 미수 ${won(sum)}</b></div>${list.map(payCard).join('') || '<div class="empty-state">연체가 없어요 🎉</div>'}`, { reopen: openOverdue });
}

function field(label, input, hint) { return `<div class="f"><label>${label}</label>${input}${hint ? `<div class="hint">${hint}</div>` : ''}</div>`; }

function openBuilding(id) {
  const b = id ? S.buildings.find(x => x.id === id) : { name: '', address: '', memo: '' };
  openSheet(id ? '건물 수정' : '건물 추가', `<form data-form="building" data-id="${id || ''}">
    ${field('건물명 *', `<input name="name" required maxlength="40" value="${esc(b.name)}" placeholder="예: 강남빌딩">`)}
    ${field('주소', `<input name="address" maxlength="80" value="${esc(b.address)}">`)}
    ${field('메모', `<textarea name="memo">${esc(b.memo)}</textarea>`)}
    <button class="btn pri block" type="submit">저장</button>
    ${id ? '<button class="btn danger block" type="button" style="margin-top:10px" data-act="delBuilding" data-id="' + id + '">건물 삭제</button>' : ''}
  </form>`);
}
function openUnitForm(buildingId, id) {
  const u = id ? S.units.find(x => x.id === id) : { name: '', memo: '', buildingId };
  openSheet(id ? '호실 수정' : '호실 추가', `<form data-form="unit" data-id="${id || ''}" data-bid="${u.buildingId}">
    ${field('호실명 *', `<input name="name" required maxlength="30" value="${esc(u.name)}" placeholder="예: 301호">`)}
    ${field('메모', `<textarea name="memo">${esc(u.memo)}</textarea>`)}
    <button class="btn pri block" type="submit">저장</button>
    ${id ? '<button class="btn danger block" type="button" style="margin-top:10px" data-act="delUnit" data-id="' + id + '">호실 삭제</button>' : ''}
  </form>`, id ? { back: () => openUnit(id) } : {});
}

function openUnit(id) {
  const { b } = ix();
  const unit = S.units.find(x => x.id === id); if (!unit) return closeSheet();
  const bld = b.get(unit.buildingId);
  const leases = S.leases.filter(l => l.unitId === id);
  const act = leases.find(l => l.status === 'active');
  const past = leases.filter(l => l !== act).sort((a, b2) => b2.start.localeCompare(a.start));
  let h = '';
  if (act) {
    const d = diff(today(), act.end);
    h += `<div class="card"><div class="row between"><b>${esc(act.tenant)}</b>${unitChip(unit).chips}</div>
      <dl class="kv" style="margin:10px 0">
        <dt>전화</dt><dd>${esc(act.phone) || '-'}</dd>
        <dt>계약기간</dt><dd>${fmtDot(act.start)} ~ ${fmtDot(act.end)}${d >= 0 ? ` (D-${d})` : ''}</dd>
        <dt>납입일</dt><dd>매월 ${act.payDay}일 · ${act.mode === 'pre' ? '선불' : '후불'}</dd>
        <dt>보증금</dt><dd>${won(act.deposit)}</dd>
        <dt>월세</dt><dd>${won(act.rent)}</dd>
        <dt>관리비</dt><dd>${won(act.fee)}</dd>
        ${act.memo ? `<dt>메모</dt><dd>${esc(act.memo)}</dd>` : ''}
      </dl>
      <div class="acts">${sheetLinks(act)}</div>
      <div class="acts"><button class="btn" data-act="editLease" data-id="${act.id}">계약 수정(갱신)</button><button class="btn danger" data-act="endLease" data-id="${act.id}">계약 종료</button></div></div>`;
    const ps = S.payments.filter(p => p.leaseId === act.id).sort((a, b2) => b2.due.localeCompare(a.due));
    h += `<div class="sec">납부 내역 (${ps.length}건 · 탭하면 납부 처리)</div>` + ps.map(p => {
      const c = chipOf(p);
      return `<div class="pr" data-act="pay" data-id="${p.id}"><div class="grow"><b>${+p.month.slice(5)}월분</b> <span class="small muted">${fmtDot(p.due)}</span></div><span class="a">${won(total(p))}</span><span class="chip ${c.cls}">${c.label}</span></div>`;
    }).join('');
  } else {
    h += `<div class="empty-state" style="padding:20px"><div class="big">🔑</div><p>현재 계약이 없는 공실이에요.</p><button class="btn pri" data-act="addLease" data-id="${id}">+ 계약 등록</button></div>`;
  }
  if (past.length) {
    h += `<div class="sec">지난 계약</div>` + past.map(l => `<div class="pr" style="cursor:default"><div class="grow"><b>${esc(l.tenant)}</b><div class="small muted">${fmtDot(l.start)} ~ ${fmtDot(l.end)} · ${short(l.rent)}</div></div><button class="btn sm danger" data-act="delLease" data-id="${l.id}">삭제</button></div>`).join('');
  }
  h += `<div class="row" style="margin-top:18px"><button class="btn" data-act="editUnit" data-id="${id}">호실 수정</button></div>`;
  openSheet(`${bld.name} ${unit.name}`, h, { reopen: () => openUnit(id) });
}

function openLeaseForm(unitId, leaseId) {
  const l = leaseId ? S.leases.find(x => x.id === leaseId) : { tenant: '', phone: '', start: '', end: '', payDay: '', mode: 'pre', deposit: '', rent: '', fee: 0, memo: '' };
  openSheet(leaseId ? '계약 수정(갱신)' : '계약 등록', `<form data-form="lease" data-id="${leaseId || ''}" data-uid="${unitId}">
    ${field('세입자명 *', `<input name="tenant" required maxlength="30" value="${esc(l.tenant)}">`)}
    ${field('전화번호', `<input name="phone" type="tel" inputmode="tel" maxlength="20" value="${esc(l.phone)}" placeholder="010-0000-0000">`)}
    <div class="f2">
      ${field('계약일 *', `<input name="start" type="date" required value="${l.start}">`)}
      ${field('만료일 *', `<input name="end" type="date" required value="${l.end}">`)}
    </div>
    <div class="hint" style="margin:-6px 0 12px">만료일은 계약 마지막 날이에요. 예) 1년 계약: 2026-11-01 ~ 2027-10-31</div>
    <div class="f2">
      ${field('납입일 (매월) *', `<input name="payDay" type="number" inputmode="numeric" min="1" max="31" required value="${l.payDay}" placeholder="예: 5">`, '31일은 짧은 달엔 말일')}
      ${field('납부 방식', `<select name="mode"><option value="pre" ${l.mode === 'pre' ? 'selected' : ''}>선불</option><option value="post" ${l.mode === 'post' ? 'selected' : ''}>후불</option></select>`, '선불: 해당 월 납입일에 그 달 분 · 후불: 다음 달 납입일에 받음')}
    </div>
    ${field('보증금 (원)', `<input class="money" name="deposit" inputmode="numeric" value="${numFmt(l.deposit)}">`)}
    <div class="f2">
      ${field('월세 (원) *', `<input class="money" name="rent" inputmode="numeric" required value="${numFmt(l.rent)}">`)}
      ${field('관리비 (원)', `<input class="money" name="fee" inputmode="numeric" value="${numFmt(l.fee)}">`)}
    </div>
    ${field('메모', `<textarea name="memo">${esc(l.memo)}</textarea>`)}
    ${leaseId
      ? '<div class="note">저장하면 <b>납부 기록이 없는 앞으로의 청구</b>가 새 조건(월세·관리비·납입일·만료일)으로 다시 만들어져요. 이미 납부했거나 지난 청구는 그대로 유지됩니다.</div>'
      : '<label class="chk"><input type="checkbox" name="markPast" checked><span>계약일이 과거면, <b>이미 지난 회차는 납부 완료</b>로 기록<br><span class="muted small">이미 진행 중인 계약을 입력할 때 켜 두세요. 끄면 지난 회차가 모두 연체로 표시돼요.</span></span></label>'}
    <button class="btn pri block" type="submit">저장</button>
  </form>`, { back: () => openUnit(unitId) });
}

function openNotifs() {
  const notifs = getNotifications();
  if (!notifs.length) {
    openSheet('알림', `<div class="empty-state"><div class="big">🔔</div><p>알림이 없어요.<br><span class="small muted">3일 이내 납부 예정, 오늘 납부일, 연체, 부분납부가 여기에 표시돼요.</span></p></div>`);
    return;
  }
  const rows = notifs.map(n => {
    const p = n.payment;
    const chipCls = n.type==='overdue' ? 'late' : n.type==='today' ? 'wait' : n.type==='soon' ? 'wait' : 'part';
    const chipLabel = n.type==='overdue' ? `연체 ${n.days}일` : n.type==='today' ? '오늘 납부일' : n.type==='soon' ? `D-${n.days}` : '부분납부';
    return `<div class="pc ${n.type==='overdue'?'late': n.type==='today'?'wait':'part'}" data-act="pay" data-id="${p.id}" style="cursor:pointer">
      <div class="row between">
        <div class="grow"><div class="t">${esc(n.title)}</div><div class="small muted">${esc(n.desc)}</div></div>
        <div class="right"><span class="chip ${chipCls}">${chipLabel}</span></div>
      </div>
    </div>`;
  }).join('');
  openSheet(`🔔 알림 ${notifs.length}건`, `<div style="display:flex;flex-direction:column;gap:8px">${rows}</div><div class="note" style="margin-top:12px">💡 D-3, 오늘, 연체, 부분납부만 표시해요. 건물 필터가 적용돼요.</div>`);
}

function openPay(id, back) {
  const p = S.payments.find(x => x.id === id); if (!p) return;
  const { lease, unit, bld } = ctxOf(p);
  const st = status(p), c = chipOf(p), t = today();
  const paid = p.paidAmount || 0;
  openSheet('납부 처리', `<div class="card"><div class="row between"><div><b>${esc(bld.name)} ${esc(unit.name)} · ${esc(lease.tenant)}</b>
      <div class="small muted">${+p.month.slice(5)}월분 · 납부 예정일 ${fmtK(p.due)}</div></div><span class="chip ${c.cls}">${c.label}</span></div>
      <div class="acts">${sheetLinks(lease, st === 'paid' ? null : p)}</div></div>
    <form data-form="pay" data-id="${p.id}">
      <div class="f2">
        ${field('청구 월세 (원)', `<input class="money" name="rent" inputmode="numeric" value="${numFmt(p.rent)}">`)}
        ${field('청구 관리비 (원)', `<input class="money" name="fee" inputmode="numeric" value="${numFmt(p.fee)}">`)}
      </div>
      <div class="hint" style="margin:-6px 0 12px">관리비가 달마다 다르면 이번 달 금액만 고치세요.</div>
      <div class="f2">
        ${field('납부일', `<input name="paidDate" type="date" value="${p.paidDate || t}">`)}
        ${field('납부 금액 (원)', `<input class="money" name="paidAmount" inputmode="numeric" value="${numFmt(paid > 0 ? paid : total(p))}">`)}
      </div>
      ${field('메모', `<input name="memo" maxlength="60" value="${esc(p.memo)}" placeholder="예: 계좌이체, 현금">`)}
      <button class="btn pri block" type="submit" data-mode="pay">납부 저장</button>
      <button class="btn block" type="submit" data-mode="bill" style="margin-top:8px">청구 금액만 저장 (납부 기록 안 함)</button>
      ${paid > 0 ? `<button class="btn danger block" type="button" style="margin-top:8px" data-act="cancelPay" data-id="${p.id}">납부 취소</button>` : ''}
    </form>`, { back: back || (cur && cur.opts.reopen) || null });
}

/* ---------- 잠금 ---------- */
async function hashPin(p) {
  try {
    const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('richgo:' + p));
    return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
  } catch (e) { return 'x' + btoa(p); }
}
let pinBuf = '';
function showLock() {
  pinBuf = '';
  const el = $('#lock');
  el.innerHTML = `<div style="font-size:42px">🔒</div><h2>Rich Go</h2><div class="muted small">PIN 4자리를 입력하세요</div><div class="dots" id="dots">${'<i></i>'.repeat(4)}</div>
    <div class="keys">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => `<button data-act="key" data-k="${n}">${n}</button>`).join('')}<span></span><button data-act="key" data-k="0">0</button><button data-act="key" data-k="del">⌫</button></div>`;
  el.classList.add('on'); unlocked = false;
}
async function pressKey(k) {
  if (k === 'del') pinBuf = pinBuf.slice(0, -1); else if (pinBuf.length < 4) pinBuf += k;
  document.querySelectorAll('#dots i').forEach((d, i) => d.classList.toggle('f', i < pinBuf.length));
  if (pinBuf.length === 4) {
    const ok = (await hashPin(pinBuf)) === S.settings.pin;
    if (ok) { unlocked = true; $('#lock').classList.remove('on'); $('#lock').innerHTML = ''; }
    else {
      const d = $('#dots'); d.classList.add('shake'); setTimeout(() => { d.classList.remove('shake'); pinBuf = ''; document.querySelectorAll('#dots i').forEach(x => x.classList.remove('f')); }, 320);
    }
  }
}

/* ---------- 백업 ---------- */
function download(name, text, type) {
  const blob = new Blob([text], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
}
const stamp = () => today().replace(/-/g, '');
async function exportJson(share) {
  S.settings.lastBackup = today();
  await saveState();
  const text = JSON.stringify(S, null, 1), name = `richgo-backup-${stamp()}.json`;
  if (share) {
    try {
      const f = new File([text], name, { type: 'application/json' });
      if (navigator.canShare && navigator.canShare({ files: [f] })) { await navigator.share({ files: [f], title: 'Rich Go 백업' }); render(); return; }
    } catch (e) { if (e && e.name === 'AbortError') return; }
  }
  download(name, text, 'application/json'); render(); toast('백업 파일을 저장했어요');
}
function exportCsv() {
  const head = ['건물', '호실', '세입자', '전화번호', '청구월', '납부예정일', '월세', '관리비', '청구합계', '납부일', '납부금액', '상태', '메모'];
  const lab = { paid: '납부', wait: '대기', part: '부분납부', late: '연체' };
  const rows = S.payments.filter(p => ctxOf(p).lease).sort((a, b) => a.due.localeCompare(b.due)).map(p => {
    const { lease, unit, bld } = ctxOf(p);
    return [bld.name, unit.name, lease.tenant, lease.phone, p.month, p.due, p.rent, p.fee, total(p), p.paidDate || '', p.paidAmount || 0, lab[status(p)], p.memo];
  });
  const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  download(`richgo-payments-${stamp()}.csv`, '﻿' + [head, ...rows].map(r => r.map(q).join(',')).join('\r\n'), 'text/csv');
  toast('CSV 파일을 저장했어요');
}
function importJsonText(text) {
  let d; try { d = JSON.parse(text); } catch (e) { return toast('올바른 백업 파일이 아니에요'); }
  if (!d || !Array.isArray(d.buildings) || !Array.isArray(d.units) || !Array.isArray(d.leases) || !Array.isArray(d.payments)) return toast('Rich Go 백업 파일이 아니에요');
  if (!confirm(`백업 파일로 복원할까요?\n(건물 ${d.buildings.length} · 호실 ${d.units.length} · 계약 ${d.leases.length} · 청구 ${d.payments.length})\n지금 저장된 데이터는 사라집니다.`)) return;
  S = normalize(d); commit('복원했어요');
}

/* ---------- 샘플 데이터 ---------- */
function loadSample() {
  if (S.buildings.length && !confirm('샘플 데이터를 추가할까요? (기존 데이터는 유지돼요)')) return;
  const t = today(), ms = t.slice(0, 7) + '-01';
  const b1 = { id: nid(), name: '강남빌딩', address: '서울 강남구 (샘플)', memo: '' };
  const b2 = { id: nid(), name: '해운대하우스', address: '부산 해운대구 (샘플)', memo: '' };
  S.buildings.push(b1, b2);
  const mk = (b, name) => { const u = { id: nid(), buildingId: b.id, name, memo: '' }; S.units.push(u); return u; };
  const u1 = mk(b1, '301호'), u2 = mk(b1, '302호'); mk(b1, '401호');
  const u4 = mk(b2, '101호'), u5 = mk(b2, '102호');
  const lease = (u, o) => { const l = Object.assign({ id: nid(), unitId: u.id, status: 'active', memo: '' }, o); S.leases.push(l); syncPayments(l, true); return l; };
  const lastPast = l => S.payments.filter(p => p.leaseId === l.id && p.due < t).sort((a, b) => b.due.localeCompare(a.due))[0];
  const A = lease(u1, { tenant: '김민수', phone: '010-1234-5678', start: addMonths(ms, -8), end: addDays(addMonths(ms, 4), -1), payDay: 5, mode: 'pre', deposit: 10000000, rent: 850000, fee: 80000 });
  lease(u2, { tenant: '이서연', phone: '010-2222-3333', start: addMonths(ms, -5), end: addDays(t, 40), payDay: 25, mode: 'post', deposit: 8000000, rent: 700000, fee: 60000 });
  const C = lease(u4, { tenant: '박지훈', phone: '010-4444-5555', start: addMonths(ms, -3), end: addDays(addMonths(ms, 9), -1), payDay: 15, mode: 'pre', deposit: 5000000, rent: 600000, fee: 50000 });
  lease(u5, { tenant: '최유리', phone: '010-7777-8888', start: addMonths(ms, -2), end: addDays(addMonths(ms, 10), -1), payDay: 31, mode: 'pre', deposit: 5000000, rent: 550000, fee: 40000 });
  const pa = lastPast(A); if (pa) { pa.paidAmount = 0; pa.paidDate = null; pa.memo = ''; }
  const pc = lastPast(C); if (pc) { pc.paidAmount = Math.round(total(pc) / 2); pc.memo = '일부 입금'; }
  commit('샘플 데이터를 넣었어요');
}

/* ---------- 이벤트: 클릭 ---------- */
const ACTIONS = {
  tab: el => { ui.tab = el.dataset.tab; window.scrollTo(0, 0); render(); },
  prevMonth: () => { let { y, m } = ui.month; m--; if (m < 1) { m = 12; y--; } setMonth(y, m); },
  nextMonth: () => { let { y, m } = ui.month; m++; if (m > 12) { m = 1; y++; } setMonth(y, m); },
  thisMonth: () => { initMonth(); render(); },
  selday: el => { ui.sel = el.dataset.date; render(); },
  overdue: () => openOverdue(),
  openNotifs: () => openNotifs(),
  closeSheet: () => closeSheet(),
  sheetBack: () => cur && cur.opts.back && cur.opts.back(),
  key: el => pressKey(el.dataset.k),

  addBuilding: () => openBuilding(),
  editBuilding: el => openBuilding(+el.dataset.id),
  delBuilding: async el => {
    const id = +el.dataset.id, uids = S.units.filter(u => u.buildingId === id).map(u => u.id);
    if (!confirm(`이 건물과 소속 호실 ${uids.length}개, 계약, 납부 기록이 모두 삭제돼요. 삭제할까요?`)) return;
    removeUnits(uids); S.buildings = S.buildings.filter(b => b.id !== id);
    if (String(ui.filter) === String(id)) ui.filter = 'all';
    closeSheet(); await commit('삭제했어요');
  },
  addUnit: el => openUnitForm(+el.dataset.id),
  editUnit: el => openUnitForm(null, +el.dataset.id),
  delUnit: async el => {
    const id = +el.dataset.id;
    if (!confirm('이 호실과 계약, 납부 기록이 모두 삭제돼요. 삭제할까요?')) return;
    removeUnits([id]); closeSheet(); await commit('삭제했어요');
  },
  openUnit: el => openUnit(+el.dataset.id),

  addLease: el => {
    const uid = +el.dataset.id;
    if (leaseOfUnit(uid)) { toast('진행 중인 계약이 있어요. 새 세입자는 먼저 계약을 종료해 주세요.'); return; }
    openLeaseForm(uid);
  },
  editLease: el => { const l = S.leases.find(x => x.id === +el.dataset.id); openLeaseForm(l.unitId, l.id); },
  endLease: async el => {
    const l = S.leases.find(x => x.id === +el.dataset.id);
    if (!confirm(`${l.tenant}님 계약을 종료할까요?\n납부 기록이 없는 앞으로의 청구는 삭제되고, 이미 연체된 청구는 남아요.`)) return;
    const t = today();
    l.status = 'ended';
    S.payments = S.payments.filter(p => !(p.leaseId === l.id && !(p.paidAmount > 0) && p.due >= t));
    await commit('계약을 종료했어요'); openUnit(l.unitId);
  },
  delLease: async el => {
    const l = S.leases.find(x => x.id === +el.dataset.id);
    if (!confirm('이 지난 계약과 납부 기록을 삭제할까요?')) return;
    S.payments = S.payments.filter(p => p.leaseId !== l.id); S.leases = S.leases.filter(x => x.id !== l.id);
    await commit('삭제했어요'); openUnit(l.unitId);
  },

  pay: el => openPay(+el.dataset.id),
  cancelPay: async el => {
    const p = S.payments.find(x => x.id === +el.dataset.id);
    if (!confirm('납부 기록을 취소할까요?')) return;
    p.paidAmount = 0; p.paidDate = null; await commit('납부를 취소했어요'); finish();
  },

  setPin: () => openSheet('PIN 설정', `<form data-form="pin">
    ${field('새 PIN (숫자 4자리)', '<input name="p1" type="password" inputmode="numeric" pattern="\\d{4}" maxlength="4" required autocomplete="off">')}
    ${field('PIN 확인', '<input name="p2" type="password" inputmode="numeric" pattern="\\d{4}" maxlength="4" required autocomplete="off">', 'PIN을 잊으면 앱에 들어올 수 없어요. 꼭 기억하세요. (백업 파일로 복원은 가능)')}
    <button class="btn pri block" type="submit">저장</button></form>`),
  clearPin: async () => { if (!confirm('앱 잠금을 해제할까요?')) return; S.settings.pin = null; await commit('잠금을 해제했어요'); },
  resetSms: async () => { S.settings.sms = DEFAULT_SMS; await commit('기본 문구로 되돌렸어요'); },
  exportJson: () => exportJson(false),
  shareJson: () => exportJson(true),
  importJson: () => $('#importFile').click(),
  exportCsv: () => exportCsv(),
  install: async () => { if (!deferredInstall) return; deferredInstall.prompt(); await deferredInstall.userChoice; deferredInstall = null; render(); },
  sample: () => loadSample(),
  wipe: async () => {
    if (!confirm('모든 데이터를 삭제할까요? 되돌릴 수 없어요.\n(먼저 백업을 권장해요)')) return;
    if (!confirm('정말 삭제할까요?')) return;
    const pin = S.settings.pin; S = defaults(); S.settings.pin = pin; ui.filter = 'all'; await commit('전체 삭제했어요');
  },

  // Phase 2 알림 설정
  toggleNotifEnabled: async el => {
    const on = el.checked;
    if (on) {
      const ok = await requestNotifPermission();
      if (!ok) { el.checked = false; return; }
    }
    S.settings.notifications.enabled = on;
    await commit(on ? '알림을 켰어요. 매일 설정 시간에 확인해요' : '알림을 껐어요');
    if (on) checkAndSendDailyNotifs(true);
  },
  toggleNotifType: async el => {
    const type = el.dataset.type;
    S.settings.notifications[type] = el.checked;
    await commit('알림 설정을 저장했어요');
  },
  notifTime: async el => {
    S.settings.notifications.time = el.value || "09:00";
    await commit(`알림 시간을 ${S.settings.notifications.time}로 저장했어요`);
  },
  notifBuilding: async el => {
    S.settings.notifications.buildings = el.value;
    await commit('건물 필터를 저장했어요');
  },
  requestNotifPerm: async () => {
    await requestNotifPermission();
  },
  testNotif: async () => {
    if (!canNotify()) return toast('이 브라우저는 알림을 지원하지 않아요');
    if (Notification.permission !== 'granted') {
      const ok = await requestNotifPermission();
      if (!ok) return;
    }
    const notifs = getSystemNotifs(today());
    if (!notifs.length) {
      // 테스트용 더미 알림이 없으면 샘플로 보내기
      sendSystemNotification([{type:'today', title:'테스트', desc:'Rich Go 알림 테스트', payment:{id:0}}]);
      // 실제로는 더미
      if (navigator.serviceWorker && navigator.serviceWorker.ready) {
        const reg = await navigator.serviceWorker.ready;
        reg.showNotification('Rich Go 테스트 알림', { body: '🔔 알림이 정상 작동해요\n연체/오늘/예정 내역이 있을 때 매일 알림이 와요', icon:'./icon-192.png', badge:'./icon-192.png', tag:'richgo-test' });
      } else {
        new Notification('Rich Go 테스트 알림', { body: '알림이 정상 작동해요' });
      }
      toast('테스트 알림을 보냈어요');
    } else {
      sendSystemNotification(notifs);
      toast(`알림 ${notifs.length}건을 보냈어요`);
      S.settings.notifications.lastSentDate = null; // 테스트이므로 날짜 초기화 안 함, 강제로 다시 보낼 수 있게
      await saveState();
    }
  }
};
function setMonth(y, m) {
  ui.month = { y, m };
  const t = today();
  ui.sel = (t.slice(0, 7) === `${y}-${pad(m)}`) ? t : ymd(y, m, 1);
  render();
}
function removeUnits(uids) {
  const lids = S.leases.filter(l => uids.includes(l.unitId)).map(l => l.id);
  S.payments = S.payments.filter(p => !lids.includes(p.leaseId));
  S.leases = S.leases.filter(l => !lids.includes(l.id));
  S.units = S.units.filter(u => !uids.includes(u.id));
}

/* ---------- 이벤트: 폼 제출 ---------- */
const FORMS = {
  building: async (f) => {
    const id = +f.dataset.id, name = f.elements.name.value.trim();
    if (!name) return;
    const data = { name, address: f.elements.address.value.trim(), memo: f.elements.memo.value.trim() };
    if (id) Object.assign(S.buildings.find(b => b.id === id), data); else S.buildings.push({ id: nid(), ...data });
    closeSheet(); await commit('저장했어요');
  },
  unit: async (f) => {
    const id = +f.dataset.id, name = f.elements.name.value.trim();
    if (!name) return;
    const data = { name, memo: f.elements.memo.value.trim() };
    let uid = id;
    if (id) Object.assign(S.units.find(u => u.id === id), data);
    else { uid = nid(); S.units.push({ id: uid, buildingId: +f.dataset.bid, ...data }); }
    await commit('저장했어요'); openUnit(uid);
  },
  lease: async (f) => {
    const g = n => f.elements[n].value.trim(), num = n => Number((f.elements[n].value || '').replace(/\D/g, '')) || 0;
    const data = { tenant: g('tenant'), phone: g('phone'), start: g('start'), end: g('end'), payDay: Math.min(31, Math.max(1, parseInt(g('payDay'), 10) || 0)), mode: g('mode'), deposit: num('deposit'), rent: num('rent'), fee: num('fee'), memo: g('memo') };
    if (!data.tenant) return toast('세입자명을 입력해 주세요');
    if (!data.start || !data.end) return toast('계약일과 만료일을 입력해 주세요');
    if (data.end < data.start) return toast('만료일이 계약일보다 빨라요');
    if (!data.payDay) return toast('납입일(1~31)을 입력해 주세요');
    const id = +f.dataset.id, uid = +f.dataset.uid;
    let l;
    if (id) { l = S.leases.find(x => x.id === id); Object.assign(l, data); syncPayments(l, false); }
    else { l = { id: nid(), unitId: uid, status: 'active', ...data }; S.leases.push(l); syncPayments(l, !!(f.elements.markPast && f.elements.markPast.checked)); }
    await commit(id ? '계약을 갱신했어요' : '계약을 등록했어요'); openUnit(uid);
  },
  pay: async (f, submitter) => {
    const p = S.payments.find(x => x.id === +f.dataset.id);
    const num = n => Number((f.elements[n].value || '').replace(/\D/g, '')) || 0;
    p.rent = num('rent'); p.fee = num('fee'); p.memo = f.elements.memo.value.trim();
    if (!submitter || submitter.dataset.mode !== 'bill') {
      const amt = num('paidAmount');
      if (amt > 0) { p.paidAmount = amt; p.paidDate = f.elements.paidDate.value || today(); }
      else { p.paidAmount = 0; p.paidDate = null; }
    }
    await commit('저장했어요'); finish();
  },
  pin: async (f) => {
    const a = f.elements.p1.value, b = f.elements.p2.value;
    if (!/^\d{4}$/.test(a)) return toast('숫자 4자리로 입력해 주세요');
    if (a !== b) return toast('PIN이 서로 달라요');
    S.settings.pin = await hashPin(a); unlocked = true;
    closeSheet(); await commit('앱 잠금을 설정했어요');
  },
  sms: async (f) => { S.settings.sms = f.elements.sms.value.trim() || DEFAULT_SMS; await commit('저장했어요'); }
};

/* ---------- 시작 ---------- */
async function boot() {
  document.addEventListener('click', e => {
    if (e.target.closest('a[href]') && !e.target.closest('a[data-act]')) return;     // 전화/문자 링크는 그대로 동작
    const el = e.target.closest('[data-act]');
    if (!el) return;
    if (el.tagName === 'A') e.preventDefault();
    const fn = ACTIONS[el.dataset.act];
    if (fn) fn(el);
  });
  document.addEventListener('submit', e => {
    const f = e.target.closest('form[data-form]'); if (!f) return;
    e.preventDefault();
    const fn = FORMS[f.dataset.form]; if (fn) fn(f, e.submitter);
  });
  document.addEventListener('input', e => {
    const t = e.target;
    if (t.classList && t.classList.contains('money')) { const d = t.value.replace(/\D/g, ''); t.value = d ? Number(d).toLocaleString('ko-KR') : ''; }
  });
  document.addEventListener('change', e => {
    const t = e.target;
    if (t.id === 'flt') { ui.filter = t.value; render(); }
    else if (t.dataset.act === 'notifTime') { S.settings.notifications.time = t.value || "09:00"; saveState().then(()=>toast(`알림 시간 ${S.settings.notifications.time}`)); }
    else if (t.dataset.act === 'notifBuilding') { S.settings.notifications.buildings = t.value; saveState().then(()=>{ toast('건물 필터 저장'); render(); }); }
    else if (t.id === 'importFile') { const f = t.files[0]; if (f) f.text().then(importJsonText); t.value = ''; }
    else if (t.name === 'start' && t.form && t.form.dataset.form === 'lease' && t.value) {
      const fm = t.form.elements;
      if (!fm.end.value) fm.end.value = addDays(addMonths(t.value, 12), -1);
      if (!fm.payDay.value) fm.payDay.value = parseD(t.value).d;
    }
  });
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredInstall = e; if (ui.tab === 'settings') render(); });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { hiddenAt = Date.now(); return; }
    if (S.settings.pin && unlocked && Date.now() - hiddenAt > 30000) showLock();
    const t = today(); if (ui.month && ui.sel && !cur) { /* 날짜가 바뀌었을 수 있어 다시 그림 */ }
    render();
  });

  S = normalize(await loadState());
  initMonth();
  render();
  if (S.settings.pin) showLock(); else unlocked = true;
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
    // Phase 2: 서비스워커 준비 후 매일 알림 체크
    setTimeout(() => { checkAndSendDailyNotifs(); }, 1500);
  }
  // 1분마다 시간 체크 (앱이 열려 있을 때만)
  setInterval(() => { checkAndSendDailyNotifs(); }, 60*1000);
}

function bootVisibilityCheck() {
  // 앱이 다시 보일 때마다 알림 체크
  if (!document.hidden) checkAndSendDailyNotifs();
}
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => { if (!document.hidden) bootVisibilityCheck(); });
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') boot();

/* 테스트용 내보내기 (브라우저에서는 무시됨) */
if (typeof module !== 'undefined') module.exports = {
  buildPayments, syncPayments, status, total, remain, addMonths, addDays, diff, ymd, normalize, defaults,
  get S() { return S; }, set S(v) { S = v; }
};
