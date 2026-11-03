#!/usr/bin/env bash
# Prepares a GitHub-hosted runner for the bench: bubblewrap and FUSE (the
# observed run), /work (a runner's home is 0750, which the sandbox cannot
# reach), and Node.js $NODE_VERSION at /usr/local/node (the sandbox sees
# /usr only). CI only: it changes the host.
set -euo pipefail
[ "${CI:-}" = true ] || { echo "host-setup.sh changes the host; it runs in CI" >&2; exit 2; }
sudo apt-get update -qq
sudo apt-get install -y -qq --no-install-recommends bubblewrap fuse3 >/dev/null
sudo mkdir -p /work/state /work/tmp
sudo chown "$(id -u):$(id -g)" /work /work/state /work/tmp
sudo git config --system --add safe.directory '*'
grep -qs '^user_allow_other' /etc/fuse.conf || echo user_allow_other | sudo tee -a /etc/fuse.conf >/dev/null
# Ubuntu restricts unprivileged user namespaces through AppArmor.
sudo sysctl -q -w kernel.apparmor_restrict_unprivileged_userns=0 2>/dev/null || true
ring=/sys/module/fuse/parameters/enable_uring
[ -e "$ring" ] && { echo Y | sudo tee "$ring" >/dev/null 2>&1 || true; }
case "$(uname -m)" in x86_64) a=x64;; aarch64) a=arm64;; *) echo "unsupported arch" >&2; exit 2;; esac
v=${NODE_VERSION:?NODE_VERSION}
sudo rm -rf /usr/local/node
curl -fsSL "https://nodejs.org/dist/v$v/node-v$v-linux-$a.tar.gz" | sudo tar -C /usr/local -xz
sudo mv "/usr/local/node-v$v-linux-$a" /usr/local/node
echo "host: kernel $(uname -r), $(nproc) CPUs, fuse.enable_uring=$(cat "$ring" 2>/dev/null || echo absent), node $(/usr/local/node/bin/node --version)"
