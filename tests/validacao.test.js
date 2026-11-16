'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const V = require('../public/js/validacao');

test('CPF: dígitos verificadores, máscara e sequências repetidas', () => {
  assert.ok(V.cpfValido('529.982.247-25'));
  assert.ok(V.cpfValido('52998224725'));
  assert.ok(!V.cpfValido('529.982.247-24'));
  assert.ok(!V.cpfValido('111.111.111-11'));
  assert.ok(!V.cpfValido('123'));
  assert.ok(!V.cpfValido(null));
});

test('cliente: nome, e-mail e telefone opcional', () => {
  assert.deepEqual(V.validarCliente({ nome: 'Maria Silva', cpf: '52998224725', email: 'm@x.com', telefone: '' }), {});
  const e = V.validarCliente({ nome: ' ab ', cpf: '1', email: 'a@b', telefone: '(61) 9' });
  assert.deepEqual(Object.keys(e).sort(), ['cpf', 'email', 'nome', 'telefone']);
});

test('venda: tipos estritos e regras do carrinho', () => {
  const ok = { cliente: 'CLI-000001', itens: [{ produto: 1, quantidade: 2 }] };
  assert.deepEqual(V.validarVenda(ok), {});
  assert.ok(V.validarVenda({ ...ok, itens: [{ produto: 1, quantidade: '2' }] }).itens);
  assert.ok(V.validarVenda({ ...ok, itens: [{ produto: 1, quantidade: 1000 }] }).itens);
  assert.ok(V.validarVenda({ ...ok, itens: [{ produto: 1, quantidade: 1 }, { produto: 1, quantidade: 1 }] }).itens);
  assert.ok(V.validarVenda({ ...ok, cliente: 'CLI-1' }).cliente);
  assert.ok(V.validarVenda({ ...ok, itens: Array.from({ length: 21 }, (_, i) => ({ produto: i + 1, quantidade: 1 })) }).itens);
});

test('preço: faixa e casas decimais', () => {
  assert.deepEqual(V.validarPreco({ preco: 19.9 }), {});
  assert.ok(V.validarPreco({ preco: 0 }).preco);
  assert.ok(V.validarPreco({ preco: 1.234 }).preco);
  assert.ok(V.validarPreco({ preco: '10' }).preco);
});

test('reposição: quantidade inteira e motivo', () => {
  assert.deepEqual(V.validarReposicao({ quantidade: 10, motivo: 'NF 123' }), {});
  assert.ok(V.validarReposicao({ quantidade: 10.5, motivo: 'NF 123' }).quantidade);
  assert.ok(V.validarReposicao({ quantidade: 1, motivo: 'x'.repeat(61) }).motivo);
});
