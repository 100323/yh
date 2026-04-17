// Tampermonkey API Polyfill for Browser Environment
// This provides compatibility for userscripts running outside of Tampermonkey

(function() {
    'use strict';

    // unsafeWindow - provides access to the actual window object
    if (typeof unsafeWindow === 'undefined') {
        window.unsafeWindow = window;
    }

    // GM_addStyle - adds CSS styles to the page
    if (typeof GM_addStyle === 'undefined') {
        window.GM_addStyle = function(css) {
            const style = document.createElement('style');
            style.type = 'text/css';
            style.textContent = css;
            document.head.appendChild(style);
            return style;
        };
    }

    // GM_xmlhttpRequest - makes cross-origin requests
    if (typeof GM_xmlhttpRequest === 'undefined') {
        window.GM_xmlhttpRequest = function(details) {
            const xhr = new XMLHttpRequest();
            
            xhr.open(details.method || 'GET', details.url, true);
            
            if (details.headers) {
                for (const [key, value] of Object.entries(details.headers)) {
                    xhr.setRequestHeader(key, value);
                }
            }
            
            if (details.responseType) {
                xhr.responseType = details.responseType;
            }
            
            xhr.onload = function() {
                if (details.onload) {
                    details.onload({
                        status: xhr.status,
                        statusText: xhr.statusText,
                        responseText: xhr.responseText,
                        response: xhr.response,
                        readyState: xhr.readyState
                    });
                }
            };
            
            xhr.onerror = function() {
                if (details.onerror) {
                    details.onerror({
                        status: xhr.status,
                        statusText: xhr.statusText
                    });
                }
            };
            
            xhr.ontimeout = function() {
                if (details.ontimeout) {
                    details.ontimeout({});
                }
            };
            
            xhr.send(details.data || null);
            
            return {
                abort: function() {
                    xhr.abort();
                }
            };
        };
    }

    // GM_getValue - gets a stored value
    if (typeof GM_getValue === 'undefined') {
        window.GM_getValue = function(key, defaultValue) {
            try {
                const value = localStorage.getItem('GM_' + key);
                return value !== null ? JSON.parse(value) : defaultValue;
            } catch (e) {
                return defaultValue;
            }
        };
    }

    // GM_setValue - stores a value
    if (typeof GM_setValue === 'undefined') {
        window.GM_setValue = function(key, value) {
            try {
                localStorage.setItem('GM_' + key, JSON.stringify(value));
            } catch (e) {
                console.error('GM_setValue failed:', e);
            }
        };
    }

    // GM_deleteValue - deletes a stored value
    if (typeof GM_deleteValue === 'undefined') {
        window.GM_deleteValue = function(key) {
            try {
                localStorage.removeItem('GM_' + key);
            } catch (e) {
                console.error('GM_deleteValue failed:', e);
            }
        };
    }

    // GM_listValues - lists all stored keys
    if (typeof GM_listValues === 'undefined') {
        window.GM_listValues = function() {
            const keys = [];
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key && key.startsWith('GM_')) {
                    keys.push(key.substring(3));
                }
            }
            return keys;
        };
    }

    // GM_log - logs messages
    if (typeof GM_log === 'undefined') {
        window.GM_log = function(...args) {
            console.log('[GM]', ...args);
        };
    }

    // GM_info - provides script information
    if (typeof GM_info === 'undefined') {
        window.GM_info = {
            script: {
                name: 'UserScript',
                version: '1.0',
                description: '',
                author: '',
                matches: [],
                includes: [],
                excludes: [],
                resources: []
            },
            scriptMetaStr: '',
            scriptWillUpdate: false,
            version: 'unknown'
        };
    }

    console.log('[Tampermonkey Polyfill] API compatibility layer loaded');
})();
