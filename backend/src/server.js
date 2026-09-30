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
import { fileURLToPath } from 'url';

dotenv.config();

const { Pool } = pg;

pg.types.setTypeParser(1082, value => value);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '../../');
const frontend = path.join(root, 'frontend');
const PORT = Number(process.env.PORT || 3000);

const JWT_SECRET =
  process.env.JWT_SECRET ||
  (process.env.NODE_ENV === 'production'
    ? null
    : 'agendapro-dev-secret-change-me');

if (!JWT_SECRET) {
  console.error('ERRO: configure JWT_SECRET no Render.');
  process.exit(1);
}

if (!process.env.DATABASE_URL) {
  console.error('ERRO: configure DATABASE_URL no Render.');
  process.exit(1);
}

const uploadDir = path.resolve(
  process.env.UPLOAD_DIR || path.join(root, 'uploads')
);

fs.mkdirSync(uploadDir, { recursive: true });

const app = express();

app.set('trust proxy', 1);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production'
    ? { rejectUnauthorized: false }
    : undefined
});

pool.on('error', error => {
  console.error('Erro inesperado no PostgreSQL:', error);
});

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cookieParser());
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use('/uploads', express.static(uploadDir));
app.use(express.static(frontend));

// =====================================================
// UTILITÁRIOS
// =====================================================

const asyncHandler = fn => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

function fail(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  throw error;
}

function validId(value, label = 'Identificador') {
  const id = String(value ?? '');

  if (
    !/^[1-9]\d{0,18}$/.test(id) ||
    BigInt(id) > 9223372036854775807n
  ) {
    fail(label + ' inválido.');
  }

  return id;
}

function normalizePhone(value = '') {
  return String(value).trim().replace(/\D/g, '');
}

function salonToday() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date());

  const part = type => parts.find(item => item.type === type).value;

  return `${part('year')}-${part('month')}-${part('day')}`;
}

function procedurePrice(value) {
  const text = String(value ?? '').trim().replace(',', '.');

  if (!/^\d{1,8}(\.\d{1,2})?$/.test(text)) return null;

  const price = Number(text);

  return Number.isFinite(price) && price <= 99999999.99
    ? price
    : null;
}

function validMoney(value) {
  const price = procedurePrice(value);

  if (price === null) {
    fail('Informe um valor de 0 a 99999999,99, com até duas casas decimais.');
  }

  return price;
}

function validDate(value) {
  const date = String(value || '');
  if (openingWeekday(date) === null) fail('Data inválida.');
  return date;
}

async function transaction(work, appointmentLock = false) {
  const db = await pool.connect();

  try {
    await db.query('BEGIN');

    if (appointmentLock) {
      await db.query('SELECT pg_advisory_xact_lock(20260930, 1)');
    }

    const result = await work(db);
    await db.query('COMMIT');
    return result;
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally {
    db.release();
  }
}

// =====================================================
// AUTENTICAÇÃO
// =====================================================

function signUser(user) {
  return jwt.sign(
    {
      id: user.id,
      role: user.perfil,
      name: user.nome
    },
    JWT_SECRET,
    { expiresIn: '8h' }
  );
}

function auth(req, res, next) {
  try {
    const token = req.cookies?.agendapro_token;

    if (!token) {
      return res.status(401).json({ error: 'Não autenticado.' });
    }

    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({
      error: 'Sessão expirada. Entre novamente.'
    });
  }
}

function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({
      error: 'Acesso permitido somente ao administrador.'
    });
  }

  next();
}

app.post('/api/auth/login', asyncHandler(async (req, res) => {
  const { email, password, role } = req.body || {};

  if (!email || !password || !role) {
    fail('Informe e-mail, senha e perfil.');
  }

  if (!['admin', 'funcionario'].includes(role)) {
    fail('Perfil inválido.');
  }

  const result = await pool.query(`
    SELECT *
    FROM usuarios
    WHERE LOWER(email) = LOWER($1)
      AND perfil = $2
      AND ativo = TRUE
    LIMIT 1
  `, [String(email).trim(), role]);

  const user = result.rows[0];

  if (
    !user ||
    !(await bcrypt.compare(String(password), user.senha_hash))
  ) {
    fail('E-mail, perfil ou senha incorretos.', 401);
  }

  res.cookie('agendapro_token', signUser(user), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 8 * 60 * 60 * 1000
  });

  res.json({
    user: {
      id: user.id,
      name: user.nome,
      role: user.perfil
    }
  });
}));

app.post('/api/auth/logout', (_req, res) => {
  res.clearCookie('agendapro_token', {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production'
  });

  res.json({ ok: true });
});

app.get('/api/auth/me', auth, (req, res) => {
  res.json({
    user: {
      id: req.user.id,
      name: req.user.name,
      role: req.user.role
    }
  });
});

app.put('/api/auth/password', auth, asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};

  if (!currentPassword || !newPassword) {
    fail('Informe a senha atual e a nova senha.');
  }

  if (String(newPassword).length < 6) {
    fail('A nova senha deve ter pelo menos 6 caracteres.');
  }

  const result = await pool.query(`
    SELECT *
    FROM usuarios
    WHERE id = $1 AND ativo = TRUE
    LIMIT 1
  `, [req.user.id]);

  const user = result.rows[0];

  if (!user) fail('Usuário não encontrado.', 404);

  const valid = await bcrypt.compare(
    String(currentPassword),
    user.senha_hash
  );

  if (!valid) fail('Senha atual incorreta.');

  const hash = await bcrypt.hash(String(newPassword), 12);

  await pool.query(`
    UPDATE usuarios
    SET senha_hash = $1, updated_at = NOW()
    WHERE id = $2
  `, [hash, req.user.id]);

  res.json({ ok: true });
}));

// =====================================================
// MAPEAMENTO DOS DADOS
// =====================================================

function publicClient(client) {
  return {
    id: client.id,
    name: client.nome,
    phone: client.telefone,
    photo: client.foto_url,
    note: client.observacao,
    active: client.ativo
  };
}

function publicAppointment(appointment) {
  return {
    id: appointment.id,
    clientId: appointment.cliente_id,
    originalAppointmentId: appointment.agendamento_origem_id || null,
    isReturn:
      Boolean(appointment.agendamento_origem_id) ||
      appointment.status === 'Retorno',
    name: appointment.nome,
    phone: appointment.telefone,
    date: appointment.data,
    time: String(appointment.hora).slice(0, 5),
    procedure: appointment.procedimento,
    procedureId: appointment.procedimento_id,
    price: Number(appointment.valor),
    status: appointment.status,
    note: appointment.observacao || ''
  };
}

function publicProduct(product) {
  return {
    id: product.id,
    name: product.nome,
    description: product.descricao || '',
    photo: product.foto_url || null,
    price: Number(product.preco),
    active: product.ativo
  };
}

async function appointmentById(db, id) {
  const result = await db.query(`
    SELECT a.*, c.nome, c.telefone, p.nome AS procedimento
    FROM agendamentos a
    JOIN clientes c ON c.id = a.cliente_id
    JOIN procedimentos p ON p.id = a.procedimento_id
    WHERE a.id = $1
  `, [id]);

  if (!result.rowCount) fail('Agendamento não encontrado.', 404);

  return publicAppointment(result.rows[0]);
}

// =====================================================
// HORÁRIOS DE ATENDIMENTO
// =====================================================

function defaultOpeningHours() {
  return {
    slots: Array.from(
      { length: 12 },
      (_, index) => `${String(index + 8).padStart(2, '0')}:00`
    )
  };
}

function openingMinutes(value) {
  if (
    typeof value !== 'string' ||
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)
  ) return null;

  const [hour, minute] = value.split(':').map(Number);
  return hour * 60 + minute;
}

function openingWeekday(date) {
  if (
    typeof date !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(date)
  ) return null;

  const value = new Date(date + 'T12:00:00Z');

  if (
    Number.isNaN(value.getTime()) ||
    value.toISOString().slice(0, 10) !== date
  ) return null;

  return value.getUTCDay();
}

