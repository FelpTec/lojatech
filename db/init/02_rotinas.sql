-- =====================================================================
-- LojaTech · 02 · ROTINAS (functions, triggers, procedures e views)
-- =====================================================================
SET NAMES utf8mb4;   -- garante acentos corretos qualquer que seja o cliente
USE lojatech;

-- Com o binlog ativo, o MySQL só deixa criar functions não determinísticas
-- se isto estiver ligado. Ligamos apenas durante a instalação e desligamos
-- no fim do arquivo para não afrouxar a proteção do servidor.
SET GLOBAL log_bin_trust_function_creators = 1;

DELIMITER $$

-- =====================================================================
-- FUNCTIONS
-- =====================================================================

-- Contador atômico genérico (base das funções de ID).
-- O upsert bloqueia a linha da série até o fim da transação: duas
-- transações nunca recebem o mesmo número, e um ROLLBACK devolve o valor.
CREATE FUNCTION fn_proximo_valor(p_serie VARCHAR(30)) RETURNS INT UNSIGNED
MODIFIES SQL DATA
BEGIN
  DECLARE v_valor INT UNSIGNED;
  INSERT INTO sequencias (nome, ultimo_valor) VALUES (p_serie, 1)
    ON DUPLICATE KEY UPDATE ultimo_valor = ultimo_valor + 1;
  SELECT ultimo_valor INTO v_valor FROM sequencias WHERE nome = p_serie;
  RETURN v_valor;
END$$

-- ID de pedido: PED-AAAA-NNNNNN (série reinicia a cada ano).
CREATE FUNCTION fn_gerar_id_pedido() RETURNS CHAR(15)
MODIFIES SQL DATA
BEGIN
  DECLARE v_ano CHAR(4) DEFAULT DATE_FORMAT(NOW(), '%Y');
  DECLARE v_num INT UNSIGNED DEFAULT fn_proximo_valor(CONCAT('PED-', v_ano));
  IF v_num > 999999 THEN    -- LPAD truncaria e geraria ID repetido
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Limite anual de pedidos atingido (999.999)';
  END IF;
  RETURN CONCAT('PED-', v_ano, '-', LPAD(v_num, 6, '0'));
END$$

-- ID de usuário: USR-NNNNN.
CREATE FUNCTION fn_gerar_id_usuario() RETURNS CHAR(9)
MODIFIES SQL DATA
BEGIN
  DECLARE v_num INT UNSIGNED DEFAULT fn_proximo_valor('USR');
  IF v_num > 99999 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Limite de usuários atingido (99.999)';
  END IF;
  RETURN CONCAT('USR-', LPAD(v_num, 5, '0'));
END$$

-- ID de cliente: CLI-NNNNNN.
CREATE FUNCTION fn_gerar_id_cliente() RETURNS CHAR(10)
MODIFIES SQL DATA
BEGIN
  DECLARE v_num INT UNSIGNED DEFAULT fn_proximo_valor('CLI');
  IF v_num > 999999 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Limite de clientes atingido (999.999)';
  END IF;
  RETURN CONCAT('CLI-', LPAD(v_num, 6, '0'));
END$$

-- Validação de CPF (dígitos verificadores). Mesmo algoritmo do
-- frontend e da API: a regra vale mesmo para INSERT feito fora do sistema.
CREATE FUNCTION fn_cpf_valido(p_cpf VARCHAR(20)) RETURNS BOOLEAN
DETERMINISTIC NO SQL
BEGIN
  DECLARE v_cpf VARCHAR(20) DEFAULT REGEXP_REPLACE(COALESCE(p_cpf, ''), '[^0-9]', '');
  DECLARE i INT DEFAULT 1;
  DECLARE s1 INT DEFAULT 0;
  DECLARE s2 INT DEFAULT 0;
  DECLARE d1 INT;
  DECLARE d2 INT;
  IF CHAR_LENGTH(v_cpf) <> 11 OR v_cpf REGEXP '^([0-9])\\1{10}$' THEN
    RETURN FALSE;
  END IF;
  WHILE i <= 9 DO
    SET s1 = s1 + CAST(SUBSTRING(v_cpf, i, 1) AS UNSIGNED) * (11 - i);
    SET s2 = s2 + CAST(SUBSTRING(v_cpf, i, 1) AS UNSIGNED) * (12 - i);
    SET i = i + 1;
  END WHILE;
  SET d1 = (s1 * 10) % 11;  IF d1 = 10 THEN SET d1 = 0; END IF;
  SET s2 = s2 + d1 * 2;
  SET d2 = (s2 * 10) % 11;  IF d2 = 10 THEN SET d2 = 0; END IF;
  RETURN d1 = CAST(SUBSTRING(v_cpf, 10, 1) AS UNSIGNED)
     AND d2 = CAST(SUBSTRING(v_cpf, 11, 1) AS UNSIGNED);
