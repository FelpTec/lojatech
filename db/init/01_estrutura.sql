-- =====================================================================
-- LojaTech · 01 · ESTRUTURA (tabelas, restrições e índices)
-- Projeto acadêmico de Banco de Dados — Universidade Católica de Brasília
-- MySQL 8.0.16+ (CHECK constraints, ROLES, JSON_TABLE)
--
-- Executado por uma conta ADMINISTRATIVA de instalação (nunca pela aplicação).
-- O script é reexecutável: recria o schema do zero.
-- =====================================================================
SET NAMES utf8mb4;   -- garante acentos corretos qualquer que seja o cliente
DROP DATABASE IF EXISTS lojatech;
CREATE DATABASE lojatech CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
USE lojatech;

-- ---------------------------------------------------------------------
-- GRUPOS DE USUÁRIOS (obrigatória)
-- Cada flag é uma permissão de negócio, verificada pela API E pelas
-- procedures (defesa em profundidade).
-- ID: AUTO_INCREMENT justificado — tabela de domínio pequena (3–5 linhas),
-- cadastrada só pelo DBA; o número não tem significado de negócio nem é
-- exposto ao usuário final.
-- ---------------------------------------------------------------------
CREATE TABLE grupos_usuarios (
  id                      TINYINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  nome                    VARCHAR(40)  NOT NULL,
  descricao               VARCHAR(150) NOT NULL,
  pode_vender             BOOLEAN NOT NULL DEFAULT FALSE,
  pode_gerenciar_estoque  BOOLEAN NOT NULL DEFAULT FALSE,
  pode_cadastrar_clientes BOOLEAN NOT NULL DEFAULT FALSE,
  CONSTRAINT uq_grupos_nome UNIQUE (nome)
);

-- ---------------------------------------------------------------------
-- USUÁRIOS (obrigatória) — funcionários que usam o sistema
-- ID crítico: gerado por fn_gerar_id_usuario() (USR-00001) via trigger.
-- Senha: salt aleatório por usuário + SHA-256. A conta da aplicação NÃO
-- tem SELECT nesta tabela; a autenticação ocorre em fn_autenticar().
-- ---------------------------------------------------------------------
CREATE TABLE usuarios (
  id            CHAR(9)      NOT NULL DEFAULT '' PRIMARY KEY,
  nome          VARCHAR(80)  NOT NULL,
  email         VARCHAR(120) NOT NULL,
  senha_salt    CHAR(32)     NOT NULL,
  senha_hash    CHAR(64)     NOT NULL,
  grupo_id      TINYINT UNSIGNED NOT NULL,
  ativo         BOOLEAN      NOT NULL DEFAULT TRUE,
  criado_em     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ultimo_login  DATETIME     NULL,
  CONSTRAINT uq_usuarios_email UNIQUE (email),               -- índice usado no login
  CONSTRAINT fk_usuarios_grupo FOREIGN KEY (grupo_id) REFERENCES grupos_usuarios(id),
  CONSTRAINT ck_usuarios_nome  CHECK (CHAR_LENGTH(TRIM(nome)) >= 3),
  CONSTRAINT ck_usuarios_email CHECK (email REGEXP '^[^@[:space:]]+@[^@[:space:]]+\\.[^@[:space:]]+$')
);

-- ---------------------------------------------------------------------
-- CATEGORIAS — tabela de domínio (AUTO_INCREMENT justificado: poucos
-- registros, ID interno sem valor de negócio).
-- ---------------------------------------------------------------------
CREATE TABLE categorias (
  id   SMALLINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  nome VARCHAR(60) NOT NULL,
  CONSTRAINT uq_categorias_nome UNIQUE (nome)
);

