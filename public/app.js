'use strict';
(function () {
  /* ---------------------------------------------------------------- */
  /* Tiện ích                                                          */
  /* ---------------------------------------------------------------- */
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (n) => String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const money = (n) => fmt(n) + 'đ';
  const pad = (n) => String(n).padStart(2, '0');

  /** Gõ "50", "50k", "50.000", "1,5tr" đều hiểu đúng. Số nhỏ hơn 1.000 (không có chữ) hiểu là nghìn đồng. */
  function parseMoney(input) {
    let s = String(input == null ? '' : input).toLowerCase().replace(/\s+/g, '').replace(/đ|vnd|vnđ/g, '');
    if (!s) return 0;
    let mult = 1;
    if (/(tr|m)$/.test(s)) { mult = 1e6; s = s.replace(/(tr|m)$/, ''); }
    else if (/k$/.test(s)) { mult = 1e3; s = s.slice(0, -1); }
    if (mult > 1) {
      const n = parseFloat(s.replace(',', '.'));
      return Number.isFinite(n) && n > 0 ? Math.round(n * mult) : 0;
    }
    const n = parseInt(s.replace(/[.,]/g, ''), 10);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return n < 1000 ? n * 1000 : n;
  }

  function monthOf(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1); }
  function shiftMonth(m, delta) { const [y, mo] = m.split('-').map(Number); return monthOf(new Date(y, mo - 1 + delta, 1)); }
  function monthLabel(m) { const [y, mo] = m.split('-'); return `Tháng ${Number(mo)}/${y}`; }
  function dayLabel(day) {
    const [y, m, d] = day.split('-').map(Number);
    const names = ['Chủ nhật', 'Thứ hai', 'Thứ ba', 'Thứ tư', 'Thứ năm', 'Thứ sáu', 'Thứ bảy'];
    return `${names[new Date(y, m - 1, d).getDay()]}, ${pad(d)}/${pad(m)}`;
  }
  const billNo = (n) => (n ? '#' + String(n).padStart(4, '0') : 'IN THỬ');

  async function api(path, opts = {}) {
    const init = { method: opts.method || 'GET', headers: { 'Content-Type': 'application/json' } };
    if (opts.body !== undefined) init.body = JSON.stringify(opts.body);
    let res;
    try { res = await fetch(path, init); }
    catch (e) { throw new Error('Không kết nối được máy chủ ở tiệm. Kiểm tra máy tính đã bật, cửa sổ app còn chạy và iPhone cùng WiFi.'); }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Lỗi ${res.status}`);
    return data;
  }

  let toastTimer;
  function toast(msg, bad) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.toggle('bad', !!bad);
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), bad ? 4500 : 2200);
  }

  function openSheet(html) {
    closeSheet();
    const el = document.createElement('div');
    el.className = 'sheet-wrap';
    el.innerHTML = `<div class="sheet-bg" data-action="close-sheet"></div><div class="sheet" role="dialog" aria-modal="true">${html}</div>`;
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add('open'));
    return el;
  }
  function closeSheet() { $$('.sheet-wrap').forEach((e) => e.remove()); }

  /* ---------------------------------------------------------------- */
  /* Trạng thái                                                        */
  /* ---------------------------------------------------------------- */
  const state = {
    settings: null,
    services: [],
    info: null,
    tab: 'sell',
    cart: new Map(),   // id dịch vụ -> số lượng
    extras: [],        // khoản khác: {name, price, qty}
    note: '',
    month: monthOf(new Date()),
    bills: [],
    openBill: null,
    printers: [],
    busy: false,
    sheetBill: null,
  };

  async function loadState() {
    const d = await api('/api/state');
    state.settings = d.settings;
    state.services = d.services;
    state.info = d.info;
    for (const id of Array.from(state.cart.keys())) {
      if (!state.services.some((s) => s.id === id)) state.cart.delete(id);
    }
  }

  /* ---------------------------------------------------------------- */
  /* Giỏ hàng / tính tiền                                              */
  /* ---------------------------------------------------------------- */
  function cartItems() {
    const items = [];
    for (const s of state.services) {
      const q = state.cart.get(s.id);
      if (q) items.push({ name: s.name, price: s.price, qty: q });
    }
    for (const e of state.extras) items.push({ name: e.name, price: e.price, qty: e.qty });
    return items;
  }
  const cartTotal = () => cartItems().reduce((s, i) => s + i.price * i.qty, 0);
  const cartCount = () => cartItems().reduce((s, i) => s + i.qty, 0);

  function clearCart() { state.cart.clear(); state.extras = []; state.note = ''; }

  function viewSell() {
    $('#view').innerHTML = `
      <div class="page-head"><h1>${esc(state.settings.shopName || 'Tính tiền')}</h1><button class="link" data-action="clear-cart">Xoá chọn</button></div>
      <input id="note" class="input" placeholder="Tên khách / ghi chú (không bắt buộc)" maxlength="100" value="${esc(state.note)}" autocomplete="off">
      <div id="svcList"></div>
      <button class="btn ghost wide" data-action="add-extra">＋ Thêm khoản khác</button>`;
    paintSell();
  }

  function paintSell() {
    const list = $('#svcList');
    if (list) {
      let html = state.services.map((s) => {
        const q = state.cart.get(s.id) || 0;
        return `<div class="svc ${q ? 'on' : ''}" data-action="toggle" data-id="${esc(s.id)}" role="button" tabindex="0">
          <span class="chk" aria-hidden="true">✓</span>
          <span class="svc-main"><span class="svc-name">${esc(s.name)}</span><span class="svc-price">${money(s.price)}</span></span>
          ${q ? `<span class="stepper"><button data-action="dec" data-id="${esc(s.id)}" aria-label="Giảm">−</button><b>${q}</b><button data-action="inc" data-id="${esc(s.id)}" aria-label="Tăng">＋</button></span>` : ''}
        </div>`;
      }).join('');
      html += state.extras.map((e, i) => `<div class="svc on">
          <span class="chk" aria-hidden="true">✓</span>
          <span class="svc-main"><span class="svc-name">${esc(e.name)}</span><span class="svc-price">${money(e.price)} · khoản khác</span></span>
          <span class="stepper"><button data-action="extra-dec" data-i="${i}" aria-label="Giảm">−</button><b>${e.qty}</b><button data-action="extra-inc" data-i="${i}" aria-label="Tăng">＋</button></span>
        </div>`).join('');
      if (!state.services.length && !state.extras.length) {
        html = '<div class="empty">Chưa có dịch vụ nào.<br>Vào mục <b>Cài đặt</b> để thêm dịch vụ và giá.</div>';
      }
      list.innerHTML = html;
    }
    paintBar();
  }

  function paintBar() {
    const n = cartCount();
    $('#barTotal').textContent = money(cartTotal());
    $('#barCount').textContent = n ? `${n} khoản` : 'Chưa chọn';
    $('#btnSave').disabled = !n || state.busy;
    $('#btnPrint').disabled = !n || state.busy;
    $('#btnPrint').textContent = state.busy ? 'Đang xử lý…' : 'Lưu & In bill';
  }

  function openExtraSheet() {
    const el = openSheet(`
      <h3>Thêm khoản khác</h3>
      <label class="field">Tên khoản<input id="exName" class="input" placeholder="VD: Đính đá" maxlength="60" autocomplete="off"></label>
      <label class="field">Giá (gõ 20 hoặc 20000 đều được)<input id="exPrice" class="input" inputmode="numeric" placeholder="VD: 20000" autocomplete="off"></label>
      <div class="row"><button class="btn ghost" data-action="close-sheet">Huỷ</button><button class="btn primary" data-action="extra-ok">Thêm</button></div>`);
    setTimeout(() => $('#exName', el).focus(), 250);
  }

  async function checkout(print) {
    if (state.busy) return;
    const items = cartItems();
    if (!items.length) return toast('Chưa chọn dịch vụ nào');
    state.busy = true; paintBar();
    let bill;
    try {
      const note = ($('#note') ? $('#note').value : state.note).trim();
      ({ bill } = await api('/api/bills', { method: 'POST', body: { items, note } }));
    } catch (e) {
      state.busy = false; paintBar();
      return toast(e.message, true);
    }
    clearCart();
    state.busy = false;
    if (state.tab === 'sell') viewSell();
    if (!print) return toast(`Đã lưu bill ${billNo(bill.no)}`);
    try {
      await printBill(bill);
      toast(`Đã in bill ${billNo(bill.no)}`);
    } catch (e) {
      showPrintError(bill, e.message);
    }
  }

  function showPrintError(bill, msg) {
    state.sheetBill = bill;
    openSheet(`
      <h3>Chưa in được</h3>
      <p>Bill ${billNo(bill.no)} (${money(bill.total)}) <b>đã được lưu</b>, nhưng máy in chưa nhận lệnh.</p>
      <p class="err">${esc(msg)}</p>
      <p class="hint">Kiểm tra: máy in đã bật và có giấy, dây USB/mạng đã cắm, máy tính ở quầy còn bật. Sau đó bấm Thử in lại.</p>
      <div class="row"><button class="btn ghost" data-action="close-sheet">Đóng</button><button class="btn primary" data-action="retry-print">Thử in lại</button></div>`);
  }

  /* ---------------------------------------------------------------- */
  /* Vẽ bill thành ảnh & in                                            */
  /* ---------------------------------------------------------------- */
  const FONT = '"Helvetica Neue", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif';

  function renderBill(bill, st) {
    const W = Number(st.printer.paperDots) || 576;
    const M = 10;
    const probe = document.createElement('canvas');
    probe.width = W; probe.height = 4000;
    const g = probe.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, W, 4000);
    g.fillStyle = '#000'; g.textBaseline = 'top';
    let y = 10;
    const font = (px, bold) => `${bold ? 'bold ' : ''}${px}px ${FONT}`;

    function wrap(text, maxW, f) {
      g.font = f;
      const lines = [];
      let line = '';
      for (const w of String(text).split(/\s+/).filter(Boolean)) {
        const t = line ? line + ' ' + w : w;
        if (g.measureText(t).width <= maxW) { line = t; continue; }
        if (line) lines.push(line);
        if (g.measureText(w).width > maxW) {
          let part = '';
          for (const ch of w) {
            if (g.measureText(part + ch).width > maxW) { lines.push(part); part = ch; } else part += ch;
          }
          line = part;
        } else line = w;
      }
      if (line) lines.push(line);
      return lines.length ? lines : [''];
    }
    function center(text, px, bold, gap) {
      if (!text) return;
      const f = font(px, bold);
      for (const l of wrap(text, W - 2 * M, f)) {
        g.font = f; g.textAlign = 'center'; g.fillText(l, W / 2, y);
        y += Math.round(px * 1.28);
      }
      y += gap || 0;
    }
    function dashed() {
      y += 4;
      for (let x = M; x < W - M; x += 14) g.fillRect(x, y, 8, 2);
      y += 14;
    }
    function solid() { y += 4; g.fillRect(M, y, W - 2 * M, 3); y += 14; }
    function leftRight(left, right, px, bold) {
      g.font = font(px, bold);
      g.textAlign = 'left'; g.fillText(left, M, y);
      g.textAlign = 'right'; g.fillText(right, W - M, y);
      y += Math.round(px * 1.3);
    }

    center(st.shopName, 36, true, 4);
    center(st.address, 22, false, 0);
    if (st.phone) center('ĐT: ' + st.phone, 22, false, 0);
    y += 6; dashed();
    center('HOÁ ĐƠN', 30, true, 6);
    const [yy, mm, dd] = bill.day.split('-');
    leftRight(billNo(bill.no), `${dd}/${mm}/${yy}  ${bill.time}`, 22, false);
    if (bill.note) {
      for (const l of wrap('Khách: ' + bill.note, W - 2 * M, font(22, false))) {
        g.font = font(22, false); g.textAlign = 'left'; g.fillText(l, M, y); y += 29;
      }
    }
    dashed();

    for (const it of bill.items) {
      const amt = fmt(it.price * it.qty);
      g.font = font(26, true);
      const aw = g.measureText(amt).width;
      const lines = wrap(it.name, W - 2 * M - aw - 16, font(26, true));
      lines.forEach((l, i) => {
        g.font = font(26, true); g.textAlign = 'left'; g.fillText(l, M, y);
        if (i === 0) { g.textAlign = 'right'; g.fillText(amt, W - M, y); }
        y += 33;
      });
      if (it.qty > 1) {
        g.font = font(22, false); g.textAlign = 'left';
        g.fillText(`${it.qty} x ${fmt(it.price)}`, M + 10, y);
        y += 28;
      }
      y += 6;
    }

    solid();
    g.textBaseline = 'alphabetic';
    g.font = font(28, true); g.textAlign = 'left'; g.fillText('TỔNG CỘNG', M, y + 40);
    g.font = font(42, true); g.textAlign = 'right'; g.fillText(money(bill.total), W - M, y + 42);
    g.textBaseline = 'top';
    y += 62;
    solid();
    y += 4;
    center(st.footer, 24, false, 0);
    y += 24;

    const out = document.createElement('canvas');
    out.width = W; out.height = Math.ceil(y);
    const og = out.getContext('2d');
    og.fillStyle = '#fff'; og.fillRect(0, 0, W, out.height);
    og.drawImage(probe, 0, 0);
    return out;
  }

  function canvasToRaster(c) {
    const w = c.width, h = c.height;
    const px = c.getContext('2d').getImageData(0, 0, w, h).data;
    const wb = w / 8;
    const out = new Uint8Array(wb * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const lum = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
        if (lum < 150) out[y * wb + (x >> 3)] |= 0x80 >> (x & 7);
      }
    }
    let bin = '';
    for (let i = 0; i < out.length; i += 0x8000) bin += String.fromCharCode.apply(null, out.subarray(i, i + 0x8000));
    return { width: w, height: h, data: btoa(bin) };
  }

  async function printBill(bill) {
    const canvas = renderBill(bill, state.settings);
    await api('/api/print', { method: 'POST', body: canvasToRaster(canvas) });
  }

  function previewBill(bill) {
    state.sheetBill = bill;
    const el = openSheet(`
      <h3>Bill ${billNo(bill.no)}</h3>
      <div class="paper"></div>
      <div class="row"><button class="btn ghost" data-action="close-sheet">Đóng</button><button class="btn primary" data-action="print-sheet">In bill</button></div>`);
    $('.paper', el).appendChild(renderBill(bill, state.settings));
  }

  function sampleBill() {
    const now = new Date();
    const items = [
      { name: 'In thử: Đắp bột, Cắt da, Sơn', price: 100000, qty: 1 },
      { name: 'Tiếng Việt có dấu ăâêôơư', price: 50000, qty: 2 },
    ];
    return {
      no: 0, day: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
      time: `${pad(now.getHours())}:${pad(now.getMinutes())}`,
      items, total: items.reduce((s, i) => s + i.price * i.qty, 0), note: 'Khách thử',
    };
  }

  /* ---------------------------------------------------------------- */
  /* Lịch sử                                                           */
  /* ---------------------------------------------------------------- */
  function monthNav() {
    return `<div class="month-nav">
      <button data-action="month-prev" aria-label="Tháng trước">‹</button>
      <strong>${monthLabel(state.month)}</strong>
      <button data-action="month-next" aria-label="Tháng sau" ${state.month >= monthOf(new Date()) ? 'disabled' : ''}>›</button>
    </div>`;
  }

  async function viewHistory() {
    $('#view').innerHTML = `<h1>Lịch sử</h1>${monthNav()}<div id="histBody" class="empty">Đang tải…</div>`;
    try {
      const { bills } = await api('/api/bills?month=' + state.month);
      if (state.tab !== 'history') return;
      state.bills = bills;
      paintHistory();
    } catch (e) {
      if (state.tab === 'history') $('#histBody').innerHTML = `<p class="err">${esc(e.message)}</p>`;
    }
  }

  function paintHistory() {
    const body = $('#histBody');
    if (!body) return;
    if (!state.bills.length) { body.className = 'empty'; body.textContent = 'Chưa có bill nào trong tháng này.'; return; }
    body.className = '';
    const days = new Map();
    for (const b of state.bills) { if (!days.has(b.day)) days.set(b.day, []); days.get(b.day).push(b); }
    body.innerHTML = Array.from(days.entries()).map(([day, list]) => {
      const sum = list.reduce((s, b) => s + b.total, 0);
      return `<div class="day-head"><span>${dayLabel(day)}</span><span>${list.length} khách · ${money(sum)}</span></div>` + list.map((b) => {
        const open = state.openBill === b.id;
        const summary = b.items.map((i) => esc(i.name) + (i.qty > 1 ? ' ×' + i.qty : '')).join(', ');
        return `<div class="bill">
          <div class="bill-top" data-action="toggle-bill" data-id="${esc(b.id)}">
            <div><b>${billNo(b.no)}</b> <span class="muted">${esc(b.time)}${b.note ? ' · ' + esc(b.note) : ''}</span><div class="bill-items">${summary}</div></div>
            <div class="bill-total">${money(b.total)}</div>
          </div>
          ${open ? `<div class="bill-detail">
            ${b.items.map((i) => `<div class="bill-line"><span>${esc(i.name)}${i.qty > 1 ? ` (${i.qty} × ${fmt(i.price)})` : ''}</span><span>${money(i.price * i.qty)}</span></div>`).join('')}
            <div class="row"><button class="btn" data-action="view-bill" data-id="${esc(b.id)}">Xem / In lại</button><button class="btn danger" data-action="del-bill" data-id="${esc(b.id)}">Xoá bill</button></div>
          </div>` : ''}
        </div>`;
      }).join('');
    }).join('');
  }

  /* ---------------------------------------------------------------- */
  /* Thống kê                                                          */
  /* ---------------------------------------------------------------- */
  async function viewStats() {
    $('#view').innerHTML = `<h1>Thống kê</h1>${monthNav()}<div id="statBody" class="empty">Đang tải…</div>`;
    try {
      const [stats, { bills }] = await Promise.all([api('/api/stats?month=' + state.month), api('/api/bills?month=' + state.month)]);
      if (state.tab !== 'stats') return;
      state.bills = bills;
      paintStats(stats);
    } catch (e) {
      if (state.tab === 'stats') $('#statBody').innerHTML = `<p class="err">${esc(e.message)}</p>`;
    }
  }

  function paintStats(s) {
    const body = $('#statBody');
    if (!body) return;
    if (!s.customers) { body.className = 'empty'; body.textContent = 'Chưa có số liệu trong tháng này.'; return; }
    body.className = '';
    const maxDay = Math.max(...s.days.map((d) => d.revenue));
    body.innerHTML = `
      <div class="cards">
        <div class="card"><div class="k">Số khách</div><div class="v">${s.customers}</div></div>
        <div class="card"><div class="k">Trung bình / khách</div><div class="v">${money(s.average)}</div></div>
        <div class="card wide"><div class="k">Doanh thu ${monthLabel(s.month).toLowerCase()}</div><div class="v">${money(s.revenue)}</div></div>
      </div>
      <h2>Theo dịch vụ</h2>
      <div class="list">${s.services.map((x) => `<div class="list-row"><div><b>${esc(x.name)}</b><small>${x.count} lượt</small></div><div><b>${money(x.revenue)}</b></div></div>`).join('')}</div>
      <h2>Theo ngày</h2>
      <div class="list">${s.days.slice().reverse().map((d) => `<div class="bar-row"><div class="fill" style="width:${Math.max(4, Math.round(d.revenue / maxDay * 100))}%"></div><div class="txt"><span>${dayLabel(d.day)} · ${d.customers} khách</span><b>${money(d.revenue)}</b></div></div>`).join('')}</div>
      <button class="btn wide" data-action="csv">Tải bảng Excel (CSV) của tháng này</button>`;
  }

  function downloadCsv() {
    const q = (v) => '"' + String(v).replace(/"/g, '""') + '"';
    const rows = [['Số bill', 'Ngày', 'Giờ', 'Khách / ghi chú', 'Dịch vụ', 'Số lượng', 'Đơn giá', 'Thành tiền', 'Tổng bill']];
    for (const b of state.bills.slice().reverse()) {
      b.items.forEach((i, idx) => rows.push([b.no, b.day, b.time, b.note, i.name, i.qty, i.price, i.price * i.qty, idx === 0 ? b.total : '']));
    }
    const csv = '﻿' + rows.map((r) => r.map(q).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url; a.download = `tiem-bill-${state.month}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  /* ---------------------------------------------------------------- */
  /* Cài đặt                                                           */
  /* ---------------------------------------------------------------- */
  function viewSettings() {
    const s = state.settings, p = s.printer;
    const urls = (state.info.ips || []).map((ip) => `<span class="url">http://${esc(ip)}:${state.info.port}</span>`).join('') || '<p class="hint">Chưa thấy địa chỉ mạng.</p>';
    $('#view').innerHTML = `
      <h1>Cài đặt</h1>

      <h2>Dịch vụ &amp; giá</h2>
      <div id="svcEditor"></div>
      <button class="btn wide" data-action="svc-add">＋ Thêm dịch vụ</button>
      <p class="hint">Gõ giá kiểu 50 hoặc 50000 đều được (= 50.000đ). Sửa xong tự lưu. Xoá dịch vụ không ảnh hưởng bill cũ.</p>

      <form id="settingsForm" autocomplete="off" onsubmit="return false">
        <h2>Thông tin in trên bill</h2>
        <div class="section">
          <label class="field">Tên tiệm<input class="input" name="shopName" maxlength="60" value="${esc(s.shopName)}"></label>
          <label class="field">Địa chỉ<input class="input" name="address" maxlength="120" value="${esc(s.address)}"></label>
          <label class="field">Số điện thoại<input class="input" name="phone" maxlength="40" inputmode="tel" value="${esc(s.phone)}"></label>
          <label class="field">Lời cuối bill<input class="input" name="footer" maxlength="160" value="${esc(s.footer)}"></label>
        </div>

        <h2>Máy in</h2>
        <div class="section">
          <label class="field">Cách kết nối máy in với máy tính ở quầy
            <select class="input" name="mode">
              <option value="windows" ${p.mode === 'windows' ? 'selected' : ''}>Cắm USB vào máy tính Windows</option>
              <option value="lan" ${p.mode === 'lan' ? 'selected' : ''}>Cắm dây mạng (LAN), nhập địa chỉ IP</option>
              <option value="cups" ${p.mode === 'cups' ? 'selected' : ''}>Máy Mac / Linux (CUPS)</option>
            </select>
          </label>
          <div id="grpName" ${p.mode === 'lan' ? 'hidden' : ''}>
            <label class="field">Tên máy in (đúng như trong danh sách máy in của máy tính)
              <input class="input" name="pname" list="printerList" value="${esc(p.name)}" placeholder="VD: Zy-Q822">
            </label>
            <datalist id="printerList">${state.printers.map((n) => `<option value="${esc(n)}">`).join('')}</datalist>
            <button type="button" class="btn wide" data-action="find-printers">Tìm máy in trên máy tính này</button>
          </div>
          <div id="grpIp" ${p.mode === 'lan' ? '' : 'hidden'}>
            <div class="row">
              <label class="field" style="flex:2">Địa chỉ IP máy in<input class="input" name="ip" inputmode="decimal" value="${esc(p.ip)}" placeholder="192.168.1.50"></label>
              <label class="field">Cổng<input class="input" name="port" inputmode="numeric" value="${esc(p.port)}"></label>
            </div>
          </div>
          <label class="field">Khổ giấy
            <select class="input" name="paperDots">
              <option value="576" ${+p.paperDots === 576 ? 'selected' : ''}>80mm (khuyên dùng cho Zy-Q822)</option>
              <option value="512" ${+p.paperDots === 512 ? 'selected' : ''}>80mm, lề rộng hơn (nếu bị mất chữ hai bên)</option>
              <option value="384" ${+p.paperDots === 384 ? 'selected' : ''}>58mm</option>
              <option value="640" ${+p.paperDots === 640 ? 'selected' : ''}>80mm, in tràn (640)</option>
            </select>
          </label>
          <div class="row">
            <label class="field">Đẩy giấy sau bill (dòng)<input class="input" name="feed" inputmode="numeric" value="${esc(p.feed)}"></label>
          </div>
          <label class="check"><input type="checkbox" name="cut" ${p.cut !== false ? 'checked' : ''}> Tự cắt giấy sau mỗi bill</label>
          <button type="button" class="btn primary wide" data-action="test-print">In thử một bill</button>
        </div>
      </form>

      <h2>Mở app trên iPhone</h2>
      <div class="section">
        <p class="hint">Trong Safari trên iPhone (cùng WiFi với máy ở quầy), mở một trong các địa chỉ này, rồi bấm Chia sẻ → Thêm vào Màn hình chính:</p>
        ${urls}
      </div>

      <h2>Sao lưu dữ liệu</h2>
      <div class="section">
        <p class="hint">Dữ liệu nằm ở máy tính ở quầy (thư mục <b>data</b>), tự sao lưu mỗi ngày vào <b>data/backup</b>. Bạn cũng có thể tải một bản về điện thoại.</p>
        <div class="row">
          <a class="btn" href="/api/backup" download>Tải file sao lưu</a>
          <label class="btn" style="text-align:center">Khôi phục từ file<input type="file" id="restoreFile" accept=".json,application/json" hidden></label>
        </div>
      </div>`;
    paintServicesEditor();
  }

  function paintServicesEditor() {
    const box = $('#svcEditor');
    if (!box) return;
    box.innerHTML = state.services.map((s, i) => `
      <div class="srow" data-i="${i}">
        <input class="input" data-svc="name" value="${esc(s.name)}" placeholder="Tên dịch vụ" maxlength="80">
        <input class="input" data-svc="price" inputmode="numeric" value="${s.price ? fmt(s.price) : ''}" placeholder="Giá">
        <div class="srow-btns">
          <button type="button" data-action="svc-up" data-i="${i}" aria-label="Lên" ${i === 0 ? 'disabled' : ''}>▲</button>
          <button type="button" data-action="svc-down" data-i="${i}" aria-label="Xuống" ${i === state.services.length - 1 ? 'disabled' : ''}>▼</button>
          <button type="button" class="danger" data-action="svc-del" data-i="${i}" aria-label="Xoá">✕ Xoá</button>
        </div>
      </div>`).join('') || '<div class="empty">Chưa có dịch vụ. Bấm “Thêm dịch vụ”.</div>';
  }

  let saveSvcTimer;
  async function saveServices() {
    clearTimeout(saveSvcTimer);
    const list = state.services.filter((s) => s.name.trim());
    try {
      await api('/api/services', { method: 'PUT', body: { services: list } });
      toast('Đã lưu dịch vụ');
    } catch (e) { toast(e.message, true); }
  }

  function gatherSettings() {
    const f = $('#settingsForm').elements;
    return {
      shopName: f.shopName.value, address: f.address.value, phone: f.phone.value, footer: f.footer.value,
      printer: {
        mode: f.mode.value, name: f.pname.value.trim(), ip: f.ip.value.trim(), port: parseInt(f.port.value, 10) || 9100,
        paperDots: parseInt(f.paperDots.value, 10) || 576, feed: parseInt(f.feed.value, 10) || 0, cut: f.cut.checked,
      },
    };
  }

  async function saveSettings() {
    try {
      const { settings } = await api('/api/settings', { method: 'PUT', body: gatherSettings() });
      state.settings = settings;
      toast('Đã lưu cài đặt');
    } catch (e) { toast(e.message, true); }
  }

  /* ---------------------------------------------------------------- */
  /* Điều hướng & sự kiện                                              */
  /* ---------------------------------------------------------------- */
  function go(tab) {
    state.tab = tab;
    $$('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
    const bar = tab === 'sell';
    $('#sellBar').hidden = !bar;
    document.body.classList.toggle('has-bar', bar);
    window.scrollTo(0, 0);
    ({ sell: viewSell, history: viewHistory, stats: viewStats, settings: viewSettings })[tab]();
  }

  document.addEventListener('click', async (ev) => {
    const tabBtn = ev.target.closest('[data-tab]');
    if (tabBtn) return go(tabBtn.dataset.tab);

    const el = ev.target.closest('[data-action]');
    if (!el) return;
    const act = el.dataset.action;
    const id = el.dataset.id;
    const i = Number(el.dataset.i);

    switch (act) {
      case 'toggle': state.cart.has(id) ? state.cart.delete(id) : state.cart.set(id, 1); return paintSell();
      case 'inc': state.cart.set(id, Math.min(99, (state.cart.get(id) || 0) + 1)); return paintSell();
      case 'dec': { const q = (state.cart.get(id) || 1) - 1; q > 0 ? state.cart.set(id, q) : state.cart.delete(id); return paintSell(); }
      case 'extra-inc': state.extras[i].qty = Math.min(99, state.extras[i].qty + 1); return paintSell();
      case 'extra-dec': state.extras[i].qty -= 1; if (state.extras[i].qty < 1) state.extras.splice(i, 1); return paintSell();
      case 'clear-cart': clearCart(); return viewSell();
      case 'add-extra': state.note = ($('#note') || {}).value || ''; return openExtraSheet();
      case 'extra-ok': {
        const name = $('#exName').value.trim();
        const price = parseMoney($('#exPrice').value);
        if (!name) return toast('Nhập tên khoản', true);
        if (!price) return toast('Nhập giá', true);
        state.extras.push({ name, price, qty: 1 });
        closeSheet(); return paintSell();
      }
      case 'close-sheet': return closeSheet();
      case 'checkout-save': state.note = ($('#note') || {}).value || ''; return checkout(false);
      case 'checkout-print': state.note = ($('#note') || {}).value || ''; return checkout(true);
      case 'retry-print':
      case 'print-sheet': {
        const bill = state.sheetBill;
        if (!bill) return;
        el.disabled = true; const old = el.textContent; el.textContent = 'Đang in…';
        try { await printBill(bill); closeSheet(); toast('Đã in bill'); }
        catch (e) { el.disabled = false; el.textContent = old; toast(e.message, true); }
        return;
      }
      case 'month-prev': state.month = shiftMonth(state.month, -1); state.openBill = null; return go(state.tab);
      case 'month-next': if (state.month < monthOf(new Date())) { state.month = shiftMonth(state.month, 1); state.openBill = null; go(state.tab); } return;
      case 'toggle-bill': state.openBill = state.openBill === id ? null : id; return paintHistory();
      case 'view-bill': { const b = state.bills.find((x) => x.id === id); if (b) previewBill(b); return; }
      case 'del-bill': {
        const b = state.bills.find((x) => x.id === id);
        if (!b || !confirm(`Xoá bill ${billNo(b.no)} (${money(b.total)})? Doanh thu sẽ giảm tương ứng.`)) return;
        try { await api('/api/bills/' + encodeURIComponent(id), { method: 'DELETE' }); toast('Đã xoá bill'); state.openBill = null; go('history'); }
        catch (e) { toast(e.message, true); }
        return;
      }
      case 'csv': return downloadCsv();
      case 'svc-add': {
        state.services.push({ id: 's' + Date.now().toString(36), name: '', price: 0 });
        paintServicesEditor();
        const inputs = $$('#svcEditor [data-svc="name"]');
        inputs[inputs.length - 1].focus();
        return;
      }
      case 'svc-up': case 'svc-down': {
        const j = act === 'svc-up' ? i - 1 : i + 1;
        if (j < 0 || j >= state.services.length) return;
        [state.services[i], state.services[j]] = [state.services[j], state.services[i]];
        paintServicesEditor(); return saveServices();
      }
      case 'svc-del': {
        const s = state.services[i];
        if (!s) return;
        if (s.name.trim() && !confirm(`Xoá dịch vụ "${s.name}"?`)) return;
        state.cart.delete(s.id);
        state.services.splice(i, 1);
        paintServicesEditor(); return saveServices();
      }
      case 'find-printers': {
        el.disabled = true;
        try {
          const { printers } = await api('/api/printers');
          state.printers = printers;
          $('#printerList').innerHTML = printers.map((n) => `<option value="${esc(n)}">`).join('');
          toast(printers.length ? `Tìm thấy ${printers.length} máy in, bấm vào ô tên để chọn` : 'Không tìm thấy máy in nào', !printers.length);
        } catch (e) { toast(e.message, true); }
        el.disabled = false; return;
      }
      case 'test-print': {
        await saveSettings();
        el.disabled = true; el.textContent = 'Đang in…';
        try { await printBill(sampleBill()); toast('Đã gửi lệnh in thử'); }
        catch (e) { toast(e.message, true); }
        el.disabled = false; el.textContent = 'In thử một bill'; return;
      }
    }
  });

  document.addEventListener('keydown', (ev) => {
    if ((ev.key === 'Enter' || ev.key === ' ') && ev.target.matches && ev.target.matches('.svc[data-action="toggle"]')) { ev.preventDefault(); ev.target.click(); }
    if (ev.key === 'Enter' && ev.target.matches && ev.target.matches('#exName, #exPrice')) { ev.preventDefault(); const ok = $('[data-action="extra-ok"]'); if (ok) ok.click(); }
  });

  document.addEventListener('input', (ev) => {
    if (ev.target.id === 'note') state.note = ev.target.value;
  });

  document.addEventListener('change', async (ev) => {
    const t = ev.target;
    if (t.dataset && t.dataset.svc) {
      const row = t.closest('.srow');
      const s = state.services[Number(row.dataset.i)];
      if (!s) return;
      if (t.dataset.svc === 'name') s.name = t.value.trim();
      else { s.price = parseMoney(t.value); t.value = s.price ? fmt(s.price) : ''; }
      return saveServices();
    }
    if (t.id === 'restoreFile') {
      const file = t.files && t.files[0];
      if (!file) return;
      try {
        const data = JSON.parse(await file.text());
        if (!confirm(`Khôi phục dữ liệu từ file này? Dữ liệu hiện tại sẽ được thay thế (máy chủ vẫn giữ một bản sao trước khi khôi phục).`)) { t.value = ''; return; }
        const r = await api('/api/restore', { method: 'POST', body: data });
        await loadState();
        toast(`Đã khôi phục ${r.bills} bill`);
        go('settings');
      } catch (e) { toast(e.message || 'File không đọc được', true); }
      t.value = '';
      return;
    }
    if (t.form && t.form.id === 'settingsForm') {
      if (t.name === 'mode') {
        $('#grpName').hidden = t.value === 'lan';
        $('#grpIp').hidden = t.value !== 'lan';
      }
      return saveSettings();
    }
  });

  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState !== 'visible' || !state.settings) return;
    try { await loadState(); if (state.tab === 'sell') paintSell(); } catch (_) { /* bỏ qua */ }
  });

  /* ---------------------------------------------------------------- */
  /* Khởi động                                                         */
  /* ---------------------------------------------------------------- */
  async function boot() {
    try {
      await loadState();
      go('sell');
    } catch (e) {
      $('#view').innerHTML = `<h1>Không kết nối được</h1><p class="err">${esc(e.message)}</p><button class="btn primary wide" onclick="location.reload()">Thử lại</button>`;
    }
  }
  boot();
})();
