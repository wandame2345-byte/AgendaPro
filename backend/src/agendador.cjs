const express = require('express');
const path = require('path');
const cors = require('cors');

const app = express();

const PORT = process.env.PORT || 3000;

// ===============================
// MIDDLEWARES
// ===============================
app.use(express.json());
app.use(cors());

// ===============================
// FRONTEND
// ===============================
const frontendPath = path.join(__dirname, '../../frontend');

app.use(express.static(frontendPath));

// ===============================
// API - STATUS
// ===============================
app.get('/api/status', (req, res) => {
  res.json({
    status: 'Servidor AgendaPro rodando com sucesso!'
  });
});

// ===============================
// ROTA DE FALLBACK DO FRONTEND
// Compatível com Express 5
// ===============================
app.use((req, res, next) => {
  // Se for uma rota da API que não existe
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({
      error: 'Rota da API não encontrada'
    });
  }

  // Para qualquer outra rota, entrega o frontend
  res.sendFile(path.join(frontendPath, 'index.html'));
});

// ===============================
// INICIAR SERVIDOR
// ===============================
app.listen(PORT, '0.0.0.0', () => {
  console.log(`AgendaPro rodando na porta ${PORT}`);
});