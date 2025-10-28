FROM node:20-alpine as build
WORKDIR /app

# Copy manifests first to leverage Docker layer cache
COPY frontend/package*.json /app/

# Faster installs; will cache unless package*.json changes
RUN npm install --no-audit --no-fund

# Now copy the rest of the sources
COPY frontend/tsconfig.json /app/tsconfig.json
COPY frontend/vite.config.ts /app/vite.config.ts
COPY frontend/index.html /app/index.html
COPY frontend/src /app/src

RUN npm run build

FROM nginx:stable-alpine
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]