-- ---------------------------------------------------------------------
-- PRODUTOS — entidade exibida diretamente pela aplicação.
-- AUTO_INCREMENT justificado: catálogo interno, ID nunca é digitado nem
-- impresso em documentos; a integridade de valores (preço/estoque) é
-- garantida por CHECKs e pelo histórico de preços.
-- ---------------------------------------------------------------------
CREATE TABLE produtos (
  id             INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  nome           VARCHAR(100)  NOT NULL,
  categoria_id   SMALLINT UNSIGNED NOT NULL,
  preco          DECIMAL(10,2) NOT NULL,
  estoque        INT           NOT NULL DEFAULT 0,
  estoque_minimo INT           NOT NULL DEFAULT 5,
  ativo          BOOLEAN       NOT NULL DEFAULT TRUE,
  CONSTRAINT fk_produtos_categoria FOREIGN KEY (categoria_id) REFERENCES categorias(id),
  CONSTRAINT ck_produtos_preco   CHECK (preco > 0 AND preco <= 999999.99),
  CONSTRAINT ck_produtos_estoque CHECK (estoque >= 0),
  CONSTRAINT ck_produtos_minimo  CHECK (estoque_minimo >= 0),
  CONSTRAINT ck_produtos_nome    CHECK (CHAR_LENGTH(TRIM(nome)) >= 2)
);

-- ---------------------------------------------------------------------
-- CLIENTES — dado pessoal (LGPD): ID próprio CLI-000001 via
-- fn_gerar_id_cliente(); CPF validado por fn_cpf_valido() em trigger.
-- A aplicação lê clientes apenas pela view vw_clientes (CPF mascarado).
-- ---------------------------------------------------------------------
CREATE TABLE clientes (
  id         CHAR(10)     NOT NULL DEFAULT '' PRIMARY KEY,
  nome       VARCHAR(80)  NOT NULL,
  cpf        CHAR(11)     NOT NULL,
  email      VARCHAR(120) NOT NULL,
  telefone   VARCHAR(11)  NULL,
  criado_em  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  criado_por CHAR(9)      NULL,
  CONSTRAINT uq_clientes_cpf   UNIQUE (cpf),
  CONSTRAINT uq_clientes_email UNIQUE (email),
  CONSTRAINT fk_clientes_usuario FOREIGN KEY (criado_por) REFERENCES usuarios(id),
  CONSTRAINT ck_clientes_nome  CHECK (CHAR_LENGTH(TRIM(nome)) >= 3),
  CONSTRAINT ck_clientes_cpf   CHECK (cpf REGEXP '^[0-9]{11}$'),
  CONSTRAINT ck_clientes_email CHECK (email REGEXP '^[^@[:space:]]+@[^@[:space:]]+\\.[^@[:space:]]+$'),
  CONSTRAINT ck_clientes_tel   CHECK (telefone IS NULL OR telefone REGEXP '^[0-9]{10,11}$')
);

-- ---------------------------------------------------------------------
-- SEQUÊNCIAS — contadores das funções de geração de ID.
-- Uma linha por série (ex.: 'USR', 'CLI', 'PED-2026'): a série de pedidos
-- reinicia a cada ano. Como a linha é bloqueada até o COMMIT, não há IDs
-- duplicados em concorrência, e o ROLLBACK devolve o número (sem lacunas).
-- ---------------------------------------------------------------------
CREATE TABLE sequencias (
  nome         VARCHAR(30)  NOT NULL PRIMARY KEY,
  ultimo_valor INT UNSIGNED NOT NULL DEFAULT 0
);

-- ---------------------------------------------------------------------
-- PEDIDOS — dado crítico (documento de venda): ID PED-AAAA-NNNNNN via
-- fn_gerar_id_pedido(). Legível, sequencial por ano, sem lacunas.
-- ---------------------------------------------------------------------
CREATE TABLE pedidos (
  id          CHAR(15) NOT NULL PRIMARY KEY,
  cliente_id  CHAR(10) NOT NULL,
  usuario_id  CHAR(9)  NOT NULL,
  data_pedido DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_pedidos_cliente FOREIGN KEY (cliente_id) REFERENCES clientes(id),
  CONSTRAINT fk_pedidos_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios(id),
  CONSTRAINT ck_pedidos_id CHECK (id REGEXP '^PED-[0-9]{4}-[0-9]{6}$')
);

