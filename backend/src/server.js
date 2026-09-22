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
  console.error('========================================');
  console.error('ERRO: JWT_SECRET não configurado.');
  console.error('Configure JWT_SECRET no Render.');
  console.error('========================================');
  process.exit(1);
}

if (!process.env.DATABASE_URL) {
  console.error('========================================');
  console.error('ERRO: DATABASE_URL não configurada.');
  console.error('Configure DATABASE_URL no Render.');
  console.error('========================================');
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
  ssl:
    process.env.NODE_ENV === 'production'
      ? { rejectUnauthorized: false }
      : undefined
});

pool.on('error', (error) => {
  console.error('Erro inesperado no PostgreSQL:', error);
});

app.use(
  helmet({
    contentSecurityPolicy: false
  })
);

app.use(cookieParser());

app.use(
  express.json({
    limit: '2mb'
  })
);

app.use(
  express.urlencoded({
    extended: true,
    limit: '2mb'
  })
);

app.use('/uploads', express.static(uploadDir));

app.use(express.static(frontend));

/* =========================================================
   UTILITÁRIOS
========================================================= */

const asyncHandler =
  (fn) =>
  (req, res, next) =>
    Promise.resolve(fn(req, res, next)).catch(next);

function normalizePhone(value = '') {
  return String(value).trim().replace(/\D/g, '');
}

function signUser(user) {
  return jwt.sign(
    {
      id: user.id,
      role: user.perfil,
      name: user.nome
    },
    JWT_SECRET,
    {
      expiresIn: '8h'
    }
  );
}

