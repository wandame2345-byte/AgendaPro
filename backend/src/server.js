import { iniciarAgendamentoBackup } from './agendador.js';
import express from 'express';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import multer from 'multer';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import pg from 'pg';
import PDFDocument from 'pdfkit';

const app = express();
const PORT = process.env.PORT || 3000;

// Configurações básicas do Express
app.use(express.json());

// Inicia o agendador de backup
iniciarAgendamentoBackup();

// Rota de teste para confirmar que o servidor está rodando
app.get('/', (req, res) => {
  res.send('Servidor AgendaPro rodando com sucesso!');
});

// ESCUTA A PORTA DO NAVEGADOR
app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
});