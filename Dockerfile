# STAGE 1: Build the app
FROM node:20-alpine AS builder
WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install

# Copy all source code and build the application
COPY . .
RUN npm run build

# STAGE 2: Run the app in production
FROM node:20-alpine
WORKDIR /app

# Copy the compiled build and package config from the builder stage
COPY --from=builder /app/dist /app/dist
COPY --from=builder /app/package.json ./

# Install only the dependencies needed to run the app
RUN npm install --production

# Strictly enforce Cloud Run's environment variables
ENV PORT=8080
ENV HOST=0.0.0.0
EXPOSE 8080

# Launch the TanStack server using the exact file Vite generated
CMD ["node", "dist/server/server.js"]