FROM node:22-slim

WORKDIR /app

# Install dependencies first so this layer is cached unless package*.json changes.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

COPY src ./src
COPY public ./public

ENV NODE_ENV=production
EXPOSE 3000

# better-sqlite3 and the session key both write under /app/data — this is
# bind-mounted by docker-compose, but create it here too so a bare
# `docker run` without the mount still works.
RUN mkdir -p /app/data && chown -R node:node /app/data
USER node

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/server.js"]
