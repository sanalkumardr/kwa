# Build + run the NestJS API.
FROM node:20-bookworm-slim

WORKDIR /app

# install deps first for layer caching
COPY package*.json ./
RUN npm install

# app sources
COPY tsconfig.json nest-cli.json ./
COPY src ./src

RUN npm run build

EXPOSE 3000
CMD ["node", "dist/main.js"]
