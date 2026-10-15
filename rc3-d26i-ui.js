/* 赤城神社例大祭 神輿巡行マップ - RC3-D2.6i UIテスト用追加コード
 * RC3-D2.5の app.js / API / 経路データは変更しない。
 * 本ファイルは test-rc3-d26i.html 専用。公開 index.html に影響しない。
 */
(function () {
  'use strict';

  var APP_VERSION = 'RC3-D2.6i（画面最終調整テスト）';
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
    updateInfo.innerHTML = '<svg class="d26-refresh-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 11a8 8 0 0 0-14.2-4.8L4 8"/><path d="M4 4v4h4"/><path d="M4 13a8 8 0 0 0 14.2 4.8L20 16"/><path d="M20 20v-4h-4"/></svg><span class="d26-refresh-label">自動更新：' + refreshText + '</span>';
    var helpButton = button('', '自動更新についての説明', 'update', 'd26-info-tap');
    helpButton.innerHTML = '<svg class="d26-help-icon" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 11v6"/><circle cx="12" cy="7.5" r="1.1" fill="currentColor" stroke="none"/></svg>';
    updateInfo.appendChild(helpButton);
    footer.appendChild(updateInfo);

    var footerActions = el('div', 'd26-footer-actions');
    var scheduleInfoButton = button('', '予定時刻についての説明', 'schedule-info', 'd26-footer-button');
    scheduleInfoButton.textContent = '予定時刻';
    var guideButton = button('', 'ご利用案内を表示', 'guide', 'd26-footer-button');
    guideButton.textContent = 'ご利用案内';
    footerActions.appendChild(scheduleInfoButton);
    footerActions.appendChild(guideButton);
    footer.appendChild(footerActions);
    var status = document.getElementById('status');
    // 通信失敗等の状態表示は本体側が更新するため、その直後にボタン列を置く。
    if (status) status.insertAdjacentElement('afterend', footer);
    else mapWrap.insertAdjacentElement('afterend', footer);

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
  var menuHtml = [
    '<div class="d26-menu-list">',
    '<button type="button" data-d26-action="notice">お知らせ <span>›</span></button>',
    '<button type="button" data-d26-action="schedule">巡行予定を見る <span>›</span></button>',
    '<button type="button" data-d26-action="fit">巡行ルート全体を表示 <span>›</span></button>',
    '<button type="button" data-d26-action="schedule-info">予定時刻について <span>›</span></button>',
    '<button type="button" data-d26-action="update">自動更新について <span>›</span></button>',
    '<button type="button" data-d26-action="guide">地図の使い方・ご利用案内 <span>›</span></button>',
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
    if (action === 'update') {
      openDialog('自動更新について',
        '<p>このページを開いている間、神輿の位置情報とお知らせを約15秒ごとに自動的に取得します。</p>' +
        '<p>ページを閉じている間、スマートフォンにプッシュ通知が届く仕組みではありません。</p>' +
        '<p>地図に表示される「最終更新」は、神輿の現在位置を知らせるGPS端末から送られた位置情報を、システムが最後に受信・記録した時刻です。</p>' +
        '<p>GPSの受信状況や通信環境により、位置の更新が遅れたり、実際の位置と多少ずれたりする場合があります。</p>');
      return;
    }
    if (action === 'schedule-info') {
      openDialog('予定時刻について',
        '<p>巡行予定時刻は目安です。実際の進行状況や交通事情、休憩などにより前後する場合があります。</p>' +
        '<p>地図の各予定地点をタップすると、その場所の予定を確認できます。</p>' +
        '<button type="button" class="d26-primary" data-d26-action="schedule">巡行予定を見る</button>');
      return;
    }
    if (action === 'guide') {
      openDialog('ご利用案内',
        '<p><strong>神輿の現在位置</strong>は地図上の神輿マークで確認できます。位置情報が非公開または未受信のときは、予定ルートだけが表示されます。</p>' +
        '<p><strong>地図の操作：</strong>指で移動・拡大縮小できます。＋／－は細かな倍率に対応します。「地図操作」から、予定経路の表示切替や神輿位置への移動ができます。</p>' +
        '<p><strong>表示上の注意：</strong>休憩中などは位置情報の更新間隔が空くことがあります。GPSや通信状況によって実際の位置から多少ずれる場合があります。</p>' +
        '<p>歩行中は画面を操作せず、安全な場所で確認してください。</p>');
      return;
    }
    if (action === 'about') {
      openDialog('このサイトについて',
        '<p><strong>流山・赤城神社例大祭｜神輿巡行マップ</strong></p>' +
        '<p>2026年10月18日（日）の神輿巡行について、現在地・巡行予定・お知らせをご案内するページです。</p>' +
        '<p>祭礼案内：<a href="https://sites.google.com/view/syuku26/%E8%B5%A4%E5%9F%8E%E7%A5%9E%E7%A4%BE%E4%BE%8B%E5%A4%A7%E7%A5%AD" target="_blank" rel="noopener noreferrer">赤城神社例大祭の案内ページ（別画面）</a></p>' +
        '<p>バージョン：' + APP_VERSION + '<br>地図・通信処理：RC3-D2.5を継続利用</p>');
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
    if (uiReady) updateBellIndicator();
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
  css.href = './rc3-d26i-ui.css?v=1';
  var domReady = document.readyState !== 'loading';
  var cssReady = false;
  var appStarted = false;
  function startWhenReady() {
    if (!domReady || !cssReady || appStarted) return;
    appStarted = true;
    var app = document.createElement('script');
    app.src = './app.js?v=14';
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
