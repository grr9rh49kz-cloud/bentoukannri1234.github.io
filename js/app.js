/*
 * 画面の組み立てと操作（冷凍弁当 在庫管理）
 */
(function (global) {
  'use strict';

  const U = global.U;
  const h = U.h;
  const el = U.el;
  const Engine = global.Engine;
  const Store = global.Store;
  const HolidayJP = global.HolidayJP;

  let data = Store.defaultData();
  let timeline = null;
  let calMonth = null;      // カレンダー表示中の月（Date：1日）
  let sheetDate = null;     // 編集シートで開いている日付
  let pushTimer = null;
  let toastTimer = null;

  /* ===================== 保存 ===================== */

  function setSaveState(state, label) {
    const btn = el('saveStateBtn');
    btn.classList.toggle('is-dirty', state === 'saving');
    btn.classList.toggle('is-error', state === 'error');
    btn.textContent = label;
  }

  /** 変更を保存して画面を再描画する。すべての操作はここを通す。 */
  function commit(options) {
    const opts = options || {};
    data.updatedAt = new Date().toISOString();
    const ok = Store.saveLocal(data);
    setSaveState(ok ? 'saved' : 'error', ok ? '保存済み' : '保存できません');
    if (opts.skipRender !== true) render();
    scheduleAutoPush();
  }

  /** GitHub自動保存（連続操作をまとめるため少し待ってから実行） */
  function scheduleAutoPush() {
    const sync = data.settings.sync || {};
    if (!sync.auto || !Store.getToken() || !Store.syncConfigured(data)) return;
    if (pushTimer) clearTimeout(pushTimer);
    setSaveState('saving', '同期待ち…');
    pushTimer = setTimeout(function () {
      pushTimer = null;
      doPush(true);
    }, 4000);
  }

  async function doPush(silent) {
    try {
      setSaveState('saving', '同期中…');
      await Store.push(data);
      setSaveState('saved', '同期済み');
      setSyncMessage('GitHubに保存しました（' + new Date().toLocaleString('ja-JP') + '）', 'is-ok');
      if (!silent) toast('GitHubに保存しました');
    } catch (e) {
      setSaveState('error', '同期エラー');
      setSyncMessage(String(e.message || e), 'is-error');
      if (!silent) toast('保存に失敗しました');
    }
  }

  async function doPull(silent) {
    try {
      setSyncMessage('読み込み中…', '');
      const res = await Store.pull(data);
      if (!res.found) {
        setSyncMessage('保存されたデータが見つかりませんでした。', 'is-error');
        if (!silent) toast('データが見つかりません');
        return false;
      }
      const remote = res.data;
      if (!silent) {
        const when = remote.updatedAt ? new Date(remote.updatedAt).toLocaleString('ja-JP') : '不明';
        if (!confirm('GitHubのデータ（更新: ' + when + '）で、この端末のデータを置き換えます。よろしいですか？')) {
          setSyncMessage('読み込みを取り消しました。', '');
          return false;
        }
      }
      // 同期設定とトークンは端末側のものを維持する
      const localSync = data.settings.sync;
      data = remote;
      data.settings.sync = Object.assign({}, remote.settings.sync, localSync);
      Store.saveLocal(data);
      render();
      setSyncMessage('GitHubから読み込みました。', 'is-ok');
      if (!silent) toast('GitHubから読み込みました');
      return true;
    } catch (e) {
      setSyncMessage(String(e.message || e), 'is-error');
      return false;
    }
  }

  function setSyncMessage(text, cls) {
    const node = el('syncMessage');
    node.textContent = text;
    node.className = 'sync-message ' + (cls || '');
  }

  function toast(text) {
    const node = el('toast');
    node.textContent = text;
    node.hidden = false;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { node.hidden = true; }, 2200);
  }

  /* ===================== データ操作 ===================== */

  function setOccasionCount(occasion, count) {
    const n = Math.max(0, Math.min(99, count));
    data.overrides = data.overrides || {};
    const prev = data.overrides[occasion.id] || {};
    if (n === occasion.defaultCount && !prev.note) {
      delete data.overrides[occasion.id];
    } else {
      data.overrides[occasion.id] = Object.assign({}, prev, { count: n, date: occasion.date, time: occasion.time });
    }
    commit();
  }

  function setOccasionNote(occasion, note) {
    data.overrides = data.overrides || {};
    const prev = data.overrides[occasion.id] || {};
    const count = typeof prev.count === 'number' ? prev.count : occasion.defaultCount;
    if (!note && count === occasion.defaultCount) {
      delete data.overrides[occasion.id];
    } else {
      data.overrides[occasion.id] = { count: count, note: note, date: occasion.date, time: occasion.time };
    }
    commit();
  }

  function addExtra(dateStr) {
    const date = prompt('臨時で食べた日（YYYY-MM-DD）', dateStr || U.ymd(U.today()));
    if (!date || !U.parseYmd(date)) return;
    const countStr = prompt('食べた数（食）', '1');
    if (countStr === null) return;
    const count = Math.max(0, parseInt(countStr, 10) || 0);
    if (!count) return;
    const note = prompt('メモ（任意）', '') || '';
    data.extras.push({ id: U.uid('ex'), date: date, time: '12:00', count: count, note: note });
    commit();
    toast(U.formatMd(date) + ' に ' + count + '食 追加しました');
  }

  function addAdjust(dateStr) {
    const date = prompt('在庫を補正する日（YYYY-MM-DD）', dateStr || U.ymd(U.today()));
    if (!date || !U.parseYmd(date)) return;
    const deltaStr = prompt('増減の数（減らす場合は -1 のようにマイナス）', '-1');
    if (deltaStr === null) return;
    const delta = parseInt(deltaStr, 10);
    if (!delta) return;
    const note = prompt('理由（廃棄・人にあげた など）', '') || '';
    data.adjustments.push({ id: U.uid('ad'), date: date, delta: delta, note: note });
    commit();
    toast('在庫を ' + (delta > 0 ? '+' : '') + delta + ' 補正しました');
  }

  function stocktake() {
    const current = Engine.currentStock(data, timeline);
    const configured = data.settings.configured;
    const message = configured
      ? 'いま冷凍庫にある実際の個数を入力してください。\n（計算上の在庫は ' + current + '食 です）'
      : 'いま冷凍庫にある弁当の個数を入力してください。';
    const ans = prompt(message, String(configured ? current : Math.max(0, current)));
    if (ans === null) return;
    const actual = parseInt(ans, 10);
    if (isNaN(actual) || actual < 0) return;
    // 今日を基準日にして数え直す（過去の記録はそのまま残るが計算には使わない）
    data.settings.configured = true;
    data.settings.startDate = U.ymd(U.today());
    data.settings.startStock = actual;
    // 今日ぶんの食事が済んでいる場合、二重に引かれないよう基準在庫へ戻し込む
    const todayEntry = timeline.byDate[U.ymd(U.today())];
    if (todayEntry) {
      const now = new Date();
      let eaten = 0;
      todayEntry.occasions.forEach(function (o) {
        if (U.parseDateTime(o.date, o.time) <= now) eaten += o.count;
      });
      data.settings.startStock = actual + eaten + todayEntry.extraCount - todayEntry.deliveryQty - todayEntry.adjustQty;
    }
    commit();
    toast('基準を ' + U.formatMd(data.settings.startDate) + ' / ' + actual + '食 にしました');
  }

  function removeRecord(kind, id) {
    if (kind === 'extra') data.extras = data.extras.filter((x) => x.id !== id);
    if (kind === 'adjust') data.adjustments = data.adjustments.filter((x) => x.id !== id);
    if (kind === 'delivery') data.deliveries = data.deliveries.filter((x) => x.id !== id);
    commit();
  }

  /* ===================== 描画 ===================== */

  function render() {
    timeline = Engine.buildTimeline(data, U.ymd(U.addDays(U.today(), 400)));
    renderSummary();
    renderQuickList();
    renderRecords();
    renderCalendar();
    renderSchedule();
    renderDeliveries();
    renderSettings();
    if (sheetDate) renderSheet(sheetDate);
  }

  function renderSummary() {
    const stock = Engine.currentStock(data, timeline);
    const threshold = Number(data.settings.lowStockThreshold) || 0;
    const configured = data.settings.configured === true;

    el('setupCard').hidden = configured;
    el('stockNow').textContent = configured ? stock : '—';

    const card = el('stockCard');
    card.classList.toggle('is-low', configured && stock > 0 && stock <= threshold);
    card.classList.toggle('is-empty', configured && stock <= 0);

    if (!configured) {
      el('stockNote').textContent = '在庫の個数がまだ登録されていません';
      const firstNext = Engine.nextOccasion(timeline);
      el('nextMeal').textContent = firstNext
        ? U.formatMd(firstNext.occasion.date) + ' ' + firstNext.occasion.time + '（' + U.relativeLabel(firstNext.occasion.date) + '）'
        : '—';
      const firstDel = Engine.nextDelivery(data);
      el('nextDelivery').textContent = firstDel
        ? U.formatMd(firstDel.date) + ' ' + (firstDel.qty || 0) + '個（' + U.relativeLabel(firstDel.date) + '）'
        : '未登録';
      return;
    }

    const runOut = Engine.findRunOutDate(timeline);
    const notes = [];
    if (stock < 0) {
      notes.push('計算上マイナスです。実数で数え直してください。');
    } else if (runOut) {
      notes.push('このままだと ' + U.formatMd(runOut.date) + '（' + U.relativeLabel(runOut.date) + '）に在庫切れ');
    } else {
      notes.push('計算期間内に在庫切れの予定はありません');
    }
    el('stockNote').textContent = notes.join(' / ');

    const next = Engine.nextOccasion(timeline);
    el('nextMeal').textContent = next
      ? U.formatMd(next.occasion.date) + ' ' + next.occasion.time + '（' + U.relativeLabel(next.occasion.date) + '）'
      : '—';

    const del = Engine.nextDelivery(data);
    el('nextDelivery').textContent = del
      ? U.formatMd(del.date) + ' ' + (del.qty || 0) + '個（' + U.relativeLabel(del.date) + '）'
      : '未登録';
  }

  /** 食数のステッパー */
  function stepper(count, onChange) {
    const label = h('span', {
      class: 'stepper__count' + (count === 0 ? ' is-zero' : count > 1 ? ' is-more' : ''),
      text: count + '食'
    });
    const minus = h('button', { type: 'button', 'aria-label': '減らす', text: '−' }, null);
    minus.disabled = count <= 0;
    minus.addEventListener('click', function (ev) { ev.stopPropagation(); onChange(count - 1); });
    const plus = h('button', { type: 'button', 'aria-label': '増やす', text: '＋' }, null);
    plus.addEventListener('click', function (ev) { ev.stopPropagation(); onChange(count + 1); });
    return h('div', 'stepper', [minus, label, plus]);
  }

  function occasionRow(day, occasion, opts) {
    const options = opts || {};
    const reasons = occasion.reasons.join('・');
    const past = U.parseDateTime(occasion.date, occasion.time) <= new Date();

    const title = h('div', 'row__title', [
      U.formatMd(occasion.date) + ' ' + occasion.time,
      options.hideRelative ? null : h('span', 'tag', U.relativeLabel(occasion.date)),
      occasion.edited ? h('span', 'tag tag--warn', '修正済み') : null
    ]);
    const subParts = [reasons];
    if (occasion.note) subParts.push('メモ: ' + occasion.note);
    const sub = h('div', 'row__sub', subParts.join(' / '));

    const noteBtn = h('button', { class: 'btn btn--sm', type: 'button', text: '✎' });
    noteBtn.addEventListener('click', function (ev) {
      ev.stopPropagation();
      const note = prompt('メモ（食べた状況など）', occasion.note || '');
      if (note === null) return;
      setOccasionNote(occasion, note);
    });

    return h('div', {
      class: 'row' + (past ? ' is-past' : '') + (day.isToday ? ' is-today' : '')
    }, [
      h('div', 'row__main', [title, sub]),
      noteBtn,
      stepper(occasion.count, function (n) { setOccasionCount(occasion, n); })
    ]);
  }

  function renderQuickList() {
    const box = el('quickList');
    box.textContent = '';

    // 過去3日ぶん＋今後の予定を数件（修正しやすいように直近の過去も出す）
    const fromStr = U.ymd(U.addDays(U.today(), -3));
    const rows = [];
    timeline.days.forEach(function (day) {
      if (day.date < fromStr) return;
      day.occasions.forEach(function (o) {
        if (rows.length < 8) rows.push(occasionRow(day, o));
      });
    });

    if (!rows.length) {
      box.appendChild(h('p', 'empty', '食事の予定がありません（設定でルールを確認してください）'));
      return;
    }
    rows.forEach((r) => box.appendChild(r));
  }

  function renderRecords() {
    const box = el('recordList');
    box.textContent = '';

    const items = [];
    (data.extras || []).forEach(function (x) {
      items.push({ date: x.date, kind: 'extra', title: '臨時で食べた ' + x.count + '食', note: x.note, id: x.id });
    });
    (data.adjustments || []).forEach(function (x) {
      items.push({
        date: x.date, kind: 'adjust',
        title: '在庫補正 ' + (x.delta > 0 ? '+' : '') + x.delta + '食',
        note: x.note, id: x.id
      });
    });
    items.sort((a, b) => (a.date < b.date ? 1 : -1));

    if (!items.length) {
      box.appendChild(h('p', 'empty', 'まだ記録はありません'));
      return;
    }

    items.slice(0, 12).forEach(function (item) {
      const del = h('button', { class: 'btn btn--sm', type: 'button', text: '削除' });
      del.addEventListener('click', function () {
        if (confirm('この記録を削除しますか？')) removeRecord(item.kind, item.id);
      });
      box.appendChild(h('div', 'row', [
        h('div', 'row__main', [
          h('div', 'row__title', U.formatMd(item.date) + ' ' + item.title),
          h('div', 'row__sub', item.note || '—')
        ]),
        del
      ]));
    });
  }

  function renderCalendar() {
    if (!calMonth) {
      const t = U.today();
      calMonth = new Date(t.getFullYear(), t.getMonth(), 1);
    }
    el('calTitle').textContent = calMonth.getFullYear() + '年' + (calMonth.getMonth() + 1) + '月';

    const grid = el('calGrid');
    grid.textContent = '';

    const firstDow = calMonth.getDay();
    for (let i = 0; i < firstDow; i++) {
      grid.appendChild(h('div', 'cal-cell cal-cell--blank'));
    }

    const daysInMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() + 1, 0).getDate();
    const threshold = Number(data.settings.lowStockThreshold) || 0;

    for (let dayNum = 1; dayNum <= daysInMonth; dayNum++) {
      const date = new Date(calMonth.getFullYear(), calMonth.getMonth(), dayNum);
      const dateStr = U.ymd(date);
      const entry = timeline.byDate[dateStr];
      const holiday = HolidayJP.name(dateStr);
      const dow = date.getDay();

      const marks = [];
      if (entry && entry.mealCount) marks.push('🍱' + (entry.mealCount > 1 ? '×' + entry.mealCount : ''));
      if (entry && entry.extraCount) marks.push('＋' + entry.extraCount);
      if (entry && entry.deliveryQty) marks.push('📦' + entry.deliveryQty);
      if (entry && entry.adjustQty) marks.push('⚖' + (entry.adjustQty > 0 ? '+' : '') + entry.adjustQty);

      const stockText = entry ? String(entry.endStock) : '–';
      const stockCls = !entry ? '' : entry.endStock <= 0 ? ' is-empty' : entry.endStock <= threshold ? ' is-low' : '';

      const cell = h('button', {
        class: 'cal-cell' +
          (U.diffDays(U.today(), date) === 0 ? ' is-today' : '') +
          (holiday ? ' is-holiday' : '') +
          (entry ? '' : ' is-out'),
        type: 'button',
        title: holiday || ''
      }, [
        h('div', {
          class: 'cal-cell__day' + (dow === 0 ? ' is-sun' : dow === 6 ? ' is-sat' : ''),
          text: String(dayNum)
        }),
        h('div', 'cal-cell__marks', marks.join(' ')),
        h('div', { class: 'cal-cell__stock' + stockCls, text: stockText })
      ]);
      cell.addEventListener('click', function () { openSheet(dateStr); });
      grid.appendChild(cell);
    }
  }

  function renderSchedule() {
    const box = el('scheduleList');
    box.textContent = '';
    const range = Number(el('scheduleRange').value) || 60;
    const onlyEvents = el('scheduleOnlyEvents').checked;
    const todayStr = U.ymd(U.today());
    const endStr = U.ymd(U.addDays(U.today(), range));
    const threshold = Number(data.settings.lowStockThreshold) || 0;

    let shown = 0;
    timeline.days.forEach(function (day) {
      if (day.date < todayStr || day.date > endStr) return;
      const hasEvent = day.mealCount || day.deliveryQty || day.extraCount || day.adjustQty;
      if (onlyEvents && !hasEvent) return;

      const parts = [];
      if (day.deliveryQty) parts.push('📦 配送 +' + day.deliveryQty);
      if (day.mealCount) parts.push('🍱 食事 -' + day.mealCount);
      if (day.extraCount) parts.push('臨時 -' + day.extraCount);
      if (day.adjustQty) parts.push('補正 ' + (day.adjustQty > 0 ? '+' : '') + day.adjustQty);
      if (day.holiday) parts.push('祝日: ' + day.holiday);

      const row = h('div', {
        class: 'row' + (day.isToday ? ' is-today' : '')
      }, [
        h('div', 'row__main', [
          h('div', 'row__title', [
            U.formatMd(day.date),
            day.isToday ? h('span', 'tag', '今日') : null
          ]),
          h('div', 'row__sub', parts.length ? parts.join(' / ') : '予定なし')
        ]),
        h('div', 'row__side', [
          h('div', {
            class: day.endStock <= 0 ? 'tag tag--danger' : day.endStock <= threshold ? 'tag tag--warn' : 'tag',
            text: '残 ' + day.endStock + '食'
          })
        ])
      ]);
      row.addEventListener('click', function () { openSheet(day.date); });
      box.appendChild(row);
      shown++;
    });

    if (!shown) box.appendChild(h('p', 'empty', '表示する日がありません'));
  }

  function renderDeliveries() {
    const box = el('deliveryList');
    box.textContent = '';
    const list = (data.deliveries || []).slice().sort((a, b) => (a.date < b.date ? 1 : -1));
    if (!list.length) {
      box.appendChild(h('p', 'empty', '配送の登録がありません'));
      return;
    }
    const todayStr = U.ymd(U.today());
    list.forEach(function (d) {
      const edit = h('button', { class: 'btn btn--sm', type: 'button', text: '編集' });
      edit.addEventListener('click', function () { startEditDelivery(d); });
      const del = h('button', { class: 'btn btn--sm', type: 'button', text: '削除' });
      del.addEventListener('click', function () {
        if (confirm(U.formatMd(d.date) + ' の配送を削除しますか？')) removeRecord('delivery', d.id);
      });
      box.appendChild(h('div', { class: 'row' + (d.date < todayStr ? ' is-past' : '') }, [
        h('div', 'row__main', [
          h('div', 'row__title', [
            U.formatMd(d.date) + ' ' + (d.qty || 0) + '個',
            h('span', 'tag', d.date >= todayStr ? U.relativeLabel(d.date) : '到着済み')
          ]),
          h('div', 'row__sub', [(d.provider || data.settings.provider || ''), d.note].filter(Boolean).join(' / ') || '—')
        ]),
        edit,
        del
      ]));
    });
  }

  function startEditDelivery(d) {
    el('delId').value = d.id;
    el('delDate').value = d.date;
    el('delQty').value = d.qty;
    el('delProvider').value = d.provider || '';
    el('delNote').value = d.note || '';
    el('delSubmit').textContent = '更新する';
    el('delCancel').hidden = false;
    switchTab('delivery');
    el('delDate').focus();
  }

  function resetDeliveryForm() {
    el('delId').value = '';
    el('delDate').value = U.ymd(U.today());
    el('delQty').value = data.settings.defaultDeliveryQty;
    el('delProvider').value = data.settings.provider || '';
    el('delNote').value = '';
    el('delSubmit').textContent = '登録する';
    el('delCancel').hidden = true;
  }

  function renderSettings() {
    const s = data.settings;
    el('setStartDate').value = s.startDate || '';
    el('setStartStock').value = s.startStock;
    el('setProvider').value = s.provider || '';
    el('setDefaultQty').value = s.defaultDeliveryQty;
    el('setThreshold').value = s.lowStockThreshold;
    el('ruleTue').checked = s.rules.tue !== false;
    el('ruleThu').checked = s.rules.thu !== false;
    el('ruleSat').checked = s.rules.sat !== false;
    el('ruleAugWed').checked = s.rules.augWed !== false;
    el('ruleFifthWed').checked = s.rules.fifthWed !== false;
    el('ruleHolidayWed').checked = s.rules.holidayWed !== false;
    el('syncOwner').value = s.sync.owner || '';
    el('syncRepo').value = s.sync.repo || '';
    el('syncBranch').value = s.sync.branch || 'main';
    el('syncPath').value = s.sync.path || 'data/inventory.json';
    el('syncAuto').checked = s.sync.auto !== false;
    el('syncPathLabel').textContent = s.sync.path || 'data/inventory.json';
    if (document.activeElement !== el('syncToken')) el('syncToken').value = Store.getToken();
  }

  /* ===================== 日別シート ===================== */

  function openSheet(dateStr) {
    sheetDate = dateStr;
    el('daySheet').hidden = false;
    renderSheet(dateStr);
  }

  function closeSheet() {
    sheetDate = null;
    el('daySheet').hidden = true;
  }

  function renderSheet(dateStr) {
    const entry = timeline.byDate[dateStr];
    const holiday = HolidayJP.name(dateStr);
    el('sheetTitle').textContent = U.formatLong(dateStr) + (holiday ? '・' + holiday : '');

    const body = el('sheetBody');
    body.textContent = '';

    if (!entry) {
      body.appendChild(h('p', 'empty', '基準日より前、または計算範囲外の日です。'));
    } else {
      body.appendChild(h('div', 'row', [
        h('div', 'row__main', [
          h('div', 'row__title', 'この日の終わりの在庫：' + entry.endStock + '食'),
          h('div', 'row__sub', '朝の在庫 ' + entry.startStock + '食 ／ 配送 +' + entry.deliveryQty +
            ' ／ 食事 -' + (entry.mealCount + entry.extraCount) +
            (entry.adjustQty ? ' ／ 補正 ' + (entry.adjustQty > 0 ? '+' : '') + entry.adjustQty : ''))
        ])
      ]));

      // 食事予定
      const mealSec = h('div', 'sheet__section', [h('h3', null, '食事の予定（数字で修正できます）')]);
      if (entry.occasions.length) {
        entry.occasions.forEach(function (o) {
          mealSec.appendChild(occasionRow(entry, o, { hideRelative: true }));
        });
      } else {
        mealSec.appendChild(h('p', 'empty', 'この日は食べる予定がありません'));
      }
      body.appendChild(mealSec);

      // 配送
      const delSec = h('div', 'sheet__section', [h('h3', null, '配送')]);
      if (entry.deliveries.length) {
        entry.deliveries.forEach(function (d) {
          const del = h('button', { class: 'btn btn--sm', type: 'button', text: '削除' });
          del.addEventListener('click', function () {
            if (confirm('この配送を削除しますか？')) removeRecord('delivery', d.id);
          });
          delSec.appendChild(h('div', 'row', [
            h('div', 'row__main', [
              h('div', 'row__title', (d.qty || 0) + '個 到着'),
              h('div', 'row__sub', [(d.provider || data.settings.provider), d.note].filter(Boolean).join(' / '))
            ]),
            del
          ]));
        });
      } else {
        const add = h('button', { class: 'btn btn--sm', type: 'button', text: '＋ この日に配送を登録' });
        add.addEventListener('click', function () {
          const qtyStr = prompt('個数', String(data.settings.defaultDeliveryQty || 10));
          if (qtyStr === null) return;
          const qty = Math.max(0, parseInt(qtyStr, 10) || 0);
          data.deliveries.push({
            id: U.uid('dl'), date: dateStr, qty: qty,
            provider: data.settings.provider || '', note: ''
          });
          commit();
          toast(U.formatMd(dateStr) + ' に ' + qty + '個 登録しました');
        });
        delSec.appendChild(add);
      }
      body.appendChild(delSec);

      // 臨時・補正
      const otherSec = h('div', 'sheet__section', [h('h3', null, 'そのほか')]);
      entry.extras.forEach(function (x) {
        const del = h('button', { class: 'btn btn--sm', type: 'button', text: '削除' });
        del.addEventListener('click', function () { removeRecord('extra', x.id); });
        otherSec.appendChild(h('div', 'row', [
          h('div', 'row__main', [
            h('div', 'row__title', '臨時で食べた ' + x.count + '食'),
            h('div', 'row__sub', x.note || '—')
          ]),
          del
        ]));
      });
      entry.adjustments.forEach(function (x) {
        const del = h('button', { class: 'btn btn--sm', type: 'button', text: '削除' });
        del.addEventListener('click', function () { removeRecord('adjust', x.id); });
        otherSec.appendChild(h('div', 'row', [
          h('div', 'row__main', [
            h('div', 'row__title', '在庫補正 ' + (x.delta > 0 ? '+' : '') + x.delta + '食'),
            h('div', 'row__sub', x.note || '—')
          ]),
          del
        ]));
      });
      const btnExtra = h('button', { class: 'btn btn--sm', type: 'button', text: '＋ 臨時で食べた' });
      btnExtra.addEventListener('click', function () { addExtra(dateStr); });
      const btnAdj = h('button', { class: 'btn btn--sm', type: 'button', text: '＋ 在庫を補正' });
      btnAdj.addEventListener('click', function () { addAdjust(dateStr); });
      otherSec.appendChild(h('div', 'btn-row', [btnExtra, btnAdj]));
      body.appendChild(otherSec);
    }
  }

  /* ===================== タブ ===================== */

  function switchTab(name) {
    document.querySelectorAll('.tab-panel').forEach(function (panel) {
      panel.classList.toggle('is-active', panel.id === 'tab-' + name);
    });
    document.querySelectorAll('.tabbar__btn').forEach(function (btn) {
      btn.classList.toggle('is-active', btn.dataset.tab === name);
    });
    window.scrollTo(0, 0);
  }

  /* ===================== バックアップ ===================== */

  function exportJson() {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: 'bento-inventory-' + U.ymd(U.today()) + '.json' });
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    toast('バックアップを書き出しました');
  }

  function importJson(file) {
    const reader = new FileReader();
    reader.onload = function () {
      try {
        const parsed = JSON.parse(String(reader.result));
        if (!parsed || !parsed.settings) throw new Error('形式が違います');
        if (!confirm('読み込んだデータで、この端末のデータを置き換えます。よろしいですか？')) return;
        const localSync = data.settings.sync;
        data = Store.normalize(parsed);
        data.settings.sync = Object.assign({}, data.settings.sync, localSync);
        commit();
        toast('バックアップを読み込みました');
      } catch (e) {
        alert('読み込めませんでした：' + (e.message || e));
      }
    };
    reader.readAsText(file);
  }

  /* ===================== 初期化 ===================== */

  function bindEvents() {
    document.querySelectorAll('.tabbar__btn').forEach(function (btn) {
      btn.addEventListener('click', function () { switchTab(btn.dataset.tab); });
    });

    el('daySheet').addEventListener('click', function (ev) {
      if (ev.target.dataset && ev.target.dataset.close) closeSheet();
    });
    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape' && sheetDate) closeSheet();
    });

    el('btnAddExtra').addEventListener('click', function () { addExtra(null); });
    el('btnAddAdjust').addEventListener('click', function () { addAdjust(null); });
    el('btnStocktake').addEventListener('click', stocktake);
    el('btnSetup').addEventListener('click', stocktake);

    // カレンダー
    el('calPrev').addEventListener('click', function () {
      calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() - 1, 1);
      renderCalendar();
    });
    el('calNext').addEventListener('click', function () {
      calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() + 1, 1);
      renderCalendar();
    });
    el('calToday').addEventListener('click', function () {
      const t = U.today();
      calMonth = new Date(t.getFullYear(), t.getMonth(), 1);
      renderCalendar();
    });

    // 在庫推移
    el('scheduleRange').addEventListener('change', renderSchedule);
    el('scheduleOnlyEvents').addEventListener('change', renderSchedule);

    // 配送フォーム
    el('deliveryForm').addEventListener('submit', function (ev) {
      ev.preventDefault();
      const id = el('delId').value;
      const date = el('delDate').value;
      const qty = Math.max(0, parseInt(el('delQty').value, 10) || 0);
      if (!date) return;
      const record = {
        date: date,
        qty: qty,
        provider: el('delProvider').value.trim() || data.settings.provider || '',
        note: el('delNote').value.trim()
      };
      if (id) {
        data.deliveries = data.deliveries.map((d) => (d.id === id ? Object.assign({}, d, record) : d));
        toast('配送を更新しました');
      } else {
        data.deliveries.push(Object.assign({ id: U.uid('dl') }, record));
        toast(U.formatMd(date) + ' に ' + qty + '個 登録しました');
      }
      commit();
      resetDeliveryForm();
    });
    el('delCancel').addEventListener('click', resetDeliveryForm);

    // 設定
    function bindSetting(id, key, parse) {
      el(id).addEventListener('change', function () {
        data.settings[key] = parse ? parse(el(id).value) : el(id).value;
        commit();
      });
    }
    const toInt = (v) => Math.max(0, parseInt(v, 10) || 0);
    bindSetting('setStartDate', 'startDate');
    bindSetting('setStartStock', 'startStock', toInt);
    ['setStartDate', 'setStartStock'].forEach(function (id) {
      el(id).addEventListener('change', function () {
        if (!data.settings.configured) {
          data.settings.configured = true;
          commit();
        }
      });
    });
    bindSetting('setProvider', 'provider');
    bindSetting('setDefaultQty', 'defaultDeliveryQty', toInt);
    bindSetting('setThreshold', 'lowStockThreshold', toInt);

    [['ruleTue', 'tue'], ['ruleThu', 'thu'], ['ruleSat', 'sat'],
     ['ruleAugWed', 'augWed'], ['ruleFifthWed', 'fifthWed'], ['ruleHolidayWed', 'holidayWed']]
      .forEach(function (pair) {
        el(pair[0]).addEventListener('change', function () {
          data.settings.rules[pair[1]] = el(pair[0]).checked;
          commit();
        });
      });

    // 同期設定
    [['syncOwner', 'owner'], ['syncRepo', 'repo'], ['syncBranch', 'branch'], ['syncPath', 'path']]
      .forEach(function (pair) {
        el(pair[0]).addEventListener('change', function () {
          data.settings.sync[pair[1]] = el(pair[0]).value.trim();
          commit();
        });
      });
    el('syncAuto').addEventListener('change', function () {
      data.settings.sync.auto = el('syncAuto').checked;
      commit();
    });
    el('syncToken').addEventListener('change', function () {
      Store.setToken(el('syncToken').value.trim());
      setSyncMessage(el('syncToken').value.trim() ? 'トークンをこの端末に保存しました。' : 'トークンを削除しました。', 'is-ok');
    });
    el('btnPush').addEventListener('click', function () { doPush(false); });
    el('btnPull').addEventListener('click', function () { doPull(false); });

    // バックアップ
    el('btnExport').addEventListener('click', exportJson);
    el('importFile').addEventListener('change', function (ev) {
      if (ev.target.files && ev.target.files[0]) importJson(ev.target.files[0]);
      ev.target.value = '';
    });

    el('btnReset').addEventListener('click', function () {
      if (!confirm('この端末に保存した在庫データを消して、最初の状態に戻します。よろしいですか？')) return;
      Store.clearLocal();
      data = Store.defaultData();
      const guess = Store.guessSyncTarget();
      if (guess) Object.assign(data.settings.sync, guess);
      commit();
      resetDeliveryForm();
      toast('初期化しました');
    });

    el('saveStateBtn').addEventListener('click', function () {
      if (Store.getToken() && Store.syncConfigured(data)) doPush(false);
      else toast('この端末に自動保存しています');
    });

    // 日付が変わったときに表示を更新する
    setInterval(function () {
      if (!sheetDate) render();
    }, 60000);
  }

  async function init() {
    const local = Store.loadLocal();
    if (local) {
      data = local;
    } else {
      data = Store.defaultData();
      const guess = Store.guessSyncTarget();
      if (guess) Object.assign(data.settings.sync, guess);
    }
    if (!data.settings.sync.owner) {
      const guess = Store.guessSyncTarget();
      if (guess) Object.assign(data.settings.sync, guess);
    }

    bindEvents();
    resetDeliveryForm();
    render();
    setSaveState('saved', '保存済み');

    // 初回（ローカルに何もない）ときだけ、公開されているデータを読み込む
    if (!local) {
      const ok = await doPull(true);
      if (!ok) setSyncMessage('', '');
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})(window);
