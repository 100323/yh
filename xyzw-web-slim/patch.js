// patch.js - 鸟哥之王 v6.2
// ★ v5.9: 岚山4.5等脚本延迟到GAME_SCENE_READY后3秒首次执行
//   (Launcher场景触发GAME_SCENE_READY, 但主游戏场景需要时间初始化)
// ★ v5.9: GM_xmlhttpRequest走浏览器标准路径 → NativeHttpBridge不拦截用户脚本HTTP
// ★ v1.0: 恢复完整tampermonkey-polyfill.js(含process/fsUtils/require)
//   但加载顺序移到Cocos引擎之后 + typeof保护 → 引擎API不被覆盖
(function() {
    'use strict';

    var PATCH_VERSION = 'v11.5';
    if (window.__PATCH_LOADED__) { return; }
    window.__PATCH_LOADED__ = true;

    console.log('[Patch ' + PATCH_VERSION + '] SDK Mock 初始化');

    // ══════════════════════════════════════════
    //  ★ v11.5: 强制 _isRotated = false — 防止 cocos 引擎在缩略图/主控切换时
    //    根据宽高比翻转 UI 方向(settings.orientation=portrait, designResolution=960x640横屏)
    // ══════════════════════════════════════════
    function _lockNoRotate() {
        if (typeof cc === 'undefined' || !cc.view) return false;
        try {
            if (cc.view._isRotated !== false) {
                cc.view._isRotated = false;
                try {
                    var ctn = cc.game && cc.game.container && cc.game.container.style;
                    if (ctn) {
                        ctn.transform = 'rotate(0deg)';
                        ctn['-webkit-transform'] = 'rotate(0deg)';
                        ctn['-webkit-transform-origin'] = '';
                        ctn.transformOrigin = '';
                    }
                } catch(_e) {}
                console.log('[Patch ' + PATCH_VERSION + '] 🔒 _isRotated 锁定为 false');
            }
            return true;
        } catch(_e) { return false; }
    }
    // 等 cocos 引擎加载完后立即 hook _initFrameSize + _resizeEvent
    var _cocosWatch = setInterval(function() {
        if (typeof cc === 'undefined' || !cc.view || !cc.view._initFrameSize) return;
        clearInterval(_cocosWatch);

        // ★ v11.11: Hook cc.game.prepare — 确保 canvas 元素存在（防止 _initRenderer null.tagName 崩溃）
        if (cc.game && cc.game.prepare && !cc.game.__preparePatched) {
            cc.game.__preparePatched = true;
            var _origPrepare = cc.game.prepare;
            cc.game.prepare = function() {
                try {
                    var cfgId = (this.config && this.config.id) || 'GameCanvas';
                    var el = cfgId instanceof HTMLElement ? cfgId : document.querySelector(cfgId) || document.querySelector('#' + cfgId);
                    if (!el) {
                        // DOM 中找不到 canvas，自动创建
                        var newCanvas = document.createElement('CANVAS');
                        newCanvas.id = 'GameCanvas';
                        newCanvas.oncontextmenu = function(e) { e.preventDefault(); };
                        newCanvas.tabIndex = 0;
                        var target = document.body || document.documentElement;
                        if (target) target.insertBefore(newCanvas, target.firstChild);
                        console.warn('[Patch ' + PATCH_VERSION + '] ⚠️ Canvas 不存在，已自动创建 #' + (newCanvas.id));
                    }
                } catch(_e) {}
                return _origPrepare.apply(this, arguments);
            };
            console.log('[Patch ' + PATCH_VERSION + '] 🔒 cc.game.prepare 已包装(canvas安全检查)');
        }
        // Hook _initFrameSize — 强制走"不 rotate"分支
        var _origInit = cc.view._initFrameSize;
        cc.view._initFrameSize = function() {
            // ★ v11.10: DOM 前置检查 — canvas/container 未就绪时直接跳过
            if (!cc.game || !cc.game.canvas || !cc.game.container) return;
            var realW = window.innerWidth;
            var realH = window.innerHeight;
            // ★ v11.6: 在 _initFrameSize 之前, 临时把 _orientation 设为 ORIENTATION_AUTO,
            //   让它对任何宽高比都走"不rotate"分支(因为 portrait=1, 横向窗口 e>=i 时不匹配)
            var _origOrientation = this._orientation;
            this._orientation = cc.macro.ORIENTATION_AUTO; // 3 = 1|2, 永远匹配
            try {
                _origInit.call(this);
            } catch(_initErr) {
                // ★ v11.10: DOM 未就绪时静默跳过（刷新重登/iframe 重建期间 canvas/container 可能为 null）
                console.warn('[Patch ' + PATCH_VERSION + '] ⚠️ _initFrameSize 跳过(DOM未就绪):', _initErr.message);
                this._orientation = _origOrientation;
                return;
            } finally {
                this._orientation = _origOrientation;
            }
            // 兜底: 强制 _isRotated = false 并清除 transform
            if (this._isRotated !== false) {
                this._isRotated = false;
            }
            // 修正 frameSize (rotate 分支会 swap w/h)
            if (this._frameSize.width === realH && this._frameSize.height === realW) {
                this._frameSize.width = realW;
                this._frameSize.height = realH;
            }
            try {
                var ctn = cc.game && cc.game.container && cc.game.container.style;
                if (ctn) { ctn.transform = 'rotate(0deg)'; ctn['-webkit-transform'] = 'rotate(0deg)'; }
            } catch(_e) {}
            console.log('[Patch ' + PATCH_VERSION + '] 🔒 _initFrameSize 强制 portrait→auto→不rotate (realW=' + realW + ', realH=' + realH + ')');
        };
        // Hook _resizeEvent 兜底
        var _origResize = cc.view._resizeEvent;
        cc.view._resizeEvent = function(force) {
            // ★ v11.10: DOM 前置检查
            if (!cc.game || !cc.game.canvas || !cc.game.container) return;
            try {
                _origResize.call(this, force);
            } catch(_resizeErr) {
                // ★ v11.10: DOM 未就绪时静默跳过
                console.warn('[Patch ' + PATCH_VERSION + '] ⚠️ _resizeEvent 跳过(DOM未就绪):', _resizeErr.message);
                return;
            }
            _lockNoRotate();
            // 额外修正 canvas/container 尺寸
            try {
                var realW = window.innerWidth, realH = window.innerHeight;
                if (cc.view._frameSize.width === realH && cc.view._frameSize.height === realW) {
                    cc.view._frameSize.width = realW;
                    cc.view._frameSize.height = realH;
                }
                if (cc.game && cc.game.canvas) {
                    cc.game.canvas.style.width = realW + 'px';
                    cc.game.canvas.style.height = realH + 'px';
                }
                if (cc.game && cc.game.container) {
                    cc.game.container.style.width = realW + 'px';
                    cc.game.container.style.height = realH + 'px';
                }
            } catch(_e) {}
        };
        // 立即锁定一次
        _lockNoRotate();
        console.log('[Patch ' + PATCH_VERSION + '] ✅ _initFrameSize + _resizeEvent 已 hook');
    }, 20);

    // ══════════════════════════════════════════
    //  ★ v6.18: 拦截 JS 原生阻塞式对话框
    //   Android WebView 无 onJsPrompt 处理 → prompt/alert/confirm 会永久阻塞JS线程 → 游戏卡死
    //   改为非阻塞式，返回合理默认值
    // ══════════════════════════════════════════
    var _origAlert = window.alert;
    var _origConfirm = window.confirm;
    var _origPrompt = window.prompt;
    window.alert = function(msg) {
        console.log('[Patch ' + PATCH_VERSION + '] ⚠️ alert blocked: ' + String(msg || '').substring(0, 200));
        return undefined;
    };
    window.confirm = function(msg) {
        console.log('[Patch ' + PATCH_VERSION + '] ⚠️ confirm blocked → 返回true: ' + String(msg || '').substring(0, 200));
        return true;
    };
    window.prompt = function(msg, defaultText) {
        console.log('[Patch ' + PATCH_VERSION + '] ⚠️ prompt blocked → 返回默认值: ' + String(msg || '').substring(0, 200));
        return (defaultText !== undefined) ? String(defaultText) : '';
    };
    console.log('[Patch ' + PATCH_VERSION + '] ✅ 已拦截 JS阻塞对话框 (alert/confirm/prompt)');

    // ========== wx Mock ==========
    window.wx = window.wx || {
        getSystemInfo: function() { return { platform: 'android', brand: 'Android', system: 'Android 10', model: 'Android' }; },
        getStorageInfo: function() { return { keys: [] }; },
        onShow: function(cb) { if (cb) setTimeout(function() { cb({ scene: '1001', query: {} }); }, 50); },
        onHide: function() {},
        login: function(opts) { if (opts && opts.success) setTimeout(function() { opts.success({ code: 'wx_mock_' + Date.now() }); }, 100); },
        request: function(opts) { if (opts && opts.success) setTimeout(function() { opts.success({ data: '{}' }); }, 50); },
        // ★ v6.17: 分享/剪贴板/模态框 — 防止调用未定义导致游戏卡死
        shareAppMessage: function(opts) {
            console.log('[Patch ' + PATCH_VERSION + '] wx.shareAppMessage mock:', opts && opts.title);
            if (opts && opts.success) setTimeout(function() { opts.success(); }, 50);
        },
        showShareMenu: function(opts) { if (opts && opts.success) opts.success(); },
        hideShareMenu: function(opts) { if (opts && opts.success) opts.success(); },
        getClipboardData: function(opts) {
            var data = '';
            // ★ v6.19: 优先从原生剪切板读取
            try {
                if (typeof NativeHttpBridge !== 'undefined' && NativeHttpBridge.getFromClipboard) {
                    data = NativeHttpBridge.getFromClipboard() || '';
                }
            } catch(e) {}
            if (opts && opts.success) opts.success({ data: data });
        },
        setClipboardData: function(opts) {
            if (opts && opts.data) window.setClipboard(opts.data);
            if (opts && opts.success) setTimeout(function() { opts.success(); }, 50);
        },
        showModal: function(opts) { console.log('[Patch] wx.showModal:', opts && opts.title); if (opts && opts.success) opts.success({ confirm: true }); },
        showToast: function(opts) { console.log('[Patch] wx.showToast:', opts && opts.title); if (opts && opts.success) opts.success(); },
        showLoading: function(opts) { if (opts && opts.success) opts.success(); },
        hideLoading: function(opts) { if (opts && opts.success) opts.success(); },
        vibrateShort: function(opts) { if (opts && opts.success) opts.success(); },
        getSetting: function(opts) { if (opts && opts.success) opts.success({ authSetting: {} }); },
        authorize: function(opts) { if (opts && opts.success) opts.success(); },
        openSetting: function(opts) { if (opts && opts.success) opts.success(); },
        previewImage: function(opts) { if (opts && opts.success) opts.success(); },
        getImageInfo: function(opts) { if (opts && opts.success) opts.success({ width: 100, height: 100, path: opts.src || '' }); },
        downloadFile: function(opts) { if (opts && opts.success) setTimeout(function() { opts.success({ tempFilePath: opts.url || '' }); }, 100); },
        uploadFile: function(opts) { if (opts && opts.success) setTimeout(function() { opts.success({ data: '{}' }); }, 100); },
        saveImageToPhotosAlbum: function(opts) { if (opts && opts.success) opts.success(); },
        createInnerAudioContext: function() { return { play: function(){}, pause: function(){}, stop: function(){}, destroy: function(){} }; },
        getNetworkType: function(opts) { if (opts && opts.success) opts.success({ networkType: 'wifi' }); },
        onNetworkStatusChange: function() {},
        exitMiniProgram: function() {},
        navigateToMiniProgram: function(opts) { if (opts && opts.success) opts.success(); },
    };

    // ========== HSDK Mock ==========
    window.HSDK = window.HSDK || {
        _callbacks: [],
        onLogin: function(data) {
            console.log('[HSDK ' + PATCH_VERSION + '] onLogin called');
            if (data && typeof data === 'function') {
                window.HSDK._callbacks.push(data);
            } else if (data && data.listener) {
                window.HSDK._callbacks.push(data.listener);
            }
            setTimeout(function() {
                var cbs = window.HSDK._callbacks;
                cbs.forEach(function(cb) {
                    try { cb({ userSdk: { isNewUser: false }, token: 'pending' }); }
                    catch (e) {}
                });
            }, 200);
        },
        reportLoginState: function() {},
        onAddictionQuit: function() {},
        getGsSetting: function() { return { version: '0.1.0', appid: 'xyzw_mix' }; },
        reportData: function() {},
        loginSuccess: function() {},
        loginFail: function() {}
    };

    // ========== Hortor SDK Mock ==========
    window.__HORTOR_SDK__ = window.__HORTOR_SDK__ || {
        tga: { track: function() {}, tga: null }
    };
    window.__HORTOR_SDK__.tga.tga = window.__HORTOR_SDK__.tga;

    window._hsdkInit = 1;
    window.checkUpdate = 1;
    console.log('[Patch ' + PATCH_VERSION + '] 已设置 _hsdkInit=1, checkUpdate=1');

    // ========== Clipboard ==========
    // ★ v6.20: 全覆盖复制补丁 — 原生桥 + 浏览器API + SDK多路径hook
    function _normalizeClip(t) {
        if (t === undefined || t === null) return '';
        if (typeof t === 'string') {
            try { var obj = JSON.parse(t); if (obj && typeof obj === 'object' && obj.text !== undefined) return String(obj.text); } catch(e) {}
            return t;
        }
        if (typeof t === 'object') {
            if (t.text !== undefined) return String(t.text);
            try { return JSON.stringify(t); } catch(e) { return String(t); }
        }
        return String(t);
    }
    function _setClip(t) {
        if (!t) return;
        var str = _normalizeClip(t);
        console.log('[Patch ' + PATCH_VERSION + '] 📋 复制: ' + str.substring(0, 100));
        // ★ 优先: 原生 Android ClipboardManager
        try {
            if (typeof NativeHttpBridge !== 'undefined' && NativeHttpBridge.copyToClipboard) {
                var ok = NativeHttpBridge.copyToClipboard(str);
                if (ok) { console.log('[Patch ' + PATCH_VERSION + '] ✅ 原生剪切板复制成功'); return; }
            }
        } catch(e) { console.warn('[Patch] 原生剪切板失败: ' + e.message); }
        // 兜底: 浏览器 Clipboard API + execCommand
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(str).then(function() {
                console.log('[Patch] ✅ Async Clipboard API 复制成功');
            }, function(err) {
                console.warn('[Patch] Async Clipboard API 失败: ' + err);
                _fallbackCopy(str);
            });
        } else {
            _fallbackCopy(str);
        }
    }
    function _fallbackCopy(text) {
        var ta = document.createElement('textarea');
        ta.value = text; ta.style.position = 'fixed'; ta.style.left = '-9999px'; ta.style.top = '0';
        document.body.appendChild(ta);
        ta.focus(); ta.select();
        // iOS 兼容
        if (navigator.userAgent.match(/ipad|iphone/i)) {
            var range = document.createRange();
            range.selectNodeContents(ta);
            var sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(range);
            ta.setSelectionRange(0, 999999);
        }
        try { document.execCommand('copy'); console.log('[Patch] ✅ fallback execCommand copy 成功'); } catch(e) { console.error('[Patch] ❌ fallback copy 失败', e); }
        document.body.removeChild(ta);
    }
    window.setClipboard = _setClip;
    // ★ v6.20: 同时 hook SDK 层 — 游戏可能直接调 wx.setClipboard / HSDK.setClipboard
    if (window.wx && typeof window.wx.setClipboard !== 'function') window.wx.setClipboard = _setClip;
    if (window.HSDK && typeof window.HSDK.setClipboard !== 'function') window.HSDK.setClipboard = _setClip;
    if (window.__HORTOR_SDK__ && typeof window.__HORTOR_SDK__.setClipboard !== 'function') window.__HORTOR_SDK__.setClipboard = _setClip;

    // ══════════════════════════════════════════
    //  ★ v1.0 核心修复: Canvas尺寸强制同步
    // ══════════════════════════════════════════
    function forceCanvasResize(reason) {
        // ★ v7.0: 防递归 — guard防止无限重入
        if (window.__canvasResizeInProgress__) return false;
        window.__canvasResizeInProgress__ = true;
        try {
        var w = window.innerWidth;
        var h = window.innerHeight;

        // ★ v6.21: 维护历史最大高度 + 方向变化检测
        window.__maxInnerHeight__ = Math.max(window.__maxInnerHeight__ || h, h);
        window.__maxInnerWidth__  = Math.max(window.__maxInnerWidth__  || w, w);
        if (window.__lastInnerWidth__ && Math.abs(w - window.__lastInnerWidth__) > 100) {
            // 方向变化 → 重置最大高度基准
            window.__maxInnerHeight__ = h;
            window.__maxInnerWidth__  = w;
        }

        // ★ v6.21: 增强键盘检测 — 用最大历史高度做基准，避免多次触发时竞态失效
        var heightDiff = (window.__maxInnerHeight__ || h) - h;
        var widthDiff  = Math.abs(w - (window.__maxInnerWidth__ || w));
        if (heightDiff > 100 && heightDiff < 700 && widthDiff < 50) {
            console.log('[Patch ' + PATCH_VERSION + '] ⌨️ 键盘弹出中 (Δh=' + heightDiff +
                'px)，恢复body高度防止黑屏: ' + reason);
            var maxH = window.__maxInnerHeight__;
            var maxW = window.__maxInnerWidth__ || w;
            document.documentElement.style.height = maxH + 'px';
            document.documentElement.style.width  = maxW + 'px';
            document.body.style.height = maxH + 'px';
            document.body.style.width  = maxW + 'px';
            var canvas = document.getElementById('GameCanvas');
            if (canvas) {
                canvas.style.width  = maxW + 'px';
                canvas.style.height = maxH + 'px';
            }
            return false;
        }
        window.__lastInnerWidth__ = w;
        window.__lastInnerHeight__ = h;

        try {
            if (typeof cc !== 'undefined' && cc.view) {
                // ★ v11.5: 强制 _isRotated = false — 防止主控↔缩略图切换时
                //   cocos 根据宽高比翻转 UI 方向(960x640横屏设计在portrait模式下)
                if (cc.view._isRotated !== false) {
                    cc.view._isRotated = false;
                    try { cc.game.container.style.transform = 'rotate(0deg)'; cc.game.container.style['-webkit-transform'] = 'rotate(0deg)'; } catch(_e0) {}
                    console.log('[Patch ' + PATCH_VERSION + '] 🔄 强制 _isRotated=false');
                }
                var canvas = document.getElementById('GameCanvas');
                var dpr = window.devicePixelRatio || 1;

                // ★ v5.9-fix: 先用 CSS 设置显示尺寸，再精确设置缓冲区 = CSS尺寸 × 真实DPR
                if (canvas) {
                    canvas.style.width = w + 'px';
                    canvas.style.height = h + 'px';
                    canvas.width = Math.round(w * dpr);
                    canvas.height = Math.round(h * dpr);
                    cc.view.setFrameSize(w, h);
                }

                // [v10.0-fix: removed duplicate canvas+setFrameSize block]
                cc.view.resizeWithBrowserSize(true);
                try { cc.view.emit('canvas-resize'); } catch(e2) {}
                try { cc.view.emit('design-resolution-changed'); } catch(e2) {}

                console.log('[Patch ' + PATCH_VERSION + '] Canvas已调整 (' + reason + '):',
                    Math.round(w) + 'x' + Math.round(h) + ' @' + dpr.toFixed(1) + 'x → ' +
                    canvas.width + 'x' + canvas.height + ' buffer');
                return true;
            }
        } catch(e) {
            // canvas未就绪时静默跳过，不刷日志
        }
        return false;
        } finally {
            window.__canvasResizeInProgress__ = false;
        }
    }

    console.log('[Patch ' + PATCH_VERSION + '] SDK Mock + Canvas同步 完成');

    window.__targetGameFrameRate = 30;
    window.__applyGameFrameRate = function() {
        var fps = Math.max(8, Math.min(30, Number(window.__targetGameFrameRate) || 30));
        try {
            if (window.cc && cc.game && typeof cc.game.setFrameRate === 'function') {
                cc.game.setFrameRate(fps);
                console.log('[Patch ' + PATCH_VERSION + '] 🎞️ 游戏帧率已调整为 ' + fps);
            }
        } catch(e) {}
    };

    window.addEventListener('message', function(e) {
        if (!e.data) return;

        if (e.data.type === 'INJECT_SAVE_DATA') {
            var payload = e.data.payload || {};
            var b64 = payload.b64;
            var fileName = payload.fileName || '';
            console.log('[Patch ' + PATCH_VERSION + '] 收到INJECT_SAVE_DATA, b64=' + (b64 ? b64.length : 0));
            if (b64 && typeof window.__injectSaveData === 'function') {
                window.__injectSaveData(b64, fileName);
            } else {
                setTimeout(function() {
                    if (typeof window.__injectSaveData === 'function') {
                        window.__injectSaveData(b64, fileName);
                    }
                }, 500);
            }
        }

        if (e.data.type === 'INJECT_LOGIN_DATA') {
            var lPayload = e.data.payload || {};
            if (lPayload && typeof window.__injectLoginData === 'function') {
                window.__injectLoginData(lPayload);
            } else {
                setTimeout(function() {
                    if (typeof window.__injectLoginData === 'function') {
                        window.__injectLoginData(lPayload);
                    }
                }, 500);
            }
        }

        // ★ v1.0: CLEAR_SCRIPT_QUEUE → 重置执行状态（NOT __gameSceneReady__，避免预加载后误清）
        if (e.data.type === 'CLEAR_SCRIPT_QUEUE') {
            console.log('[Patch ' + PATCH_VERSION + '] 🧹 CLEAR_SCRIPT_QUEUE: 清除脚本队列+执行状态');
            window.__scriptQueue__ = [];
            window.__deferredScripts__ = [];
            window.__deferredRunning__ = false;
            window.__scriptsExecuted__ = false;
            window.__executedCount__ = 0;
            window.__totalScriptsExpected__ = 0;
            window.__sceneReExecDone__ = false;
            // ★ v1.0: 不重置 __gameSceneReady__！预加载后场景已就绪，清掉就再也回不来了
        }

        // ★ v6.13: START_GAME → 不再重置 __scriptsExecuted__!
        //   之前重置会导致: boot.js执行脚本 → START_GAME重置标志 → EXECUTE_SCRIPTS_NOW再次执行 → 双图标
        //   重启场景由 CLEAR_SCRIPT_QUEUE 处理(先清队列→重注脚本→boot.js重新执行)
        if (e.data.type === 'START_GAME') {
            console.log('[Patch ' + PATCH_VERSION + '] 🔄 START_GAME: 主队列=' +
                (window.__scriptQueue__ ? window.__scriptQueue__.length : 0) +
                ', 延迟队列=' + (window.__deferredScripts__ ? window.__deferredScripts__.length : 0) +
                ', executed=' + window.__scriptsExecuted__);
        }

        if (e.data.type === 'INJECT_USERSCRIPT') {
            var script = e.data.payload || {};
            if (script.code) {
                var sname = script.name || 'unnamed';

                window.__totalScriptsExpected__ = (window.__totalScriptsExpected__ || 0) + 1;

                // ★ v5.9: 岚山4.5等依赖引擎(scene-ready)的脚本 → 延迟执行队列
                //   引擎初始化时cc.director=null, 脚本中访问引擎对象会静默失败
                //   延迟到GAME_SCENE_READY后首次执行 → cc.director等全部就绪
                var isSceneScript = sname.indexOf('xyzw-ls') === 0 || sname.indexOf('ls-') === 0 ||
                                    sname.indexOf('岚山') === 0 ||
                                    (script.id && script.id.indexOf('scene-') === 0);

                if (isSceneScript) {
                    // → 延迟队列：只在场景就绪后执行
                    window.__deferredScripts__ = window.__deferredScripts__ || [];
                    // 避免重复入队
                    var alreadyDeferred = false;
                    for (var di = 0; di < window.__deferredScripts__.length; di++) {
                        if (window.__deferredScripts__[di].name === sname) { alreadyDeferred = true; break; }
                    }
                    if (alreadyDeferred) {
                        console.log('[Patch ' + PATCH_VERSION + '] ⏭️  脚本已在延迟队列中: ' + sname);
                        return;
                    }
                    window.__deferredScripts__.push({
                        name: sname,
                        code: script.code,
                        id: script.id || ''
                    });
                    console.log('[Patch ' + PATCH_VERSION + '] ⏳ 脚本入延迟队列(场景就绪后执行): ' + sname +
                        ' (延迟队列' + window.__deferredScripts__.length + '个, 大小' + Math.round(script.code.length/1024) + 'KB)');
                    return;
                }

                // ★ v1.0: 如果已执行过（兜底：场景就绪后到达的脚本）→ 立即执行
                if (window.__scriptsExecuted__) {
                    console.log('[Patch ' + PATCH_VERSION + '] 已执行过, 立即执行延迟脚本: ' + sname +
                        ' (' + Math.round(script.code.length/1024) + 'KB)');
                    window.__executedCount__ = (window.__executedCount__ || 0) + 1;
                    _injectAndExecuteScript(script.code, sname, script.id || '');
                    return;
                }

                // ★ 普通脚本：引擎初始化时执行
                window.__scriptQueue__ = window.__scriptQueue__ || [];
                window.__scriptQueue__.push({
                    name: sname,
                    code: script.code,
                    id: script.id || ''
                });
                console.log('[Patch ' + PATCH_VERSION + '] 脚本已入队: ' + sname +
                    ' (队列' + window.__scriptQueue__.length + '个, 大小' + Math.round(script.code.length/1024) + 'KB)');
            }
        }

        // ★ v6.15: EXECUTE_SCRIPTS_NOW 兜底 — 仅当主队列确实未执行时才触发
        //   已移除"状态不一致"重新执行逻辑 — 那会导致双图标(队列从未清空)
        if (e.data.type === 'EXECUTE_SCRIPTS_NOW') {
            console.log('[Patch ' + PATCH_VERSION + '] 🎯 收到 EXECUTE_SCRIPTS_NOW, 主队列=' +
                (window.__scriptQueue__ ? window.__scriptQueue__.length : 'null') +
                ', 延迟队列=' + (window.__deferredScripts__ ? window.__deferredScripts__.length : 'null') +
                ', executed=' + window.__scriptsExecuted__);
            if (!window.__scriptsExecuted__) {
                executeScriptQueue();
            }
            // ★ v6.11: 也执行延迟队列（岚山等依赖scene-ready的脚本可能还没被GAME_SCENE_READY触发）
            var defQ = window.__deferredScripts__;
            if (defQ && defQ.length > 0 && !window.__deferredRunning__) {
                window.__deferredRunning__ = true;
                console.log('[Patch v6.11] 🔄 EXECUTE_SCRIPTS_NOW 兜底执行延迟队列 (' + defQ.length + ' 个)');
                var defIdx = 0;
                function execDefNow() {
                    if (defIdx >= defQ.length) {
                        console.log('[Patch v6.11] ✅ 延迟队列兜底执行完毕');
                        return;
                    }
                    var ds = defQ[defIdx];
                    defIdx++;
                    console.log('[Patch v6.11] 🎯 延迟脚本兜底执行: ' + ds.name +
                        ' (' + Math.round(ds.code.length/1024) + 'KB)');
                    _injectAndExecuteScript(ds.code, ds.name, ds.id);
                    setTimeout(execDefNow, 50);
                }
                execDefNow();
            }
        }

        // ★ v5.9: 游戏场景就绪 → 执行依赖cc.director的延迟脚本（首次执行！）
        if (e.data.type === 'GAME_SCENE_READY') {
            console.log('[Patch ' + PATCH_VERSION + '] 🎯 收到 GAME_SCENE_READY, 主队列=' +
                (window.__scriptQueue__ ? window.__scriptQueue__.length : 'null') +
                ', 延迟队列=' + (window.__deferredScripts__ ? window.__deferredScripts__.length : 'null') +
                ', executed=' + window.__scriptsExecuted__);
            window.__gameSceneReady__ = true;
            window.__applyGameFrameRate();
            // 先执行主队列（如果还没执行）
            if (!window.__scriptsExecuted__) {
                executeScriptQueue();
            }
            // ★ v5.9: 执行延迟队列 — 这些脚本依赖cc.director/cc.game等引擎对象
            //   这是它们的首次执行(不是在引擎初始化时)
            //   延迟3秒执行：GAME_SCENE_READY在Launcher场景触发, 但脚本需要主游戏场景就绪
            var defQ = window.__deferredScripts__;
            if (defQ && defQ.length > 0 && !window.__deferredRunning__) {
                window.__deferredRunning__ = true;
                var DEFERRED_DELAY = 3000; // 等主游戏场景完全加载
                console.log('[Patch v5.9] ⏳ 延迟队列将在 ' + (DEFERRED_DELAY/1000) + '秒后执行 (' + defQ.length + ' 个脚本)...');
                setTimeout(function() {
                    console.log('[Patch v5.9] 🚀 场景就绪+延迟: 执行延迟队列 ' + defQ.length + ' 个脚本...');
                    var defIdx = 0;
                    function execDefNext() {
                        if (defIdx >= defQ.length) {
                            console.log('[Patch v5.9] ✅ 延迟队列全部执行完毕 (' + defQ.length + ' 个)');
                            return;
                        }
                        var ds = defQ[defIdx];
                        defIdx++;
                        console.log('[Patch v5.9] 🎯 延迟脚本首次执行: ' + ds.name +
                            ' (' + Math.round(ds.code.length/1024) + 'KB)');
                        _injectAndExecuteScript(ds.code, ds.name, ds.id);
                        setTimeout(execDefNext, 50);
                    }
                    execDefNext();
                }, DEFERRED_DELAY);
            }
        }

        if (e.data.type === 'GAME_RESIZE') {
            // ★ v11.9: 如果消息带 masterW/masterH, 临时覆盖 window.innerWidth/innerHeight
            //   让 cocos 看到的主控高宽比永远跟主控一致 → 永远不触发 _isRotated 翻转
            //   关键: canvas 仍渲染主控尺寸, 但通过 CSS transform: scale 缩到当前wrap实际尺寸
            var _w = (e.data.masterW && e.data.masterW > 0) ? e.data.masterW : (window.__realInnerWidth__ || window.innerWidth);
            var _h = (e.data.masterH && e.data.masterH > 0) ? e.data.masterH : (window.__realInnerHeight__ || window.innerHeight);
            // 缓存真实尺寸
            if (!window.__realInnerWidth__) {
                window.__realInnerWidth__ = window.innerWidth;
                window.__realInnerHeight__ = window.innerHeight;
            }
            // 覆盖 getter
            try {
                Object.defineProperty(window, 'innerWidth', { get: function() { return _w; }, configurable: true });
                Object.defineProperty(window, 'innerHeight', { get: function() { return _h; }, configurable: true });
            } catch(_ex) {}

            // ★ v11.0: 重置__maxInnerHeight__基准
            window.__maxInnerHeight__ = 0;
            window.__maxInnerWidth__ = 0;
            window.__lastInnerWidth__ = null;
            window.__lastInnerHeight__ = null;
            // ★ v11.9: canvas 渲染主控尺寸 _w×_h, 但 CSS transform scale 缩到当前wrap实际尺寸
            try {
                var canvas = document.getElementById('GameCanvas');
                if (canvas) {
                    var dpr = window.devicePixelRatio || 1;
                    canvas.style.width = _w + 'px';
                    canvas.style.height = _h + 'px';
                    canvas.width = Math.round(_w * dpr);
                    canvas.height = Math.round(_h * dpr);
                    // ★ 关键: 计算当前wrap实际尺寸, 用 transform: scale 缩到目标
                    var realWrapW = window.__realInnerWidth__ || window.innerWidth;
                    var realWrapH = window.__realInnerHeight__ || window.innerHeight;
                    if (realWrapW > 0 && realWrapH > 0 && (_w !== realWrapW || _h !== realWrapH)) {
                        var scale = Math.min(realWrapW / _w, realWrapH / _h);
                        // canvas 用绝对定位 + transform-origin: top left + scale
                        canvas.style.position = 'absolute';
                        canvas.style.left = '0';
                        canvas.style.top = '0';
                        canvas.style.transformOrigin = '0 0';
                        canvas.style.transform = 'scale(' + scale + ')';
                        console.log('[Patch ' + PATCH_VERSION + '] 🔄 canvas scale=' + scale.toFixed(3) + ' (主控' + _w + '×' + _h + ' → wrap' + realWrapW + '×' + realWrapH + ')');
                    } else {
                        canvas.style.position = '';
                        canvas.style.left = '';
                        canvas.style.top = '';
                        canvas.style.transform = '';
                        canvas.style.transformOrigin = '';
                    }
                }
                if (typeof cc !== 'undefined' && cc.view) {
                    cc.view.setFrameSize(_w, _h);
                    cc.view.resizeWithBrowserSize(true);
                    try { cc.view.emit('canvas-resize'); } catch(_e2) {}
                    try { cc.view.emit('design-resolution-changed'); } catch(_e2) {}
                    // 强制不 rotate
                    if (cc.view._isRotated !== false) {
                        cc.view._isRotated = false;
                        try { cc.game.container.style.transform = 'rotate(0deg)'; cc.game.container.style['-webkit-transform'] = 'rotate(0deg)'; } catch(_e3) {}
                    }
                }
            } catch(_ex2) {}
            try { var _evt = new Event('resize'); window.dispatchEvent(_evt); } catch(_e) {}
        }

        // ★ v6.35: 加速速度实时更新
        if (e.data.type === 'UPDATE_NIGHTMARE_SPEED') {
            window.__nightmareSpeed = e.data.speed || 0;
            localStorage.setItem('__nightmare_speed', String(window.__nightmareSpeed));
            applyNightmareSpeed();
        }
        if (e.data.type === 'UPDATE_UI_SPEED') {
            window.__uiSpeed = e.data.speed || 0;
            localStorage.setItem('__ui_speed', String(window.__uiSpeed));
            applyUiSpeed();
        }

        // ★ v6.40: 音频静音
        if (e.data.type === 'SET_AUDIO_MUTE') {
            window.__audioMuted = !!e.data.muted;
            if (window.__applyAudioMute) window.__applyAudioMute();
        }

        // 多开时后台标签降低渲染帧率，保留脚本和网络逻辑，减少 GPU/CPU 压力。
        if (e.data.type === 'SET_GAME_FRAME_RATE') {
            window.__targetGameFrameRate = e.data.fps;
            window.__applyGameFrameRate();
        }

        // ★ v6.41: 飘字优化开关
        if (e.data.type === 'SET_FLOAT_TEXT') {
            window.__floatTextEnabled = !!e.data.enabled;
            if (window.__applyFloatText) window.__applyFloatText();
        }

        // ★ v6.42: 战斗模拟开关
        if (e.data.type === 'SET_BATTLE_SIM') {
            window.__battleSimEnabled = !!e.data.enabled;
            if (window.__applyBattleSim) window.__applyBattleSim();
        }

        // ★ v6.43: 无限阵容开关
        if (e.data.type === 'SET_LINEUP') {
            console.log('[patch v6.43] 收到 SET_LINEUP, enabled=', e.data.enabled, '__applyLineup存在=', typeof window.__applyLineup);
            window.__lineupEnabled = !!e.data.enabled;
            localStorage.setItem('__lineup_enabled', window.__lineupEnabled ? '1' : '0');
            if (window.__applyLineup) window.__applyLineup();
        }

        // ★ v6.44: 打开阵容面板 — 状态栏按钮触发
        if (e.data.type === 'OPEN_LINEUP_UI') {
            console.log('[patch v6.44] 收到 OPEN_LINEUP_UI');
            if (window.__openLineupPanel && window.__lineupEnabled) {
                window.__openLineupPanel();
            } else if (window.__LINEUP_UI__ && window.__lineupEnabled) {
                window.__LINEUP_UI__();
            }
        }
    });

    // ══════════════════════════════════════════
    //  ★ v6.35: 加速模块 — 十殿速度 + UI加速
    // ══════════════════════════════════════════

    window.__nightmareSpeed = parseInt(localStorage.getItem('__nightmare_speed') || '0');
    window.__uiSpeed = parseInt(localStorage.getItem('__ui_speed') || '0');
    var _nightmareInjected = false;

    // 十殿加速: hook NightmareBattlePanel
    function injectNightmareHook() {
        if (_nightmareInjected) return;
        try {
            var NBP = window.__require && window.__require('NightmareBattlePanel');
            if (!NBP || !NBP.prototype || !NBP.prototype.onShow) return;
            var origOnShow = NBP.prototype.onShow;
            NBP.prototype.onShow = function() {
                origOnShow.apply(this, arguments);
                if (this._origDefaultTS === undefined) {
                    this._origDefaultTS = this.DEFAULT_TIMESCALE;
                }
                var speed = window.__nightmareSpeed || 0;
                this.DEFAULT_TIMESCALE = speed > 0 ? speed : (this._origDefaultTS || 1.4);
            };
            NBP.prototype.onShow.__patched = true;
            _nightmareInjected = true;
            console.log('[Patch v6.35] 十殿加速已注入, 速度=' + window.__nightmareSpeed + 'x');
        } catch(e) {}
    }

    function applyNightmareSpeed() {
        try {
            var speed = window.__nightmareSpeed || 0;
            var panel = window.cc && window.cc.director && window.cc.director.getScene &&
                        window.cc.director.getScene().getComponentInChildren('NightmareBattlePanel');
            if (panel) {
                panel.DEFAULT_TIMESCALE = speed > 0 ? speed : (panel._origDefaultTS || 1.4);
            }
        } catch(e) {}
    }

    // UI加速: 修改 HorseConstant + Scheduler timeScale
    function applyUiSpeed() {
        try {
            var speed = window.__uiSpeed || 0;
            if (speed <= 0) return;

            var rawConfigs = window.__require && window.__require('Configs');
            var configs = (rawConfigs && (rawConfigs.Configs || rawConfigs.default)) || rawConfigs;
            if (!configs) return;

            var speedKeys = ['pvpBattleSpeed', 'battleSpeed', 'BattleSpeed', 'battle_speed'];
            var hc = configs.HorseConstant || (configs.Configs && configs.Configs.HorseConstant);
            var hcConfig = hc && (hc.config || hc.Config || hc);
            if (hcConfig && typeof hcConfig === 'object') {
                speedKeys.forEach(function(k) { if (k in hcConfig) hcConfig[k] = speed; });
            }
            if (configs.NightMare && configs.NightMare.map) {
                configs.NightMare.map.forEach(function(v) { if (v) v.BattleSpeed = speed; });
            }

            var director = window.cc && window.cc.director;
            var sched = director && director.getScheduler ? director.getScheduler() : null;
            if (sched && typeof sched.setTimeScale === 'function') {
                sched.setTimeScale(speed);
            }
            console.log('[Patch v6.35] UI加速已应用, 速度=' + speed + 'x');
        } catch(e) {}
    }

    // 等待游戏加载完成后注入十殿hook
    var _speedCheckTimer = setInterval(function() {
        if (typeof window.__require === 'function') {
            clearInterval(_speedCheckTimer);
            injectNightmareHook();
            if (window.__uiSpeed > 0) {
                setTimeout(applyUiSpeed, 2000);
            }
        }
    }, 500);

    // ══════════════════════════════════════════
    //  ★ v6.40: 音频静音 — Hook cc.audioEngine 底层方法
    //
    //   根因分析:
    //   v6.36 hook了 playMusic/playEffect/setMusicVolume/setEffectsVolume (高层封装)
    //   v6.37 hook了 HTMLAudioElement.prototype (游戏用WebAudio, 不走HTML5 Audio)
    //   v6.38 扫描 SoundManager (在远程bundle中, 预加载阶段不可达)
    //
    //   ★ 真相: SoundManager 实际调用的是底层 API:
    //       cc.audioEngine.play(clip, loop, volume)     ← 未hook!
    //       cc.audioEngine.setVolume(audioId, volume)   ← 未hook!
    //     而非高层 playMusic/playEffect/setMusicVolume/setEffectsVolume
    //
    //   超级咸鱼14 SoundManager 证据:
    //     setMusicVolume() { this._music.forEach(id => cc.audioEngine.setVolume(id, vol)) }
    //     playMusic()     { return cc.audioEngine.play(clip, loop, this._music.volume) }
    // ══════════════════════════════════════════

    window.__audioMuted = localStorage.getItem('__audio_muted') === '1';

    var _audioHooked = false;
    var _activeAudioIds = [];       // 追踪所有活跃的audioId
    var _origPlay = null;          // cc.audioEngine.play
    var _origSetVolume = null;     // cc.audioEngine.setVolume
    var _origStopAll = null;       // cc.audioEngine.stopAll

    function hookAudioEngineCore() {
        if (_audioHooked) return;
        try {
            var ae = window.cc && window.cc.audioEngine;
            if (!ae) return;

            _origPlay = ae.play;
            _origSetVolume = ae.setVolume;
            _origStopAll = ae.stopAll;

            // ── Hook 1: play(clip, loop, volume) — 所有音频的入口 ──
            ae.play = function(clip, loop, volume) {
                var vid = _origPlay.call(this, clip, loop,
                    window.__audioMuted ? 0 : (volume !== undefined ? volume : 1));
                if (!window.__audioMuted) {
                    _activeAudioIds.push(vid);
                }
                return vid;
            };

            // ── Hook 2: setVolume(audioId, volume) — SoundManager 调音量走这里 ──
            ae.setVolume = function(audioId, volume) {
                return _origSetVolume.call(this, audioId,
                    window.__audioMuted ? 0 : volume);
            };

            // ── Hook 3: 也拦截 playMusic 防止遗漏 ──
            if (ae.playMusic && !ae.__hooked_pm) {
                var _opm = ae.playMusic;
                ae.playMusic = function(clip, loop) {
                    return _opm.call(this, clip, loop);
                };
                ae.__hooked_pm = true;
            }

            _audioHooked = true;
            console.log('[Patch v6.40] 🔊 音频 hook 已就绪 (底层 play/setVolume), muted=' + window.__audioMuted);

            // 如果初始需静音，立即停止所有音频
            if (window.__audioMuted) {
                try {
                    if (ae.stopAll) ae.stopAll();
                    if (ae.stopMusic) ae.stopMusic();
                    if (ae.stopAllEffects) ae.stopAllEffects();
                } catch(e) {}
            }
        } catch(e) {
            console.warn('[Patch v6.40] hookAudioEngine 失败:', e.message);
        }
    }

    // ── 动态切换 ──
    window.__applyAudioMute = function() {
        localStorage.setItem('__audio_muted', window.__audioMuted ? '1' : '0');

        var ae = window.cc && window.cc.audioEngine;
        if (!ae) return;

        if (window.__audioMuted) {
            // 静音：强制所有活跃音频音量为0 + 停止
            for (var i = 0; i < _activeAudioIds.length; i++) {
                try { _origSetVolume.call(ae, _activeAudioIds[i], 0); } catch(e) {}
            }
            try { if (_origStopAll) _origStopAll.call(ae); } catch(e) {}
            _activeAudioIds.length = 0;
            console.log('[Patch v6.40] 🔊 已静音');
        } else {
            // 恢复：清除追踪列表，游戏会重新播放
            _activeAudioIds.length = 0;
            console.log('[Patch v6.40] 🔊 已恢复');
        }
    };

    // 等待 cc.audioEngine 就绪后hook
    var _aeCheckTimer = setInterval(function() {
        if (window.cc && window.cc.audioEngine && window.cc.audioEngine.play && window.cc.audioEngine.setVolume) {
            clearInterval(_aeCheckTimer);
            hookAudioEngineCore();
        }
    }, 200);

    // 超时（30秒）
    setTimeout(function() {
        if (!_audioHooked) {
            clearInterval(_aeCheckTimer);
            console.warn('[Patch v6.40] ⚠️ cc.audioEngine 30秒未就绪');
        }
    }, 30000);

    console.log('[Patch v6.40] 🔍 等待 cc.audioEngine 就绪... muted=' + window.__audioMuted);

    // ══════════════════════════════════════════
    //  ★ v1.0: 多阶段延迟Canvas尺寸修正
    //  解决: Cocos初始化时iframe布局未完成导致canvas尺寸错误
    // ══════════════════════════════════════════

    // 阶段1: DOMContentLoaded — 最早可能时机
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() {
            setTimeout(function() { forceCanvasResize('DOMReady+200ms'); }, 200);
        });
    } else {
        setTimeout(function() { forceCanvasResize('AlreadyDOMReady'); }, 100);
    }

    // 阶段2: 多个延迟时间点触发(覆盖Cocos各个加载阶段)
    [300, 800, 1500, 2500, 4000, 6000].forEach(function(delay) {
        setTimeout(function() { forceCanvasResize('delay#' + delay + 'ms'); }, delay);
    });

    // 阶段3: ResizeObserver — 实时监听容器变化
    if (typeof ResizeObserver !== 'undefined') {
        var _lastW = window.innerWidth;
        var _lastH = window.innerHeight;
        var _ro = new ResizeObserver(function(entries) {
            for (var i = 0; i < entries.length; i++) {
                var w = entries[i].contentRect.width;
                var h = entries[i].contentRect.height;
                if (Math.abs(w - _lastW) > 5 || Math.abs(h - _lastH) > 5) {
                    _lastW = w; _lastH = h;
                    forceCanvasResize('ResizeObserver');
                }
            }
        });
        _ro.observe(document.body);

        // 也观察html元素
        _ro.observe(document.documentElement);
    }

    // 阶段4: window.resize事件
    window.addEventListener('resize', function() {
        setTimeout(function() { forceCanvasResize('window.resize'); }, 100);
    });

    // 阶段5: visibilitychange — 从后台恢复时刷新
    document.addEventListener('visibilitychange', function() {
        if (!document.hidden) {
            setTimeout(function() { forceCanvasResize('visibilityChange'); }, 200);
            setTimeout(function() { forceCanvasResize('visibilityChange+500'); }, 500);
        }
    });

    // 阶段6: orientationchange
    window.addEventListener('orientationchange', function() {
        setTimeout(function() { forceCanvasResize('orientationChange+300'); }, 300);
        setTimeout(function() { forceCanvasResize('orientationChange+800'); }, 800);
    });

    // ══════════════════════════════════════════
    //  ★ v1.0: 脚本执行队列（引擎初始化前由boot.js批量执行）
    // ══════════════════════════════════════════
    window.__scriptQueue__ = window.__scriptQueue__ || [];
    window.__scriptsExecuted__ = false;
    window.__totalScriptsExpected__ = 0;
    window.__gameSceneReady__ = false;  // ★ v1.0: 场景就绪标记

    // ★ v5.9 debug: 统一脚本注入+执行函数（带插桩监测）
    function _injectAndExecuteScript(code, name, id) {
        var t0 = Date.now();
        var sizeKB = Math.round(code.length / 1024);

        // ★ 插桩: 捕获脚本的console输出
        var capturedLogs = [];
        var origConsole = {};
        ['log','warn','error','info','debug'].forEach(function(k) {
            origConsole[k] = console[k];
            console[k] = function() {
                var args = Array.prototype.slice.call(arguments);
                var s = args.map(function(v) {
                    try { return typeof v === 'object' ? JSON.stringify(v).substring(0,300) : String(v).substring(0,300); }
                    catch(e) { return '[Object]'; }
                }).join(' ');
                capturedLogs.push('[' + k + '] ' + s);
                return origConsole[k].apply(console, arguments);
            };
        });

        // ★ 插桩: 捕获全局变量设置
        var newGlobals = [];
        var preGlobals = {};
        try {
            for (var gk in window) {
                try { preGlobals[gk] = typeof window[gk]; } catch(e) {}
            }
        } catch(e) {}

        // ★ 插桩: 捕获DOM创建
        var createdElements = [];
        var _origCE = document.createElement.bind(document);
        document.createElement = function(tag) {
            var el = _origCE(tag);
            var t = (tag || '').toLowerCase();
            if (t === 'div' || t === 'span' || t === 'button' || t === 'a' || t === 'iframe' ||
                t === 'canvas' || t === 'input' || t === 'textarea' || t === 'select') {
                createdElements.push(t);
            }
            return el;
        };

        // ★ 插桩: 捕获未捕获的错误
        var scriptErrors = [];
        var _onerror = window.onerror;
        window.onerror = function(msg, src, line, col, err) {
            scriptErrors.push({ msg: msg, src: src, line: line, col: col });
            if (_onerror) return _onerror.apply(this, arguments);
        };

        var success = false;
        try {
            var el = document.createElement('script');
            el.textContent = code;
            el.setAttribute('data-script-name', name || 'unnamed');
            if (id) el.setAttribute('data-script-id', id);
            var target = document.head || document.documentElement || document.body;
            if (!target) throw new Error('DOM not ready: no head/html/body');
            target.appendChild(el);
            target.removeChild(el);
            success = true;
        } catch(err) {
            capturedLogs.push('[INTERNAL_ERROR] ' + err.message + '\n  ' + (err.stack || '').substring(0, 500));
        }

        // 恢复所有hooks
        window.onerror = _onerror;
        document.createElement = _origCE;
        ['log','warn','error','info','debug'].forEach(function(k) {
            console[k] = origConsole[k];
        });

        // 检测新全局变量
        try {
            for (var gk in window) {
                if (!(gk in preGlobals)) {
                    var gtype = typeof window[gk];
                    if (gtype !== 'undefined') {
                        newGlobals.push(gk + ':' + gtype);
                    }
                }
            }
        } catch(e) {}

        var elapsed = Date.now() - t0;

        // ★ 输出详细诊断信息
        console.log('[Patch ' + PATCH_VERSION + '] ' + (success ? '✅' : '❌') + ' ' + (name || 'unnamed') +
            ' (' + sizeKB + 'KB, ' + elapsed + 'ms)');

        // 脚本自身的console输出
        if (capturedLogs.length > 0) {
            console.log('[Patch ' + PATCH_VERSION + '] 📝 脚本console (' + capturedLogs.length + '条):');
            var maxShow = Math.min(capturedLogs.length, 20);
            for (var cl = 0; cl < maxShow; cl++) {
                console.log('  ' + capturedLogs[cl]);
            }
            if (capturedLogs.length > 20) console.log('  ... (共' + capturedLogs.length + '条, 仅显示前20)');
        } else {
            console.log('[Patch ' + PATCH_VERSION + '] ⚠️ 脚本无console输出!');
        }

        // 新全局变量
        if (newGlobals.length > 0) {
            console.log('[Patch ' + PATCH_VERSION + '] 🌍 新全局变量 (' + newGlobals.length + '个): ' +
                newGlobals.slice(0, 30).join(', ') + (newGlobals.length > 30 ? '...' : ''));
        }

        // DOM创建
        if (createdElements.length > 0) {
            console.log('[Patch ' + PATCH_VERSION + '] 🏗️ 创建DOM元素 (' + createdElements.length + '个): ' +
                createdElements.slice(0, 20).join(', '));
        }

        // 运行时错误
        if (scriptErrors.length > 0) {
            console.error('[Patch ' + PATCH_VERSION + '] 🔴 脚本运行时错误 (' + scriptErrors.length + '个):');
            for (var se = 0; se < scriptErrors.length; se++) {
                console.error('  ' + scriptErrors[se].msg + ' @' + scriptErrors[se].src + ':' + scriptErrors[se].line);
            }
        }

        try {
            window.parent.postMessage({
                type: 'SCRIPT_EXECUTED',
                payload: {
                    name: name || 'unnamed',
                    sizeKB: sizeKB,
                    elapsed: elapsed,
                    success: success,
                    consoleCount: capturedLogs.length,
                    globalsCount: newGlobals.length,
                    domCreated: createdElements.length,
                    errorCount: scriptErrors.length
                }
            }, '*');
        } catch(e) {}

        return success;
    }

    window.executeScriptQueue = function() {
        if (window.__scriptsExecuted__) {
            console.log('[Patch ' + PATCH_VERSION + '] ⚠️ executeScriptQueue 跳过(已执行)');
            return;
        }
        var queue = window.__scriptQueue__;
        console.log('[Patch ' + PATCH_VERSION + '] executeScriptQueue() called, queue=' +
            (queue ? queue.length : 'null') + ', sceneReady=' + window.__gameSceneReady__);

        if (!queue || !queue.length) {
            console.log('[Patch ' + PATCH_VERSION + '] ⏳ 脚本队列为空, 等待后续注入...');
            try {
                window.parent.postMessage({
                    type: 'SCRIPT_QUEUE_STATUS',
                    payload: { queueLen: 0, executed: false }
                }, '*');
            } catch(e) {}
            return;
        }

        // ★ v1.0 核心修复: 直接在引擎初始化时执行（无需等待场景就绪）
        //   v1.0 证明引擎初始化时执行脚本 → 悬浮按钮正常显示
        //   v1.0/v1.0 延迟到场景就绪后 → 按钮消失（Canvas已占满视口）
        //   __scriptsExecuted__ 保证只执行一次，不会出现双按钮
        console.log('[Patch ' + PATCH_VERSION + '] 🚀 引擎初始化时执行 ' + queue.length + ' 个脚本...');
        window.__scriptsExecuted__ = true;
        window.__executedCount__ = 0;

        var execIdx = 0;
        function execNext() {
            if (execIdx >= queue.length) {
                console.log('[Patch ' + PATCH_VERSION + '] ✅ 全部 ' + queue.length + ' 个脚本执行完毕');
                // ★ v6.15: 执行完毕后清空队列, 防止 EXECUTE_SCRIPTS_NOW 的"状态不一致"兜底误判重执行
                window.__scriptQueue__ = [];
                return;
            }
            var s = queue[execIdx];
            execIdx++;
            window.__executedCount__++;
            _injectAndExecuteScript(s.code, s.name, s.id);
            if (s.code.length > 500000) {
                setTimeout(execNext, 50);
            } else {
                execNext();
            }
        }
        execNext();
    };
})();
