// boot.js - 鸟哥之王 v9.2 启动逻辑 (深度预热推进到登录场景)
// ★ 替代 main.2a00e.js 中阻塞的 async boot()
// ★ v9.2: 深度预热调用 cc.game.run() 预加载登录场景, 点击进入瞬间显示
// ★ 兼容: preload=1 行为不变；preload=2 触发深度预热

(function() {
    'use strict';

    console.log('[boot v9.2] 启动逻辑初始化...');
    window.__bootVersion__ = 'v9.2';

    function notifyGameHost(type, detail) {
        var payload = Object.assign({
            type: type,
            roleId: window._gameTokenId || '',
            timestamp: Date.now()
        }, detail || {});

        // patch.js 运行在游戏页自身，需要收到场景就绪事件后再执行依赖场景的脚本。
        try { window.postMessage(payload, window.location.origin); } catch(e) {}

        // iframe 通知 parent，原生独立窗口通知 opener。
        try {
            var host = window.parent !== window ? window.parent : window.opener;
            if (host && host !== window) host.postMessage(payload, window.location.origin);
        } catch(e) {}
    }

    // ========== 1. 从服务器获取最新 bundleVers（带本地缓存） ==========
    function fetchRemoteBundleVers(settings) {
        return new Promise(function(resolve, reject) {
            var CACHE_KEY = '__boot_manifest_cache__';
            var appliedCache = false;

            // ★ v1.0: 优先应用本地缓存（秒开，避免阻塞）
            try {
                var cached = localStorage.getItem(CACHE_KEY);
                if (cached) {
                    var cacheData = JSON.parse(cached);
                    if (cacheData && cacheData.bundleVers && typeof cacheData.bundleVers === 'object') {
                        Object.assign(settings.bundleVers, cacheData.bundleVers);
                        appliedCache = true;
                        console.log('[boot v1.0] ✅ 已应用本地manifest缓存, 条目:', Object.keys(cacheData.bundleVers).length);
                    }
                }
            } catch(e) {}

            var xhr = new XMLHttpRequest();
            var manifestUrl = 'https://xxz-xyzw.hortorgames.com/login/manifest?platform=hortor&version=0.32.0-android';
            console.log('[boot v1.0] POST', manifestUrl);

            xhr.open('POST', manifestUrl, true);
            xhr.setRequestHeader('Content-Type', 'application/json;charset=UTF-8');
            xhr.timeout = 5000;  // ★ v1.0: 5s超时

            xhr.onload = function() {
                if (xhr.status === 200) {
                    try {
                        var data = JSON.parse(xhr.responseText);
                        var body = data.body;
                        if (typeof body === 'string') body = JSON.parse(body);
                        var bv = body && body.bundleVers;
                        if (typeof bv === 'string') bv = JSON.parse(bv);

                        if (bv && typeof bv === 'object') {
                            // 缓存到localStorage（下次启动秒开）
                            try {
                                localStorage.setItem(CACHE_KEY, JSON.stringify({
                                    bundleVers: bv,
                                    time: Date.now()
                                }));
                            } catch(e) {}

                            // 合并到 settings.bundleVers
                            var oldCount = Object.keys(settings.bundleVers || {}).length;
                            Object.assign(settings.bundleVers, bv);
                            var newCount = Object.keys(settings.bundleVers || {}).length;

                            console.log('[boot v1.0] ✅ Manifest 获取成功! (缓存:', appliedCache ? '已预加载' : '首次', ')');
                            console.log('[boot v1.0]   条目:', oldCount, '→', newCount);
                            if (bv.codeVersion) {
                                settings.codeVersion = bv.codeVersion;  // ★ v1.0: 自动同步服务器版本
                                console.log('[boot v1.0]   远程codeVersion:', bv.codeVersion);
                            }
                        } else {
                            if (!appliedCache) console.warn('[boot v1.0] ⚠ Manifest无有效bundleVers，使用本地版本');
                        }
                    } catch(e) {
                        if (!appliedCache) console.warn('[boot v1.0] ⚠ Manifest解析失败:', e.message);
                    }
                } else {
                    if (!appliedCache) console.warn('[boot v1.0] ⚠ Manifest HTTP', xhr.status);
                }
                resolve(); // 总是resolve（有缓存或本地版本兜底）
            };

            xhr.onerror = function() {
                if (!appliedCache) console.warn('[boot v1.0] ⚠ Manifest网络错误');
                resolve();
            };

            xhr.ontimeout = function() {
                if (!appliedCache) console.warn('[boot v1.0] ⚠ Manifest超时(5s)');
                resolve();
            };

            xhr.send('');
        });
    }

    // ========== 2. 锁定 CODE_VERSION ==========
    // 防止 Cocos launcher bundle 覆盖版本号导致启动卡住
    function lockCodeVersion(settings) {
        var ver = settings.codeVersion ||
                  (typeof globalThis !== 'undefined' && globalThis.CODE_VERSION) ||
                  (typeof window !== 'undefined' && window.CODE_VERSION) ||
                  '2.29.2';
        var gameVer = (typeof globalThis !== 'undefined' && globalThis.GAME_VERSION) || '0.32.0-android';
        var commitId = (typeof globalThis !== 'undefined' && globalThis.COMMIT_ID) || '';

        try { delete globalThis.CODE_VERSION; } catch(e) {}
        try { delete window.CODE_VERSION; } catch(e) {}

        try {
            Object.defineProperty(globalThis, 'CODE_VERSION', {
                get: function() { return ver; },
                set: function(v) {
                    console.warn('[boot v1.0] launcher 尝试覆盖 CODE_VERSION 为', v, '— 已阻止, 保持', ver);
                },
                configurable: true
            });
            Object.defineProperty(window, 'CODE_VERSION', {
                get: function() { return ver; },
                set: function(v) { /* 忽略 */ },
                configurable: true
            });
        } catch(e) {
            console.warn('[boot v1.0] defineProperty 失败, 使用直接赋值:', e.message);
            globalThis.CODE_VERSION = ver;
            window.CODE_VERSION = ver;
        }

        settings.codeVersion = ver;
        globalThis.GAME_VERSION = gameVer;
        globalThis.ENV = 'Prod';
        globalThis.GAME_ID = 'xyzw';
        globalThis.COMMIT_ID = commitId;

        console.log('[boot v1.0] ✅ 版本信息已锁定:');
        console.log('[boot v1.0]   CODE_VERSION:', ver, '(已锁定)');
        console.log('[boot v1.0]   GAME_VERSION:', gameVer);
        console.log('[boot v1.0]   PLATFORM:', globalThis.PLATFORM);
    }

    // ========== 3. 启动游戏主逻辑 ==========
    // ★ v2.0: deepPreload 模式 — 加载bundle后暂停，不调 cc.game.run()
    function doStartGame(settings, deepPreload) {
        var TAG = deepPreload ? '[boot v2.0深度预热]' : '[boot v2.0]';
        console.log(TAG, '开始启动游戏...');
        console.log(TAG, 'server:', settings.server);
        console.log(TAG, 'remoteBundles 数量:', (settings.remoteBundles || []).length);
        console.log(TAG, 'bundleVers 条目数:', Object.keys(settings.bundleVers || {}).length);

        var multiWindowMode = false;
        try { multiWindowMode = new URLSearchParams(window.location.search).get('multi') === '1'; } catch(e) {}

        window._CCSettings = undefined;

        var RESOURCES = cc.AssetManager.BuiltinBundleName.RESOURCES;
        var INTERNAL = cc.AssetManager.BuiltinBundleName.INTERNAL;
        var MAIN = cc.AssetManager.BuiltinBundleName.MAIN;

        var onStart = function (isPreheat) {
            // 多开时关闭 Retina 帧缓冲，明显降低每个 WebGL 实例的显存占用。
            cc.view.enableRetina(!multiWindowMode);
            cc.view.resizeWithBrowserSize(true);

            if (cc.sys.isMobile) {
                if (settings.orientation === 'landscape') {
                    cc.view.setOrientation(cc.macro.ORIENTATION_LANDSCAPE);
                } else if (settings.orientation === 'portrait') {
                    cc.view.setOrientation(cc.macro.ORIENTATION_PORTRAIT);
                }
                cc.view.enableAutoFullScreen(false);
            }

            if (cc.sys.isBrowser && cc.sys.os === cc.sys.OS_ANDROID) {
                cc.assetManager.downloader.maxConcurrency = 2;
                cc.assetManager.downloader.maxRequestsPerFrame = 2;
            } else if (multiWindowMode) {
                // 避免多个账号同时下载和解码大量资源造成瞬时白屏。
                cc.assetManager.downloader.maxConcurrency = 4;
                cc.assetManager.downloader.maxRequestsPerFrame = 2;
            }

            var launchScene = settings.launchScene;
            console.log('[boot v2.0] 准备加载场景:', launchScene);

            var bundle = cc.assetManager.bundles.find(function (b) {
                return b.getSceneInfo(launchScene);
            });

            if (!bundle) {
                console.error('[boot v2.0] ❌ 找不到包含启动场景的 bundle!');
                notifyGameHost('GAME_LOAD_FAILED', { message: '找不到游戏启动场景' });
                return;
            }

            console.log('[boot v2.0] 找到 bundle，开始加载场景...');
            bundle.loadScene(launchScene, null, null, function (err, scene) {
                if (!err) {
                    console.log('[boot v2.0] ✅ 场景加载成功!');
                    cc.director.runSceneImmediate(scene);

                    if (isPreheat) {
                        // ★ v9.2: 深度预热 — 保持隐藏, 挂起在登录界面
                        window.__loginSceneReady__ = true;
                        notifyGameHost('LOGIN_SCENE_READY');
                        console.log('[boot v9.2] 🔥 登录场景预加载完成, 等待进入...');
                    } else {
                        // 正常模式: 显示游戏
                        if (cc.sys.isBrowser) {
                            var canvas = document.getElementById('GameCanvas');
                            if (canvas) canvas.style.visibility = '';
                        }
                        var splash = document.getElementById('splash');
                        if (splash) {
                            splash.style.opacity = '0';
                            setTimeout(function() { splash.style.display = 'none'; }, 500);
                        }

                        window.__gameSceneReady__ = true;
                        notifyGameHost('GAME_SCENE_READY');
                        console.log('[boot v6.9] 📢 已发送 GAME_SCENE_READY (场景就绪)');
                    }
                } else {
                    console.error('[boot v2.0] ❌ 场景加载失败:', err);
                    notifyGameHost('GAME_LOAD_FAILED', { message: '游戏场景加载失败：' + (err && err.message ? err.message : '未知错误') });
                }
            });
        };

        var option = {
            id: 'GameCanvas',
            debugMode: settings.debug ? cc.debug.DebugMode.INFO : cc.debug.DebugMode.ERROR,
            showFPS: settings.debug,
            frameRate: 30,
            groupList: settings.groupList,
            collisionMatrix: settings.collisionMatrix
        };

        console.log(TAG, '初始化 cc.assetManager...');
        cc.assetManager.init({
            bundleVers: settings.bundleVers,
            remoteBundles: settings.remoteBundles,
            server: settings.server
        });

        var bundleRoot = [INTERNAL];
        settings.hasResourcesBundle && bundleRoot.push(RESOURCES);

        var count = 0;
        function cb(err) {
            if (err) {
                console.error(TAG, 'bundle 加载错误:', err.message, err.stack);
                notifyGameHost('GAME_LOAD_FAILED', { message: '游戏基础资源加载失败：' + (err.message || '未知错误') });
                return;
            }
            count++;
            console.log(TAG, '加载进度:', count, '/', bundleRoot.length + 1);
            if (count === bundleRoot.length + 1) {
                console.log(TAG, '✅ 基础 bundles 加载完成, 加载 MAIN bundle...');
                cc.assetManager.loadBundle(MAIN, function (err) {
                    if (!err) {
                        console.log(TAG, '✅ MAIN bundle 加载成功!');

                        // ★ v9.3: 深度预热模式 — 推进到登录场景 (cc.game.run → 预加载场景)
                        if (deepPreload) {
                            window.__savedOption__ = option;
                            window.__savedOnStart__ = function() { onStart(false); };
                            window.__deepPreloadReady__ = true;
                            window.__gameRunStarted__ = true;  // ★ v9.3: 标记防止 finishDeepBoot 重复调用 cc.game.run()
                            notifyGameHost('DEEP_PRELOAD_READY', {
                                bundleCount: Object.keys(settings.bundleVers || {}).length
                            });
                            // ★ v9.2: 不挂起, 直接调 cc.game.run() 预加载登录场景
                            console.log('[boot v9.2] 🔥 深度预热推进: cc.game.run() → 预加载登录场景...');
                            cc.game.run(option, function() { onStart(true); });
                            console.log('[boot v9.2]   等待 LOGIN_SCENE_READY → 点击进入瞬间显示');
                            return;
                        }

                        // 正常模式: 直接运行游戏
                        console.log('[boot v2.0] 运行游戏...');
                        cc.game.run(option, onStart);
                    } else {
                        console.error('[boot v2.0] ❌ MAIN bundle 加载失败:', JSON.stringify(err));
                        console.error('[boot v2.0]   err.message:', err.message);
                        console.error('[boot v2.0]   err.stack:', err.stack);
                        var bv = settings.bundleVers;
                        console.error('[boot v2.0]   main版本号:', bv && bv['main']);
                        console.error('[boot v2.0]   server:', settings.server);
                        notifyGameHost('GAME_LOAD_FAILED', { message: '游戏主资源加载失败：' + (err && err.message ? err.message : '未知错误') });
                    }
                });
            }
        }

        console.log(TAG, '加载 jsList:', settings.jsList);
        cc.assetManager.loadScript(
            settings.jsList.map(function (x) { return 'src/' + x; }),
            cb
        );

        for (var i = 0; i < bundleRoot.length; i++) {
            console.log(TAG, '加载 bundle:', bundleRoot[i]);
            cc.assetManager.loadBundle(bundleRoot[i], cb);
        }
    }

    // ★ v9.3: finishDeepBoot — 若登录场景已预加载则直接显示，否则回退 cc.game.run()
    window.finishDeepBoot = function() {
        // 登录场景已预加载完毕 → 直接显示游戏 (跳过 cc.game.run 和场景加载)
        if (window.__loginSceneReady__) {
            console.log('[boot v9.2] 🚀 登录场景已预加载, 直接显示游戏!');
            window.__loginSceneReady__ = false;
            // 显示canvas + 隐藏splash
            var canvas = document.getElementById('GameCanvas');
            if (canvas) canvas.style.visibility = '';
            var splash = document.getElementById('splash');
            if (splash) {
                splash.style.opacity = '0';
                setTimeout(function() { splash.style.display = 'none'; }, 500);
            }
            window.__gameSceneReady__ = true;
            notifyGameHost('GAME_SCENE_READY');
            console.log('[boot v9.2] ✅ 游戏已显示 (免场景加载)');
            return;
        }

        // ★ v9.3: 深度预热中 cc.game.run() 已执行但登录场景未就绪 → 等待登录场景加载完成, 不重复调用
        if (window.__gameRunStarted__ && !window.__loginSceneReady__) {
            console.log('[boot v9.3] ⏳ cc.game.run() 进行中, 等待登录场景就绪...');
            var MAX_WAIT = 10000;
            var waited = 0;
            var check = setInterval(function() {
                waited += 100;
                if (window.__loginSceneReady__) {
                    clearInterval(check);
                    console.log('[boot v9.3] ✅ 登录场景就绪, 显示游戏 (等待了' + waited + 'ms)');
                    window.__loginSceneReady__ = false;
                    // 显示canvas + 隐藏splash
                    var canvas = document.getElementById('GameCanvas');
                    if (canvas) canvas.style.visibility = '';
                    var splash = document.getElementById('splash');
                    if (splash) {
                        splash.style.opacity = '0';
                        setTimeout(function() { splash.style.display = 'none'; }, 500);
                    }
                    window.__gameSceneReady__ = true;
                    notifyGameHost('GAME_SCENE_READY');
                } else if (waited >= MAX_WAIT) {
                    clearInterval(check);
                    console.warn('[boot v9.3] ⚠ 等待超时, 强制显示');
                    window.finishDeepBoot();  // 回退重试
                }
            }, 100);
            return;
        }

        // 深度预热完成但 cc.game.run() 未启动 → 执行 cc.game.run()
        if (window.__deepPreloadReady__) {
            console.log('[boot v9.2] 🚀 finishDeepBoot: 执行 cc.game.run() → 加载场景...');
            window.__deepPreloadReady__ = false;
            window.__gameRunStarted__ = true;
            cc.game.run(window.__savedOption__, window.__savedOnStart__);
            return;
        }

        // 预热未完成 → 回退到完整 boot()
        console.warn('[boot v2.0] ⚠ finishDeepBoot: 预热未完成, 回退到完整 boot()');
        window.boot();
    };

  // ========== v2.0: preBoot() — 深度预热 (manifest+bundle全部提前加载) ==========
  window.preBoot = async function () {
    var settings = window._CCSettings;
    if (!settings) {
      console.error('[boot v2.0] ❌ _CCSettings 未定义!');
      return;
    }

    console.log('[boot v2.0] 🔥 深度预热开始: 拉取manifest + 加载bundle...');

    // 1) Manifest
    await fetchRemoteBundleVers(settings);

    // 2) 锁定版本
    lockCodeVersion(settings);

    // 3) Launcher fallback
    if (!settings.bundleVers.launcher || settings.bundleVers.launcher === '') {
      settings.bundleVers.launcher = settings.bundleVers.main || 'dd530';
      console.log('[boot v2.0] ✅ 已补充 launcher 版本:', settings.bundleVers.launcher);
    }

    // 4) CDN 资源加载器
    try {
      if (typeof window.installRemoteAssetLoader === 'function') {
        window.installRemoteAssetLoader();
        console.log('[boot v2.0] ✅ CDN 资源加载器已安装');
      }
    } catch(e) {
      console.warn('[boot v2.0] CDN 资源加载器安装失败:', e.message);
    }

    // 5) 执行脚本队列（hook就位）
    try {
      if (typeof window.executeScriptQueue === 'function') {
        console.log('[boot v2.0] 🔧 引擎初始化前执行脚本队列...');
        window.executeScriptQueue();
      }
    } catch(e) {
      console.warn('[boot v2.0] 脚本预执行失败:', e.message);
    }

    // 6) 加载bundle + 暂停在 cc.game.run() 之前
    doStartGame(settings, true);
  };

  // ========== 最终 boot() — 完整启动（正常模式/preload=1回退） ==========
  window.boot = async function () {
    var settings = window._CCSettings;
    if (!settings) {
      console.error('[boot v2.0] ❌ _CCSettings 未定义!');
      return;
    }

    // 1) Manifest
    await fetchRemoteBundleVers(settings);

    // 2) Lock version
    lockCodeVersion(settings);

    // 3) Launcher fallback
    if (!settings.bundleVers.launcher || settings.bundleVers.launcher === '') {
      settings.bundleVers.launcher = settings.bundleVers.main || 'dd530';
      console.log('[boot v2.0] ✅ 已补充 launcher 版本:', settings.bundleVers.launcher);
    }

    // 4) CDN loader
    try {
      if (typeof window.installRemoteAssetLoader === 'function') {
        window.installRemoteAssetLoader();
        console.log('[boot v2.0] ✅ CDN 资源加载器已安装');
      }
    } catch(e) {
      console.warn('[boot v2.0] CDN 资源加载器安装失败:', e.message);
    }

    // 5) Script queue
    try {
      if (typeof window.executeScriptQueue === 'function') {
        console.log('[boot v2.0] 🔧 引擎初始化前执行脚本队列...');
        window.executeScriptQueue();
      }
    } catch(e) {
      console.warn('[boot v2.0] 脚本预执行失败:', e.message);
    }

    // 6) 完整启动（正常模式, 不暂停）
    doStartGame(settings, false);
  };

    console.log('[boot v2.0] ✅ 启动逻辑就绪 (深度预热支持)');

    // ★ v5.12: 移除冗余的 START_GAME / CLEAR_SCRIPT_QUEUE 监听器
    //   这些状态由 patch.js 统一管理，boot.js 的重复处理会导致
    //   __totalScriptsExpected__ 被错误覆盖（不包含 deferred queue 计数）
})();
