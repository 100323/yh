#!/usr/bin/env python3
"""Run a remote command over SSH with password auth.

Usage: python _ssh_run.py <<'EOF'
  echo hello
  mysql ...
EOF
The script body (stdin) is executed remotely as a shell script.
"""
import sys, os, paramiko

HOST = os.environ.get("RY_HOST", "193.112.151.193")
PORT = int(os.environ.get("RY_PORT", "22"))
USER = os.environ.get("RY_USER", "ubuntu")
PASS = os.environ.get("RY_PASS", "")
TIMEOUT = int(os.environ.get("RY_TIMEOUT", "120"))

script = sys.stdin.read()

cli = paramiko.SSHClient()
cli.set_missing_host_key_policy(paramiko.AutoAddPolicy())
cli.connect(HOST, port=PORT, username=USER, password=PASS,
            timeout=20, banner_timeout=30, auth_timeout=30,
            look_for_keys=False, allow_agent=False)

stdin, stdout, stderr = cli.exec_command(script, timeout=TIMEOUT, get_pty=False)
out = stdout.read().decode("utf-8", "replace")
err = stderr.read().decode("utf-8", "replace")
rc = stdout.channel.recv_exit_status()
sys.stdout.write(out)
if err.strip():
    sys.stderr.write("\n[STDERR]\n" + err)
print(f"\n[EXIT] {rc}")
cli.close()
