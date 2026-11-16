-- =====================================================================
-- DEMO 3 · ÍNDICES — executar como lojatech_dba
--   docker compose exec -T db mysql -ulojatech_dba -p lojatech < db/demo/03_indices_explain.sql
-- Compare a coluna "type" / "key": ref/range com índice × ALL (full scan).
-- =====================================================================
SET NAMES utf8mb4;   -- garante acentos corretos qualquer que seja o cliente
USE lojatech;

SELECT TABLE_NAME, INDEX_NAME, GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS colunas, NON_UNIQUE
  FROM information_schema.STATISTICS
 WHERE TABLE_SCHEMA = 'lojatech'
 GROUP BY TABLE_NAME, INDEX_NAME, NON_UNIQUE
 ORDER BY TABLE_NAME, INDEX_NAME;

-- 1) Lista de pedidos recentes (tela "Pedidos" e painel) → idx_pedidos_data
EXPLAIN SELECT id, data_pedido FROM pedidos WHERE data_pedido >= CURDATE() - INTERVAL 7 DAY ORDER BY data_pedido DESC;

-- 2) Histórico de um cliente no período → idx_pedidos_cliente_data (composto)
EXPLAIN SELECT * FROM pedidos WHERE cliente_id = 'CLI-000001' AND data_pedido >= '2026-01-01';

-- 3) Produtos de uma categoria em ordem alfabética → idx_produtos_categoria_nome (sem filesort)
EXPLAIN SELECT id, nome FROM produtos WHERE categoria_id = 1 ORDER BY nome;

-- 4) Login → uq_usuarios_email (const: no máximo 1 linha)
EXPLAIN SELECT id FROM usuarios WHERE email = 'vendedor@lojatech.com';

-- 5) Mesma consulta IGNORANDO o índice, para comparação → type = ALL
EXPLAIN SELECT * FROM pedidos IGNORE INDEX (idx_pedidos_cliente_data, idx_pedidos_data)
 WHERE cliente_id = 'CLI-000001' AND data_pedido >= '2026-01-01';

-- 6) Plano real com tempos (MySQL 8.0.18+)
EXPLAIN ANALYZE SELECT * FROM vw_resumo_pedidos ORDER BY data_pedido DESC LIMIT 10;