function openingSlots(settings, date) {
  const weekday = openingWeekday(date);
  if (weekday === null) return [];

  if (Array.isArray(settings.slots)) {
    return [...settings.slots];
  }

  const day = settings.days[weekday];
  if (!day.open) return [];

  const start = openingMinutes(day.start);
  const end = openingMinutes(day.end);
  const pauseStart = openingMinutes(day.breakStart);
  const pauseEnd = openingMinutes(day.breakEnd);

  const ranges = pauseStart === null
    ? [[start, end]]
    : [[start, pauseStart], [pauseEnd, end]];

  const slots = [];

  for (const [from, until] of ranges) {
    for (
      let minute = from;
      minute + settings.interval <= until;
      minute += settings.interval
    ) {
      const hours = String(Math.floor(minute / 60)).padStart(2, '0');
      const minutes = String(minute % 60).padStart(2, '0');
      slots.push(`${hours}:${minutes}`);
    }
  }

  return slots;
}

function validateOpeningHours(value) {
  if (
    value &&
    Object.prototype.hasOwnProperty.call(value, 'slots')
  ) {
    if (!Array.isArray(value.slots) || value.slots.length > 1440) {
      fail('Informe uma lista de até 1440 horários.');
    }

    if (value.slots.some(time => openingMinutes(time) === null)) {
      fail('Preencha cada horário no formato HH:mm.');
    }

    if (new Set(value.slots).size !== value.slots.length) {
      fail('Existem horários repetidos. Remova a repetição antes de salvar.');
    }

    return { slots: [...value.slots].sort() };
  }

  if (
    !value ||
    !Number.isInteger(value.interval) ||
    value.interval < 5 ||
    value.interval > 240
  ) {
    fail('O intervalo deve ser um número inteiro de 5 a 240 minutos.');
  }

  if (!Array.isArray(value.days) || value.days.length !== 7) {
    fail('Configure os sete dias da semana.');
  }

  const labels = [
    'Domingo', 'Segunda-feira', 'Terça-feira',
    'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'
  ];

  const days = value.days.map((day, index) => {
    if (!day || typeof day.open !== 'boolean') {
      fail(`${labels[index]}: informe se o dia está aberto.`);
    }

    const start = openingMinutes(day.start);
    const end = openingMinutes(day.end);

    if (start === null || end === null) {
      fail(`${labels[index]}: informe horários válidos.`);
    }

    const breakStart = day.breakStart ?? '';
    const breakEnd = day.breakEnd ?? '';
    const pauseStart = openingMinutes(breakStart);
    const pauseEnd = openingMinutes(breakEnd);

    if (
      (breakStart !== '' || breakEnd !== '') &&
      (pauseStart === null || pauseEnd === null)
    ) {
      fail(`${labels[index]}: preencha o início e o fim da pausa.`);
    }

    if (day.open && end <= start) {
      fail(`${labels[index]}: o fechamento deve ser depois da abertura.`);
    }

    if (
      day.open &&
      pauseStart !== null &&
      !(start < pauseStart && pauseStart < pauseEnd && pauseEnd < end)
    ) {
      fail(`${labels[index]}: a pausa deve ficar dentro do expediente.`);
    }

    if (day.open) {
      const ranges = pauseStart === null
        ? [[start, end]]
        : [[start, pauseStart], [pauseEnd, end]];

      if (!ranges.some(([from, until]) => until - from >= value.interval)) {
        fail(`${labels[index]}: o expediente precisa comportar um intervalo completo.`);
      }
    }

    return {
      open: day.open,
      start: day.start,
      end: day.end,
      breakStart,
      breakEnd
    };
  });

  return { interval: value.interval, days };
}

async function readOpeningHours(database = pool, lock = false) {
  const result = await database.query(
    'SELECT dados FROM configuracoes_agenda WHERE id = 1' +
    (lock ? ' FOR SHARE' : '')
  );

  if (!result.rowCount) {
    throw new Error('Horários de atendimento não configurados.');
  }

  return result.rows[0].dados;
}

async function assertOpeningSlot(database, date, time) {
  const settings = await readOpeningHours(database, true);

  if (
    openingWeekday(date) === null ||
    !openingSlots(settings, date).includes(time)
  ) {
    fail('Escolha um horário disponível na lista de atendimento.');
  }
}

app.get('/api/opening-hours', asyncHandler(async (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(await readOpeningHours());
}));

app.put('/api/opening-hours', auth, requireAdmin, asyncHandler(async (req, res) => {
  const settings = validateOpeningHours(req.body);

  await pool.query(`
    UPDATE configuracoes_agenda
    SET dados = $1::jsonb, updated_at = NOW()
    WHERE id = 1
  `, [JSON.stringify(settings)]);

  res.json(settings);
}));

// =====================================================
// FOTOS DE CLIENTES E PRODUTOS
// =====================================================

const storage = multer.diskStorage({
  destination: (_req, _file, callback) => {
    callback(null, uploadDir);
  },
  filename: (_req, file, callback) => {
    const extensions = {
      'image/jpeg': '.jpg',
      'image/png': '.png',
      'image/webp': '.webp',
      'image/gif': '.gif'
    };

    const extension = extensions[file.mimetype] || '.jpg';
    const name =
      `${Date.now()}-${Math.random().toString(36).slice(2, 10)}${extension}`;

    callback(null, name);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, callback) => {
    if (
      ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
        .includes(file.mimetype)
    ) {
      callback(null, true);
      return;
    }

    const error = new Error('A foto deve ser JPG, PNG, WEBP ou GIF.');
    error.status = 400;
    callback(error);
  }
});

// =====================================================
// STATUS DO SERVIDOR
// =====================================================

app.get('/api/status', (_req, res) => {
  res.json({ status: 'Servidor AgendaPro rodando com sucesso!' });
});

app.get('/api/health', asyncHandler(async (_req, res) => {
  await pool.query('SELECT 1');
  res.json({
    ok: true,
    service: 'AgendaPro',
    database: 'connected'
  });
}));

// =====================================================
// PROCEDIMENTOS
// =====================================================

app.get('/api/procedures', asyncHandler(async (_req, res) => {
  const result = await pool.query(`
    SELECT id, nome, preco
    FROM procedimentos
    WHERE ativo = TRUE
    ORDER BY nome
  `);

  res.json(result.rows.map(item => ({
    id: item.id,
    name: item.nome,
    price: Number(item.preco)
  })));
}));

app.post('/api/procedures', auth, requireAdmin, asyncHandler(async (req, res) => {
  const name = String(req.body?.name || '').trim();
  const price = validMoney(req.body?.price);

  if (!name || name.length > 150) {
    fail('Informe um nome de até 150 caracteres.');
  }

  const result = await pool.query(`
    INSERT INTO procedimentos(nome, preco)
    VALUES($1, $2)
    ON CONFLICT(nome)
    DO UPDATE SET
      preco = EXCLUDED.preco,
      ativo = TRUE,
      updated_at = NOW()
    WHERE procedimentos.ativo = FALSE
    RETURNING id, nome, preco
  `, [name, price]);

  if (!result.rowCount) {
    fail('Este procedimento já está cadastrado. Use Alterar valor.', 409);
  }

  const item = result.rows[0];

  res.status(201).json({
    id: item.id,
    name: item.nome,
    price: Number(item.preco)
  });
}));

app.patch('/api/procedures/:id/price', auth, requireAdmin, asyncHandler(async (req, res) => {
  const id = validId(req.params.id, 'Procedimento');
  const price = validMoney(req.body?.price);

  const result = await pool.query(`
    UPDATE procedimentos
    SET preco = $1, updated_at = NOW()
    WHERE id = $2 AND ativo = TRUE
    RETURNING id, nome, preco
  `, [price, id]);

  if (!result.rowCount) fail('Procedimento não encontrado.', 404);

  const item = result.rows[0];

  res.json({
    id: item.id,
    name: item.nome,
    price: Number(item.preco)
  });
}));

