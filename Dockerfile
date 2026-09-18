FROM node:22-alpine
WORKDIR /app
COPY backend/package*.json ./backend/
RUN cd backend && npm install --omit=dev
COPY backend ./backend
COPY frontend ./frontend
RUN mkdir -p /app/uploads
ENV NODE_ENV=production
ENV PORT=3000
ENV UPLOAD_DIR=/app/uploads
EXPOSE 3000
CMD ["sh", "-c", "until node backend/src/seed.js; do echo 'Aguardando PostgreSQL...'; sleep 3; done; exec node backend/src/server.js"]
