FROM node:22-alpine
WORKDIR /app
COPY backend/package*.json ./backend/
RUN cd backend && npm install --omit=dev
COPY . .
RUN mkdir -p /app/uploads
EXPOSE 3000
CMD ["node", "backend/src/agendador.cjs"]