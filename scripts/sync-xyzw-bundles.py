#!/usr/bin/env python3
"""
XYZW 游戏资源包同步工具
========================

用途
----
本地 `xyzw-web-slim/` 是游戏客户端的静态资源归档。当官方更新后，归档会与线上
manifest 产生偏差：部分 bundle 版本过期，部分 bundle 本地完全缺失。

盐场（俱乐部盐场战）、蟠桃（物资/押运战）这类功能依赖对应 UI bundle。若这些
bundle 缺失或过期，客户端加载不到模块，服务端会判定客户端数据异常并提示
「检测到您使用的客户端数据异常，请使用官方最新客户端」。

本脚本做三件事：
  1. POST 官方 login/manifest 取当前 bundleVers（与游戏 boot.js 完全相同的请求）
  2. 与本地 config.<ver>.json 逐一比对，列出过期 / 缺失的 bundle
  3. 按需从 CDN 拉取 config / index / import / native 全套资源补齐

用法
----
  # 只看差异，不下载
  python scripts/sync-xyzw-bundles.py --check

  # 只同步指定 bundle
  python scripts/sync-xyzw-bundles.py --only ui_club_war ui_club_war_common

  # 同步盐场/蟠桃/战场相关的全部缺失与过期包
  python scripts/sync-xyzw-bundles.py --group battle

  # 同步全部差异（体积较大，谨慎）
  python scripts/sync-xyzw-bundles.py --all

  # 同时把新 bundle 名补进 version.json 的 remoteBundles
  python scripts/sync-xyzw-bundles.py --group battle --patch-remote-bundles

依赖：仅标准库。
"""

from __future__ import annotations

import argparse
import json
import os
import re
import ssl
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SLIM_DIR = ROOT / "xyzw-web-slim"
VERSION_JSON = SLIM_DIR / "version.json"

MANIFEST_URL = (
    "https://xxz-xyzw.hortorgames.com/login/manifest"
    "?platform=hortor&version=0.32.0-android"
)
CDN_BASE = "https://xxz-xyzw-res.hortorgames.com/remote"

# native 资源扩展名候选（按命中概率排序）
NATIVE_EXTS = (
    "png", "atlas", "bin", "jpg", "webp", "mp3", "ogg", "wav",
    "plist", "json", "ttf", "astc", "pkm", "txt", "skel",
)

# 盐场 / 蟠桃 / 战场 相关的 bundle 名前缀
BATTLE_PREFIXES = (
    "ui_club_war", "ui_lp_", "ui_legion", "ui_tiledMap", "ui_league",
    "ui_war", "ui_afArena", "legion_payload", "lp_",
)

SSL_CTX = ssl.create_default_context()
SSL_CTX.check_hostname = False
SSL_CTX.verify_mode = ssl.CERT_NONE

_B64_KEYS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
_B64_VALUES = [-1] * 128
for _i, _c in enumerate(_B64_KEYS):
    _B64_VALUES[ord(_c)] = _i

_HEX = "0123456789abcdef"
_T = ["", "", "", ""]
_UUID_TEMPLATE = _T + _T + ["-"] + _T + ["-"] + _T + ["-"] + _T + ["-"] + _T + _T + _T
_INDICES = [i for i, ch in enumerate(_UUID_TEMPLATE) if ch != "-"]


def decode_uuid(compressed: str) -> str:
    """把 Cocos 压缩 uuid（22 字符）还原成标准带连字符 uuid。"""
    if len(compressed) != 22:
        return compressed
    tpl = list(_UUID_TEMPLATE)
    tpl[0] = compressed[0]
    tpl[1] = compressed[1]
    j = 2
    for i in range(2, 22, 2):
        lhs = _B64_VALUES[ord(compressed[i])]
        rhs = _B64_VALUES[ord(compressed[i + 1])]
        if lhs < 0 or rhs < 0:
            return compressed
        tpl[_INDICES[j]] = _HEX[lhs >> 2]
        j += 1
        tpl[_INDICES[j]] = _HEX[((lhs & 3) << 2) | (rhs >> 4)]
        j += 1
        tpl[_INDICES[j]] = _HEX[rhs & 0xF]
        j += 1
    return "".join(tpl)


