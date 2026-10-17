/* 赤城神社例大祭：Google Analytics 4 閲覧状況集計
 * GPS位置情報・GAS通信・巡行操作から独立。
 * Google Analytics 4 のウェブデータストリームの測定IDを設定するまで計測しない。
 */
(function () {
  'use strict';
  var measurementId = 'G-GEXE9J0088'; // Google Analytics 4 ウェブデータストリーム測定ID。
  if (!/^G-[A-Z0-9]+$/.test(measurementId)) return;

  window.dataLayer = window.dataLayer || [];
  window.gtag = window.gtag || function () {
    window.dataLayer.push(arguments);
  };
  window.gtag('js', new Date());
  window.gtag('config', measurementId);

  var script = document.createElement('script');
  script.async = true;
  script.src = 'https://www.googletagmanager.com/gtag/js?id=' +
    encodeURIComponent(measurementId);
  document.head.appendChild(script);
})();
