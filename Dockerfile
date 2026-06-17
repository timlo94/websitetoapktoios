# STAGE 1: Build the app
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

# STAGE 2: Serve the app
FROM nginx:alpine

# 1. DELETE the default "Welcome to nginx" page so it doesn't block your app
RUN rm -rf /usr/share/nginx/html/*

# 2. Copy the app files into the empty folder
COPY --from=builder /app/dist /usr/share/nginx/html

# 3. Copy the Nginx configuration
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 8080
CMD ["nginx", "-g", "daemon off;"]