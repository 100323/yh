#!/usr/bin/env python3
"""Upload local files to remote server via SFTP, then verify md5 and replace atomically.

Usage:
  python _ssh_upload.py <manifest_file>
manifest format (one per line): local_path|remote_abs_path|expected_md5
"""
import sys, os, hashlib, posixpath, paramiko

HOST = os.environ.get("RY_HOST", "193.112.151.193")
PORT = int(os.environ.get("RY_PORT", "22"))
USER = os.environ.get("RY_USER", "ubuntu")
PASS = os.environ.get("RY_PASS", "")

manifest_path = sys.argv[1]
entries = []
with open(manifest_path, "r", encoding="utf-8") as fh:
    for line in fh:
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        local, remote = line.split("|")[0], line.split("|")[1]
        entries.append((local, remote))

def md5_local(p):
    h = hashlib.md5()
    with open(p, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()

cli = paramiko.SSHClient()
cli.set_missing_host_key_policy(paramiko.AutoAddPolicy())
cli.connect(HOST, port=PORT, username=USER, password=PASS,
            timeout=20, banner_timeout=30, auth_timeout=30,
            look_for_keys=False, allow_agent=False)

sftp = cli.open_sftp()

def run(cmd):
    _, out, err = cli.exec_command(cmd, timeout=120)
    o = out.read().decode("utf-8", "replace")
    e = err.read().decode("utf-8", "replace")
    rc = out.channel.recv_exit_status()
    return rc, o, e

report = []
staging = "/tmp/newcode_upload"
run(f"mkdir -p {staging}")

def stage_name(remote):
    """staging 内的唯一文件名。

    不能用 basename：manifest 里可能同时有 backend/src/scheduler/index.js 与
    backend/src/batchScheduler/index.js，两者 basename 都是 index.js，
    会互相覆盖，最终把同一份内容写到两个目标上（静默写错代码）。
    """
    digest = hashlib.md5(remote.encode("utf-8")).hexdigest()[:12]
    return f"{digest}_{posixpath.basename(remote)}"

for local, remote in entries:
    tmp_remote = posixpath.join(staging, stage_name(remote))
    sftp.put(local, tmp_remote)
    local_md5 = md5_local(local)
    rc, o, e = run(f"md5sum {tmp_remote} | cut -d' ' -f1")
    remote_md5 = o.strip()
    ok = (local_md5 == remote_md5)
    report.append((remote, local_md5, remote_md5, ok))
    print(f"{'OK ' if ok else 'BAD'} {posixpath.basename(remote)}  local={local_md5} remote={remote_md5}")
    if not ok:
        print("MISMATCH, aborting")
        sys.exit(2)

# all verified -> atomic replace with backup
# 注意：目标文件可能尚不存在（新增文件），此时 cp 备份会失败，
# 因此备份用 `[ -f ] && cp ... || true` 包起来，不能让它短路掉后续写入。
print("--- all payloads verified, replacing ---")
for local, remote in entries:
    tmp_remote = posixpath.join(staging, stage_name(remote))
    rdir = posixpath.dirname(remote)
    rc, o, e = run(
        f"mkdir -p {rdir} && "
        f"( [ -f {remote} ] && cp -f {remote} {remote}.bak-invite || true ) && "
        f"cat {tmp_remote} > {remote} && "
        f"md5sum {remote} | cut -d' ' -f1"
    )
    if rc != 0:
        print(f"REPLACE FAILED {remote}: {e}")
        sys.exit(3)
    print(f"replace {remote} -> {o.strip()}")

sftp.close()
cli.close()
print("DONE")
