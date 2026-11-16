/*
 * LojaTech — camada NoSQL (MongoDB).
 * Conecta com a conta lojatech_app do Mongo (role r_lojatech_app_nosql:
 * eventos só insert/find; fichas sem remove). Nunca com o usuário admin.
 *
 * O MongoDB é COMPLEMENTAR: se estiver fora do ar, vendas, estoque e
 * cadastros (MySQL) continuam funcionando; só as fichas técnicas e o painel
 * de atividade ficam indisponíveis, e os eventos deixam de ser gravados
 * (com aviso no log do servidor).
 */
'use strict';
const { MongoClient } = require('mongodb');

const NOME_BANCO = process.env.MONGO_DB || 'lojatech_nosql';

function urlConexao() {
  if (process.env.MONGO_URL) return process.env.MONGO_URL;
  if (!process.env.MONGO_HOST) return null;
  const usuario = encodeURIComponent(process.env.MONGO_USER || 'lojatech_app');
  const senha = encodeURIComponent(process.env.MONGO_PASS || '');
  const porta = process.env.MONGO_PORT || 27017;
  return `mongodb://${usuario}:${senha}@${process.env.MONGO_HOST}:${porta}/${NOME_BANCO}?authSource=${NOME_BANCO}`;
}

let cliente = null;
let conectando = null;
let ultimoAviso = 0;

function avisar(msg, e) {
  if (Date.now() - ultimoAviso > 60e3) {             // no máximo 1 aviso por minuto
    ultimoAviso = Date.now();
    console.warn(`[nosql] ${msg}:`, e?.message || e);
  }
}

class NoSqlIndisponivel extends Error {
  constructor() { super('Módulo NoSQL (MongoDB) indisponível no momento'); this.status = 503; }
}

async function banco() {
  const url = urlConexao();
  if (!url) throw new NoSqlIndisponivel();
  if (cliente) return cliente.db(NOME_BANCO);
  conectando ??= MongoClient.connect(url, { serverSelectionTimeoutMS: 2500, connectTimeoutMS: 2500, maxPoolSize: 10 })
    .then((c) => { cliente = c; return c; })
    .finally(() => { conectando = null; });
  try {
    return (await conectando).db(NOME_BANCO);
  } catch (e) {
    avisar('falha ao conectar', e);
    throw new NoSqlIndisponivel();
  }
}

// Executa uma operação; erros de rede viram 503 (os demais seguem adiante)
async function usar(fn) {
  const db = await banco();
  try {
    return await fn(db);
  } catch (e) {
    if (e.name === 'MongoServerSelectionError' || e.name === 'MongoNetworkError' || e.name === 'MongoNotConnectedError') {
      avisar('conexão perdida', e);
      throw new NoSqlIndisponivel();
    }
    throw e;
  }
}

// IP parcialmente anonimizado (LGPD): guarda só a rede, não o host
function ipAnonimo(ip) {
  const a = String(ip || '').replace(/^::ffff:/, '');
  if (/^\d+\.\d+\.\d+\.\d+$/.test(a)) return a.replace(/\.\d+$/, '.0');
  return a.split(':').slice(0, 3).join(':') + '::';
}

/**
 * Registra um evento sem atrasar nem derrubar a resposta ao usuário.
 * Falhas são logadas (não silenciosas), mas não interrompem a operação
 * principal, que já foi confirmada no MySQL.
 */
function registrarEvento(tipo, req, dados = {}) {
  const doc = {
    tipo,
    quando: new Date(),
    usuario: req.usuario ? { id: req.usuario.id, nome: req.usuario.nome, grupo: req.usuario.grupo } : null,
    origem: { rota: `${req.method} ${req.baseUrl || ''}${req.route?.path || req.path}`, ip: ipAnonimo(req.ip), navegador: String(req.get('user-agent') || '').slice(0, 120) },
    dados,
  };
  usar((db) => db.collection('eventos').insertOne(doc)).catch((e) => avisar(`evento "${tipo}" não gravado`, e));
}

const CAMPOS_FICHA = { categoria: 1, atributos: 1, destaques: 1, atualizado_em: 1, atualizado_por: 1 };