END$$

-- Hash de senha com salt (SHA-256). Centralizado para que cadastro e
-- login usem exatamente a mesma regra.
CREATE FUNCTION fn_hash_senha(p_salt CHAR(32), p_senha VARCHAR(100)) RETURNS CHAR(64)
DETERMINISTIC NO SQL
BEGIN
  RETURN SHA2(CONCAT(p_salt, ':', p_senha), 256);
END$$

-- Autenticação: devolve o ID do usuário ou NULL. Roda com os privilégios
-- do DEFINER, então a aplicação valida a senha SEM poder ler senha_hash.
CREATE FUNCTION fn_autenticar(p_email VARCHAR(120), p_senha VARCHAR(100)) RETURNS CHAR(9)
MODIFIES SQL DATA
BEGIN
  DECLARE v_id CHAR(9) DEFAULT NULL;
  SELECT id INTO v_id FROM usuarios
   WHERE email = LOWER(TRIM(p_email)) AND ativo
     AND senha_hash = fn_hash_senha(senha_salt, p_senha);
  IF v_id IS NOT NULL THEN
    UPDATE usuarios SET ultimo_login = NOW() WHERE id = v_id;
  END IF;
  RETURN v_id;
END$$

-- Permissão de negócio do usuário (lê as flags de grupos_usuarios).
CREATE FUNCTION fn_tem_permissao(p_usuario CHAR(9), p_permissao VARCHAR(30)) RETURNS BOOLEAN
READS SQL DATA
BEGIN
  DECLARE v_ok BOOLEAN DEFAULT FALSE;
  SELECT CASE p_permissao
           WHEN 'vender'             THEN g.pode_vender
           WHEN 'gerenciar_estoque'  THEN g.pode_gerenciar_estoque
           WHEN 'cadastrar_clientes' THEN g.pode_cadastrar_clientes
           ELSE FALSE END
    INTO v_ok
    FROM usuarios u JOIN grupos_usuarios g ON g.id = u.grupo_id
   WHERE u.id = p_usuario AND u.ativo;
  RETURN COALESCE(v_ok, FALSE);
END$$

-- Total de um pedido (soma dos itens).
CREATE FUNCTION fn_total_pedido(p_pedido CHAR(15)) RETURNS DECIMAL(12,2)
READS SQL DATA
BEGIN
  RETURN (SELECT COALESCE(SUM(quantidade * preco_unitario), 0)
            FROM itens_pedido WHERE pedido_id = p_pedido);
END$$

-- =====================================================================
-- TRIGGERS
-- =====================================================================

-- 1) Gera o ID próprio e normaliza o e-mail de todo usuário inserido,
--    mesmo que o INSERT não venha da procedure.
CREATE TRIGGER trg_usuarios_bi BEFORE INSERT ON usuarios
FOR EACH ROW
BEGIN
  IF NEW.id IS NULL OR NEW.id = '' THEN
    SET NEW.id = fn_gerar_id_usuario();
  END IF;
  SET NEW.email = LOWER(TRIM(NEW.email));
  SET NEW.nome  = TRIM(NEW.nome);
END$$

-- 2) Gera o ID próprio do cliente, normaliza os dados e rejeita CPF
--    inválido (CHECK não pode chamar function; o trigger pode).
CREATE TRIGGER trg_clientes_bi BEFORE INSERT ON clientes
FOR EACH ROW
BEGIN
  SET NEW.cpf      = REGEXP_REPLACE(NEW.cpf, '[^0-9]', '');
  SET NEW.telefone = NULLIF(REGEXP_REPLACE(COALESCE(NEW.telefone, ''), '[^0-9]', ''), '');
  SET NEW.email    = LOWER(TRIM(NEW.email));
  SET NEW.nome     = TRIM(NEW.nome);
  IF NOT fn_cpf_valido(NEW.cpf) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'CPF inválido';
  END IF;
  IF NEW.id IS NULL OR NEW.id = '' THEN
    SET NEW.id = fn_gerar_id_cliente();
  END IF;
