FROM node:18-slim
WORKDIR /app
COPY package.json package-lock.json* ./
# Use npm install instead of npm ci because npm ci requires a package-lock.json present.
# npm install will create a lockfile if none exists and works in build environments like Railway.
RUN npm install --production --no-audit --prefer-offline
COPY . .
CMD ["node", "index.js"]
