# Windows x64 cross-build image for Unsold PDF (NSIS installer).
# Used by scripts/package-windows.mjs. Runs natively on the host architecture:
# cargo-xwin cross-compiles to x86_64-pc-windows-msvc with clang/lld and the
# MSVC CRT + Windows SDK it downloads (cached on a volume). MSI needs WiX,
# which only runs on Windows, so only the NSIS setup.exe is built here.
FROM ubuntu:24.04

ARG TAURI_CLI_VERSION=2.11.5
ARG NODE_VERSION=20.20.2
ARG CARGO_XWIN_VERSION=0.23.1
ENV DEBIAN_FRONTEND=noninteractive \
    RUSTUP_HOME=/opt/rustup \
    PATH=/opt/cargo/bin:/opt/node/bin:$PATH

RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential curl file ca-certificates rsync xz-utils pkg-config \
      clang lld llvm nsis \
    && rm -rf /var/lib/apt/lists/*

RUN ARCH=$(dpkg --print-architecture | sed 's/amd64/x64/') \
    && curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-${ARCH}.tar.xz" \
      | tar -xJ -C /opt && mv /opt/node-v${NODE_VERSION}-linux-${ARCH} /opt/node \
    && npm install -g "@tauri-apps/cli@${TAURI_CLI_VERSION}" && npm cache clean --force

RUN curl -fsSL https://sh.rustup.rs | CARGO_HOME=/opt/cargo sh -s -- -y --profile minimal --default-toolchain stable \
      --target x86_64-pc-windows-msvc \
    && CARGO_HOME=/opt/cargo cargo install --locked cargo-xwin --version ${CARGO_XWIN_VERSION} \
    && rm -rf /opt/cargo/registry /opt/cargo/git

ENV CARGO_HOME=/cache/cargo \
    CARGO_TARGET_DIR=/cache/target \
    XDG_CACHE_HOME=/cache/xdg \
    XWIN_CACHE_DIR=/cache/xwin \
    PATH=/opt/cargo/bin:/cache/cargo/bin:/opt/node/bin:$PATH
WORKDIR /work
