(() => {
  const VERSION = '8';
  const SYSTEM_VERSION = 'RC3-D2.5';
  const PUBLIC_RELEASE = 'RC3-D2.6l';
  const LEAFLET_CSS =
    'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css';
  const LEAFLET_JS =
    'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js';

  let token =
    sessionStorage.getItem('mikoshiAdminToken') || '';
  let seq = 0;
  let timer = null;
  let map = null;
  let routeGroup = null;
  let receivedMarker = null;
  let currentMarker = null;
  let differenceLine = null;
  let historyLayer = null;
  let lastDebug = null;
  let lastLatency = null;
  let refreshing = false;

  function loadCss(url) {
    return new Promise((resolve, reject) => {
      const x = document.createElement('link');
      x.rel = 'stylesheet';
      x.href = url;
      x.onload = resolve;
      x.onerror = reject;
      document.head.appendChild(x);
    });
  }

  function loadJs(url) {
    return new Promise((resolve, reject) => {
      const x = document.createElement('script');
      x.src = url;
      x.async = true;
      x.onload = resolve;
      x.onerror = reject;
      document.body.appendChild(x);
    });
  }

  async function boot() {
    await Promise.all([
      loadCss('./debug-style-authvis.css?v=' + VERSION + '-focusfix'),
      loadJs('./config.js?v=' + VERSION),
      loadCss(LEAFLET_CSS),
      loadJs(LEAFLET_JS),
      loadJs('./route-data.js?v=' + VERSION)
    ]);

    render();

    wireResume();
    if (token) {
      showResume();
      checkSavedSession();
      return;
    }

    showLogin();
  }

  function render() {
    document.body.innerHTML = `
      <div class="wrap">
        <div class="card">
          <div class="title-row">
            <h1>赤城神社 神輿位置 診断</h1>
            <span class="version-badge">${PUBLIC_RELEASE}</span>
          </div>
          <div class="muted">
            診断・確認用の画面です。神輿の巡行状態や一般向け地図の表示状態は変更しません。
          </div>

          <div id="loginBox">
            <label for="password">管理用パスワード</label>
            <input id="password" type="password" autocomplete="current-password">
            <label class="password-visibility" for="showPassword"><input id="showPassword" type="checkbox">パスワードを表示する</label>
            <button id="loginBtn" class="primary">診断画面を開く</button>
            <div id="loginMessage"></div>
          </div>
          <div id="resumeBox" class="hidden">
            <div class="message" id="resumeMessage" role="status" aria-live="polite">前回のログイン状態を確認しています…</div>
            <button id="resumeRetryBtn" class="primary" type="button">再接続を試す</button>
            <button id="resumePasswordBtn" type="button">パスワードでログインし直す</button>
          </div>
        </div>

        <div id="debugBox" class="hidden">
          <div class="card">
            <h2>現在の診断 <button class="inline-info" data-info="diagnosis">ⓘ</button></h2>
            <div class="diagnosis-grid">
              <div class="diagnosis-row"><span>Traccar受信</span><strong id="diagReceive">—</strong></div>
              <div class="diagnosis-row"><span>神輿現在位置への反映</span><strong id="diagReflect">—</strong></div>
            </div>
          </div>

          <div class="card">
            <h2>主要状態</h2>
            <div class="summary">
              <div class="tile"><div class="label">サーバー通信</div><div id="apiStatus" class="value">—</div></div>
              <div class="tile"><div class="label">巡行状態</div><div id="sessionStatus" class="value">—</div></div>
              <div class="tile"><div class="label">一般向け地図の神輿位置</div><div id="publicStatus" class="value">—</div></div>
              <div class="tile"><div class="label">Traccar最終受信</div><div id="ingestStatus" class="value">—</div></div>
            </div>
          </div>

          <div class="card">
            <h2>Traccarから最後に受信した位置情報 <button class="inline-info" data-info="ingest">ⓘ</button></h2>
            <table class="kv">
              <tr><th>デバイス識別子</th><td id="deviceIdentifier" class="mono">—</td></tr>
              <tr><th>最終受信</th><td id="ingestTime">—</td></tr>
              <tr><th>処理</th><td id="ingestResult">—</td></tr>
              <tr><th>緯度・経度</th><td id="ingestCoords" class="mono">—</td></tr>
              <tr><th>位置精度</th><td id="ingestAccuracy">—</td></tr>
              <tr><th>通信方式</th><td id="ingestTransport">—</td></tr>
            </table>
            <div class="muted" style="margin-top:8px">
              Traccar Client側で「Location filtered」や「request no fix」となった位置情報は送信されないため、ここには現れません。
            </div>
            <button id="clearLastIngestBtn" class="caution">診断用の最終受信情報を消去</button>
            <div id="ingestActionMessage"></div>
          </div>

          <div class="card">
            <h2>現在の神輿位置（システム上） <button class="inline-info" data-info="current">ⓘ</button></h2>
            <table class="kv">
              <tr><th>位置の種類</th><td id="latestSource">—</td></tr>
              <tr><th>最終更新</th><td id="latestTime">—</td></tr>
              <tr><th>緯度・経度</th><td id="latestCoords" class="mono">—</td></tr>
              <tr><th>位置精度</th><td id="latestAccuracy">—</td></tr>
              <tr><th>経路記録</th><td><span id="trailCount">—</span> <button class="inline-info" data-info="trail">ⓘ</button></td></tr>
              <tr><th>一般向け地図</th><td id="publicLatest">—</td></tr>
            </table>
          </div>

          <div class="card">
            <h2>受信位置と神輿現在位置の確認地図</h2>
            <div class="debug-legend">
              <span><i class="dot received"></i>Traccarから最後に受信</span>
              <span><i class="dot current"></i>神輿現在位置</span>
              <span><i class="dot same"></i>両者が一致</span>
            </div>
            <div id="map"></div>
            <div class="mapButtons">
              <button id="receivedBtn" class="secondary">Traccar受信位置へ</button>
              <button id="currentBtn" class="secondary">神輿現在位置へ</button>
              <button id="routeBtn" class="secondary">巡行ルート全体を地図表示</button>
            </div>
            <div id="mapInfo" class="message">位置情報を確認しています…</div>
          </div>

          <div class="card">
            <h2>最近、神輿現在位置に反映した位置情報（最大10件）</h2>
            <div style="overflow:auto">
              <table class="history">
                <thead><tr><th>時刻</th><th>デバイス識別子</th><th>精度</th><th>緯度・経度</th></tr></thead>
                <tbody id="historyBody"></tbody>
              </table>
            </div>
          </div>

          <div class="card">
            <h2>システム情報</h2>
            <table class="kv">
              <tr><th>公開版（全画面共通）</th><td>${PUBLIC_RELEASE}</td></tr>
              <tr><th>基本処理版（位置情報・通信）</th><td>${SYSTEM_VERSION}</td></tr>
              <tr><th>Backend</th><td id="backendVersion">—</td></tr>
              <tr><th>地図表示（内部）</th><td>app v14</td></tr>
              <tr><th>管理画面（内部）</th><td>admin v21</td></tr>
              <tr><th>診断画面（内部）</th><td>debug v8</td></tr>
              <tr><th>シミュレーション（内部）</th><td>simulator v19／通信安定化S1</td></tr>
              <tr><th>巡行ルート・予定データ</th><td><span id="routeDataInfo">—</span> <button class="inline-info" data-info="routeData">ⓘ</button></td></tr>
              <tr><th>サーバー時刻</th><td id="serverTime">—</td></tr>
              <tr><th>神輿位置の表示開始時刻</th><td id="publicSince">—</td></tr>
            </table>
          </div>

          <div class="card">
            <div class="toolbar">
              <button id="refreshBtn" class="secondary">今すぐ再確認</button>
              <button id="copyBtn" class="primary">診断情報をコピー</button>
            </div>
            <div id="copyMessage"></div>
          </div>
        </div>

        <div class="footer">診断画面は一般向けQRコードには使用しません。</div>
      </div>

      <div id="infoModal" class="modal hidden" role="dialog" aria-modal="true">
        <div class="modal-card">
          <div class="modal-head"><strong id="infoTitle">説明</strong><button id="infoClose">×</button></div>
          <div id="infoBody" class="modal-body"></div>
        </div>
      </div>`;

    document.getElementById('loginBtn').onclick = login;
    document.getElementById('showPassword').addEventListener('change', function() {
      document.getElementById('password').type = this.checked ? 'text' : 'password';
    });

    document.getElementById('password').onkeydown =
      e => {
        if (e.key === 'Enter') login();
      };

    document.getElementById('refreshBtn').onclick = refreshOnce;
    document.getElementById('copyBtn').onclick = copyDiagnosis;
    document.getElementById('clearLastIngestBtn').onclick = clearLastIngest_;
    document.getElementById('receivedBtn').onclick = focusReceived;
    document.getElementById('currentBtn').onclick = focusCurrent;
    document.getElementById('routeBtn').onclick = fitRoute;
    document.getElementById('infoClose').onclick = closeInfo;

    document.querySelectorAll('[data-info]').forEach(btn => {
      btn.addEventListener('click', () => openInfo(btn.dataset.info));
    });

    document.getElementById('infoModal').addEventListener('click', e => {
      if (e.target.id === 'infoModal') closeInfo();
    });
  }

  function openInfo(kind) {
    const info = {
      diagnosis: [
        '現在の診断',
        '「Traccar受信」は位置情報がサーバーまで届いているか、「神輿現在位置への反映」は、その位置情報が現在の神輿位置として使われているかを示します。'
      ],
      ingest: [
        'Traccarから最後に受信した位置情報',
        '巡行開始前・終了後でも、Traccar Clientから位置情報がサーバーまで届けばここで確認できます。'
      ],
      current: [
        '現在の神輿位置（システム上）',
        'システムが現在の神輿位置として持っている最新1件です。位置履歴の一覧ではありません。巡行中は、正常に受信したTraccarの位置情報がここへ反映されます。'
      ],
      trail: [
        '経路記録',
        '巡行中に受信した位置情報のうち、前回の経路記録点から約12m以上移動した地点を記録します。GPSの受信回数そのものではありません。最大1200点です。公開地図の赤茶色の線は、この記録を予定巡行路に照らして表示します。'
      ],
      routeData: [
        '巡行ルート・予定データの変更履歴',
        routeHistoryText_()
      ]
    }[kind];

    if (!info) return;

    document.getElementById('infoTitle').textContent = info[0];
    document.getElementById('infoBody').textContent = info[1];
    document.getElementById('infoModal').classList.remove('hidden');
  }

  function closeInfo() {
    document.getElementById('infoModal').classList.add('hidden');
  }

  function routeHistoryText_() {
    const meta =
      window.MIKOSHI_ROUTE_DATA &&
      window.MIKOSHI_ROUTE_DATA.metadata;

    if (!meta) return '変更履歴は登録されていません。';

    const lines = [
      'データ版：' + (meta.dataVersion || '—'),
      '最終更新：' + (meta.updatedAt || '—'),
      ''
    ];

    (meta.changes || []).forEach(change => {
      lines.push(change.date || '');
      (change.items || []).forEach(item => {
        lines.push('・' + item);
      });
      lines.push('');
    });

    if (Array.isArray(meta.sourceNotes) && meta.sourceNotes.length) {
      lines.push('出典メモ');
      meta.sourceNotes.forEach(item => lines.push('・' + item));
    }

    return lines.join('\n').trim();
  }


  // サーバーの一時的な不応答では保存済みトークンを消さない。
  // 本当に期限切れと返った場合、または利用者が選んだ場合だけ再ログインにする。
  let resumeTimer = null;
  let resumeBusy = false;

  function stopResumeRetry() {
    if (resumeTimer) clearTimeout(resumeTimer);
    resumeTimer = null;
  }

  function showResume() {
    document.getElementById('loginBox').classList.add('hidden');
    document.getElementById('resumeBox').classList.remove('hidden');
    document.getElementById('debugBox').classList.add('hidden');
  }

  function hideResume() {
    stopResumeRetry();
    document.getElementById('resumeBox').classList.add('hidden');
  }

  function queueResumeRetry() {
    if (!token || resumeTimer || document.getElementById('resumeBox').classList.contains('hidden')) return;
    resumeTimer = setTimeout(() => {
      resumeTimer = null;
      checkSavedSession();
    }, 10000);
  }

  async function checkSavedSession() {
    if (resumeBusy || !token) return;
    if (document.visibilityState === 'hidden') {
      queueResumeRetry();
      return;
    }
    resumeBusy = true;
    const attemptedToken = token;
    const info = document.getElementById('resumeMessage');
    info.textContent = '前回のログイン状態を確認しています…';
    try {
      const r = await callAdmin('debugStatus');
      if (token !== attemptedToken) return;
      if (r && r.ok && r.debug) {
        hideResume();
        showDebug();
        applyDebug(r.debug);
        startPolling();
        return;
      }
      if (r && r.error === 'session_expired') {
        clearSession();
        hideResume();
        showLogin();
        return;
      }
      info.textContent = 'サーバーから認証状態を確認できません。ログイン情報は保持しています。通信回復後に自動で再接続します。';
    } catch (e) {
      // シミュレーション画面では共通APIが期限切れ時に例外を投げる。
      if (e && e.message === 'session_expired') {
        clearSession();
        hideResume();
        showLogin();
        return;
      }
      if (token !== attemptedToken) return;
      info.textContent = 'サーバーから応答を取得できません。ログイン情報は保持しています。通信回復後に自動で再接続します。';
    } finally {
      resumeBusy = false;
      queueResumeRetry();
    }
  }

  function wireResume() {
    document.getElementById('resumeRetryBtn').onclick = () => {
      if (resumeBusy) return;
      stopResumeRetry();
      checkSavedSession();
    };
    document.getElementById('resumePasswordBtn').onclick = () => {
      stopResumeRetry();
      clearSession();
      hideResume();
      showLogin();
    };
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible' || resumeBusy || !token) return;
      const el = document.getElementById('resumeBox');
      if (!el || el.classList.contains('hidden')) return;
      stopResumeRetry();
      checkSavedSession();
    });
  }

  function showLogin() {
    document.getElementById('loginBox').classList.remove('hidden');
    document.getElementById('debugBox').classList.add('hidden');
  }

  function showDebug() {
    document.getElementById('loginBox').classList.add('hidden');
    document.getElementById('debugBox').classList.remove('hidden');

    if (!map) initMap();
  }

  async function login() {
    const box = document.getElementById('password');
    const btn = document.getElementById('loginBtn');
    const password = box.value;

    if (!password) {
      setLoginMessage('パスワードを入力してください。', true);
      box.focus();
      return;
    }

    btn.disabled = true;
    btn.textContent = '確認しています…';
    box.disabled = true;
    setLoginMessage('パスワードを確認しています…', false);

    try {
      const c = await jsonp({ mode: 'adminChallenge' });

      if (!c.ok || !c.nonce) {
        throw new Error('challenge');
      }

      const proof = await sha256Hex(c.nonce + ':' + password);

      const r = await jsonp({
        mode: 'adminLogin',
        nonce: c.nonce,
        proof: proof
      });

      if (!r.ok) {
        throw new Error(
          r.error === 'invalid_password'
            ? 'password'
            : 'login'
        );
      }

      token = r.token;
      sessionStorage.setItem('mikoshiAdminToken', token);

      box.value = '';
      box.type = 'password';
      document.getElementById('showPassword').checked = false;
      showDebug();
      await refreshOnce();
      startPolling();
    } catch (e) {
      setLoginMessage(
        e.message === 'password'
          ? 'パスワードが違います。入力内容を確認してください。'
          : '認証できませんでした。通信状態を確認して、もう一度お試しください。',
        true
      );
      box.disabled = false;
      box.focus();
      box.select();
    } finally {
      btn.disabled = false;
      btn.textContent = '診断画面を開く';
      box.disabled = false;
    }
  }

  function setLoginMessage(text, error) {
    const el = document.getElementById('loginMessage');
    el.className = 'message' + (error ? ' error' : '');
    el.textContent = text;
  }

  async function clearLastIngest_() {
    if (!token) return;

    if (!confirm(
      '診断画面に表示される「Traccarから最後に受信した位置情報」だけを消去します。神輿現在位置・経路記録・一般向け地図には影響しません。よろしいですか？'
    )) {
      return;
    }

    const btn = document.getElementById('clearLastIngestBtn');
    const msg = document.getElementById('ingestActionMessage');

    btn.disabled = true;
    msg.className = 'message';
    msg.textContent = '診断用の最終受信情報を消去しています…';

    try {
      const r = await callAdmin('debugClearLastIngest');

      if (!r.ok) {
        if (r.error === 'session_expired') {
          clearSession();
          alert('管理セッションの有効期限が切れました。もう一度ログインしてください。');
          location.reload();
          return;
        }

        throw new Error('failed');
      }

      msg.className = 'message ok-message';
      msg.textContent = '診断用の最終受信情報を消去しました。';
      await refreshOnce();
    } catch (e) {
      msg.className = 'message error';
      msg.textContent = '診断用の最終受信情報を消去できませんでした。';
    } finally {
      btn.disabled =
        !(lastDebug && lastDebug.lastIngest);
    }
  }

  async function refreshOnce() {
    if (!token || refreshing) return;
    refreshing = true;
    const started = performance.now();

    try {
      const r = await callAdmin('debugStatus');

      lastLatency = Math.round(performance.now() - started);

      if (!r.ok) {
        if (r.error === 'session_expired') {
          clearSession();
          alert('管理セッションの有効期限が切れました。もう一度ログインしてください。');
          location.reload();
          return;
        }
        throw new Error('failed');
      }

      lastDebug = r.debug;
      applyDebug(lastDebug);
    } catch (e) {
      setValue('apiStatus', '取得失敗', 'bad');
      setText('diagReceive', '確認できません', 'bad');
      setText('diagReflect', '確認できません', 'bad');
    } finally {
      refreshing = false;
    }
  }

  function startPolling() {
    stopPolling();
    timer = setInterval(refreshOnce, 5000);
  }

  function stopPolling() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  function applyDebug(d) {
    if (!d || !d.admin) return;

    const a = d.admin;
    const ingest = d.lastIngest;
    const latest = a.latest;
    const pub = d.publicState || {};

    setValue(
      'apiStatus',
      '正常' + (lastLatency !== null ? '（' + lastLatency + 'ms）' : ''),
      'ok'
    );

    let sessionText = '停止中';
    let sessionClass = 'neutral';

    if (a.isSessionActive && a.sessionMode === 'real') {
      sessionText = '巡行中（本番GPS）';
      sessionClass = 'ok';
    } else if (a.isSessionActive && a.sessionMode === 'simulation') {
      sessionText = 'シミュレーション中';
      sessionClass = 'warn';
    }

    setValue('sessionStatus', sessionText, sessionClass);
    setValue(
      'publicStatus',
      a.isPublic ? '表示中' : '非表示',
      a.isPublic ? 'ok' : 'neutral'
    );

    setValue(
      'ingestStatus',
      ingest && ingest.receivedAt
        ? ageText(ingest.receivedAt)
        : 'まだ受信なし',
      ingest && ingest.result === 'saved'
        ? 'ok'
        : (ingest ? 'warn' : 'neutral')
    );

    const clearLastIngestBtn =
      document.getElementById('clearLastIngestBtn');

    if (clearLastIngestBtn) {
      clearLastIngestBtn.disabled = !ingest;
      clearLastIngestBtn.title =
        ingest
          ? ''
          : '消去する診断用の最終受信情報はありません';
    }

    document.getElementById('deviceIdentifier').textContent =
      ingest && ingest.deviceIdentifier
        ? ingest.deviceIdentifier
        : '—';

    document.getElementById('ingestTime').textContent =
      ingest
        ? jpTime(ingest.receivedAt) + '（' + ageText(ingest.receivedAt) + '）'
        : 'まだTraccarから受信していません';

    document.getElementById('ingestResult').textContent =
      ingest ? ingestResultLabel(ingest.result) : '—';

    document.getElementById('ingestCoords').textContent =
      ingest && isFiniteNumber(ingest.lat) && isFiniteNumber(ingest.lon)
        ? fmtCoord(ingest.lat, ingest.lon)
        : '—';

    document.getElementById('ingestAccuracy').textContent =
      ingest && isFiniteNumber(ingest.accuracy)
        ? '約' + Math.round(ingest.accuracy) + 'm'
        : '—';

    document.getElementById('ingestTransport').textContent =
      ingest ? String(ingest.transport || '—') : '—';

    document.getElementById('latestSource').textContent =
      latest ? sourceLabel(latest.source) : 'なし';

    document.getElementById('latestTime').textContent =
      latest && latest.receivedAt
        ? jpTime(latest.receivedAt) + '（' + ageText(latest.receivedAt) + '）'
        : '—';

    document.getElementById('latestCoords').textContent =
      latest ? fmtCoord(latest.lat, latest.lon) : '—';

    document.getElementById('latestAccuracy').textContent =
      latest && isFiniteNumber(latest.accuracy)
        ? '約' + Math.round(latest.accuracy) + 'm'
        : '—';

    document.getElementById('trailCount').textContent =
      String(a.trailCount || 0) + '点';

    document.getElementById('publicLatest').textContent =
      pub.latest
        ? '表示中：' + sourceLabel(pub.latest.source)
        : (a.isPublic ? '位置情報を待っています' : '非表示');

    document.getElementById('backendVersion').textContent =
      d.backendVersion || '—';

    document.getElementById('serverTime').textContent =
      jpTime(d.serverTime);

    document.getElementById('publicSince').textContent =
      a.publicSince ? jpTime(a.publicSince) : '—';

    const meta =
      window.MIKOSHI_ROUTE_DATA &&
      window.MIKOSHI_ROUTE_DATA.metadata;

    document.getElementById('routeDataInfo').textContent =
      meta
        ? (meta.dataVersion || '—') + '（' + (meta.updatedAt || '—') + '更新）'
        : '—';

    updateDiagnosis_(d);
    updateHistory(d.recentHistory || []);
    updateMap(ingest, latest, d.recentHistory || []);
  }

  function updateDiagnosis_(d) {
    const a = d.admin;
    const ingest = d.lastIngest;

    if (!ingest) {
      setText('diagReceive', 'まだ受信なし', 'neutral');

      if (a.sessionMode === 'simulation') {
        setText('diagReflect', '実GPSは反映しません（シミュレーション中）', 'warn');
      } else if (!a.isSessionActive) {
        setText('diagReflect', '停止中（巡行停止中）', 'neutral');
      } else {
        setText('diagReflect', '受信待ち', 'warn');
      }
      return;
    }

    if (ingest.result === 'unauthorized') {
      setText('diagReceive', '受信したがキー不一致', 'bad');
      setText('diagReflect', '反映していません', 'bad');
      return;
    }

    if (ingest.result === 'invalid_location') {
      setText('diagReceive', '受信したが位置情報不正', 'bad');
      setText('diagReflect', '反映していません', 'bad');
      return;
    }

    setText(
      'diagReceive',
      '正常（' + ageText(ingest.receivedAt) + '）',
      'ok'
    );

    if (ingest.result === 'saved') {
      setText('diagReflect', '反映中', 'ok');
    } else if (ingest.result === 'ignored_session_inactive') {
      setText('diagReflect', 'していません（巡行停止中）', 'neutral');
    } else if (ingest.result === 'ignored_simulation_active') {
      setText('diagReflect', 'していません（シミュレーション中）', 'warn');
    } else {
      setText('diagReflect', '確認中', 'neutral');
    }
  }

  function updateHistory(items) {
    const body = document.getElementById('historyBody');
    body.innerHTML = '';

    if (!items.length) {
      body.innerHTML =
        '<tr><td colspan="4">神輿現在位置に反映した位置情報はまだありません。</td></tr>';
      return;
    }

    [...items].reverse().forEach(x => {
      const tr = document.createElement('tr');

      tr.innerHTML =
        '<td>' + esc(shortTime(x.receivedAt)) + '</td>' +
        '<td class="mono">' + esc(x.deviceIdentifier || '—') + '</td>' +
        '<td>' + esc(isFiniteNumber(x.accuracy) ? Math.round(x.accuracy) + 'm' : '—') + '</td>' +
        '<td class="coords mono">' + esc(fmtCoord(x.lat, x.lon)) + '</td>';

      body.appendChild(tr);
    });
  }

  function initMap() {
    map = L.map('map', { zoomControl: true });

    L.tileLayer(
      'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap contributors'
      }
    ).addTo(map);

    routeGroup = L.featureGroup().addTo(map);

    const data = window.MIKOSHI_ROUTE_DATA;

    if (data && Array.isArray(data.segments)) {
      data.segments.forEach(s => {
        L.polyline(
          s.coordinates,
          {
            color: '#687987',
            weight: 5,
            opacity: .75,
            dashArray: '8 8'
          }
        ).addTo(routeGroup);
      });
    }

    fitRoute();
    setTimeout(() => map.invalidateSize(), 100);
  }

  function updateMap(ingest, latest, history) {
    [receivedMarker, currentMarker, differenceLine, historyLayer]
      .filter(Boolean)
      .forEach(layer => map.removeLayer(layer));

    receivedMarker = null;
    currentMarker = null;
    differenceLine = null;
    historyLayer = null;

    if (Array.isArray(history) && history.length > 1) {
      const pts = history
        .filter(x => isFiniteNumber(x.lat) && isFiniteNumber(x.lon))
        .map(x => [x.lat, x.lon]);

      if (pts.length > 1) {
        historyLayer = L.polyline(
          pts,
          {
            color: '#7893aa',
            weight: 3,
            opacity: .45
          }
        ).addTo(map);
      }
    }

    const received =
      ingest &&
      isFiniteNumber(ingest.lat) &&
      isFiniteNumber(ingest.lon)
        ? [Number(ingest.lat), Number(ingest.lon)]
        : null;

    const current =
      latest &&
      isFiniteNumber(latest.lat) &&
      isFiniteNumber(latest.lon)
        ? [Number(latest.lat), Number(latest.lon)]
        : null;

    if (!received && !current) {
      document.getElementById('mapInfo').textContent =
        '表示できる位置情報がまだありません。';
      return;
    }

    const same =
      received &&
      current &&
      distanceMeters(received, current) < 1;

    if (same) {
      currentMarker = L.circleMarker(
        current,
        {
          radius: 10,
          color: '#65438d',
          weight: 4,
          fillColor: '#ffffff',
          fillOpacity: 1
        }
      )
      .addTo(map)
      .bindPopup('<strong>受信位置＝神輿現在位置</strong>');
    } else {
      if (received) {
        receivedMarker = L.circleMarker(
          received,
          {
            radius: 9,
            color: '#356F9F',
            weight: 3,
            fillColor: '#ffffff',
            fillOpacity: 1
          }
        )
        .addTo(map)
        .bindPopup('<strong>Traccarから最後に受信した位置</strong>');
      }

      if (current) {
        currentMarker = L.circleMarker(
          current,
          {
            radius: 9,
            color: '#8A2D24',
            weight: 3,
            fillColor: '#ffffff',
            fillOpacity: 1
          }
        )
        .addTo(map)
        .bindPopup('<strong>神輿現在位置</strong><br>' + esc(sourceLabel(latest.source)));
      }

      if (received && current) {
        differenceLine = L.polyline(
          [received, current],
          {
            color: '#777',
            weight: 2,
            opacity: .7,
            dashArray: '4 5'
          }
        ).addTo(map);
      }
    }

    const parts = [];

    if (received && current) {
      const d = distanceMeters(received, current);
      parts.push(
        same
          ? 'Traccar受信位置と神輿現在位置は一致しています。'
          : 'Traccar受信位置と神輿現在位置の差：約' + Math.round(d) + 'm'
      );
    }

    if (received) {
      const routeDistance = nearestRouteDistance_(received[0], received[1]);

      if (Number.isFinite(routeDistance)) {
        parts.push(
          routeDistance < 1000
            ? 'Traccar受信位置から予定経路まで：約' + Math.round(routeDistance) + 'm'
            : 'Traccar受信位置から予定経路まで：約' + (routeDistance / 1000).toFixed(1) + 'km（巡行区域外の実機テストなら正常です）'
        );
      }
    }

    document.getElementById('mapInfo').textContent =
      parts.join('　') || '位置情報を表示しています。';
  }

  function nearestRouteDistance_(lat, lon) {
    const data = window.MIKOSHI_ROUTE_DATA;
    if (!data || !Array.isArray(data.segments)) return NaN;

    let best = Infinity;

    data.segments.forEach(seg => {
      const c = seg.coordinates || [];

      for (let i = 0; i < c.length - 1; i++) {
        const d = pointSegmentDistance_(
          lat, lon,
          c[i][0], c[i][1],
          c[i + 1][0], c[i + 1][1]
        );

        if (d < best) best = d;
      }
    });

    return best;
  }

  function pointSegmentDistance_(lat, lon, lat1, lon1, lat2, lon2) {
    const refLat = (lat + lat1 + lat2) / 3 * Math.PI / 180;
    const mx = 111320 * Math.cos(refLat);
    const my = 110540;

    const px = (lon - lon1) * mx;
    const py = (lat - lat1) * my;
    const bx = (lon2 - lon1) * mx;
    const by = (lat2 - lat1) * my;
    const len2 = bx * bx + by * by;

    let t = len2 > 0 ? (px * bx + py * by) / len2 : 0;
    t = Math.max(0, Math.min(1, t));

    const dx = px - bx * t;
    const dy = py - by * t;

    return Math.sqrt(dx * dx + dy * dy);
  }

  function focusReceived() {
    const x = lastDebug && lastDebug.lastIngest;

    if (
      !x ||
      !isFiniteNumber(x.lat) ||
      !isFiniteNumber(x.lon)
    ) return;

    map.setView([Number(x.lat), Number(x.lon)], 17);
    if (receivedMarker) receivedMarker.openPopup();
    else if (currentMarker) currentMarker.openPopup();
  }

  function focusCurrent() {
    const x = lastDebug && lastDebug.admin && lastDebug.admin.latest;

    if (
      !x ||
      !isFiniteNumber(x.lat) ||
      !isFiniteNumber(x.lon)
    ) return;

    map.setView([Number(x.lat), Number(x.lon)], 17);
    if (currentMarker) currentMarker.openPopup();
  }

  function fitRoute() {
    if (routeGroup && routeGroup.getBounds().isValid()) {
      map.fitBounds(routeGroup.getBounds().pad(.06));
    }
  }

  async function copyDiagnosis() {
    if (!lastDebug) return;

    const a = lastDebug.admin;
    const ingest = lastDebug.lastIngest;
    const latest = a.latest;
    const meta =
      window.MIKOSHI_ROUTE_DATA &&
      window.MIKOSHI_ROUTE_DATA.metadata;

    const lines = [
      '赤城神社 神輿位置 診断',
      '公開版: ' + PUBLIC_RELEASE,
      '基本処理版: ' + SYSTEM_VERSION,
      'Backend: ' + (lastDebug.backendVersion || '—'),
      '巡行ルート・予定データ: ' +
        (meta ? (meta.dataVersion || '—') + ' / ' + (meta.updatedAt || '—') : '—'),
      'API応答: ' + (lastLatency !== null ? lastLatency + 'ms' : '—'),
      '巡行状態: ' +
        (
          a.isSessionActive
            ? (a.sessionMode === 'simulation' ? 'シミュレーション中' : '巡行中')
            : '停止中'
        ),
      '一般向け地図: ' + (a.isPublic ? '神輿位置を表示中' : '神輿位置を非表示'),
      'Traccar最終受信: ' +
        (
          ingest
            ? jpTime(ingest.receivedAt) +
              ' / ' +
              ingestResultLabel(ingest.result) +
              ' / デバイス識別子 ' +
              (ingest.deviceIdentifier || '—')
            : 'なし'
        ),
      '神輿現在位置: ' +
        (
          latest
            ? sourceLabel(latest.source) +
              ' / ' +
              fmtCoord(latest.lat, latest.lon) +
              ' / ' +
              (
                isFiniteNumber(latest.accuracy)
                  ? '精度約' + Math.round(latest.accuracy) + 'm'
                  : '精度—'
              )
            : 'なし'
        ),
      '経路記録: ' + (a.trailCount || 0) + '点',
      'Traccar受信: ' + document.getElementById('diagReceive').textContent,
      '神輿現在位置への反映: ' + document.getElementById('diagReflect').textContent
    ];

    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      setCopyMessage('診断情報をコピーしました。', false);
    } catch (e) {
      setCopyMessage('コピーできませんでした。', true);
    }
  }

  function setCopyMessage(text, error) {
    const el = document.getElementById('copyMessage');
    el.className = 'message' + (error ? ' error' : '');
    el.textContent = text;
  }

  function ingestResultLabel(v) {
    const labels = {
      saved: '受信済み／神輿現在位置に反映',
      ignored_session_inactive: '受信済み／神輿現在位置には反映せず（巡行停止中）',
      ignored_simulation_active: '受信済み／神輿現在位置には反映せず（シミュレーション中）',
      unauthorized: '受信したが書き込みキー不一致',
      invalid_location: '受信したが位置情報不正'
    };

    return labels[v] || String(v || '—');
  }

  function sourceLabel(v) {
    if (v === 'gps') return '実GPS';
    if (v === 'simulation') return 'シミュレーション';
    if (v === 'default') return '赤城神社（初期位置）';
    return String(v || '不明');
  }

  function setText(id, text, cls) {
    const el = document.getElementById(id);
    el.textContent = text;
    el.className = cls || '';
  }

  function setValue(id, text, cls) {
    const el = document.getElementById(id);
    el.textContent = text;
    el.className = 'value ' + (cls || 'neutral');
  }

  function fmtCoord(lat, lon) {
    if (!isFiniteNumber(lat) || !isFiniteNumber(lon)) return '—';

    return Number(lat).toFixed(6) + ', ' + Number(lon).toFixed(6);
  }

  function isFiniteNumber(v) {
    return Number.isFinite(Number(v));
  }

  function ageText(value) {
    if (!value) return '—';
    const s = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));

    if (s < 60) return s + '秒前';
    if (s < 3600) return Math.floor(s / 60) + '分' + (s % 60) + '秒前';
    return Math.floor(s / 3600) + '時間' + Math.floor((s % 3600) / 60) + '分前';
  }

  function jpTime(value) {
    if (!value) return '—';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '—';

    return d.toLocaleString(
      'ja-JP',
      {
        timeZone: 'Asia/Tokyo',
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      }
    );
  }

  function shortTime(value) {
    if (!value) return '—';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '—';

    return d.toLocaleTimeString(
      'ja-JP',
      {
        timeZone: 'Asia/Tokyo',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      }
    );
  }

  function distanceMeters(a, b) {
    const R = 6371000;
    const toRad = Math.PI / 180;
    const p1 = a[0] * toRad;
    const p2 = b[0] * toRad;
    const dp = (b[0] - a[0]) * toRad;
    const dl = (b[1] - a[1]) * toRad;

    const h =
      Math.sin(dp / 2) ** 2 +
      Math.cos(p1) *
      Math.cos(p2) *
      Math.sin(dl / 2) ** 2;

    return 2 * R * Math.asin(Math.sqrt(h));
  }

  function callAdmin(action) {
    return jsonp({
      mode: 'admin',
      action: action,
      token: token
    });
  }

  function jsonp(params) {
    return new Promise((resolve, reject) => {
      const cb =
        '__mikoshiDebug_' +
        Date.now() +
        '_' +
        (++seq);

      let script = document.createElement('script');

      const timer = setTimeout(
        () => {
          cleanup();
          reject(new Error('timeout'));
        },
        10000
      );

      function cleanup() {
        clearTimeout(timer);

        if (script.parentNode) {
          script.parentNode.removeChild(script);
        }

        try {
          delete window[cb];
        } catch (e) {
          window[cb] = undefined;
        }
      }

      window[cb] = data => {
        cleanup();
        resolve(data);
      };

      const q = new URLSearchParams({
        ...params,
        callback: cb,
        _: String(Date.now())
      });

      script.src =
        window.MIKOSHI_API_URL +
        '?' +
        q.toString();

      script.async = true;

      script.onerror = () => {
        cleanup();
        reject(new Error('network'));
      };

      document.body.appendChild(script);
    });
  }

  async function sha256Hex(text) {
    const bytes = new TextEncoder().encode(text);
    const digest = await crypto.subtle.digest('SHA-256', bytes);

    return Array.from(new Uint8Array(digest))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }

  function clearSession() {
    token = '';
    sessionStorage.removeItem('mikoshiAdminToken');
  }

  function esc(v) {
    return String(v)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  boot().catch(err => {
    console.error(err);
    document.body.innerHTML =
      '<div style="padding:16px;font-family:Meiryo,sans-serif">診断画面を読み込めませんでした。ページを再読み込みしてください。</div>';
  });
})();