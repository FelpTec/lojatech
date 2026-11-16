# Publicação (deploy)

O LojaTech precisa de **um servidor Node.js e um MySQL 8 completo**, com suporte a procedures, triggers, roles e criação de usuários.

> **Por que não GitHub Pages?** O GitHub Pages só hospeda arquivos estáticos. A API e o MySQL não rodariam lá, e o trabalho exige justamente a comunicação com o banco.

## Opção 1 — Link temporário (zero configuração)

Expõe o ambiente local por um túnel da Cloudflare:

```bash
docker compose up -d --build
TRUST_PROXY=1 docker compose --profile tunel up -d
docker compose logs tunel | grep -o 'https://[a-z0-9-]*\.trycloudflare\.com'
```

- O link muda a cada reinício.
- Ele só funciona enquanto o computador estiver ligado com o Docker rodando.
- É ideal para o grupo testar ou para a demonstração.

## Opção 2 — Railway (permanente, mais simples)

Roda o mesmo Dockerfile e um MySQL completo, com acesso administrativo para instalar os scripts.

1. Em https://railway.app, crie um projeto com **Deploy from GitHub repo** e escolha este repositório. O Dockerfile é detectado.
2. No mesmo projeto, adicione o serviço **MySQL** em **New → Database → MySQL**.
3. Instale o banco a partir da sua máquina. Use os dados de **MySQL → Connect → Public Network**; essa conta administrativa serve só para a instalação.
   ```bash
   for f in db/init/*.sql; do mysql -h <host> -P <porta> -u root -p<senha> --default-character-set=utf8mb4 < "$f"; done
   ```
4. No serviço da aplicação, configure as **Variables**:
   ```
   DB_HOST=${{MySQL.MYSQLHOST}}
   DB_PORT=${{MySQL.MYSQLPORT}}
   DB_USER=lojatech_app
   DB_PASS=App@Senha2026!
   SESSION_SECRET=<valor aleatório longo>
   ```
5. Em **Settings → Networking → Generate Domain**, o link público fica pronto.

## Opção 3 — Vercel (app) + Aiven (MySQL), plano gratuito

1. Crie um MySQL gratuito em https://aiven.io.
   - Em *Advanced configuration*, ative `log_bin_trust_function_creators`.
   - Remova a linha `SET GLOBAL …` do início e do fim de `db/init/02_rotinas.sql`, porque bancos gerenciados não dão esse privilégio.
2. Instale os scripts com `avnadmin`, como no passo 3 da opção 2.
3. Em https://vercel.com, use **Add New → Project** e importe o repositório. O `vercel.json` e o `api/index.js` já estão prontos.
4. Configure as *Environment Variables*:
   - `DB_HOST`, `DB_PORT`, `DB_USER=lojatech_app`, `DB_PASS`, `SESSION_SECRET`;
   - `DB_SSL=true`, porque o Aiven exige TLS.

## Depois de publicar

```bash
BASE_URL=https://seu-link npm test     # roda os 25 testes automatizados contra o deploy
```

Troque as senhas de demonstração de `db/init/03_seguranca.sql` e do `.env` antes de um uso real.
