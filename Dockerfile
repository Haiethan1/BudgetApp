FROM node:24-bookworm-slim AS dependencies
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/* \
    && npm install --global pnpm@11.19.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

FROM dependencies AS builder
ENV NEXT_TELEMETRY_DISABLED=1
COPY . .
RUN pnpm build

# Keep the operations runtime explicit. Next does not trace the entrypoint's imports.
FROM dependencies AS operations
RUN pnpm prune --prod

FROM node:24-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    DATABASE_URL=/data/homebooks.sqlite \
    BACKUP_DIR=/backups \
    PORT=3000 \
    HOSTNAME=0.0.0.0
RUN groupadd --system --gid 1001 nodejs && useradd --system --uid 1001 --gid nodejs homebooks \
    && mkdir -p /data /backups && chown homebooks:nodejs /data /backups
COPY --from=builder --chown=homebooks:nodejs /app/.next/standalone ./
COPY --from=operations --chown=homebooks:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=homebooks:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=homebooks:nodejs /app/public ./public
COPY --from=builder --chown=homebooks:nodejs /app/drizzle ./drizzle
COPY --from=builder --chown=homebooks:nodejs /app/docker ./docker
COPY --from=builder --chown=homebooks:nodejs /app/operations ./operations
USER homebooks
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=5s --start-period=10s --retries=6 CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
ENTRYPOINT ["node", "docker/entrypoint.mjs"]
