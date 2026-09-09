# This file has been created with the assistance of an AI tool.
#
# agent-name: music-ai-detect
FROM claude-agent

# The wrapper's base image already sets this; state it explicitly so hadolint sees a
# WORKDIR for the relative COPY below (it cannot inherit it across the FROM).
WORKDIR /workspace

# Toolchain for this repo's Makefile: make (both targets), zip (make package),
# rsvg-convert via librsvg2-bin (make generate_icons). Node/npm/git come from the
# base claude-agent image.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        make \
        zip \
        librsvg2-bin \
    && rm -rf /var/lib/apt/lists/*

# Shadow node_modules with an anonymous volume: the container's installed
# dependencies stay in the throwaway volume instead of the host's /workspace (which
# persists), so a session never leaves a root-owned node_modules/ directory in the repo.
# agent-run-args: -v /workspace/node_modules

# Bake the project's locked dependencies into the image so the shadow volume is seeded
# pre-installed on the first run (fast-start, no per-session reinstall), then own them
# as the container user so the agent can write into the seeded volume.
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund \
    && chown -R ubuntu:ubuntu node_modules
