#!/bin/sh
set -e

mkdir -p /app/data /app/repos /app/deployments /app/nginx \
         /app/caches/npm /app/caches/bun /app/caches/pip \
         /app/caches/gem /app/caches/go/build /app/caches/go/pkg/mod
touch /app/nginx/routes.map /app/nginx/widget.conf

# Within /app, workloads can write only deployments and package caches.
chown -R deploy:deploy /app/deployments /app/caches
chown -R git:git /app/repos
chown -R root:root /app/data /app/nginx
chmod 700 /app/data /app/nginx

# Only the git-gateway may connect over SSH; it authorizes developers' keys upstream.
mkdir -p /app/data/ssh /etc/ssh/authorized_keys
chmod 700 /app/data/ssh
[ -f /app/data/ssh/ssh_host_ed25519_key ] || \
    ssh-keygen -q -t ed25519 -N "" -f /app/data/ssh/ssh_host_ed25519_key
case "${DEVVER_GIT_GATEWAY_PUBLIC_KEY:-}" in
    ssh-*|ecdsa-*) printf 'restrict %s\n' "$(printf '%s' "$DEVVER_GIT_GATEWAY_PUBLIC_KEY" | head -n1)" ;;
esac > /etc/ssh/authorized_keys/git
chmod 644 /etc/ssh/authorized_keys/git

exec pm2-runtime /etc/devver/ecosystem.config.cjs