END$$

-- 3) Toda venda baixa o estoque e grava a auditoria. Fica no banco para
--    valer em QUALQUER caminho de inserção (procedure, DBA, script).
CREATE TRIGGER trg_itens_ai_baixa_estoque AFTER INSERT ON itens_pedido
FOR EACH ROW
BEGIN
  DECLARE v_usuario CHAR(9);
  SELECT usuario_id INTO v_usuario FROM pedidos WHERE id = NEW.pedido_id;
  UPDATE produtos SET estoque = estoque - NEW.quantidade WHERE id = NEW.produto_id;
  INSERT INTO log_estoque (produto_id, variacao, estoque_resultante, motivo, usuario_id, conta_bd)
  SELECT NEW.produto_id, -NEW.quantidade, estoque, CONCAT('Venda ', NEW.pedido_id), v_usuario, USER()
    FROM produtos WHERE id = NEW.produto_id;
END$$

-- 4 e 5) Itens de pedido são imutáveis: alterar/remover sem estornar o
--    estoque deixaria estoque e log inconsistentes.
CREATE TRIGGER trg_itens_bu_bloqueia BEFORE UPDATE ON itens_pedido
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Itens de pedido não podem ser alterados';
END$$

CREATE TRIGGER trg_itens_bd_bloqueia BEFORE DELETE ON itens_pedido
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Itens de pedido não podem ser excluídos';
END$$

-- 6) Auditoria de preço: toda mudança fica registrada, inclusive feitas
--    direto no banco. @lojatech_usuario é definido por sp_atualizar_preco.
CREATE TRIGGER trg_produtos_au_historico_preco AFTER UPDATE ON produtos
FOR EACH ROW
BEGIN
  IF NEW.preco <> OLD.preco THEN
    INSERT INTO historico_precos (produto_id, preco_anterior, preco_novo, usuario_id, conta_bd)
    VALUES (NEW.id, OLD.preco, NEW.preco, @lojatech_usuario, USER());
  END IF;
END$$

-- =====================================================================
-- PROCEDURES
-- Todas as escritas da aplicação passam por aqui. Padrão adotado:
--   * bloco externo: validações de entrada (sem transação aberta);
--   * bloco interno: START TRANSACTION … COMMIT, com EXIT HANDLER que faz
--     ROLLBACK e repassa o erro (RESIGNAL).
-- A procedure é DONA da transação: deve ser chamada em modo autocommit,
-- fora de uma transação aberta — o START TRANSACTION interno faria COMMIT
-- implícito do que o chamador ainda não confirmou (a API sempre chama assim).
-- =====================================================================

-- Venda com carrinho: p_itens = [{"produto": 1, "quantidade": 2}, …]
CREATE PROCEDURE sp_registrar_venda(
  IN  p_usuario CHAR(9),
  IN  p_cliente CHAR(10),
  IN  p_itens   JSON,
  OUT p_pedido  CHAR(15),
  OUT p_total   DECIMAL(12,2))
