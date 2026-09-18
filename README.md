# AgendaPro — versão preparada para Railway

Aplicação full-stack com frontend HTML/CSS/JS, backend Node.js/Express e PostgreSQL.

## O que está pronto

- PostgreSQL com usuários, clientes, procedimentos, agendamentos e atendimentos.
- API REST.
- Login com bcrypt + JWT em cookie HttpOnly.
- Clientes e agendamentos persistidos no PostgreSQL.
- Procedimentos persistidos no PostgreSQL.
- Fotos armazenadas como arquivos; o banco guarda o caminho.
- Relatórios diário, mensal e anual consultando o PostgreSQL.
- PDFs gerados no backend.
- Docker para execução local.
- Dockerfile na raiz preparado para Railway.
- `railway.toml` com healthcheck em `/api/health`.

## Publicação no Railway

1. Crie um projeto no Railway.
2. Adicione um serviço PostgreSQL.
3. Adicione o serviço da aplicação a partir deste repositório/ZIP convertido em GitHub.
4. No serviço da aplicação, configure `DATABASE_URL` como referência para o PostgreSQL:
   `${{Postgres.DATABASE_URL}}`
5. Configure as variáveis:
   - `NODE_ENV=production`
   - `JWT_SECRET` = uma chave longa e aleatória
   - `ADMIN_NAME`
   - `ADMIN_EMAIL`
   - `ADMIN_PASSWORD`
   - `FUNC_NAME`
   - `FUNC_EMAIL`
   - `FUNC_PASSWORD`
   - `UPLOAD_DIR=/app/uploads`
6. Gere um domínio público em Settings → Networking.
7. Adicione um Volume ao serviço da aplicação com mount path `/app/uploads` para manter as fotos após novos deploys.
8. Abra `/api/health` para confirmar que a aplicação e o banco estão conectados.

O Railway suporta PostgreSQL gerenciado e injeta `DATABASE_URL`; também suporta Dockerfile e volumes persistentes.

## Execução local

Requisito: Docker Desktop.

```bash
docker compose up --build
```

Depois abra `http://localhost:3000`.

## Login local

Administrador: `admin@agendapro.local` / `TroqueEssaSenha123!`

Funcionário: `funcionario@agendapro.local` / `TroqueEssaSenha456!`

Troque as credenciais antes de publicar.
