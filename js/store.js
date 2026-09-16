/*
 * データ保存
 *  1) localStorage … 変更するたびに自動保存（無料・サーバー不要）
 *  2) JSONファイル … 書き出し／読み込みでバックアップ・端末移行
 *  3) GitHub同期（任意）… data/inventory.json へコミットして端末間で共有
 *     読み込みはトークン不要（公開リポジトリ）。保存のみトークンが必要。
 */
(function (global) {
  'use strict';

  const U = global.U;
  const STORAGE_KEY = 'bento-inventory-v1';
  const TOKEN_KEY = 'bento-inventory-token'; // トークンは端末内のみ。JSON書き出しには含めない

  function defaultData() {
    const todayStr = U.ymd(U.today());
    return {
      version: 1,
      updatedAt: new Date().toISOString(),
      settings: {
        provider: 'ベルーナ',
        configured: false,
        startDate: todayStr,
        startStock: 0,
        defaultDeliveryQty: 10,
        lowStockThreshold: 3,
        rules: {
          tue: true,
          thu: true,
          sat: true,
          augWed: true,
          fifthWed: true,
          holidayWed: true
        },
        sync: { owner: '', repo: '', branch: 'main', path: 'data/inventory.json', auto: true }
      },
      deliveries: [],
      overrides: {},
      extras: [],
      adjustments: []
    };
  }

  /** 欠けているキーを既定値で補う（バージョン差異の吸収） */
  function normalize(raw) {
    const base = defaultData();
    const data = Object.assign({}, base, raw || {});
    data.settings = Object.assign({}, base.settings, (raw && raw.settings) || {});
    data.settings.rules = Object.assign({}, base.settings.rules, (raw && raw.settings && raw.settings.rules) || {});
    data.settings.sync = Object.assign({}, base.settings.sync, (raw && raw.settings && raw.settings.sync) || {});
    data.deliveries = Array.isArray(data.deliveries) ? data.deliveries : [];
    data.extras = Array.isArray(data.extras) ? data.extras : [];
    data.adjustments = Array.isArray(data.adjustments) ? data.adjustments : [];
    data.overrides = data.overrides && typeof data.overrides === 'object' ? data.overrides : {};
    data.version = 1;
    return data;
  }

  function loadLocal() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      return normalize(JSON.parse(raw));
    } catch (e) {
      console.warn('ローカル保存の読み込みに失敗しました', e);
      return null;
    }
  }

  function saveLocal(data) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      return true;
    } catch (e) {
      console.warn('ローカル保存に失敗しました', e);
      return false;
    }
  }

  function clearLocal() {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (e) { /* 無視 */ }
  }

  function getToken() {
    try {
      return localStorage.getItem(TOKEN_KEY) || '';
    } catch (e) {
      return '';
    }
  }

  function setToken(token) {
    try {
      if (token) localStorage.setItem(TOKEN_KEY, token);
      else localStorage.removeItem(TOKEN_KEY);
    } catch (e) { /* 無視 */ }
  }

  /** GitHub Pages の URL から owner/repo を推測 */
  function guessSyncTarget() {
    const host = location.hostname || '';
    const m = /^([^.]+)\.github\.io$/.exec(host);
    if (!m) return null;
    const owner = m[1];
    const seg = location.pathname.split('/').filter(Boolean);
    const repo = seg.length > 0 && !/\.html?$/i.test(seg[0]) ? seg[0] : owner + '.github.io';
    return { owner: owner, repo: repo };
  }

  /* ---- UTF-8 対応 Base64 ---- */
  function b64encode(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = '';
    bytes.forEach(function (b) { bin += String.fromCharCode(b); });
    return btoa(bin);
  }

  function b64decode(b64) {
    const bin = atob(String(b64).replace(/\s/g, ''));
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }

  function syncConfigured(data) {
    const s = (data.settings && data.settings.sync) || {};
    return !!(s.owner && s.repo && s.path);
  }

  function apiUrl(sync) {
    return 'https://api.github.com/repos/' + encodeURIComponent(sync.owner) + '/' +
      encodeURIComponent(sync.repo) + '/contents/' + sync.path.split('/').map(encodeURIComponent).join('/');
  }

  /** GitHub からデータを取得（トークンがあればAPI、無ければ同一オリジンの静的ファイル） */
  async function pull(data) {
    const sync = data.settings.sync;
    const token = getToken();

    if (token && syncConfigured(data)) {
      const res = await fetch(apiUrl(sync) + '?ref=' + encodeURIComponent(sync.branch || 'main'), {
        headers: {
          Authorization: 'Bearer ' + token,
          Accept: 'application/vnd.github+json'
        },
        cache: 'no-store'
      });
      if (res.status === 404) return { found: false };
      if (!res.ok) throw new Error('GitHub API エラー (' + res.status + ')：' + (await res.text()).slice(0, 200));
      const json = await res.json();
      return { found: true, data: normalize(JSON.parse(b64decode(json.content))), sha: json.sha };
    }

    // トークンなし：同じサイトに置かれた data/inventory.json を読む
    const res = await fetch((data.settings.sync.path || 'data/inventory.json') + '?t=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) return { found: false };
    const json = await res.json();
    if (!json || !json.settings) return { found: false };
    return { found: true, data: normalize(json), sha: null };
  }

  /** GitHub にコミット（トークン必須） */
  async function push(data) {
    const sync = data.settings.sync;
    const token = getToken();
    if (!token) throw new Error('GitHubトークンが設定されていません');
    if (!syncConfigured(data)) throw new Error('同期先（ユーザー名／リポジトリ）が未設定です');

    // 既存ファイルの sha を取得（無ければ新規作成）
    let sha = null;
    const head = await fetch(apiUrl(sync) + '?ref=' + encodeURIComponent(sync.branch || 'main'), {
      headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json' },
      cache: 'no-store'
    });
    if (head.ok) {
      sha = (await head.json()).sha;
    } else if (head.status !== 404) {
      throw new Error('GitHub API エラー (' + head.status + ')：' + (await head.text()).slice(0, 200));
    }

    const body = {
      message: '弁当在庫データを更新 (' + new Date().toLocaleString('ja-JP') + ')',
      content: b64encode(JSON.stringify(data, null, 2)),
      branch: sync.branch || 'main'
    };
    if (sha) body.sha = sha;

    const res = await fetch(apiUrl(sync), {
      method: 'PUT',
      headers: {
        Authorization: 'Bearer ' + token,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error('保存に失敗しました (' + res.status + ')：' + (await res.text()).slice(0, 200));
    return await res.json();
  }

  global.Store = {
    STORAGE_KEY: STORAGE_KEY,
    defaultData: defaultData,
    normalize: normalize,
    loadLocal: loadLocal,
    saveLocal: saveLocal,
    clearLocal: clearLocal,
    getToken: getToken,
    setToken: setToken,
    guessSyncTarget: guessSyncTarget,
    syncConfigured: syncConfigured,
    pull: pull,
    push: push
  };
})(window);
