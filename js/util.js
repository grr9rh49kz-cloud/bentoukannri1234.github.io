/* 共通ユーティリティ（日付・DOM・ID） */
(function (global) {
  'use strict';

  const WDAY = ['日', '月', '火', '水', '木', '金', '土'];

  const pad = (n) => String(n).padStart(2, '0');

  /** Date -> "YYYY-MM-DD" （ローカル時刻基準） */
  function ymd(date) {
    return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate());
  }

  /** "YYYY-MM-DD" -> Date（ローカル 00:00） */
  function parseYmd(str) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(str || ''));
    if (!m) return null;
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  }

  /** "YYYY-MM-DD" + "HH:MM" -> Date */
  function parseDateTime(dateStr, timeStr) {
    const d = parseYmd(dateStr);
    if (!d) return null;
    const t = /^(\d{1,2}):(\d{2})$/.exec(String(timeStr || '00:00'));
    if (t) {
      d.setHours(Number(t[1]), Number(t[2]), 0, 0);
    }
    return d;
  }

  function addDays(date, days) {
    const d = new Date(date.getTime());
    d.setDate(d.getDate() + days);
    return d;
  }

  function today() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }

  /** 日数差（d2 - d1、日単位・時刻無視） */
  function diffDays(d1, d2) {
    const a = new Date(d1.getFullYear(), d1.getMonth(), d1.getDate());
    const b = new Date(d2.getFullYear(), d2.getMonth(), d2.getDate());
    return Math.round((b - a) / 86400000);
  }

  /** その月で何回目の同じ曜日か（1〜5） */
  function nthWeekdayOfMonth(date) {
    return Math.floor((date.getDate() - 1) / 7) + 1;
  }

  /** "YYYY-MM-DD" -> "9/15(火)" */
  function formatMd(dateStr) {
    const d = parseYmd(dateStr);
    if (!d) return dateStr;
    return (d.getMonth() + 1) + '/' + d.getDate() + '(' + WDAY[d.getDay()] + ')';
  }

  /** "YYYY-MM-DD" -> "2026年9月15日(火)" */
  function formatLong(dateStr) {
    const d = parseYmd(dateStr);
    if (!d) return dateStr;
    return d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日(' + WDAY[d.getDay()] + ')';
  }

  /** 相対日表現（今日／明日／3日後／2日前） */
  function relativeLabel(dateStr) {
    const d = parseYmd(dateStr);
    if (!d) return '';
    const n = diffDays(today(), d);
    if (n === 0) return '今日';
    if (n === 1) return '明日';
    if (n === 2) return 'あさって';
    if (n === -1) return '昨日';
    if (n > 0) return n + '日後';
    return -n + '日前';
  }

  function uid(prefix) {
    return (prefix || 'id') + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
  }

  function el(id) {
    return document.getElementById(id);
  }

  /** 要素を生成（tag, クラスまたは属性, 子） */
  function h(tag, attrs, children) {
    const node = document.createElement(tag);
    if (typeof attrs === 'string') {
      node.className = attrs;
    } else if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.indexOf('on') === 0 && typeof attrs[k] === 'function') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined && attrs[k] !== false) node.setAttribute(k, attrs[k]);
      });
    }
    if (children !== null && children !== undefined) {
      (Array.isArray(children) ? children : [children]).forEach(function (c) {
        if (c === null || c === undefined || c === false) return;
        node.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
      });
    }
    return node;
  }

  global.U = {
    WDAY: WDAY,
    pad: pad,
    ymd: ymd,
    parseYmd: parseYmd,
    parseDateTime: parseDateTime,
    addDays: addDays,
    today: today,
    diffDays: diffDays,
    nthWeekdayOfMonth: nthWeekdayOfMonth,
    formatMd: formatMd,
    formatLong: formatLong,
    relativeLabel: relativeLabel,
    uid: uid,
    el: el,
    h: h
  };
})(window);