BEGIN
  DECLARE v_n, v_i, v_produto, v_qtd, v_estoque INT DEFAULT 0;
  DECLARE v_preco DECIMAL(10,2);
  DECLARE v_ativo BOOLEAN;
  DECLARE v_nome VARCHAR(100);

  IF NOT fn_tem_permissao(p_usuario, 'vender') THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Seu perfil não tem permissão para vender';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM clientes WHERE id = p_cliente) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Cliente não encontrado';
  END IF;
  IF p_itens IS NULL OR JSON_TYPE(p_itens) <> 'ARRAY' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Carrinho inválido';
  END IF;
  SET v_n = JSON_LENGTH(p_itens);
  IF v_n = 0 OR v_n > 20 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'O carrinho deve ter de 1 a 20 itens';
  END IF;
  IF EXISTS (SELECT 1 FROM JSON_TABLE(p_itens, '$[*]' COLUMNS (
               produto JSON PATH '$.produto', quantidade JSON PATH '$.quantidade')) jt
              WHERE jt.produto IS NULL OR jt.quantidade IS NULL
                 OR JSON_TYPE(jt.produto) <> 'INTEGER' OR JSON_TYPE(jt.quantidade) <> 'INTEGER'
                 OR CAST(jt.quantidade AS SIGNED) NOT BETWEEN 1 AND 999) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Cada item precisa de produto e quantidade inteira entre 1 e 999';
  END IF;
  IF (SELECT COUNT(*) <> COUNT(DISTINCT produto) FROM JSON_TABLE(p_itens, '$[*]'
        COLUMNS (produto INT PATH '$.produto')) jt) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Produto repetido no carrinho';
  END IF;

  transacao: BEGIN
    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
      ROLLBACK;                       -- desfaz pedido, itens, estoque, log e sequência
      SET p_pedido = NULL, p_total = NULL;
      RESIGNAL;
    END;

    START TRANSACTION;
      SET p_pedido = fn_gerar_id_pedido();
      INSERT INTO pedidos (id, cliente_id, usuario_id) VALUES (p_pedido, p_cliente, p_usuario);

      WHILE v_i < v_n DO
        SET v_produto = JSON_EXTRACT(p_itens, CONCAT('$[', v_i, '].produto'));
        SET v_qtd     = JSON_EXTRACT(p_itens, CONCAT('$[', v_i, '].quantidade'));
        SET v_preco = NULL;
        -- FOR UPDATE: bloqueia a linha até o COMMIT; duas vendas simultâneas
        -- não conseguem vender a mesma unidade.
        SELECT preco, estoque, ativo, nome INTO v_preco, v_estoque, v_ativo, v_nome
          FROM produtos WHERE id = v_produto FOR UPDATE;
        IF v_preco IS NULL OR NOT v_ativo THEN
          SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Produto não encontrado ou inativo';
        END IF;
        IF v_estoque < v_qtd THEN
          SET @msg = CONCAT('Estoque insuficiente para "', v_nome, '" (disponível: ', v_estoque, ')');
          SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = @msg;
        END IF;
        INSERT INTO itens_pedido (pedido_id, produto_id, quantidade, preco_unitario)
        VALUES (p_pedido, v_produto, v_qtd, v_preco);   -- trigger baixa o estoque
        SET v_i = v_i + 1;
      END WHILE;

      SET p_total = fn_total_pedido(p_pedido);
    COMMIT;
  END transacao;
END$$

-- Reposição de estoque (entrada de mercadoria).
CREATE PROCEDURE sp_repor_estoque(
  IN p_usuario CHAR(9), IN p_produto INT UNSIGNED, IN p_quantidade INT, IN p_motivo VARCHAR(255))
BEGIN
  IF NOT fn_tem_permissao(p_usuario, 'gerenciar_estoque') THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Seu perfil não tem permissão para gerenciar estoque';
  END IF;
  IF p_quantidade IS NULL OR p_quantidade NOT BETWEEN 1 AND 10000 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Quantidade de reposição deve estar entre 1 e 10.000';
  END IF;
  IF CHAR_LENGTH(TRIM(COALESCE(p_motivo, ''))) NOT BETWEEN 3 AND 60 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Informe o motivo da reposição (3 a 60 caracteres)';
  END IF;

  transacao: BEGIN
    DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; RESIGNAL; END;
    START TRANSACTION;
      UPDATE produtos SET estoque = estoque + p_quantidade WHERE id = p_produto AND ativo;
      IF ROW_COUNT() = 0 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Produto não encontrado ou inativo';
      END IF;
      INSERT INTO log_estoque (produto_id, variacao, estoque_resultante, motivo, usuario_id, conta_bd)
      SELECT id, p_quantidade, estoque, CONCAT('Reposição: ', TRIM(p_motivo)), p_usuario, USER()
        FROM produtos WHERE id = p_produto;
    COMMIT;
  END transacao;
END$$

-- Alteração de preço (o trigger grava o histórico).
CREATE PROCEDURE sp_atualizar_preco(
  IN p_usuario CHAR(9), IN p_produto INT UNSIGNED, IN p_preco DECIMAL(10,2))
