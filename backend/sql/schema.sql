BEGIN;

-- USUÁRIOS

CREATE TABLE IF NOT EXISTS usuarios (
    id BIGSERIAL PRIMARY KEY,
    nome VARCHAR(120) NOT NULL,
    email VARCHAR(150) UNIQUE NOT NULL,
    senha_hash TEXT NOT NULL,
    perfil VARCHAR(30) NOT NULL DEFAULT 'funcionario',
    ativo BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT usuarios_perfil_check
        CHECK (perfil IN ('admin', 'funcionario'))
);

-- CLIENTES

CREATE TABLE IF NOT EXISTS clientes (
    id BIGSERIAL PRIMARY KEY,
    nome VARCHAR(150) NOT NULL,
    telefone VARCHAR(30) NOT NULL UNIQUE,
    foto_url TEXT,
    observacao TEXT,
    ativo BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- PROCEDIMENTOS

CREATE TABLE IF NOT EXISTS procedimentos (
    id BIGSERIAL PRIMARY KEY,
    nome VARCHAR(150) NOT NULL UNIQUE,
    preco NUMERIC(10,2) NOT NULL DEFAULT 0,
    ativo BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- AGENDAMENTOS

CREATE TABLE IF NOT EXISTS agendamentos (
    id BIGSERIAL PRIMARY KEY,

    cliente_id BIGINT NOT NULL
        REFERENCES clientes(id)
        ON DELETE RESTRICT,

    procedimento_id BIGINT NOT NULL
        REFERENCES procedimentos(id)
        ON DELETE RESTRICT,

    data DATE NOT NULL,
    hora TIME NOT NULL,
    valor NUMERIC(10,2) NOT NULL DEFAULT 0,
    status VARCHAR(30) NOT NULL DEFAULT 'Agendado',
    observacao TEXT,

    criado_por BIGINT
        REFERENCES usuarios(id)
        ON DELETE SET NULL,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT agendamento_status_check
        CHECK (
            status IN (
                'Agendado',
                'Confirmado',
                'Atendido',
                'Cancelado',
                'Retorno'
            )
        )
);

ALTER TABLE agendamentos
    DROP CONSTRAINT IF EXISTS agendamento_status_check;

ALTER TABLE agendamentos
    ADD CONSTRAINT agendamento_status_check
    CHECK (
        status IN (
            'Agendado',
            'Confirmado',
            'Atendido',
            'Cancelado',
            'Retorno'
        )
    );

ALTER TABLE agendamentos
    ADD COLUMN IF NOT EXISTS agendamento_origem_id BIGINT
    REFERENCES agendamentos(id)
    ON DELETE SET NULL;

-- Permite vários agendamentos no mesmo horário.

DROP INDEX IF EXISTS uq_agendamento_horario_ativo;

-- ATENDIMENTOS

CREATE TABLE IF NOT EXISTS atendimentos (
    id BIGSERIAL PRIMARY KEY,

    agendamento_id BIGINT
        REFERENCES agendamentos(id)
        ON DELETE SET NULL,

    cliente_id BIGINT NOT NULL
        REFERENCES clientes(id)
        ON DELETE RESTRICT,

    procedimento_id BIGINT NOT NULL
        REFERENCES procedimentos(id)
        ON DELETE RESTRICT,

    data DATE NOT NULL,
    valor NUMERIC(10,2) NOT NULL DEFAULT 0,
    observacao TEXT,

    atendido_por BIGINT
        REFERENCES usuarios(id)
        ON DELETE SET NULL,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE atendimentos
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ
    NOT NULL DEFAULT NOW();

-- PRODUTOS

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
        CHECK (
            preco >= 0
            AND preco <= 99999999.99
        )
);

ALTER TABLE produtos
    ADD COLUMN IF NOT EXISTS foto_url TEXT;

-- VENDAS

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

-- ITENS DAS VENDAS

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

-- ÍNDICES

CREATE INDEX IF NOT EXISTS idx_clientes_nome
    ON clientes(nome);

CREATE INDEX IF NOT EXISTS idx_agendamentos_data
    ON agendamentos(data);

CREATE INDEX IF NOT EXISTS idx_agendamentos_data_hora
    ON agendamentos(data, hora);

CREATE INDEX IF NOT EXISTS idx_agendamentos_cliente
    ON agendamentos(cliente_id);

CREATE INDEX IF NOT EXISTS idx_agendamentos_status
    ON agendamentos(status);

CREATE INDEX IF NOT EXISTS idx_agendamentos_origem
    ON agendamentos(agendamento_origem_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_atendimento_agendamento
    ON atendimentos(agendamento_id)
    WHERE agendamento_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_atendimentos_cliente
    ON atendimentos(cliente_id);

CREATE INDEX IF NOT EXISTS idx_atendimentos_data
    ON atendimentos(data);

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

COMMIT;