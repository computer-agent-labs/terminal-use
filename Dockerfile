# terminal-use as a container: an MCP server on stdio.
#
#   docker build -t terminal-use .
#   docker run -i --rm terminal-use
#
# The terminals it opens are shells inside this container, not on the host.
# Mount what the agent should work on:  -v "$PWD":/workspace

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN yarn build \
 && yarn install --frozen-lockfile --production --ignore-scripts --prefer-offline

FROM node:22-bookworm-slim
# procps: `ps`, which terminal_wait uses to tell when a command has finished.
# The emoji font lets screenshots show emoji (add fonts-noto-cjk for CJK text).
RUN apt-get update \
 && apt-get install -y --no-install-recommends procps fonts-noto-color-emoji \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json LICENSE README.md ./
COPY bin ./bin
COPY fonts ./fonts
COPY skills ./skills

ENV SHELL=/bin/bash \
    LANG=C.UTF-8
USER node
WORKDIR /workspace
ENTRYPOINT ["node", "/app/bin/terminal-use.js"]