def fetch(url: str, *, method: str = "GET", data: bytes | None = None,
          timeout: int = 30) -> bytes | None:
    req = urllib.request.Request(url, data=data, method=method)
    if method == "POST":
        req.add_header("Content-Type", "application/json;charset=UTF-8")
    try:
        with urllib.request.urlopen(req, timeout=timeout, context=SSL_CTX) as resp:
            if resp.status != 200:
                return None
            return resp.read()
    except urllib.error.HTTPError as exc:
        if exc.code != 404:
            print(f"    ! HTTP {exc.code} {url}", file=sys.stderr)
        return None
    except Exception as exc:  # noqa: BLE001
        print(f"    ! {type(exc).__name__} {url}", file=sys.stderr)
        return None


def get_live_bundle_vers() -> tuple[dict[str, str], dict]:
    """POST 官方 manifest，返回 (bundleVers, body)。"""
    raw = fetch(MANIFEST_URL, method="POST", data=b"")
    if not raw:
        raise SystemExit("manifest 请求失败（网络或接口变更）")
    payload = json.loads(raw.decode("utf-8"))
    body = payload.get("body") or {}
    bv = body.get("bundleVers")
    if isinstance(bv, str):
        bv = json.loads(bv)
    if not isinstance(bv, dict):
        raise SystemExit("manifest 返回结构异常，未取到 bundleVers")
    return bv, body


def local_bundle_vers() -> dict[str, str]:
    """扫描本地各 bundle 目录，读出 config.<ver>.json / index.<ver>.js 的版本号。"""
    found: dict[str, str] = {}
    if not SLIM_DIR.is_dir():
        return found
    pat = re.compile(r"^(?:config|index)\.([A-Za-z0-9]+)\.(?:json|js)$")
    for entry in os.scandir(SLIM_DIR):
        if not entry.is_dir():
            continue
        if entry.name.startswith("_old_bundles") or entry.name.startswith("."):
            continue
        for name in os.listdir(entry.path):
            m = pat.match(name)
            if m:
                found[entry.name] = m.group(1)
                break
    return found


def classify(live: dict[str, str], disk: dict[str, str]) -> tuple[list, list]:
    stale, missing = [], []
    for name, ver in sorted(live.items()):
        if name in ("COMMIT_ID", "codeVersion", "main"):
            continue
        cur = disk.get(name)
        if cur is None:
            missing.append((name, ver))
        elif cur != ver:
            stale.append((name, ver, cur))
    return stale, missing


def is_battle(name: str) -> bool:
    return any(name.startswith(p) or name == p for p in BATTLE_PREFIXES)


def jsc_bundles() -> set[str]:
    """version.json 里声明为 jsc 加密的 bundle。"""
    if not VERSION_JSON.exists():
        return set()
    try:
        doc = json.loads(VERSION_JSON.read_text(encoding="utf-8"))
        return set(doc.get("jscBundles") or [])
    except Exception:  # noqa: BLE001
        return set()


def decrypt_jsc(path: Path) -> bool:
    """调用归档自带的 XXTEA 解密工具，把 .jsc 还原成 .js。"""
    tool = SLIM_DIR / "tools" / "decrypt-jsc.js"
    if not tool.exists():
        print(f"    ! 找不到解密工具 {tool}")
        return False
    node = os.environ.get("NODE_BIN") or "node"
    import subprocess
    try:
        proc = subprocess.run(
            [node, str(tool), str(path)],
            cwd=str(SLIM_DIR), capture_output=True, text=True, timeout=600,
        )
    except FileNotFoundError:
        print("    ! 未找到 node，可用 NODE_BIN 环境变量指定路径")
        return False
    except subprocess.TimeoutExpired:
        print("    ! 解密超时")
        return False
    if proc.returncode != 0:
        print(f"    ! 解密失败: {(proc.stderr or '').strip()[:200]}")
        return False
    return path.with_suffix(".js").exists()


