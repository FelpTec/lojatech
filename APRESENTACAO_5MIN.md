# Roteiro da apresentação (5 minutos)

**Preparação antes de entrar:**
- `docker compose up -d --build`;
- deixe abertas três abas do navegador e um terminal na pasta do projeto;
- faça login como **Vendedor** e deixe o carrinho com 1 produto;
- recrie o banco limpo com `docker compose down -v && docker compose up -d --build` se necessário.

| Tempo | Tópico | O que mostrar / dizer |
|---|---|---|
| **0:00–0:25** | Abertura | LojaTech: vendas e estoque. Ideia central: "o banco é o guardião das regras". Stack: MySQL 8.4, Node/Express, HTML/CSS/JS, Docker. |
| **0:25–1:05** | Modelagem | Abrir `docs/der.png`: N:N resolvido por `itens_pedido`, `grupos_usuarios`→`usuarios`, auditoria (`log_estoque`, `historico_precos`). IDs próprios `PED-2026-000001`, `USR-00001`, `CLI-000001`; AUTO_INCREMENT só em domínio e logs, justificado. |
| **1:05–2:05** | **Aplicação + TCL** | Fazer uma venda com 2 itens → modal "gravado com COMMIT", com o ID gerado pela function. **Concorrência + ROLLBACK:** na aba A (Vendedor), colocar no carrinho *Mouse* ×1 e *Monitor 27"* ×2 (todo o estoque), sem finalizar. Na aba B (Admin), vender *Monitor 27"* ×1. Voltar à aba A e finalizar → "Estoque insuficiente… A transação foi desfeita (ROLLBACK)". Em Produtos, o estoque do *Mouse* **não mudou**. Explicar o handler `ROLLBACK + RESIGNAL` e o `SELECT … FOR UPDATE`. |
| **2:05–2:35** | TCL no terminal (opcional) | `docker compose exec -T db mysql -ulojatech_dba -pDba@Senha2026! --force -t lojatech < db/demo/01_transacoes_tcl.sql`: ROLLBACK, COMMIT, SAVEPOINT e "sequência sem lacuna". |
| **2:35–3:10** | Índices | `docker compose exec -T db mysql -ulojatech_dba -pDba@Senha2026! lojatech < db/demo/03_indices_explain.sql`: `idx_pedidos_cliente_data` → `range`; o mesmo SELECT com `IGNORE INDEX` → `ALL`. Custo × benefício. |
| **3:10–3:50** | Views + stored objects | Na interface, cada tela mostra uma etiqueta **VIEW / TABELA / PROCEDURE** com a origem dos dados. `vw_clientes` mascara o CPF (LGPD). Triggers: baixa de estoque, histórico de preço (alterar um preço como Admin), CPF inválido barrado no banco. 9 functions e 5 procedures. |
| **3:50–4:40** | **Controle de acesso** | Tela **Segurança do BD**: `CURRENT_USER()` = `lojatech_app@%` (não é root), roles, `SHOW GRANTS` sem INSERT/UPDATE/DELETE. Clicar **"Tentar todas"**: 6 operações **NEGADAS pelo MySQL**. Entrar como **Consulta**: o botão de vender fica desabilitado e a procedure também recusa. |
| **4:40–5:00** | Fechamento | Validação em 3 camadas (navegador, API, banco), 25 testes automatizados (20 de ponta a ponta) passando, ambiente reproduzível com Docker. |

**Dicas:**
- Ensaiem com cronômetro. Se o tempo apertar, pule o bloco 2:05–2:35, porque a interface já demonstra o TCL.
- Tenham um vídeo de backup gravado da demonstração, para o caso de falha de rede ou de máquina.
- Possíveis perguntas do professor e respostas:
  - *"Por que não usar o root?"* → menor privilégio: um vazamento da senha da aplicação não permite ler senhas, CPFs nem apagar dados.
  - *"E se a procedure for chamada dentro de uma transação?"* → ela é dona da transação, e o START TRANSACTION interno confirmaria o que estava aberto. Por isso a API sempre chama em autocommit.
  - *"Por que o hash de senha fica no banco?"* → para a aplicação não precisar de SELECT na tabela de usuários. O trade-off é o SHA-256; bcrypt fica como trabalho futuro.
