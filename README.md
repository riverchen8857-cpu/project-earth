# project-earth

捲動式 3D 敘事網站。八幕：創世、拉遠、五次銷毀、祈禱、壓制、其他實驗場、回到那道光、你。

第一幕（創世）：一個點炸開 → 許多星系飛散 → 放大進銀河系 → 太陽系（八顆行星）→ 地球。各層的距離與大小不是等比例的；「一點炸出星系」是表現手法，不是科學上的順序。

海岸線資料：Natural Earth（公有領域），經 world-atlas 套件。古代各輪的陸地分布是程式畫的近似，不是古地理重建。

- `public/`：要發布的靜態檔（`index.html`、打包後的 `app.js`）
- `src/main.js`：場景原始碼（Three.js）
- 重新打包：`npx esbuild src/main.js --bundle --minify --format=esm --outfile=public/app.js`
- 除錯：網址加 `?p=0.4` 可直接看某個捲動進度（0～1）
