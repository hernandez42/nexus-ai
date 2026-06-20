FROM node:22-alpine

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci --only=production

# Copy source
COPY . .

# Build TypeScript
RUN npm run build 2>/dev/null || echo "No build script, running as TS"

# Create workspace directory
RUN mkdir -p nexus-workspace

# Non-root user for security
RUN addgroup -g 1001 -S nexus && adduser -S nexus -u 1001
RUN chown -R nexus:nexus /app/nexus-workspace
USER nexus

EXPOSE 3000

CMD ["npm", "start"]
