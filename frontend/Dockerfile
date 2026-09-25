# syntax=docker/dockerfile:1

# ---- Build stage -------------------------------------------------------------
# glibc (Debian) base: Tailwind v4 (oxide), lightningcss and rolldown ship native
# binaries as optional deps; the -gnu variants are the well-trodden path.
FROM node:22-bookworm-slim AS build
WORKDIR /app

# Install deps first so this layer is cached until the lockfile changes.
COPY package.json package-lock.json ./
RUN npm ci

# Vite inlines VITE_* vars at build time (see src/lib/api/client.ts), so the API
# base URL the browser will call is baked into the bundle here.
ARG VITE_API_URL=http://localhost:3000
ENV VITE_API_URL=${VITE_API_URL}

COPY . .
RUN npm run build

# ---- Runtime stage -----------------------------------------------------------
FROM nginx:1.30-alpine AS runtime

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