app.delete('/api/procedures/:id', auth, requireAdmin, asyncHandler(async (req, res) => {
  const id = validId(req.params.id, 'Procedimento');

  await pool.query(`
    UPDATE procedimentos
    SET ativo = FALSE, updated_at = NOW()
    WHERE id = $1
  `, [id]);

  res.json({ ok: true });
}));

// =====================================================
// CLIENTES
// =====================================================

app.get('/api/clients', auth, asyncHandler(async (req, res) => {
  const q = String(req.query.q || '').trim();

  const result = await pool.query(`
    SELECT
      c.*,
      COUNT(a.id)::int AS count,
      COALESCE(SUM(
        CASE WHEN a.status <> 'Cancelado' THEN a.valor ELSE 0 END
      ), 0) AS total,
      MAX(a.data) AS last
    FROM clientes c
    LEFT JOIN agendamentos a ON a.cliente_id = c.id
    WHERE (c.ativo = TRUE OR $2::boolean)
      AND (
        $1 = ''
        OR c.nome ILIKE '%' || $1 || '%'
        OR c.telefone ILIKE '%' || $1 || '%'
      )
    GROUP BY c.id
    ORDER BY MAX(a.data) DESC NULLS LAST, c.nome
  `, [q, req.user.role === 'admin']);

  res.json(result.rows.map(client => ({
    ...publicClient(client),
    count: client.count,
    total: Number(client.total),
    last: client.last
  })));
}));

app.post('/api/clients', auth, upload.single('photo'), asyncHandler(async (req, res) => {
  const name = String(req.body.name || '').trim();
  const phone = normalizePhone(req.body.phone);
  const note = String(req.body.note || '').trim();

  if (!name || !phone) fail('Nome e telefone são obrigatórios.');
  if (name.length > 150 || phone.length > 30) fail('Nome ou telefone muito longo.');

  const photo = req.file ? `/uploads/${req.file.filename}` : null;

  const result = await pool.query(`
    INSERT INTO clientes(nome, telefone, foto_url, observacao)
    VALUES($1, $2, $3, $4)
    ON CONFLICT(telefone)
    DO UPDATE SET
      nome = EXCLUDED.nome,
      foto_url = COALESCE(EXCLUDED.foto_url, clientes.foto_url),
      observacao = EXCLUDED.observacao,
      ativo = TRUE,
      updated_at = NOW()
    RETURNING *
  `, [name, phone, photo, note]);

  res.status(201).json(publicClient(result.rows[0]));
}));

app.delete('/api/clients/:id', auth, requireAdmin, asyncHandler(async (req, res) => {
  const clientId = validId(req.params.id, 'Cliente');

  await transaction(async db => {
    const result = await db.query(
      'SELECT id FROM clientes WHERE id = $1 FOR UPDATE',
      [clientId]
    );

    if (!result.rowCount) fail('Cliente não encontrado.', 404);

    const sales = await db.query(
      'SELECT id FROM vendas WHERE cliente_id = $1 LIMIT 1',
      [clientId]
    );

    if (sales.rowCount) {
      fail('Este cliente possui vendas registradas e não pode ser excluído.', 409);
    }

    await db.query(
      'SELECT id FROM agendamentos WHERE cliente_id = $1 FOR UPDATE',
      [clientId]
    );

    await db.query(`
      DELETE FROM atendimentos
      WHERE cliente_id = $1
        OR agendamento_id IN (
          SELECT id FROM agendamentos WHERE cliente_id = $1
        )
    `, [clientId]);

    await db.query(
      'DELETE FROM agendamentos WHERE cliente_id = $1',
      [clientId]
    );

    await db.query('DELETE FROM clientes WHERE id = $1', [clientId]);
  }, true);

  res.json({ ok: true });
}));

async function upsertClient(db, clientInfo) {
  const name = String(clientInfo.name || '').trim();
  const phone = normalizePhone(clientInfo.phone);
  const note = String(clientInfo.note || '').trim();

  if (!name || !phone) fail('Nome e telefone são obrigatórios.');
  if (name.length > 150 || phone.length > 30) fail('Nome ou telefone muito longo.');

  const result = await db.query(`
    INSERT INTO clientes(nome, telefone, foto_url, observacao)
    VALUES($1, $2, $3, $4)
    ON CONFLICT(telefone)
    DO UPDATE SET
      nome = EXCLUDED.nome,
      foto_url = COALESCE(EXCLUDED.foto_url, clientes.foto_url),
      observacao = CASE
        WHEN EXCLUDED.observacao <> '' THEN EXCLUDED.observacao
        ELSE clientes.observacao
      END,
      ativo = TRUE,
      updated_at = NOW()
    RETURNING *
  `, [name, phone, clientInfo.photo || null, note]);

  return result.rows[0];
}

// =====================================================
// NOTIFICAÇÕES E AGENDAMENTOS FUTUROS
// =====================================================

app.get('/api/notifications/today', auth, asyncHandler(async (req, res) => {
  const date = validDate(req.query.date || salonToday());

  const result = await pool.query(`
    SELECT a.*, c.nome, c.telefone, p.nome AS procedimento
    FROM agendamentos a
    JOIN clientes c ON c.id = a.cliente_id
    JOIN procedimentos p ON p.id = a.procedimento_id
    WHERE a.data = $1
      AND a.status NOT IN ('Cancelado', 'Atendido')
    ORDER BY a.hora, a.id
  `, [date]);

  res.set('Cache-Control', 'no-store');

  res.json({
    date,
    count: result.rowCount,
    appointments: result.rows.map(publicAppointment)
  });
}));

app.get('/api/appointments/upcoming', auth, asyncHandler(async (req, res) => {
  const date = validDate(req.query.date || salonToday());

  const result = await pool.query(`
    SELECT a.*, c.nome, c.telefone, p.nome AS procedimento
    FROM agendamentos a
    JOIN clientes c ON c.id = a.cliente_id
    JOIN procedimentos p ON p.id = a.procedimento_id
    WHERE a.data > $1
      AND a.status NOT IN ('Cancelado', 'Atendido')
    ORDER BY a.data, a.hora, a.id
  `, [date]);

  res.set('Cache-Control', 'no-store');
  res.json(result.rows.map(publicAppointment));
}));

app.get('/api/appointments', auth, asyncHandler(async (req, res) => {
  const date = req.query.date ? validDate(req.query.date) : null;

  const result = await pool.query(`
    SELECT a.*, c.nome, c.telefone, p.nome AS procedimento
    FROM agendamentos a
    JOIN clientes c ON c.id = a.cliente_id
    JOIN procedimentos p ON p.id = a.procedimento_id
    WHERE ($1::date IS NULL OR a.data = $1::date)
    ORDER BY a.data, a.hora, a.id
  `, [date]);

  res.set('Cache-Control', 'no-store');
  res.json(result.rows.map(publicAppointment));
}));

// =====================================================
// SINCRONIZAÇÃO DOS ATENDIMENTOS CONCLUÍDOS
// =====================================================

async function syncAttendance(db, appointment, userId) {
  if (appointment.status !== 'Atendido') {
    await db.query(
      'DELETE FROM atendimentos WHERE agendamento_id = $1',
      [appointment.id]
    );
    return;
  }

  await db.query(`
    INSERT INTO atendimentos(
      agendamento_id,
      cliente_id,
      procedimento_id,
      data,
      valor,
      observacao,
      atendido_por
    )
    VALUES($1, $2, $3, $4, $5, $6, $7)
    ON CONFLICT (agendamento_id)
      WHERE agendamento_id IS NOT NULL
    DO UPDATE SET
      cliente_id = EXCLUDED.cliente_id,
      procedimento_id = EXCLUDED.procedimento_id,
      data = EXCLUDED.data,
      valor = EXCLUDED.valor,
      observacao = EXCLUDED.observacao,
      atendido_por = COALESCE(
        atendimentos.atendido_por,
        EXCLUDED.atendido_por
      ),
      updated_at = NOW()
  `, [
    appointment.id,
    appointment.cliente_id,
    appointment.procedimento_id,
    appointment.data,
    appointment.valor,
    appointment.observacao,
    userId
  ]);
}

