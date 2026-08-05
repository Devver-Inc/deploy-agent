# ─── Prebuilt runtime stages ─────────────────────────────────────
# Pinned to the same versions previously compiled by asdf. Copying the
# already-built runtime from each official Alpine (musl) image avoids
# compiling Python/Ruby/Go from source, which is what made the build slow.
FROM python:3.12.7-alpine AS python-build
FROM ruby:3.3.5-alpine AS ruby-build
FROM golang:1.23.2-alpine AS golang-build

FROM oven/bun:1-alpine@sha256:5acc90a93e91ff07bf72aa90a7c9f0fa189765aec90b47bdbf2152d2196383c0

# ─── System packages ─────────────────────────────────────────────
# build-base/-dev headers are kept: user projects (pip/gem/npm) may still
# need to compile native extensions during install, even though we no
# longer compile the runtimes themselves.
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

# ─── Python (copied from official image, no source compile) ─────
COPY --from=python-build /usr/local/bin/python3.12 /usr/local/bin/python3.12
COPY --from=python-build /usr/local/lib/python3.12 /usr/local/lib/python3.12
COPY --from=python-build /usr/local/lib/libpython3.12* /usr/local/lib/
COPY --from=python-build /usr/local/include/python3.12 /usr/local/include/python3.12
RUN ln -sf /usr/local/bin/python3.12 /usr/local/bin/python3 && \
    ln -sf /usr/local/bin/python3.12 /usr/local/bin/python && \
    /usr/local/bin/python3 -m ensurepip --upgrade && \
    /usr/local/bin/python3 -m pip install --no-cache-dir --upgrade pip poetry==1.8.5

# ─── Ruby (copied from official image, no source compile) ───────
COPY --from=ruby-build /usr/local/bin/ruby /usr/local/bin/ruby
COPY --from=ruby-build /usr/local/bin/gem /usr/local/bin/gem
COPY --from=ruby-build /usr/local/bin/erb /usr/local/bin/erb
COPY --from=ruby-build /usr/local/bin/irb /usr/local/bin/irb
COPY --from=ruby-build /usr/local/bin/rdoc /usr/local/bin/rdoc
COPY --from=ruby-build /usr/local/bin/ri /usr/local/bin/ri
COPY --from=ruby-build /usr/local/lib/ruby /usr/local/lib/ruby
COPY --from=ruby-build /usr/local/lib/libruby* /usr/local/lib/
COPY --from=ruby-build /usr/local/include/ruby-3.3.0 /usr/local/include/ruby-3.3.0
RUN gem install bundler -v 2.5.23 --no-document

# ─── Go (copied from official image, no source compile) ─────────
COPY --from=golang-build /usr/local/go /usr/local/go
ENV PATH="/usr/local/go/bin:${PATH}"

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
