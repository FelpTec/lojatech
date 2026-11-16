// =====================================================================
// LojaTech · NoSQL (MongoDB) · instalação reexecutável
//   Docker: roda sozinho (docker-entrypoint-initdb.d)
//   Manual: mongosh "<url de admin>" db/nosql/init/01_lojatech_nosql.js
//
// Persistência poliglota: o MySQL continua dono de preço, estoque e vendas
// (transacional, ACID). O MongoDB guarda apenas o que se beneficia do modelo
// de documentos:
//   * fichas_tecnicas — atributos que variam por categoria (esquema flexível)
//   * eventos         — log de atividade: alto volume, formato variável,
//                       expiração automática (TTL) e agregações
// =====================================================================
const NOME_BANCO = 'lojatech_nosql';
const SENHA_APP = (typeof process !== 'undefined' && process.env.MONGO_APP_PASS) || 'AppMongo@2026!';
const banco = db.getSiblingDB(NOME_BANCO);

banco.dropDatabase();                                           // recria do zero
try { banco.dropUser('lojatech_app'); } catch (e) { /* não existia */ }
try { banco.dropRole('r_lojatech_app_nosql'); } catch (e) { /* não existia */ }

// ---------------------------------------------------------------------
// COLEÇÃO fichas_tecnicas — _id = id do produto no MySQL (chave natural)
// O validador garante estrutura mínima sem engessar os atributos:
// qualquer chave em snake_case, com valor texto, número, booleano ou lista.
// ---------------------------------------------------------------------
banco.createCollection('fichas_tecnicas', {
  validator: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['_id', 'categoria', 'atributos', 'atualizado_em'],
      additionalProperties: false,
      properties: {
        _id: { bsonType: 'int', minimum: 1, description: 'id do produto no MySQL' },
        categoria: { bsonType: 'string', maxLength: 60 },
        atributos: {
          bsonType: 'object',
          maxProperties: 30,
          patternProperties: {
            '^[a-z][a-z0-9_]{0,39}$': { bsonType: ['string', 'int', 'long', 'double', 'decimal', 'bool', 'array'] },
          },
          additionalProperties: false,
        },
        destaques: { bsonType: 'array', maxItems: 5, items: { bsonType: 'string', maxLength: 80 } },
        atualizado_em: { bsonType: 'date' },
        atualizado_por: { bsonType: 'string' },
      },
    },
  },
  validationLevel: 'strict',
  validationAction: 'error',
});

// Índice curinga: busca por QUALQUER atributo (ex.: atributos.taxa_hz >= 120)
// sem precisar prever as chaves — impossível de forma eficiente em EAV.
banco.fichas_tecnicas.createIndex({ 'atributos.$**': 1 }, { name: 'idx_atributos_curinga' });
banco.fichas_tecnicas.createIndex({ categoria: 1 }, { name: 'idx_categoria' });

// ---------------------------------------------------------------------
// COLEÇÃO eventos — log append-only de atividade da aplicação
// ---------------------------------------------------------------------
const TIPOS_EVENTO = [
  'login_sucesso', 'login_falha', 'login_bloqueado',
  'venda_registrada', 'venda_recusada',
  'cliente_cadastrado', 'cliente_recusado',
  'estoque_reposto', 'preco_alterado', 'ficha_atualizada',
  'acesso_negado',
];
banco.createCollection('eventos', {
  validator: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['tipo', 'quando', 'origem'],
      properties: {
        tipo: { enum: TIPOS_EVENTO },
        quando: { bsonType: 'date' },
        usuario: {
          bsonType: ['object', 'null'],
          properties: { id: { bsonType: 'string' }, nome: { bsonType: 'string' }, grupo: { bsonType: 'string' } },
        },
        origem: {
          bsonType: 'object',
          required: ['rota'],
          properties: { rota: { bsonType: 'string' }, ip: { bsonType: 'string' }, navegador: { bsonType: 'string' } },
        },
        dados: { bsonType: 'object' },
      },
    },
  },
  validationLevel: 'strict',
  validationAction: 'error',
});

// TTL: o próprio MongoDB apaga eventos com mais de 90 dias (sem rotina de limpeza)
banco.eventos.createIndex({ quando: 1 }, { name: 'idx_ttl_90_dias', expireAfterSeconds: 90 * 24 * 3600 });
// Painel: contagem por tipo em um período
banco.eventos.createIndex({ tipo: 1, quando: -1 }, { name: 'idx_tipo_quando' });
// Auditoria: atividade de um funcionário
banco.eventos.createIndex({ 'usuario.id': 1, quando: -1 }, { name: 'idx_usuario_quando' });

