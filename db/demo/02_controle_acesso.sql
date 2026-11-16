-- =====================================================================
-- DEMO 2 · CONTROLE DE ACESSO — executar como lojatech_app
--   docker compose exec -T db mysql -ulojatech_app -p --force lojatech < db/demo/02_controle_acesso.sql
-- Os comandos marcados com NEGADO devem falhar com ERROR 1142.
-- =====================================================================
SET NAMES utf8mb4;   -- garante acentos corretos qualquer que seja o cliente
USE lojatech;

SELECT CURRENT_USER() AS conta, CURRENT_ROLE() AS roles_ativas;   -- não é root
SHOW GRANTS;

-- PERMITIDO: entidade e views
SELECT id, nome, preco, estoque FROM produtos LIMIT 3;
SELECT * FROM vw_clientes LIMIT 3;                -- CPF mascarado (LGPD)

-- PERMITIDO: login sem enxergar a senha
SELECT fn_autenticar('vendedor@lojatech.com', 'Vendedor@2026') AS login_ok,
       fn_autenticar('vendedor@lojatech.com', 'senha-errada')   AS login_falhou;

-- NEGADO: dados sensíveis e escrita direta
SELECT senha_hash FROM usuarios;                  -- NEGADO
SELECT cpf FROM clientes;                         -- NEGADO (só via view mascarada)
UPDATE produtos SET preco = 0.01 WHERE id = 1;    -- NEGADO (só via procedure)
DELETE FROM pedidos;                              -- NEGADO
DROP TABLE log_estoque;                           -- NEGADO
CALL sp_cadastrar_usuario('Hacker', 'h@x.com', '12345678', 1, @x);  -- NEGADO (só DBA)

-- Regra de negócio no banco: perfil Consulta não vende, mesmo chamando a procedure
CALL sp_registrar_venda('USR-00003', 'CLI-000001', '[{"produto":1,"quantidade":1}]', @p, @t);