function auth(req, res, next) {
  try {
    const token = req.cookies?.agendapro_token;

    if (!token) {
      return res.status(401).json({
        error: 'Não autenticado.'
      });
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

function publicClient(client) {
  return {
    id: client.id,
    name: client.nome,
    phone: client.telefone,
    photo: client.foto_url,
    note: client.observacao
  };
}

function publicAppointment(appointment) {
  return {
    id: appointment.id,
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

/* =========================================================
   HORÁRIOS DE ATENDIMENTO
========================================================= */

function defaultOpeningHours() {
  return {
    slots: Array.from(
      { length: 12 },
      (_, index) =>
        `${String(index + 8).padStart(2, '0')}:00`
    )
  };
}

function openingMinutes(value) {
  if (
    typeof value !== 'string' ||
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)
  ) {
    return null;
  }

  const [hour, minute] = value.split(':').map(Number);

  return hour * 60 + minute;
}

function openingWeekday(date) {
  if (
    typeof date !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(date)
  ) {
    return null;
  }

  const value = new Date(date + 'T12:00:00Z');

  if (
    Number.isNaN(value.getTime()) ||
    value.toISOString().slice(0, 10) !== date
  ) {
    return null;
  }

  return value.getUTCDay();
}

function openingSlots(settings, date) {
  const weekday = openingWeekday(date);

  if (weekday === null) {
    return [];
  }

  // A lista personalizada se repete em todos os dias.
  if (Array.isArray(settings.slots)) {
    return [...settings.slots];
  }

  // Compatibilidade com a configuração anterior,
  // até o administrador salvar a nova lista.
  const day = settings.days[weekday];

  if (!day.open) {
    return [];
  }

  const start = openingMinutes(day.start);
  const end = openingMinutes(day.end);
  const pauseStart = openingMinutes(day.breakStart);
  const pauseEnd = openingMinutes(day.breakEnd);

  const ranges =
    pauseStart === null
      ? [[start, end]]
      : [
          [start, pauseStart],
          [pauseEnd, end]
        ];

  const slots = [];

  for (const [from, until] of ranges) {
    for (
      let minute = from;
      minute + settings.interval <= until;
      minute += settings.interval
    ) {
      const hourText = String(
        Math.floor(minute / 60)
      ).padStart(2, '0');

      const minuteText = String(
        minute % 60
      ).padStart(2, '0');

      slots.push(`${hourText}:${minuteText}`);
    }
  }

  return slots;
}

function validateOpeningHours(value) {
  const fail = (message) => {
    const error = new Error(message);
    error.status = 400;
    throw error;
  };

  // Novo formato: horários individuais iguais para todos os dias.
  if (
    value &&
    Object.prototype.hasOwnProperty.call(value, 'slots')
  ) {
    if (
      !Array.isArray(value.slots) ||
      value.slots.length > 1440
    ) {
      fail('Informe uma lista de até 1440 horários.');
    }

    if (
      value.slots.some(
        time => openingMinutes(time) === null
      )
    ) {
      fail('Preencha cada horário no formato HH:mm.');
    }

    if (
      new Set(value.slots).size !== value.slots.length
    ) {
      fail(
        'Existem horários repetidos. Remova a repetição antes de salvar.'
      );
    }

    return {
      slots: [...value.slots].sort()
    };
  }

  // Compatibilidade com o formato anterior.
  if (
    !value ||
    !Number.isInteger(value.interval) ||
    value.interval < 5 ||
    value.interval > 240
  ) {
    fail(
      'O intervalo deve ser um número inteiro de 5 a 240 minutos.'
    );
  }

  if (
    !Array.isArray(value.days) ||
    value.days.length !== 7
  ) {
    fail('Configure os sete dias da semana.');
  }

  const labels = [
    'Domingo',
    'Segunda-feira',
    'Terça-feira',
    'Quarta-feira',
    'Quinta-feira',
    'Sexta-feira',
    'Sábado'
  ];

  const days = value.days.map((day, index) => {
    if (!day || typeof day.open !== 'boolean') {
      fail(
        `${labels[index]}: informe se o dia está aberto.`
      );
    }

    const start = openingMinutes(day.start);
    const end = openingMinutes(day.end);

    if (start === null || end === null) {
      fail(
        `${labels[index]}: informe horários válidos.`
      );
    }

    const breakStart = day.breakStart ?? '';
    const breakEnd = day.breakEnd ?? '';

    const pauseStart = openingMinutes(breakStart);
    const pauseEnd = openingMinutes(breakEnd);

    if (
      (breakStart !== '' || breakEnd !== '') &&
      (pauseStart === null || pauseEnd === null)
    ) {
      fail(
        `${labels[index]}: preencha o início e o fim da pausa, ou deixe ambos vazios.`
      );
    }

    if (day.open && end <= start) {
      fail(
        `${labels[index]}: o fechamento deve ser depois da abertura, no mesmo dia.`
      );
    }

    if (
      day.open &&
      pauseStart !== null &&
      !(
        start < pauseStart &&
        pauseStart < pauseEnd &&
        pauseEnd < end
      )
    ) {
      fail(
        `${labels[index]}: a pausa deve começar e terminar dentro do expediente.`
      );
    }

    const normalized = {
      open: day.open,
      start: day.start,
      end: day.end,
      breakStart,
      breakEnd
    };

    if (day.open) {
      const ranges =
        pauseStart === null
          ? [[start, end]]
          : [
              [start, pauseStart],
              [pauseEnd, end]
            ];

      if (
        !ranges.some(
          ([from, until]) =>
            until - from >= value.interval
        )
      ) {
        fail(
          `${labels[index]}: o expediente precisa comportar pelo menos um intervalo completo.`
        );
      }
    }

    return normalized;
  });

  return {
    interval: value.interval,
    days
  };
}

async function readOpeningHours(
  database = pool,
  lock = false
) {
  const result = await database.query(
    'SELECT dados FROM configuracoes_agenda WHERE id = 1' +
    (lock ? ' FOR SHARE' : '')
  );

  if (!result.rowCount) {
    throw new Error(
      'Horários de atendimento não configurados.'
    );
  }

  return result.rows[0].dados;
}

async function assertOpeningSlot(
  database,
  date,
  time
) {
  const settings = await readOpeningHours(
    database,
    true
  );

  if (
    openingWeekday(date) === null ||
    !openingSlots(settings, date).includes(time)
  ) {
    const error = new Error(
      'Horário não disponível na lista de atendimento. Atualize a agenda e escolha um horário disponível.'
    );

    error.status = 400;

    throw error;
  }
}

app.get(
  '/api/opening-hours',
  asyncHandler(async (_req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(await readOpeningHours());
  })
);

app.put(
  '/api/opening-hours',
  auth,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const settings = validateOpeningHours(req.body);

    await pool.query(
      `
      UPDATE configuracoes_agenda
      SET dados = $1::jsonb,
          updated_at = NOW()
      WHERE id = 1
      `,
      [JSON.stringify(settings)]
    );

    res.json(settings);
  })
);

/* =========================================================
   UPLOAD DE FOTOS
========================================================= */

const storage = multer.diskStorage({
  destination: (_req, _file, callback) => {
    callback(null, uploadDir);
  },

  filename: (_req, file, callback) => {
    const ext =
      path.extname(file.originalname).toLowerCase() ||
      '.jpg';

    const safeName =
      `${Date.now()}-` +
      `${Math.random().toString(36).slice(2, 10)}` +
      ext;

    callback(null, safeName);
  }
});

const upload = multer({
  storage,

  limits: {
    fileSize: 5 * 1024 * 1024
  },

  fileFilter: (_req, file, callback) => {
    if (
      /^image\/(jpeg|png|webp|gif)$/.test(file.mimetype)
    ) {
      callback(null, true);
      return;
    }

    callback(
      new Error(
        'A foto deve ser JPG, PNG, WEBP ou GIF.'
      )
    );
  }
});

/* =========================================================
   STATUS / HEALTH
========================================================= */

app.get('/api/status', (_req, res) => {
  res.json({
    status: 'Servidor AgendaPro rodando com sucesso!'
  });
});

app.get(
  '/api/health',
  asyncHandler(async (_req, res) => {
    await pool.query('SELECT 1');

    res.json({
      ok: true,
      service: 'AgendaPro',
      database: 'connected'
    });
  })
);

/* =========================================================
   AUTENTICAÇÃO
========================================================= */

app.post(
  '/api/auth/login',
  asyncHandler(async (req, res) => {
    const {
      email,
      password,
      role
    } = req.body || {};

    if (!email || !password || !role) {
      return res.status(400).json({
        error: 'Informe e-mail, senha e perfil.'
      });
    }

    if (
      !['admin', 'funcionario'].includes(role)
    ) {
      return res.status(400).json({
        error: 'Perfil inválido.'
      });
    }

    const result = await pool.query(
      `
      SELECT *
      FROM usuarios
      WHERE LOWER(email) = LOWER($1)
        AND perfil = $2
        AND ativo = true
      LIMIT 1
      `,
      [
        String(email).trim(),
        role
      ]
    );

    const user = result.rows[0];

    if (
      !user ||
      !(await bcrypt.compare(
        String(password),
        user.senha_hash
      ))
    ) {
      return res.status(401).json({
        error: 'E-mail, perfil ou senha incorretos.'
      });
    }

    const token = signUser(user);

    res.cookie('agendapro_token', token, {
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
  })
);

app.post('/api/auth/logout', (_req, res) => {
  res.clearCookie('agendapro_token', {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production'
  });

  res.json({
    ok: true
  });
});

app.get(
  '/api/auth/me',
  auth,
  (req, res) => {
    res.json({
      user: {
        id: req.user.id,
        name: req.user.name,
        role: req.user.role
      }
    });
  }
);

/* =========================================================
   ALTERAÇÃO DE SENHA
========================================================= */

app.put(
  '/api/auth/password',
  auth,
  asyncHandler(async (req, res) => {
    const {
      currentPassword,
      newPassword
    } = req.body || {};

    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        error: 'Informe a senha atual e a nova senha.'
      });
    }

    if (String(newPassword).length < 6) {
      return res.status(400).json({
        error:
          'A nova senha deve ter pelo menos 6 caracteres.'
      });
    }

    const result = await pool.query(
      `
      SELECT *
      FROM usuarios
      WHERE id = $1
        AND ativo = true
      LIMIT 1
      `,
      [req.user.id]
    );

    const user = result.rows[0];

    if (!user) {
      return res.status(404).json({
        error: 'Usuário não encontrado.'
      });
    }

    const valid = await bcrypt.compare(
      String(currentPassword),
      user.senha_hash
    );

    if (!valid) {
      return res.status(400).json({
        error: 'Senha atual incorreta.'
      });
    }

    const hash = await bcrypt.hash(
      String(newPassword),
      12
    );

    await pool.query(
      `
      UPDATE usuarios
      SET senha_hash = $1,
          updated_at = NOW()
      WHERE id = $2
      `,
      [
        hash,
        req.user.id
      ]
    );

    res.json({
      ok: true
    });
  })
);

/* =========================================================
   PROCEDIMENTOS
========================================================= */

app.get(
  '/api/procedures',
  asyncHandler(async (_req, res) => {
    const result = await pool.query(
      `
      SELECT id, nome, preco, ativo
      FROM procedimentos
      WHERE ativo = true
      ORDER BY nome
      `
    );

    res.json(
      result.rows.map((procedure) => ({
        id: procedure.id,
        name: procedure.nome,
        price: Number(procedure.preco)
      }))
    );
  })
);

app.post(
  '/api/procedures',
  auth,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const {
      name,
      price
    } = req.body || {};

    const procedureName = String(
      name || ''
    ).trim();

    if (!procedureName) {
      return res.status(400).json({
        error: 'Informe o nome do procedimento.'
      });
    }

    const value = Number(price) || 0;

    try {
      const result = await pool.query(
        `
        INSERT INTO procedimentos(nome, preco)
        VALUES($1, $2)

        ON CONFLICT (nome)
        DO UPDATE SET
          preco = EXCLUDED.preco,
          ativo = true,
          updated_at = NOW()
        WHERE procedimentos.ativo = false

        RETURNING id, nome, preco
        `,
        [
          procedureName,
          value
        ]
      );

      if (!result.rowCount) {
        return res.status(409).json({
          error: 'Este procedimento já está cadastrado e ativo.'
        });
      }

      const procedure = result.rows[0];

      res.status(201).json({
        id: procedure.id,
        name: procedure.nome,
        price: Number(procedure.preco)
      });
    } catch (error) {
      if (error.code === '23505') {
        return res.status(409).json({
          error: 'Este procedimento já existe.'
        });
      }

      throw error;
    }
  })
);

