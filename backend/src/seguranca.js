import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import jwt from 'jsonwebtoken';
import multer from 'multer';
import sharp from 'sharp';
import helmet from 'helmet';

export const production =
  process.env.NODE_ENV === 'production' ||
  process.env.RENDER === 'true';

export const cookieOptions = {
  httpOnly: true,
  sameSite: 'lax',
  secure: production,
  path: '/'
};

const hash = value =>
  crypto
    .createHash('sha256')
    .update(String(value))
    .digest('hex');

const wrap = fn => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

const problem = (message, status = 400) =>
  Object.assign(new Error(message), { status });

export function databaseOptions(connectionString) {
  const url = new URL(connectionString);

  for (const key of [
    'sslmode',
    'sslcert',
    'sslkey',
    'sslrootcert',
    'ssl'
  ]) {
    url.searchParams.delete(key);
  }

  const ca = process.env.PG_CA_CERT?.replace(/\\n/g, '\n');

  return {
    connectionString: url.toString(),
    ssl: production || ca
      ? {
          rejectUnauthorized: true,
          ...(ca ? { ca } : {})
        }
      : undefined,
    connectionTimeoutMillis: 10000,
    statement_timeout: 15000,
    idle_in_transaction_session_timeout: 15000
  };
}

export function installSecurity(
  app,
  pool,
  { secret, uploadDir, frontend }
) {
  if (
    !secret ||
    Buffer.byteLength(secret) < 32 ||
    secret === 'agendapro-dev-secret-change-me'
  ) {
    throw new Error(
      'Configure JWT_SECRET com pelo menos 32 caracteres aleatórios.'
    );
  }

  const originText =
    process.env.APP_ORIGIN ||
    process.env.RENDER_EXTERNAL_URL ||
    (
      production
        ? 'https://agendapro-wandame.onrender.com'
        : 'http://localhost:3000'
    );

  const originURL = new URL(originText);

  if (production && originURL.protocol !== 'https:') {
    throw new Error('APP_ORIGIN deve usar HTTPS.');
  }

  const origin = originURL.origin;
  const issuer = 'agendapro';
  const audience = origin;

  const limit = (
    scope,
    maximum,
    seconds,
    identify = req => req.ip
  ) => wrap(async (req, res, next) => {
    const key = hash(
      scope + ':' + String(identify(req) || 'unknown')
    );

    const { rows } = await pool.query(`
      INSERT INTO seguranca_limites(
        chave, quantidade, expira_em
      )
      VALUES(
        $1, 1, NOW() + ($2 * INTERVAL '1 second')
      )
      ON CONFLICT(chave) DO UPDATE SET
        quantidade = CASE
          WHEN seguranca_limites.expira_em <= NOW()
          THEN 1
          ELSE seguranca_limites.quantidade + 1
        END,
        expira_em = CASE
          WHEN seguranca_limites.expira_em <= NOW()
          THEN NOW() + ($2 * INTERVAL '1 second')
          ELSE seguranca_limites.expira_em
        END
      RETURNING
        quantidade,
        GREATEST(
          1,
          CEIL(EXTRACT(EPOCH FROM expira_em - NOW()))
        ) AS espera
    `, [key, seconds]);

    if (rows[0].quantidade > maximum) {
      res.set('Retry-After', String(rows[0].espera));

      return res.status(429).json({
        error:
          'Muitas tentativas. Aguarde alguns minutos e tente novamente.'
      });
    }

    next();
  });

  app.disable('x-powered-by');

  app.use((req, res, next) => {
    res.locals.cspNonce =
      crypto.randomBytes(18).toString('base64');

    next();
  });

  app.use(helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: [
          "'self'",
          (_req, res) =>
            `'nonce-${res.locals.cspNonce}'`
        ],

        // Compatibilidade com os onclick da interface atual.
        scriptSrcAttr: ["'unsafe-inline'"],

        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        fontSrc: ["'self'"],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'none'"],
        frameAncestors: ["'none'"],
        formAction: ["'self'"],

        ...(production
          ? { upgradeInsecureRequests: [] }
          : {})
      }
    },

    strictTransportSecurity: production
      ? { maxAge: 31536000 }
      : false,

    referrerPolicy: {
      policy: 'no-referrer'
    }
  }));

  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store');

    if (
      ['GET', 'HEAD', 'OPTIONS'].includes(req.method)
    ) {
      return next();
    }

    const source = req.get('Origin');
    let supplied;

    try {
      supplied = source
        ? new URL(source).origin
        : new URL(req.get('Referer')).origin;
    } catch {
      return res.status(403).json({
        error:
          'Origem não autorizada. Abra o AgendaPro e tente novamente.'
      });
    }

    if (
      supplied !== origin ||
      req.get('Sec-Fetch-Site') === 'cross-site'
    ) {
      return res.status(403).json({
        error: 'Origem não autorizada.'
      });
    }

    next();
  });

  app.use(
    '/api/auth/login',
    limit('login-ip', 30, 900)
  );

  app.use(
    '/api/public/bookings',
    limit('reserva-ip', 10, 3600)
  );

  app.use(
    '/api/auth/password',
    limit('senha-ip', 10, 3600)
  );

  const validPhotoName =
    /^[a-zA-Z0-9_-]+\.(jpg|jpeg|png|webp|gif)$/i;

  const imageOptions = {
    limitInputPixels: 20000000,
    failOn: 'warning',
    animated: false
  };

  async function convertPhoto(input) {
    const metadata = await sharp(
      input,
      imageOptions
    ).metadata();

    if (
      !['jpeg', 'png', 'webp', 'gif']
        .includes(metadata.format)
    ) {
      throw problem('Formato de foto inválido.');
    }

    const buffer = await sharp(input, imageOptions)
      .rotate()
      .resize({
        width: 1600,
        height: 1600,
        fit: 'inside',
        withoutEnlargement: true
      })
      .webp({ quality: 82 })
      .toBuffer();

    if (buffer.length > 5 * 1024 * 1024) {
      throw problem(
        'Foto muito grande. Envie uma imagem menor.'
      );
    }

    return buffer;
  }

  async function savePhoto(filename, buffer) {
    await pool.query(`
      INSERT INTO arquivos_fotos(nome, conteudo)
      VALUES($1, $2)
      ON CONFLICT(nome) DO NOTHING
    `, [filename, buffer]);
  }

  async function discardPhoto(filename) {
    if (!filename) return;

    // Só remove arquivos sem vínculo com clientes ou produtos.
    await pool.query(`
      DELETE FROM arquivos_fotos
      WHERE nome = $1
        AND NOT EXISTS (
          SELECT 1
          FROM clientes
          WHERE foto_url = $2
        )
        AND NOT EXISTS (
          SELECT 1
          FROM produtos
          WHERE foto_url = $2
        )
    `, [filename, '/uploads/' + filename]);
  }

  async function ensureSchema() {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS arquivos_fotos (
        nome TEXT PRIMARY KEY,
        conteudo BYTEA NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

        CHECK (
          octet_length(conteudo) BETWEEN 1 AND 5242880
        )
      );

      CREATE TABLE IF NOT EXISTS seguranca_sessoes (
        token_hash TEXT PRIMARY KEY,

        usuario_id BIGINT NOT NULL
          REFERENCES usuarios(id)
          ON DELETE CASCADE,

        expira_em TIMESTAMPTZ NOT NULL
      );

      CREATE INDEX IF NOT EXISTS
        idx_seguranca_sessoes_usuario
        ON seguranca_sessoes(usuario_id);

      CREATE INDEX IF NOT EXISTS
        idx_seguranca_sessoes_expira
        ON seguranca_sessoes(expira_em);

      CREATE TABLE IF NOT EXISTS seguranca_limites (
        chave TEXT PRIMARY KEY,
        quantidade INTEGER NOT NULL,
        expira_em TIMESTAMPTZ NOT NULL
      );

      CREATE INDEX IF NOT EXISTS
        idx_seguranca_limites_expira
        ON seguranca_limites(expira_em);
    `);

    // Importa as fotos antigas que ainda estiverem na pasta.
    // Arquivos já perdidos precisarão ser enviados novamente.
    const oldPhotos = await pool.query(`
      SELECT foto_url
      FROM clientes
      WHERE foto_url LIKE '/uploads/%'

      UNION

      SELECT foto_url
      FROM produtos
      WHERE foto_url LIKE '/uploads/%'
    `);

    for (const row of oldPhotos.rows) {
      const filename =
        row.foto_url.slice('/uploads/'.length);

      if (!validPhotoName.test(filename)) continue;

      const stored = await pool.query(
        'SELECT 1 FROM arquivos_fotos WHERE nome = $1',
        [filename]
      );

      if (stored.rowCount) continue;

      let buffer;

      try {
        const location = path.join(
          uploadDir,
          filename
        );

        const info = await fs.promises.stat(location);

        if (
          !info.isFile() ||
          info.size > 5 * 1024 * 1024
        ) {
          continue;
        }

        buffer = await convertPhoto(
          await fs.promises.readFile(location)
        );
      } catch {
        console.warn(
          'Foto antiga indisponível para migração:',
          filename
        );

        continue;
      }

      await savePhoto(filename, buffer);
    }

    const timer = setInterval(() => {
      pool.query(`
        DELETE FROM seguranca_sessoes
        WHERE expira_em <= NOW()
      `).catch(() => {});

      pool.query(`
        DELETE FROM seguranca_limites
        WHERE expira_em <= NOW()
      `).catch(() => {});
    }, 300000);

    timer.unref();
  }

  const auth = wrap(async (req, res, next) => {
    const token = req.cookies?.agendapro_token;
    let claims;

    try {
      if (
        typeof token !== 'string' ||
        token.length > 4096
      ) {
        throw new Error();
      }

      claims = jwt.verify(token, secret, {
        algorithms: ['HS256'],
        issuer,
        audience
      });

      if (
        !/^[1-9]\d{0,18}$/.test(String(claims.sub))
      ) {
        throw new Error();
      }
    } catch {
      return res.status(401).json({
        error: 'Sessão expirada. Entre novamente.'
      });
    }

    const result = await pool.query(`
      SELECT u.id, u.nome, u.perfil
      FROM seguranca_sessoes s
      JOIN usuarios u ON u.id = s.usuario_id
      WHERE s.token_hash = $1
        AND s.expira_em > NOW()
        AND u.ativo = TRUE
        AND u.id::text = $2
        AND u.perfil IN ('admin', 'funcionario')
    `, [hash(token), String(claims.sub)]);

    if (!result.rowCount) {
      return res.status(401).json({
        error: 'Sessão encerrada. Entre novamente.'
      });
    }

    const user = result.rows[0];

    req.user = {
      id: user.id,
      name: user.nome,
      role: user.perfil
    };

    next();
  });

  async function issueToken(user) {
    const db = await pool.connect();

    try {
      await db.query('BEGIN');

      const checked = await db.query(`
        SELECT *
        FROM usuarios
        WHERE id = $1
        FOR UPDATE
      `, [user.id]);

      const current = checked.rows[0];

      if (
        !current?.ativo ||
        current.senha_hash !== user.senha_hash ||
        current.perfil !== user.perfil
      ) {
        throw problem(
          'Dados alterados. Entre novamente.',
          401
        );
      }

      const token = jwt.sign({}, secret, {
        algorithm: 'HS256',
        subject: String(user.id),
        issuer,
        audience,
        jwtid: crypto.randomUUID(),
        expiresIn: '8h'
      });

      await db.query(`
        INSERT INTO seguranca_sessoes(
          token_hash, usuario_id, expira_em
        )
        VALUES(
          $1, $2, NOW() + INTERVAL '8 hours'
        )
      `, [hash(token), user.id]);

      await db.query('COMMIT');

      return token;
    } catch (error) {
      await db.query('ROLLBACK');
      throw error;
    } finally {
      db.release();
    }
  }

  const logout = wrap(async (req, res) => {
    const token = req.cookies?.agendapro_token;

    if (typeof token === 'string') {
      await pool.query(`
        DELETE FROM seguranca_sessoes
        WHERE token_hash = $1
      `, [hash(token)]);
    }

    res.clearCookie(
      'agendapro_token',
      cookieOptions
    );

    res.json({ ok: true });
  });

  async function changePassword(
    id,
    oldHash,
    newHash
  ) {
    const db = await pool.connect();

    try {
      await db.query('BEGIN');

      const changed = await db.query(`
        UPDATE usuarios
        SET senha_hash = $1, updated_at = NOW()
        WHERE id = $2
          AND senha_hash = $3
          AND ativo = TRUE
        RETURNING id
      `, [newHash, id, oldHash]);

      if (!changed.rowCount) {
        throw problem(
          'Sessão alterada. Entre novamente.',
          401
        );
      }

      await db.query(`
        DELETE FROM seguranca_sessoes
        WHERE usuario_id = $1
      `, [id]);

      await db.query('COMMIT');
    } catch (error) {
      await db.query('ROLLBACK');
      throw error;
    } finally {
      db.release();
    }
  }

  const receiver = multer({
    storage: multer.memoryStorage(),

    limits: {
      fileSize: 5 * 1024 * 1024,
      files: 1,
      fields: 20,
      fieldSize: 20000,
      parts: 21
    }
  }).single('photo');

  let processing = 0;

  const uploadLimit = limit(
    'fotos-ip',
    50,
    3600
  );

  const upload = {
    single(field) {
      if (field !== 'photo') {
        throw new Error('Campo de foto inválido.');
      }

      return (req, res, next) => {
        uploadLimit(req, res, error => {
          if (error) return next(error);

          if (processing >= 2) {
            return res.status(503).json({
              error:
                'Fotos em processamento. Tente novamente.'
            });
          }

          processing++;

          receiver(req, res, async error => {
            let saved;

            try {
              if (error) throw error;

              if (req.file) {
                let buffer;

                try {
                  buffer = await convertPhoto(
                    req.file.buffer
                  );
                } catch {
                  throw problem(
                    'Foto inválida. Envie JPG, PNG, WEBP ou GIF de até 5 MB.'
                  );
                }

                const filename =
                  crypto.randomUUID() + '.webp';

                // Guarda os bytes da imagem no PostgreSQL.
                await savePhoto(filename, buffer);

                saved = filename;

                req.file = {
                  filename,
                  mimetype: 'image/webp',
                  size: buffer.length
                };

                res.once('finish', () => {
                  if (res.statusCode >= 400) {
                    discardPhoto(filename)
                      .catch(() => {});
                  }
                });
              }
            } catch (failure) {
              if (saved) {
                await discardPhoto(saved)
                  .catch(() => {});
              }

              processing--;
              return next(failure);
            }

            processing--;
            next();
          });
        });
      };
    }
  };

  app.use(
    '/uploads',
    auth,
    wrap(async (req, res) => {
      let filename;

      try {
        filename = decodeURIComponent(
          req.path.slice(1)
        );
      } catch {
        throw problem('Foto inválida.');
      }

      if (!validPhotoName.test(filename)) {
        throw problem(
          'Foto não encontrada.',
          404
        );
      }

      const url = '/uploads/' + filename;

      // Somente fotos vinculadas a um cadastro podem ser vistas.
      const linked = await pool.query(`
        SELECT 1
        FROM clientes
        WHERE foto_url = $1

        UNION ALL

        SELECT 1
        FROM produtos
        WHERE foto_url = $1

        LIMIT 1
      `, [url]);

      if (!linked.rowCount) {
        throw problem(
          'Foto não encontrada.',
          404
        );
      }

      res.set(
        'Cache-Control',
        'private, no-store'
      );

      const photo = await pool.query(
        'SELECT conteudo FROM arquivos_fotos WHERE nome = $1',
        [filename]
      );

      if (!photo.rowCount) {
        return res.status(404).json({
          error:
            'Foto indisponível. Edite o cadastro e envie a foto novamente.'
        });
      }

      res
        .type('image/webp')
        .send(photo.rows[0].conteudo);
    })
  );

  async function publicClient(db, body, file) {
    const name = String(body.name || '').trim();

    const phone = String(body.phone || '')
      .replace(/\D/g, '');

    if (
      !name ||
      name.length > 150 ||
      !/^\d{10,15}$/.test(phone)
    ) {
      throw problem(
        'Informe nome e telefone válidos.'
      );
    }

    if (String(body.note || '').length > 5000) {
      throw problem('Observação muito longa.');
    }

    const result = await db.query(`
      INSERT INTO clientes(
        nome, telefone, foto_url
      )
      VALUES($1, $2, $3)
      ON CONFLICT(telefone) DO NOTHING
      RETURNING *
    `, [
      name,
      phone,
      file ? '/uploads/' + file.filename : null
    ]);

    if (result.rowCount) {
      return result.rows[0];
    }

    // Telefone não autoriza alterar cadastro existente.
    if (file?.filename) {
      await discardPhoto(file.filename);
    }

    const existing = await db.query(`
      SELECT *
      FROM clientes
      WHERE telefone = $1
    `, [phone]);

    if (!existing.rowCount) {
      throw problem(
        'Não foi possível registrar. Tente novamente.',
        409
      );
    }

    return existing.rows[0];
  }

  function sendHtml(_req, res, next) {
    fs.readFile(
      path.join(frontend, 'index.html'),
      'utf8',
      (error, html) => {
        if (error) return next(error);

        res.set('Cache-Control', 'no-store');

        res.type('html').send(
          html.replace(
            /<script\b/gi,
            `<script nonce="${res.locals.cspNonce}"`
          )
        );
      }
    );
  }

  app.get(
    ['/', '/index.html'],
    sendHtml
  );

  return {
    auth,
    issueToken,
    logout,
    changePassword,
    upload,
    publicClient,
    sendHtml,
    ensureSchema,

    accountLimit: limit(
      'login-conta',
      10,
      900,
      req => String(req.body?.email || '')
        .trim()
        .toLowerCase()
    )
  };
}