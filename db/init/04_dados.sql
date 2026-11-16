-- =====================================================================
-- LojaTech · 04 · DADOS INICIAIS (demonstração)
-- Usuários e vendas são criados pelas próprias procedures, exercitando
-- as mesmas regras (IDs, hash de senha, baixa de estoque) da aplicação.
-- =====================================================================
SET NAMES utf8mb4;   -- garante acentos corretos qualquer que seja o cliente
USE lojatech;

INSERT INTO grupos_usuarios (nome, descricao, pode_vender, pode_gerenciar_estoque, pode_cadastrar_clientes) VALUES
  ('Administrador', 'Acesso total: vendas, estoque, preços e clientes', TRUE,  TRUE,  TRUE),
  ('Vendedor',      'Registra vendas e cadastra clientes',               TRUE,  FALSE, TRUE),
  ('Consulta',      'Somente leitura de painéis e relatórios',           FALSE, FALSE, FALSE);

-- Senhas de demonstração (exibidas na tela de login)
CALL sp_cadastrar_usuario('Ana Admin',      'admin@lojatech.com',    'Admin@2026',    1, @u_admin);
CALL sp_cadastrar_usuario('Vitor Vendedor', 'vendedor@lojatech.com', 'Vendedor@2026', 2, @u_vend);
CALL sp_cadastrar_usuario('Carla Consulta', 'consulta@lojatech.com', 'Consulta@2026', 3, @u_cons);

INSERT INTO categorias (nome) VALUES ('Periféricos'), ('Áudio'), ('Armazenamento'), ('Monitores'), ('Redes');

INSERT INTO produtos (nome, categoria_id, preco, estoque, estoque_minimo) VALUES
  ('Mouse Gamer RGB',          1,  129.90, 40, 8),
  ('Teclado Mecânico ABNT2',   1,  299.00, 15, 5),
  ('Webcam Full HD',           1,  219.90,  6, 5),
  ('Headset USB 7.1',          2,  189.50, 12, 4),
  ('Caixa de Som Bluetooth',   2,  159.00,  3, 4),
  ('SSD NVMe 1TB',             3,  449.00, 18, 6),
  ('HD Externo 2TB',           3,  389.90,  4, 5),
  ('Pendrive 64GB',            3,   49.90, 60, 10),
  ('Monitor 24" IPS',          4,  899.00,  7, 3),
  ('Monitor 27" 144Hz',        4, 1499.00,  2, 2),
  ('Roteador Wi-Fi 6',         5,  549.00,  9, 3),
  ('Cabo de Rede Cat6 5m',     5,   29.90, 80, 15);

-- IDs gerados pelo trigger (CLI-000001…); CPFs válidos de teste
INSERT INTO clientes (nome, cpf, email, telefone, criado_por) VALUES
  ('Maria Silva',     '52998224725', 'maria.silva@email.com',  '61991234567', @u_vend),
  ('João Souza',      '11144477735', 'joao.souza@email.com',   '61998765432', @u_vend),
  ('Beatriz Lima',    '12345678909', 'beatriz.lima@email.com', NULL,          @u_admin),
  ('Pedro Almeida',   '98765432100', 'pedro.almeida@email.com','6133445566',  @u_vend);

-- Vendas de exemplo (passam por sp_registrar_venda → trigger baixa estoque)
CALL sp_registrar_venda(@u_vend,  'CLI-000001', '[{"produto":1,"quantidade":2},{"produto":8,"quantidade":3}]', @p, @t);
CALL sp_registrar_venda(@u_vend,  'CLI-000002', '[{"produto":6,"quantidade":1}]', @p, @t);
CALL sp_registrar_venda(@u_admin, 'CLI-000003', '[{"produto":9,"quantidade":1},{"produto":2,"quantidade":1}]', @p, @t);
CALL sp_registrar_venda(@u_vend,  'CLI-000004', '[{"produto":4,"quantidade":2},{"produto":12,"quantidade":4}]', @p, @t);
CALL sp_registrar_venda(@u_vend,  'CLI-000001', '[{"produto":11,"quantidade":1}]', @p, @t);

-- Espalha as vendas antigas em dias anteriores (o painel mostra "hoje" × "mês")
UPDATE pedidos SET data_pedido = data_pedido - INTERVAL 3 DAY WHERE id LIKE 'PED-%-000001';
UPDATE pedidos SET data_pedido = data_pedido - INTERVAL 2 DAY WHERE id LIKE 'PED-%-000002';
UPDATE pedidos SET data_pedido = data_pedido - INTERVAL 1 DAY WHERE id LIKE 'PED-%-000003';