const fichas = {
  listar: () => usar((db) => db.collection('fichas_tecnicas').find({}, { projection: CAMPOS_FICHA }).toArray()),
  obter: (id) => usar((db) => db.collection('fichas_tecnicas').findOne({ _id: id }, { projection: CAMPOS_FICHA })),
  salvar: (id, categoria, atributos, destaques, autor) => usar((db) => db.collection('fichas_tecnicas').updateOne(
    { _id: id },
    { $set: { categoria, atributos, destaques, atualizado_em: new Date(), atualizado_por: autor } },
    { upsert: true },
  )),
  chaves: () => usar((db) => db.collection('fichas_tecnicas').aggregate([
    { $project: { kv: { $objectToArray: '$atributos' } } },
    { $unwind: '$kv' },
    { $group: { _id: '$kv.k', produtos: { $sum: 1 } } },
    { $sort: { _id: 1 } },
  ]).toArray()),
  async buscar(chave, operador, valor) {
    const campo = `atributos.${chave}`;
    const filtro = operador === 'contem'
      ? { [campo]: { $regex: valor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } }
      : { [campo]: { [`$${operador}`]: valor } };
    return usar(async (db) => {
      const col = db.collection('fichas_tecnicas');
      const [docs, plano] = await Promise.all([
        col.find(filtro, { projection: CAMPOS_FICHA }).limit(50).toArray(),
        col.find(filtro).explain('executionStats'),
      ]);
      const etapa = (p) => (p ? (p.indexName ? p : etapa(p.inputStage)) : null);
      const ix = etapa(plano.queryPlanner.winningPlan);
      return {
        filtro,
        docs,
        plano: {
          estagio: ix ? 'IXSCAN' : 'COLLSCAN',
          indice: ix?.indexName || null,
          docs_examinados: plano.executionStats.totalDocsExamined,
          chaves_examinadas: plano.executionStats.totalKeysExamined,
        },
      };
    });
  },
};

const eventos = {
  painel: () => usar(async (db) => {
    const col = db.collection('eventos');
    const desde = new Date(Date.now() - 24 * 3600e3);
    const [porTipo, porHora, recentes, porUsuario, total, totalFichas, indices, conexao] = await Promise.all([
      col.aggregate([{ $match: { quando: { $gte: desde } } }, { $group: { _id: '$tipo', total: { $sum: 1 } } }, { $sort: { total: -1 } }]).toArray(),
      col.aggregate([
        { $match: { quando: { $gte: desde } } },
        { $group: { _id: { $dateTrunc: { date: '$quando', unit: 'hour', timezone: 'America/Sao_Paulo' } }, total: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ]).toArray(),
      col.find({}, { projection: { _id: 0 } }).sort({ quando: -1 }).limit(15).toArray(),
      col.aggregate([
        { $match: { quando: { $gte: desde }, tipo: 'venda_registrada' } },
        { $group: { _id: '$usuario.nome', vendas: { $sum: 1 }, faturamento: { $sum: '$dados.total' } } },
        { $sort: { faturamento: -1 } },
      ]).toArray(),
      col.estimatedDocumentCount(),
      db.collection('fichas_tecnicas').estimatedDocumentCount(),
      Promise.all(['eventos', 'fichas_tecnicas'].map(async (c) => ({ colecao: c, indices: (await db.collection(c).indexes()).map((i) => ({ nome: i.name, chave: i.key, ttl_dias: i.expireAfterSeconds ? i.expireAfterSeconds / 86400 : undefined })) }))),
      db.command({ connectionStatus: 1 }),
    ]);
    const conta = conexao.authInfo.authenticatedUsers[0];
    return {
      conta: conta ? `${conta.user}@${conta.db}` : null,
      roles: conexao.authInfo.authenticatedUserRoles.map((r) => `${r.role}@${r.db}`),
      totais: { eventos: total, fichas: totalFichas },
      porTipo, porHora, recentes, porUsuario, indices,
    };
  }),
  // Operações FIXAS e proibidas para provar o menor privilégio no Mongo
  async testarAcesso(acao) {
    const testes = {
      apagar_eventos: { descricao: 'db.eventos.deleteMany({})', fn: (db) => db.collection('eventos').deleteMany({ _id: null }) },
      alterar_evento: { descricao: 'db.eventos.updateMany({}, …)', fn: (db) => db.collection('eventos').updateMany({ _id: null }, { $set: { tipo: 'x' } }) },
      apagar_fichas: { descricao: 'db.fichas_tecnicas.deleteOne(…)', fn: (db) => db.collection('fichas_tecnicas').deleteOne({ _id: -1 }) },
      apagar_banco: { descricao: 'db.dropDatabase()', fn: (db) => db.dropDatabase() },
    };
    if (!acao) return Object.entries(testes).map(([id, t]) => ({ id, descricao: t.descricao }));
    const t = testes[acao];
    if (!t) return null;
    return usar(async (db) => {
      try { await t.fn(db); return { descricao: t.descricao, permitido: true }; } catch (e) {
        if (e.code !== 13) throw e;                    // 13 = Unauthorized
        return { descricao: t.descricao, permitido: false, codigo: e.codeName, mensagem: e.errmsg || e.message };
      }
    });
  },
};

module.exports = { registrarEvento, fichas, eventos, NoSqlIndisponivel, configurado: () => !!urlConexao() };