-- ---------------------------------------------------------------------
-- ITENS DO PEDIDO — resolve o N:N pedidos × produtos.
-- AUTO_INCREMENT justificado: linha subordinada ao pedido, nunca
-- referenciada isoladamente; o identificador de negócio é (pedido, produto).
-- Itens são IMUTÁVEIS (triggers bloqueiam UPDATE/DELETE) para manter
-- estoque e log_estoque coerentes.
-- ---------------------------------------------------------------------
CREATE TABLE itens_pedido (
  id             INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  pedido_id      CHAR(15)      NOT NULL,
  produto_id     INT UNSIGNED  NOT NULL,
  quantidade     INT           NOT NULL,
  preco_unitario DECIMAL(10,2) NOT NULL,
  CONSTRAINT uq_itens_pedido_produto UNIQUE (pedido_id, produto_id),
  CONSTRAINT fk_itens_pedido  FOREIGN KEY (pedido_id)  REFERENCES pedidos(id),
  CONSTRAINT fk_itens_produto FOREIGN KEY (produto_id) REFERENCES produtos(id),
  CONSTRAINT ck_itens_qtd   CHECK (quantidade BETWEEN 1 AND 999),
  CONSTRAINT ck_itens_preco CHECK (preco_unitario > 0)
);

-- ---------------------------------------------------------------------
-- LOG DE ESTOQUE — auditoria de toda movimentação (vendas e reposições).
-- AUTO_INCREMENT justificado: log append-only de alto volume; a ordem de
-- inserção é exatamente o que se quer registrar.
-- ---------------------------------------------------------------------
CREATE TABLE log_estoque (
  id                 BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  produto_id         INT UNSIGNED NOT NULL,
  variacao           INT          NOT NULL,
  estoque_resultante INT          NOT NULL,
  motivo             VARCHAR(80)  NOT NULL,
  usuario_id         CHAR(9)      NULL,
  conta_bd           VARCHAR(100) NOT NULL,         -- conta MySQL que originou (USER())
  data_log           DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_log_produto FOREIGN KEY (produto_id) REFERENCES produtos(id),
  CONSTRAINT fk_log_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios(id),
  CONSTRAINT ck_log_variacao CHECK (variacao <> 0)
);

-- ---------------------------------------------------------------------
-- HISTÓRICO DE PREÇOS — preenchido exclusivamente por trigger.
-- AUTO_INCREMENT justificado: mesmo caso do log (append-only).
-- ---------------------------------------------------------------------
CREATE TABLE historico_precos (
  id             BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  produto_id     INT UNSIGNED  NOT NULL,
  preco_anterior DECIMAL(10,2) NOT NULL,
  preco_novo     DECIMAL(10,2) NOT NULL,
  usuario_id     CHAR(9)       NULL,
  conta_bd       VARCHAR(100)  NOT NULL,
  alterado_em    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_hist_produto FOREIGN KEY (produto_id) REFERENCES produtos(id),
  CONSTRAINT fk_hist_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
);

-- =====================================================================
-- ÍNDICES
-- PKs, UNIQUEs e FKs já geram índices automaticamente. Os índices abaixo
-- foram escolhidos a partir das CONSULTAS REAIS da aplicação; os
-- compostos começam pela coluna de FK, por isso substituem o índice que o
-- InnoDB criaria só para a FK (sem índice duplicado).
-- Verificação: db/demo/03_indices_explain.sql
-- =====================================================================

-- Tela de produtos: filtro por categoria + ordenação por nome
-- (WHERE categoria_id = ? ORDER BY nome) → evita filesort.
CREATE INDEX idx_produtos_categoria_nome ON produtos (categoria_id, nome);

-- Lista de pedidos e painel: ORDER BY data_pedido DESC / filtros
-- "hoje" e "mês atual" (range scan em vez de full scan).
CREATE INDEX idx_pedidos_data ON pedidos (data_pedido);

-- Histórico de compras de um cliente por período
-- (WHERE cliente_id = ? AND data_pedido >= ?).
CREATE INDEX idx_pedidos_cliente_data ON pedidos (cliente_id, data_pedido);

-- Movimentações de um produto em ordem cronológica.
CREATE INDEX idx_log_produto_data ON log_estoque (produto_id, data_log);

-- Histórico de preços de um produto em ordem cronológica.
CREATE INDEX idx_hist_produto_data ON historico_precos (produto_id, alterado_em);
