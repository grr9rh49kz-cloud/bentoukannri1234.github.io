/*
 * 日本の祝日計算（オフライン・外部API不要）
 *  - 内閣府の祝日規定にもとづく計算式。ハッピーマンデー、春分/秋分、
 *    振替休日、国民の休日に対応（1990年〜2099年が対象。2020/2021の特例も反映）。
 *  - 将来、法改正で祝日が変わった場合はこのファイルを更新すれば全体に反映される。
 */
(function (global) {
  'use strict';

  const pad = (n) => String(n).padStart(2, '0');
  const key = (y, m, d) => y + '-' + pad(m) + '-' + pad(d);
  const keyOf = (date) => key(date.getFullYear(), date.getMonth() + 1, date.getDate());

  /** その月の n 番目の weekday(0=日) の日付（日にち） */
  function nthWeekday(year, month, weekday, nth) {
    const firstDow = new Date(year, month - 1, 1).getDay();
    return 1 + ((weekday - firstDow + 7) % 7) + (nth - 1) * 7;
  }

  /** 春分の日（1980年基準の近似式／1900-2099） */
  function vernalEquinoxDay(y) {
    return Math.floor(20.8431 + 0.242194 * (y - 1980) - Math.floor((y - 1980) / 4));
  }

  /** 秋分の日 */
  function autumnalEquinoxDay(y) {
    return Math.floor(23.2488 + 0.242194 * (y - 1980) - Math.floor((y - 1980) / 4));
  }

  const cache = {};

  /** その年の { "YYYY-MM-DD": 祝日名 } を返す */
  function yearMap(y) {
    if (cache[y]) return cache[y];

    const map = {};
    const add = (m, d, name) => { map[key(y, m, d)] = name; };

    add(1, 1, '元日');
    if (y >= 2000) add(1, nthWeekday(y, 1, 1, 2), '成人の日');
    else add(1, 15, '成人の日');

    add(2, 11, '建国記念の日');
    if (y >= 2020) add(2, 23, '天皇誕生日');

    add(3, vernalEquinoxDay(y), '春分の日');

    add(4, 29, y >= 2007 ? '昭和の日' : 'みどりの日');

    add(5, 3, '憲法記念日');
    if (y >= 2007) add(5, 4, 'みどりの日');
    add(5, 5, 'こどもの日');

    // 海の日（2020・2021は五輪特例）
    if (y === 2020) add(7, 23, '海の日');
    else if (y === 2021) add(7, 22, '海の日');
    else if (y >= 2003) add(7, nthWeekday(y, 7, 1, 3), '海の日');
    else if (y >= 1996) add(7, 20, '海の日');

    // 山の日（2016年から。2020・2021は特例）
    if (y === 2020) add(8, 10, '山の日');
    else if (y === 2021) add(8, 8, '山の日');
    else if (y >= 2016) add(8, 11, '山の日');

    if (y >= 2003) add(9, nthWeekday(y, 9, 1, 3), '敬老の日');
    else if (y >= 1966) add(9, 15, '敬老の日');
    add(9, autumnalEquinoxDay(y), '秋分の日');

    // 体育の日 → スポーツの日（2020・2021は特例で7月）
    if (y === 2020) add(7, 24, 'スポーツの日');
    else if (y === 2021) add(7, 23, 'スポーツの日');
    else if (y >= 2000) add(10, nthWeekday(y, 10, 1, 2), y >= 2020 ? 'スポーツの日' : '体育の日');
    else add(10, 10, '体育の日');

    add(11, 3, '文化の日');
    add(11, 23, '勤労感謝の日');

    if (y >= 1989 && y <= 2018) add(12, 23, '天皇誕生日');
    if (y === 2019) {
      add(5, 1, '天皇の即位の日');
      add(10, 22, '即位礼正殿の儀の行われる日');
    }

    // 振替休日：祝日が日曜の場合、その後の最初の平日（1973年以降）
    const substitutes = {};
    Object.keys(map).forEach(function (k) {
      const d = new Date(k.slice(0, 4), Number(k.slice(5, 7)) - 1, Number(k.slice(8, 10)));
      if (d.getDay() !== 0) return;
      const next = new Date(d.getTime());
      do {
        next.setDate(next.getDate() + 1);
      } while (map[keyOf(next)]);
      substitutes[keyOf(next)] = '振替休日';
    });
    Object.assign(map, substitutes);

    // 国民の休日：祝日に挟まれた日曜以外の日（1986年以降）
    const sandwiched = {};
    Object.keys(map).forEach(function (k) {
      const d = new Date(k.slice(0, 4), Number(k.slice(5, 7)) - 1, Number(k.slice(8, 10)));
      const mid = new Date(d.getTime());
      mid.setDate(mid.getDate() + 1);
      const after = new Date(d.getTime());
      after.setDate(after.getDate() + 2);
      if (!map[keyOf(mid)] && map[keyOf(after)] && mid.getDay() !== 0) {
        sandwiched[keyOf(mid)] = '国民の休日';
      }
    });
    Object.assign(map, sandwiched);

    cache[y] = map;
    return map;
  }

  /** 祝日名を返す（祝日でなければ null）。引数は Date か "YYYY-MM-DD" */
  function name(date) {
    let k;
    if (typeof date === 'string') {
      k = date;
    } else {
      k = keyOf(date);
    }
    const y = Number(k.slice(0, 4));
    if (!y) return null;
    // 年末の振替休日が翌年に食い込むケースに備えて前年も参照
    return yearMap(y)[k] || yearMap(y - 1)[k] || null;
  }

  function isHoliday(date) {
    return !!name(date);
  }

  global.HolidayJP = { name: name, isHoliday: isHoliday, yearMap: yearMap };
})(window);
