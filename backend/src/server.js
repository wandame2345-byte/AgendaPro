import express from 'express';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

const app = express();

const PORT = process.env.PORT || 3000;

// Permite receber JSON
app.use(express.json());

// Caminho do frontend
const frontendPath = path.join(process.cwd(), 'frontend');

// Serve os arquivos do frontend
app.use(express.static(frontendPath));

// Rota de teste da API
app.get('/api/status', (req, res) => {
  res.json({
    status: 'Servidor AgendaPro rodando com sucesso!'
  });
});

// Rota principal
app.get('/', (req, res) => {
  res.sendFile(path.join(frontendPath, 'index.html'));
});

// Inicia o servidor
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Servidor AgendaPro rodando na porta ${PORT}`);
});