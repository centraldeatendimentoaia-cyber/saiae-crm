FROM node:24-alpine AS builder
RUN apk add --no-cache openssl ca-certificates
WORKDIR /app

# Dependency layer — cache-friendly: only rerun when package*.json changes
COPY package*.json ./
COPY patches ./patches/
COPY prisma ./prisma/
RUN npm ci --legacy-peer-deps && npm cache clean --force

# Source & build
COPY . .
# Variaveis NEXT_PUBLIC_* sao gravadas no build: declare-as no Railway antes do deploy
ARG NEXT_PUBLIC_APP_URL
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
RUN npx prisma generate && npm run build

# Strip devDeps from node_modules after build
# tsx needed at runtime, kept explicitly
RUN npm prune --omit=dev --ignore-scripts && npm install --no-save --ignore-scripts tsx typescript prisma@5.22.0

# Production image
FROM node:24-alpine AS runner
# mysql-client: usado pelo script de backup (scripts/backup-db.js)
RUN apk add --no-cache openssl ca-certificates mysql-client
WORKDIR /app

COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/src ./src
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/public ./public
COPY --from=builder /app/tsconfig.json ./
COPY --from=builder /app/scripts ./scripts

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
EXPOSE 3000

CMD ["sh", "-c", "(if [ \"${PRISMA_DB_PUSH:-on}\" != \"off\" ]; then npx prisma db push; else echo 'PRISMA_DB_PUSH=off: schema NAO aplicado neste start'; fi) && (if [ -n \"$ADMIN_EMAIL\" ] && [ -n \"$ADMIN_PASSWORD\" ]; then node scripts/setup-admin.js \"$ADMIN_EMAIL\" \"$ADMIN_PASSWORD\"; fi) && NODE_OPTIONS=\"--max-old-space-size=${NODE_MAX_MB:-512}\" node node_modules/tsx/dist/cli.mjs src/server/index.ts"]
