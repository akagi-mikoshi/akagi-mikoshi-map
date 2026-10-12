(() => {
  const VERSION = '1';
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
      '<div id="map"></div>' +
      '<div id="status"></div>' +
      '<div id="note">※休憩中などは位置情報の更新間隔が空くことがあります。GPSや通信状況により、実際の場所から多少ずれる場合があります。</div>';
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
      loadScript(LEAFLET_JS)
    ]);

    if (typeof L === 'undefined') {
      throw new Error('Leaflet not loaded');
    }

    initializeMap();
    setMessage('位置情報を確認しています…');
    loadPublicState();
  }

  function initializeMap() {
    map = L.map('map', {zoomControl: true});

    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors'
    }).addTo(map);
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
      setMessage('API_URL が設定されていません。');
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
      if (!marker) setMessage('位置情報に接続しています…');
      setTimeout(loadPublicState, 2000);
    };

    document.body.appendChild(activeJsonpScript);

    clearResponseTimer();
    responseTimer = setTimeout(function() {
      if (!marker) setMessage('位置情報に接続しています…');
      loadPublicState();
    }, 8000);
  }

  function showState(state) {
    const message = document.getElementById('message');
    const mapDiv = document.getElementById('map');
    const status = document.getElementById('status');
    const note = document.getElementById('note');

    if (!state || !state.isPublic) {
      mapDiv.style.display = 'none';
      status.style.display = 'none';
      note.style.display = 'none';
      message.style.display = 'flex';
      message.textContent = '現在、神輿の位置情報は公開していません。';
      return;
    }

    if (!state.latest) {
      mapDiv.style.display = 'none';
      status.style.display = 'none';
      note.style.display = 'none';
      message.style.display = 'flex';
      message.textContent = '神輿の位置情報が届くまで、しばらくお待ちください。';
      return;
    }

    message.style.display = 'none';
    mapDiv.style.display = 'block';
    status.style.display = 'block';
    note.style.display = 'block';

    showLocation(state.latest);

    requestAnimationFrame(() => map.invalidateSize());
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

    document.getElementById('status').textContent =
      '最終更新 ' + timeText + '（' + ageText + '）' + accuracyText;

    marker.setPopupContent(
      '<strong>神輿の現在位置</strong><br>' +
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
