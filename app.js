(() => {
  const VERSION = '3';
  const LEAFLET_CSS = 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css';
  const LEAFLET_JS  = 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js';
  const MIKOSHI_IMAGE = './mikoshi_marker.png?v=' + VERSION;

  let map = null;
  let marker = null;
  let accuracyCircle = null;
  let firstLocation = true;
  let pollTimer = null;
  let activeJsonpScript = null;
  let responseTimer = null;
  let plannedRouteGroup = null;
  let routeBounds = null;
  let routeVisible = true;
  const stopMarkers = new Map();

  function loadStylesheet(url) {
    return new Promise((resolve, reject) => {
      const x = document.createElement('link');
      x.rel = 'stylesheet';
      x.href = url;
      x.onload = resolve;
      x.onerror = reject;
      document.head.appendChild(x);
    });
  }

  function loadScript(url) {
    return new Promise((resolve, reject) => {
      const x = document.createElement('script');
      x.src = url;
      x.async = true;
      x.onload = resolve;
      x.onerror = reject;
      document.body.appendChild(x);
    });
  }

  function installBody() {
    document.body.innerHTML =
      '<div id="message">地図の準備をしています…</div>' +
      '<div id="mapWrap">' +
        '<div id="map"></div>' +
        '<button id="mapControlsButton" class="map-ui-btn" type="button">地図操作</button>' +
        '<div id="mapControlsPanel" aria-hidden="true">' +
          '<button id="fitRouteQuickButton" type="button">予定経路全体を表示</button>' +
          '<button id="toggleRouteButton" type="button">予定経路を非表示にする</button>' +
          '<button id="scheduleButton" type="button">巡行予定を見る</button>' +
        '</div>' +
        '<button id="returnButton" class="map-ui-btn" type="button" disabled>神輿位置へ</button>' +
        '<div id="schedulePanel" aria-hidden="true"></div>' +
      '</div>' +
      '<div id="status"></div>' +
      '<div id="note">※予定時刻は進行状況により前後する場合があります。休憩中などは位置情報の更新間隔が空くことがあります。GPSや通信状況により、実際の場所から多少ずれる場合があります。</div>';
  }

  function setMessage(text) {
    const el = document.getElementById('message');
    if (!el) return;
    el.style.display = 'flex';
    el.textContent = text;
  }

  async function prepare() {
    await Promise.all([
      loadStylesheet('./style.css?v=' + VERSION),
      loadScript('./config.js?v=' + VERSION)
    ]);

    installBody();
    setMessage('地図の準備をしています…');

    await Promise.all([
      loadStylesheet(LEAFLET_CSS),
      loadScript(LEAFLET_JS),
      loadScript('./route-data.js?v=' + VERSION)
    ]);

    if (typeof L === 'undefined') {
      throw new Error('Leaflet not loaded');
    }

    initializeMap();
    addPlannedRoute();
    buildSchedulePanel();
    wireMapUi();

    document.getElementById('message').style.display = 'none';
    document.getElementById('mapWrap').style.display = 'block';
    document.getElementById('status').style.display = 'block';
    document.getElementById('note').style.display = 'block';

    if (routeBounds && routeBounds.isValid()) {
      map.fitBounds(routeBounds.pad(0.06));
    } else {
      map.setView([35.8485, 139.8961], 16);
    }

    requestAnimationFrame(() => map.invalidateSize());
    loadPublicState();
  }

  function initializeMap() {
    map = L.map('map', {zoomControl: true});

    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors'
    }).addTo(map);
  }

  function addPlannedRoute() {
    const data = window.MIKOSHI_ROUTE_DATA;
    if (!data || !Array.isArray(data.segments)) return;

    plannedRouteGroup = L.featureGroup().addTo(map);

    data.segments.forEach(segment => {
      const line = L.polyline(segment.coordinates, {
        color: '#586979',
        weight: 5,
        opacity: 0.82,
        dashArray: '8 7',
        lineCap: 'round',
        lineJoin: 'round'
      });

      line.bindPopup(
        '<strong>予定巡行路 ' + escapeHtml(segment.label) + '</strong><br>' +
        escapeHtml(segment.summary)
      );

      line.addTo(plannedRouteGroup);
    });

    if (Array.isArray(data.stops)) {
      data.stops.forEach(stop => {
        const m = L.circleMarker([stop.lat, stop.lon], {
          radius: 6,
          color: '#586979',
          weight: 2,
          fillColor: '#ffffff',
          fillOpacity: 1
        });

        m.bindPopup(
          '<strong>' + escapeHtml(stop.place) + '</strong><br>' +
          '<span style="color:#8A2D24;font-weight:bold">' + escapeHtml(stop.time) + '</span><br>' +
          escapeHtml(stop.note)
        );

        m.addTo(plannedRouteGroup);
        stopMarkers.set(stop.id, m);
      });
    }

    routeBounds = plannedRouteGroup.getBounds();
  }

  function buildSchedulePanel() {
    const data = window.MIKOSHI_ROUTE_DATA;
    const panel = document.getElementById('schedulePanel');
    if (!panel || !data) return;

    let html =
      '<div class="schedule-head">' +
        '<strong>巡行予定</strong>' +
        '<button id="scheduleClose" type="button" aria-label="閉じる">×</button>' +
      '</div>' +
      '<div class="schedule-summary">予定巡行路は地図上の点線です。地点を選ぶと、その場所を地図で確認できます。</div>' +
      '<button id="fitRouteButton" type="button">予定ルート全体を表示</button>' +
      '<div class="schedule-list">';

    data.stops.forEach(stop => {
      html +=
        '<button class="schedule-item" type="button" data-stop-id="' + stop.id + '">' +
          '<div class="schedule-time">' + escapeHtml(stop.time) + '</div>' +
          '<div>' +
            '<div class="schedule-place">' + escapeHtml(stop.place) + '</div>' +
            '<div class="schedule-note">' + escapeHtml(stop.note) + '</div>' +
          '</div>' +
        '</button>';
    });

    html += '</div>';
    panel.innerHTML = html;

    document.getElementById('scheduleClose').addEventListener('click', closeSchedule);
    document.getElementById('fitRouteButton').addEventListener('click', () => {
      fitPlannedRoute();
      closeSchedule();
    });

    panel.querySelectorAll('.schedule-item').forEach(button => {
      button.addEventListener('click', () => {
        const id = Number(button.dataset.stopId);
        focusStop(id);
        closeSchedule();
      });
    });
  }

  function wireMapUi() {
    document.getElementById('mapControlsButton').addEventListener('click', () => {
      const panel = document.getElementById('mapControlsPanel');
      const open = panel.classList.toggle('open');
      panel.setAttribute('aria-hidden', open ? 'false' : 'true');
    });

    document.getElementById('fitRouteQuickButton').addEventListener('click', () => {
      fitPlannedRoute();
      closeMapControls();
    });

    document.getElementById('toggleRouteButton').addEventListener('click', () => {
      setRouteVisible(!routeVisible);
    });

    document.getElementById('scheduleButton').addEventListener('click', () => {
      closeMapControls();
      const panel = document.getElementById('schedulePanel');
      panel.classList.add('open');
      panel.setAttribute('aria-hidden', 'false');
    });

    document.getElementById('returnButton').addEventListener('click', () => {
      if (marker) {
        map.setView(marker.getLatLng(), 17);
        marker.openPopup();
      }
    });

    map.on('click', closeMapControls);
  }

  function fitPlannedRoute() {
    if (routeBounds && routeBounds.isValid()) {
      map.fitBounds(routeBounds.pad(0.06));
    }
  }

  function setRouteVisible(visible) {
    if (!plannedRouteGroup) return;

    routeVisible = visible;

    if (visible) {
      if (!map.hasLayer(plannedRouteGroup)) {
        plannedRouteGroup.addTo(map);
      }
    } else if (map.hasLayer(plannedRouteGroup)) {
      map.removeLayer(plannedRouteGroup);
    }

    const button = document.getElementById('toggleRouteButton');
    if (button) {
      button.textContent = visible
        ? '予定経路を非表示にする'
        : '予定経路を表示する';
    }
  }

  function closeMapControls() {
    const panel = document.getElementById('mapControlsPanel');
    if (!panel) return;
    panel.classList.remove('open');
    panel.setAttribute('aria-hidden', 'true');
  }

  function focusStop(id) {
    const data = window.MIKOSHI_ROUTE_DATA;
    if (!data || !Array.isArray(data.stops)) return;

    const stop = data.stops.find(x => Number(x.id) === Number(id));
    if (!stop) return;

    const point = [stop.lat, stop.lon];
    map.setView(point, Math.max(map.getZoom(), 17));

    const markerForStop = stopMarkers.get(Number(id));

    if (routeVisible && markerForStop && map.hasLayer(plannedRouteGroup)) {
      markerForStop.openPopup();
    } else {
      L.popup()
        .setLatLng(point)
        .setContent(
          '<strong>' + escapeHtml(stop.place) + '</strong><br>' +
          '<span style="color:#8A2D24;font-weight:bold">' +
          escapeHtml(stop.time) + '</span><br>' +
          escapeHtml(stop.note)
        )
        .openOn(map);
    }
  }

  function closeSchedule() {
    const panel = document.getElementById('schedulePanel');
    if (!panel) return;
    panel.classList.remove('open');
    panel.setAttribute('aria-hidden', 'true');
  }

  function mikoshiIconFactory() {
    return L.divIcon({
      className: 'mikoshi-leaflet-icon',
      html:
        '<div class="mikoshi-pin">' +
          '<div class="mikoshi-badge">' +
            '<img src="' + MIKOSHI_IMAGE + '" alt="神輿">' +
          '</div>' +
        '</div>',
      iconSize: [70, 80],
      iconAnchor: [35, 77],
      popupAnchor: [0, -66]
    });
  }

  window.receiveMikoshiData = function(state) {
    clearResponseTimer();

    if (activeJsonpScript && activeJsonpScript.parentNode) {
      activeJsonpScript.parentNode.removeChild(activeJsonpScript);
    }
    activeJsonpScript = null;

    showState(state);
    scheduleNext();
  };

  function clearResponseTimer() {
    if (responseTimer) {
      clearTimeout(responseTimer);
      responseTimer = null;
    }
  }

  function scheduleNext() {
    if (pollTimer) clearTimeout(pollTimer);
    pollTimer = setTimeout(loadPublicState, 15000);
  }

  function loadPublicState() {
    const API_URL = window.MIKOSHI_API_URL || '';

    if (!API_URL || !API_URL.endsWith('/exec')) {
      document.getElementById('status').textContent = '位置情報APIが設定されていません。';
      return;
    }

    if (activeJsonpScript && activeJsonpScript.parentNode) {
      activeJsonpScript.parentNode.removeChild(activeJsonpScript);
    }

    activeJsonpScript = document.createElement('script');
    activeJsonpScript.src =
      API_URL +
      '?mode=public' +
      '&callback=receiveMikoshiData' +
      '&_=' + Date.now();

    activeJsonpScript.onerror = function() {
      clearResponseTimer();
      document.getElementById('status').textContent =
        '神輿の現在位置：通信を確認しています…';
      setTimeout(loadPublicState, 2000);
    };

    document.body.appendChild(activeJsonpScript);

    clearResponseTimer();
    responseTimer = setTimeout(function() {
      document.getElementById('status').textContent =
        '神輿の現在位置：通信を確認しています…';
      loadPublicState();
    }, 8000);
  }

  function showState(state) {
    if (!state || !state.isPublic) {
      hideCurrentLocation();
      document.getElementById('status').textContent =
        '神輿の現在位置：地図に表示していません';
      return;
    }

    if (!state.latest) {
      hideCurrentLocation();
      document.getElementById('status').textContent =
        '神輿の現在位置：位置情報を待っています';
      return;
    }

    showLocation(state.latest);
  }

  function hideCurrentLocation() {
    if (marker) {
      map.removeLayer(marker);
      marker = null;
    }

    if (accuracyCircle) {
      map.removeLayer(accuracyCircle);
      accuracyCircle = null;
    }

    firstLocation = true;
    document.getElementById('returnButton').disabled = true;
  }

  function showLocation(data) {
    const lat = Number(data.lat);
    const lon = Number(data.lon);
    const accuracy = Number(data.accuracy);

    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;

    const point = [lat, lon];

    if (!marker) {
      marker = L.marker(point, {
        icon: mikoshiIconFactory(),
        zIndexOffset: 1000
      }).addTo(map);
      marker.bindPopup('<strong>神輿の現在位置</strong>');
    } else {
      marker.setLatLng(point);
    }

    document.getElementById('returnButton').disabled = false;

    if (Number.isFinite(accuracy) && accuracy > 0) {
      if (!accuracyCircle) {
        accuracyCircle = L.circle(point, {
          radius: accuracy,
          color: '#8A2D24',
          weight: 1,
          opacity: 0.5,
          fillColor: '#8A2D24',
          fillOpacity: 0.05
        }).addTo(map);
      } else {
        accuracyCircle.setLatLng(point);
        accuracyCircle.setRadius(accuracy);
      }
    } else if (accuracyCircle) {
      map.removeLayer(accuracyCircle);
      accuracyCircle = null;
    }

    if (firstLocation) {
      map.setView(point, 17);
      firstLocation = false;
    }

    const updated = new Date(data.receivedAt);
    const seconds = Math.max(0, Math.floor((Date.now() - updated.getTime()) / 1000));

    let ageText;
    if (seconds < 60) {
      ageText = '1分以内';
    } else if (seconds < 3600) {
      ageText = Math.floor(seconds / 60) + '分前';
    } else {
      ageText = Math.floor(seconds / 3600) + '時間以上前';
    }

    const timeText = updated.toLocaleTimeString('ja-JP', {
      timeZone: 'Asia/Tokyo',
      hour: '2-digit',
      minute: '2-digit'
    });

    let accuracyText = '';
    if (Number.isFinite(accuracy) && accuracy > 0) {
      accuracyText = '　位置精度：約' + Math.round(accuracy) + 'm';
    }

    let sourceText = '';
    if (data.source === 'default') {
      sourceText = '　赤城神社（初期位置）';
    }

    document.getElementById('status').textContent =
      '最終更新 ' + timeText + '（' + ageText + '）' +
      accuracyText + sourceText;

    marker.setPopupContent(
      '<strong>神輿の現在位置</strong><br>' +
      (data.source === 'default'
        ? '赤城神社（初期位置）<br>'
        : '') +
      '最終更新 ' + timeText +
      (Number.isFinite(accuracy) && accuracy > 0
        ? '<br>位置精度：約' + Math.round(accuracy) + 'm'
        : '')
    );
  }

  function refreshImmediately() {
    if (pollTimer) clearTimeout(pollTimer);
    clearResponseTimer();
    loadPublicState();
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  document.addEventListener('visibilitychange', function() {
    if (document.visibilityState === 'visible' && map) refreshImmediately();
  });

  window.addEventListener('pageshow', function() {
    if (map) refreshImmediately();
  });

  window.addEventListener('online', function() {
    if (map) refreshImmediately();
  });

  prepare().catch(function(err) {
    console.error(err);
    installBody();
    setMessage('地図の準備に失敗しました。ページを再読み込みしてください。');
  });
})();
