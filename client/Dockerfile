# Stage 1: build the static app
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Stage 2: serve with nginx (also reverse-proxies /api and /socket.io to the "server" container)
FROM nginx:1.27-alpine
# nginx:alpine renders /etc/nginx/templates/*.template with envsubst on start (only API_* vars)
COPY nginx.conf.template /etc/nginx/templates/default.conf.template
ENV API_UPSTREAM=server:7000 API_RESOLVER=127.0.0.11 NGINX_ENVSUBST_FILTER=API_
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1/ >/dev/null || exit 1
CMD ["nginx", "-g", "daemon off;"]
