/*
 * LojaTech — API (Node.js + Express + mysql2)
 * Conecta ao MySQL com a conta de MENOR PRIVILÉGIO lojatech_app (nunca root).
 * Toda escrita é feita por stored procedures; leituras por views/tabelas
 * explicitamente liberadas em db/init/03_seguranca.sql.
 */
'use strict';
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const mysql = require('mysql2/promise');
const V = require('./public/js/validacao');
const nosql = require('./nosql');

try { process.loadEnvFile(path.join(__dirname, '.env')); } catch { /* .env opcional (Docker/Vercel injetam variáveis) */ }

const PORTA = Number(process.env.PORT) || 3000;
const SEGREDO = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const SESSAO_HORAS = 8;
if (!process.env.SESSION_SECRET) console.warn('[aviso] SESSION_SECRET não definido: sessões expiram ao reiniciar.');
if ((process.env.DB_USER || '').toLowerCase() === 'root') {
  console.error('[erro] A aplicação não pode usar a conta root. Use lojatech_app.');
  process.exit(1);
}

// ---------------------------------------------------------------------
// Pool de conexões
// ---------------------------------------------------------------------
const pool = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'lojatech_app',
  password: process.env.DB_PASS,
  database: process.env.DB_NAME || 'lojatech',
  waitForConnections: true,
  connectionLimit: 10,
  dateStrings: true,          // datas como texto: sem conversão de fuso no driver
  decimalNumbers: true,       // DECIMAL → number no JSON
  charset: 'utf8mb4',
  ssl: process.env.DB_SSL === 'true'
    ? { rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false' }
    : undefined,
});

// ---------------------------------------------------------------------
// Erros: mensagens de regra de negócio (SQLSTATE 45000) vão ao usuário;
// o resto vira mensagem genérica (sem expor estrutura do banco).
// ---------------------------------------------------------------------
class ErroHttp extends Error {
  constructor(status, mensagem, campos) { super(mensagem); this.status = status; this.campos = campos; }
}

function traduzErroBanco(e) {
  if (e instanceof ErroHttp) return e;
  if (e.sqlState === '45000') return new ErroHttp(422, e.sqlMessage);
  switch (e.errno) {
    case 1142: case 1143: case 1370: return new ErroHttp(403, 'Operação negada pelas permissões do banco de dados');
    case 1062: return new ErroHttp(409, 'Registro duplicado');
    case 3819: case 1406: case 1264: return new ErroHttp(422, 'Dados fora do formato aceito pelo banco');
    case 1451: case 1452: return new ErroHttp(422, 'Referência inválida a outro registro');
  }
  if (['ECONNREFUSED', 'PROTOCOL_CONNECTION_LOST', 'ETIMEDOUT', 'ENOTFOUND'].includes(e.code)) {
    return new ErroHttp(503, 'Banco de dados indisponível no momento');
  }
  console.error('[erro interno]', e);
  return new ErroHttp(500, 'Erro interno. Tente novamente.');
}

const rota = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function exigirValido(erros) {
  if (Object.keys(erros).length) throw new ErroHttp(422, 'Verifique os campos destacados', erros);
}

// Chama procedure com parâmetros OUT na MESMA conexão (variáveis @ são
// por sessão: CALL e SELECT em conexões diferentes do pool dariam errado).
async function chamarProcedure(sql, params, saidas) {
  const conn = await pool.getConnection();
  try {
    await conn.query(sql, params);
    if (!saidas) return {};
    const [[linha]] = await conn.query(`SELECT ${saidas.map((s) => `@${s} AS ${s}`).join(', ')}`);
    return linha;
  } finally {
    conn.release();
  }
}

// ---------------------------------------------------------------------
// Sessão: token assinado (HMAC-SHA256), sem estado no servidor.
// As permissões são relidas do banco a cada requisição (vw_usuarios_publico),
// então mudar o grupo de um usuário vale imediatamente.
// ---------------------------------------------------------------------
const b64 = (s) => Buffer.from(s).toString('base64url');
const assinar = (dados) => crypto.createHmac('sha256', SEGREDO).update(dados).digest('base64url');