app.delete(
  '/api/procedures/:id',
  auth,
  requireAdmin,
  asyncHandler(async (req, res) => {
    await pool.query(
      `
      UPDATE procedimentos
      SET ativo = false,
          updated_at = NOW()
      WHERE id = $1
      `,
      [req.params.id]
    );

    res.json({
      ok: true
    });
  })
);

/* =========================================================
   CLIENTES
========================================================= */

app.get(
  '/api/clients',
  auth,
  asyncHandler(async (req, res) => {
    const q = String(
      req.query.q || ''
    ).trim();

    const result = await pool.query(
      `
      SELECT
        c.*,
        COUNT(a.id)::int AS count,
        COALESCE(
          SUM(
            CASE
              WHEN a.status <> 'Cancelado'
              THEN a.valor
              ELSE 0
            END
          ),
          0
        ) AS total,
        MAX(a.data) AS last
      FROM clientes c
      LEFT JOIN agendamentos a
        ON a.cliente_id = c.id
      WHERE c.ativo = true
        AND (
          $1 = ''
          OR c.nome ILIKE '%' || $1 || '%'
          OR c.telefone ILIKE '%' || $1 || '%'
        )
      GROUP BY c.id
      ORDER BY
        MAX(a.data) DESC NULLS LAST,
        c.nome
      `,
      [q]
    );

    res.json(
      result.rows.map((client) => ({
        ...publicClient(client),
        count: client.count,
        total: Number(client.total),
        last: client.last
      }))
    );
  })
);