// =====================================================
// NOVO AGENDAMENTO
// =====================================================

app.post('/api/appointments', auth, asyncHandler(async (req, res) => {
  const body = req.body || {};
  const date = validDate(body.date);
  const time = String(body.time || '');
  const procedureId = validId(body.procedureId, 'Procedimento');
  const status = body.status || 'Agendado';

  if (openingMinutes(time) === null) fail('Horário inválido.');

  if (!['Agendado', 'Confirmado', 'Atendido', 'Cancelado'].includes(status)) {
    fail('Status inválido.');
  }

  const appointment = await transaction(async db => {
    await assertOpeningSlot(db, date, time);

    let customer;

    if (body.clientId) {
      const result = await db.query(
        'SELECT * FROM clientes WHERE id = $1 AND ativo = TRUE FOR SHARE',
        [validId(body.clientId, 'Cliente')]
      );

      if (!result.rowCount) fail('Cliente não encontrado.', 404);
      customer = result.rows[0];
    } else {
      customer = await upsertClient(db, {
        name: body.name,
        phone: body.phone,
        note: body.note
      });
    }

    const procedure = await db.query(`
      SELECT id, nome, preco
      FROM procedimentos
      WHERE id = $1 AND ativo = TRUE
      FOR SHARE
    `, [procedureId]);

    if (!procedure.rowCount) fail('Procedimento inválido.');

    const price = validMoney(body.price ?? procedure.rows[0].preco);

    const result = await db.query(`
      INSERT INTO agendamentos(
        cliente_id, procedimento_id, data, hora,
        valor, status, observacao, criado_por
      )
      VALUES($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `, [
      customer.id,
      procedureId,
      date,
      time,
      price,
      status,
      String(body.note || '').trim(),
      req.user.id
    ]);

    await syncAttendance(db, result.rows[0], req.user.id);
    return appointmentById(db, result.rows[0].id);
  }, true);

  res.status(201).json(appointment);
}));

// =====================================================
// EDITAR AGENDAMENTO / ATENDIMENTO
// =====================================================

app.patch('/api/appointments/:id', auth, asyncHandler(async (req, res) => {
  const id = validId(req.params.id, 'Agendamento');
  const body = req.body || {};

  const updated = await transaction(async db => {
    const current = await db.query(
      'SELECT * FROM agendamentos WHERE id = $1 FOR UPDATE',
      [id]
    );

    if (!current.rowCount) fail('Agendamento não encontrado.', 404);

    const previous = current.rows[0];

    const clientId = validId(
      body.clientId ?? previous.cliente_id,
      'Cliente'
    );

    const procedureId = validId(
      body.procedureId ?? previous.procedimento_id,
      'Procedimento'
    );

    const date = validDate(body.date ?? previous.data);

    const time = body.time === undefined
      ? String(previous.hora).slice(0, 5)
      : String(body.time);

    if (openingMinutes(time) === null) fail('Horário inválido.');

    const price = validMoney(body.price ?? previous.valor);
    const status = body.status ?? previous.status;

    if (!['Agendado', 'Confirmado', 'Atendido', 'Cancelado', 'Retorno'].includes(status)) {
      fail('Status inválido.');
    }

    if (
      status === 'Retorno' &&
      !previous.agendamento_origem_id &&
      previous.status !== 'Retorno'
    ) {
      fail('Use Agendar retorno para criar um retorno com data própria.');
    }

    const customer = await db.query(
      'SELECT id FROM clientes WHERE id = $1 FOR SHARE',
      [clientId]
    );

    if (!customer.rowCount) fail('Cliente não encontrado.', 404);

    const procedure = await db.query(
      'SELECT id, ativo FROM procedimentos WHERE id = $1 FOR SHARE',
      [procedureId]
    );

    if (
      !procedure.rowCount ||
      (!procedure.rows[0].ativo && procedureId !== String(previous.procedimento_id))
    ) {
      fail('Escolha um procedimento ativo.');
    }

    const children = await db.query(
      'SELECT * FROM agendamentos WHERE agendamento_origem_id = $1 FOR UPDATE',
      [id]
    );

    if (
      clientId !== String(previous.cliente_id) &&
      (previous.agendamento_origem_id || children.rowCount)
    ) {
      fail('Este atendimento está vinculado a retornos. Não é possível trocar o cliente.');
    }

    if (previous.agendamento_origem_id && status !== 'Cancelado') {
      const parent = await db.query(
        'SELECT data, hora FROM agendamentos WHERE id = $1',
        [previous.agendamento_origem_id]
      );

      if (
        parent.rowCount &&
        date + time <= parent.rows[0].data + String(parent.rows[0].hora).slice(0, 5)
      ) {
        fail('O retorno deve acontecer depois do atendimento original.');
      }
    }

    if (children.rows.some(child =>
      child.status !== 'Cancelado' &&
      date + time >= child.data + String(child.hora).slice(0, 5)
    )) {
      fail('Esta data ficaria depois de um retorno vinculado. Ajuste primeiro a data do retorno.');
    }

    if (
      status !== 'Cancelado' &&
      (
        date !== previous.data ||
        time !== String(previous.hora).slice(0, 5)
      )
    ) {
      await assertOpeningSlot(db, date, time);
    }

    const result = await db.query(`
      UPDATE agendamentos
      SET cliente_id = $1,
          procedimento_id = $2,
          data = $3,
          hora = $4,
          valor = $5,
          status = $6,
          observacao = $7,
          updated_at = NOW()
      WHERE id = $8
      RETURNING *
    `, [
      clientId,
      procedureId,
      date,
      time,
      price,
      status,
      String(body.note ?? previous.observacao ?? '').trim(),
      id
    ]);

    await syncAttendance(db, result.rows[0], req.user.id);
    return appointmentById(db, id);
  }, true);

  res.json(updated);
}));

app.delete('/api/appointments/:id', auth, requireAdmin, asyncHandler(async (req, res) => {
  const id = validId(req.params.id, 'Agendamento');

  await transaction(async db => {
    const current = await db.query(
      'SELECT id FROM agendamentos WHERE id = $1 FOR UPDATE',
      [id]
    );

    if (!current.rowCount) fail('Agendamento não encontrado.', 404);

    await db.query(
      'DELETE FROM atendimentos WHERE agendamento_id = $1',
      [id]
    );

    await db.query('DELETE FROM agendamentos WHERE id = $1', [id]);
  }, true);

  res.json({ ok: true });
}));

app.patch('/api/appointments/:id/status', auth, asyncHandler(async (req, res) => {
  const id = validId(req.params.id, 'Agendamento');
  const status = req.body?.status;

  if (!['Agendado', 'Confirmado', 'Atendido', 'Cancelado'].includes(status)) {
    fail('Status inválido.');
  }

  await transaction(async db => {
    const result = await db.query(`
      UPDATE agendamentos
      SET status = $1, updated_at = NOW()
      WHERE id = $2
      RETURNING *
    `, [status, id]);

    if (!result.rowCount) fail('Agendamento não encontrado.', 404);

    await syncAttendance(db, result.rows[0], req.user.id);
  }, true);

  res.json({ ok: true });
}));

// =====================================================
// AGENDAMENTO PÚBLICO
// =====================================================

