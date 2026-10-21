FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production

# Dependency layer first for better caching
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY src ./src

# Uploads live in a volume and the process runs as a non-root user
RUN mkdir -p /data/uploads && chown -R node:node /data /app
ENV UPLOAD_DIR=/data/uploads
VOLUME ["/data/uploads"]
USER node

EXPOSE 7000
HEALTHCHECK --interval=30s --timeout=3s --start-period=15s CMD wget -qO- http://127.0.0.1:7000/health >/dev/null || exit 1
CMD ["node", "src/index.js"]