app.post(
  '/api/clients',
  auth,
  upload.single('photo'),
  asyncHandler(async (req, res) => {
    const name = String(
      req.body.name || ''
    ).trim();

    const phone = normalizePhone(
      req.body.phone
    );

    const note = String(
      req.body.note || ''
    ).trim();

    if (!name || !phone) {
      return res.status(400).json({
        error: 'Nome e telefone são obrigatórios.'
      });
    }

    const photo = req.file
      ? `/uploads/${req.file.filename}`
      : null;

    const result = await pool.query(
      `
      INSERT INTO clientes(
        nome,
        telefone,
        foto_url,
        observacao
      )
      VALUES($1, $2, $3, $4)

      ON CONFLICT(telefone)
      DO UPDATE SET
        nome = EXCLUDED.nome,
        foto_url = COALESCE(
          EXCLUDED.foto_url,
          clientes.foto_url
        ),
        observacao = EXCLUDED.observacao,
        ativo = true,
        updated_at = NOW()

      RETURNING *
      `,
      [
        name,
        phone,
        photo,
        note
      ]
    );

    res.status(201).json(
      publicClient(result.rows[0])
    );
  })
);

app.delete(
  '/api/clients/:id',
  auth,
  asyncHandler(async (req, res) => {
    const clientId = String(req.params.id);

    if (
      !/^[1-9]\d*$/.test(clientId) ||
      BigInt(clientId) > 9223372036854775807n
    ) {
      return res.status(400).json({
        error: 'Identificador de cliente inválido.'
      });
    }

    // Remove da lista sem apagar agendamentos e relatórios.
    const result = await pool.query(
      `
      UPDATE clientes
      SET ativo = false,
          updated_at = NOW()
      WHERE id = $1
      RETURNING id
      `,
      [clientId]
    );

    if (!result.rowCount) {
      return res.status(404).json({
        error: 'Cliente não encontrado.'
      });
    }

    res.json({
      ok: true
    });
  })
);

/* =========================================================
   FUNÇÃO AUXILIAR DE CLIENTE
========================================================= */