app.get('/api/public/slots', asyncHandler(async (req, res) => {
  const date = validDate(req.query.date);
  const settings = await readOpeningHours();

  const result = await pool.query(`
    SELECT hora
    FROM agendamentos
    WHERE data = $1 AND status <> 'Cancelado'
    ORDER BY hora
  `, [date]);

  const bookingsByTime = result.rows.reduce((counts, row) => {
    const time = String(row.hora).slice(0, 5);
    counts[time] = (counts[time] || 0) + 1;
    return counts;
  }, {});

  res.set('Cache-Control', 'no-store');

  res.json({
    date,
    slots: openingSlots(settings, date),
    allowMultipleBookings: true,
    taken: [],
    bookingsByTime
  });
}));

app.post('/api/public/bookings', upload.single('photo'), asyncHandler(async (req, res) => {
  const body = req.body || {};
  const date = validDate(body.date);
  const time = String(body.time || '');
  const procedureId = validId(body.procedureId, 'Procedimento');

  if (openingMinutes(time) === null) fail('Horário inválido.');

  const result = await transaction(async db => {
    await assertOpeningSlot(db, date, time);

    const procedure = await db.query(`
      SELECT id, nome, preco
      FROM procedimentos
      WHERE id = $1 AND ativo = TRUE
      FOR SHARE
    `, [procedureId]);

    if (!procedure.rowCount) fail('Procedimento inválido.');

    const customer = await upsertClient(db, {
      name: body.name,
      phone: body.phone,
      note: body.note,
      photo: req.file ? `/uploads/${req.file.filename}` : null
    });

    const inserted = await db.query(`
      INSERT INTO agendamentos(
        cliente_id, procedimento_id, data, hora,
        valor, status, observacao
      )
      VALUES($1, $2, $3, $4, $5, 'Agendado', $6)
      RETURNING id
    `, [
      customer.id,
      procedureId,
      date,
      time,
      validMoney(procedure.rows[0].preco),
      String(body.note || '').trim()
    ]);

    return {
      ok: true,
      id: inserted.rows[0].id,
      details: `${procedure.rows[0].nome} em ${date} às ${time}.`
    };
  }, true);

  res.status(201).json(result);
}));

// =====================================================
// RETORNOS
// =====================================================

app.post('/api/appointments/:id/return', auth, asyncHandler(async (req, res) => {
  const originalId = validId(req.params.id, 'Atendimento original');
  const body = req.body || {};
  const date = validDate(body.date);
  const time = String(body.time || '');

  if (openingMinutes(time) === null) fail('Horário inválido.');

  const appointment = await transaction(async db => {
    const sourceResult = await db.query(
      'SELECT * FROM agendamentos WHERE id = $1 FOR UPDATE',
      [originalId]
    );

    if (!sourceResult.rowCount) fail('Atendimento original não encontrado.', 404);

    const source = sourceResult.rows[0];

    if (source.status === 'Cancelado') {
      fail('Escolha um atendimento que não esteja cancelado.');
    }

    if (date + time <= source.data + String(source.hora).slice(0, 5)) {
      fail('O retorno deve acontecer depois do atendimento original.');
    }

    const existing = await db.query(`
      SELECT id
      FROM agendamentos
      WHERE agendamento_origem_id = $1
        AND status NOT IN ('Cancelado', 'Atendido')
      LIMIT 1
    `, [originalId]);

    if (existing.rowCount) {
      fail('Já existe um retorno agendado. Edite ou cancele o retorno anterior.', 409);
    }

    const procedureId = validId(
      body.procedureId || source.procedimento_id,
      'Procedimento'
    );

    const proceduresResult = await db.query(`
      SELECT id, preco
      FROM procedimentos
      WHERE id = $1 AND ativo = TRUE
      FOR SHARE
    `, [procedureId]);

    if (!proceduresResult.rowCount) fail('Selecione um procedimento ativo.');

    const procedure = proceduresResult.rows[0];

    const price = validMoney(
      body.price === undefined || body.price === null || body.price === ''
        ? procedure.preco
        : body.price
    );

    await assertOpeningSlot(db, date, time);

    const inserted = await db.query(`
      INSERT INTO agendamentos(
        cliente_id, procedimento_id, data, hora, valor,
        status, observacao, criado_por, agendamento_origem_id
      )
      VALUES($1, $2, $3, $4, $5, 'Retorno', $6, $7, $8)
      RETURNING id
    `, [
      source.cliente_id,
      procedureId,
      date,
      time,
      price,
      String(body.note || '').trim(),
      req.user.id,
      source.id
    ]);

    return appointmentById(db, inserted.rows[0].id);
  }, true);

  res.status(201).json(appointment);
}));

// =====================================================
// PRODUTOS DO SALÃO: NOME, PREÇO E FOTO
// =====================================================

app.get('/api/products', auth, asyncHandler(async (req, res) => {
  const includeInactive =
    req.user.role === 'admin' &&
    req.query.includeInactive === 'true';

  const result = await pool.query(`
    SELECT *
    FROM produtos
    WHERE ativo = TRUE OR $1::boolean
    ORDER BY nome
  `, [includeInactive]);

  res.json(result.rows.map(publicProduct));
}));

app.post(
  '/api/products',
  auth,
  requireAdmin,
  upload.single('photo'),
  asyncHandler(async (req, res) => {
    const name = String(req.body?.name || '').trim();
    const price = validMoney(req.body?.price);
    const description = String(req.body?.description || '').trim();
    const photo = req.file ? `/uploads/${req.file.filename}` : null;

    if (!name || name.length > 150) {
      fail('Informe o nome do produto, com até 150 caracteres.');
    }

    const result = await pool.query(`
      INSERT INTO produtos(
        nome, descricao, preco, criado_por, foto_url
      )
      VALUES($1, $2, $3, $4, $5)
      ON CONFLICT(nome)
      DO UPDATE SET
        descricao = EXCLUDED.descricao,
        preco = EXCLUDED.preco,
        foto_url = COALESCE(EXCLUDED.foto_url, produtos.foto_url),
        ativo = TRUE,
        updated_at = NOW()
      WHERE produtos.ativo = FALSE
      RETURNING *
    `, [name, description, price, req.user.id, photo]);

    if (!result.rowCount) {
      fail('Produto já cadastrado. Use Editar.', 409);
    }

    res.status(201).json(publicProduct(result.rows[0]));
  })
);

app.patch(
  '/api/products/:id',
  auth,
  requireAdmin,
  upload.single('photo'),
  asyncHandler(async (req, res) => {
    const id = validId(req.params.id, 'Produto');
    const body = req.body || {};

    const product = await transaction(async db => {
      const current = await db.query(
        'SELECT * FROM produtos WHERE id = $1 FOR UPDATE',
        [id]
      );

      if (!current.rowCount) fail('Produto não encontrado.', 404);

      const previous = current.rows[0];
      const name = String(body.name ?? previous.nome).trim();

      if (!name || name.length > 150) fail('Nome de produto inválido.');

      let active = previous.ativo;

      if (body.active !== undefined) {
        if (body.active === true || body.active === 'true') {
          active = true;
        } else if (body.active === false || body.active === 'false') {
          active = false;
        } else {
          fail('Situação do produto inválida.');
        }
      }

      const photo = req.file
        ? `/uploads/${req.file.filename}`
        : previous.foto_url;

      const result = await db.query(`
        UPDATE produtos
        SET nome = $1,
            descricao = $2,
            preco = $3,
            ativo = $4,
            foto_url = $6,
            updated_at = NOW()
        WHERE id = $5
        RETURNING *
      `, [
        name,
        String(body.description ?? previous.descricao ?? '').trim(),
        validMoney(body.price ?? previous.preco),
        active,
        id,
        photo
      ]);

      return publicProduct(result.rows[0]);
    });

    res.json(product);
  })
);

app.delete('/api/products/:id', auth, requireAdmin, asyncHandler(async (req, res) => {
  const id = validId(req.params.id, 'Produto');

  const result = await pool.query(`
    UPDATE produtos
    SET ativo = FALSE, updated_at = NOW()
    WHERE id = $1
    RETURNING id
  `, [id]);

  if (!result.rowCount) fail('Produto não encontrado.', 404);

  res.json({ ok: true });
}));

