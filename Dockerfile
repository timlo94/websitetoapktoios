# Single Stage Build for Lovable TanStack App
FROM node:20-alpine
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install ALL dependencies (Keeping Vite installed!)
RUN npm install

# Copy application code
COPY . .

# Build the application
RUN npm run build

# Set Cloud Run port variables
EXPOSE 8080
ENV PORT=8080
ENV HOST=0.0.0.0

# Start the app using the new package.json script
CMD ["npm", "run", "start"]