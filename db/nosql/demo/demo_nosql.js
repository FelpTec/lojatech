// =====================================================================
// DEMO NoSQL — executar como lojatech_app (NÃO como admin):
//   docker compose exec mongo mongosh -u lojatech_app -p 'AppMongo@2026!' --authenticationDatabase lojatech_nosql lojatech_nosql /demo/demo_nosql.js
// =====================================================================
const titulo = (t) => print(`\n===== ${t} =====`);

titulo('1) Esquema flexível: fichas com atributos diferentes por categoria');
db.fichas_tecnicas.find({ _id: { $in: [1, 6, 10] } }, { categoria: 1, atributos: 1 }).forEach((d) => printjson(d));

titulo('2) Busca por QUALQUER atributo com índice curinga (atributos.$**)');
const filtro = { 'atributos.taxa_hz': { $gte: 120 } };
printjson(db.fichas_tecnicas.find(filtro, { categoria: 1, 'atributos.taxa_hz': 1 }).toArray());
const plano = db.fichas_tecnicas.find(filtro).explain('executionStats');
print('estágio:', JSON.stringify(plano.queryPlanner.winningPlan.inputStage?.stage || plano.queryPlanner.winningPlan.stage),
      '| índice:', plano.queryPlanner.winningPlan.inputStage?.indexName,
      '| docs examinados:', plano.executionStats.totalDocsExamined);

titulo('3) Validação de esquema no banco (deve FALHAR: atributo com chave inválida)');
try {
  db.fichas_tecnicas.updateOne({ _id: 1 }, { $set: { 'atributos.Chave Inválida!': 1 } });
  print('(inesperado) aceitou');
} catch (e) { print('REJEITADO pelo validador:', e.code, e.codeName || 'DocumentValidationFailure'); }

titulo('4) Agregação: eventos por tipo nas últimas 24 h');
printjson(db.eventos.aggregate([
  { $match: { quando: { $gte: new Date(Date.now() - 24 * 3600e3) } } },
  { $group: { _id: '$tipo', total: { $sum: 1 } } },
  { $sort: { total: -1 } },
]).toArray());

titulo('5) TTL: eventos expiram sozinhos');
printjson(db.eventos.getIndexes().filter((i) => i.expireAfterSeconds).map((i) => ({ nome: i.name, expira_em_dias: i.expireAfterSeconds / 86400 })));

titulo('6) Controle de acesso: o log é imutável para a aplicação (devem FALHAR)');
for (const [nome, fn] of [
  ['apagar eventos', () => db.eventos.deleteMany({})],
  ['alterar evento', () => db.eventos.updateMany({}, { $set: { tipo: 'login_sucesso' } })],
  ['apagar o banco', () => db.dropDatabase()],
  ['criar usuário', () => db.createUser({ user: 'invasor', pwd: 'x', roles: [] })],
]) {
  try { fn(); print(`(inesperado) ${nome}: permitido`); } catch (e) { print(`NEGADO — ${nome}: ${e.codeName}`); }
}
