(() => {
  const VERSION = '1';
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
  let latestMarker = null;
  let nearestMarker = null;
  let connector = null;
  let historyLayer = null;
  let lastDebug = null;
  let lastLatency = null;

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
      loadCss('./debug-style.css?v=' + VERSION),
      loadJs('./config.js?v=' + VERSION),
      loadCss(LEAFLET_CSS),
      loadJs(LEAFLET_JS),
      loadJs('./route-data.js?v=' + VERSION)
    ]);

    render();

    if (token) {
      try {
        const r = await callAdmin('debugStatus');
        if (r.ok && r.debug) {
          showDebug();
          applyDebug(r.debug);
          startPolling();
          return;
        }
      } catch (e) {}
      clearSession();
    }

    showLogin();
  }

  function render() {
    document.body.innerHTML = `
      <div class="wrap">
        <div class="card">
          <h1>赤城神社 神輿位置 診断</h1>
          <div class="muted">
            管理者向けの読み取り専用画面です。ここから巡行状態や位置情報を変更する操作は行いません。
          </div>

          <div id="loginBox">
            <label for="password">管理用パスワード</label>
            <input id="password" type="password" autocomplete="current-password">
            <button id="loginBtn" class="primary">診断画面を開く</button>
            <div id="loginMessage"></div>
          </div>
        </div>

        <div id="debugBox" class="hidden">
          <div class="card">
            <h2>現在の診断</h2>
            <div id="diagnosis" class="diagnosis neutral">確認中です…</div>
          </div>

          <div class="card">
            <h2>主要状態</h2>
            <div class="summary">
              <div class="tile"><div class="label">サーバー通信</div><div id="apiStatus" class="value">—</div></div>
              <div class="tile"><div class="label">巡行状態</div><div id="sessionStatus" class="value">—</div></div>
              <div class="tile"><div class="label">神輿位置の公開</div><div id="publicStatus" class="value">—</div></div>
              <div class="tile"><div class="label">最後のTraccar到達</div><div id="ingestStatus" class="value">—</div></div>
            </div>
          </div>

          <div class="card">
            <h2>Traccar → GAS</h2>
            <table class="kv">
              <tr><th>最終到達時刻</th><td id="ingestTime">—</td></tr>
              <tr><th>処理結果</th><td id="ingestResult">—</td></tr>
              <tr><th>受信した位置</th><td id="ingestCoords" class="mono">—</td></tr>
              <tr><th>精度</th><td id="ingestAccuracy">—</td></tr>
              <tr><th>送信方式</th><td id="ingestTransport">—</td></tr>
            </table>
            <div class="muted" style="margin-top:8px">
              Traccar Client 側で「Location filtered」や「request no fix」になった位置は、サーバーへ送信されていないため、この欄には現れません。
            </div>
          </div>

          <div class="card">
            <h2>サーバーに保存中の位置</h2>
            <table class="kv">
              <tr><th>位置の種類</th><td id="latestSource">—</td></tr>
              <tr><th>最終受信</th><td id="latestTime">—</td></tr>
              <tr><th>緯度・経度</th><td id="latestCoords" class="mono">—</td></tr>
              <tr><th>位置精度</th><td id="latestAccuracy">—</td></tr>
              <tr><th>通過履歴点数</th><td id="trailCount">—</td></tr>
              <tr><th>公開地図へ渡す位置</th><td id="publicLatest">—</td></tr>
            </table>
          </div>

          <div class="card">
            <h2>位置の確認地図</h2>
            <div id="map"></div>
            <div class="mapButtons">
              <button id="latestBtn" class="secondary">保存中の位置へ</button>
              <button id="routeBtn" class="secondary">巡行ルート全体へ</button>
            </div>
            <div id="routeDistance" class="message">予定経路との距離を計算しています…</div>
            <div class="muted">
              青い点＝サーバーに保存中の位置、赤い点＝予定経路上の最寄り位置（参考）、細線＝その距離です。予定経路から大きく離れている場合は、最寄り位置は参考表示です。
            </div>
          </div>

          <div class="card">
            <h2>最近保存したGPS位置（最大10件）</h2>
            <div style="overflow:auto">
              <table class="history">
                <thead><tr><th>時刻</th><th>精度</th><th>緯度・経度</th></tr></thead>
                <tbody id="historyBody"></tbody>
              </table>
            </div>
          </div>

          <div class="card">
            <h2>システム情報</h2>
            <table class="kv">
              <tr><th>Backend</th><td id="backendVersion">—</td></tr>
              <tr><th>公開地図</th><td>RC3改訂版 / app v8</td></tr>
              <tr><th>管理画面</th><td>admin v11</td></tr>
              <tr><th>シミュレーション</th><td>simulator v7</td></tr>
              <tr><th>サーバー時刻</th><td id="serverTime">—</td></tr>
              <tr><th>表示開始時刻</th><td id="publicSince">—</td></tr>
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
      </div>`;

    document.getElementById('loginBtn').onclick = login;
    document.getElementById('password').onkeydown =
      e => {
        if (e.key === 'Enter') login();
      };

    document.getElementById('refreshBtn').onclick =
      refreshOnce;

    document.getElementById('copyBtn').onclick =
      copyDiagnosis;

    document.getElementById('latestBtn').onclick =
      focusLatest;

    document.getElementById('routeBtn').onclick =
      fitRoute;
  }

  function showLogin() {
    document.getElementById('loginBox')
      .classList.remove('hidden');
    document.getElementById('debugBox')
      .classList.add('hidden');
  }

  function showDebug() {
    document.getElementById('loginBox')
      .classList.add('hidden');
    document.getElementById('debugBox')
      .classList.remove('hidden');

    if (!map) {
      initMap();
    }
  }

  async function login() {
    const box =
      document.getElementById('password');
    const btn =
      document.getElementById('loginBtn');
    const password = box.value;

    if (!password) {
      setLoginMessage(
        'パスワードを入力してください。',
        true
      );
      box.focus();
      return;
    }

    btn.disabled = true;
    btn.textContent = '確認しています…';
    box.disabled = true;
    setLoginMessage(
      'パスワードを確認しています…',
      false
    );

    try {
      const c = await jsonp({
        mode: 'adminChallenge'
      });

      if (!c.ok || !c.nonce) {
        throw new Error('challenge');
      }

      const proof = await sha256Hex(
        c.nonce + ':' + password
      );

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
      sessionStorage.setItem(
        'mikoshiAdminToken',
        token
      );

      box.value = '';
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
    const el =
      document.getElementById('loginMessage');

    el.className =
      'message' + (error ? ' error' : '');

    el.textContent = text;
  }

  async function refreshOnce() {
    if (!token) return;

    const started = performance.now();

    try {
      const r = await callAdmin(
        'debugStatus'
      );

      lastLatency =
        Math.round(
          performance.now() - started
        );

      if (!r.ok) {
        if (r.error === 'session_expired') {
          clearSession();
          alert(
            '管理セッションの有効期限が切れました。もう一度ログインしてください。'
          );
          location.reload();
          return;
        }

        throw new Error('failed');
      }

      lastDebug = r.debug;
      applyDebug(lastDebug);
    } catch (e) {
      document.getElementById('apiStatus')
        .textContent = '取得失敗';

      document.getElementById('apiStatus')
        .className = 'value bad';

      setDiagnosis(
        'サーバーから診断情報を取得できませんでした。通信状態を確認してください。',
        'bad'
      );
    }
  }

  function startPolling() {
    stopPolling();
    timer = setInterval(
      refreshOnce,
      5000
    );
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

    setText(
      'apiStatus',
      '正常 ' +
      (
        lastLatency !== null
          ? '（' + lastLatency + 'ms）'
          : ''
      ),
      'ok'
    );

    let sessionText =
      '停止中';

    let sessionClass =
      'neutral';

    if (
      a.isSessionActive &&
      a.sessionMode === 'real'
    ) {
      sessionText =
        '巡行中（本番GPS）';
      sessionClass = 'ok';
    } else if (
      a.isSessionActive &&
      a.sessionMode === 'simulation'
    ) {
      sessionText =
        'シミュレーション中';
      sessionClass = 'warn';
    }

    setText(
      'sessionStatus',
      sessionText,
      sessionClass
    );

    setText(
      'publicStatus',
      a.isPublic
        ? '表示中'
        : '非表示',
      a.isPublic ? 'ok' : 'neutral'
    );

    const ingestAge =
      ingest && ingest.receivedAt
        ? ageText(ingest.receivedAt)
        : 'まだ受信なし';

    setText(
      'ingestStatus',
      ingestAge,
      ingest &&
      ingest.result === 'saved'
        ? 'ok'
        : (
            ingest
              ? 'warn'
              : 'neutral'
          )
    );

    document.getElementById('ingestTime')
      .textContent =
      ingest
        ? jpTime(ingest.receivedAt) +
          '（' +
          ageText(ingest.receivedAt) +
          '）'
        : 'まだTraccarから到達していません';

    document.getElementById('ingestResult')
      .textContent =
      ingest
        ? ingestResultLabel(ingest.result)
        : '—';

    document.getElementById('ingestCoords')
      .textContent =
      ingest &&
      isFiniteNumber(ingest.lat) &&
      isFiniteNumber(ingest.lon)
        ? fmtCoord(ingest.lat, ingest.lon)
        : '—';

    document.getElementById('ingestAccuracy')
      .textContent =
      ingest &&
      isFiniteNumber(ingest.accuracy)
        ? '約' +
          Math.round(ingest.accuracy) +
          'm'
        : '—';

    document.getElementById('ingestTransport')
      .textContent =
      ingest
        ? String(
            ingest.transport || '—'
          )
        : '—';

    document.getElementById('latestSource')
      .textContent =
      latest
        ? sourceLabel(latest.source)
        : 'なし';

    document.getElementById('latestTime')
      .textContent =
      latest && latest.receivedAt
        ? jpTime(latest.receivedAt) +
          '（' +
          ageText(latest.receivedAt) +
          '）'
        : '—';

    document.getElementById('latestCoords')
      .textContent =
      latest
        ? fmtCoord(
            latest.lat,
            latest.lon
          )
        : '—';

    document.getElementById('latestAccuracy')
      .textContent =
      latest &&
      isFiniteNumber(latest.accuracy)
        ? '約' +
          Math.round(latest.accuracy) +
          'm'
        : '—';

    document.getElementById('trailCount')
      .textContent =
      String(a.trailCount || 0) +
      '点';

    document.getElementById('publicLatest')
      .textContent =
      pub.latest
        ? sourceLabel(pub.latest.source) +
          ' / ' +
          fmtCoord(
            pub.latest.lat,
            pub.latest.lon
          )
        : (
            a.isPublic
              ? '位置情報を待っています'
              : '非表示'
          );

    document.getElementById('backendVersion')
      .textContent =
      d.backendVersion || '—';

    document.getElementById('serverTime')
      .textContent =
      jpTime(d.serverTime);

    document.getElementById('publicSince')
      .textContent =
      a.publicSince
        ? jpTime(a.publicSince)
        : '—';

    updateHistory(
      d.recentHistory || []
    );

    updateMap(
      latest,
      d.recentHistory || []
    );

    evaluateDiagnosis(d);
  }

  function evaluateDiagnosis(d) {
    const a = d.admin;
    const ingest = d.lastIngest;
    const latest = a.latest;

    if (
      a.sessionMode === 'simulation'
    ) {
      setDiagnosis(
        '現在はシミュレーション中です。実機Traccarから位置が届いても保存せず無視します。本番GPSの確認をする場合は、先にシミュレーションを終了・初期化してください。',
        'warn'
      );
      return;
    }

    if (!a.isSessionActive) {
      if (
        ingest &&
        ingest.result ===
          'ignored_session_inactive'
      ) {
        setDiagnosis(
          'Traccarから位置はサーバーまで届いていますが、巡行開始前／終了後のため保存していません。実機テストをする場合は管理画面で「巡行を開始する」を押してください。',
          'warn'
        );
      } else {
        setDiagnosis(
          '現在はGPS位置の記録停止中です。実機テストを始める場合は、管理画面で「巡行を開始する」を押してください。',
          'neutral'
        );
      }
      return;
    }

    if (!ingest) {
      setDiagnosis(
        '巡行中ですが、巡行開始後にTraccarからの位置がまだサーバーへ届いていません。Traccar Clientの追跡ON、位置情報権限、通信状態を確認してください。「Location filtered」「request no fix」の位置はサーバーには届きません。',
        'warn'
      );
      return;
    }

    if (ingest.result === 'unauthorized') {
      setDiagnosis(
        'Traccarからリクエストは届いていますが、書き込みキーが一致していません。Server URLの「?key=...」を確認してください。',
        'bad'
      );
      return;
    }

    if (ingest.result === 'invalid_location') {
      setDiagnosis(
        'Traccarからリクエストは届いていますが、有効な緯度・経度として処理できませんでした。',
        'bad'
      );
      return;
    }

    if (
      ingest.result ===
        'ignored_simulation_active'
    ) {
      setDiagnosis(
        '実機Traccarから位置は届いていますが、シミュレーション中のため保存していません。先にシミュレーションを終了・初期化してください。',
        'warn'
      );
      return;
    }

    if (ingest.result === 'saved') {
      const seconds =
        ageSeconds(ingest.receivedAt);

      if (seconds <= 90) {
        setDiagnosis(
          '実機Traccarから新しい位置がサーバーへ届き、正常に保存されています。',
          'ok'
        );
      } else if (seconds <= 360) {
        setDiagnosis(
          'Traccarからの位置は正常に保存されていますが、最終到達から少し時間が空いています。停止中はハートビート300秒（5分）の設定なので、この範囲なら直ちに異常とは限りません。',
          'warn'
        );
      } else {
        setDiagnosis(
          '最後に正常保存された位置から5分以上たっています。端末が移動中なら、Traccar Clientのログ、追跡ON、位置情報権限、通信・バッテリー制限を確認してください。',
          'warn'
        );
      }
      return;
    }

    setDiagnosis(
      '状態を確認しています。',
      'neutral'
    );
  }

  function setDiagnosis(text, level) {
    const el =
      document.getElementById('diagnosis');

    el.className =
      'diagnosis ' + level;

    el.textContent = text;
  }

  function updateHistory(items) {
    const body =
      document.getElementById('historyBody');

    body.innerHTML = '';

    if (!items.length) {
      body.innerHTML =
        '<tr><td colspan="3">保存されたGPS位置はまだありません。</td></tr>';
      return;
    }

    [...items]
      .reverse()
      .forEach(x => {
        const tr =
          document.createElement('tr');

        tr.innerHTML =
          '<td>' +
          esc(shortTime(x.receivedAt)) +
          '</td>' +
          '<td>' +
          esc(
            isFiniteNumber(x.accuracy)
              ? Math.round(x.accuracy) +
                'm'
              : '—'
          ) +
          '</td>' +
          '<td class="coords mono">' +
          esc(
            fmtCoord(
              x.lat,
              x.lon
            )
          ) +
          '</td>';

        body.appendChild(tr);
      });
  }

  function initMap() {
    map = L.map('map', {
      zoomControl: true
    });

    L.tileLayer(
      'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      {
        maxZoom: 19,
        attribution:
          '&copy; OpenStreetMap contributors'
      }
    ).addTo(map);

    routeGroup =
      L.featureGroup().addTo(map);

    const data =
      window.MIKOSHI_ROUTE_DATA;

    if (
      data &&
      Array.isArray(data.segments)
    ) {
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

    setTimeout(
      () => map.invalidateSize(),
      100
    );
  }

  function updateMap(latest, history) {
    if (!map) return;

    if (latestMarker) {
      map.removeLayer(latestMarker);
      latestMarker = null;
    }

    if (nearestMarker) {
      map.removeLayer(nearestMarker);
      nearestMarker = null;
    }

    if (connector) {
      map.removeLayer(connector);
      connector = null;
    }

    if (historyLayer) {
      map.removeLayer(historyLayer);
      historyLayer = null;
    }

    if (
      Array.isArray(history) &&
      history.length > 1
    ) {
      const pts =
        history
          .filter(
            x =>
              isFiniteNumber(x.lat) &&
              isFiniteNumber(x.lon)
          )
          .map(
            x => [x.lat, x.lon]
          );

      if (pts.length > 1) {
        historyLayer =
          L.polyline(
            pts,
            {
              color: '#356f9f',
              weight: 3,
              opacity: .65
            }
          ).addTo(map);
      }
    }

    if (
      !latest ||
      !isFiniteNumber(latest.lat) ||
      !isFiniteNumber(latest.lon)
    ) {
      document.getElementById(
        'routeDistance'
      ).textContent =
        '保存中の位置がないため、予定経路との距離は計算できません。';
      return;
    }

    const raw = [
      latest.lat,
      latest.lon
    ];

    latestMarker =
      L.circleMarker(
        raw,
        {
          radius: 9,
          color: '#1f5f9b',
          weight: 3,
          fillColor: '#ffffff',
          fillOpacity: 1
        }
      )
      .addTo(map)
      .bindPopup(
        '<strong>保存中の位置</strong><br>' +
        esc(
          sourceLabel(
            latest.source
          )
        )
      );

    const nearest =
      nearestRoutePoint(
        latest.lat,
        latest.lon
      );

    if (!nearest) {
      document.getElementById(
        'routeDistance'
      ).textContent =
        '予定経路データを読み込めませんでした。';
      return;
    }

    const distance =
      nearest.distanceM;

    nearestMarker =
      L.circleMarker(
        [nearest.lat, nearest.lon],
        {
          radius: 7,
          color: '#8A2D24',
          weight: 3,
          fillColor: '#ffffff',
          fillOpacity: 1
        }
      )
      .addTo(map)
      .bindPopup(
        '<strong>予定経路上の最寄り位置（参考）</strong>'
      );

    if (distance <= 1000) {
      connector =
        L.polyline(
          [
            raw,
            [nearest.lat, nearest.lon]
          ],
          {
            color: '#777',
            weight: 2,
            opacity: .7,
            dashArray: '4 5'
          }
        ).addTo(map);
    }

    const text =
      distance < 1000
        ? '予定経路までの最短距離：約' +
          Math.round(distance) +
          'm'
        : '予定経路までの最短距離：約' +
          (distance / 1000)
            .toFixed(1) +
          'km（巡行区域外の実機テストなら正常です）';

    document.getElementById(
      'routeDistance'
    ).textContent = text;
  }

  function nearestRoutePoint(lat, lon) {
    const data =
      window.MIKOSHI_ROUTE_DATA;

    if (
      !data ||
      !Array.isArray(data.segments)
    ) {
      return null;
    }

    let best = null;

    data.segments.forEach(seg => {
      const c = seg.coordinates || [];

      for (
        let i = 0;
        i < c.length - 1;
        i++
      ) {
        const p =
          projectToSegment(
            lat,
            lon,
            c[i][0],
            c[i][1],
            c[i + 1][0],
            c[i + 1][1]
          );

        if (
          !best ||
          p.distanceM <
            best.distanceM
        ) {
          best = p;
        }
      }
    });

    return best;
  }

  function projectToSegment(
    lat,
    lon,
    lat1,
    lon1,
    lat2,
    lon2
  ) {
    const refLat =
      (
        lat +
        lat1 +
        lat2
      ) / 3 *
      Math.PI / 180;

    const mx =
      111320 *
      Math.cos(refLat);
    const my = 110540;

    const px =
      (lon - lon1) * mx;
    const py =
      (lat - lat1) * my;
    const bx =
      (lon2 - lon1) * mx;
    const by =
      (lat2 - lat1) * my;

    const len2 =
      bx * bx + by * by;

    let t =
      len2 > 0
        ? (px * bx + py * by) /
          len2
        : 0;

    t =
      Math.max(
        0,
        Math.min(1, t)
      );

    const qx = bx * t;
    const qy = by * t;

    const qLon =
      lon1 + qx / mx;
    const qLat =
      lat1 + qy / my;

    const dx = px - qx;
    const dy = py - qy;

    return {
      lat: qLat,
      lon: qLon,
      distanceM:
        Math.sqrt(
          dx * dx + dy * dy
        )
    };
  }

  function focusLatest() {
    if (
      !lastDebug ||
      !lastDebug.admin ||
      !lastDebug.admin.latest
    ) {
      return;
    }

    const x =
      lastDebug.admin.latest;

    map.setView(
      [x.lat, x.lon],
      17
    );

    latestMarker &&
      latestMarker.openPopup();
  }

  function fitRoute() {
    if (
      routeGroup &&
      routeGroup.getBounds().isValid()
    ) {
      map.fitBounds(
        routeGroup
          .getBounds()
          .pad(.06)
      );
    }
  }

  async function copyDiagnosis() {
    if (!lastDebug) return;

    const a = lastDebug.admin;
    const ingest = lastDebug.lastIngest;
    const latest = a.latest;

    const lines = [
      '赤城神社 神輿位置 診断',
      'Backend: ' +
        (lastDebug.backendVersion || '—'),
      'サーバ時刻: ' +
        jpTime(lastDebug.serverTime),
      'API応答: ' +
        (
          lastLatency !== null
            ? lastLatency + 'ms'
            : '—'
        ),
      '巡行状態: ' +
        (
          a.isSessionActive
            ? (
                a.sessionMode ===
                  'simulation'
                  ? 'シミュレーション中'
                  : '巡行中'
              )
            : '停止中'
        ),
      '公開: ' +
        (a.isPublic ? '表示中' : '非表示'),
      'Traccar最終到達: ' +
        (
          ingest
            ? jpTime(
                ingest.receivedAt
              ) +
              ' / ' +
              ingestResultLabel(
                ingest.result
              )
            : 'なし'
        ),
      '保存中位置: ' +
        (
          latest
            ? sourceLabel(
                latest.source
              ) +
              ' / ' +
              fmtCoord(
                latest.lat,
                latest.lon
              ) +
              ' / ' +
              (
                isFiniteNumber(
                  latest.accuracy
                )
                  ? '精度約' +
                    Math.round(
                      latest.accuracy
                    ) +
                    'm'
                  : '精度—'
              )
            : 'なし'
        ),
      '通過履歴: ' +
        (a.trailCount || 0) +
        '点',
      '画面診断: ' +
        document
          .getElementById('diagnosis')
          .textContent
    ];

    try {
      await navigator.clipboard.writeText(
        lines.join('\n')
      );

      setCopyMessage(
        '診断情報をコピーしました。',
        false
      );
    } catch (e) {
      setCopyMessage(
        'コピーできませんでした。',
        true
      );
    }
  }

  function setCopyMessage(text, error) {
    const el =
      document.getElementById('copyMessage');

    el.className =
      'message' + (error ? ' error' : '');

    el.textContent = text;
  }

  function ingestResultLabel(v) {
    const labels = {
      saved:
        '正常保存',
      ignored_session_inactive:
        '到達したが巡行停止中のため保存せず',
      ignored_simulation_active:
        '到達したがシミュレーション中のため保存せず',
      unauthorized:
        '書き込みキー不一致',
      invalid_location:
        '位置データ不正'
    };

    return labels[v] || String(v || '—');
  }

  function sourceLabel(v) {
    if (v === 'gps') return '実GPS';
    if (v === 'simulation') {
      return 'シミュレーション';
    }
    if (v === 'default') {
      return '赤城神社（初期位置）';
    }
    return String(v || '不明');
  }

  function setText(id, text, cls) {
    const el =
      document.getElementById(id);

    el.textContent = text;
    el.className =
      'value ' + (cls || 'neutral');
  }

  function fmtCoord(lat, lon) {
    if (
      !isFiniteNumber(lat) ||
      !isFiniteNumber(lon)
    ) {
      return '—';
    }

    return (
      Number(lat).toFixed(6) +
      ', ' +
      Number(lon).toFixed(6)
    );
  }

  function isFiniteNumber(v) {
    return Number.isFinite(
      Number(v)
    );
  }

  function ageSeconds(value) {
    const t =
      new Date(value).getTime();

    if (!Number.isFinite(t)) {
      return Infinity;
    }

    return Math.max(
      0,
      Math.floor(
        (
          Date.now() - t
        ) / 1000
      )
    );
  }

  function ageText(value) {
    const sec =
      ageSeconds(value);

    if (!Number.isFinite(sec)) {
      return '時刻不明';
    }

    if (sec < 60) {
      return sec + '秒前';
    }

    if (sec < 3600) {
      return (
        Math.floor(sec / 60) +
        '分' +
        (sec % 60) +
        '秒前'
      );
    }

    return (
      Math.floor(sec / 3600) +
      '時間' +
      Math.floor(
        (sec % 3600) / 60
      ) +
      '分前'
    );
  }

  function jpTime(value) {
    if (!value) return '—';

    const d = new Date(value);

    if (
      Number.isNaN(
        d.getTime()
      )
    ) {
      return '—';
    }

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

    if (
      Number.isNaN(
        d.getTime()
      )
    ) {
      return '—';
    }

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

  function callAdmin(action) {
    return jsonp({
      mode: 'admin',
      action: action,
      token: token
    });
  }

  function jsonp(params) {
    return new Promise(
      (resolve, reject) => {
        const cb =
          '__mikoshiDebug_' +
          Date.now() +
          '_' +
          (++seq);

        let script =
          document.createElement(
            'script'
          );

        const timer =
          setTimeout(
            () => {
              cleanup();
              reject(
                new Error(
                  'timeout'
                )
              );
            },
            10000
          );

        function cleanup() {
          clearTimeout(timer);

          if (
            script.parentNode
          ) {
            script.parentNode
              .removeChild(
                script
              );
          }

          try {
            delete window[cb];
          } catch (e) {
            window[cb] =
              undefined;
          }
        }

        window[cb] =
          data => {
            cleanup();
            resolve(data);
          };

        const q =
          new URLSearchParams({
            ...params,
            callback: cb,
            _: String(
              Date.now()
            )
          });

        script.src =
          window.MIKOSHI_API_URL +
          '?' +
          q.toString();

        script.async = true;

        script.onerror =
          () => {
            cleanup();
            reject(
              new Error(
                'network'
              )
            );
          };

        document.body
          .appendChild(script);
      }
    );
  }

  async function sha256Hex(text) {
    const bytes =
      new TextEncoder()
        .encode(text);

    const digest =
      await crypto.subtle.digest(
        'SHA-256',
        bytes
      );

    return Array.from(
      new Uint8Array(digest)
    )
      .map(
        b =>
          b
            .toString(16)
            .padStart(2, '0')
      )
      .join('');
  }

  function clearSession() {
    token = '';
    sessionStorage.removeItem(
      'mikoshiAdminToken'
    );
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