async function upsertClient(
  client,
  clientInfo
) {
  const name = String(
    clientInfo.name || ''
  ).trim();

  const phone = normalizePhone(
    clientInfo.phone
  );

  const note = String(
    clientInfo.note || ''
  ).trim();

  if (!name || !phone) {
    const error = new Error(
      'Nome e telefone são obrigatórios.'
    );

    error.status = 400;

    throw error;
  }

  const photo =
    clientInfo.photo || null;

  const result = await client.query(
    `
    INSERT INTO clientes(
      nome,
      telefone,
      foto_url,
      observacao
    )
    VALUES($1, $2, $3, $4)

    ON CONFLICT(telefone)
    DO UPDATE SET
      nome = EXCLUDED.nome,
      foto_url = COALESCE(
        EXCLUDED.foto_url,
        clientes.foto_url
      ),
      observacao =
        CASE
          WHEN EXCLUDED.observacao <> ''
          THEN EXCLUDED.observacao
          ELSE clientes.observacao
        END,
      ativo = true,
      updated_at = NOW()

    RETURNING *
    `,
    [
      name,
      phone,
      photo,
      note
    ]
  );

  return result.rows[0];
}

/* =========================================================
   AGENDAMENTOS
========================================================= */

app.get(
  '/api/appointments',
  auth,
  asyncHandler(async (req, res) => {
    const date = String(
      req.query.date || ''
    );

    const params = [];
    let where = '';

    if (date) {
      params.push(date);
      where = 'WHERE a.data = $1';
    }

    const result = await pool.query(
      `
      SELECT
        a.*,
        c.nome,
        c.telefone,
        p.nome AS procedimento

      FROM agendamentos a

      JOIN clientes c
        ON c.id = a.cliente_id

      JOIN procedimentos p
        ON p.id = a.procedimento_id

      ${where}

      ORDER BY
        a.data,
        a.hora
      `,
      params
    );

    res.json(
      result.rows.map(publicAppointment)
    );
  })
);

app.post(
  '/api/appointments',
  auth,
  asyncHandler(async (req, res) => {
    const {
      name,
      phone,
      date,
      time,
      procedureId,
      price,
      status = 'Agendado',
      note = ''
    } = req.body || {};

    if (!date || !time || !procedureId) {
      return res.status(400).json({
        error:
          'Data, horário e procedimento são obrigatórios.'
      });
    }

    const client =
      await pool.connect();

    try {
      await client.query('BEGIN');

      await assertOpeningSlot(
        client,
        date,
        time
      );

      const customer =
        await upsertClient(
          client,
          {
            name,
            phone,
            note
          }
        );

      const procedure =
        await client.query(
          `
          SELECT id, nome, preco
          FROM procedimentos
          WHERE id = $1
            AND ativo = true
          `,
          [procedureId]
        );

      if (!procedure.rowCount) {
        const error = new Error(
          'Procedimento inválido.'
        );

        error.status = 400;

        throw error;
      }

      const value =
        Number(
          price ??
            procedure.rows[0].preco
        ) || 0;

      const result =
        await client.query(
          `
          INSERT INTO agendamentos(
            cliente_id,
            procedimento_id,
            data,
            hora,
            valor,
            status,
            observacao,
            criado_por
          )
          VALUES(
            $1,
            $2,
            $3,
            $4,
            $5,
            $6,
            $7,
            $8
          )
          RETURNING id
          `,
          [
            customer.id,
            procedure.rows[0].id,
            date,
            time,
            value,
            status,
            note,
            req.user.id
          ]
        );

      await client.query('COMMIT');

      const full =
        await pool.query(
          `
          SELECT
            a.*,
            c.nome,
            c.telefone,
            p.nome AS procedimento

          FROM agendamentos a

          JOIN clientes c
            ON c.id = a.cliente_id

          JOIN procedimentos p
            ON p.id = a.procedimento_id

          WHERE a.id = $1
          `,
          [result.rows[0].id]
        );

      res.status(201).json(
        publicAppointment(
          full.rows[0]
        )
      );
    } catch (error) {
      await client.query('ROLLBACK');

      if (error.code === '23505') {
        const conflict =
          new Error(
            'Este horário já está ocupado.'
          );

        conflict.status = 409;

        throw conflict;
      }

      throw error;
    } finally {
      client.release();
    }
  })
);

/* =========================================================
   HORÁRIOS PÚBLICOS
========================================================= */

app.get(
  '/api/public/slots',
  asyncHandler(async (req, res) => {
    const date = String(
      req.query.date || ''
    );

    if (openingWeekday(date) === null) {
      return res.status(400).json({
        error: 'Data inválida.'
      });
    }

    const settings =
      await readOpeningHours();

    const result = await pool.query(
      `
      SELECT hora
      FROM agendamentos
      WHERE data = $1
        AND status <> 'Cancelado'
      ORDER BY hora
      `,
      [date]
    );

    res.set('Cache-Control', 'no-store');

    res.json({
      date,
      slots: openingSlots(settings, date),
      taken: result.rows.map(
        (row) =>
          String(row.hora).slice(0, 5)
      )
    });
  })
);

