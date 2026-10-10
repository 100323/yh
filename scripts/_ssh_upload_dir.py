#!/usr/bin/env python3
"""Recursively upload a local directory to a remote directory via SFTP.

Usage: python _ssh_upload_dir.py <local_dir> <remote_dir>
Uploads every file, preserving relative structure. Verifies size per file.
"""
import sys, os, posixpath, paramiko

HOST = os.environ.get("RY_HOST", "193.112.151.193")
PORT = int(os.environ.get("RY_PORT", "22"))
USER = os.environ.get("RY_USER", "ubuntu")
PASS = os.environ.get("RY_PASS", "")

local_dir, remote_dir = sys.argv[1], sys.argv[2]

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

def mkdirs(path):
    rc, o, e = run(f"mkdir -p {path!r}")
    if rc != 0:
        raise IOError(f"mkdir -p failed for {path}: {e}")

count, total = 0, 0
for root, _dirs, files in os.walk(local_dir):
    rel = os.path.relpath(root, local_dir)
    rdir = remote_dir if rel == "." else posixpath.join(remote_dir, rel.replace(os.sep, "/"))
    mkdirs(rdir)
    for fn in files:
        lp = os.path.join(root, fn)
        rp = posixpath.join(rdir, fn)
        sftp.put(lp, rp)
        ls, rs = os.path.getsize(lp), sftp.stat(rp).st_size
        if ls != rs:
            print(f"SIZE MISMATCH {rp}: {ls} != {rs}")
            sys.exit(2)
        count += 1
        total += ls

print(f"uploaded {count} files, {total} bytes -> {remote_dir}")
sftp.close()
cli.close()
