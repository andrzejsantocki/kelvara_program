FROM node:22-alpine
WORKDIR /app
COPY --chown=node:node package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY --chown=node:node subapps/kamino-monitor ./subapps/kamino-monitor
COPY --chown=node:node src/domains/discovery/wallet.js ./src/domains/discovery/wallet.js
COPY --chown=node:node src/platform/solana/base58.js ./src/platform/solana/base58.js
ENV NODE_ENV=production PORT=8080
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD node -e "fetch('http://127.0.0.1:8080/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node","subapps/kamino-monitor/server.js"]
