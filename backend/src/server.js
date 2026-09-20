import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import cors from 'cors';

const app = express();

const PORT = process.env.PORT || 3000;

// Necessário para descobrir o caminho correto dos arquivos
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Middleware
app.use(express.json());
app.use(cors());

// Caminho do frontend
const frontendPath = path.join(__dirname, '../../frontend');

// Servir arquivos do frontend
app.use(express.static(frontendPath));

// Rota de teste
app.get('/api/status', (req, res) => {
  res.json({
    status: 'Servidor AgendaPro rodando com sucesso!'
  });
});

// Página principal
app.get('/', (req, res) => {
  res.sendFile(path.join(frontendPath, 'index.html'));
});

// Inicia o servidor
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Servidor AgendaPro rodando na porta ${PORT}`);
});