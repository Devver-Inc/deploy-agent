FROM oven/bun:1-alpine

RUN apk add --no-cache \
    git \
    git-daemon \
    fcgiwrap \
    spawn-fcgi \
    nginx \
    nodejs \
    npm \
    curl \
    bash \
    psmisc

RUN npm install -g pm2 @endevco/aube --ignore-scripts=false

# Folder structure
RUN mkdir -p /app/repos \
    /app/deployments \
    /app/data \
    /app/nginx/conf.d

WORKDIR /app/agent

COPY agent/package.json ./package.json
COPY agent/bun.lock ./bun.lock
COPY agent/tsconfig.json ./tsconfig.json
COPY agent/src ./src

RUN bun install
RUN bun run build && mv ./deploy-agent /usr/local/bin/deploy-agent

# User setup
RUN adduser -D -s /bin/sh -h /home/git git \
    && passwd -u git

RUN chown -R git:git /app

# Git safe directories
RUN git config --global --add safe.directory '/app/repos/*' \
    && git config --global --add safe.directory '/app/deployments/*'

COPY nginx.conf /etc/nginx/nginx.conf

RUN chown -R git:git /app

WORKDIR /app

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 80 8080

HEALTHCHECK --interval=30s --timeout=3s \
    CMD curl -f http://localhost:8080/health || exit 1

ENTRYPOINT ["/entrypoint.sh"]
