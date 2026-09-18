# Dockerfile alternativo para referência.
# Para o sistema completo, use o Dockerfile da raiz do projeto.
FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .
CMD ["node", "src/server.js"]