/* =========================================================
   AGENDAMENTO PÚBLICO
========================================================= */

app.post(
  '/api/public/bookings',
  upload.single('photo'),
  asyncHandler(async (req, res) => {
    const {
      name,
      phone,
      date,
      time,
      procedureId,
      note = ''
    } = req.body || {};

    if (
      !name ||
      !phone ||
      !date ||
      !time ||
      !procedureId
    ) {
      return res.status(400).json({
        error:
          'Nome, telefone, data, horário e procedimento são obrigatórios.'
      });
    }

    const procedure =
      await pool.query(
        `
        SELECT id, nome, preco
        FROM procedimentos
        WHERE id = $1
          AND ativo = true
        `,
        [procedureId]
      );

    if (!procedure.rowCount) {
      return res.status(400).json({
        error: 'Procedimento inválido.'
      });
    }

    const client =
      await pool.connect();

    try {
      await client.query('BEGIN');

      await assertOpeningSlot(
        client,
        date,
        time
      );

      const customer =
        await upsertClient(
          client,
          {
            name,
            phone,
            note,
            photo: req.file
              ? `/uploads/${req.file.filename}`
              : null
          }
        );

      const result =
        await client.query(
          `
          INSERT INTO agendamentos(
            cliente_id,
            procedimento_id,
            data,
            hora,
            valor,
            status,
            observacao
          )
          VALUES(
            $1,
            $2,
            $3,
            $4,
            $5,
            'Agendado',
            $6
          )
          RETURNING id
          `,
          [
            customer.id,
            procedure.rows[0].id,
            date,
            time,
            Number(
              procedure.rows[0].preco
            ) || 0,
            note
          ]
        );

      await client.query('COMMIT');

      res.status(201).json({
        ok: true,
        id: result.rows[0].id,
        details:
          `${procedure.rows[0].nome} ` +
          `em ${date} às ` +
          `${String(time).slice(0, 5)}.`
      });
    } catch (error) {
      await client.query('ROLLBACK');

      if (error.code === '23505') {
        return res.status(409).json({
          error:
            'Esse horário acabou de ser ocupado. Escolha outro.'
        });
      }

      throw error;
    } finally {
      client.release();
    }
  })
);

/* =========================================================
   ALTERAÇÃO DE STATUS
========================================================= */

