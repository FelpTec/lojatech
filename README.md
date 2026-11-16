# LojaTech · Vendas e Estoque sobre MySQL

Projeto acadêmico da disciplina de Banco de Dados, na **Universidade Católica de Brasília (UCB)**. É uma aplicação web completa (MySQL 8 + Node.js/Express + HTML/CSS/JS), com as regras de negócio implementadas dentro do SGBD.

| Recurso | Implementação |
|---|---|
| Tabelas e relacionamentos | 10 tabelas, PK/FK/UNIQUE/CHECK. DER em [`docs/der.png`](docs/der.png) |
| Índices | 5 índices justificados por consulta. Prova com `EXPLAIN` em [`db/demo/03_indices_explain.sql`](db/demo/03_indices_explain.sql) |
| Triggers | 6: IDs, CPF, baixa de estoque, itens imutáveis, histórico de preço |
| Views | 6: vendas, pedidos, estoque baixo, clientes (CPF mascarado), usuários (sem senha), painel |
| Functions / procedures | 9 functions (incluindo geração de IDs) e 5 procedures transacionais |
| TCL | COMMIT, ROLLBACK, SAVEPOINT e handler. Demo em [`db/demo/01_transacoes_tcl.sql`](db/demo/01_transacoes_tcl.sql) |
| Controle de acesso | 3 roles e 3 contas, sem root. Demo em [`db/demo/02_controle_acesso.sql`](db/demo/02_controle_acesso.sql) |
| Validação | Mesmas regras no navegador, na API e no banco ([`public/js/validacao.js`](public/js/validacao.js)) |
| Testes | 25 testes automatizados: 20 de ponta a ponta + 5 unitários (`npm test`) |

Documentação: [ARTIGO.md](ARTIGO.md) (artigo técnico) · [APRESENTACAO_5MIN.md](APRESENTACAO_5MIN.md) (roteiro) · [DEPLOY.md](DEPLOY.md) (publicação).

## Executar com Docker (recomendado)

```bash
docker compose up -d --build      # MySQL 8.4 + API; os scripts de db/init rodam sozinhos
# abra http://localhost:3000
npm install && npm test           # testes de ponta a ponta contra o ambiente no ar
```

Contas de demonstração (também aparecem na tela de login):

| Perfil | E-mail | Senha |
|---|---|---|
| Administrador | admin@lojatech.com | Admin@2026 |
| Vendedor | vendedor@lojatech.com | Vendedor@2026 |
| Consulta | consulta@lojatech.com | Consulta@2026 |

Para **recriar o banco do zero**: `docker compose down -v && docker compose up -d --build`.
O MySQL fica exposto em `localhost:3307`, para uso no Workbench com `lojatech_dba` / `Dba@Senha2026!`.

### Link público temporário para testes

```bash
docker compose --profile tunel up -d
docker compose logs tunel | grep trycloudflare.com    # copie o link https://….trycloudflare.com
```

O link funciona enquanto o computador estiver ligado com o Docker rodando. Para um link permanente, veja [DEPLOY.md](DEPLOY.md).

## Executar sem Docker (MySQL local)

1. Instale os scripts com uma conta administrativa, na ordem:
   ```bash
   for f in db/init/*.sql; do mysql -u <admin> -p --default-character-set=utf8mb4 < "$f"; done
   ```
2. `cp .env.example .env` e ajuste `DB_HOST`/`DB_PORT`. O `DB_USER` deve ser **`lojatech_app`**; o servidor se recusa a iniciar como root.
3. `npm install && npm start`, e abra http://localhost:3000.

## Estrutura

```
db/init/        01_estrutura · 02_rotinas · 03_seguranca · 04_dados   (instalação, reexecutável)
db/demo/        scripts para a apresentação (TCL, acesso, índices)
public/         frontend (index.html, css/, js/app.js, js/validacao.js)
server.js       API Express (conta lojatech_app)
tests/          testes de ponta a ponta e unitários
docs/           DER (png, svg, mermaid)
```
