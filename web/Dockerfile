FROM node:22-alpine AS build

WORKDIR /app

COPY package.json tsconfig.json tsconfig.server.json vite.config.ts index.html ./
COPY package-lock.json ./
RUN npm ci

COPY src ./src
RUN npm run build

FROM node:22-alpine AS runtime

ENV NODE_ENV=production
ENV IMAGE_STORAGE_ROOT=/data/images
ENV WEB_HOST=0.0.0.0
ENV WEB_PORT=1969
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist

USER node
CMD ["node", "dist/server/index.js"]
