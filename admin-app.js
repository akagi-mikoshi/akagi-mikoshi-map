(() => {
  const VERSION = '14';
  let token = sessionStorage.getItem('mikoshiAdminToken') || '';
  let busy = false;
  let currentPublicState = false;
  let lastAdminState = null;
  let seq = 0;
  let noticeEditorDirty = false;

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
          <div class="title-row"><h1>赤城神社 神輿位置 管理</h1><span class="version-badge">RC3-D2.2</span></div>
          <div id="loginBox">
            <label for="password">管理用パスワード</label>
            <input id="password" type="password" autocomplete="current-password">
            <button id="loginBtn" class="primary">管理画面を開く</button>
            <div class="muted" style="margin-top:8px">パスワードはGitHubには保存しません。</div>
          </div>

          <div id="adminBox" class="hidden">
            <div class="section-label">地図上での神輿の現在位置の表示</div>
            <div id="publicStatus" class="status off"><span class="dot"></span><span>確認中</span></div>
            <div class="muted status-help">一般向けWebページ自体は公開されたままです。ここでは、地図上に神輿位置を見せるかどうかを示します。</div>
            <div id="stateInfo" class="info state-info"></div>
            <div id="recordingStatus" class="recording-status"></div>
            <div id="mainMessage"></div>
          </div>
        </div>

        <div id="controls" class="hidden">
          <div class="card">
            <h2>当日の一括操作</h2>
            <div id="operationState" class="operation-state">状態を確認しています…</div>
            <div class="gps-rule">
              GPS位置情報は、巡行中のみ神輿現在位置に反映されます。
              <button id="gpsRuleInfoBtn" class="inline-info" type="button" aria-label="説明">ⓘ</button>
            </div>
            <div class="stack">
              <button id="startBtn" class="safe">巡行を開始する</button>
              <button id="endBtn" class="danger">巡行を終了する</button>
            </div>
            <div class="operation-note">
              <div><strong>巡行を開始する：</strong>位置履歴を初期化し、追跡用スマホから届くGPS位置の記録を開始します。赤城神社を初期位置として、一般向け地図への神輿位置表示も開始します。</div>
              <div><strong>巡行を終了する：</strong>GPS位置の記録と地図上の神輿位置表示を停止し、位置履歴を消去して、位置データを赤城神社へ戻します。</div>
            </div>
          </div>

          <div class="card">
            <h2>一般向け地図へのお知らせ</h2>
            <div class="muted" style="margin-bottom:10px">
              地図を開いている利用者へ、通常は約15秒以内に反映されます。スマートフォンへのプッシュ通知ではありません。
            </div>
            <textarea id="noticeText" maxlength="160" rows="3" placeholder="例：雨天のため、巡行開始が10分程度遅れています。"></textarea>
            <div class="notice-editor-row">
              <label><input type="radio" name="noticeLevel" value="normal" checked> 通常</label>
              <label><input type="radio" name="noticeLevel" value="important"> 重要</label>
              <span id="noticeCount">0 / 160</span>
            </div>
            <div class="stack">
              <button id="noticeSetBtn" class="primary">お知らせを表示・更新</button>
              <button id="noticeClearBtn" class="outline">お知らせの表示を終了</button>
            </div>
            <div id="currentNotice" class="current-notice">現在表示中のお知らせ：なし</div>
          </div>

          <div class="card">
            <h2>神輿位置の表示（例外時の操作）</h2>
            <div class="muted" style="margin-bottom:10px">通常は「巡行を開始する」「巡行を終了する」を使用します。巡行中に一時的に地図から神輿位置を隠したい場合などに使用します。</div>
            <button id="visibilityBtn" class="outline">確認中</button>
          </div>

          <div id="simulationRecoveryCard" class="card hidden">
            <h2>シミュレーション実行中</h2>
            <div class="warning-note">シミュレーション用の位置データがサーバー上に残っています。テストを終了する場合は、ここからでも安全に初期化できます。</div>
            <button id="simulationEndBtn" class="danger" style="margin-top:12px">シミュレーションを終了・初期化</button>
          </div>

          <div class="card caution-card">
            <h2>初期化・消去</h2>
            <div class="warning-note">通常は操作しません。誤操作を防ぐため、実行前に確認画面が表示されます。</div>
            <div class="danger-stack">
              <button id="resetBtn" class="caution">神輿位置の表示・記録を停止して赤城神社へリセット</button>
              <button id="clearBtn" class="caution">位置履歴を消去</button>
            </div>
          </div>

          <div class="card">
            <h2>管理</h2>
            <div class="stack">
              <button id="refreshBtn" class="small-btn">現在の状態を再確認</button>
              <button id="manualBtn" class="small-btn">操作マニュアルを開く</button>
              <button id="debugBtn" class="small-btn">診断画面を開く</button>
              <button id="logoutBtn" class="small-btn">ログアウト</button>
            </div>
          </div>
        </div>

        <div class="footer">管理セッションはログインから12時間有効です。ブラウザやタブを閉じた場合は再ログインが必要になることがあります。<br>管理用URLは一般向けQRコードには使用しません。</div>
      </div>
      <div id="infoModal" class="modal hidden" role="dialog" aria-modal="true">
        <div class="modal-card">
          <div class="modal-head"><strong id="infoModalTitle">説明</strong><button id="infoModalClose" type="button">×</button></div>
          <div id="infoModalBody" class="modal-body"></div>
        </div>
      </div>`;

    document.getElementById('loginBtn').onclick = login;
    document.getElementById('password').onkeydown = e => { if (e.key === 'Enter') login(); };

    document.getElementById('startBtn').onclick = () =>
      confirmRun(
        '巡行を開始する',
        '位置履歴を初期化し、追跡用スマホから届くGPS位置の記録を開始します。赤城神社を初期位置として、一般向け地図への神輿位置表示も開始します。よろしいですか？',
        'start'
      );

    document.getElementById('endBtn').onclick = () =>
      confirmRun(
        '巡行を終了する',
        'GPS位置の記録と一般向け地図での神輿位置表示を停止し、位置履歴を消去して、位置データを赤城神社へ戻します。よろしいですか？',
        'end'
      );

    document.getElementById('visibilityBtn').onclick = () => {
      if (currentPublicState) {
        confirmRun(
          '神輿位置を地図に表示しない',
          '一般向け地図から神輿の現在位置を非表示にします。Webページ自体は公開されたままで、Traccarからの位置受信も続きます。よろしいですか？',
          'publicOff'
        );
      } else {
        run('publicOn', '神輿位置を地図に表示する設定にしました。');
      }
    };

    document.getElementById('simulationEndBtn').onclick = () =>
      confirmRun(
        'シミュレーションを終了・初期化',
        'シミュレーションを終了し、神輿位置を非表示にして、通過記録を消去し、赤城神社の初期位置へ戻します。よろしいですか？',
        'simulateEnd'
      );

    document.getElementById('resetBtn').onclick = () =>
      confirmRun(
        '神輿位置の表示・記録を停止して赤城神社へリセット',
        '一般向け地図の神輿位置を非表示にし、GPS位置の記録を停止します。位置履歴を消去し、保存中の位置を赤城神社へ戻します。よろしいですか？',
        'resetDefault'
      );

    document.getElementById('clearBtn').onclick = () =>
      confirmRun(
        '位置履歴を消去',
        '保存されている位置履歴を消去します。現在位置そのものは変更しません。よろしいですか？',
        'clearHistory'
      );

    document.getElementById('noticeText').addEventListener('input', () => {
      noticeEditorDirty = true;
      updateNoticeCount_();
    });

    document.getElementById('noticeSetBtn').onclick = setNotice_;
    document.getElementById('noticeClearBtn').onclick = clearNotice_;

    document.getElementById('gpsRuleInfoBtn').onclick = () => {
      openInfo_(
        'GPS位置情報の反映',
        '巡行開始前・終了後にTraccar Clientから受信した位置情報は、診断画面では確認できますが、一般向け地図の神輿現在位置には反映されません。'
      );
    };

    document.getElementById('infoModalClose').onclick = closeInfo_;
    document.getElementById('infoModal').addEventListener('click', e => {
      if (e.target.id === 'infoModal') closeInfo_();
    });

    document.getElementById('refreshBtn').onclick = refresh;
    document.getElementById('manualBtn').onclick = () => {
      window.open('./manual.html', '_blank');
    };
    document.getElementById('debugBtn').onclick = () => {
      window.open('./debug.html', '_blank');
    };
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

    const passwordBox = document.getElementById('password');
    const loginBtn = document.getElementById('loginBtn');
    const password = passwordBox.value;

    if (!password) {
      loginMessage('パスワードを入力してください。');
      passwordBox.focus();
      return;
    }

    clearLoginMessage();
    setBusy(true);
    passwordBox.disabled = true;
    loginBtn.textContent = '確認しています…';

    try {
      const c = await jsonp({ mode: 'adminChallenge' });

      if (!c.ok || !c.nonce) {
        throw new Error('challenge');
      }

      const proof = await sha256Hex(
        c.nonce + ':' + password
      );

      const r = await jsonp({
        mode: 'adminLogin',
        nonce: c.nonce,
        proof
      });

      if (!r.ok) {
        if (r.error === 'invalid_password') {
          throw new Error('password');
        }

        if (r.error === 'admin_key_not_set') {
          throw new Error('key');
        }

        throw new Error('login');
      }

      token = r.token;
      sessionStorage.setItem(
        'mikoshiAdminToken',
        token
      );

      // 認証成功が確定して画面を切り替えてから、
      // 非表示になったパスワード欄を消去する。
      showAdmin(r.state);
      passwordBox.value = '';
    } catch (e) {
      loginMessage(
        e.message === 'password'
          ? 'パスワードが違います。入力内容を確認してください。'
          : e.message === 'key'
            ? 'GASに MIKOSHI_ADMIN_KEY が設定されていません。'
            : '認証できませんでした。通信状態を確認して、もう一度お試しください。'
      );

      passwordBox.disabled = false;
      passwordBox.focus();
      passwordBox.select();
    } finally {
      loginBtn.textContent = '管理画面を開く';
      passwordBox.disabled = false;
      setBusy(false);
    }
  }

  function clearLoginMessage() {
    const box = document.getElementById('loginBox');
    if (!box) return;
    box.querySelectorAll('.dynamic').forEach(x => x.remove());
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
    lastAdminState = state;
    currentPublicState = !!state.isPublic;

    const s = document.getElementById('publicStatus');
    s.className = 'status ' + (currentPublicState ? 'on' : 'off');
    s.innerHTML =
      '<span class="dot"></span><span>' +
      (currentPublicState ? '神輿位置を地図に表示中' : '神輿位置を地図に表示していません') +
      '</span>';

    const visibilityBtn = document.getElementById('visibilityBtn');
    if (visibilityBtn) {
      visibilityBtn.textContent = currentPublicState
        ? '神輿位置を地図に表示しない'
        : '神輿位置を地図に表示する';
      visibilityBtn.className = currentPublicState ? 'outline' : 'primary';
    }

    const x = state.latest;
    let h = '';

    if (x) {
      const src =
        x.source === 'default'
          ? '赤城神社（初期位置）'
          : x.source === 'simulation'
            ? 'シミュレーション'
            : 'GPS';
      h += '<div><strong>神輿現在位置</strong>' + esc(src) + '</div>';
      h += '<div><strong>最終受信</strong>' + esc(jpTime(x.receivedAt)) + '（' + esc(age(x.receivedAt)) + '）</div>';

      if (
        x.accuracy !== null &&
        x.accuracy !== undefined &&
        Number.isFinite(Number(x.accuracy))
      ) {
        h += '<div><strong>位置精度</strong>約' + Math.round(Number(x.accuracy)) + 'm</div>';
      }

      h += '<div><strong>緯度・経度</strong>' +
        Number(x.lat).toFixed(6) + ', ' +
        Number(x.lon).toFixed(6) + '</div>';
    } else {
      h += '<div><strong>神輿現在位置</strong>未登録</div>';
    }

    document.getElementById('stateInfo').innerHTML = h;

    updateNoticeState_(state.notice, state.noticeHistoryCount || 0);

    const recoveryCard =
      document.getElementById('simulationRecoveryCard');

    if (recoveryCard) {
      recoveryCard.classList.toggle(
        'hidden',
        state.sessionMode !== 'simulation'
      );
    }

    const recording = document.getElementById('recordingStatus');

    if (recording) {
      recording.className =
        'recording-status ' +
        (state.isSessionActive ? 'recording-on' : 'recording-off');

      recording.textContent =
        state.isSessionActive
          ? (
              state.sessionMode === 'simulation'
                ? 'GPS位置の記録：シミュレーション中'
                : 'GPS位置の記録：記録中'
            )
          : 'GPS位置の記録：停止中';
    }

    updateActionButtons_(state);
  }

  function updateActionButtons_(state) {
    const startBtn = document.getElementById('startBtn');
    const endBtn = document.getElementById('endBtn');
    const clearBtn = document.getElementById('clearBtn');
    const operationState =
      document.getElementById('operationState');

    if (!state) return;

    const isSimulation =
      state.sessionMode === 'simulation';
    const isRealRunning =
      !!state.isSessionActive &&
      state.sessionMode === 'real';
    const isStopped =
      !state.isSessionActive;

    if (operationState) {
      if (isSimulation) {
        operationState.className =
          'operation-state simulation';
        operationState.textContent =
          '現在：シミュレーション実行中';
      } else if (isRealRunning) {
        operationState.className =
          'operation-state running';
        operationState.textContent =
          '現在：巡行中（GPS位置を記録中）';
      } else {
        operationState.className =
          'operation-state stopped';
        operationState.textContent =
          '現在：巡行開始前／終了後（GPS位置の記録停止中）';
      }
    }

    if (startBtn) {
      startBtn.disabled =
        busy ||
        !isStopped ||
        isSimulation;
    }

    if (endBtn) {
      endBtn.disabled =
        busy ||
        !isRealRunning;
    }

    // 巡行・シミュレーション中に履歴だけを消してしまわないようにする。
    if (clearBtn) {
      clearBtn.disabled =
        busy ||
        !!state.isSessionActive;
    }

  }

  function updateNoticeCount_() {
    const box = document.getElementById('noticeText');
    const count = document.getElementById('noticeCount');

    if (box && count) {
      count.textContent = box.value.length + ' / 160';
    }
  }

  function updateNoticeState_(notice, historyCount) {
    const current = document.getElementById('currentNotice');
    const clearBtn = document.getElementById('noticeClearBtn');
    const box = document.getElementById('noticeText');

    if (!current) return;

    if (notice && notice.text) {
      current.innerHTML =
        '<strong>現在表示中：</strong>' +
        esc(notice.text) +
        '<br><span class="muted">更新 ' +
        esc(jpTime(notice.updatedAt)) +
        ' / ' +
        (notice.level === 'important' ? '重要' : '通常') +
        '</span><br><span class="muted">お知らせ履歴：' +
        Number(historyCount || 0) +
        '件（最新3件まで）</span>';

      if (clearBtn) clearBtn.disabled = busy;

      if (box && !noticeEditorDirty) {
        box.value = notice.text;
        const radio = document.querySelector(
          'input[name="noticeLevel"][value="' +
          (notice.level === 'important' ? 'important' : 'normal') +
          '"]'
        );
        if (radio) radio.checked = true;
        updateNoticeCount_();
      }
    } else {
      current.textContent = '現在表示中のお知らせ：なし（履歴 ' + Number(historyCount || 0) + '件）';
      if (clearBtn) clearBtn.disabled = true;

      if (box && !noticeEditorDirty) {
        box.value = '';
        const normal = document.querySelector(
          'input[name="noticeLevel"][value="normal"]'
        );
        if (normal) normal.checked = true;
        updateNoticeCount_();
      }
    }
  }

  async function setNotice_() {
    if (busy || !token) return;

    const box = document.getElementById('noticeText');
    const text = box.value.trim();

    if (!text) {
      mainMessage('お知らせの本文を入力してください。', true);
      box.focus();
      return;
    }

    const level =
      document.querySelector('input[name="noticeLevel"]:checked')?.value ||
      'normal';

    setBusy(true);
    mainMessage('お知らせを更新しています…');

    try {
      const r = await callAdmin(
        'noticeSet',
        {
          noticeText: text,
          noticeLevel: level
        }
      );

      if (!r.ok) {
        if (r.error === 'session_expired') return expired();
        throw new Error(r.error || 'failed');
      }

      noticeEditorDirty = false;
      updateState(r.state);
      mainMessage('一般向け地図のお知らせを更新しました。', false, true);
    } catch (e) {
      mainMessage('お知らせを更新できませんでした。', true);
    } finally {
      setBusy(false);
    }
  }

  async function clearNotice_() {
    if (busy || !token) return;

    if (!confirm('一般向け地図のお知らせ表示を終了します。よろしいですか？')) {
      return;
    }

    setBusy(true);
    mainMessage('お知らせを終了しています…');

    try {
      const r = await callAdmin('noticeClear');

      if (!r.ok) {
        if (r.error === 'session_expired') return expired();
        throw new Error('failed');
      }

      noticeEditorDirty = false;
      updateState(r.state);
      mainMessage('お知らせの表示を終了しました。', false, true);
    } catch (e) {
      mainMessage('お知らせを終了できませんでした。', true);
    } finally {
      setBusy(false);
    }
  }

  function openInfo_(title, text) {
    document.getElementById('infoModalTitle').textContent = title;
    document.getElementById('infoModalBody').textContent = text;
    document.getElementById('infoModal').classList.remove('hidden');
  }

  function closeInfo_() {
    document.getElementById('infoModal').classList.add('hidden');
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
    busy = v;

    document
      .querySelectorAll('button')
      .forEach(b => {
        b.disabled = v;
      });

    if (!v && lastAdminState) {
      // 通信処理後も、巡行状態に応じたボタンの有効／無効を維持する。
      updateActionButtons_(lastAdminState);
      updateNoticeState_(lastAdminState.notice, lastAdminState.noticeHistoryCount || 0);

      const simulationEndBtn =
        document.getElementById('simulationEndBtn');

      if (simulationEndBtn) {
        simulationEndBtn.disabled =
          lastAdminState.sessionMode !== 'simulation';
      }
    }
  }

  function mainMessage(text, error=false, ok=false) {
    const el = document.getElementById('mainMessage');
    if (!el) return;
    el.className = 'message' + (error ? ' error' : '') + (ok ? ' ok' : '');
    el.textContent = text;
  }

  function callAdmin(action, params={}) {
    return jsonp({ mode:'admin', action, token, ...params });
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
