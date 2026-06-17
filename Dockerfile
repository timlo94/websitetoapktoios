# STAGE 1: Build the full-stack application
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy all files
COPY . .

# Build both the client (frontend) and server (backend)
RUN npm run build

# Tell Cloud Run which port to use
EXPOSE 8080
ENV PORT=8080
ENV HOST=0.0.0.0

# Start the actual TanStack server
CMD ["npm", "start"]