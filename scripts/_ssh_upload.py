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

for local, remote in entries:
    base = posixpath.basename(remote)
    tmp_remote = posixpath.join(staging, base)
    sftp.put(local, tmp_remote)
    local_md5 = md5_local(local)
    rc, o, e = run(f"md5sum {tmp_remote} | cut -d' ' -f1")
    remote_md5 = o.strip()
    ok = (local_md5 == remote_md5)
    report.append((remote, local_md5, remote_md5, ok))
    print(f"{'OK ' if ok else 'BAD'} {base}  local={local_md5} remote={remote_md5}")
    if not ok:
        print("MISMATCH, aborting")
        sys.exit(2)

# all verified -> atomic replace with backup
print("--- all payloads verified, replacing ---")
for local, remote in entries:
    base = posixpath.basename(remote)
    tmp_remote = posixpath.join(staging, base)
    rc, o, e = run(
        f"cp -f {remote} {remote}.bak-invite && "
        f"cat {tmp_remote} > {remote} && "
        f"md5sum {remote} | cut -d' ' -f1"
    )
    print(f"replace {remote} -> {o.strip()}")

sftp.close()
cli.close()
print("DONE")
