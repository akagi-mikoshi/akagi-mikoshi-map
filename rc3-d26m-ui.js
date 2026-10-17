/* 赤城神社例大祭 神輿巡行マップ - RC3-D2.6m 公開用表示コード
 * 基本となるAPI・巡行ルートデータは変更しない。
 * 本ファイルは公開地図の表示調整に使用する。
 */
(function () {
  'use strict';

  var APP_VERSION = 'RC3-D2.6m';
  // The optional progress bar is hidden by default. A viewer's own choice
  // is kept only in the same browser tab (no changes to GPS or GAS).
  var D26_POLL_BAR_PREF_KEY = 'akagi-map-show-pollbar-v1';
  var d26PollBarVisible = false;
  try { d26PollBarVisible = sessionStorage.getItem(D26_POLL_BAR_PREF_KEY) === '1'; }
  catch (_) {}
  function setPollBarVisible(visible, save) {
    d26PollBarVisible = !!visible;
    var meter = document.getElementById('d26-poll-meter');
    var trigger = document.querySelector('.d26-refresh-hold');
    if (meter) meter.hidden = !d26PollBarVisible;
    if (trigger) trigger.classList.toggle('d26-pollbar-off', !d26PollBarVisible);
    if (save !== false) {
      try { sessionStorage.setItem(D26_POLL_BAR_PREF_KEY, d26PollBarVisible ? '1' : '0'); }
      catch (_) {}
    }
  }
  // Operator-only display choices. Public/default presentation is unchanged.
  var D26_GPS_DETAIL_PREF_KEY = 'akagi-map-gps-detail-v1';
  var D26_GPS_ALERT_PREF_KEY = 'akagi-map-gps-alert-v1';
  var d26GpsDetail = false;
  var d26GpsAlert = false;
  try {
    d26GpsDetail = sessionStorage.getItem(D26_GPS_DETAIL_PREF_KEY) === '1';
    d26GpsAlert = sessionStorage.getItem(D26_GPS_ALERT_PREF_KEY) === '1';
  } catch (_) {}
  var d26GpsLatest = null;
  var d26GpsTicker = null;
  var d26LastAlertLevel = '';
  function setGpsPreferences_(type, enabled) {
    if (type === 'detail') d26GpsDetail = !!enabled;
    if (type === 'alert') d26GpsAlert = !!enabled;
    try {
      sessionStorage.setItem(type === 'detail' ? D26_GPS_DETAIL_PREF_KEY : D26_GPS_ALERT_PREF_KEY,
        enabled ? '1' : '0');
    } catch (_) {}
    paintGpsDiagnostics_();
  }
  function gpsAge_(seconds) {
    if (seconds < 60) return seconds + '秒前';
    var minutes = Math.floor(seconds / 60);
    return minutes + '分' + String(seconds % 60).padStart(2, '0') + '秒前';
  }
  function paintGpsDiagnostics_() {
    var panel = document.getElementById('d26-gps-diagnostics');
    var normal = document.getElementById('status');
    if (!panel || !normal) return;
    var state = d26GpsLatest;
    var position = state && state.latest;
    var gpsAt = position ? new Date(position.receivedAt).getTime() : NaN;
    var goodGps = !!(state && state.isPublic && !state.isSimulation &&
      position && position.source === 'gps' && Number.isFinite(gpsAt));
    var detailActive = d26GpsDetail && goodGps;
    var alertActive = d26GpsAlert && goodGps;
    var now = Date.now();
    var ageSeconds = Math.max(0, Math.floor((now - gpsAt) / 1000));
    var successAt = state ? new Date(state.successAt).getTime() : NaN;
    var phase = window.MIKOSHI_POLL_STATUS && window.MIKOSHI_POLL_STATUS.phase;
    // Never call a GPS outage when the map itself cannot confirm fresh data.
    var pollSeconds = Number(window.MIKOSHI_POLL_INTERVAL_SECONDS) || 15;
    var mapFresh = Number.isFinite(successAt) && now - successAt <=
      Math.max(30000, pollSeconds * 1000 + 15000) &&
      phase !== 'retry' && phase !== 'unavailable';
    var level = !alertActive || !mapFresh ? '' :
      ageSeconds >= 90 ? 'critical' : ageSeconds >= 45 ? 'caution' : '';
    // When only the alert is enabled, do not reserve empty screen space
    // while GPS reception is normal.
    var showPanel = detailActive || !!level;
    panel.hidden = !showPanel;
    document.body.classList.toggle('d26-gps-base-hidden',
      !!(detailActive && !normal.classList.contains('connection-error')));
    if (!showPanel) { d26LastAlertLevel = ''; return; }
    var count = document.getElementById('d26-gps-age');
    var last = document.getElementById('d26-gps-fetch');
    var accuracy = document.getElementById('d26-gps-accuracy');
    var details = document.getElementById('d26-gps-lines');
    if (details) details.hidden = !detailActive;
    if (count) count.textContent = gpsAge_(ageSeconds);
    // Keep the age of the last successful GAS fetch visible during a retry
    // or a timeout. A stale fetch must not be mistaken for a GPS outage.
    if (last) last.textContent = Number.isFinite(successAt)
      ? gpsAge_(Math.max(0, Math.floor((now - successAt) / 1000)))
      : '未取得';
    if (accuracy) {
      var a = Number(position.accuracy);
      accuracy.textContent = Number.isFinite(a) && a > 0 ? '約' + Math.round(a) + 'm' : '—';
    }
    var warning = document.getElementById('d26-gps-warning');
    if (!warning) return;
    warning.hidden = !level;
    warning.classList.toggle('d26-gps-warning-critical', level === 'critical');
    if (level !== d26LastAlertLevel) {
      warning.textContent = level === 'critical'
        ? '⚠ GPS情報が90秒以上更新されていません。\n巡行中ならTraccarを至急確認してください。'
        : level === 'caution'
        ? '⚠ GPS情報が45秒以上更新されていません。\n巡行中ならTraccarを確認してください。'
        : '';
      d26LastAlertLevel = level;
    }
  }
  window.addEventListener('mikoshi-public-state', function(event) {
    d26GpsLatest = event.detail || null;
    paintGpsDiagnostics_();
  });
  window.addEventListener('mikoshi-poll-status', paintGpsDiagnostics_);
  document.addEventListener('visibilitychange', paintGpsDiagnostics_);
  var LEAFLET_ZOOM_SNAP = 0.1;
  var LEAFLET_ZOOM_DELTA = 0.25;
  // 初期倍率はルート全体表示と完全に同じfitBoundsを使う。

  // Leafletが初期化された時にズームを細かくし、初期地図の大きさを安定させる。
  // app.jsは地図非表示の状態でL.mapを生成し、fitBoundsの後にinvalidateSizeする。
  // その順序では初回のサイズ計測が不安定になり得るため、
  // 元のapp.jsが行うinvalidateSize直後に、初回fitBoundsを一度だけ再適用する。
  // 「予定経路全体を表示」と同じ計算式であり、追加の倍率補正はしない。
  function patchLeaflet() {
    var L = window.L;
    if (!L || !L.Map || L.Map.prototype._akagiD26Patched) return;
    L.Map.prototype._akagiD26Patched = true;
    L.Map.mergeOptions({
      zoomSnap: LEAFLET_ZOOM_SNAP,
      zoomDelta: LEAFLET_ZOOM_DELTA
    });

    // 予定巡行路のポリラインだけを調整する。
    // SVGのstroke色による一括CSSでは地点の円形マーカーも対象になってしまうため、
    // Leafletで線を作る時点で、予定ルート（8 7）に限定して変更する。
    // 神輿通過済み経路や地点マーカー、基盤のapp.jsは一切変更しない。
    var originalPolyline = L.polyline;
    L.polyline = function (latlngs, options) {
      if (options && options.color === '#586979' && options.dashArray === '8 7') {
        var plannedOptions = Object.assign({}, options, {
          dashArray: '10 12',
          weight: 4
        });
        return originalPolyline.call(this, latlngs, plannedOptions);
      }
      return originalPolyline.call(this, latlngs, options);
    };

    L.Map.addInitHook(function () {
      var map = this;
      var baseFitBounds = map.fitBounds;
      var baseInvalidateSize = map.invalidateSize;
      var savedInitialFit = null;
      var initialFitFinalized = false;
      map.fitBounds = function (bounds, options) {
        var result = baseFitBounds.call(this, bounds, options);
        if (!savedInitialFit && bounds && bounds.isValid && bounds.isValid()) {
          savedInitialFit = {bounds: bounds, options: options};
        }
        return result;
      };
      map.invalidateSize = function (options) {
        var result = baseInvalidateSize.call(this, options);
        if (!initialFitFinalized && savedInitialFit) {
          var element = map.getContainer();
          if (element && element.clientWidth > 0 && element.clientHeight > 0) {
            initialFitFinalized = true;
            // 地図が表示され、コンテナの寸法が更新された後に実行する。
            baseFitBounds.call(map, savedInitialFit.bounds, savedInitialFit.options);
          }
        }
        return result;
      };
    });
  }

  function isLeafletScript(node) {
    if (!node || node.tagName !== 'SCRIPT') return false;
    var src = node.getAttribute('src') || '';
    return src.indexOf('leaflet@1.9.4/dist/leaflet.js') !== -1;
  }

  function handleNewNodes(nodes) {
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      if (isLeafletScript(node)) {
        // PromiseによるinitializeMap()より前に実行される。
        node.addEventListener('load', patchLeaflet, {once: true});
      }
      if (node.querySelectorAll) {
        var scripts = node.querySelectorAll('script[src]');
        for (var j = 0; j < scripts.length; j++) {
          if (isLeafletScript(scripts[j])) {
            scripts[j].addEventListener('load', patchLeaflet, {once: true});
          }
        }
      }
    }
  }

  function el(tag, className, content) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (content != null) node.textContent = content;
    return node;
  }
  function button(label, title, action, className) {
    var node = el('button', className || '', label);
    node.type = 'button';
    node.setAttribute('aria-label', title || label);
    node.dataset.d26Action = action;
    return node;
  }

  function installUi() {
    var mapWrap = document.getElementById('mapWrap');
    if (!mapWrap || document.getElementById('d26-header')) return;

    var header = el('header', 'd26-header');
    header.id = 'd26-header';
    var titles = el('div', 'd26-titles');
    var h1 = el('h1', 'd26-title', '赤城神社例大祭');
    var subtitle = el('div', 'd26-subtitle', '10月18日（日）神輿巡行マップ');
    titles.appendChild(h1);
    titles.appendChild(subtitle);
    header.appendChild(titles);

    var actions = el('div', 'd26-header-actions');
    var noticeButton = button('♧', 'お知らせ', 'notice', 'd26-icon-button d26-bell');
    // 絵文字フォント差による崩れを防ぐため、SVGでベルを描く。
    noticeButton.innerHTML = '<svg width="23" height="23" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/></svg>';
    var menuButton = button('☰', 'メニューを開く', 'menu', 'd26-icon-button d26-menu-button');
    actions.appendChild(noticeButton);
    actions.appendChild(menuButton);
    header.appendChild(actions);
    document.body.insertBefore(header, mapWrap);

    var footer = el('footer', 'd26-footer');
    footer.id = 'd26-footer';
    // 読み手が知りたい更新間隔を文字で常時表示する。詳しい説明はⓘのみタップ。
    var refreshText = /[?&]test=1(?:&|$)/.test(window.location.search) ? '約2秒ごと' : '約15秒ごと';
    var updateInfo = el('div', 'd26-refresh');
    var holdButton = el('button', 'd26-refresh-hold');
    holdButton.type = 'button';
    holdButton.setAttribute('aria-label', '自動更新とGPS表示の設定を開く');
    holdButton.setAttribute('aria-expanded', 'false');
    holdButton.title = 'タップして更新・GPS表示の設定を開く';
    holdButton.classList.toggle('d26-pollbar-off', !d26PollBarVisible);
    holdButton.innerHTML = '<svg class="d26-refresh-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 11a8 8 0 0 0-14.2-4.8L4 8"/><path d="M4 4v4h4"/><path d="M4 13a8 8 0 0 0 14.2 4.8L20 16"/><path d="M20 20v-4h-4"/></svg><span class="d26-refresh-label">自動更新：' + refreshText + '</span>' +
      '<span id="d26-poll-meter" class="d26-poll-meter"' + (d26PollBarVisible ? '' : ' hidden') + ' role="progressbar" aria-label="次回の位置情報取得まで" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><span class="d26-poll-meter-fill" id="d26-poll-meter-fill"></span></span>';
    updateInfo.appendChild(holdButton);
    var helpButton = button('', '自動更新についての説明', 'update', 'd26-info-tap');
    helpButton.innerHTML = '<svg class="d26-help-icon" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 11v6"/><circle cx="12" cy="7.5" r="1.1" fill="currentColor" stroke="none"/></svg>';
    updateInfo.appendChild(helpButton);
    var choices = el('div', 'd26-refresh-options d26-hidden');
    choices.id = 'd26-refresh-options';
    choices.setAttribute('role', 'group');
    choices.setAttribute('aria-label', '自動更新と管理者向け表示の設定');
    choices.innerHTML = '<div class="d26-refresh-options-head"><strong>自動更新の設定</strong>' +
      '<button type="button" class="d26-refresh-options-close" data-d26-poll-close aria-label="設定を閉じる">×</button></div>' +
      '<div class="d26-refresh-options-title">更新間隔</div>' +
      '<div class="d26-refresh-option-row"><button type="button" data-d26-poll-seconds="5">5秒</button>' +
      '<button type="button" data-d26-poll-seconds="10">10秒</button>' +
      '<button type="button" data-d26-poll-seconds="15">15秒</button></div>' +
      '<div class="d26-refresh-options-title d26-refresh-bar-title">進捗バーの表示</div>' +
      '<div class="d26-refresh-option-row"><button type="button" data-d26-poll-bar="0">非表示</button>' +
      '<button type="button" data-d26-poll-bar="1">表示する</button></div>' +
      '<div class="d26-refresh-options-title d26-refresh-bar-title">位置情報の表示</div>' +
      '<div class="d26-refresh-option-row"><button type="button" data-d26-gps-detail="0">通常</button>' +
      '<button type="button" data-d26-gps-detail="1">詳細（太字）</button></div>' +
      '<div class="d26-refresh-options-title d26-refresh-bar-title">GPS受信アラート（45秒・90秒）</div>' +
      '<div class="d26-refresh-option-row"><button type="button" data-d26-gps-alert="0">なし</button>' +
      '<button type="button" data-d26-gps-alert="1">画面に表示</button></div>' +
      '<div class="d26-refresh-options-note">この画面を開いているときのみ確認します。休憩中は更新が空く場合があります。</div>';
    updateInfo.appendChild(choices);
    setupPollIntervalPicker(holdButton, choices);
    footer.appendChild(updateInfo);

    var footerActions = el('div', 'd26-footer-actions');
    var scheduleInfoButton = button('', '予定時刻の注意点を表示', 'schedule-info', 'd26-footer-button');
    scheduleInfoButton.textContent = '時刻の注意点';
    var guideButton = button('', 'ご利用案内を表示', 'guide', 'd26-footer-button');
    guideButton.textContent = 'ご利用案内';
    footerActions.appendChild(scheduleInfoButton);
    footerActions.appendChild(guideButton);
    footer.appendChild(footerActions);
    var status = document.getElementById('status');
    // 通信失敗等の状態表示は本体側が更新するため、その直後にボタン列を置く。
    if (status) {
      var gpsPanel = el('section', 'd26-gps-diagnostics');
      gpsPanel.id = 'd26-gps-diagnostics';
      gpsPanel.setAttribute('aria-label', '管理者向けGPS受信状況');
      gpsPanel.hidden = true;
      gpsPanel.innerHTML = '<div id="d26-gps-lines" class="d26-gps-lines">' +
        '<div class="d26-gps-main"><span>GPS情報の最終受信</span><strong id="d26-gps-age">—</strong></div>' +
        '<div class="d26-gps-minor"><span>サーバー情報の最終取得</span><span id="d26-gps-fetch">—</span></div>' +
        '<div class="d26-gps-minor"><span>GPS位置精度</span><span id="d26-gps-accuracy">—</span></div></div>' +
        '<div id="d26-gps-warning" class="d26-gps-warning" role="status" hidden></div>';
      status.insertAdjacentElement('afterend', gpsPanel);
      gpsPanel.insertAdjacentElement('afterend', footer);
    } else mapWrap.insertAdjacentElement('afterend', footer);
    if (!d26GpsTicker) d26GpsTicker = setInterval(function() {
      if (document.visibilityState !== 'hidden') paintGpsDiagnostics_();
    }, 1000);
    setPollBarVisible(d26PollBarVisible, false);
    onPollPhase();
    paintGpsDiagnostics_();

    var backdrop = el('div', 'd26-modal d26-hidden');
    backdrop.id = 'd26-modal';
    backdrop.setAttribute('role', 'presentation');
    backdrop.innerHTML = '<section class="d26-modal-card" role="dialog" aria-modal="true" aria-labelledby="d26-modal-title" tabindex="-1">' +
      '<div class="d26-modal-head"><h2 id="d26-modal-title"></h2><button type="button" class="d26-close" data-d26-action="close" aria-label="閉じる">×</button></div>' +
      '<div id="d26-modal-content" class="d26-modal-content"></div></section>';
    document.body.appendChild(backdrop);
    document.body.classList.add('d26-enabled');
    updateBellIndicator();
  }



  // Long press opens a small panel anchored to the left refresh indicator.
  // Keyboard Enter/Space can open the same panel for accessibility.
  function setupPollIntervalPicker(holdButton, choices) {
    var holdTimer = null;
    function cancelHold() {
      if (holdTimer !== null) { clearTimeout(holdTimer); holdTimer = null; }
    }
    function setChoicesVisible(show) {
      choices.classList.toggle('d26-hidden', !show);
      holdButton.setAttribute('aria-expanded', show ? 'true' : 'false');
      if (show) {
        var selected = Number(window.MIKOSHI_POLL_INTERVAL_SECONDS || 0);
        choices.querySelectorAll('[data-d26-poll-seconds]').forEach(function(btn) {
          var active = Number(btn.dataset.d26PollSeconds) === selected;
          btn.classList.toggle('d26-poll-selected', active);
          btn.setAttribute('aria-pressed', active ? 'true' : 'false');
        });
        choices.querySelectorAll('[data-d26-poll-bar]').forEach(function(btn) {
          var active = (btn.dataset.d26PollBar === '1') === d26PollBarVisible;
          btn.classList.toggle('d26-poll-selected', active);
          btn.setAttribute('aria-pressed', active ? 'true' : 'false');
        });
        choices.querySelectorAll('[data-d26-gps-detail]').forEach(function(btn) {
          var active = (btn.dataset.d26GpsDetail === '1') === d26GpsDetail;
          btn.classList.toggle('d26-poll-selected', active);
          btn.setAttribute('aria-pressed', active ? 'true' : 'false');
        });
        choices.querySelectorAll('[data-d26-gps-alert]').forEach(function(btn) {
          var active = (btn.dataset.d26GpsAlert === '1') === d26GpsAlert;
          btn.classList.toggle('d26-poll-selected', active);
          btn.setAttribute('aria-pressed', active ? 'true' : 'false');
        });
      }
    }
    // A short tap must NOT open settings: avoid accidental touches.
    // Settings open only on a deliberate long press (or keyboard).
    holdButton.addEventListener('click', function(event) {
      event.preventDefault();
    });
    holdButton.addEventListener('pointerdown', function(event) {
      if (event.button != null && event.button !== 0) return;
      cancelHold();
      holdTimer = setTimeout(function() {
        holdTimer = null;
        setChoicesVisible(true);
      }, 550);
    });
    ['pointerup','pointercancel','pointerleave'].forEach(function(name) {
      holdButton.addEventListener(name, cancelHold);
    });
    holdButton.addEventListener('contextmenu', function(event) {
      event.preventDefault();
      cancelHold();
      setChoicesVisible(true);
    });
    holdButton.addEventListener('keydown', function(event) {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        setChoicesVisible(true);
      }
    });
    // Long press opens this panel; it remains open until closed.
    choices.addEventListener('click', function(event) {
      if (event.target.closest('[data-d26-poll-close]')) {
        event.preventDefault();
        setChoicesVisible(false);
        holdButton.focus();
        return;
      }
      var target = event.target.closest(
        '[data-d26-poll-seconds],[data-d26-poll-bar],[data-d26-gps-detail],[data-d26-gps-alert]');
      if (!target) return;
      event.preventDefault();
      if (target.hasAttribute('data-d26-poll-bar')) {
        setPollBarVisible(target.dataset.d26PollBar === '1');
      } else if (target.hasAttribute('data-d26-gps-detail')) {
        setGpsPreferences_('detail', target.dataset.d26GpsDetail === '1');
      } else if (target.hasAttribute('data-d26-gps-alert')) {
        setGpsPreferences_('alert', target.dataset.d26GpsAlert === '1');
      } else {
        var secs = Number(target.dataset.d26PollSeconds);
        if (window.MIKOSHI_SET_POLL_INTERVAL) {
          window.MIKOSHI_SET_POLL_INTERVAL(secs);
        } else {
          window.MIKOSHI_POLL_INTERVAL_SECONDS = secs;
        }
      }
      setChoicesVisible(true);
    });
    document.addEventListener('pointerdown', function(event) {
      if (!choices.classList.contains('d26-hidden') &&
          !choices.contains(event.target) && !holdButton.contains(event.target)) {
        setChoicesVisible(false);
      }
    });
    document.addEventListener('keydown', function(event) {
      if (event.key === 'Escape') setChoicesVisible(false);
    });
  }

  // The bar follows real request timing: next request starts 15 seconds after
  // completion (2 seconds in test mode), not on a wall-clock 15-second grid.
  var d26PollTimer = null;
  function paintPollIndicator() {
    var meter = document.getElementById('d26-poll-meter');
    var fill = document.getElementById('d26-poll-meter-fill');
    var label = document.querySelector('.d26-refresh-label');
    if (!meter || !fill || !label) return;
    var state = window.MIKOSHI_POLL_STATUS || {phase:'initial'};
    var phase = state.phase;
    var timeLeft = 0;
    var percent = 0;
    if (phase === 'waiting' || phase === 'retry') {
      var delay = Math.max(1, Number(state.delayMs) || 1);
      timeLeft = Math.max(0, (Number(state.startedAt) || Date.now()) + delay - Date.now());
      percent = Math.min(100, Math.max(0, 100 * (delay - timeLeft) / delay));
      // Always use two digits; the fixed, left-aligned label never shifts.
      var secondsText = String(Math.ceil(timeLeft / 1000)).padStart(2, '0');
      label.textContent = phase === 'retry'
        ? '再試行まで ' + secondsText + '秒'
        : '次の取得まで ' + secondsText + '秒';
    } else if (phase === 'requesting') {
      percent = 100;
      label.textContent = '位置情報を取得中…';
    } else if (phase === 'paused') {
      label.textContent = '自動更新：待機中';
    } else if (phase === 'unavailable') {
      label.textContent = '位置情報を取得できません';
    } else {
      label.textContent = '自動更新：準備中';
    }
    fill.style.width = percent.toFixed(1) + '%';
    meter.classList.toggle('d26-poll-requesting', phase === 'requesting');
    meter.classList.toggle('d26-poll-retry', phase === 'retry');
    meter.setAttribute('aria-valuenow', String(Math.round(percent)));
    meter.setAttribute('aria-valuetext', label.textContent);
  }
  function onPollPhase() {
    if (d26PollTimer) {
      clearInterval(d26PollTimer);
      d26PollTimer = null;
    }
    paintPollIndicator();
    var state = window.MIKOSHI_POLL_STATUS;
    if (state && (state.phase === 'waiting' || state.phase === 'retry')) {
      d26PollTimer = setInterval(paintPollIndicator, 250);
    }
  }
  window.addEventListener('mikoshi-poll-status', onPollPhase);
  window.addEventListener('mikoshi-poll-interval-selected', paintPollIndicator);

  var lastFocused = null;
  function closeDialog() {
    var modal = document.getElementById('d26-modal');
    if (!modal) return;
    modal.classList.add('d26-hidden');
    if (lastFocused && lastFocused.isConnected) lastFocused.focus();
  }
  function openDialog(title, html) {
    var modal = document.getElementById('d26-modal');
    if (!modal) return;
    lastFocused = document.activeElement;
    document.getElementById('d26-modal-title').textContent = title;
    document.getElementById('d26-modal-content').innerHTML = html;
    modal.classList.remove('d26-hidden');
    modal.querySelector('.d26-close').focus();
  }
  var PUBLIC_SHARE_URL = 'https://akagi-mikoshi.github.io/akagi-mikoshi-map/';
  var menuHtml = [
    '<div class="d26-menu-list">',
    '<button type="button" data-d26-action="notice">お知らせ <span>›</span></button>',
    '<button type="button" data-d26-action="schedule">巡行地点・予定時刻一覧 <span>›</span></button>',
    '<button type="button" class="d26-culture-link" data-d26-action="culture">' +
      '<span class="d26-culture-text"><strong>赤城神社と流山の伝統文化</strong><small>赤城保存会のお囃子・神楽など</small></span>' +
      '<span aria-hidden="true">›</span></button>',
    '<button type="button" data-d26-action="fit">巡行ルート全体を地図表示 <span>›</span></button>',
    '<button type="button" data-d26-action="schedule-info">予定時刻の注意点 <span>›</span></button>',
    '<button type="button" data-d26-action="refresh-settings">自動更新・GPS表示の設定 <span>›</span></button>',
    '<button type="button" data-d26-action="update">自動更新について <span>›</span></button>',
    '<button type="button" data-d26-action="guide">地図の使い方・ご利用案内 <span>›</span></button>',
    '<button type="button" data-d26-action="share">この地図を共有（QRコード） <span>›</span></button>',
    '<button type="button" data-d26-action="about">このサイトについて <span>›</span></button>',
    '</div>'
  ].join('');
  function showMenu() { openDialog('メニュー', menuHtml); }

  function showNotice() {
    closeDialog();
    var historyPanel = document.getElementById('noticeHistoryPanel');
    var historyList = document.getElementById('noticeHistoryList');
    var collapsed = document.getElementById('noticeCollapsed');
    var dock = document.getElementById('noticeDock');
    if (historyPanel && !historyPanel.classList.contains('hidden')) return;
    // 数字は「保存中の履歴件数」。既存の履歴ボタンのクリック処理を再利用。
    // ベルからはポップアップの表示・非表示にかかわらず履歴を開く。
    if (historyList && historyList.querySelector('.notice-history-item') && collapsed) {
      // お知らせがポップアップ中なら、既存の「閉じる」の処理で既読扱いにする。
      // これにより履歴を閉じた後に同じ通知が再ポップアップしない。
      if (dock && !dock.classList.contains('hidden')) {
        var closeCurrent = document.getElementById('noticeClose');
        if (closeCurrent) closeCurrent.click();
      }
      collapsed.click();
      return;
    }
    if (dock && !dock.classList.contains('hidden')) {
      var currentClose = document.getElementById('noticeClose');
      if (currentClose) currentClose.focus();
      return;
    }
    openDialog('お知らせ', '<p>現在、表示できるお知らせはありません。</p>');
  }
  function doAction(action) {
    if (action === 'culture') {
      openDialog('赤城神社と流山の伝統文化',
        '<p>神輿巡行とともに、流山に受け継がれてきた文化にもぜひ触れてみてください。</p>' +
        '<p><strong>赤城保存会と祭囃子・神楽</strong><br>「流山の祭囃子、神楽等」は流山市指定無形文化財です。保持団体の赤城保存会が、伝統芸能の継承・公開に取り組んでいます。<br><a href="https://www.city.nagareyama.chiba.jp/tourism/1013087/1013105/007794.html" target="_blank" rel="noopener noreferrer">流山市公式：流山の祭囃子、神楽等（別画面）</a></p>' +
        '<p><strong>赤城神社の大しめ縄行事</strong><br>秋の祭礼に先立って地域の人々が大しめ縄を作る、流山市指定無形民俗文化財です。<br><a href="https://www.city.nagareyama.chiba.jp/tourism/1013087/1013101/1013102.html" target="_blank" rel="noopener noreferrer">流山市公式：赤城神社 大しめ縄行事（別画面）</a></p>' +
        '<p><strong>赤城神社と「流山」の地名</strong><br>赤城神社が鎮座する小山「赤城山」には、上州の赤城山の土や神社のお札が流れ着いたとする伝説があり、流山の地名伝説の舞台とされています。<br><a href="https://www.city.nagareyama.chiba.jp/tourism/1013087/1013101/1013102.html" target="_blank" rel="noopener noreferrer">流山市公式：赤城神社にまつわる伝説（別画面）</a></p>');
      return;
    }
    if (action === 'share') {
      openDialog('この地図を共有（QRコード）',
        '<p>このQRコードを読み取ると、赤城神社例大祭の神輿巡行マップが開きます。ほかの方へのご案内にご利用ください。</p>' +
        '<div class="d26-share-qr"><img src="/akagi-mikoshi-map/share-site-qr.svg" alt="本番用神輿巡行マップのQRコード" width="280" height="280"></div>' +
        '<label class="d26-share-label" for="d26-share-url">共有用URL</label>' +
        '<input id="d26-share-url" class="d26-share-url" readonly type="text" value="' + PUBLIC_SHARE_URL + '">' +
        '<button type="button" class="d26-primary" data-d26-action="copy-share-url">URLをコピー</button>' +
        '<p class="d26-share-status" id="d26-share-status" aria-live="polite"></p>');
      return;
    }
    if (action === 'copy-share-url') {
      var field = document.getElementById('d26-share-url');
      var status = document.getElementById('d26-share-status');
      function fallbackCopy() {
        if (!field) return;
        field.focus();
        field.select();
        var success = false;
        try { success = document.execCommand('copy'); } catch (err) {}
        if (status) status.textContent = success ? 'URLをコピーしました。' : 'URLを選択しました。長押ししてコピーしてください。';
      }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(PUBLIC_SHARE_URL).then(function () {
          if (status) status.textContent = 'URLをコピーしました。';
        }, fallbackCopy);
      } else {
        fallbackCopy();
      }
      return;
    }
    if (action === 'close') { closeDialog(); return; }
    if (action === 'menu') { showMenu(); return; }
    if (action === 'notice') { showNotice(); return; }
    if (action === 'schedule') {
      closeDialog();
      var scheduleButton = document.getElementById('scheduleButton');
      if (scheduleButton) scheduleButton.click();
      return;
    }
    if (action === 'fit') {
      closeDialog();
      var fitButton = document.getElementById('fitRouteQuickButton');
      if (fitButton) fitButton.click();
      return;
    }
    if (action === 'refresh-settings') {
      closeDialog();
      var refreshButton = document.querySelector('.d26-refresh-hold');
      if (refreshButton) refreshButton.click();
      return;
    }
    if (action === 'update') {
      openDialog('自動更新について',
        '<p>このページを開いている間、神輿の位置情報とお知らせを約' + (window.MIKOSHI_POLL_INTERVAL_SECONDS || (/([?&])test=1(?:&|$)/.test(window.location.search) ? 2 : 15)) + '秒ごとに自動的に取得します。</p>' +
        '<p>画面下部の自動更新表示をタップするか、右上のメニューから「自動更新・GPS表示の設定」を選ぶと、取得間隔、進捗バー、詳細表示、GPS受信アラートを変更できます。設定はこのタブで保存されます。</p>' +
        '<p>「GPS情報の最終受信」はTraccarからGASへ最後に位置情報が届いてからの経過時間です。「サーバー情報の最終取得」はブラウザがGASから最後に情報を正常取得してからの経過時間です。いずれも秒単位で表示します。</p>' +
        '<p>サーバーからの情報取得に失敗した場合も、最後の正常取得からの経過時間を表示し続けます。この間はGAS側に新しいGPS情報が届いているか判断できないため、GPS受信停止のアラートは出しません。</p>' +
        '<p>アラートはGPS受信が45秒以上ない場合に注意、90秒以上で要確認を画面内に示します。休憩中も表示される場合があります。</p>' +
        '<p>ページを閉じている間、スマートフォンにプッシュ通知が届く仕組みではありません。</p>' +
        '<p>地図に表示される「最終更新」は、神輿の現在位置を知らせるGPS端末から送られた位置情報を、システムが最後に受信・記録した時刻です。</p>' +
        '<p>GPSの受信状況や通信環境により、位置の更新が遅れたり、実際の位置と多少ずれたりする場合があります。</p>');
      return;
    }
    if (action === 'schedule-info') {
      openDialog('予定時刻の注意点',
        '<p>巡行予定時刻は目安です。実際の進行状況や交通事情、休憩などにより前後する場合があります。</p>' +
        '<p>地図の各予定地点をタップすると、その場所の予定を確認できます。</p>' +
        '<button type="button" class="d26-primary" data-d26-action="schedule">巡行地点・予定時刻一覧</button>');
      return;
    }
    if (action === 'guide') {
      openDialog('ご利用案内',
        '<p><strong>神輿の現在位置</strong>は地図上の神輿マークで確認できます。位置情報が非公開または未受信のときは、予定ルートだけが表示されます。</p>' +
        '<p><strong>地図の操作：</strong>指で移動・拡大縮小できます。＋／－は細かな倍率に対応します。「巡行ルート全体を地図表示」は地図の表示範囲を調整する機能です。「予定経路を表示する／非表示にする」は経路の線を切り替える機能です。</p>' +
        '<p><strong>お知らせ：</strong>ベルの赤い数字は、保存中のお知らせ履歴の件数（最大3件）です。ベルを押すと履歴を確認できます。未読件数ではありません。</p>' +
        '<p><strong>表示上の注意：</strong>休憩中などは位置情報の更新間隔が空くことがあります。GPSや通信状況によって実際の位置から多少ずれる場合があります。</p>' +
        '<p>歩行中は画面を操作せず、安全な場所で確認してください。</p>');
      return;
    }
    if (action === 'about') {
      openDialog('このサイトについて',
        '<p><strong>流山・赤城神社例大祭｜神輿巡行マップ</strong></p>' +
        '<p>2026年10月18日（日）の神輿巡行について、現在地・巡行予定・お知らせをご案内するページです。</p>' +
        '<p>祭礼案内：<a href="https://sites.google.com/view/syuku26/%E8%B5%A4%E5%9F%8E%E7%A5%9E%E7%A4%BE%E4%BE%8B%E5%A4%A7%E7%A5%AD" target="_blank" rel="noopener noreferrer">赤城神社例大祭の案内ページ（別画面）</a></p>' +
        '<p>公開版（全画面共通）：' + APP_VERSION + '<br>基本処理版（位置情報・通信）：RC3-D2.5</p>');
      return;
    }
  }

  function updateBellIndicator() {
    var bell = document.querySelector('.d26-bell');
    if (!bell) return;
    var historyList = document.getElementById('noticeHistoryList');
    // サーバーが返す直近最大3件の履歴を表す。未読件数ではない。
    var count = historyList ? historyList.querySelectorAll('.notice-history-item').length : 0;
    var badge = bell.querySelector('.d26-notice-count');
    if (!badge) {
      badge = el('span', 'd26-notice-count');
      badge.setAttribute('aria-hidden', 'true');
      bell.appendChild(badge);
    }
    badge.textContent = count ? String(count) : '';
    badge.hidden = count === 0;
    bell.setAttribute('aria-label', count ? 'お知らせ履歴 ' + count + '件' : 'お知らせ');
    bell.setAttribute('title', count ? 'お知らせ履歴 ' + count + '件' : 'お知らせ');
  }

  // bodyを丸ごと組み立て直す現行app.jsに追従する。
  document.addEventListener('click', function (event) {
    var target = event.target.closest ? event.target.closest('[data-d26-action]') : null;
    if (target) {
      event.preventDefault();
      doAction(target.dataset.d26Action);
    } else if (event.target && event.target.id === 'd26-modal') {
      closeDialog();
    }
  });
  document.addEventListener('keydown', function (event) {
    var modal = document.getElementById('d26-modal');
    if (!modal || modal.classList.contains('d26-hidden')) return;
    if (event.key === 'Escape') closeDialog();
    if (event.key === 'Tab') {
      var focusables = Array.prototype.slice.call(modal.querySelectorAll('button:not(:disabled),a[href]'));
      if (!focusables.length) return;
      var first = focusables[0];
      var last = focusables[focusables.length - 1];
      if (event.shiftKey && document.activeElement === first) { last.focus(); event.preventDefault(); }
      else if (!event.shiftKey && document.activeElement === last) { first.focus(); event.preventDefault(); }
    }
  });
  // 変更前のdocument全体のsubtree監視は、Leafletの地図タイルの追加・削除にも
  // 反応していた。初期化用の監視はheadとbodyの直下だけに限定する。
  var noticeObserver = null;
  var scheduleObserver = null;
  function enhanceScheduleUi() {
    var button = document.getElementById('fitRouteQuickButton');
    if (button) button.textContent = '巡行ルート全体を地図表示';

    var panel = document.getElementById('schedulePanel');
    if (!panel || !panel.querySelector('.schedule-item')) return;
    if (panel.dataset.d26Upgraded === '1') return;

    var fit = document.getElementById('fitRouteButton');
    if (fit) fit.textContent = '巡行ルート全体を地図表示';

    var summary = panel.querySelector('.schedule-summary');
    if (summary) {
      summary.innerHTML =
        '<div class="d26-schedule-legend">灰色の点線が予定巡行路、赤茶色の実線が通過済み経路です。</div>' +
        '<div class="d26-schedule-instruction">地点名を選ぶと、その場所を中心に地図が表示されます。</div>';
    }
    panel.querySelectorAll('.schedule-item').forEach(function (item) {
      // DOMの既存クリック処理・選択範囲は維持する。
      var chevron = el('span', 'd26-schedule-chevron', '›');
      chevron.setAttribute('aria-hidden', 'true');
      item.appendChild(chevron);
      var place = item.querySelector('.schedule-place');
      if (place) item.setAttribute('aria-label', place.textContent + 'を地図で表示');
      item.setAttribute('title', '地図でこの場所を表示');
    });
    panel.dataset.d26Upgraded = '1';
  }
  var uiReady = false;
  var leafletReady = false;
  var observer = null;
  var patchedLeaflet = patchLeaflet;
  patchLeaflet = function () {
    patchedLeaflet();
    leafletReady = !!(window.L && window.L.Map && window.L.Map.prototype._akagiD26Patched);
    stopInitObserverIfReady();
  };
  function stopInitObserverIfReady() {
    if (uiReady && leafletReady && observer) {
      observer.disconnect();
      observer = null;
    }
  }
  function tryInstallUi() {
    if (!uiReady) {
      installUi();
      uiReady = !!document.getElementById('d26-header');
    }
    if (uiReady && !noticeObserver) {
      var historyList = document.getElementById('noticeHistoryList');
      if (historyList) {
        // 15秒間隔の情報取得で更新される履歴部分だけを監視する。
        // 地図全体のDOMは監視せず、スマホの表示速度を維持する。
        noticeObserver = new MutationObserver(updateBellIndicator);
        noticeObserver.observe(historyList, {childList:true});
      }
    }
    if (uiReady && !scheduleObserver) {
      var schedulePanel = document.getElementById('schedulePanel');
      if (schedulePanel) {
        scheduleObserver = new MutationObserver(enhanceScheduleUi);
        // 予定一覧が描画されたタイミングだけ確認し、地図全体は監視しない。
        scheduleObserver.observe(schedulePanel, {childList:true});
      }
    }
    if (uiReady) {
      updateBellIndicator();
      enhanceScheduleUi();
    }
    stopInitObserverIfReady();
  }
  function beginWatch() {
    observer = new MutationObserver(function (mutations) {
      for (var i = 0; i < mutations.length; i++) {
        if (mutations[i].addedNodes && mutations[i].addedNodes.length) handleNewNodes(mutations[i].addedNodes);
      }
      tryInstallUi();
      if (window.L) patchLeaflet();
    });
    observer.observe(document.head, {childList:true, subtree:true});
    observer.observe(document.body, {childList:true});
    tryInstallUi();
    if (window.L) patchLeaflet();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', beginWatch, {once:true});
  } else beginWatch();
})();
// スマホの初期HTML読込を軽くするため、表示コード・CSSは外部ファイルに分離する。
(function () {
  // 画面スタイルの読み込みを確認してから既存アプリを開始する。
  // 初期サイズの判定がCSS適用前後で変わることを防ぐ。
  var css = document.createElement('link');
  css.rel = 'stylesheet';
  css.href = './rc3-d26m-ui.css?v=16-gps-alert-line-break';
  var domReady = document.readyState !== 'loading';
  var cssReady = false;
  var appStarted = false;
  function startWhenReady() {
    if (!domReady || !cssReady || appStarted) return;
    appStarted = true;
    var app = document.createElement('script');
    app.src = './app-public-rc3-d26m.js?v=9-popup-pan-guard';
    app.onerror = function () {
      var boot = document.getElementById('boot');
      if (boot) boot.textContent = '地図を読み込めませんでした。再読み込みしてください。';
      else console.error('app.js を読み込めませんでした。');
    };
    document.body.appendChild(app);
  }
  css.onload = css.onerror = function () { cssReady = true; startWhenReady(); };
  document.head.appendChild(css);
  if (!domReady) {
    document.addEventListener('DOMContentLoaded', function () {
      domReady = true; startWhenReady();
    }, {once:true});
  } else {
    startWhenReady();
  }
})();