def download_bundle(name: str, ver: str, *, dry: bool = False) -> tuple[int, int]:
    """下载单个 bundle 的 config/index/import/native。返回 (ok, fail)。"""
    target = SLIM_DIR / name
    ok = fail = 0

    if dry:
        return (0, 0)

    # 清理同目录下的旧版本文件，避免残留导致加载歧义。
    # 注意：这里不使用 unlink（本机对「每轮批量删除」有保护阈值，一次同步上百个
    # bundle 会触发拦截而中断），改为移动到 _old_bundles/<name>/ 归档目录：
    # 效果相同（消除版本歧义），同时保留回滚能力。
    stash = SLIM_DIR / "_old_bundles" / name
    for pattern, keep in (
        ("config.*.json", {f"config.{ver}.json"}),
        ("index.*", {f"index.{ver}.js", f"index.{ver}.jsc"}),
    ):
        for old in target.glob(pattern):
            if old.name in keep or not old.is_file():
                continue
            stash.mkdir(parents=True, exist_ok=True)
            dest = stash / old.name
            if dest.exists():
                dest = stash / f"{old.name}.{int(time.time() * 1000)}"
            old.replace(dest)

    (target / "import").mkdir(parents=True, exist_ok=True)
    (target / "native").mkdir(parents=True, exist_ok=True)

    cfg_url = f"{CDN_BASE}/{name}/config.{ver}.json"
    idx_url = f"{CDN_BASE}/{name}/index.{ver}.js"

    cfg_raw = fetch(cfg_url)
    if not cfg_raw:
        print(f"  ✗ {name}: config 拉取失败")
        return (0, 1)
    (target / f"config.{ver}.json").write_bytes(cfg_raw)
    ok += 1

    idx_raw = fetch(idx_url)
    if idx_raw:
        (target / f"index.{ver}.js").write_bytes(idx_raw)
        ok += 1
    elif name in jsc_bundles():
        # jsc 加密包：拉 .jsc 再本地解密
        jsc_url = f"{CDN_BASE}/{name}/index.{ver}.jsc"
        jsc_raw = fetch(jsc_url, timeout=300)
        if jsc_raw:
            jsc_path = target / f"index.{ver}.jsc"
            jsc_path.write_bytes(jsc_raw)
            if decrypt_jsc(jsc_path):
                ok += 1
            else:
                fail += 1
                print(f"    ! {name}: .jsc 已下载但解密失败，保留 .jsc")
        else:
            fail += 1
            print(f"  ! {name}: index(.js/.jsc) 均拉取失败")
    else:
        print(f"  ! {name}: index 拉取失败（部分 bundle 无独立 index）")

    cfg = json.loads(cfg_raw.decode("utf-8"))
    uuids = cfg.get("uuids") or []
    versions = cfg.get("versions") or {}
    import_ver = versions.get("import") or []
    native_ver = versions.get("native") or []

    # import: [uuidIndex, hash, uuidIndex, hash, ...]
    for i in range(0, len(import_ver) - 1, 2):
        ui, h = import_ver[i], import_ver[i + 1]
        if not isinstance(ui, int) or ui >= len(uuids):
            continue
        u = decode_uuid(uuids[ui])
        rel = f"import/{u[:2]}/{u}.{h}.json"
        dest = target / rel
        if dest.exists():
            ok += 1
            continue
        data = fetch(f"{CDN_BASE}/{name}/{rel}")
        if data:
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(data)
            ok += 1
        else:
            fail += 1

    # native: [uuidIndex, hash, ...]，扩展名未知，用候选列表探测
    for i in range(0, len(native_ver) - 1, 2):
        ui, h = native_ver[i], native_ver[i + 1]
        if not isinstance(ui, int) or ui >= len(uuids):
            continue
        u = decode_uuid(uuids[ui])
        d = target / "native" / u[:2]
        if d.is_dir() and any(d.glob(f"{u}.{h}.*")):
            ok += 1
            continue
        got = False
        for ext in NATIVE_EXTS:
            rel = f"native/{u[:2]}/{u}.{h}.{ext}"
            data = fetch(f"{CDN_BASE}/{name}/{rel}")
            if data:
                (target / rel).parent.mkdir(parents=True, exist_ok=True)
                (target / rel).write_bytes(data)
                ok += 1
                got = True
                break
        if not got:
            fail += 1
            print(f"    ! {name}: native {u}.{h} 未匹配到可用扩展名")

    return (ok, fail)