function criarToken(usuarioId) {
  const dados = b64(JSON.stringify({ id: usuarioId, exp: Date.now() + SESSAO_HORAS * 3600e3 }));
  return `${dados}.${assinar(dados)}`;
}

function lerToken(token) {
  const [dados, assinatura] = String(token || '').split('.');
  if (!dados || !assinatura) return null;
  const esperada = assinar(dados);
  if (assinatura.length !== esperada.length ||
      !crypto.timingSafeEqual(Buffer.from(assinatura), Buffer.from(esperada))) return null;
  try {
    const p = JSON.parse(Buffer.from(dados, 'base64url').toString());
    return p.exp > Date.now() ? p : null;
  } catch { return null; }
}

const autenticar = rota(async (req, _res, next) => {
  const sessao = lerToken((req.get('authorization') || '').replace(/^Bearer /, ''));
  if (!sessao) throw new ErroHttp(401, 'Sessão expirada. Entre novamente.');
  const [[u]] = await pool.query('SELECT * FROM vw_usuarios_publico WHERE id = ? AND ativo', [sessao.id]);
  if (!u) throw new ErroHttp(401, 'Usuário inativo ou removido.');
  req.usuario = u;
  next();
});

const exigirPermissao = (flag, texto) => (req, _res, next) => {
  if (req.usuario[flag]) return next();
  nosql.registrarEvento('acesso_negado', req, { permissao: flag });
  next(new ErroHttp(403, `Seu perfil não pode ${texto}`));
};

// Executa a operação no MySQL; se a regra de negócio recusar, registra o
// motivo como evento no MongoDB (auditoria) e repassa o erro.
async function comRecusa(req, tipo, dados, operacao) {
  try {
    return await operacao();
  } catch (e) {
    if (e.sqlState === '45000') nosql.registrarEvento(tipo, req, { ...dados, motivo: e.sqlMessage });
    throw e;
  }
}

// Proteção contra força bruta no login. Cada tentativa é CONTADA ANTES de
// qualquer await (sem corrida entre requisições simultâneas):
//  * por IP (IPv6 agrupado por /64) e por IP+e-mail: mais de 5 tentativas sem
//    sucesso em 1 minuto → 429;
//  * por conta: atraso progressivo (até 5 s), sem bloquear, para que um
//    terceiro não consiga trancar a conta de outra pessoa.
// Se o mapa enche, o login fica indisponível para todos (falha fechada).
const net = require('net');
const tentativas = new Map();
const LIMITE_MAPA = 10000;
const JANELA_MS = 60e3;
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

function chaveIp(ip) {
  let a = String(ip || '').split('%')[0];                       // remove zone id
  if (/^::ffff:\d+\.\d+\.\d+\.\d+$/i.test(a)) a = a.slice(7);     // IPv4 mapeado
  if (net.isIPv4(a) || !net.isIPv6(a)) return a;
  const [esq, dir = ''] = a.split('::');                        // expande "::"
  const e = esq ? esq.split(':') : [];
  const d = a.includes('::') ? (dir ? dir.split(':') : []) : [];
  const grupos = a.includes('::') ? [...e, ...Array(8 - e.length - d.length).fill('0'), ...d] : e;
  return grupos.slice(0, 4).map((g) => parseInt(g, 16).toString(16)).join(':') + '::/64';
}

const chavesLogin = (ip, email) => {
  const e = String(email).trim().toLowerCase();
  const i = chaveIp(ip);
  return { limite: [`ip:${i}`, `ip-email:${i}|${e}`], conta: `conta:${e}` };
};

function limparExpirados() {
  const corte = Date.now() - 15 * 60e3;
  for (const [k, t] of tentativas) if (t.ultimo < corte) tentativas.delete(k);
}