// =====================================================
// VENDAS DE PRODUTOS
// =====================================================

function salesRange(query) {
  const start = query.start ? validDate(query.start) : null;
  const end = query.end ? validDate(query.end) : null;

  if (start && end && start > end) {
    fail('A data inicial deve ser anterior ou igual à data final.');
  }

  return [start, end];
}

async function readSales(
  db,
  start = null,
  end = null,
  id = null,
  filters = {}
) {
  const result = await db.query(`
    SELECT
      v.*,
      c.nome AS cliente_nome,
      c.telefone,
      COALESCE(SUM(i.quantidade * i.valor_unitario), 0) AS total,
      COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'id', i.id::text,
            'productId', i.produto_id::text,
            'name', i.produto_nome,
            'quantity', i.quantidade,
            'unitPrice', i.valor_unitario,
            'total', i.quantidade * i.valor_unitario
          )
          ORDER BY i.id
        ) FILTER (WHERE i.id IS NOT NULL),
        '[]'::jsonb
      ) AS items
    FROM vendas v
    JOIN clientes c ON c.id = v.cliente_id
    LEFT JOIN venda_itens i ON i.venda_id = v.id
    WHERE ($1::date IS NULL OR v.data >= $1::date)
      AND ($2::date IS NULL OR v.data <= $2::date)
      AND ($3::bigint IS NULL OR v.id = $3::bigint)
      AND ($4::bigint IS NULL OR v.cliente_id = $4::bigint)
      AND (
        $5::bigint IS NULL
        OR EXISTS (
          SELECT 1
          FROM venda_itens f
          WHERE f.venda_id = v.id
            AND f.produto_id = $5::bigint
        )
      )
      AND ($6::text IS NULL OR v.status = $6::text)
    GROUP BY v.id, c.id
    ORDER BY v.data DESC, v.id DESC
  `, [
    start,
    end,
    id,
    filters.clientId || null,
    filters.productId || null,
    filters.status || null
  ]);

  return result.rows.map(row => ({
    id: row.id,
    clientId: row.cliente_id,
    name: row.cliente_nome,
    phone: row.telefone,
    date: row.data,
    status: row.status,
    note: row.observacao || '',
    total: Number(row.total),
    items: row.items,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }));
}

async function insertSaleItems(db, saleId, items) {
  if (
    !Array.isArray(items) ||
    items.length < 1 ||
    items.length > 100
  ) {
    fail('Inclua de 1 a 100 itens na venda.');
  }

  const ids = items.map(item => validId(item?.productId, 'Produto'));

  const products = await db.query(`
    SELECT *
    FROM produtos
    WHERE id = ANY($1::bigint[])
    ORDER BY id
    FOR SHARE
  `, [ids]);

  const byId = new Map(
    products.rows.map(product => [String(product.id), product])
  );

  let totalCents = 0;

  const normalized = items.map((item, index) => {
    const product = byId.get(ids[index]);

    if (!product || !product.ativo) {
      fail('Um produto não está disponível. Atualize a lista.');
    }

    const quantity = Number(item.quantity);

    if (
      !Number.isInteger(quantity) ||
      quantity < 1 ||
      quantity > 10000
    ) {
      fail('A quantidade deve ser um número inteiro de 1 a 10000.');
    }

    const unitPrice = validMoney(item.unitPrice ?? product.preco);

    totalCents += Math.round(unitPrice * 100) * quantity;

    if (
      !Number.isSafeInteger(totalCents) ||
      totalCents > 9999999999
    ) {
      fail('O total da venda não pode ultrapassar R$ 99.999.999,99.');
    }

    return { product, quantity, unitPrice };
  });

  for (const item of normalized) {
    await db.query(`
      INSERT INTO venda_itens(
        venda_id,
        produto_id,
        produto_nome,
        quantidade,
        valor_unitario
      )
      VALUES($1, $2, $3, $4, $5)
    `, [
      saleId,
      item.product.id,
      item.product.nome,
      item.quantity,
      item.unitPrice
    ]);
  }
}

// Histórico com filtros por data, cliente, produto e situação.

app.get('/api/sales', auth, asyncHandler(async (req, res) => {
  const [start, end] = salesRange(req.query);

  const filters = {
    clientId: req.query.clientId
      ? validId(req.query.clientId, 'Cliente')
      : null,
    productId: req.query.productId
      ? validId(req.query.productId, 'Produto')
      : null,
    status: req.query.status || null
  };

  if (
    filters.status &&
    !['Confirmada', 'Cancelada'].includes(filters.status)
  ) {
    fail('Status inválido.');
  }

  res.set('Cache-Control', 'no-store');
  res.json(await readSales(pool, start, end, null, filters));
}));

// Registra uma venda para cliente já cadastrado.

app.post('/api/sales', auth, asyncHandler(async (req, res) => {
  const body = req.body || {};
  const clientId = validId(body.clientId, 'Cliente');
  const date = validDate(body.date);
  const status = body.status ?? 'Confirmada';

  if (!['Confirmada', 'Cancelada'].includes(status)) {
    fail('Status da venda inválido.');
  }

  const sale = await transaction(async db => {
    const customer = await db.query(`
      SELECT id
      FROM clientes
      WHERE id = $1 AND ativo = TRUE
      FOR SHARE
    `, [clientId]);

    if (!customer.rowCount) {
      fail('Escolha um cliente cadastrado e ativo.');
    }

    const inserted = await db.query(`
      INSERT INTO vendas(
        cliente_id, data, status, observacao, criado_por
      )
      VALUES($1, $2, $3, $4, $5)
      RETURNING id
    `, [
      clientId,
      date,
      status,
      String(body.note || '').trim(),
      req.user.id
    ]);

    const id = inserted.rows[0].id;

    await insertSaleItems(db, id, body.items);

    return (await readSales(db, null, null, id))[0];
  });

  res.status(201).json(sale);
}));

// Edita data, cliente, observação, situação e itens de uma venda.

app.patch('/api/sales/:id', auth, asyncHandler(async (req, res) => {
  const id = validId(req.params.id, 'Venda');
  const body = req.body || {};

  const sale = await transaction(async db => {
    const current = await db.query(
      'SELECT * FROM vendas WHERE id = $1 FOR UPDATE',
      [id]
    );

    if (!current.rowCount) fail('Venda não encontrada.', 404);

    const previous = current.rows[0];

    const clientId = validId(
      body.clientId ?? previous.cliente_id,
      'Cliente'
    );

    const date = validDate(body.date ?? previous.data);
    const status = body.status ?? previous.status;

    if (!['Confirmada', 'Cancelada'].includes(status)) {
      fail('Status da venda inválido.');
    }

    const customer = await db.query(
      'SELECT id, ativo FROM clientes WHERE id = $1 FOR SHARE',
      [clientId]
    );

    if (
      !customer.rowCount ||
      (
        !customer.rows[0].ativo &&
        clientId !== String(previous.cliente_id)
      )
    ) {
      fail('Cliente inválido.');
    }

    await db.query(`
      UPDATE vendas
      SET cliente_id = $1,
          data = $2,
          status = $3,
          observacao = $4,
          updated_by = $5,
          updated_at = NOW()
      WHERE id = $6
    `, [
      clientId,
      date,
      status,
      String(body.note ?? previous.observacao ?? '').trim(),
      req.user.id,
      id
    ]);

    if (body.items !== undefined) {
      await db.query(
        'DELETE FROM venda_itens WHERE venda_id = $1',
        [id]
      );

      await insertSaleItems(db, id, body.items);
    }

    return (await readSales(db, null, null, id))[0];
  });

  res.json(sale);
}));

// Cancela ou confirma sem apagar o histórico.

