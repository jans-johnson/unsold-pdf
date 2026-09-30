# Linux x86_64 build image for Unsold PDF (deb, rpm, AppImage).
# Used by scripts/package-linux.mjs; runs as linux/amd64 (emulated on Apple silicon).
# Ubuntu 22.04 keeps the glibc floor low (2.35) so the AppImage runs on older distros.
FROM ubuntu:22.04

ARG TAURI_CLI_VERSION=2.11.5
ARG NODE_VERSION=20.20.2
ENV DEBIAN_FRONTEND=noninteractive \
    RUSTUP_HOME=/opt/rustup \
    PATH=/opt/cargo/bin:/opt/node/bin:$PATH

RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential curl wget file ca-certificates rsync xz-utils pkg-config \
      libwebkit2gtk-4.1-dev libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev \
      patchelf xdg-utils desktop-file-utils squashfs-tools \
      xvfb xauth dbus-x11 \
    && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.xz" \
      | tar -xJ -C /opt && mv /opt/node-v${NODE_VERSION}-linux-x64 /opt/node \
    && npm install -g "@tauri-apps/cli@${TAURI_CLI_VERSION}" && npm cache clean --force

RUN curl -fsSL https://sh.rustup.rs | CARGO_HOME=/opt/cargo sh -s -- -y --profile minimal --default-toolchain stable

# Cargo registry and target dir live on named volumes (see package-linux.mjs).
ENV CARGO_HOME=/cache/cargo \
    CARGO_TARGET_DIR=/cache/target \
    XDG_CACHE_HOME=/cache/xdg \
    APPIMAGE_EXTRACT_AND_RUN=1 \
    NO_STRIP=1
WORKDIR /work