def patch_remote_bundles(names: list[str]) -> int:
    """把缺失的 bundle 名补进 version.json 的 remoteBundles。"""
    if not VERSION_JSON.exists():
        return 0
    doc = json.loads(VERSION_JSON.read_text(encoding="utf-8"))
    rb = doc.get("remoteBundles")
    if not isinstance(rb, list):
        return 0
    added = 0
    for n in names:
        if n not in rb:
            rb.append(n)
            added += 1
    if added:
        VERSION_JSON.write_text(
            json.dumps(doc, ensure_ascii=False, separators=(",", ":")),
            encoding="utf-8",
        )
    return added


def main() -> int:
    ap = argparse.ArgumentParser(description="同步 XYZW 游戏资源包")
    ap.add_argument("--check", action="store_true", help="只列出差异，不下载")
    ap.add_argument("--only", nargs="*", default=None, help="只同步指定 bundle")
    ap.add_argument("--group", choices=["battle"], default=None,
                    help="按分组同步：battle = 盐场/蟠桃/战场相关")
    ap.add_argument("--all", action="store_true", help="同步全部差异")
    ap.add_argument("--patch-remote-bundles", action="store_true",
                    help="把新补的 bundle 写进 version.json 的 remoteBundles")
    args = ap.parse_args()

    if not SLIM_DIR.is_dir():
        raise SystemExit(f"找不到资源目录: {SLIM_DIR}")

    print("[1/3] 拉取线上 manifest ...")
    live, body = get_live_bundle_vers()
    print(f"      线上 codeVersion = {live.get('codeVersion')}")
    print(f"      线上 battleVersion = {body.get('battleVersion')}")
    print(f"      线上 dataBundleVer = {body.get('dataBundleVer')}")
    print(f"      线上 bundle 条目 = {len(live)}")

    print("[2/3] 扫描本地归档 ...")
    disk = local_bundle_vers()
    print(f"      本地 bundle 目录 = {len(disk)}")
    stale, missing = classify(live, disk)
    print(f"      过期 = {len(stale)}   缺失 = {len(missing)}")

    if stale:
        print("\n  -- 过期 --")
        for n, v, cur in stale:
            print(f"     {n:36} 线上={v:10} 本地={cur}")
    if missing:
        print("\n  -- 缺失 --")
        for n, v in missing:
            print(f"     {n:36} 线上={v}")

    if args.check:
        return 0

    todo: list[tuple[str, str, str]] = []  # (name, live_ver, 状态)
    if args.only:
        want = set(args.only)
        for n, v, _ in stale:
            if n in want:
                todo.append((n, v, "过期"))
        for n, v in missing:
            if n in want:
                todo.append((n, v, "缺失"))
        unknown = want - {n for n, _, _ in todo}
        if unknown:
            print(f"\n  ! 未在差异列表中的 bundle: {sorted(unknown)}")
    elif args.group == "battle":
        for n, v, _ in stale:
            if is_battle(n):
                todo.append((n, v, "过期"))
        for n, v in missing:
            if is_battle(n):
                todo.append((n, v, "缺失"))
    elif args.all:
        for n, v, _ in stale:
            todo.append((n, v, "过期"))
        for n, v in missing:
            todo.append((n, v, "缺失"))

    if not todo:
        print("\n无需同步。")
        return 0

    print(f"\n[3/3] 开始同步 {len(todo)} 个 bundle ...")
    total_ok = total_fail = 0
    done_names: list[str] = []
    for i, (name, ver, state) in enumerate(todo, 1):
        print(f"  [{i}/{len(todo)}] {name} ({state}) -> {ver}")
        ok, fail = download_bundle(name, ver)
        total_ok += ok
        total_fail += fail
        done_names.append(name)
        time.sleep(0.15)

    print(f"\n完成：成功 {total_ok} 个文件，失败 {total_fail} 个。")

    if args.patch_remote_bundles and done_names:
        added = patch_remote_bundles(done_names)
        print(f"version.json remoteBundles 新增 {added} 项。")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