// Síncrona: registra a tentativa e decide se ela pode prosseguir.
function reservarTentativa({ limite, conta }) {
  if (tentativas.size >= LIMITE_MAPA) limparExpirados();
  if (tentativas.size >= LIMITE_MAPA) throw new ErroHttp(503, 'Login temporariamente indisponível. Tente em instantes.');
  const agora = Date.now();
  let excedeu = false;
  for (const k of limite) {
    let t = tentativas.get(k);
    if (!t || agora - t.inicio > JANELA_MS) t = { n: 0, inicio: agora, ultimo: agora };
    t.n += 1; t.ultimo = agora;
    tentativas.set(k, t);
    if (t.n > 5) excedeu = true;
  }
  const c = tentativas.get(conta) || { n: 0, inicio: agora, ultimo: agora };
  if (agora - c.ultimo > 15 * 60e3) { c.n = 0; }
  c.n += 1; c.ultimo = agora;
  tentativas.set(conta, c);
  if (excedeu) throw new ErroHttp(429, 'Muitas tentativas. Aguarde 1 minuto.');
  return c.n > 4 ? Math.min(250 * 2 ** (c.n - 5), 5000) : 0;   // atraso por conta
}

function liberarTentativas({ limite, conta }) { [...limite, conta].forEach((k) => tentativas.delete(k)); }

// ---------------------------------------------------------------------
// App
// ---------------------------------------------------------------------
const app = express();
app.disable('x-powered-by');
// Só confia em X-Forwarded-For quando há proxy conhecido na frente (senão o IP seria forjável)
if (process.env.TRUST_PROXY) app.set('trust proxy', Number(process.env.TRUST_PROXY) || process.env.TRUST_PROXY);
app.use(express.json({ limit: '20kb' }));
app.use((_req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy':
      "default-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'",
  });
  next();
});
app.use(express.static(path.join(__dirname, 'public')));

// ---- Públicas ---------------------------------------------------------
app.get('/api/saude', rota(async (_req, res) => {
  const [[r]] = await pool.query('SELECT CURRENT_USER() AS conta_bd, VERSION() AS versao_mysql');
  res.json({ ok: true, ...r });
}));

app.post('/api/login', rota(async (req, res) => {
  const { email, senha } = req.body || {};
  exigirValido(V.validarLogin({ email, senha }));
  // No log vai só uma forma mascarada (v***@dominio): um e-mail digitado errado,
  // ou uma senha colada no campo errado, não fica legível no MongoDB.
  const emailNorm = email.trim().toLowerCase();
  const emailLog = emailNorm.replace(/^(.)[^@]*(@.*)$/, '$1***$2');
  const chaves = chavesLogin(req.ip, email);
  let atraso;
  try {
    atraso = reservarTentativa(chaves);              // conta ANTES de qualquer await
  } catch (e) {
    if (e.status === 429) nosql.registrarEvento('login_bloqueado', req, { email: emailLog });
    throw e;
  }
  if (atraso) await dormir(atraso);
  const [[r]] = await pool.query('SELECT fn_autenticar(?, ?) AS id', [email.trim(), senha]);
  if (!r.id) {
    nosql.registrarEvento('login_falha', req, { email: emailLog });
    throw new ErroHttp(401, 'E-mail ou senha incorretos');
  }
  liberarTentativas(chaves);
  const [[u]] = await pool.query('SELECT * FROM vw_usuarios_publico WHERE id = ?', [r.id]);
  req.usuario = u;
  nosql.registrarEvento('login_sucesso', req);
  res.json({ token: criarToken(r.id), usuario: u });
}));

// ---- Autenticadas -------------------------------------------------------
app.use('/api', autenticar);

app.get('/api/me', (req, res) => res.json(req.usuario));

app.get('/api/painel', rota(async (_req, res) => {
  const [[indicadores]] = await pool.query('SELECT * FROM vw_painel');
  const [recentes] = await pool.query('SELECT * FROM vw_resumo_pedidos ORDER BY data_pedido DESC LIMIT 5');
  const [estoqueBaixo] = await pool.query('SELECT * FROM vw_estoque_baixo ORDER BY estoque - estoque_minimo, nome LIMIT 5');
  res.json({ indicadores, recentes, estoqueBaixo });
}));

