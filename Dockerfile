# ── Stage 1: build the React client ──
FROM node:20-slim AS client-build
WORKDIR /app/client
COPY client/package*.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

# ── Stage 2: production runtime ──
FROM node:20-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

# Install backend production dependencies only.
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Application source + built client.
COPY src ./src
COPY server.js ./
COPY --from=client-build /app/client/dist ./client/dist

# Writable data dir (learning store + generated job files) owned by the node user.
RUN mkdir -p /app/data/jobs && chown -R node:node /app/data

USER node
EXPOSE 3000

# Container-level health check hits the readiness endpoint.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "--max-old-space-size=4096", "server.js"]
