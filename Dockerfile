FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine
RUN addgroup -S mevaplus && adduser -S mevaplus -G mevaplus
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist
USER mevaplus
ENV NODE_ENV=production
CMD ["node", "dist/index.js"]
