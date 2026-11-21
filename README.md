# project-earth

捲動式 3D 敘事網站。七幕：創世、拉遠、培養、神蹟、額度、其他實驗場、你。

- `public/`：要發布的靜態檔（`index.html`、打包後的 `app.js`）
- `src/main.js`：場景原始碼（Three.js）
- 重新打包：`npx esbuild src/main.js --bundle --minify --format=esm --outfile=public/app.js`
- 除錯：網址加 `?p=0.4` 可直接看某個捲動進度（0～1）
