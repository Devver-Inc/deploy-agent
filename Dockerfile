FROM oven/bun:1-alpine@sha256:5acc90a93e91ff07bf72aa90a7c9f0fa189765aec90b47bdbf2152d2196383c0

# ─── System packages ─────────────────────────────────────────────
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
    su-exec \
    psmisc \
    build-base \
    libffi-dev \
    openssl-dev \
    bzip2-dev \
    zlib-dev \
    readline-dev \
    sqlite-dev \
    yaml-dev \
    gdbm-dev \
    linux-headers \
    xz-dev \
    tar

# ─── asdf (multi-runtime version manager) ────────────────────────
ARG ASDF_VERSION=v0.15.0
ENV ASDF_DIR=/opt/asdf
ENV ASDF_DATA_DIR=/opt/asdf-data
ENV PATH="${ASDF_DIR}/bin:${ASDF_DATA_DIR}/shims:${PATH}"

RUN git clone --depth=1 --branch "${ASDF_VERSION}" \
    https://github.com/asdf-vm/asdf.git "${ASDF_DIR}"

# ─── Runtime plugins + base versions ────────────────────────────
# Node.js uses Alpine's native musl build. asdf manages the other runtimes.
RUN asdf plugin add nodejs && \
    asdf plugin add python && \
    asdf plugin add ruby && \
    asdf plugin add golang

# Pre-install commonly needed runtimes so first deploys don't compile from source.
# These are pinned to keep the image reproducible.
RUN asdf global nodejs system
RUN asdf install python 3.12.7 && asdf global python 3.12.7
RUN asdf install ruby 3.3.5 && asdf global ruby 3.3.5
RUN asdf install golang 1.23.2 && asdf global golang 1.23.2
RUN pip install --no-cache-dir poetry==1.8.5 && \
    gem install bundler -v 2.5.23 --no-document && \
    asdf reshim && \
    chmod -R a+rX "${ASDF_DIR}" "${ASDF_DATA_DIR}"

# Defaults inherited by every worktree under /app; project .tool-versions files override them.
RUN mkdir -p /app && \
    printf 'nodejs system\npython 3.12.7\nruby 3.3.5\ngolang 1.23.2\n' > /etc/asdf-default-tool-versions && \
    cp /etc/asdf-default-tool-versions /app/.tool-versions

# ─── Global JS tooling ───────────────────────────────────────────
RUN npm install -g pm2@7.0.3 vite@8.2.0

RUN node --version && \
    bun --version && \
    python -c "import lzma; print('python', __import__('sys').version.split()[0])" && \
    poetry --version && \
    ruby --version && \
    bundle --version && \
    go version

# ─── Folder structure ───────────────────────────────────────────
RUN mkdir -p /app/repos \
    /app/deployments \
    /app/data \
    /app/nginx/conf.d \
    /app/caches/npm \
    /app/caches/bun \
    /app/caches/pip \
    /app/caches/gem \
    /app/caches/go/build \
    /app/caches/go/pkg/mod

# ─── Build deploy-agent binary ──────────────────────────────────
WORKDIR /app/agent

COPY agent/package.json ./package.json
COPY agent/bun.lock ./bun.lock
COPY agent/tsconfig.json ./tsconfig.json
COPY agent/src ./src

RUN bun install --frozen-lockfile
RUN bun run build && mv ./deploy-agent /usr/local/bin/deploy-agent

# ─── User setup ─────────────────────────────────────────────────
RUN adduser -D -s /bin/sh -h /home/git git \
    && passwd -u git \
    && addgroup -g 10001 deploy \
    && adduser -D -u 10001 -G deploy -s /bin/sh -h /home/deploy deploy

RUN chown -R git:git /app/repos \
    && chown -R deploy:deploy /app/deployments /app/caches \
    && chown -R root:root /app/agent /app/data /app/nginx

# Git safe directories
RUN git config --global --add safe.directory '/app/repos/*' \
    && git config --global --add safe.directory '/app/deployments/*'

COPY nginx.conf /etc/nginx/nginx.conf

WORKDIR /app

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 80 8080

HEALTHCHECK --interval=30s --timeout=3s \
    CMD curl -f http://localhost:8080/health || exit 1

ENTRYPOINT ["/entrypoint.sh"]