app.get('/api/categorias', rota(async (_req, res) => {
  const [r] = await pool.query('SELECT id, nome FROM categorias ORDER BY nome');
  res.json(r);
}));

// Entidade exibida diretamente da TABELA produtos
app.get('/api/produtos', rota(async (req, res) => {
  const categoria = req.query.categoria ? Number(req.query.categoria) : null;
  const busca = typeof req.query.busca === 'string' ? req.query.busca.trim().slice(0, 60) : '';
  if (categoria !== null && !Number.isInteger(categoria)) throw new ErroHttp(422, 'Categoria inválida');
  const like = `%${busca.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const [r] = await pool.query(
    `SELECT p.id, p.nome, p.categoria_id, c.nome AS categoria, p.preco, p.estoque, p.estoque_minimo, p.ativo
       FROM produtos p JOIN categorias c ON c.id = p.categoria_id
      WHERE (? IS NULL OR p.categoria_id = ?) AND p.nome LIKE ?
      ORDER BY p.nome`, [categoria, categoria, like]);
  res.json(r);
}));

app.post('/api/produtos/:id/reposicao', exigirPermissao('pode_gerenciar_estoque', 'gerenciar estoque'),
  rota(async (req, res) => {
    const id = Number(req.params.id);
    const { quantidade, motivo } = req.body || {};
    if (!Number.isInteger(id) || id < 1) throw new ErroHttp(404, 'Produto não encontrado');
    exigirValido(V.validarReposicao({ quantidade, motivo }));
    await chamarProcedure('CALL sp_repor_estoque(?, ?, ?, ?)', [req.usuario.id, id, quantidade, motivo.trim()]);
    nosql.registrarEvento('estoque_reposto', req, { produto: id, quantidade, motivo: motivo.trim() });
    res.json({ ok: true });
  }));

app.put('/api/produtos/:id/preco', exigirPermissao('pode_gerenciar_estoque', 'alterar preços'),
  rota(async (req, res) => {
    const id = Number(req.params.id);
    const { preco } = req.body || {};
    if (!Number.isInteger(id) || id < 1) throw new ErroHttp(404, 'Produto não encontrado');
    exigirValido(V.validarPreco({ preco }));
    await chamarProcedure('CALL sp_atualizar_preco(?, ?, ?)', [req.usuario.id, id, preco]);
    nosql.registrarEvento('preco_alterado', req, { produto: id, preco });
    res.json({ ok: true });
  }));

app.get('/api/estoque-baixo', rota(async (_req, res) => {
  const [r] = await pool.query('SELECT * FROM vw_estoque_baixo ORDER BY estoque - estoque_minimo, nome');
  res.json(r);
}));

// Clientes: somente pela VIEW com CPF mascarado
app.get('/api/clientes', rota(async (req, res) => {
  const busca = typeof req.query.busca === 'string' ? req.query.busca.trim().slice(0, 60) : '';
  const like = `%${busca.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const [r] = await pool.query(
    'SELECT * FROM vw_clientes WHERE nome LIKE ? OR email LIKE ? ORDER BY nome', [like, like]);
  res.json(r);
}));

app.post('/api/clientes', exigirPermissao('pode_cadastrar_clientes', 'cadastrar clientes'),
  rota(async (req, res) => {
    const { nome, cpf, email, telefone } = req.body || {};
    exigirValido(V.validarCliente({ nome, cpf, email, telefone }));
    const { id } = await comRecusa(req, 'cliente_recusado', {}, () => chamarProcedure(
      'CALL sp_cadastrar_cliente(?, ?, ?, ?, ?, @id)',
      [req.usuario.id, nome.trim(), V.soDigitos(cpf), email.trim(), V.soDigitos(telefone) || null], ['id']));
    nosql.registrarEvento('cliente_cadastrado', req, { cliente: id });   // sem CPF/e-mail no log (LGPD)
    res.status(201).json({ ok: true, id });
  }));

// Pedidos: VIEWS vw_resumo_pedidos e vw_vendas_detalhadas
app.get('/api/pedidos', rota(async (_req, res) => {
  const [r] = await pool.query('SELECT * FROM vw_resumo_pedidos ORDER BY data_pedido DESC, pedido DESC LIMIT 100');
  res.json(r);
}));

app.get('/api/pedidos/:id', rota(async (req, res) => {
  if (!V.RE_PEDIDO_ID.test(req.params.id)) throw new ErroHttp(404, 'Pedido não encontrado');
  const [itens] = await pool.query('SELECT * FROM vw_vendas_detalhadas WHERE pedido = ? ORDER BY produto', [req.params.id]);
  if (!itens.length) throw new ErroHttp(404, 'Pedido não encontrado');
  const [[t]] = await pool.query('SELECT fn_total_pedido(?) AS total', [req.params.id]);
  res.json({ pedido: req.params.id, total: t.total, itens });
}));

app.post('/api/vendas', exigirPermissao('pode_vender', 'registrar vendas'), rota(async (req, res) => {
  const { cliente, itens } = req.body || {};
  exigirValido(V.validarVenda({ cliente, itens }));
  const limpos = itens.map(({ produto, quantidade }) => ({ produto, quantidade }));
  const r = await comRecusa(req, 'venda_recusada', { cliente, itens: limpos }, () => chamarProcedure(
    'CALL sp_registrar_venda(?, ?, ?, @pedido, @total)',
    [req.usuario.id, cliente, JSON.stringify(limpos)], ['pedido', 'total']));
  nosql.registrarEvento('venda_registrada', req, { pedido: r.pedido, total: r.total, cliente, itens: limpos });
  res.status(201).json({ ok: true, ...r });
}));

app.get('/api/usuarios', rota(async (_req, res) => {
  const [r] = await pool.query('SELECT id, nome, email, grupo, ativo, ultimo_login, pode_vender, pode_gerenciar_estoque, pode_cadastrar_clientes FROM vw_usuarios_publico ORDER BY nome');
  res.json(r);
}));

// ---- NoSQL (MongoDB): fichas técnicas e painel de atividade -----------
const idProduto = (v) => {
  const id = Number(v);
  if (!Number.isInteger(id) || id < 1) throw new ErroHttp(404, 'Produto não encontrado');
  return id;
};

app.get('/api/fichas', rota(async (_req, res) => {
  res.json(await nosql.fichas.listar());
}));

app.get('/api/produtos/:id/ficha', rota(async (req, res) => {
  const id = idProduto(req.params.id);
  res.json((await nosql.fichas.obter(id)) || { _id: id, atributos: {}, destaques: [] });
}));

app.put('/api/produtos/:id/ficha', exigirPermissao('pode_gerenciar_estoque', 'editar fichas técnicas'),
  rota(async (req, res) => {
    const id = idProduto(req.params.id);
    const { atributos, destaques = [] } = req.body || {};
    exigirValido(V.validarFicha({ atributos, destaques }));
    // O produto precisa existir no MySQL (fonte da verdade); a categoria vem de lá
    const [[p]] = await pool.query(
      'SELECT c.nome AS categoria FROM produtos p JOIN categorias c ON c.id = p.categoria_id WHERE p.id = ?', [id]);
    if (!p) throw new ErroHttp(404, 'Produto não encontrado');
    const limpos = Object.fromEntries(Object.entries(atributos).map(([k, v]) =>
      [k, typeof v === 'string' ? v.trim() : Array.isArray(v) ? v.map((x) => x.trim()) : v]));
    await nosql.fichas.salvar(id, p.categoria, limpos, destaques.map((d) => d.trim()), req.usuario.id);
    nosql.registrarEvento('ficha_atualizada', req, { produto: id, atributos: Object.keys(limpos) });
    res.json({ ok: true });
  }));

app.get('/api/nosql/painel', rota(async (_req, res) => {
  const [painel, chaves] = await Promise.all([nosql.eventos.painel(), nosql.fichas.chaves()]);
  res.json({ ...painel, chaves, testes: await nosql.eventos.testarAcesso() });
}));

// Busca por atributo + junção (feita na aplicação) com nome/preço/estoque do MySQL
app.get('/api/nosql/busca', rota(async (req, res) => {
  const { chave, operador, valor } = req.query;
  exigirValido(V.validarBuscaAtributo({ chave, operador, valor }));
  const convertido = V.converterValorAtributo(valor);
  const v = operador === 'contem' || Array.isArray(convertido) ? String(valor).trim() : convertido;
  const r = await nosql.fichas.buscar(chave, operador, v);
  const ids = r.docs.map((d) => d._id);
  const [produtos] = ids.length
    ? await pool.query('SELECT id, nome, preco, estoque FROM produtos WHERE id IN (?)', [ids])
    : [[]];
  const porId = new Map(produtos.map((p) => [p.id, p]));
  res.json({
    filtro: r.filtro,
    plano: r.plano,
    resultados: r.docs.map((d) => ({ id: d._id, ...porId.get(d._id), categoria: d.categoria, valor: d.atributos[chave] })),
  });
}));

app.post('/api/nosql/testar/:acao', rota(async (req, res) => {
  const r = await nosql.eventos.testarAcesso(req.params.acao);
  if (!r) throw new ErroHttp(404, 'Teste desconhecido');
  res.json(r);
}));

// ---- Evidências de controle de acesso (para a apresentação) -----------
// Comandos FIXOS (nada vem do usuário) e inofensivos mesmo se fossem
// permitidos (WHERE 1=0 / tabela de teste). Servem para provar, ao vivo,
// que a conta da aplicação é barrada pelo próprio MySQL.
const TESTES_ACESSO = {
  ler_senhas:     'SELECT senha_hash FROM usuarios LIMIT 1',
  ler_cpf:        'SELECT cpf FROM clientes LIMIT 1',
  alterar_preco:  'UPDATE produtos SET preco = 0.01 WHERE 1 = 0',
  apagar_pedidos: 'DELETE FROM pedidos WHERE 1 = 0',
  criar_tabela:   'CREATE TABLE teste_invasao (id INT)',
  criar_usuario:  "CALL sp_cadastrar_usuario('Invasor', 'invasor@x.com', '12345678', 1, @x)",
};

app.get('/api/seguranca', rota(async (_req, res) => {
  const [[conta]] = await pool.query('SELECT CURRENT_USER() AS conta_bd, CURRENT_ROLE() AS roles, VERSION() AS versao_mysql');
  const [grants] = await pool.query('SHOW GRANTS');
  res.json({ ...conta, grants: grants.map((g) => Object.values(g)[0]), testes: Object.entries(TESTES_ACESSO).map(([id, sql]) => ({ id, sql })) });
}));

app.post('/api/seguranca/testar/:acao', rota(async (req, res) => {
  const sql = TESTES_ACESSO[req.params.acao];
  if (!sql) throw new ErroHttp(404, 'Teste desconhecido');
  try {
    await pool.query(sql);
    res.json({ sql, permitido: true });
  } catch (e) {
    if (![1142, 1143, 1370, 1044].includes(e.errno)) throw e;
    res.json({ sql, permitido: false, codigo: e.code, mensagem: e.sqlMessage });
  }
}));

// ---- Erros e fallback --------------------------------------------------
app.use('/api', (_req, _res, next) => next(new ErroHttp(404, 'Rota não encontrada')));
app.use((err, _req, res, _next) => {
  if (err.type === 'entity.parse.failed') err = new ErroHttp(400, 'JSON inválido');
  if (err.type === 'entity.too.large') err = new ErroHttp(413, 'Requisição grande demais');
  if (err instanceof nosql.NoSqlIndisponivel) err = new ErroHttp(503, err.message);
  else if (err?.code === 121) err = new ErroHttp(422, 'Documento rejeitado pelo validador de esquema do MongoDB');
  const e = traduzErroBanco(err);
  res.status(e.status).json({ erro: e.message, campos: e.campos });
});

if (require.main === module) {
  app.listen(PORTA, () => console.log(`LojaTech em http://localhost:${PORTA}`));
}
module.exports = app;
