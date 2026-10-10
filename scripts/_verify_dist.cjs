/**
 * 全量校验构建产物完整性：
 *  - 以 index.html 为入口
 *  - 递归解析 static import（from"./x" / import"./x"）
 *  - 额外解析 vite 的 __vite__mapDeps 依赖表（含动态 chunk 及其 .css）——这是关键，静态 import 图会漏掉它
 *  - 用 --base 前缀校验每个引用在服务器上是否 200
 * 用法（必须显式构造 argv，避开 Git Bash 路径转换）：
 *   node scripts/_verify_dist.cjs http://193.112.151.193
 */
const http = require('http');

const base = process.argv[2] || 'http://193.112.151.193';

function get(path) {
  return new Promise((resolve) => {
    const u = new URL(path, base);
    http.get(u, (res) => {
      let n = 0;
      res.on('data', (c) => (n += c.length));
      res.on('end', () => resolve({ status: res.statusCode, bytes: n }));
    }).on('error', () => resolve({ status: 0, bytes: 0 }));
  });
}

(async () => {
  const idx = await get('/');
  if (idx.status !== 200) {
    console.log('index.html 不可达', idx);
    process.exit(1);
  }

  // 取 index.html 文本（用 http 手动读，避免额外依赖）
  const html = await new Promise((resolve) => {
    http.get(new URL('/', base), (res) => {
      let s = '';
      res.on('data', (c) => (s += c));
      res.on('end', () => resolve(s));
    });
  });

  const assets = new Set();
  const collect = (text) => {
    for (const m of text.matchAll(/assets\/([A-Za-z0-9_.\-]+\.(?:js|css))/g)) assets.add(m[1]);
    for (const m of text.matchAll(/["']\.\/([A-Za-z0-9_.\-]+\.(?:js|css))["']/g)) assets.add(m[1]);
    for (const m of text.matchAll(/from"\.\/([^"]+)"/g)) assets.add(m[1]);
  };
  collect(html);

  // BFS：抓取每个 js 的内容继续展开
  const queue = [...assets];
  const done = new Set();
  while (queue.length) {
    const f = queue.shift();
    if (done.has(f) || !f.endsWith('.js')) { done.add(f); continue; }
    done.add(f);
    const r = await get('/assets/' + f);
    if (r.status !== 200) continue;
    const txt = await new Promise((resolve) => {
      http.get(new URL('/assets/' + f, base), (res) => {
        let s = '';
        res.on('data', (c) => (s += c));
        res.on('end', () => resolve(s));
      });
    });
    const before = assets.size;
    collect(txt);
    if (assets.size > before) {
      for (const a of assets) if (!done.has(a)) queue.push(a);
    }
  }

  // 只校验 vite 真实产物：文件名必须带 hash 后缀（name-HASH.js / name-HASH.css）
  // browserify 等打包器内联的模块路径字符串（如 "./xxh32.js"）不是真实文件引用，需排除
  const HASHED = /-[A-Za-z0-9_]{8,}\.(?:js|css)$/;
  const missing = [];
  let ok = 0;
  for (const f of [...assets].filter((x) => HASHED.test(x))) {
    const r = await get('/assets/' + f);
    if (r.status === 200) ok++;
    else missing.push({ f, status: r.status });
  }

  console.log('base =', base);
  console.log('引用产物总数 =', assets.size);
  console.log('（已过滤无 hash 的打包器内联字符串）');
  console.log('可达 200 =', ok);
  console.log('缺失/异常 =', missing.length);
  for (const m of missing) console.log('   ', m.status, m.f);
  if (!missing.length) console.log('   ✅ 全部齐全');
})();
