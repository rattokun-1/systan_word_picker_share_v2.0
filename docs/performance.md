# アイコンと読み込みの軽量化

表示用画像は `assets/icons/icon-128.webp`、PWA用は192px/512pxのPNG、Apple用は192px PNGです。元の `icon.png` は画像生成元として残しています。表示用の画像は公開環境で1,689,441 bytesから6,046 bytesに縮小できました。

学習・先生・管理者ページのFirebase SDKとアプリはdeferで実行順序を保って読み込みます。ログインのインライン処理は既存の順序を維持しています。フォント利用ページにはGoogle Fontsへのpreconnectを追加しました。

ChromiumのDevTools Protocolで、キャッシュ無効・Service Workerバイパス・回線制限なしの条件で測定しました。変更前のload完了は492.1ms、変更後は471.5msと443.4msでした。これは少数回の観測であり、初回描画速度や実機の改善率を保証するものではありません。

CSS/JSのURLとService Workerのキャッシュバージョンは `20261010-performance-v3.2` です。
