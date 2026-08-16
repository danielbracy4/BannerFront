# Railway can build this from source without Docker installed locally.
# 22.5+ for the built-in node:sqlite the ledger runs on.
FROM node:24-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev || npm install --omit=dev
COPY . .
ENV NODE_ENV=production
EXPOSE 8080
CMD ["node", "server/src/index.js"]
