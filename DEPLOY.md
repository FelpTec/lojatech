# Publicação (deploy)

> **Decisão do grupo:** a apresentação será feita **localmente no notebook**, com Docker (`scripts/preparar-apresentacao.ps1`). Isso cobre aplicação, MySQL e MongoDB, sem custo e sem depender da internet da sala. As opções abaixo ficam documentadas para referência.

O LojaTech precisa de três peças:
- um servidor Node.js;
- um **MySQL 8 completo** (procedures, triggers, roles, criação de usuários);
- um **MongoDB**.

> **Por que não GitHub Pages?** Ele só hospeda arquivos estáticos; a API e os bancos não rodariam lá.

## Opção com link fixo: Railway (pago)

Aplicação, MySQL e MongoDB ficam no mesmo projeto, **sempre ligados** (sem a demora inicial dos planos gratuitos), e o link é fixo. Custo: crédito de teste de US$ 5 e, depois, o plano Hobby (cerca de US$ 5/mês).

### Passo a passo (CLI)

```bash
npm i -g @railway/cli
railway login                       # abre o navegador
railway init -n lojatech            # cria o projeto
railway add --database mysql
railway add --database mongo
railway add --service app           # serviço da aplicação (usa o Dockerfile)
```

**1. Instalar os bancos.** Use as URLs públicas: no painel, cada banco tem **Connect → Public Network**. As contas administrativas servem **só** para a instalação; a aplicação nunca as usa.

```bash
# MySQL (4 scripts, na ordem)
for f in db/init/*.sql; do
  docker run --rm -i mysql:8.4 mysql -h <host> -P <porta> -u root -p<senha> --default-character-set=utf8mb4 < "$f"
done

# MongoDB (cria coleções, validadores, índices, role e o usuário lojatech_app)
docker run --rm -v "$PWD/db/nosql/init:/init:ro" -e MONGO_APP_PASS='<senha forte>' mongo:8.0 \
  mongosh "<MONGO_PUBLIC_URL>" /init/01_lojatech_nosql.js
```

**2. Configurar as variáveis** do serviço `app` (Variables):

```
DB_HOST=${{MySQL.MYSQLHOST}}
DB_PORT=${{MySQL.MYSQLPORT}}
DB_USER=lojatech_app
DB_PASS=App@Senha2026!
MONGO_HOST=${{MongoDB.RAILWAY_PRIVATE_DOMAIN}}
MONGO_PORT=27017
MONGO_USER=lojatech_app
MONGO_PASS=<a mesma senha do passo 1>
SESSION_SECRET=<valor aleatório longo>
TRUST_PROXY=1
TZ=America/Sao_Paulo
```

**3. Publicar:** `railway up --service app`. Depois, em **Settings → Networking → Generate Domain**, gere o link público.

**4. Verificar:** `BASE_URL=https://<seu-domínio> npm test` deve mostrar 31 testes passando.

## Alternativa sem custo: link temporário (túnel)

Expõe o ambiente local por um túnel da Cloudflare:

```bash
docker compose up -d --build
TRUST_PROXY=1 docker compose --profile tunel up -d
docker compose logs tunel | grep -o 'https://[a-z0-9-]*\.trycloudflare\.com'
```

O link muda a cada reinício e depende do computador ligado. Serve para testes do grupo.

## Plano B no dia: rodar localmente

Levem o notebook com Docker e o projeto já iniciado (`docker compose up -d --build` antes da aula). Funciona **sem internet** e é a opção mais segura caso a rede da sala falhe.

---

Troque as senhas de demonstração (`db/init/03_seguranca.sql`, `MONGO_APP_PASS` e `.env`) antes de qualquer uso real.