BEGIN
  IF NOT fn_tem_permissao(p_usuario, 'gerenciar_estoque') THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Seu perfil não tem permissão para alterar preços';
  END IF;
  IF p_preco IS NULL OR p_preco <= 0 OR p_preco > 999999.99 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Preço deve estar entre R$ 0,01 e R$ 999.999,99';
  END IF;

  transacao: BEGIN
    DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; SET @lojatech_usuario = NULL; RESIGNAL; END;
    START TRANSACTION;
      SET @lojatech_usuario = p_usuario;          -- lido pelo trigger de histórico
      UPDATE produtos SET preco = p_preco WHERE id = p_produto AND ativo;
      IF ROW_COUNT() = 0 AND NOT EXISTS (SELECT 1 FROM produtos WHERE id = p_produto AND ativo) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Produto não encontrado ou inativo';
      END IF;
      SET @lojatech_usuario = NULL;               -- não vaza para a próxima operação da conexão
    COMMIT;
  END transacao;
END$$

-- Cadastro de cliente (o trigger gera o ID e valida o CPF).
CREATE PROCEDURE sp_cadastrar_cliente(
  IN p_usuario CHAR(9), IN p_nome VARCHAR(255), IN p_cpf VARCHAR(30),
  IN p_email VARCHAR(255), IN p_telefone VARCHAR(30), OUT p_id CHAR(10))
BEGIN
  DECLARE v_cpf VARCHAR(30) DEFAULT REGEXP_REPLACE(COALESCE(p_cpf, ''), '[^0-9]', '');
  DECLARE v_tel VARCHAR(30) DEFAULT NULLIF(REGEXP_REPLACE(COALESCE(p_telefone, ''), '[^0-9]', ''), '');
  DECLARE v_email VARCHAR(255) DEFAULT LOWER(TRIM(COALESCE(p_email, '')));
  IF NOT fn_tem_permissao(p_usuario, 'cadastrar_clientes') THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Seu perfil não tem permissão para cadastrar clientes';
  END IF;
  IF CHAR_LENGTH(TRIM(COALESCE(p_nome, ''))) NOT BETWEEN 3 AND 80 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Nome deve ter de 3 a 80 caracteres';
  END IF;
  IF NOT fn_cpf_valido(v_cpf) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'CPF inválido';
  END IF;
  IF CHAR_LENGTH(v_email) > 120 OR v_email NOT REGEXP '^[^@[:space:]]+@[^@[:space:]]+\\.[^@[:space:]]+$' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'E-mail inválido';
  END IF;
  IF v_tel IS NOT NULL AND v_tel NOT REGEXP '^[0-9]{10,11}$' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Telefone deve ter DDD + número (10 ou 11 dígitos)';
  END IF;
  IF EXISTS (SELECT 1 FROM clientes WHERE cpf = v_cpf) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Já existe cliente com este CPF';
  END IF;
  IF EXISTS (SELECT 1 FROM clientes WHERE email = v_email) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Já existe cliente com este e-mail';
  END IF;

  transacao: BEGIN
    DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; SET p_id = NULL; RESIGNAL; END;
    START TRANSACTION;
      INSERT INTO clientes (nome, cpf, email, telefone, criado_por)
      VALUES (p_nome, v_cpf, v_email, v_tel, p_usuario);
      SELECT id INTO p_id FROM clientes WHERE cpf = v_cpf;
    COMMIT;
  END transacao;
END$$

-- Cadastro de usuário do sistema (uso do DBA; NÃO concedido à aplicação).
CREATE PROCEDURE sp_cadastrar_usuario(
  IN p_nome VARCHAR(80), IN p_email VARCHAR(120), IN p_senha VARCHAR(100),
  IN p_grupo TINYINT UNSIGNED, OUT p_id CHAR(9))
BEGIN
  DECLARE v_salt CHAR(32) DEFAULT HEX(RANDOM_BYTES(16));
  IF CHAR_LENGTH(COALESCE(p_senha, '')) < 8 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Senha deve ter ao menos 8 caracteres';
  END IF;
  INSERT INTO usuarios (nome, email, senha_salt, senha_hash, grupo_id)
  VALUES (p_nome, p_email, v_salt, fn_hash_senha(v_salt, p_senha), p_grupo);
  SELECT id INTO p_id FROM usuarios WHERE email = LOWER(TRIM(p_email));
