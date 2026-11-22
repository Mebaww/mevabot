FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine
RUN addgroup -S mevabot && adduser -S mevabot -G mevabot
WORKDIR /app
RUN mkdir -p /app/data && chown -R mevabot:mevabot /app/data
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/src ./src
USER mevabot
ENV NODE_ENV=production
VOLUME ["/app/data"]
CMD ["node", "dist/index.js"]