// ---------------------------------------------------------------------
// SEGURANÇA — mesmo princípio do MySQL: menor privilégio, nada de root
//   * eventos: só insert + find  → o log é IMUTÁVEL para a aplicação
//   * fichas:  find + insert + update (sem remove)
//   * sem dropDatabase, createCollection, createIndex, createUser…
// ---------------------------------------------------------------------
banco.createRole({
  role: 'r_lojatech_app_nosql',
  privileges: [
    { resource: { db: NOME_BANCO, collection: 'eventos' }, actions: ['find', 'insert', 'collStats', 'listIndexes'] },
    { resource: { db: NOME_BANCO, collection: 'fichas_tecnicas' }, actions: ['find', 'insert', 'update', 'collStats', 'listIndexes'] },
    { resource: { db: NOME_BANCO, collection: '' }, actions: ['listCollections'] },
  ],
  roles: [],
});
banco.createUser({ user: 'lojatech_app', pwd: SENHA_APP, roles: [{ role: 'r_lojatech_app_nosql', db: NOME_BANCO }] });

// ---------------------------------------------------------------------
// DADOS — fichas dos 12 produtos do MySQL (ids 1..12)
// Note como cada categoria tem atributos totalmente diferentes.
// ---------------------------------------------------------------------
const agora = new Date();
const ficha = (id, categoria, atributos, destaques) =>
  ({ _id: NumberInt(id), categoria, atributos, destaques, atualizado_em: agora, atualizado_por: 'instalacao' });

banco.fichas_tecnicas.insertMany([
  ficha(1, 'Periféricos', { dpi: 16000, botoes: 7, conexao: 'USB', rgb: true, peso_g: 85 }, ['Sensor óptico 16.000 DPI', 'Ultraleve']),
  ficha(2, 'Periféricos', { layout: 'ABNT2', switch: 'Red linear', conexao: 'USB-C', rgb: true, anti_ghosting: true }, ['Switch linear silencioso']),
  ficha(3, 'Periféricos', { resolucao: '1920x1080', fps: 30, microfone: true, foco: 'automático' }, ['Microfone embutido']),
  ficha(4, 'Áudio', { drivers_mm: 50, surround: '7.1 virtual', microfone: true, conexao: 'USB' }, ['Som surround 7.1']),
  ficha(5, 'Áudio', { potencia_w: 20, bluetooth: '5.3', bateria_h: 12, resistencia: 'IPX7' }, ['À prova d’água', '12 h de bateria']),
  ficha(6, 'Armazenamento', { capacidade_gb: 1000, interface: 'PCIe 4.0 x4', leitura_mbps: 7000, gravacao_mbps: 6000, formato: 'M.2 2280' }, ['7.000 MB/s de leitura']),
  ficha(7, 'Armazenamento', { capacidade_gb: 2000, interface: 'USB 3.2', rpm: 5400, alimentacao: 'pela USB' }, ['Portátil, sem fonte']),
  ficha(8, 'Armazenamento', { capacidade_gb: 64, interface: 'USB 3.2', leitura_mbps: 150 }, []),
  ficha(9, 'Monitores', { tamanho_pol: 24, painel: 'IPS', resolucao: '1920x1080', taxa_hz: 75, conexoes: ['HDMI', 'VGA'] }, ['Cores fiéis (IPS)']),
  ficha(10, 'Monitores', { tamanho_pol: 27, painel: 'VA', resolucao: '2560x1440', taxa_hz: 144, conexoes: ['HDMI', 'DisplayPort'], hdr: true }, ['144 Hz para jogos', 'QHD']),
  ficha(11, 'Redes', { padrao: 'Wi-Fi 6 (802.11ax)', velocidade_mbps: 3000, antenas: 4, mesh: true }, ['Compatível com mesh']),
  ficha(12, 'Redes', { categoria_cabo: 'Cat6', comprimento_m: 5, blindado: false }, []),
]);

print(`lojatech_nosql instalado: ${banco.fichas_tecnicas.countDocuments()} fichas, coleções: ${banco.getCollectionNames().join(', ')}`);
