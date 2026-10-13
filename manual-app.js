(() => {
  const VERSION = '4';

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

  async function boot() {
    await loadCss('./manual-style.css?v=' + VERSION);

    document.body.innerHTML = `
      <div class="wrap">
        <div class="card">
          <div class="title-row">
            <h1>当日操作マニュアル</h1>
            <span class="version-badge">RC3-D2.3</span>
          </div>
          <p>赤城神社例大祭　神輿現在地案内システム</p>
          <div class="notice">
            位置情報を送るTraccar Client端末は、同時に1台だけ追跡ONにします。管理画面は複数人で確認できますが、状態を変更する操作は主担当者が行ってください。
          </div>
        </div>

        <div class="card">
          <h2>1　本番前</h2>
          <ul>
            <li>本番用端末のTraccar Clientを起動し、位置情報「常に許可」、正確な位置情報ON、バッテリー制限なしを確認します。</li>
            <li>追跡は巡行開始の数分前からONにして構いません。</li>
            <li>予備端末は設定してあっても追跡OFFのままにします。</li>
            <li>管理画面で「巡行開始前／終了後」「GPS位置の記録停止中」を確認します。</li>
          </ul>
        </div>

        <div class="card">
          <h2>2　巡行開始</h2>
          <div class="step"><strong>管理画面で「巡行を開始する」</strong></div>
          <ul>
            <li>位置履歴を初期化し、GPS位置情報の記録を開始します。</li>
            <li>一般向け地図では、まず赤城神社の初期位置を表示します。</li>
            <li>Traccar Clientから新しい位置情報を受信すると、神輿現在位置が実際の位置へ移ります。</li>
            <li>移動中は約30mが送信の目安です。停止中はハートビート300秒（5分）のため、数分更新されないことがあります。</li>
          </ul>
        </div>

        <div class="card">
          <h2>3　巡行中</h2>
          <ul>
            <li>一般向け地図の位置情報・お知らせは、通常約15秒ごとに自動更新します。</li>
            <li>一般向け地図を開いている間の更新であり、スマートフォンへのプッシュ通知ではありません。</li>
            <li>一時的に神輿位置だけを隠したい場合は「神輿位置を地図に表示しない」を使います。GPS記録は続きます。</li>
            <li>トラブル時は診断画面で「Traccar受信」と「神輿現在位置への反映」を確認します。</li>
            <li>実機テスト後に診断画面へ残った最終受信情報は、診断画面内の「診断用の最終受信情報を消去」から消せます。神輿現在位置や経路記録には影響しません。</li>
          </ul>
        </div>

        <div class="card">
          <h2>4　一般向け地図へのお知らせ</h2>
          <ul>
            <li>管理画面の「一般向け地図へのお知らせ」に本文を入力し、「通常」または「重要」を選んで表示します。</li>
            <li>お知らせ本文は地図上に重ねて表示されるため、表示・非表示で地図の高さは変わりません。</li>
            <li>利用者は読んだ後に閉じることができ、「お知らせ」をタッチすると最新3件の履歴を再確認できます。</li>
            <li>内容を更新すると、新しいお知らせとして自動的に再表示されます。</li>
            <li>「お知らせの表示を終了」後も、その巡行中の直近3件は履歴から確認できます。</li>
            <li>巡行終了または全リセット時には、お知らせ履歴も消去されます。</li>
          </ul>
        </div>

        <div class="card">
          <h2>5　巡行終了</h2>
          <div class="step"><strong>管理画面で「巡行を終了する」</strong></div>
          <ul>
            <li>GPS位置情報の記録と一般向け地図の神輿位置表示を停止します。</li>
            <li>通過記録を消去し、神輿現在位置を赤城神社の初期位置へ戻します。</li>
            <li>その後、Traccar Clientの追跡をOFFにします。</li>
          </ul>
        </div>

        <div class="card">
          <h2>6　位置が更新されないとき</h2>
          <ol>
            <li>診断画面で「Traccarから最後に受信した位置情報」を確認します。</li>
            <li>受信時刻が更新されない場合は、Traccar Client側の追跡ON・位置情報権限・通信・バッテリー設定を確認します。</li>
            <li>「Location filtered」「request no fix」の位置情報はサーバーへ送信されません。</li>
            <li>受信は正常なのに神輿現在位置へ反映されない場合は、巡行中になっているか確認します。</li>
          </ol>
        </div>

        <div class="card">
          <h2>7　予備端末へ切り替える</h2>
          <ol>
            <li>一般向け地図の神輿位置を一時的に非表示にします。</li>
            <li>旧端末のTraccar追跡をOFFにします。</li>
            <li>予備端末を神輿と同じ場所へ持って行き、追跡ONにします。</li>
            <li>診断画面で、新しい「デバイス識別子」からの受信を確認します。</li>
            <li>神輿位置を再表示します。</li>
          </ol>
        </div>

        <div class="card">
          <h2>8　事前シミュレーション</h2>
          <ul>
            <li>標準は「全巡行路」「2秒」です。</li>
            <li>テスト用地図は2秒更新です。本番の一般利用には使用しません。</li>
            <li>終了後は必ず「テスト終了・初期化」を実行します。</li>
          </ul>
        </div>

        <div class="card">
          <h2>関連画面</h2>
          <div class="links">
            <a href="./admin.html">管理画面</a>
            <a href="./debug.html">診断画面</a>
            <a href="./simulator.html">シミュレーション</a>
            <a href="./">一般向け地図</a>
          </div>
        </div>

        <div class="footer">RC3-D2.3　オンラインマニュアル</div>
      </div>
    `;
  }

  boot().catch(() => {
    document.body.innerHTML =
      '<div style="padding:16px;font-family:Meiryo,sans-serif">操作マニュアルを読み込めませんでした。</div>';
  });
})();