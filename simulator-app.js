(() => {
  const VERSION = '9';
  const SAMPLE_SPACING_M = 30;

  let token = sessionStorage.getItem('mikoshiAdminToken') || '';
  let routeData = null;
  let samples = [];
  let index = 0;
  let running = false;
  let paused = false;
  let stopRequested = false;
  let callbackSeq = 0;
  let busy = false;
  let serverSimulationActive = false;
  let observerTimer = null;
  let observerMode = false;

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
      loadCss('./simulator-style.css?v=' + VERSION),
      loadJs('./config.js?v=' + VERSION),
      loadJs('./route-data.js?v=' + VERSION)
    ]);

    routeData = window.MIKOSHI_ROUTE_DATA;

    if (
      !window.MIKOSHI_API_URL ||
      !window.MIKOSHI_API_URL.endsWith('/exec') ||
      !routeData
    ) {
      document.body.innerHTML =
        '<div class="wrap"><div class="card">' +
        '<div class="title-row"><h1>神輿位置 シミュレーション</h1><span class="version-badge">RC3-D2.1</span></div>' +
        '<div class="message error">設定ファイルを読み込めませんでした。</div>' +
        '</div></div>';
      return;
    }

    render();
    updatePlan();

    if (token) {
      try {
        const r = await adminCall('status');

        if (r.ok) {
          showControl();
          updateServerState(r.state);
          restoreServerSimulationState(r.state);
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
          <div class="title-row"><h1>神輿位置 シミュレーション</h1><span class="version-badge">RC3-D2.1</span></div>
          <div class="warning">
            このツールは予定巡行路に沿ったダミーGPSを送信します。
            シミュレーション中は一般向け地図にもテスト位置が表示され、
            実機Traccarから届く位置は保存しません。
          </div>

          <div id="loginBox">
            <label for="password">管理用パスワード</label>
            <input id="password" type="password" autocomplete="current-password">
            <button id="loginBtn" class="primary">シミュレーション画面を開く</button>
            <div id="loginMessage"></div>
          </div>

          <div id="controlBox" class="hidden">
            <div id="observerBox" class="observer-box hidden" aria-live="polite">
              <div class="observer-kicker">別端末でシミュレーション中</div>
              <div class="observer-title" id="observerTitle">進行状況を確認しています…</div>
              <div class="observer-progress">
                <div><strong>テスト範囲</strong><span id="observerRange">—</span></div>
                <div><strong>進行</strong><span id="observerProgress">—</span></div>
                <div><strong>状態</strong><span id="observerStatus">—</span></div>
                <div><strong>最終更新</strong><span id="observerUpdated">—</span></div>
              </div>
              <div class="progress"><div id="observerBar"></div></div>
              <div class="stack" style="margin-top:12px">
                <button id="observerMapBtn" class="outline">テスト用地図を開く（2秒更新）</button>
                <button id="observerEndBtn" class="danger">テスト終了・初期化</button>
              </div>
              <div class="observer-note">
                この端末は進行状況の確認用です。ダミーGPSの送信は、最初にテストを開始した端末だけが行います。
              </div>
            </div>

            <div id="recoveryBox" class="recovery-box hidden" role="alert" aria-live="assertive">
              <div class="recovery-kicker">要 初 期 化</div>
              <div class="recovery-title">前回のシミュレーションデータが残っています</div>
              <div class="recovery-text">
                サーバーではシミュレーション状態が継続しています。
                新しいテストを始める前に、下のボタンでテストデータを消去し、
                赤城神社の初期位置へ戻してください。
              </div>
              <div class="recovery-state">現在：サーバー上にテストデータあり</div>
              <button id="recoveryEndBtn" class="danger recovery-action">テスト終了・初期化</button>
              <div class="recovery-note">この操作で、位置表示・通過記録・シミュレーション状態を整理します。</div>
            </div>

            <div id="setupBox">
              <div class="field">
                <label for="rangeSelect">テスト範囲</label>
                <select id="rangeSelect">
                  <option value="all">全巡行路</option>
                  <option value="1">第1区間：赤城神社 → 赤城福祉会館</option>
                  <option value="2">第2区間：赤城福祉会館 → 大塚クリーニング前</option>
                  <option value="3">第3区間：大塚クリーニング前 → イトーヨーカ堂前</option>
                  <option value="4">第4区間：イトーヨーカ堂前 → 赤城神社</option>
                </select>
              </div>

              <div class="field">
                <label for="intervalSelect">ダミー位置の送信間隔</label>
                <select id="intervalSelect">
                  <option value="500">0.5秒（最速）</option>
                  <option value="1000">1秒（高速）</option>
                  <option value="2000" selected>2秒（標準）</option>
                  <option value="5000">5秒</option>
                </select>
              </div>

              <div class="metrics">
                <div class="metric"><strong>ダミー位置数</strong><span id="pointCount">—</span></div>
                <div class="metric"><strong>予定所要時間</strong><span id="duration">—</span></div>
              </div>

              <div style="margin-top:12px" class="stack">
                <button id="mapBtn" class="outline">テスト用地図を開く（2秒更新）</button>
                <button id="startBtn" class="safe">テスト開始</button>
              </div>
            </div>

            <div id="runningBox" class="hidden" style="margin-top:14px">
              <div id="status" class="status">待機中</div>
              <div class="progress"><div id="bar"></div></div>
              <div class="metrics">
                <div class="metric"><strong>進行</strong><span id="progressText">0 / 0</span></div>
                <div class="metric"><strong>現在の模擬位置</strong><span id="currentPos">—</span></div>
              </div>

              <div class="row" style="margin-top:12px">
                <button id="pauseBtn">一時停止</button>
                <button id="endBtn" class="danger">テスト終了・初期化</button>
              </div>
            </div>

            <div id="serverState" class="status" style="margin-top:12px"></div>
            <div id="message"></div>
          </div>
        </div>

        <div class="footer">
          テスト終了後は必ず「テスト終了・初期化」を実行してください。
        </div>
      </div>
    `;

    document.getElementById('loginBtn').onclick = login;
    document.getElementById('password').onkeydown = e => {
      if (e.key === 'Enter') login();
    };

    document.getElementById('rangeSelect').onchange = updatePlan;
    document.getElementById('intervalSelect').onchange = updatePlan;

    document.getElementById('mapBtn').onclick = () => {
      window.open('./?test=1', '_blank', 'noopener');
    };

    document.getElementById('startBtn').onclick = startSimulation;
    document.getElementById('pauseBtn').onclick = togglePause;
    document.getElementById('endBtn').onclick = endSimulation;
    document.getElementById('recoveryEndBtn').onclick = endSimulation;
    document.getElementById('observerEndBtn').onclick = endSimulation;
    document.getElementById('observerMapBtn').onclick = () => {
      window.open('./?test=1', '_blank', 'noopener');
    };
  }

  function showLogin() {
    document.getElementById('loginBox').classList.remove('hidden');
    document.getElementById('controlBox').classList.add('hidden');
  }

  function showControl() {
    document.getElementById('loginBox').classList.add('hidden');
    document.getElementById('controlBox').classList.remove('hidden');
  }

  async function login() {
    if (busy) return;

    const passwordBox =
      document.getElementById('password');
    const loginBtn =
      document.getElementById('loginBtn');

    const password = passwordBox.value;

    if (!password) {
      loginMessage(
        'パスワードを入力してください。',
        true
      );
      passwordBox.focus();
      return;
    }

    loginMessage('パスワードを確認しています…', false);
    busy = true;
    passwordBox.disabled = true;
    loginBtn.disabled = true;
    loginBtn.textContent = '確認しています…';

    try {
      const challenge = await jsonp({
        mode: 'adminChallenge'
      });

      if (!challenge.ok || !challenge.nonce) {
        throw new Error('challenge');
      }

      const proof = await sha256Hex(
        challenge.nonce + ':' + password
      );

      const r = await jsonp({
        mode: 'adminLogin',
        nonce: challenge.nonce,
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

      showControl();
      updateServerState(r.state);
      restoreServerSimulationState(r.state);

      // 認証成功後、非表示になった入力欄だけ消去。
      passwordBox.value = '';
    } catch (e) {
      loginMessage(
        e.message === 'password'
          ? 'パスワードが違います。入力内容を確認してください。'
          : '認証できませんでした。通信状態を確認して、もう一度お試しください。',
        true
      );

      passwordBox.disabled = false;
      passwordBox.focus();
      passwordBox.select();
    } finally {
      busy = false;
      loginBtn.disabled = false;
      loginBtn.textContent =
        'シミュレーション画面を開く';
      passwordBox.disabled = false;
    }
  }

  function updatePlan() {
    if (!routeData) return;

    samples = buildSamples(
      document.getElementById('rangeSelect')
        ? document.getElementById('rangeSelect').value
        : 'all'
    );

    const interval =
      Number(
        document.getElementById('intervalSelect')
          ? document.getElementById('intervalSelect').value
          : 1000
      );

    const sec =
      Math.ceil(
        Math.max(0, samples.length - 1) *
        interval /
        1000
      );

    const count = document.getElementById('pointCount');
    const duration = document.getElementById('duration');

    if (count) count.textContent = samples.length + '点';
    if (duration) duration.textContent = formatDuration(sec);
  }

  function buildSamples(range) {
    const selected =
      range === 'all'
        ? routeData.segments
        : routeData.segments.filter(
            s => String(s.id) === String(range)
          );

    const result = [];

    selected.forEach(segment => {
      const part = resample(
        segment.coordinates,
        SAMPLE_SPACING_M
      );

      part.forEach(point => {
        const last = result[result.length - 1];

        if (
          !last ||
          distanceMeters(last, point) > 2
        ) {
          result.push(point);
        }
      });
    });

    return result;
  }

  function resample(coords, spacing) {
    if (!Array.isArray(coords) || coords.length < 2) {
      return [];
    }

    const cumulative = [0];

    for (let i = 1; i < coords.length; i++) {
      cumulative.push(
        cumulative[i - 1] +
        distanceMeters(coords[i - 1], coords[i])
      );
    }

    const total = cumulative[cumulative.length - 1];
    const result = [];

    for (let d = 0; d < total; d += spacing) {
      result.push(pointAtDistance(coords, cumulative, d));
    }

    result.push([
      Number(coords[coords.length - 1][0]),
      Number(coords[coords.length - 1][1])
    ]);

    return result;
  }

  function pointAtDistance(coords, cumulative, distance) {
    let i = 1;

    while (
      i < cumulative.length &&
      cumulative[i] < distance
    ) {
      i++;
    }

    if (i >= cumulative.length) {
      return [
        Number(coords[coords.length - 1][0]),
        Number(coords[coords.length - 1][1])
      ];
    }

    const start = cumulative[i - 1];
    const end = cumulative[i];
    const ratio =
      end > start
        ? (distance - start) / (end - start)
        : 0;

    const a = coords[i - 1];
    const b = coords[i];

    return [
      Number(a[0]) + (Number(b[0]) - Number(a[0])) * ratio,
      Number(a[1]) + (Number(b[1]) - Number(a[1])) * ratio
    ];
  }

  async function startSimulation() {
    if (running || busy) return;

    updatePlan();

    if (!samples.length) {
      message('ダミー位置を生成できませんでした。', true);
      return;
    }

    if (
      !confirm(
        'シミュレーションを開始します。\n\n' +
        '現在の位置履歴を初期化し、一般向け地図にテスト位置を表示します。' +
        'シミュレーション中は実機Traccarの位置は保存しません。\n\n' +
        '開始してよろしいですか？'
      )
    ) {
      return;
    }

    busy = true;
    setPreStartBusy(true);

    try {
      const rangeSelect =
        document.getElementById('rangeSelect');
      const intervalSelect =
        document.getElementById('intervalSelect');

      const r = await adminCall(
        'simulateStart',
        {
          range: rangeSelect.value,
          rangeLabel:
            rangeSelect.options[
              rangeSelect.selectedIndex
            ].textContent,
          totalPoints: samples.length,
          intervalMs: Number(intervalSelect.value),
          startLat:
            samples.length
              ? Number(samples[0][0]).toFixed(7)
              : '',
          startLon:
            samples.length
              ? Number(samples[0][1]).toFixed(7)
              : ''
        }
      );

      if (!r.ok) {
        throw new Error(r.error || 'start_failed');
      }

      updateServerState(r.state);

      index = 0;
      stopRequested = false;
      paused = false;
      running = true;
      serverSimulationActive = true;

      document.getElementById('runningBox')
        .classList.remove('hidden');

      document.getElementById('pauseBtn')
        .textContent = '一時停止';

      applyRunningControls();
      runLoop();
    } catch (e) {
      message('シミュレーションを開始できませんでした。', true);
      setPreStartBusy(false);
      applyIdleControls();
    } finally {
      busy = false;
    }
  }

  async function runLoop() {
    const interval = Number(
      document.getElementById('intervalSelect').value
    );

    while (
      running &&
      !stopRequested &&
      index < samples.length
    ) {
      if (paused) {
        await sleep(150);
        continue;
      }

      const point = samples[index];
      const started = performance.now();

      try {
        const r = await adminCall(
          'simulatePoint',
          {
            lat: point[0].toFixed(7),
            lon: point[1].toFixed(7),
            pointIndex: index + 1,
            totalPoints: samples.length
          }
        );

        if (!r.ok) {
          throw new Error(
            r.error || 'point_failed'
          );
        }

        index++;
        updateProgress(point);

        if (r.state) {
          updateServerState(r.state);
        }

        // 10点ごとにだけ状態確認を行い、高頻度のサーバー負荷を抑える。
        if (
          index % 10 === 0 ||
          index === samples.length
        ) {
          try {
            const statusResult = await adminCall('status');
            if (statusResult.ok) {
              updateServerState(statusResult.state);
            }
          } catch (statusError) {
            // 位置送信自体が成功している場合は、表示用状態確認の失敗では止めない。
          }
        }
      } catch (e) {
        if (e.message === 'simulation_not_active') {
          running = false;
          paused = false;
          serverSimulationActive = false;

          if (typeof applyRecoveryControls === 'function') {
            applyRecoveryControls();
          } else {
            document.getElementById('pauseBtn').disabled = true;
            document.getElementById('endBtn').disabled = false;
          }

          setStatus(
            '管理画面などからシミュレーションが停止されました。送信は再開できません。「テスト終了・初期化」を押して画面をリセットしてください。',
            'paused'
          );

          message(
            'サーバー側ではシミュレーションが停止済みです。',
            false
          );
          break;
        }

        paused = true;
        document.getElementById('pauseBtn')
          .textContent = '再開する';

        setStatus(
          '位置送信に失敗したため一時停止しました。通信状態を確認して再開してください。',
          'paused'
        );

        message('位置送信エラー: ' + e.message, true);
        continue;
      }

      const elapsed = performance.now() - started;
      await sleep(Math.max(0, interval - elapsed));
    }

    if (
      running &&
      !stopRequested &&
      index >= samples.length
    ) {
      running = false;
      paused = false;
      serverSimulationActive = true;

      applyCompletedControls();

      adminCall(
        'simulateState',
        { simState: 'completed' }
      ).catch(() => {});

      setStatus(
        '全てのダミー位置を送信しました。地図を確認後、必ず「テスト終了・初期化」を押してください。',
        'paused'
      );
    }
  }

  function togglePause() {
    if (!running) return;

    paused = !paused;

    document.getElementById('pauseBtn').textContent =
      paused ? '再開する' : '一時停止';

    setStatus(
      paused
        ? '一時停止中です。'
        : 'シミュレーション中です。',
      paused ? 'paused' : 'running'
    );

    adminCall(
      'simulateState',
      {
        simState: paused ? 'paused' : 'running'
      }
    ).catch(() => {});
  }

  async function endSimulation() {
    if (
      !confirm(
        'シミュレーションを終了し、位置表示・通過記録を初期化します。\n\nよろしいですか？'
      )
    ) {
      return;
    }

    stopRequested = true;
    running = false;
    paused = false;

    setEndingBusy(true);

    try {
      const r = await adminCall('simulateEnd');

      if (!r.ok) {
        throw new Error(r.error || 'end_failed');
      }

      serverSimulationActive = false;
      observerMode = false;
      stopObserverPolling_();
      updateServerState(r.state);

      index = 0;
      document.getElementById('bar').style.width = '0%';
      document.getElementById('progressText').textContent =
        '0 / ' + samples.length;
      document.getElementById('currentPos').textContent = '—';
      document.getElementById('runningBox')
        .classList.add('hidden');

      const recoveryBox =
        document.getElementById('recoveryBox');

      if (recoveryBox) {
        recoveryBox.classList.add('hidden');
      }

      applyIdleControls();

      message('テストを終了し、通過記録を消去して赤城神社の初期位置へ戻しました。', false);
    } catch (e) {
      serverSimulationActive = true;
      applyRecoveryControls();
      message(
        '終了処理に失敗しました。通信状態を確認して、もう一度「テスト終了・初期化」を押してください。',
        true
      );
    } finally {
      setEndingBusy(false);
    }
  }

  function updateProgress(point) {
    const pct =
      samples.length
        ? Math.min(100, index / samples.length * 100)
        : 0;

    document.getElementById('bar').style.width =
      pct.toFixed(1) + '%';

    document.getElementById('progressText').textContent =
      index + ' / ' + samples.length;

    document.getElementById('currentPos').textContent =
      point[0].toFixed(5) + ', ' +
      point[1].toFixed(5);

    setStatus('シミュレーション中です。', 'running');
  }

  function updateServerState(state) {
    const el = document.getElementById('serverState');
    if (!el || !state) return;

    serverSimulationActive =
      state.sessionMode === 'simulation';

    let text = '';

    if (state.sessionMode === 'simulation') {
      text += 'サーバー状態：シミュレーション中';
    } else if (state.isSessionActive) {
      text += 'サーバー状態：通常のGPS記録中';
    } else {
      text += 'サーバー状態：記録停止中';
    }

    text += '\n神輿位置表示：' +
      (state.isPublic ? '表示中' : '非表示');

    text += '\n通過記録：' +
      Number(state.trailCount || 0) + '点';

    el.textContent = text;
    el.style.whiteSpace = 'pre-line';
  }

  function setStatus(text, state) {
    const el = document.getElementById('status');
    if (!el) return;

    el.className = 'status' +
      (state ? ' ' + state : '');
    el.textContent = text;
  }

  function setPreStartBusy(value) {
    [
      'rangeSelect',
      'intervalSelect',
      'mapBtn',
      'startBtn',
      'pauseBtn',
      'endBtn'
    ].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.disabled = value;
    });
  }

  function setEndingBusy(value) {
    [
      'rangeSelect',
      'intervalSelect',
      'mapBtn',
      'startBtn',
      'pauseBtn',
      'endBtn',
      'recoveryEndBtn',
      'observerEndBtn'
    ].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.disabled = value;
    });

    if (!value) {
      if (serverSimulationActive) {
        applyRecoveryControls();
      } else {
        applyIdleControls();
      }
    }
  }

  function applyIdleControls() {
    stopObserverPolling_();
    observerMode = false;

    const observerBox =
      document.getElementById('observerBox');

    if (observerBox) {
      observerBox.classList.add('hidden');
    }

    const recoveryBox =
      document.getElementById('recoveryBox');
    const setupBox =
      document.getElementById('setupBox');

    if (recoveryBox) {
      recoveryBox.classList.add('hidden');
    }

    if (setupBox) {
      setupBox.classList.remove('hidden');
    }

    const range = document.getElementById('rangeSelect');
    const interval = document.getElementById('intervalSelect');
    const mapBtn = document.getElementById('mapBtn');
    const startBtn = document.getElementById('startBtn');
    const pauseBtn = document.getElementById('pauseBtn');
    const endBtn = document.getElementById('endBtn');

    if (range) range.disabled = false;
    if (interval) interval.disabled = false;
    if (mapBtn) mapBtn.disabled = false;
    if (startBtn) startBtn.disabled = false;
    if (pauseBtn) pauseBtn.disabled = true;
    if (endBtn) endBtn.disabled = true;
  }

  function applyRunningControls() {
    stopObserverPolling_();
    observerMode = false;

    const observerBox =
      document.getElementById('observerBox');

    if (observerBox) {
      observerBox.classList.add('hidden');
    }

    const range = document.getElementById('rangeSelect');
    const interval = document.getElementById('intervalSelect');
    const mapBtn = document.getElementById('mapBtn');
    const startBtn = document.getElementById('startBtn');
    const pauseBtn = document.getElementById('pauseBtn');
    const endBtn = document.getElementById('endBtn');

    if (range) range.disabled = true;
    if (interval) interval.disabled = true;
    if (mapBtn) mapBtn.disabled = false;
    if (startBtn) startBtn.disabled = true;
    if (pauseBtn) pauseBtn.disabled = false;
    if (endBtn) endBtn.disabled = false;
  }

  function applyCompletedControls() {
    const range = document.getElementById('rangeSelect');
    const interval = document.getElementById('intervalSelect');
    const mapBtn = document.getElementById('mapBtn');
    const startBtn = document.getElementById('startBtn');
    const pauseBtn = document.getElementById('pauseBtn');
    const endBtn = document.getElementById('endBtn');

    if (range) range.disabled = true;
    if (interval) interval.disabled = true;
    if (mapBtn) mapBtn.disabled = false;
    if (startBtn) startBtn.disabled = true;
    if (pauseBtn) pauseBtn.disabled = true;
    if (endBtn) endBtn.disabled = false;
  }

  function applyRecoveryControls() {
    stopObserverPolling_();
    observerMode = false;

    const observerBox =
      document.getElementById('observerBox');

    if (observerBox) {
      observerBox.classList.add('hidden');
    }

    const recoveryBox =
      document.getElementById('recoveryBox');
    const setupBox =
      document.getElementById('setupBox');
    const runningBox =
      document.getElementById('runningBox');

    if (recoveryBox) {
      recoveryBox.classList.remove('hidden');
    }

    if (setupBox) {
      setupBox.classList.add('hidden');
    }

    if (runningBox) {
      runningBox.classList.add('hidden');
    }

    const range = document.getElementById('rangeSelect');
    const interval = document.getElementById('intervalSelect');
    const mapBtn = document.getElementById('mapBtn');
    const startBtn = document.getElementById('startBtn');
    const pauseBtn = document.getElementById('pauseBtn');
    const endBtn = document.getElementById('endBtn');

    if (range) range.disabled = true;
    if (interval) interval.disabled = true;
    if (mapBtn) mapBtn.disabled = false;
    if (startBtn) startBtn.disabled = true;
    if (pauseBtn) pauseBtn.disabled = true;
    if (endBtn) endBtn.disabled = false;

    const recoveryEndBtn =
      document.getElementById('recoveryEndBtn');

    if (recoveryEndBtn) {
      recoveryEndBtn.disabled = false;
    }
  }

  function restoreServerSimulationState(state) {
    if (!state || state.sessionMode !== 'simulation') {
      serverSimulationActive = false;
      applyIdleControls();
      return;
    }

    serverSimulationActive = true;
    running = false;
    paused = false;
    stopRequested = false;

    if (
      state.simulation &&
      state.simulation.active
    ) {
      applyObserverControls_(state);
      return;
    }

    // 旧版等で進行情報がない場合は安全側に倒し、
    // 専用の初期化画面を表示する。
    applyRecoveryControls();
  }

  function applyObserverControls_(state) {
    observerMode = true;

    const observerBox =
      document.getElementById('observerBox');
    const recoveryBox =
      document.getElementById('recoveryBox');
    const setupBox =
      document.getElementById('setupBox');
    const runningBox =
      document.getElementById('runningBox');

    if (observerBox) {
      observerBox.classList.remove('hidden');
    }

    if (recoveryBox) {
      recoveryBox.classList.add('hidden');
    }

    if (setupBox) {
      setupBox.classList.add('hidden');
    }

    if (runningBox) {
      runningBox.classList.add('hidden');
    }

    updateObserver_(state);
    startObserverPolling_();
  }

  function updateObserver_(state) {
    const simState =
      state && state.simulation
        ? state.simulation
        : null;

    if (!simState) return;

    const total =
      Math.max(
        0,
        Number(simState.totalPoints) || 0
      );

    const sent =
      Math.max(
        0,
        Number(simState.sentPoints) || 0
      );

    const pct =
      total > 0
        ? Math.min(100, sent / total * 100)
        : 0;

    const statusMap = {
      running: '実行中',
      paused: '一時停止中',
      completed: '送信完了・初期化待ち'
    };

    document.getElementById('observerRange')
      .textContent =
      simState.rangeLabel || '—';

    document.getElementById('observerProgress')
      .textContent =
      total > 0
        ? sent + ' / ' + total + '地点'
        : sent + '地点';

    document.getElementById('observerStatus')
      .textContent =
      statusMap[simState.status] ||
      simState.status ||
      '確認中';

    document.getElementById('observerUpdated')
      .textContent =
      formatServerTime_(simState.updatedAt);

    document.getElementById('observerBar')
      .style.width =
      pct.toFixed(1) + '%';

    const title =
      document.getElementById('observerTitle');

    if (title) {
      title.textContent =
        simState.status === 'completed'
          ? 'ダミーGPSの送信は完了しています'
          : '別の端末からダミーGPSを送信しています';
    }
  }

  function startObserverPolling_() {
    stopObserverPolling_();

    observerTimer = setInterval(
      async () => {
        if (!observerMode) return;

        try {
          const r = await adminCall('status');

          if (!r.ok || !r.state) {
            return;
          }

          updateServerState(r.state);

          if (
            r.state.sessionMode !== 'simulation'
          ) {
            serverSimulationActive = false;
            applyIdleControls();
            message(
              'シミュレーションは終了しました。',
              false
            );
            return;
          }

          if (
            r.state.simulation &&
            r.state.simulation.active
          ) {
            updateObserver_(r.state);
          }
        } catch (e) {
          // 監視表示は一時的な通信失敗では消さない。
        }
      },
      2500
    );
  }

  function stopObserverPolling_() {
    if (observerTimer) {
      clearInterval(observerTimer);
      observerTimer = null;
    }
  }

  function formatServerTime_(value) {
    if (!value) return '—';

    const d = new Date(value);

    if (Number.isNaN(d.getTime())) {
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

  function message(text, error) {
    const el = document.getElementById('message');
    if (!el) return;

    el.className =
      'message' + (error ? ' error' : '');
    el.textContent = text;
  }

  function loginMessage(text, error) {
    const el = document.getElementById('loginMessage');
    if (!el) return;

    el.className =
      'message' + (error ? ' error' : '');
    el.textContent = text;
  }

  async function adminCall(action, extra) {
    const params = {
      mode: 'admin',
      action: action,
      token: token,
      ...(extra || {})
    };

    const r = await jsonp(params);

    if (
      !r.ok &&
      r.error === 'session_expired'
    ) {
      clearSession();
      throw new Error('session_expired');
    }

    return r;
  }

  function jsonp(params) {
    return new Promise((resolve, reject) => {
      const name =
        '__mikoshiSim_' +
        Date.now() +
        '_' +
        (++callbackSeq);

      let script =
        document.createElement('script');

      const timer = setTimeout(() => {
        cleanup();
        reject(new Error('timeout'));
      }, 12000);

      function cleanup() {
        clearTimeout(timer);

        if (
          script &&
          script.parentNode
        ) {
          script.parentNode.removeChild(script);
        }

        try {
          delete window[name];
        } catch (e) {
          window[name] = undefined;
        }
      }

      window[name] = data => {
        cleanup();
        resolve(data);
      };

      const q = new URLSearchParams({
        ...params,
        callback: name,
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
    const bytes =
      new TextEncoder().encode(text);

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
          b.toString(16).padStart(2, '0')
      )
      .join('');
  }

  function clearSession() {
    token = '';
    sessionStorage.removeItem('mikoshiAdminToken');
  }

  function distanceMeters(a, b) {
    const R = 6371000;
    const toRad = Math.PI / 180;

    const p1 = a[0] * toRad;
    const p2 = b[0] * toRad;
    const dp = (b[0] - a[0]) * toRad;
    const dl = (b[1] - a[1]) * toRad;

    const x =
      Math.sin(dp / 2) * Math.sin(dp / 2) +
      Math.cos(p1) *
      Math.cos(p2) *
      Math.sin(dl / 2) *
      Math.sin(dl / 2);

    return 2 * R * Math.asin(Math.sqrt(x));
  }

  function formatDuration(sec) {
    if (sec < 60) {
      return sec + '秒';
    }

    const m = Math.floor(sec / 60);
    const s = sec % 60;

    return s
      ? m + '分' + s + '秒'
      : m + '分';
  }

  function sleep(ms) {
    return new Promise(
      resolve => setTimeout(resolve, ms)
    );
  }

  window.addEventListener('beforeunload', event => {
    if (running || serverSimulationActive) {
      event.preventDefault();
      event.returnValue = '';
    }
  });

  boot().catch(err => {
    console.error(err);

    document.body.innerHTML =
      '<div style="padding:16px;font-family:Meiryo,sans-serif">' +
      'シミュレーション画面を読み込めませんでした。' +
      '</div>';
  });
})();
