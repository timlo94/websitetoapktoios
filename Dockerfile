# Single Stage Build for Lovable TanStack App
FROM node:20-alpine
WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install

# Copy application code
COPY . .

# Build the application (Nitro will now build the server!)
RUN npm run build

# Cloud Run enforces the PORT environment variable
ENV PORT=8080
ENV HOST=0.0.0.0
ENV NODE_ENV=production

EXPOSE 8080

# Run the Nitro built server using the package.json script
CMD ["npm", "run", "start"]