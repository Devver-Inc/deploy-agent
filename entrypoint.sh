#!/bin/bash
set -e

echo "Starting Devver Container..."

mkdir -p /app/data /app/repos /app/deployments /app/nginx/conf.d

# Initialize persistent state files on first run
[ -f /app/data/repos.json ] || echo '{}' > /app/data/repos.json
[ -f /app/data/ports.json ] || echo '{}' > /app/data/ports.json

echo "Starting fcgiwrap (git HTTP backend)..."
spawn-fcgi -s /var/run/fcgiwrap.sock -U nginx -G nginx -- /usr/bin/fcgiwrap
chmod 660 /var/run/fcgiwrap.sock

echo "Starting Nginx..."
nginx

echo "Starting PM2 daemon..."
pm2 ping > /dev/null 2>&1 || true
pm2 resurrect 2>/dev/null || true

if [ -f "/usr/local/bin/deploy-agent" ]; then
    echo "Starting Deploy Agent (binary)..."
    chmod +x /usr/local/bin/deploy-agent
    while true; do
        /usr/local/bin/deploy-agent
        echo "Deploy Agent exited (code $?), restarting in 2s..."
        sleep 2
    done &
elif [ -f "/app/agent/src/index.ts" ]; then
    echo "Starting Deploy Agent (dev mode)..."
    while true; do
        cd /app/agent && bun run src/index.ts
        echo "Deploy Agent exited (code $?), restarting in 2s..."
        sleep 2
    done &
else
    echo "Deploy Agent not found. Mount it to /app/agent"
    echo "   Container will run without Deploy Agent for testing."
fi

echo ""
echo "Devver Container Ready!"
echo "   - Nginx (+ git HTTP): port 80"
echo "   - Deploy Agent:       port 8080"
echo ""

# Keep the container running and show logs
tail -f /var/log/nginx/access.log /var/log/nginx/error.log