app.patch('/api/sales/:id/status', auth, asyncHandler(async (req, res) => {
  const id = validId(req.params.id, 'Venda');
  const status = req.body?.status;

  if (!['Confirmada', 'Cancelada'].includes(status)) {
    fail('Status da venda inválido.');
  }

  const result = await pool.query(`
    UPDATE vendas
    SET status = $1,
        updated_by = $2,
        updated_at = NOW()
    WHERE id = $3
    RETURNING id
  `, [status, req.user.id, id]);

  if (!result.rowCount) fail('Venda não encontrada.', 404);

  res.json({ ok: true });
}));

// =====================================================
// FINANCEIRO
//
// Mantém a regra atual dos serviços:
// agendamentos não cancelados entram no total.
//
// Produtos: somente vendas confirmadas.
// Não soma a tabela atendimentos novamente.
// =====================================================

async function financialData(start, end) {
  const result = await pool.query(`
    WITH servicos AS (
      SELECT
        COALESCE(
          SUM(valor) FILTER (WHERE status <> 'Cancelado'),
          0
        ) AS total,
        COUNT(*) FILTER (
          WHERE status <> 'Cancelado'
        )::int AS quantidade
      FROM agendamentos
      WHERE data BETWEEN $1::date AND $2::date
    ),
    vendas_por_id AS (
      SELECT
        v.id,
        COALESCE(
          SUM(i.quantidade * i.valor_unitario),
          0
        ) AS total
      FROM vendas v
      LEFT JOIN venda_itens i ON i.venda_id = v.id
      WHERE v.data BETWEEN $1::date AND $2::date
        AND v.status = 'Confirmada'
      GROUP BY v.id
    )
    SELECT
      servicos.total AS servicos_total,
      servicos.quantidade,
      COALESCE(
        (SELECT SUM(total) FROM vendas_por_id),
        0
      ) AS produtos_total,
      (
        SELECT COUNT(*)::int FROM vendas_por_id
      ) AS vendas_quantidade,
      servicos.total + COALESCE(
        (SELECT SUM(total) FROM vendas_por_id),
        0
      ) AS total
    FROM servicos
  `, [start, end]);

  const row = result.rows[0];

  return {
    start,
    end,
    serviceRevenue: Number(row.servicos_total),
    productRevenue: Number(row.produtos_total),
    revenue: Number(row.total),
    totalRevenue: Number(row.total),
    appointmentCount: row.quantidade,
    salesCount: row.vendas_quantidade
  };
}

function lastDayOfMonth(date) {
  const [year, month] = date.split('-').map(Number);

  const day = String(
    new Date(Date.UTC(year, month, 0)).getUTCDate()
  ).padStart(2, '0');

  return date.slice(0, 7) + '-' + day;
}

app.get('/api/financial/summary', auth, asyncHandler(async (req, res) => {
  const today = salonToday();

  const day = new Date(today + 'T12:00:00Z');
  day.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7));

  const weekStart = day.toISOString().slice(0, 10);

  day.setUTCDate(day.getUTCDate() + 6);
  const weekEnd = day.toISOString().slice(0, 10);

  const [start, end] = salesRange(req.query);

  if ((start && !end) || (!start && end)) {
    fail('Informe as duas datas do período.');
  }

  const [daily, week, month, year, period] = await Promise.all([
    financialData(today, today),
    financialData(weekStart, weekEnd),
    financialData(
      today.slice(0, 7) + '-01',
      lastDayOfMonth(today)
    ),
    financialData(
      today.slice(0, 4) + '-01-01',
      today.slice(0, 4) + '-12-31'
    ),
    start ? financialData(start, end) : Promise.resolve(null)
  ]);

  res.set('Cache-Control', 'no-store');

  res.json({
    today: daily,
    week,
    month,
    year,
    period
  });
}));

// =====================================================
// RELATÓRIOS
// =====================================================

async function reportData(type, date, month, year) {
  const today = salonToday();

  let start;
  let end;
  let label;

  if (type === 'month') {
    const selected = String(month || today.slice(0, 7));

    if (!/^\d{4}-\d{2}$/.test(selected)) fail('Mês inválido.');

    start = validDate(selected + '-01');
    end = lastDayOfMonth(start);
    label = 'Mensal - ' + selected;
  } else if (type === 'year') {
    const selected = String(year || today.slice(0, 4));

    if (!/^\d{4}$/.test(selected)) fail('Ano inválido.');

    start = validDate(selected + '-01-01');
    end = validDate(selected + '-12-31');
    label = 'Anual - ' + selected;
  } else if (type === 'day') {
    start = validDate(date || today);
    end = start;
    label = 'Diário - ' + start;
  } else {
    fail('Tipo de relatório inválido.');
  }

  const [result, financial, sales] = await Promise.all([
    pool.query(`
      SELECT
        a.id, a.data, a.hora, a.valor, a.status, a.observacao,
        c.nome AS cliente, c.telefone,
        p.nome AS procedimento,
        c.observacao AS cliente_observacao
      FROM agendamentos a
      JOIN clientes c ON c.id = a.cliente_id
      JOIN procedimentos p ON p.id = a.procedimento_id
      WHERE a.data BETWEEN $1::date AND $2::date
      ORDER BY a.data, a.hora
    `, [start, end]),
    financialData(start, end),
    readSales(pool, start, end)
  ]);

  const data = result.rows.map(row => ({
    ...row,
    valor: Number(row.valor)
  }));

  const valid = data.filter(row => row.status !== 'Cancelado');

  return {
    ...financial,
    data,
    sales,
    count: data.length,
    attended: data.filter(row => row.status === 'Atendido').length,
    canceled: data.filter(row => row.status === 'Cancelado').length,
    pending: data.filter(
      row => !['Atendido', 'Cancelado'].includes(row.status)
    ).length,
    ticket: valid.length
      ? financial.serviceRevenue / valid.length
      : 0,
    salesTicket: financial.salesCount
      ? financial.productRevenue / financial.salesCount
      : 0,
    label,
    start,
    end
  };
}

app.get('/api/reports/summary', auth, requireAdmin, asyncHandler(async (_req, res) => {
  const today = salonToday();

  const [day, month, year] = await Promise.all([
    reportData('day', today),
    reportData('month', null, today.slice(0, 7)),
    reportData('year', null, null, today.slice(0, 4))
  ]);

  res.json({ today: day, month, year });
}));

app.get('/api/reports', auth, requireAdmin, asyncHandler(async (req, res) => {
  res.json(await reportData(
    req.query.type || 'month',
    req.query.date,
    req.query.month,
    req.query.year
  ));
}));

// =====================================================
// RELATÓRIOS PDF
// =====================================================

