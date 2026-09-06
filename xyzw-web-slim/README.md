# Cocos Creator 游戏完整静态资源归档

## 结构
- 根目录           运行时壳文件：`boot.js`、`cocos2d-js-min.a5841.js`、`main.2a00e.js`、`patch.js`、`src/settings.js` 等
- `game/`          主游戏包
- `launcher/`      启动器包
- `TEST_REMOTE_MODULE/` 远程模块包
- 其余目录         1264 个普通资源/业务 bundle
- `tools/decrypt-jsc.js`  `.jsc` 解密工具
- `missing-assets.txt`    CDN 上确认 404 的资源清单

## 统计
- Bundle 目录：1268
- 归档文件：49002
- 归档体积：约 552.7 MB
- 已解密 `.jsc`：3 个，均保留原始文件并在同目录生成明文 `.js`
  - `game/index.3cf1d.js`
  - `launcher/index.9706c.js`
  - `TEST_REMOTE_MODULE/index.dfe5b.js`
- CDN 缺失资源：3971 个，主要集中在骨架/图集类 `.atlas`、`miniGameRes`、`icons` 和部分 UI bundle

## 解密
```bash
cd game
node tools/decrypt-jsc.js game/index.3cf1d.jsc launcher/index.9706c.jsc TEST_REMOTE_MODULE/index.dfe5b.jsc
```

## 自动更新
- `boot.js` 的 `fetchRemoteBundleVers()` 会在启动时拉取线上 manifest，并写入 `localStorage` 缓存
- `main.2a00e.js` 的 `ensureBundleVers()` / `installRemoteAssetLoader()` 会把 bundle 加载切到 CDN，并按 manifest 里的版本号请求 `config.<ver>.json` / `index.<ver>.js(c)`
- 因此这份归档本身是快照；联网打开壳文件时仍会跟随线上版本变化
- 如果要离线运行，需要改掉这些远程地址或预置好对应版本资源

这份归档是静态资源提取结果，保留原始 bundle 结构；未额外重构 Cocos 运行环境或本地服务。
