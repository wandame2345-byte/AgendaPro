const express = require('express');
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// Middlewares
app.use(express.json());
app.use(cors());

// Caminho para a pasta do frontend
const frontendPath = path.join(__dirname, '../../frontend');

// Servir arquivos estáticos (CSS, JS, imagens)
app.use(express.static(frontendPath));

// Rota de teste/Healthcheck da API
app.get('/api/status', (req, res) => {
  res.json({ status: 'Servidor AgendaPro rodando com sucesso!' });
});

// Qualquer rota abre a interface visual (index.html)
app.get('*', (req, res) => {
  res.sendFile(path.join(frontendPath, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});