END$$

DELIMITER ;

SET GLOBAL log_bin_trust_function_creators = 0;

-- =====================================================================
-- VIEWS
-- =====================================================================

-- Itens vendidos com nomes resolvidos (4 JOINs) — detalhe do pedido.
CREATE OR REPLACE VIEW vw_vendas_detalhadas AS
SELECT p.id AS pedido, p.data_pedido, c.nome AS cliente, u.nome AS vendedor,
       pr.id AS produto_id, pr.nome AS produto, i.quantidade, i.preco_unitario,
       i.quantidade * i.preco_unitario AS subtotal
  FROM pedidos p
  JOIN clientes c      ON c.id  = p.cliente_id
  JOIN usuarios u      ON u.id  = p.usuario_id
  JOIN itens_pedido i  ON i.pedido_id = p.id
  JOIN produtos pr     ON pr.id = i.produto_id;

-- Um registro por pedido com total — lista de pedidos.
CREATE OR REPLACE VIEW vw_resumo_pedidos AS
SELECT p.id AS pedido, p.data_pedido, c.nome AS cliente, u.nome AS vendedor,
       COUNT(i.id) AS itens, SUM(i.quantidade) AS unidades,
       SUM(i.quantidade * i.preco_unitario) AS total
  FROM pedidos p
  JOIN clientes c     ON c.id = p.cliente_id
  JOIN usuarios u     ON u.id = p.usuario_id
  JOIN itens_pedido i ON i.pedido_id = p.id
 GROUP BY p.id, p.data_pedido, c.nome, u.nome;

-- Produtos ativos no limite de reposição (mínimo definido por produto).
CREATE OR REPLACE VIEW vw_estoque_baixo AS
SELECT pr.id, pr.nome, ca.nome AS categoria, pr.estoque, pr.estoque_minimo,
       GREATEST(pr.estoque_minimo * 2 - pr.estoque, 1) AS sugestao_reposicao
  FROM produtos pr
  JOIN categorias ca ON ca.id = pr.categoria_id
 WHERE pr.ativo AND pr.estoque <= pr.estoque_minimo;

-- Clientes com CPF mascarado (LGPD): a aplicação nunca lê o CPF completo.
CREATE OR REPLACE VIEW vw_clientes AS
SELECT id, nome,
       CONCAT('***.', SUBSTRING(cpf, 4, 3), '.', SUBSTRING(cpf, 7, 3), '-**') AS cpf_mascarado,
       email, telefone, criado_em
  FROM clientes;

-- Usuários SEM colunas de senha, com o grupo e suas permissões.
CREATE OR REPLACE VIEW vw_usuarios_publico AS
SELECT u.id, u.nome, u.email, u.ativo, u.ultimo_login, g.nome AS grupo,
       g.pode_vender, g.pode_gerenciar_estoque, g.pode_cadastrar_clientes
  FROM usuarios u
  JOIN grupos_usuarios g ON g.id = u.grupo_id;

-- Indicadores do painel em uma única linha.
CREATE OR REPLACE VIEW vw_painel AS
SELECT
  (SELECT COUNT(*) FROM pedidos WHERE data_pedido >= CURDATE())                         AS pedidos_hoje,
  (SELECT COALESCE(SUM(i.quantidade * i.preco_unitario), 0)
     FROM pedidos p JOIN itens_pedido i ON i.pedido_id = p.id
    WHERE p.data_pedido >= CURDATE())                                                   AS faturamento_hoje,
  (SELECT COALESCE(SUM(i.quantidade * i.preco_unitario), 0)
     FROM pedidos p JOIN itens_pedido i ON i.pedido_id = p.id
    WHERE p.data_pedido >= DATE_FORMAT(CURDATE(), '%Y-%m-01'))                          AS faturamento_mes,
  (SELECT COUNT(*) FROM pedidos WHERE data_pedido >= DATE_FORMAT(CURDATE(), '%Y-%m-01')) AS pedidos_mes,
  (SELECT COUNT(*) FROM produtos WHERE ativo AND estoque <= estoque_minimo)               AS produtos_estoque_baixo,
  (SELECT COUNT(*) FROM clientes)                                                         AS total_clientes,
  (SELECT COUNT(*) FROM produtos WHERE ativo)                                             AS produtos_ativos;
