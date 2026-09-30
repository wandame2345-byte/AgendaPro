BEGIN;

-- =====================================================
-- USUÁRIOS
-- =====================================================

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

-- =====================================================
-- CLIENTES
-- =====================================================

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

-- =====================================================
-- PROCEDIMENTOS
-- =====================================================

CREATE TABLE IF NOT EXISTS procedimentos (
    id BIGSERIAL PRIMARY KEY,
    nome VARCHAR(150) NOT NULL UNIQUE,
    preco NUMERIC(10,2) NOT NULL DEFAULT 0,
    ativo BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =====================================================
-- AGENDAMENTOS
-- =====================================================

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

-- Atualiza os status permitidos, preservando os registros.

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

-- Liga o retorno ao agendamento original.

ALTER TABLE agendamentos
    ADD COLUMN IF NOT EXISTS agendamento_origem_id BIGINT
    REFERENCES agendamentos(id)
    ON DELETE SET NULL;

-- Permite vários agendamentos na mesma data e horário.

DROP INDEX IF EXISTS uq_agendamento_horario_ativo;

-- =====================================================
-- ATENDIMENTOS REALIZADOS
-- =====================================================

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

-- Adiciona o campo também em bancos já existentes.
-- O servidor deverá atualizá-lo ao editar um atendimento.

ALTER TABLE atendimentos
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ
    NOT NULL DEFAULT NOW();

-- =====================================================
-- PRODUTOS DO SALÃO
-- =====================================================

CREATE TABLE IF NOT EXISTS produtos (
    id BIGSERIAL PRIMARY KEY,
    nome VARCHAR(150) NOT NULL UNIQUE,
    descricao TEXT,
    preco NUMERIC(10,2) NOT NULL DEFAULT 0,
    ativo BOOLEAN NOT NULL DEFAULT TRUE,

    criado_por BIGINT
        REFERENCES usuarios(id)
        ON DELETE SET NULL,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT produtos