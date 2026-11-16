/*
 * Testes de ponta a ponta: navegador → API → MySQL.
 * Pré-requisito: ambiente no ar (docker compose up -d --build).
 *   npm test                         (usa http://localhost:3000)
 *   BASE_URL=https://... npm test    (testa um deploy)
 */
'use strict';
const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');
const V = require('../public/js/validacao');

const BASE = process.env.BASE_URL || 'http://localhost:3000';

async function req(metodo, rota, { corpo, token, bruto } = {}) {
  const r = await fetch(BASE + rota, {
    method: metodo,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: bruto ?? (corpo ? JSON.stringify(corpo) : undefined),
  });
  return { status: r.status, dados: await r.json().catch(() => ({})) };
}

const login = async (email, senha) => (await req('POST', '/api/login', { corpo: { email, senha } })).dados.token;

function cpfAleatorio() {
  const base = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10)).join('');
  for (let d1 = 0; d1 < 10; d1++) for (let d2 = 0; d2 < 10; d2++) {
    if (V.cpfValido(base + d1 + d2)) return base + d1 + d2;
  }
  return cpfAleatorio();
}

let admin; let vendedor; let consulta;
before(async () => {
  admin = await login('admin@lojatech.com', 'Admin@2026');
  vendedor = await login('vendedor@lojatech.com', 'Vendedor@2026');
  consulta = await login('consulta@lojatech.com', 'Consulta@2026');
  assert.ok(admin && vendedor && consulta, 'logins de demonstração devem funcionar');
});

describe('Conexão e autenticação', () => {
  test('API conecta com a conta lojatech_app (não root)', async () => {
    const { dados } = await req('GET', '/api/saude');
    assert.match(dados.conta_bd, /^lojatech_app@/);
  });

  test('login valida o formato antes de ir ao banco', async () => {
    const { status, dados } = await req('POST', '/api/login', { corpo: { email: 'sem-arroba', senha: '' } });
    assert.equal(status, 422);
    assert.ok(dados.campos.email && dados.campos.senha);
  });

  test('senha errada → 401 sem revelar qual campo errou', async () => {
    const { status, dados } = await req('POST', '/api/login', { corpo: { email: 'vendedor@lojatech.com', senha: 'errada' } });
    assert.equal(status, 401);
    assert.equal(dados.erro, 'E-mail ou senha incorretos');
  });

  test('rotas protegidas exigem token válido e íntegro', async () => {
    assert.equal((await req('GET', '/api/painel')).status, 401);
    const adulterado = vendedor.slice(0, -2) + (vendedor.endsWith('A') ? 'BB' : 'AA');
    assert.equal((await req('GET', '/api/painel', { token: adulterado })).status, 401);
  });

  test('JSON malformado → 400', async () => {
    assert.equal((await req('POST', '/api/login', { bruto: '{"email":' })).status, 400);
  });
});

describe('Leitura: entidade e views', () => {
  test('produtos vêm da tabela, com filtro por categoria', async () => {
    const { dados } = await req('GET', '/api/produtos?categoria=1', { token: consulta });
    assert.ok(dados.length > 0);
    assert.ok(dados.every((p) => p.categoria_id === 1));
  });

  test('clientes vêm da view com CPF mascarado', async () => {
    const { dados } = await req('GET', '/api/clientes', { token: consulta });
    assert.ok(dados.length > 0);
    assert.ok(dados.every((c) => /^\*\*\*\.\d{3}\.\d{3}-\*\*$/.test(c.cpf_mascarado) && !('cpf' in c)));
  });

  test('painel agrega indicadores da vw_painel', async () => {
    const { dados } = await req('GET', '/api/painel', { token: consulta });
    assert.ok('faturamento_mes' in dados.indicadores);
  });
});