app.patch(
  '/api/appointments/:id/status',
  auth,
  asyncHandler(async (req, res) => {
    const status =
      req.body?.status;

    const validStatuses = [
      'Agendado',
      'Confirmado',
      'Atendido',
      'Cancelado'
    ];

    if (
      !validStatuses.includes(status)
    ) {
      return res.status(400).json({
        error: 'Status inválido.'
      });
    }

    const client =
      await pool.connect();

    try {
      await client.query('BEGIN');

      const result =
        await client.query(
          `
          UPDATE agendamentos
          SET status = $1,
              updated_at = NOW()
          WHERE id = $2
          RETURNING *
          `,
          [
            status,
            req.params.id
          ]
        );

      if (!result.rowCount) {
        const error = new Error(
          'Agendamento não encontrado.'
        );

        error.status = 404;

        throw error;
      }

      if (status === 'Atendido') {
        const appointment =
          result.rows[0];

        await client.query(
          `
          INSERT INTO atendimentos(
            agendamento_id,
            cliente_id,
            procedimento_id,
            data,
            valor,
            observacao,
            atendido_por
          )
          VALUES(
            $1,
            $2,
            $3,
            $4,
            $5,
            $6,
            $7
          )

          ON CONFLICT DO NOTHING
          `,
          [
            appointment.id,
            appointment.cliente_id,
            appointment.procedimento_id,
            appointment.data,
            appointment.valor,
            appointment.observacao,
            req.user.id
          ]
        );
      }

      await client.query('COMMIT');

      res.json({
        ok: true
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  })
);

/* =========================================================
   RELATÓRIOS
========================================================= */

async function reportData(
  type,
  date,
  month,
  year
) {
  let start;
  let end;
  let label;

  if (type === 'month') {
    const selectedMonth =
      month ||
      new Date()
        .toISOString()
        .slice(0, 7);

    const [
      selectedYear,
      selectedMonthNumber
    ] = selectedMonth
      .split('-')
      .map(Number);

    start =
      `${selectedYear}-` +
      `${String(
        selectedMonthNumber
      ).padStart(2, '0')}-01`;

    if (
      selectedMonthNumber === 12
    ) {
      end =
        `${selectedYear + 1}-01-01`;
    } else {
      end =
        `${selectedYear}-` +
        `${String(
          selectedMonthNumber + 1
        ).padStart(2, '0')}-01`;
    }

    label =
      `Mensal — ${selectedMonth}`;
  } else if (type === 'year') {
    const selectedYear =
      Number(year) ||
      new Date().getFullYear();

    start =
      `${selectedYear}-01-01`;

    end =
      `${selectedYear + 1}-01-01`;

    label =
      `Anual — ${selectedYear}`;
  } else {
    const selectedDate =
      date ||
      new Date()
        .toISOString()
        .slice(0, 10);

    start = selectedDate;

    const nextDay =
      new Date(
        `${selectedDate}T00:00:00Z`
      );

    nextDay.setUTCDate(
      nextDay.getUTCDate() + 1
    );

    end =
      nextDay
        .toISOString()
        .slice(0, 10);

    label =
      `Diário — ${selectedDate}`;
  }

  const result =
    await pool.query(
      `
      SELECT
        a.id,
        a.data,
        a.hora,
        a.valor,
        a.status,
        a.observacao,
        c.nome AS cliente,
        c.telefone,
        p.nome AS procedimento,
        c.observacao AS cliente_observacao

      FROM agendamentos a

      JOIN clientes c
        ON c.id = a.cliente_id

      JOIN procedimentos p
        ON p.id = a.procedimento_id

      WHERE a.data >= $1
        AND a.data < $2

      ORDER BY
        a.data,
        a.hora
      `,
      [
        start,
        end
      ]
    );

  const data =
    result.rows.map(
      (row) => ({
        ...row,
        valor: Number(row.valor)
      })
    );

  const validData =
    data.filter(
      (row) =>
        row.status !== 'Cancelado'
    );

  const revenue =
    validData.reduce(
      (total, row) =>
        total + row.valor,
      0
    );

  const attended =
    data.filter(
      (row) =>
        row.status === 'Atendido'
    ).length;

  const canceled =
    data.filter(
      (row) =>
        row.status === 'Cancelado'
    ).length;

  const pending =
    data.filter(
      (row) =>
        ![
          'Atendido',
          'Cancelado'
        ].includes(row.status)
    ).length;

  const ticket =
    validData.length
      ? revenue / validData.length
      : 0;

  return {
    data,
    revenue,
    count: data.length,
    attended,
    canceled,
    pending,
    ticket,
    label,
    start,
    end
  };
}

app.get(
  '/api/reports/summary',
  auth,
  requireAdmin,
  asyncHandler(async (_req, res) => {
    const today =
      new Date()
        .toISOString()
        .slice(0, 10);

    const month =
      today.slice(0, 7);

    const year =
      today.slice(0, 4);

    const [
      dayReport,
      monthReport,
      yearReport
    ] = await Promise.all([
      reportData(
        'day',
        today
      ),
      reportData(
        'month',
        null,
        month
      ),
      reportData(
        'year',
        null,
        null,
        year
      )
    ]);

    res.json({
      today: dayReport,
      month: monthReport,
      year: yearReport
    });
  })
);

app.get(
  '/api/reports',
  auth,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const result =
      await reportData(
        req.query.type || 'month',
        req.query.date,
        req.query.month,
        req.query.year
      );

    res.json(result);
  })
);

/* =========================================================
   RELATÓRIO PDF
========================================================= */

app.get(
  '/api/reports/pdf',
  auth,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const report =
      await reportData(
        req.query.type || 'day',
        req.query.date,
        req.query.month,
        req.query.year
      );

    const safeName =
      report.label.replace(
        /[^a-z0-9_-]+/gi,
        '_'
      );

    res.setHeader(
      'Content-Type',
      'application/pdf'
    );

    res.setHeader(
      'Content-Disposition',
      `attachment; filename="Relatorio_${safeName}.pdf"`
    );

    const doc =
      new PDFDocument({
        size: 'A4',
        margin: 40
      });

    doc.pipe(res);

    doc
      .fontSize(20)
      .text('AgendaPro');

    doc
      .fontSize(10)
      .text(
        'Relatório de atendimentos e faturamento'
      );

    doc.moveDown();

    doc
      .fontSize(13)
      .text(report.label);

    doc.moveDown();

    doc
      .fontSize(10)
      .text(
        `Faturamento: R$ ${report.revenue
          .toFixed(2)
          .replace('.', ',')}`
      );

    doc.text(
      `Registros: ${report.count}`
    );

    doc.text(
      `Atendidos: ${report.attended}`
    );

    doc.text(
      `Pendentes/Agendados: ${report.pending}`
    );

    doc.text(
      `Cancelados: ${report.canceled}`
    );

    doc.text(
      `Ticket médio: R$ ${report.ticket
        .toFixed(2)
        .replace('.', ',')}`
    );

    doc.moveDown();

    const procedures = {};

    for (const appointment of report.data) {
      procedures[
        appointment.procedimento
      ] =
        (procedures[
          appointment.procedimento
        ] || 0) + 1;
    }

    doc
      .fontSize(13)
      .text('Procedimentos');

    doc
      .fontSize(10);

    for (
      const [
        procedure,
        count
      ] of Object.entries(procedures)
    ) {
      doc.text(
        `${procedure}: ${count} atendimento(s)`
      );
    }

    doc.moveDown();

    doc
      .fontSize(13)
      .text(
        'Atendimentos das clientes'
      );

    doc.moveDown(0.5);

    if (!report.data.length) {
      doc
        .fontSize(10)
        .text(
          'Nenhum atendimento/agendamento encontrado no período.'
        );
    }

    for (
      let index = 0;
      index < report.data.length;
      index++
    ) {
      const appointment =
        report.data[index];

      if (doc.y > 700) {
        doc.addPage();
      }

      doc
        .fontSize(10)
        .text(
          `${index + 1}. ${appointment.cliente}`
        );

      doc
        .fontSize(8.5)
        .text(
          `Data: ${new Date(
            appointment.data +
              'T12:00:00'
          ).toLocaleDateString(
            'pt-BR'
          )}  Hora: ${String(
            appointment.hora
          ).slice(0, 5)}`
        );

      doc.text(
        `Telefone/WhatsApp: ${
          appointment.telefone || '-'
        }`
      );

      doc.text(
        `Procedimento: ${appointment.procedimento}`
      );

      doc.text(
        `Valor: R$ ${appointment.valor
          .toFixed(2)
          .replace('.', ',')}  ` +
          `Status: ${appointment.status}`
      );

      doc.text(
        `Observação: ${
          appointment.observacao ||
          appointment.cliente_observacao ||
          '-'
        }`
      );

      doc.moveDown();
    }

    doc
      .fontSize(7)
      .text(
        `Gerado em ${new Date().toLocaleString(
          'pt-BR'
        )}`
      );

    doc.end();
  })
);

