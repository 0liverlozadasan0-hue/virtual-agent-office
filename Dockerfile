# ─────────────────────────────────────────────────────────────
# Virtual Agent Office — imagen de producción
#
# Dos etapas:
#   1. build    → compila el frontend (React + Vite) y lasTSC
#   2. runtime  → solo lo que el servidor necesita en marcha
#
# La imagen final ronda los 145 MB: fuera devDeps, public/ (45 MB de
# sprites, que ya van copiados en dist/) y docs/ del upstream.
# ─────────────────────────────────────────────────────────────

# ═════════════════════════════════════════════════════════════
# Etapa 1 — build
# ═════════════════════════════════════════════════════════════
FROM node:24-alpine AS build

WORKDIR /app

# Solo los manifiestos primero: la capa de dependencias se cachea
# y no se rehace en cada cambio de código.
COPY package.json package-lock.json ./

# El binario de Electron no hace falta para compilar y son ~100 MB:
# sin esto la descarga se cuela en la imagen de build.
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1
RUN npm ci --no-audit --no-fund

# El código y los assets que el build necesita
COPY index.html tsconfig.json vite.config.ts .env ./
COPY src ./src
COPY public ./public
COPY server ./server
COPY office.config.json ./

# tsc + vite build → dist/
RUN npm run build


# ═════════════════════════════════════════════════════════════
# Etapa 2 — runtime
# ═════════════════════════════════════════════════════════════
FROM node:24-alpine AS runtime

WORKDIR /app

ENV NODE_ENV=production

# Solo las dependencias de marcha (express, ws). Sin devDeps, sin
# Electron, sin los ~50 MB que arrastra el toolchain de build.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

# El frontend compilado y el servidor
COPY --from=build /app/dist ./dist
COPY --from=build /app/server ./server
COPY --from=build /app/office.config.json ./

# El estado de la oficina (agents.json, chat.db) vive en un volumen:
#   -v office-data:/data
# AGENT_OFFICE_HOME lo apunta allí.
RUN mkdir -p /data && chown -R node:node /data /app
VOLUME ["/data"]

# 0.0.0.0 es OBLIGATORIO: el proxy de Easypanel (Traefik) entra por
# la red de Docker y no alcanza un bind en 127.0.0.1.
ENV AGENT_OFFICE_HOST=0.0.0.0
ENV AGENT_OFFICE_PORT=3334
ENV AGENT_OFFICE_HOME=/data

EXPOSE 3334

# El endpoint de salud del upstream es /health (no /api/health, que da 404).
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.AGENT_OFFICE_PORT||3334)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

USER node

CMD ["node", "server/index.js"]