describe('Venda (transação)', () => {
  const estoqueDe = async (id) => (await req('GET', '/api/produtos', { token: admin })).dados.find((p) => p.id === id).estoque;

  test('validação: quantidade decimal, carrinho vazio e cliente inválido', async () => {
    let r = await req('POST', '/api/vendas', { token: vendedor, corpo: { cliente: 'CLI-000001', itens: [{ produto: 1, quantidade: 1.5 }] } });
    assert.equal(r.status, 422); assert.ok(r.dados.campos.itens);
    r = await req('POST', '/api/vendas', { token: vendedor, corpo: { cliente: 'CLI-000001', itens: [] } });
    assert.equal(r.status, 422);
    r = await req('POST', '/api/vendas', { token: vendedor, corpo: { cliente: "1' OR 1=1", itens: [{ produto: 1, quantidade: 1 }] } });
    assert.equal(r.status, 422); assert.ok(r.dados.campos.cliente);
  });

  test('venda válida gera ID próprio, total e baixa estoque (COMMIT)', async () => {
    const antes = await estoqueDe(8);
    const r = await req('POST', '/api/vendas', { token: vendedor, corpo: { cliente: 'CLI-000002', itens: [{ produto: 8, quantidade: 2 }] } });
    assert.equal(r.status, 201);
    assert.match(r.dados.pedido, /^PED-\d{4}-\d{6}$/);
    assert.ok(r.dados.total > 0);
    assert.equal(await estoqueDe(8), antes - 2);
    const det = await req('GET', `/api/pedidos/${r.dados.pedido}`, { token: consulta });
    assert.equal(det.dados.total, r.dados.total);
  });

  test('sem estoque no 2º item → ROLLBACK de tudo', async () => {
    const antes1 = await estoqueDe(8);
    const antesPedidos = (await req('GET', '/api/pedidos', { token: admin })).dados.length;
    const r = await req('POST', '/api/vendas', { token: vendedor, corpo: { cliente: 'CLI-000002', itens: [{ produto: 8, quantidade: 1 }, { produto: 10, quantidade: 999 }] } });
    assert.equal(r.status, 422);
    assert.match(r.dados.erro, /Estoque insuficiente/);
    assert.equal(await estoqueDe(8), antes1, 'o 1º item não pode ter baixado estoque');
    assert.equal((await req('GET', '/api/pedidos', { token: admin })).dados.length, antesPedidos);
  });

  test('cliente inexistente é barrado pela procedure', async () => {
    const r = await req('POST', '/api/vendas', { token: vendedor, corpo: { cliente: 'CLI-999999', itens: [{ produto: 1, quantidade: 1 }] } });
    assert.equal(r.status, 422);
    assert.equal(r.dados.erro, 'Cliente não encontrado');
  });

  test('perfil Consulta não pode vender', async () => {
    const r = await req('POST', '/api/vendas', { token: consulta, corpo: { cliente: 'CLI-000001', itens: [{ produto: 1, quantidade: 1 }] } });
    assert.equal(r.status, 403);
  });
});

