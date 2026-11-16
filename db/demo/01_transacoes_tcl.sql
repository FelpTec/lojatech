-- =====================================================================
-- DEMO 1 · CONTROLE DE TRANSAÇÕES (TCL) — executar como lojatech_dba
--   docker compose exec -T db mysql -ulojatech_dba -p --force lojatech < db/demo/01_transacoes_tcl.sql
-- (--force: os erros abaixo são PROPOSITAIS e o script continua)
-- =====================================================================
SET NAMES utf8mb4;   -- garante acentos corretos qualquer que seja o cliente
USE lojatech;

-- ---------------------------------------------------------------------
-- 1) ROLLBACK manual: a alteração some
-- ---------------------------------------------------------------------
SELECT id, nome, estoque FROM produtos WHERE id = 8;                -- estado inicial
START TRANSACTION;
  UPDATE produtos SET estoque = estoque - 10 WHERE id = 8;
  SELECT id, estoque AS 'estoque dentro da transação' FROM produtos WHERE id = 8;
ROLLBACK;
SELECT id, estoque AS 'após ROLLBACK (voltou)' FROM produtos WHERE id = 8;

-- ---------------------------------------------------------------------
-- 2) COMMIT manual: estoque + log gravados JUNTOS (tudo ou nada)
-- ---------------------------------------------------------------------
START TRANSACTION;
  UPDATE produtos SET estoque = estoque + 5 WHERE id = 8;
  INSERT INTO log_estoque (produto_id, variacao, estoque_resultante, motivo, conta_bd)
  SELECT id, 5, estoque, 'Ajuste de inventário (demo TCL)', USER() FROM produtos WHERE id = 8;
COMMIT;
SELECT id, estoque AS 'após COMMIT' FROM produtos WHERE id = 8;
SELECT * FROM log_estoque WHERE produto_id = 8 ORDER BY id DESC LIMIT 1;

-- ---------------------------------------------------------------------
-- 3) SAVEPOINT: desfaz só parte da transação
-- ---------------------------------------------------------------------
START TRANSACTION;
  UPDATE produtos SET estoque = estoque + 1 WHERE id = 12;
  SAVEPOINT antes_do_erro;
  UPDATE produtos SET estoque = estoque + 1000 WHERE id = 12;       -- engano
  ROLLBACK TO SAVEPOINT antes_do_erro;
COMMIT;
SELECT id, estoque AS 'só +1 foi confirmado' FROM produtos WHERE id = 12;

-- ---------------------------------------------------------------------
-- 4) Transação dentro da procedure: venda com 2 itens
-- ---------------------------------------------------------------------
SELECT ultimo_valor AS 'sequência de pedidos antes' FROM sequencias WHERE nome = CONCAT('PED-', YEAR(NOW()));
CALL sp_registrar_venda('USR-00002', 'CLI-000002',
     '[{"produto":1,"quantidade":1},{"produto":8,"quantidade":2}]', @pedido, @total);
SELECT @pedido AS pedido, @total AS total, fn_total_pedido(@pedido) AS conferido;

-- ---------------------------------------------------------------------
-- 5) ROLLBACK automático: 2º item sem estoque → NADA é gravado
--    (nem o pedido, nem o 1º item, nem a baixa, nem o número da sequência)
-- ---------------------------------------------------------------------
SELECT id, estoque AS 'mouse antes' FROM produtos WHERE id = 1;
CALL sp_registrar_venda('USR-00002', 'CLI-000002',
     '[{"produto":1,"quantidade":1},{"produto":10,"quantidade":500}]', @pedido, @total);   -- ERRO proposital
SELECT id, estoque AS 'mouse depois (inalterado)' FROM produtos WHERE id = 1;
SELECT ultimo_valor AS 'sequência (sem lacuna)' FROM sequencias WHERE nome = CONCAT('PED-', YEAR(NOW()));
