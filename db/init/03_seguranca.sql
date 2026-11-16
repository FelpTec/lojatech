-- =====================================================================
-- LojaTech · 03 · SEGURANÇA (roles, contas e privilégios)
--
-- Estratégia: MENOR PRIVILÉGIO + ROLES do MySQL 8.
--   * Nenhuma conta da aplicação tem INSERT/UPDATE/DELETE em tabelas:
--     toda escrita passa por procedures (SQL SECURITY DEFINER), que
--     validam as regras e controlam a transação.
--   * Leituras sensíveis só por views (CPF mascarado, usuários sem senha).
--   * root nunca é usado pela aplicação; a administração usa lojatech_dba.
--
-- Os hosts '%' permitem a conexão do container da aplicação (Docker).
-- Em produção, restrinja ao IP do servidor de aplicação (ex.: '10.0.0.%').
-- As senhas abaixo são de DEMONSTRAÇÃO e devem ser trocadas fora do
-- ambiente acadêmico (a aplicação as lê do arquivo .env, nunca do código).
-- =====================================================================

SET NAMES utf8mb4;   -- garante acentos corretos qualquer que seja o cliente
DROP USER IF EXISTS 'lojatech_app'@'%', 'lojatech_relatorio'@'%', 'lojatech_dba'@'%';
DROP ROLE IF EXISTS 'r_lojatech_leitura', 'r_lojatech_operacao', 'r_lojatech_admin';

CREATE ROLE 'r_lojatech_leitura', 'r_lojatech_operacao', 'r_lojatech_admin';

-- ---------------------------------------------------------------------
-- r_lojatech_leitura — consulta de relatórios (apenas views)
-- ---------------------------------------------------------------------
GRANT SELECT ON lojatech.vw_vendas_detalhadas TO 'r_lojatech_leitura';
GRANT SELECT ON lojatech.vw_resumo_pedidos    TO 'r_lojatech_leitura';
GRANT SELECT ON lojatech.vw_estoque_baixo     TO 'r_lojatech_leitura';
GRANT SELECT ON lojatech.vw_clientes          TO 'r_lojatech_leitura';
GRANT SELECT ON lojatech.vw_painel            TO 'r_lojatech_leitura';

-- ---------------------------------------------------------------------
-- r_lojatech_operacao — o que a aplicação precisa além da leitura
-- ---------------------------------------------------------------------
GRANT SELECT ON lojatech.produtos             TO 'r_lojatech_operacao';  -- entidade exibida na tela
GRANT SELECT ON lojatech.categorias           TO 'r_lojatech_operacao';
GRANT SELECT ON lojatech.vw_usuarios_publico  TO 'r_lojatech_operacao';  -- perfil e equipe (sem senha)
GRANT EXECUTE ON FUNCTION  lojatech.fn_autenticar        TO 'r_lojatech_operacao';
GRANT EXECUTE ON FUNCTION  lojatech.fn_total_pedido      TO 'r_lojatech_operacao';
GRANT EXECUTE ON FUNCTION  lojatech.fn_cpf_valido        TO 'r_lojatech_operacao';
GRANT EXECUTE ON PROCEDURE lojatech.sp_registrar_venda   TO 'r_lojatech_operacao';
GRANT EXECUTE ON PROCEDURE lojatech.sp_repor_estoque     TO 'r_lojatech_operacao';
GRANT EXECUTE ON PROCEDURE lojatech.sp_atualizar_preco   TO 'r_lojatech_operacao';
GRANT EXECUTE ON PROCEDURE lojatech.sp_cadastrar_cliente TO 'r_lojatech_operacao';

-- ---------------------------------------------------------------------
-- r_lojatech_admin — administração do schema (sem acesso a outros bancos)
-- ---------------------------------------------------------------------
GRANT ALL PRIVILEGES ON lojatech.* TO 'r_lojatech_admin';

-- ---------------------------------------------------------------------
-- CONTAS
-- ---------------------------------------------------------------------
-- Aplicação web (backend Node.js)
CREATE USER 'lojatech_app'@'%' IDENTIFIED BY 'App@Senha2026!'
  WITH MAX_USER_CONNECTIONS 20;
GRANT 'r_lojatech_leitura', 'r_lojatech_operacao' TO 'lojatech_app'@'%';
SET DEFAULT ROLE ALL TO 'lojatech_app'@'%';

-- Relatórios / BI (somente leitura de views)
CREATE USER 'lojatech_relatorio'@'%' IDENTIFIED BY 'Relatorio@Senha2026!'
  WITH MAX_USER_CONNECTIONS 5;
GRANT 'r_lojatech_leitura' TO 'lojatech_relatorio'@'%';
SET DEFAULT ROLE ALL TO 'lojatech_relatorio'@'%';

-- Administrador do banco (manutenção, demonstrações de TCL) — substitui o root
CREATE USER 'lojatech_dba'@'%' IDENTIFIED BY 'Dba@Senha2026!';
GRANT 'r_lojatech_admin' TO 'lojatech_dba'@'%';
SET DEFAULT ROLE ALL TO 'lojatech_dba'@'%';