app.get('/api/reports/pdf', auth, requireAdmin, asyncHandler(async (req, res) => {
  const report = await reportData(
    req.query.type || 'day',
    req.query.date,
    req.query.month,
    req.query.year
  );

  const safeName = report.label.replace(/[^a-z0-9_-]+/gi, '_');

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="Relatorio_${safeName}.pdf"`
  );

  const doc = new PDFDocument({ size: 'A4', margin: 40 });

  doc.on('error', error => {
    console.error('Erro no PDF:', error);
    res.destroy();
  });

  doc.pipe(res);

  const currency = value =>
    'R$ ' + Number(value).toFixed(2).replace('.', ',');

  const formatted = value =>
    String(value).slice(0, 10).split('-').reverse().join('/');

  doc.fontSize(20).text('AgendaPro');
  doc.fontSize(11).text('Atendimentos e vendas de produtos');
  doc.moveDown();

  doc.fontSize(13).text(report.label);
  doc.moveDown();

  doc.fontSize(10).text(
    'Atendimentos não cancelados: ' + currency(report.serviceRevenue)
  );

  doc.text('Vendas confirmadas: ' + currency(report.productRevenue));
  doc.text('Total combinado: ' + currency(report.revenue));

  doc.text(
    `Atendimentos: ${report.count} | Realizados: ${report.attended} | ` +
    `Pendentes: ${report.pending} | Cancelados: ${report.canceled}`
  );

  doc.text('Vendas confirmadas: ' + report.salesCount);
  doc.text('Ticket médio dos atendimentos: ' + currency(report.ticket));
  doc.moveDown();

  doc.fontSize(13).text('Procedimentos');
  doc.fontSize(10);

  const counts = {};

  for (const item of report.data.filter(row => row.status !== 'Cancelado')) {
    counts[item.procedimento] = (counts[item.procedimento] || 0) + 1;
  }

  for (const [name, count] of Object.entries(counts)) {
    doc.text(`${name}: ${count}`);
  }

  doc.moveDown();
  doc.fontSize(13).text('Atendimentos');
  doc.moveDown(0.5);

  if (!report.data.length) {
    doc.fontSize(10).text('Nenhum atendimento no período.');
  }

  for (const item of report.data) {
    if (doc.y > 680) doc.addPage();

    doc.fontSize(10).text(item.cliente);

    doc.fontSize(9).text(
      `${formatted(item.data)} às ${String(item.hora).slice(0, 5)} | ` +
      `${item.telefone || '-'}`
    );

    doc.text(
      `${item.procedimento} | ${currency(item.valor)} | ${item.status}`
    );

    doc.text(
      'Observação: ' +
      (item.observacao || item.cliente_observacao || '-')
    );

    doc.moveDown();
  }

  doc.addPage();
  doc.fontSize(16).text('Vendas de produtos');
  doc.moveDown();

  if (!report.sales.length) {
    doc.fontSize(10).text('Nenhuma venda no período.');
  }

  for (const sale of report.sales) {
    if (doc.y > 660) doc.addPage();

    doc.fontSize(11).text(`Venda ${sale.id} - ${sale.name}`);

    doc.fontSize(9).text(
      `${formatted(sale.date)} | ${sale.phone} | ${sale.status}`
    );

    for (const item of sale.items) {
      if (doc.y > 720) doc.addPage();

      doc.text(
        `${item.name} | ${item.quantity} x ${currency(item.unitPrice)} ` +
        `= ${currency(item.total)}`
      );
    }

    doc.text('Total da venda: ' + currency(sale.total));
    doc.text('Observação: ' + (sale.note || '-'));
    doc.moveDown();
  }

  doc.fontSize(7).text(
    'Gerado em ' +
    new Date().toLocaleString('pt-BR', {
      timeZone: 'America/Sao_Paulo'
    })
  );

  doc.end();
}));

// =====================================================
// FRONTEND E ERROS
// =====================================================

app.get('/', (_req, res) => {
  res.sendFile(path.join(frontend, 'index.html'));
});

app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'Rota não encontrada.' });
  }

  res.sendFile(path.join(frontend, 'index.html'));
});

app.use((error, _req, res, _next) => {
  console.error('Erro no AgendaPro:', error);

  if (res.headersSent) return res.end();

  if (error.code === '23505') {
    return res.status(409).json({
      error: 'Já existe um registro com esses dados.'
    });
  }

  if (error.code === '23503') {
    return res.status(409).json({
      error: 'Registro vinculado a outros dados. Atualize a lista e tente novamente.'
    });
  }

  if (error instanceof multer.MulterError) {
    return res.status(400).json({
      error: error.code === 'LIMIT_FILE_SIZE'
        ? 'A foto deve ter no máximo 5 MB.'
        : 'Não foi possível receber a foto.'
    });
  }

  const status = Number(error.status) || 500;

  res.status(status).json({
    error: status >= 500
      ? 'Não foi possível concluir a operação. Tente novamente.'
      : error.message
  });
});

// =====================================================
// PREPARAÇÃO DO BANCO
// =====================================================

async function ensureSchema() {
  const schemaPath = path.join(__dirname, '../sql/schema.sql');

  if (!fs.existsSync(schemaPath)) {
    throw new Error(`Arquivo schema.sql não encontrado em: ${schemaPath}`);
  }

  await pool.query(fs.readFileSync(schemaPath, 'utf8'));

  await pool.query(`
    CREATE TABLE IF NOT EXISTS configuracoes_agenda (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      dados JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    INSERT INTO configuracoes_agenda(id, dados)
    VALUES(1, $1::jsonb)
    ON CONFLICT(id) DO NOTHING
  `, [JSON.stringify(defaultOpeningHours())]);

  // Cria as estruturas novas sem apagar os dados existentes.

  await pool.query(`
    ALTER TABLE atendimentos
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ
      NOT NULL DEFAULT NOW();

    CREATE TABLE IF NOT EXISTS produtos (
      id BIGSERIAL PRIMARY KEY,
      nome VARCHAR(150) NOT NULL UNIQUE,
      descricao TEXT,
      foto_url TEXT,
      preco NUMERIC(10,2) NOT NULL DEFAULT 0,
      ativo BOOLEAN NOT NULL DEFAULT TRUE,

      criado_por BIGINT
        REFERENCES usuarios(id)
        ON DELETE SET NULL,

      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

      CONSTRAINT produtos_nome_check
        CHECK (LENGTH(BTRIM(nome)) > 0),

      CONSTRAINT produtos_preco_check
        CHECK (preco >= 0 AND preco <= 99999999.99)
    );

    ALTER TABLE produtos
      ADD COLUMN IF NOT EXISTS foto_url TEXT;

    CREATE TABLE IF NOT EXISTS vendas (
      id BIGSERIAL PRIMARY KEY,

      cliente_id BIGINT NOT NULL
        REFERENCES clientes(id)
        ON DELETE RESTRICT,

      data DATE NOT NULL,
      status VARCHAR(30) NOT NULL DEFAULT 'Confirmada',
      observacao TEXT,

      criado_por BIGINT
        REFERENCES usuarios(id)
        ON DELETE SET NULL,

      updated_by BIGINT
        REFERENCES usuarios(id)
        ON DELETE SET NULL,

      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

      CONSTRAINT vendas_status_check
        CHECK (status IN ('Confirmada', 'Cancelada'))
    );

    CREATE TABLE IF NOT EXISTS venda_itens (
      id BIGSERIAL PRIMARY KEY,

      venda_id BIGINT NOT NULL
        REFERENCES vendas(id)
        ON DELETE CASCADE,

      produto_id BIGINT NOT NULL
        REFERENCES produtos(id)
        ON DELETE RESTRICT,

      produto_nome VARCHAR(150) NOT NULL,
      quantidade INTEGER NOT NULL DEFAULT 1,
      valor_unitario NUMERIC(10,2) NOT NULL,

      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

      CONSTRAINT venda_itens_nome_check
        CHECK (LENGTH(BTRIM(produto_nome)) > 0),

      CONSTRAINT venda_itens_quantidade_check
        CHECK (quantidade > 0),

      CONSTRAINT venda_itens_valor_check
        CHECK (
          valor_unitario >= 0
          AND valor_unitario <= 99999999.99
        )
    );

    CREATE INDEX IF NOT EXISTS idx_produtos_ativo_nome
      ON produtos(ativo, nome);

    CREATE INDEX IF NOT EXISTS idx_vendas_data
      ON vendas(data);

    CREATE INDEX IF NOT EXISTS idx_vendas_cliente
      ON vendas(cliente_id);

    CREATE INDEX IF NOT EXISTS idx_vendas_status_data
      ON vendas(status, data);

    CREATE INDEX IF NOT EXISTS idx_venda_itens_venda
      ON venda_itens(venda_id);

    CREATE INDEX IF NOT EXISTS idx_venda_itens_produto
      ON venda_itens(produto_id);
  `);

  console.log('Banco de dados verificado e preparado.');
}

// =====================================================
// INICIALIZAÇÃO
// =====================================================

async function startServer() {
  try {
    await ensureSchema();

    app.listen(PORT, '0.0.0.0', () => {
      console.log(`AgendaPro rodando na porta ${PORT}`);
      console.log(`Ambiente: ${process.env.NODE_ENV || 'development'}`);
    });
  } catch (error) {
    console.error('ERRO AO INICIAR O AGENDAPRO');
    console.error(error);
    process.exit(1);
  }
}

startServer();