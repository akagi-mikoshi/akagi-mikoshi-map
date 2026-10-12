(() => {
  const VERSION = '1';
  let token = sessionStorage.getItem('mikoshiAdminToken') || '';
  let busy = false;
  let seq = 0;

  function loadCss(url) {
    return new Promise((resolve, reject) => {
      const x = document.createElement('link');
      x.rel = 'stylesheet'; x.href = url;
      x.onload = resolve; x.onerror = reject;
      document.head.appendChild(x);
    });
  }

  function loadJs(url) {
    return new Promise((resolve, reject) => {
      const x = document.createElement('script');
      x.src = url; x.async = true;
      x.onload = resolve; x.onerror = reject;
      document.body.appendChild(x);
    });
  }

  async function boot() {
    await Promise.all([
      loadCss('./admin-style.css?v=' + VERSION),
      loadJs('./config.js?v=' + VERSION)
    ]);

    if (!window.MIKOSHI_API_URL || !window.MIKOSHI_API_URL.endsWith('/exec')) {
      document.body.innerHTML = '<div class="wrap"><div class="card"><h1>神輿位置 管理</h1><div class="message error">config.js の Apps Script URL を確認してください。</div></div></div>';
      return;
    }

    render();

    if (token) {
      try {
        const r = await callAdmin('status');
        if (r.ok) { showAdmin(r.state); return; }
      } catch (e) {}
      clearSession();
    }

    showLogin();
  }

  function render() {
    document.body.innerHTML = `
      <div class="wrap">
        <div class="card">
          <h1>赤城神社 神輿位置 管理</h1>
          <div id="loginBox">
            <label for="password">管理用パスワード</label>
            <input id="password" type="password" autocomplete="current-password">
            <button id="loginBtn" class="primary">管理画面を開く</button>
            <div class="muted" style="margin-top:8px">パスワードはGitHubには保存しません。</div>
          </div>
          <div id="adminBox" class="hidden">
            <div id="publicStatus" class="status off"><span class="dot"></span><span>確認中</span></div>
            <div id="stateInfo" class="info"></div>
            <div id="mainMessage"></div>
          </div>
        </div>

        <div id="controls" class="hidden">
          <div class="card">
            <h2>当日の基本操作</h2>
            <div class="stack">
              <button id="startBtn" class="safe">巡行開始</button>
              <button id="endBtn" class="danger">巡行終了</button>
            </div>
            <div class="muted" style="margin-top:9px">「巡行開始」は履歴を消去し、赤城神社を初期位置として公開を開始します。「巡行終了」は公開を停止し、位置データを赤城神社へ戻します。</div>
          </div>

          <div class="card">
            <h2>個別操作</h2>
            <div class="row">
              <button id="onBtn" class="primary">公開する</button>
              <button id="offBtn" class="outline">公開停止</button>
            </div>
            <div class="stack" style="margin-top:10px">
              <button id="resetBtn">非公開＋赤城神社へリセット</button>
              <button id="clearBtn">位置履歴を消去</button>
              <button id="refreshBtn" class="small-btn">状態を再確認</button>
            </div>
          </div>

          <div class="card">
            <h2>管理</h2>
            <button id="logoutBtn" class="small-btn">ログアウト</button>
          </div>
        </div>
        <div class="footer">管理用URLは一般向けQRコードには使用しません。</div>
      </div>`;

    document.getElementById('loginBtn').onclick = login;
    document.getElementById('password').onkeydown = e => { if (e.key === 'Enter') login(); };
    document.getElementById('startBtn').onclick = () => confirmRun('巡行開始','位置履歴を消去し、赤城神社を初期位置として公開を開始します。よろしいですか？','start');
    document.getElementById('endBtn').onclick = () => confirmRun('巡行終了','公開を停止し、位置履歴を消去して、位置データを赤城神社へ戻します。よろしいですか？','end');
    document.getElementById('onBtn').onclick = () => run('publicOn','公開を開始しました。');
    document.getElementById('offBtn').onclick = () => run('publicOff','公開を停止しました。');
    document.getElementById('resetBtn').onclick = () => confirmRun('赤城神社へリセット','公開を停止し、位置履歴を消去して、現在地データを赤城神社へ戻します。よろしいですか？','resetDefault');
    document.getElementById('clearBtn').onclick = () => confirmRun('位置履歴を消去','保存されている位置履歴を消去します。最新位置そのものは変更しません。よろしいですか？','clearHistory');
    document.getElementById('refreshBtn').onclick = refresh;
    document.getElementById('logoutBtn').onclick = logout;
  }

  function showLogin() {
    document.getElementById('loginBox').classList.remove('hidden');
    document.getElementById('adminBox').classList.add('hidden');
    document.getElementById('controls').classList.add('hidden');
    setTimeout(() => document.getElementById('password')?.focus(), 50);
  }

  function showAdmin(state) {
    document.getElementById('loginBox').classList.add('hidden');
    document.getElementById('adminBox').classList.remove('hidden');
    document.getElementById('controls').classList.remove('hidden');
    updateState(state);
  }

  async function login() {
    if (busy) return;
    const password = document.getElementById('password').value;
    if (!password) { loginMessage('パスワードを入力してください。'); return; }

    setBusy(true);
    try {
      const c = await jsonp({ mode: 'adminChallenge' });
      if (!c.ok || !c.nonce) throw new Error('challenge');
      const proof = await sha256Hex(c.nonce + ':' + password);
      document.getElementById('password').value = '';
      const r = await jsonp({ mode: 'adminLogin', nonce: c.nonce, proof });

      if (!r.ok) {
        if (r.error === 'invalid_password') throw new Error('password');
        if (r.error === 'admin_key_not_set') throw new Error('key');
        throw new Error('login');
      }

      token = r.token;
      sessionStorage.setItem('mikoshiAdminToken', token);
      showAdmin(r.state);
    } catch (e) {
      loginMessage(e.message === 'password' ? 'パスワードが違います。' : e.message === 'key' ? 'GASに MIKOSHI_ADMIN_KEY が設定されていません。' : '認証できませんでした。');
    } finally {
      setBusy(false);
    }
  }

  function loginMessage(text) {
    const box = document.getElementById('loginBox');
    box.querySelectorAll('.dynamic').forEach(x => x.remove());
    const el = document.createElement('div');
    el.className = 'message error dynamic'; el.textContent = text;
    box.appendChild(el);
  }

  async function confirmRun(title, message, action) {
    if (!confirm(title + '\n\n' + message)) return;
    await run(action, title + 'を実行しました。');
  }

  async function run(action, okText) {
    if (busy || !token) return;
    setBusy(true); mainMessage('処理しています…');
    try {
      const r = await callAdmin(action);
      if (!r.ok) {
        if (r.error === 'session_expired') return expired();
        throw new Error('failed');
      }
      if (r.state) updateState(r.state);
      mainMessage(okText, false, true);
    } catch (e) {
      mainMessage('処理に失敗しました。通信状態を確認してもう一度お試しください。', true);
    } finally { setBusy(false); }
  }

  async function refresh() {
    if (busy || !token) return;
    setBusy(true);
    try {
      const r = await callAdmin('status');
      if (!r.ok) {
        if (r.error === 'session_expired') return expired();
        throw new Error('failed');
      }
      updateState(r.state); mainMessage('状態を更新しました。', false, true);
    } catch (e) { mainMessage('状態を取得できませんでした。', true); }
    finally { setBusy(false); }
  }

  async function logout() {
    try { if (token) await callAdmin('logout'); } catch (e) {}
    clearSession(); location.reload();
  }

  function expired() {
    clearSession(); alert('管理セッションの有効期限が切れました。もう一度ログインしてください。'); location.reload();
  }

  function clearSession() {
    token = ''; sessionStorage.removeItem('mikoshiAdminToken');
  }

  function updateState(state) {
    const s = document.getElementById('publicStatus');
    s.className = 'status ' + (state.isPublic ? 'on' : 'off');
    s.innerHTML = '<span class="dot"></span><span>' + (state.isPublic ? '公開中' : '非公開') + '</span>';

    const x = state.latest;
    let h = '';
    if (x) {
      const src = x.source === 'default' ? '赤城神社（初期位置）' : 'GPS';
      h += '<div><strong>最新位置</strong>' + esc(src) + '</div>';
      h += '<div><strong>最終受信</strong>' + esc(jpTime(x.receivedAt)) + '（' + esc(age(x.receivedAt)) + '）</div>';
      if (x.accuracy !== null && x.accuracy !== undefined && Number.isFinite(Number(x.accuracy))) h += '<div><strong>位置精度</strong>約' + Math.round(Number(x.accuracy)) + 'm</div>';
      h += '<div><strong>緯度・経度</strong>' + Number(x.lat).toFixed(6) + ', ' + Number(x.lon).toFixed(6) + '</div>';
    } else h += '<div><strong>最新位置</strong>未登録</div>';
    h += '<div><strong>履歴件数</strong>' + Number(state.historyCount || 0) + '件</div>';
    document.getElementById('stateInfo').innerHTML = h;
  }

  function jpTime(v) {
    if (!v) return '—';
    return new Date(v).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit'});
  }

  function age(v) {
    if (!v) return '—';
    const s = Math.max(0, Math.floor((Date.now() - new Date(v).getTime()) / 1000));
    if (s < 60) return s + '秒前';
    if (s < 3600) return Math.floor(s / 60) + '分前';
    return Math.floor(s / 3600) + '時間前';
  }

  function setBusy(v) {
    busy = v; document.querySelectorAll('button').forEach(b => b.disabled = v);
  }

  function mainMessage(text, error=false, ok=false) {
    const el = document.getElementById('mainMessage');
    if (!el) return;
    el.className = 'message' + (error ? ' error' : '') + (ok ? ' ok' : '');
    el.textContent = text;
  }

  function callAdmin(action) {
    return jsonp({ mode:'admin', action, token });
  }

  function jsonp(params) {
    return new Promise((resolve, reject) => {
      const cb = '__mikoshiAdmin_' + Date.now() + '_' + (++seq);
      let script = document.createElement('script');
      const timer = setTimeout(() => { cleanup(); reject(new Error('timeout')); }, 10000);
      function cleanup() {
        clearTimeout(timer);
        if (script.parentNode) script.parentNode.removeChild(script);
        try { delete window[cb]; } catch (e) { window[cb] = undefined; }
      }
      window[cb] = data => { cleanup(); resolve(data); };
      const q = new URLSearchParams({ ...params, callback: cb, _: String(Date.now()) });
      script.src = window.MIKOSHI_API_URL + '?' + q.toString();
      script.async = true;
      script.onerror = () => { cleanup(); reject(new Error('network')); };
      document.body.appendChild(script);
    });
  }

  async function sha256Hex(text) {
    const bytes = new TextEncoder().encode(text);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2,'0')).join('');
  }

  function esc(v) {
    return String(v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');
  }

  boot().catch(err => {
    console.error(err);
    document.body.innerHTML = '<div style="padding:16px;font-family:Meiryo,sans-serif">管理画面を読み込めませんでした。ページを再読み込みしてください。</div>';
  });
})();
