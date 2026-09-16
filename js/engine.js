/*
 * 在庫計算エンジン
 *  - 食事ルールから「食べる予定(occasion)」を生成
 *  - 配送・食事・臨時の食事・在庫補正から在庫推移を計算
 *
 * ルール（設定でON/OFF可）
 *   ①毎週 火・木 17:00 に1食／土 12:00 に1食
 *   ②8月の水曜・第5水曜・水曜が祝日 の場合 12:00 に1食
 */
(function (global) {
  'use strict';

  const U = global.U;
  const HolidayJP = global.HolidayJP;

  /** 曜日ルール定義（設定キー・曜日・時刻） */
  const WEEKLY_RULES = [
    { key: 'tue', dow: 2, time: '17:00', label: '火曜' },
    { key: 'thu', dow: 4, time: '17:00', label: '木曜' },
    { key: 'sat', dow: 6, time: '12:00', label: '土曜' }
  ];

  /**
   * 指定日に食べる予定を返す（同じ日に複数の理由が重なっても1食にまとめる）
   * @returns {Array<{id,date,time,reasons:string[],holiday:string|null,defaultCount:number}>}
   */
  function occasionsOfDay(date, rules) {
    const r = rules || {};
    const dateStr = U.ymd(date);
    const dow = date.getDay();
    const out = [];

    WEEKLY_RULES.forEach(function (rule) {
      if (dow !== rule.dow) return;
      if (r[rule.key] === false) return;
      out.push({
        id: dateStr + '_' + rule.time,
        date: dateStr,
        time: rule.time,
        reasons: [rule.label],
        holiday: HolidayJP.name(dateStr),
        defaultCount: 1
      });
    });

    if (dow === 3) {
      const reasons = [];
      const holiday = HolidayJP.name(dateStr);
      if (r.augWed !== false && date.getMonth() + 1 === 8) reasons.push('8月の水曜');
      if (r.fifthWed !== false && U.nthWeekdayOfMonth(date) === 5) reasons.push('第5水曜');
      if (r.holidayWed !== false && holiday) reasons.push('水曜の祝日（' + holiday + '）');
      if (reasons.length) {
        out.push({
          id: dateStr + '_12:00',
          date: dateStr,
          time: '12:00',
          reasons: reasons,
          holiday: holiday,
          defaultCount: 1
        });
      }
    }

    out.sort((a, b) => (a.time < b.time ? -1 : 1));
    return out;
  }

  /** 期間内（両端含む）の予定を生成 */
  function occasionsBetween(fromDate, toDate, rules) {
    const out = [];
    let d = new Date(fromDate.getFullYear(), fromDate.getMonth(), fromDate.getDate());
    const end = new Date(toDate.getFullYear(), toDate.getMonth(), toDate.getDate());
    let guard = 0;
    while (d <= end && guard++ < 4000) {
      occasionsOfDay(d, rules).forEach((o) => out.push(o));
      d = U.addDays(d, 1);
    }
    return out;
  }

  /** 予定の実食数（上書きがあればそれを使う） */
  function countOf(occasion, data) {
    const ov = data.overrides && data.overrides[occasion.id];
    if (ov && typeof ov.count === 'number') return ov.count;
    return occasion.defaultCount;
  }

  function noteOf(occasion, data) {
    const ov = data.overrides && data.overrides[occasion.id];
    return (ov && ov.note) || '';
  }

  function isEdited(occasion, data) {
    const ov = data.overrides && data.overrides[occasion.id];
    if (!ov) return false;
    return (typeof ov.count === 'number' && ov.count !== occasion.defaultCount) || !!ov.note;
  }

  /**
   * 日ごとの在庫推移を計算する。
   * @param {object} data アプリデータ
   * @param {string} untilDateStr 計算終了日（"YYYY-MM-DD"）
   * @returns {{days:Array, byDate:object, startDate:string, startStock:number}}
   *   days: [{date, deliveries[], deliveryQty, occasions[], mealCount, extras[], extraCount,
   *           adjustments[], adjustQty, startStock, endStock, isPast}]
   */
  function buildTimeline(data, untilDateStr) {
    const settings = data.settings || {};
    const startDate = U.parseYmd(settings.startDate) || U.today();
    const startStock = Number(settings.startStock) || 0;

    // 終了日は「指定日」「最後の配送日+7日」「今日+60日」の最大
    let end = U.parseYmd(untilDateStr) || U.addDays(U.today(), 60);
    (data.deliveries || []).forEach(function (d) {
      const dd = U.parseYmd(d.date);
      if (dd && U.addDays(dd, 7) > end) end = U.addDays(dd, 7);
    });
    (data.extras || []).forEach(function (e) {
      const dd = U.parseYmd(e.date);
      if (dd && dd > end) end = dd;
    });
    (data.adjustments || []).forEach(function (a) {
      const dd = U.parseYmd(a.date);
      if (dd && dd > end) end = dd;
    });
    if (end < startDate) end = startDate;

    // 日付ごとにイベントを索引化（基準日より前は無視＝棚卸しの基準になる）
    const deliveriesBy = {};
    (data.deliveries || []).forEach(function (d) {
      if (!d.date || d.date < settings.startDate) return;
      (deliveriesBy[d.date] = deliveriesBy[d.date] || []).push(d);
    });
    const extrasBy = {};
    (data.extras || []).forEach(function (e) {
      if (!e.date || e.date < settings.startDate) return;
      (extrasBy[e.date] = extrasBy[e.date] || []).push(e);
    });
    const adjustBy = {};
    (data.adjustments || []).forEach(function (a) {
      if (!a.date || a.date < settings.startDate) return;
      (adjustBy[a.date] = adjustBy[a.date] || []).push(a);
    });

    const now = new Date();
    const days = [];
    const byDate = {};
    let stock = startStock;
    let d = new Date(startDate.getTime());
    let guard = 0;

    while (d <= end && guard++ < 4000) {
      const dateStr = U.ymd(d);
      const dels = deliveriesBy[dateStr] || [];
      const deliveryQty = dels.reduce((s, x) => s + (Number(x.qty) || 0), 0);

      const occs = occasionsOfDay(d, settings.rules).map(function (o) {
        return Object.assign({}, o, {
          count: countOf(o, data),
          note: noteOf(o, data),
          edited: isEdited(o, data),
          past: U.parseDateTime(o.date, o.time) <= now
        });
      });
      const mealCount = occs.reduce((s, o) => s + o.count, 0);

      const exs = extrasBy[dateStr] || [];
      const extraCount = exs.reduce((s, x) => s + (Number(x.count) || 0), 0);

      const adjs = adjustBy[dateStr] || [];
      const adjustQty = adjs.reduce((s, x) => s + (Number(x.delta) || 0), 0);

      const entry = {
        date: dateStr,
        dow: d.getDay(),
        holiday: HolidayJP.name(dateStr),
        deliveries: dels,
        deliveryQty: deliveryQty,
        occasions: occs,
        mealCount: mealCount,
        extras: exs,
        extraCount: extraCount,
        adjustments: adjs,
        adjustQty: adjustQty,
        startStock: stock,
        endStock: stock + deliveryQty - mealCount - extraCount + adjustQty,
        isPast: U.diffDays(U.today(), d) < 0,
        isToday: U.diffDays(U.today(), d) === 0
      };
      stock = entry.endStock;
      days.push(entry);
      byDate[dateStr] = entry;
      d = U.addDays(d, 1);
    }

    return { days: days, byDate: byDate, startDate: settings.startDate, startStock: startStock };
  }

  /**
   * 現時点（now）の在庫。過ぎた時刻の食事は消費済みとして数える。
   */
  function currentStock(data, timeline) {
    const settings = data.settings || {};
    const startDate = U.parseYmd(settings.startDate);
    const now = new Date();
    if (!startDate || U.diffDays(startDate, now) < 0) return Number(settings.startStock) || 0;

    let stock = Number(settings.startStock) || 0;
    const todayStr = U.ymd(now);

    timeline.days.forEach(function (day) {
      if (day.date > todayStr) return;
      if (day.date < todayStr) {
        stock = day.endStock;
        return;
      }
      // 今日ぶんは時刻を見て加減する（配送・補正・臨時は当日ぶんを反映）
      stock += day.deliveryQty + day.adjustQty - day.extraCount;
      day.occasions.forEach(function (o) {
        if (U.parseDateTime(o.date, o.time) <= now) stock -= o.count;
      });
    });
    return stock;
  }

  /** 在庫が0になる（マイナスになる）最初の日 */
  function findRunOutDate(timeline) {
    for (let i = 0; i < timeline.days.length; i++) {
      const day = timeline.days[i];
      if (day.endStock <= 0 && !day.isPast) return day;
    }
    return null;
  }

  /** 次に食べる予定（now以降） */
  function nextOccasion(timeline) {
    const now = new Date();
    for (let i = 0; i < timeline.days.length; i++) {
      const occs = timeline.days[i].occasions;
      for (let j = 0; j < occs.length; j++) {
        if (U.parseDateTime(occs[j].date, occs[j].time) > now) {
          return { day: timeline.days[i], occasion: occs[j] };
        }
      }
    }
    return null;
  }

  /** 次の配送（今日以降） */
  function nextDelivery(data) {
    const todayStr = U.ymd(U.today());
    return (data.deliveries || [])
      .filter((d) => d.date >= todayStr)
      .sort((a, b) => (a.date < b.date ? -1 : 1))[0] || null;
  }

  /** 今日以降の予定のうち、まだ時刻が来ていない/今日中のもの（クイック操作用） */
  function pendingOccasions(timeline, limit) {
    const now = new Date();
    const out = [];
    for (let i = 0; i < timeline.days.length && out.length < (limit || 5); i++) {
      const day = timeline.days[i];
      if (day.isPast) continue;
      day.occasions.forEach(function (o) {
        if (out.length < (limit || 5)) out.push({ day: day, occasion: o, past: U.parseDateTime(o.date, o.time) <= now });
      });
    }
    return out;
  }

  global.Engine = {
    WEEKLY_RULES: WEEKLY_RULES,
    occasionsOfDay: occasionsOfDay,
    occasionsBetween: occasionsBetween,
    buildTimeline: buildTimeline,
    currentStock: currentStock,
    findRunOutDate: findRunOutDate,
    nextOccasion: nextOccasion,
    nextDelivery: nextDelivery,
    pendingOccasions: pendingOccasions
  };
})(window);
