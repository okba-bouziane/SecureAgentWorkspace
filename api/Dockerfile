# ---- build ----
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

# ---- runtime ----
FROM node:22-slim
ENV NODE_ENV=production \
    HF_CACHE_DIR=/models
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
# Bake the embedding model into the image so containers start offline-ready.
RUN mkdir -p /models && node -e "import('@huggingface/transformers').then(async (m) => { m.env.cacheDir = '/models'; await m.pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', { dtype: 'fp32' }); })" \
    && chown -R node:node /models
COPY --from=build /app/dist ./dist
COPY seed /app/seed
USER node
EXPOSE 3001
CMD ["node", "dist/main.js"]
