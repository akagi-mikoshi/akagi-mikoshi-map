(() => {
  const VERSION = '14';
  const LEAFLET_CSS = 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css';
  const LEAFLET_JS  = 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js';
  const MIKOSHI_IMAGE = './mikoshi_marker.png?v=' + VERSION;
  const TEST_MODE =
    new URLSearchParams(window.location.search).get('test') === '1';
  const POLL_INTERVAL_MS = TEST_MODE ? 2000 : 15000;
  const SYSTEM_VERSION = 'RC3-D2.5';
  const PUBLIC_RELEASE = 'RC3-D2.6m';
  let currentNoticeId = null;
  let currentNoticeHistory = [];

  let map = null;
  let marker = null;
  let accuracyCircle = null;
  let initialStateResolved = false;
  let pollTimer = null;
  let activeJsonpScript = null;
  let responseTimer = null;
  let requestSequence = 0;
  let activeCallbackName = null;
  let requestInFlight = false;
  let consecutiveFailures = 0;
  let lastSuccessfulResponseAt = null;
  let lastGoodState = null;
  let pausedForHidden = false;
  let publicUiReady = false;
  let visibleFailureStartedAt = null;
  let lastWindowBlurAt = null;
  let lastPublicResumeAt = 0;
  let plannedRouteGroup = null;
  let routeBounds = null;
  let routeVisible = true;

  let actualTrailLayer = null;
  let actualTrailVisible = true;
  let actualTrailHasData = false;

  let routeVertices = [];
  let routeEdges = [];
  let routeTotalLength = 0;
  // Staging only: expected boundaries by occurrence along the full route.
  let stageSegmentBoundaries = [];

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
        '<div id="noticeDock" class="notice-overlay hidden">' +
          '<div id="noticePanel" class="notice-panel">' +
            '<div class="notice-head"><strong id="noticeTitle">お知らせ</strong><button id="noticeClose" type="button" aria-label="閉じる">×</button></div>' +
            '<div id="noticeText"></div>' +
            '<div id="noticeUpdated"></div>' +
          '</div>' +
        '</div>' +
        '<div id="noticeHistoryPanel" class="notice-history-panel hidden">' +
          '<div class="notice-head"><strong>お知らせ履歴（最大3件）</strong><button id="noticeHistoryClose" type="button" aria-label="閉じる">×</button></div>' +
          '<div id="noticeHistoryList"></div>' +
        '</div>' +
        '<button id="noticeCollapsed" class="notice-collapsed hidden" type="button" aria-label="お知らせ履歴を表示">お知らせ</button>' +
        '<button id="mapControlsButton" class="map-ui-btn" type="button">地図の表示設定</button>' +
        '<div id="mapControlsPanel" aria-hidden="true">' +
          '<button id="fitRouteQuickButton" type="button">予定経路全体を表示</button>' +
          '<button id="toggleRouteButton" type="button">予定経路を非表示にする</button>' +
          '<button id="toggleActualTrailButton" type="button" disabled>通過済み経路：まだありません</button>' +
          '<button id="scheduleButton" type="button">巡行地点・予定時刻一覧</button>' +
        '</div>' +
        '<button id="returnButton" class="map-ui-btn" type="button" disabled>神輿位置へ</button>' +
        '<div id="simulationBadge">シミュレーション中</div>' +
        '<div id="routeLegend"><span class="legend-actual"></span>通過済み <span class="legend-plan"></span>予定経路 <span class="legend-stop"></span>予定地点</div>' +
        '<div id="schedulePanel" aria-hidden="true"></div>' +
      '</div>' +
      '<div id="status"></div>' +
      '<div id="updateInfo"><div class="update-main"><strong>自動更新：約' + (POLL_INTERVAL_MS / 1000) + '秒ごと</strong><button id="updateInfoBtn" class="inline-info" type="button" aria-label="更新について">ⓘ</button></div><div class="update-version">' + PUBLIC_RELEASE + '</div></div>' +
      '<div id="note">※予定時刻は進行状況により前後する場合があります。休憩中などは位置情報の更新間隔が空くことがあります。GPSや通信状況により、実際の場所から多少ずれる場合があります。</div>' +
      '<div id="publicInfoModal" class="modal hidden"><div class="modal-card"><div class="modal-head"><strong>自動更新について</strong><button id="publicInfoClose" type="button">×</button></div><div class="modal-body">このページを開いている間、位置情報とお知らせを自動的に更新します。スマートフォンへのプッシュ通知ではないため、ページを閉じている間に通知が届く機能ではありません。</div></div></div>';
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
    buildRouteModel();
    buildSchedulePanel();
    wireMapUi();

    document.getElementById('message').style.display = 'none';
    document.getElementById('mapWrap').style.display = 'block';
    document.getElementById('status').style.display = 'block';
    document.getElementById('note').style.display = 'block';
    document.getElementById('updateInfo').style.display = 'block';

    wireNoticeUi_();

    if (routeBounds && routeBounds.isValid()) {
      map.fitBounds(routeBounds.pad(0.06));
    } else {
      map.setView([35.8485, 139.8961], 16);
    }

    requestAnimationFrame(() => map.invalidateSize());
    publicUiReady = true;
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
          radius: 8,
          color: '#586979',
          weight: 3,
          fillColor: '#ffffff',
          fillOpacity: 1
        });

        // 地図上のポップアップは簡潔にする。
        // 時刻と「着・休憩・発」の情報は stop.note にまとまっているため、
        // stop.time を重ねて表示しない。
        m.bindPopup(
          '<strong>' + escapeHtml(stop.place) + '</strong><br>' +
          '<span style="color:#8A2D24;font-weight:bold">' +
          escapeHtml(stop.note) +
          '</span>'
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
        '<strong>巡行地点・予定時刻一覧</strong>' +
        '<button id="scheduleClose" type="button" aria-label="閉じる">×</button>' +
      '</div>' +
      '<div class="schedule-summary">灰色の点線が予定巡行路、赤茶色の実線が通過済み経路です。地点を選ぶと、その場所を地図で確認できます。</div>' +
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

    document.getElementById('toggleActualTrailButton').addEventListener('click', () => {
      setActualTrailVisible(!actualTrailVisible);
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

  function setActualTrailVisible(visible) {
    actualTrailVisible = visible;

    if (actualTrailLayer) {
      if (visible && actualTrailHasData) {
        if (!map.hasLayer(actualTrailLayer)) {
          actualTrailLayer.addTo(map);
        }
      } else if (map.hasLayer(actualTrailLayer)) {
        map.removeLayer(actualTrailLayer);
      }
    }

    updateActualTrailButton();
  }

  function updateActualTrailButton() {
    const button = document.getElementById('toggleActualTrailButton');
    if (!button) return;

    button.disabled = !actualTrailHasData;

    if (!actualTrailHasData) {
      button.textContent = '通過済み経路：まだありません';
      return;
    }

    button.textContent = actualTrailVisible
      ? '通過済み経路を非表示にする'
      : '通過済み経路を表示する';
  }

  function buildRouteModel() {
    const data = window.MIKOSHI_ROUTE_DATA;

    routeVertices = [];
    routeEdges = [];
    routeTotalLength = 0;
    stageSegmentBoundaries = [];

    if (!data || !Array.isArray(data.segments)) return;

    const all = [];

    data.segments.forEach(segment => {
      if (!Array.isArray(segment.coordinates)) return;

      segment.coordinates.forEach(coord => {
        if (
          !Array.isArray(coord) ||
          coord.length < 2
        ) return;

        const point = [
          Number(coord[0]),
          Number(coord[1])
        ];

        if (
          !Number.isFinite(point[0]) ||
          !Number.isFinite(point[1])
        ) return;

        const prev = all[all.length - 1];

        if (
          prev &&
          Math.abs(prev[0] - point[0]) < 1e-9 &&
          Math.abs(prev[1] - point[1]) < 1e-9
        ) {
          return;
        }

        all.push(point);
      });
      // Each route segment is a separate occurrence, even on the same physical road.
      stageSegmentBoundaries.push({id: segment.id, endIndex: all.length - 1});
    });

    if (all.length < 2) return;

    routeVertices.push({
      lat: all[0][0],
      lon: all[0][1],
      progress: 0
    });

    for (let i = 1; i < all.length; i++) {
      const a = all[i - 1];
      const b = all[i];
      const length = distanceMeters(a, b);

      if (!Number.isFinite(length) || length <= 0) continue;

      const start = routeTotalLength;
      routeTotalLength += length;

      routeEdges.push({
        a: a,
        b: b,
        start: start,
        length: length
      });

      routeVertices.push({
        lat: b[0],
        lon: b[1],
        progress: routeTotalLength
      });
    }
    updateStageAudit_(null, 0);
  }

  function updateStageAudit_(progress, pointCount) {
    const value = Number.isFinite(progress)
      ? Math.max(0, Math.min(routeTotalLength, progress)) : null;
    let prev = 0;
    const sections = stageSegmentBoundaries.map(section => {
      const vertex = routeVertices[section.endIndex];
      const end = vertex ? vertex.progress : prev;
      const length = Math.max(0, end - prev);
      const passed = value === null ? null
        : Math.min(length, Math.max(0, value - prev));
      const item = { id: section.id, lengthMeters: length, progressMeters: passed };
      prev = end;
      return item;
    });
    window.MIKOSHI_STAGING_AUDIT = {
      progressMeters: value, totalMeters: routeTotalLength,
      trailPointCount: pointCount, sections: sections
    };
  }

  function updateActualTrail(trail) {
    const points = Array.isArray(trail) ? trail : [];
    const progress = findRouteProgress(points);
    updateStageAudit_(progress, points.length);

    if (
      !Number.isFinite(progress) ||
      progress < 3
    ) {
      actualTrailHasData = false;

      if (actualTrailLayer) {
        actualTrailLayer.setLatLngs([]);

        if (map.hasLayer(actualTrailLayer)) {
          map.removeLayer(actualTrailLayer);
        }
      }

      updateActualTrailButton();
      return;
    }

    const line = routeCoordinatesUntil(progress);

    if (line.length < 2) {
      actualTrailHasData = false;
      updateActualTrailButton();
      return;
    }

    actualTrailHasData = true;

    if (!actualTrailLayer) {
      actualTrailLayer = L.polyline(line, {
        color: '#8A2D24',
        weight: 7,
        opacity: 0.92,
        lineCap: 'round',
        lineJoin: 'round'
      });
    } else {
      actualTrailLayer.setLatLngs(line);
    }

    if (
      actualTrailVisible &&
      !map.hasLayer(actualTrailLayer)
    ) {
      actualTrailLayer.addTo(map);
    }

    updateActualTrailButton();
  }

  function findRouteProgress(trail) {
    if (
      !routeEdges.length ||
      !Array.isArray(trail) ||
      !trail.length
    ) {
      return null;
    }

    let progress = null;
    let lastTime = null;

    for (const raw of trail) {
      const point = trailPoint_(raw);

      if (!point) continue;

      const time = point.time
        ? new Date(point.time).getTime()
        : null;

      let maxForward = Infinity;

      if (
        progress !== null &&
        lastTime !== null &&
        Number.isFinite(time)
      ) {
        const elapsedSec =
          Math.max(0, (time - lastTime) / 1000);

        // 神輿の通常速度より十分余裕を持たせる。
        // 長時間更新が空いた場合は、その分だけ前方への許容量も増やす。
        maxForward = Math.max(
          220,
          Math.min(1600, 120 + elapsedSec * 2.2)
        );
      }

      const candidate = nearestRouteProjection_(
        [point.lat, point.lon],
        progress,
        maxForward
      );

      if (
        candidate &&
        candidate.distance <= 70
      ) {
        progress =
          progress === null
            ? candidate.progress
            : Math.max(progress, candidate.progress);

        if (Number.isFinite(time)) {
          lastTime = time;
        }
      }
    }

    return progress;
  }

  function nearestRouteProjection_(point, currentProgress, maxForward) {
    let best = null;

    for (const edge of routeEdges) {
      const p = projectToEdge_(point, edge);

      if (!p) continue;

      if (currentProgress !== null) {
        // GPS揺れによる少しの後戻りは許容するが、
        // 大きな後戻りや不自然な先飛びは候補から外す。
        if (p.progress < currentProgress - 90) {
          continue;
        }

        if (
          Number.isFinite(maxForward) &&
          p.progress > currentProgress + maxForward
        ) {
          continue;
        }
      }

      if (
        !best ||
        p.distance < best.distance
      ) {
        best = p;
      }
    }

    return best;
  }

  function projectToEdge_(point, edge) {
    const lat0 =
      (point[0] + edge.a[0] + edge.b[0]) / 3;

    const kLat = 111320;
    const kLon =
      111320 *
      Math.cos(lat0 * Math.PI / 180);

    const ax = edge.a[1] * kLon;
    const ay = edge.a[0] * kLat;
    const bx = edge.b[1] * kLon;
    const by = edge.b[0] * kLat;
    const px = point[1] * kLon;
    const py = point[0] * kLat;

    const dx = bx - ax;
    const dy = by - ay;
    const denom = dx * dx + dy * dy;

    if (denom <= 0) return null;

    let t =
      ((px - ax) * dx + (py - ay) * dy) /
      denom;

    t = Math.max(0, Math.min(1, t));

    const qx = ax + t * dx;
    const qy = ay + t * dy;

    const distance =
      Math.sqrt(
        (px - qx) * (px - qx) +
        (py - qy) * (py - qy)
      );

    return {
      distance: distance,
      progress: edge.start + edge.length * t,
      lat: edge.a[0] + (edge.b[0] - edge.a[0]) * t,
      lon: edge.a[1] + (edge.b[1] - edge.a[1]) * t
    };
  }

  function routeCoordinatesUntil(progress) {
    if (
      !routeVertices.length ||
      !Number.isFinite(progress)
    ) {
      return [];
    }

    const clamped =
      Math.max(
        0,
        Math.min(routeTotalLength, progress)
      );

    const result = [];

    for (const v of routeVertices) {
      if (v.progress <= clamped) {
        result.push([v.lat, v.lon]);
      } else {
        break;
      }
    }

    const edge = routeEdges.find(e =>
      clamped >= e.start &&
      clamped <= e.start + e.length
    );

    if (edge) {
      const t =
        edge.length > 0
          ? (clamped - edge.start) / edge.length
          : 0;

      const endPoint = [
        edge.a[0] + (edge.b[0] - edge.a[0]) * t,
        edge.a[1] + (edge.b[1] - edge.a[1]) * t
      ];

      const last = result[result.length - 1];

      if (
        !last ||
        distanceMeters(last, endPoint) > 1
      ) {
        result.push(endPoint);
      }
    }

    return result;
  }

  function trailPoint_(raw) {
    if (Array.isArray(raw)) {
      const lat = Number(raw[0]);
      const lon = Number(raw[1]);

      if (
        Number.isFinite(lat) &&
        Number.isFinite(lon)
      ) {
        return {
          lat: lat,
          lon: lon,
          time: raw[2] || null
        };
      }
    }

    if (raw && typeof raw === 'object') {
      const lat = Number(raw.lat);
      const lon = Number(raw.lon);

      if (
        Number.isFinite(lat) &&
        Number.isFinite(lon)
      ) {
        return {
          lat: lat,
          lon: lon,
          time: raw.receivedAt || raw.time || null
        };
      }
    }

    return null;
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

  function finishPublicRequest_(callbackName) {
    clearResponseTimer();
    if (activeJsonpScript && activeJsonpScript.parentNode) {
      activeJsonpScript.parentNode.removeChild(activeJsonpScript);
    }
    activeJsonpScript = null;
    if (callbackName) {
      try { delete window[callbackName]; }
      catch (e) { window[callbackName] = undefined; }
    }
    activeCallbackName = null;
    requestInFlight = false;
  }

  function clearResponseTimer() {
    if (responseTimer) {
      clearTimeout(responseTimer);
      responseTimer = null;
    }
  }

  function scheduleNext(delayMs = POLL_INTERVAL_MS) {
    if (pollTimer) clearTimeout(pollTimer);
    pollTimer = null;
    if (!publicUiReady || document.visibilityState === 'hidden') {
      pausedForHidden = true;
      return;
    }
    pollTimer = setTimeout(loadPublicState, delayMs);
  }

  function recordPublicFailure_() {
    // 画面ロック中の停止・通信タイムアウトは利用者向けの警告に数えない。
    if (document.visibilityState === 'hidden') {
      pausedForHidden = true;
      return;
    }
    // A short disruption on screen wake or network switching is not a public warning.
    if (visibleFailureStartedAt === null) visibleFailureStartedAt = Date.now();
    consecutiveFailures += 1;
    const failureDurationMs = Date.now() - visibleFailureStartedAt;
    // Allow recovery without alarming viewers; retain a warning for sustained outages.
    const warningAfterMs = lastGoodState ? 45000 : 20000;
    if (consecutiveFailures >= 2 && failureDurationMs >= warningAfterMs) {
      const last = lastSuccessfulResponseAt
        ? new Date(lastSuccessfulResponseAt).toLocaleTimeString('ja-JP',
            {timeZone:'Asia/Tokyo',hour:'2-digit',minute:'2-digit'})
        : null;
      document.getElementById('status').textContent =
        last
          ? '⚠ 最新情報が更新されていません（最終取得 ' + last +
            '）。神輿位置はその時点の情報です。自動的に再接続を試みています。'
          : '⚠ 最新情報を一時的に取得できません。予定ルートは確認できます。自動的に再接続を試みています。';
      document.getElementById('status').classList.add('connection-error');
    } else if (!lastGoodState) {
      document.getElementById('status').textContent = '最新情報を確認しています…';
    }
    // 表示中に通信失敗が続く場合も、重複送信せず間隔を広げて再試行する。
    scheduleNext(Math.min(30000, 3000 * Math.pow(2, Math.min(consecutiveFailures - 1, 3))));
  }

  function publicRequestFailed_(callbackName) {
    if (!requestInFlight || activeCallbackName !== callbackName) return;
    finishPublicRequest_(callbackName);
    recordPublicFailure_();
  }

  function loadPublicState() {
    if (!publicUiReady || document.visibilityState === 'hidden') {
      pausedForHidden = true;
      return;
    }
    if (requestInFlight) return;
    if (pollTimer) {
      clearTimeout(pollTimer);
      pollTimer = null;
    }
    const API_URL = window.MIKOSHI_API_URL || '';
    if (!API_URL || !API_URL.endsWith('/exec')) {
      document.getElementById('status').textContent = '⚠ 位置情報サービスの設定を確認してください。';
      document.getElementById('status').classList.add('connection-error');
      return;
    }

    const id = ++requestSequence;
    const callbackName = '__mikoshiPublic_' + id;
    const script = document.createElement('script');
    requestInFlight = true;
    activeCallbackName = callbackName;
    activeJsonpScript = script;

    window[callbackName] = state => {
      if (activeCallbackName !== callbackName || !requestInFlight) return;
      finishPublicRequest_(callbackName);
      if (document.visibilityState === 'hidden') {
        pausedForHidden = true;
        return;
      }
      if (!state || typeof state.isPublic !== 'boolean') {
        recordPublicFailure_();
        return;
      }
      consecutiveFailures = 0;
      visibleFailureStartedAt = null;
      lastSuccessfulResponseAt = Date.now();
      lastGoodState = state;
      document.getElementById('status').classList.remove('connection-error');
      showState(state);
      scheduleNext();
    };

    script.src = API_URL + '?mode=public&callback=' + callbackName + '&_=' + Date.now();
    script.async = true;
    script.onerror = () => publicRequestFailed_(callbackName);
    document.body.appendChild(script);
    clearResponseTimer();
    responseTimer = setTimeout(() => publicRequestFailed_(callbackName), 10000);
  }

  function suspendPublicPolling_() {
    pausedForHidden = true;
    if (pollTimer) {
      clearTimeout(pollTimer);
      pollTimer = null;
    }
    if (requestInFlight) finishPublicRequest_(activeCallbackName);
    // 画面ロック前の一時的な通信失敗を、復帰後へ持ち越さない。
    consecutiveFailures = 0;
    visibleFailureStartedAt = null;
  }

  function resumePublicPolling_() {
    if (!publicUiReady || !map || document.visibilityState === 'hidden') return;
    // visibilitychange, pageshow and focus may fire together after unlocking.
    if (requestInFlight && Date.now() - lastPublicResumeAt < 1000) return;
    lastPublicResumeAt = Date.now();
    if (pollTimer) {
      clearTimeout(pollTimer);
      pollTimer = null;
    }
    if (requestInFlight) finishPublicRequest_(activeCallbackName);
    pausedForHidden = false;
    consecutiveFailures = 0;
    visibleFailureStartedAt = null;
    const status = document.getElementById('status');
    status.classList.remove('connection-error');
    status.textContent = '最新情報を確認しています…';
    loadPublicState();
  }

  function showState(state) {
    updateNotice_(state ? state.notice : null, state && Array.isArray(state.noticeHistory) ? state.noticeHistory : []);

    setSimulationBadge(
      !!(state && state.isSimulation) ||
      !!(state && state.latest && state.latest.source === 'simulation')
    );

    if (!state || !state.isPublic) {
      hideCurrentLocation();
      updateActualTrail([]);
      document.getElementById('status').textContent =
        '神輿の現在位置：地図に表示していません';

      // 最初の応答が「非表示」だった場合、
      // 後から表示に変わっても地図倍率を勝手に変更しない。
      initialStateResolved = true;
      return;
    }

    if (!state.latest) {
      hideCurrentLocation();
      updateActualTrail([]);
      document.getElementById('status').textContent =
        '神輿の現在位置：位置情報を待っています';

      initialStateResolved = true;
      return;
    }

    const wasInitialState = !initialStateResolved;
    initialStateResolved = true;

    // リロード時は神輿の表示有無にかかわらず、
    // prepare() で設定した予定経路全体の縮尺・位置を維持する。
    // 非表示→表示の切替時だけ、倍率を変えずに神輿位置へ移動する。
    showLocation(state.latest, !wasInitialState);
    updateActualTrail(state.trail || []);
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

    document.getElementById('returnButton').disabled = true;
  }

  function showLocation(data, shouldPanToMarker) {
    const lat = Number(data.lat);
    const lon = Number(data.lon);
    const accuracy = Number(data.accuracy);

    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;

    const point = [lat, lon];

    const isNewMarker = !marker;

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

    if (shouldPanToMarker && isNewMarker) {
      // 管理画面で「非表示→表示」に切り替わった時だけ、
      // 現在の倍率を維持したまま神輿位置へ移動する。
      map.panTo(point);
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
    } else if (data.source === 'simulation') {
      sourceText = '　【テスト位置】';
    }

    document.getElementById('status').textContent =
      '最終更新 ' + timeText + '（' + ageText + '）' +
      accuracyText + sourceText;

    marker.setPopupContent(
      '<strong>神輿の現在位置</strong><br>' +
      (data.source === 'default'
        ? '赤城神社（初期位置）<br>'
        : data.source === 'simulation'
          ? '<strong>シミュレーション中</strong><br>'
          : '') +
      '最終更新 ' + timeText +
      (Number.isFinite(accuracy) && accuracy > 0
        ? '<br>位置精度：約' + Math.round(accuracy) + 'm'
        : '')
    );
  }

  function wireNoticeUi_() {
    document.getElementById('noticeClose').addEventListener('click', () => {
      if (currentNoticeId) {
        try {
          localStorage.setItem(
            'mikoshiStagingDismissedNoticeId',
            currentNoticeId
          );
        } catch (e) {}
      }

      hideCurrentNotice_();
      showNoticeButton_();
    });

    document.getElementById('noticeCollapsed').addEventListener('click', () => {
      hideCurrentNotice_();
      renderNoticeHistory_();
      document.getElementById('noticeCollapsed').classList.add('hidden');
      document.getElementById('noticeHistoryPanel').classList.remove('hidden');
    });

    document.getElementById('noticeHistoryClose').addEventListener('click', () => {
      document.getElementById('noticeHistoryPanel').classList.add('hidden');
      showNoticeButton_();
    });

    document.getElementById('updateInfoBtn').addEventListener('click', () => {
      document.getElementById('publicInfoModal').classList.remove('hidden');
    });

    document.getElementById('publicInfoClose').addEventListener('click', () => {
      document.getElementById('publicInfoModal').classList.add('hidden');
    });

    document.getElementById('publicInfoModal').addEventListener('click', e => {
      if (e.target.id === 'publicInfoModal') {
        document.getElementById('publicInfoModal').classList.add('hidden');
      }
    });
  }

  function updateNotice_(notice, history) {
    const dock = document.getElementById('noticeDock');
    const panel = document.getElementById('noticePanel');
    const historyPanel = document.getElementById('noticeHistoryPanel');

    currentNoticeHistory = Array.isArray(history)
      ? history.slice(0, 3)
      : [];

    renderNoticeHistory_();
    updateNoticeButtonLabel_();

    const historyOpen =
      !historyPanel.classList.contains('hidden');

    if (!notice || !notice.id || !notice.text) {
      currentNoticeId = null;
      hideCurrentNotice_();

      if (!historyOpen) {
        showNoticeButton_();
      }

      return;
    }

    const previousId = currentNoticeId;
    currentNoticeId = notice.id;

    let dismissedId = '';

    try {
      dismissedId =
        localStorage.getItem('mikoshiStagingDismissedNoticeId') || '';
    } catch (e) {}

    const isNew =
      !!previousId &&
      previousId !== notice.id;

    const wasDismissed =
      dismissedId === notice.id;

    panel.className =
      'notice-panel ' +
      (notice.level === 'important' ? 'important' : 'normal');

    document.getElementById('noticeTitle').textContent =
      isNew ? '新しいお知らせ' : 'お知らせ';

    document.getElementById('noticeText').textContent =
      notice.text;

    document.getElementById('noticeUpdated').textContent =
      '更新 ' + formatNoticeTime_(notice.updatedAt);

    if (isNew) {
      historyPanel.classList.add('hidden');
      document.getElementById('noticeCollapsed').classList.add('hidden');
      dock.classList.remove('hidden');
      panel.classList.remove('hidden');
      return;
    }

    if (historyOpen) {
      dock.classList.add('hidden');
      document.getElementById('noticeCollapsed').classList.add('hidden');
      return;
    }

    if (!wasDismissed) {
      dock.classList.remove('hidden');
      panel.classList.remove('hidden');
      document.getElementById('noticeCollapsed').classList.add('hidden');
    } else {
      hideCurrentNotice_();
      showNoticeButton_();
    }
  }

  function hideCurrentNotice_() {
    document.getElementById('noticeDock').classList.add('hidden');
    document.getElementById('noticePanel').classList.add('hidden');
  }

  function showNoticeButton_() {
    const btn = document.getElementById('noticeCollapsed');

    if (currentNoticeHistory.length) {
      updateNoticeButtonLabel_();
      btn.classList.remove('hidden');
    } else {
      btn.classList.add('hidden');
    }
  }

  function updateNoticeButtonLabel_() {
    const btn = document.getElementById('noticeCollapsed');
    const count = currentNoticeHistory.length;
    const hasCurrentNotice =
      !!(
        currentNoticeId &&
        document.getElementById('noticeText').textContent
      );

    if (count <= 0) {
      btn.textContent = 'お知らせ';
      return;
    }

    btn.textContent =
      hasCurrentNotice
        ? 'お知らせ（' + count + '）'
        : 'お知らせ履歴（' + count + '）';
  }

  function renderNoticeHistory_() {
    const list = document.getElementById('noticeHistoryList');

    if (!list) return;

    if (!currentNoticeHistory.length) {
      list.innerHTML =
        '<div class="notice-history-empty">お知らせ履歴はありません。</div>';
      return;
    }

    list.innerHTML = '';

    currentNoticeHistory.forEach((item, index) => {
      const row = document.createElement('div');
      row.className =
        'notice-history-item ' +
        (item.level === 'important' ? 'important' : 'normal');

      const head = document.createElement('div');
      head.className = 'notice-history-meta';
      head.textContent =
        (index === 0 ? '最新　' : '') +
        formatNoticeTime_(item.updatedAt) +
        (item.level === 'important' ? '　重要' : '');

      const text = document.createElement('div');
      text.className = 'notice-history-text';
      text.textContent = item.text;

      row.appendChild(head);
      row.appendChild(text);
      list.appendChild(row);
    });
  }

  function formatNoticeTime_(value) {
    if (!value) return '—';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '—';

    return d.toLocaleTimeString(
      'ja-JP',
      {
        timeZone: 'Asia/Tokyo',
        hour: '2-digit',
        minute: '2-digit'
      }
    );
  }

  function setSimulationBadge(show) {
    const badge = document.getElementById('simulationBadge');
    const wrap = document.getElementById('mapWrap');

    if (badge) {
      badge.style.display = show ? 'block' : 'none';
    }

    if (wrap) {
      wrap.classList.toggle('simulation-active', !!show);
    }
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function refreshImmediately() {
    if (!publicUiReady || document.visibilityState === 'hidden') return;
    // 同時通信は避け、画面が表示中のときだけ最新情報を取得する。
    if (pollTimer) {
      clearTimeout(pollTimer);
      pollTimer = null;
    }
    if (!requestInFlight) loadPublicState();
  }

  document.addEventListener('visibilitychange', function() {
    if (document.visibilityState === 'hidden') {
      suspendPublicPolling_();
    } else {
      resumePublicPolling_();
    }
  });

  window.addEventListener('pagehide', suspendPublicPolling_);
  window.addEventListener('pageshow', function() {
    // BFCache等から復帰した際も、古い通信を待たず取り直す。
    if (publicUiReady && (pausedForHidden || !requestInFlight)) resumePublicPolling_();
  });

  window.addEventListener('online', function() {
    if (publicUiReady && document.visibilityState !== 'hidden') resumePublicPolling_();
  });

  // Some Android browsers do not dispatch visibilitychange reliably on locking.
  // Focus after being away is another opportunity to clear old transient warnings.
  window.addEventListener('blur', function() {
    lastWindowBlurAt = Date.now();
  });
  window.addEventListener('focus', function() {
    if (lastWindowBlurAt === null) return;
    const awayMs = Date.now() - lastWindowBlurAt;
    lastWindowBlurAt = null;
    if (awayMs >= 1500 && publicUiReady && document.visibilityState !== 'hidden') {
      resumePublicPolling_();
    }
  });

  prepare().catch(function(err) {
    console.error(err);
    installBody();
    setMessage('地図の準備に失敗しました。ページを再読み込みしてください。');
  });
})();
