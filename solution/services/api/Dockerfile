FROM node:22-alpine AS build

WORKDIR /app

COPY package.json tsconfig.json ./
COPY package-lock.json ./
RUN npm ci

COPY src ./src
RUN npm run build

FROM node:22-alpine AS runtime

ENV NODE_ENV=production
ENV IMAGE_STORAGE_ROOT=/data/images
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
RUN mkdir -p /data/images && chown node:node /data/images

COPY --from=build /app/dist ./dist

USER node
CMD ["node", "dist/index.js"]