describe('Clientes (validação ponta a ponta)', () => {
  test('CPF inválido, e-mail inválido e telefone curto', async () => {
    const r = await req('POST', '/api/clientes', { token: vendedor, corpo: { nome: 'Fu', cpf: '123.456.789-00', email: 'x', telefone: '123' } });
    assert.equal(r.status, 422);
    assert.deepEqual(Object.keys(r.dados.campos).sort(), ['cpf', 'email', 'nome', 'telefone']);
  });

  test('cadastro válido gera CLI-NNNNNN; repetir CPF é barrado pelo banco', async () => {
    const cpf = cpfAleatorio();
    const corpo = { nome: 'Cliente de Teste', cpf: cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4'), email: `teste.${cpf}@email.com`, telefone: '(61) 98888-7777' };
    const r = await req('POST', '/api/clientes', { token: vendedor, corpo });
    assert.equal(r.status, 201);
    assert.match(r.dados.id, /^CLI-\d{6}$/);
    const dup = await req('POST', '/api/clientes', { token: vendedor, corpo: { ...corpo, email: `outro.${cpf}@email.com` } });
    assert.equal(dup.status, 422);
    assert.equal(dup.dados.erro, 'Já existe cliente com este CPF');
  });

  test('perfil Consulta não pode cadastrar', async () => {
    const r = await req('POST', '/api/clientes', { token: consulta, corpo: { nome: 'Fulano', cpf: cpfAleatorio(), email: 'f@e.com' } });
    assert.equal(r.status, 403);
  });
});

describe('Estoque e preços', () => {
  test('vendedor não repõe estoque; admin repõe', async () => {
    assert.equal((await req('POST', '/api/produtos/5/reposicao', { token: vendedor, corpo: { quantidade: 1, motivo: 'Teste' } })).status, 403);
    const r = await req('POST', '/api/produtos/5/reposicao', { token: admin, corpo: { quantidade: 1, motivo: 'Teste automatizado' } });
    assert.equal(r.status, 200);
  });

  test('validação de reposição e preço', async () => {
    let r = await req('POST', '/api/produtos/5/reposicao', { token: admin, corpo: { quantidade: 0, motivo: 'x' } });
    assert.equal(r.status, 422); assert.ok(r.dados.campos.quantidade && r.dados.campos.motivo);
    r = await req('PUT', '/api/produtos/5/preco', { token: admin, corpo: { preco: 10.999 } });
    assert.equal(r.status, 422);
    r = await req('PUT', '/api/produtos/5/preco', { token: admin, corpo: { preco: -1 } });
    assert.equal(r.status, 422);
  });

  test('alteração de preço válida', async () => {
    const r = await req('PUT', '/api/produtos/5/preco', { token: admin, corpo: { preco: 159.0 } });
    assert.equal(r.status, 200);
  });
});

describe('Controle de acesso no MySQL', () => {
  test('todas as tentativas proibidas são negadas pelo banco', async () => {
    const { dados } = await req('GET', '/api/seguranca', { token: consulta });
    assert.ok(dados.grants.every((g) => !/\b(INSERT|UPDATE|DELETE|DROP|ALL PRIVILEGES)\b/.test(g)));
    for (const t of dados.testes) {
      const r = await req('POST', `/api/seguranca/testar/${t.id}`, { token: consulta });
      assert.equal(r.dados.permitido, false, `${t.id} deveria ser negado`);
    }
  });
});

describe('NoSQL (MongoDB)', () => {
  const espera = (ms) => new Promise((r) => setTimeout(r, ms));

  test('fichas têm atributos diferentes por categoria', async () => {
    const { status, dados } = await req('GET', '/api/fichas', { token: consulta });
    assert.equal(status, 200);
    const monitor = dados.find((f) => f._id === 10);
    const ssd = dados.find((f) => f._id === 6);
    assert.ok('taxa_hz' in monitor.atributos && !('taxa_hz' in ssd.atributos));
    assert.ok('leitura_mbps' in ssd.atributos);
  });

  test('busca por atributo usa o índice curinga e junta dados do MySQL', async () => {
    const { status, dados } = await req('GET', '/api/nosql/busca?chave=capacidade_gb&operador=gte&valor=1000', { token: consulta });
    assert.equal(status, 200);
    assert.equal(dados.plano.estagio, 'IXSCAN');
    assert.equal(dados.plano.indice, 'idx_atributos_curinga');
    assert.ok(dados.resultados.length >= 2 && dados.resultados.every((r) => r.valor >= 1000 && typeof r.preco === 'number'));
  });

  test('validação da busca e da ficha (API) antes de chegar ao MongoDB', async () => {
    let r = await req('GET', '/api/nosql/busca?chave=Taxa%20Hz&operador=gte&valor=abc', { token: consulta });
    assert.equal(r.status, 422); assert.ok(r.dados.campos.chave && r.dados.campos.valor);
    r = await req('PUT', '/api/produtos/8/ficha', { token: admin, corpo: { atributos: { 'Chave Ruim': 1 } } });
    assert.equal(r.status, 422); assert.ok(r.dados.campos.atributos);
    r = await req('PUT', '/api/produtos/8/ficha', { token: admin, corpo: { atributos: { a: { $where: 'x' } } } });
    assert.equal(r.status, 422, 'objetos aninhados (injeção de operador) são recusados');
  });

  test('só quem gerencia estoque edita fichas; produto precisa existir no MySQL', async () => {
    assert.equal((await req('PUT', '/api/produtos/8/ficha', { token: vendedor, corpo: { atributos: { cor: 'azul' } } })).status, 403);
    assert.equal((await req('PUT', '/api/produtos/9999/ficha', { token: admin, corpo: { atributos: { cor: 'azul' } } })).status, 404);
    const r = await req('PUT', '/api/produtos/8/ficha', { token: admin, corpo: { atributos: { capacidade_gb: 64, interface: 'USB 3.2', cor: 'preto' }, destaques: ['Teste'] } });
    assert.equal(r.status, 200);
    const f = await req('GET', '/api/produtos/8/ficha', { token: consulta });
    assert.equal(f.dados.atributos.cor, 'preto');
    assert.equal(f.dados.categoria, 'Armazenamento', 'categoria vem do MySQL');
  });

  test('venda gera evento no MongoDB e o painel agrega', async () => {
    const v = await req('POST', '/api/vendas', { token: vendedor, corpo: { cliente: 'CLI-000003', itens: [{ produto: 12, quantidade: 1 }] } });
    assert.equal(v.status, 201);
    await espera(400);                                 // evento é gravado de forma assíncrona
    const { dados } = await req('GET', '/api/nosql/painel', { token: consulta });
    assert.ok(dados.recentes.some((e) => e.tipo === 'venda_registrada' && e.dados.pedido === v.dados.pedido));
    assert.ok(dados.porTipo.some((t) => t._id === 'venda_registrada'));
    assert.ok(dados.indices.some((c) => c.indices.some((i) => i.ttl_dias === 90)));
  });

  test('conta do MongoDB não apaga log nem banco (menor privilégio)', async () => {
    const { dados } = await req('GET', '/api/nosql/painel', { token: consulta });
    assert.equal(dados.conta, 'lojatech_app@lojatech_nosql');
    for (const t of dados.testes) {
      const r = await req('POST', `/api/nosql/testar/${t.id}`, { token: consulta });
      assert.equal(r.dados.permitido, false, `${t.id} deveria ser negado`);
    }
  });
});
