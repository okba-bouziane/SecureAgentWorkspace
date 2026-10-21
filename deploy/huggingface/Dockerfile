# syntax=docker/dockerfile:1
# All-in-one image for a Hugging Face Docker Space: Postgres + pgvector, Redis, Keycloak, SecureMCP,
# the API, the ingestion worker and the web app, all behind nginx on port 7860 (one public origin).
# The Space repository only needs the files in this folder: the application sources are cloned from GitHub at build time.
ARG PUBLIC_URL=https://okba-bouziane-secureagentworkspace.hf.space

# ---- sources (re-cloned whenever the upstream branches move) ----
FROM node:22-slim AS src
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates python3 make g++ && rm -rf /var/lib/apt/lists/*
ADD https://api.github.com/repos/okba-bouziane/SecureAgentWorkspace/commits/main /tmp/saw-ref.json
ADD https://api.github.com/repos/okba-bouziane/SecureMCP/commits/main /tmp/mcp-ref.json
WORKDIR /src
RUN git clone --depth 1 https://github.com/okba-bouziane/SecureAgentWorkspace.git saw \
 && git clone --depth 1 https://github.com/okba-bouziane/SecureMCP.git mcp

FROM src AS web
ARG PUBLIC_URL
WORKDIR /src/saw/web
RUN npm ci
ENV VITE_API_URL=/api \
    VITE_OIDC_AUTHORITY=${PUBLIC_URL}/auth/realms/securemcp \
    VITE_OIDC_CLIENT_ID=saw-web
RUN npm run build

FROM src AS api
WORKDIR /src/saw/api
RUN npm ci && npm run build && rm -rf node_modules && npm ci --omit=dev
# Bake the embedding model into the image.
RUN mkdir -p /models && node -e "import('@huggingface/transformers').then(async (m) => { m.env.cacheDir = '/models'; await m.pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', { dtype: 'fp32' }); })"

FROM src AS mcp
WORKDIR /src/mcp
RUN npm ci && npm run build && npm prune --omit=dev

# ---- runtime ----
FROM pgvector/pgvector:pg17
RUN apt-get update \
 && apt-get install -y --no-install-recommends nginx redis-server supervisor curl ca-certificates procps \
 && rm -rf /var/lib/apt/lists/* \
 && useradd -m -u 1000 user \
 && mkdir -p /data /app /tmp/nginx && chown -R user:user /data /app

COPY --from=node:22-slim /usr/local/bin/node /usr/local/bin/node
COPY --from=eclipse-temurin:21-jre-jammy /opt/java/openjdk /opt/java
COPY --from=quay.io/keycloak/keycloak:26.4 --chown=1000:1000 /opt/keycloak /opt/keycloak

COPY --from=api --chown=1000:1000 /src/saw/api/dist /app/api/dist
COPY --from=api --chown=1000:1000 /src/saw/api/node_modules /app/api/node_modules
COPY --from=api --chown=1000:1000 /src/saw/api/package.json /app/api/package.json
COPY --from=api --chown=1000:1000 /src/saw/api/seed /app/api/seed
COPY --from=api --chown=1000:1000 /models /models
COPY --from=mcp --chown=1000:1000 /src/mcp/dist /app/mcp/dist
COPY --from=mcp --chown=1000:1000 /src/mcp/node_modules /app/mcp/node_modules
COPY --from=mcp --chown=1000:1000 /src/mcp/package.json /app/mcp/package.json
COPY --from=web /src/saw/web/dist /app/web

COPY nginx.conf /app/nginx.conf
COPY supervisord.conf /app/supervisord.conf
COPY realm.template.json /app/realm.template.json
COPY --chmod=755 entrypoint.sh /app/entrypoint.sh
COPY --chmod=755 wait-run.sh /app/wait-run.sh

ENV JAVA_HOME=/opt/java \
    PATH=/opt/java/bin:/usr/lib/postgresql/17/bin:$PATH \
    HF_CACHE_DIR=/models \
    NODE_ENV=production
USER user
WORKDIR /app
EXPOSE 7860
ENTRYPOINT ["/app/entrypoint.sh"]