/* =========================================================
   FRONTEND
========================================================= */

app.get('/', (_req, res) => {
  res.sendFile(
    path.join(
      frontend,
      'index.html'
    )
  );
});

app.use(
  (req, res, next) => {
    if (
      req.path.startsWith('/api/')
    ) {
      return next();
    }

    res.sendFile(
      path.join(
        frontend,
        'index.html'
      )
    );
  }
);

/* =========================================================
   ERROS
========================================================= */

app.use(
  (error, _req, res, _next) => {
    console.error(
      'Erro no AgendaPro:',
      error
    );

    const status =
      Number(error.status) || 500;

    res.status(status).json({
      error:
        error.message ||
        'Erro interno do servidor.'
    });
  }
);

/* =========================================================
   BANCO DE DADOS
========================================================= */

async function ensureSchema() {
  const schemaPath =
    path.join(
      __dirname,
      '../sql/schema.sql'
    );

  if (!fs.existsSync(schemaPath)) {
    throw new Error(
      `Arquivo schema.sql não encontrado em: ${schemaPath}`
    );
  }

  const schema =
    fs.readFileSync(
      schemaPath,
      'utf8'
    );

  await pool.query(schema);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS configuracoes_agenda (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      dados JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(
    `
    INSERT INTO configuracoes_agenda(id, dados)
    VALUES(1, $1::jsonb)
    ON CONFLICT(id) DO NOTHING
    `,
    [JSON.stringify(defaultOpeningHours())]
  );

  console.log(
    '✅ Banco de dados verificado/preparado.'
  );
}

/* =========================================================
   INICIALIZAÇÃO
========================================================= */

async function startServer() {
  try {
    await ensureSchema();

    app.listen(
      PORT,
      '0.0.0.0',
      () => {
        console.log(
          '========================================'
        );

        console.log(
          `🚀 AgendaPro rodando na porta ${PORT}`
        );

        console.log(
          `🌐 Ambiente: ${
            process.env.NODE_ENV ||
            'development'
          }`
        );

        console.log(
          '========================================'
        );
      }
    );
  } catch (error) {
    console.error(
      '========================================'
    );

    console.error(
      'ERRO AO INICIAR O AGENDAPRO'
    );

    console.error(
      '========================================'
    );

    console.error(error);

    process.exit(1);
  }
}

startServer();