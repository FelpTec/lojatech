/*
 * LojaTech — regras de validação compartilhadas.
 * O MESMO arquivo é usado no navegador (feedback imediato no formulário)
 * e no servidor Node (nunca confiar no cliente). O banco aplica as regras
 * uma terceira vez (CHECK, triggers e procedures): validação ponta a ponta.
 *
 * Cada validador devolve um objeto { campo: 'mensagem' } — vazio = válido.
 */
(function (raiz, fabrica) {
  if (typeof module === 'object' && module.exports) module.exports = fabrica();
  else raiz.Validacao = fabrica();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const RE_EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
  const RE_CLIENTE_ID = /^CLI-\d{6}$/;
  const RE_PEDIDO_ID = /^PED-\d{4}-\d{6}$/;

  const texto = (v) => (typeof v === 'string' ? v.trim() : '');
  const soDigitos = (v) => (typeof v === 'string' || typeof v === 'number' ? String(v).replace(/\D/g, '') : '');
  const inteiroEntre = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;

  function cpfValido(valor) {
    const cpf = soDigitos(valor);
    if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
    const digito = (base) => {
      let soma = 0;
      for (let i = 0; i < base.length; i++) soma += Number(base[i]) * (base.length + 1 - i);
      const r = (soma * 10) % 11;
      return r === 10 ? 0 : r;
    };
    const d1 = digito(cpf.slice(0, 9));
    const d2 = digito(cpf.slice(0, 9) + d1);
    return cpf.endsWith(`${d1}${d2}`);
  }

  function emailValido(valor) {
    const e = texto(valor);
    return e.length > 0 && e.length <= 120 && RE_EMAIL.test(e);
  }

  function validarLogin(d = {}) {
    const erros = {};
    if (!emailValido(d.email)) erros.email = 'Informe um e-mail válido';
    if (typeof d.senha !== 'string' || d.senha.length === 0) erros.senha = 'Informe a senha';
    else if (d.senha.length > 100) erros.senha = 'Senha muito longa';
    return erros;
  }

  function validarCliente(d = {}) {
    const erros = {};
    const nome = texto(d.nome);
    if (nome.length < 3 || nome.length > 80) erros.nome = 'Nome deve ter de 3 a 80 caracteres';
    if (!cpfValido(d.cpf)) erros.cpf = 'CPF inválido (confira os dígitos)';
    if (!emailValido(d.email)) erros.email = 'Informe um e-mail válido';
    const tel = soDigitos(d.telefone);
    if (tel && (tel.length < 10 || tel.length > 11)) erros.telefone = 'Use DDD + número (10 ou 11 dígitos)';
    return erros;
  }

  function validarVenda(d = {}) {
    const erros = {};
    if (typeof d.cliente !== 'string' || !RE_CLIENTE_ID.test(d.cliente)) erros.cliente = 'Selecione um cliente';
    if (!Array.isArray(d.itens) || d.itens.length === 0) {
      erros.itens = 'Adicione ao menos um produto ao carrinho';
    } else if (d.itens.length > 20) {
      erros.itens = 'O carrinho aceita no máximo 20 produtos';
    } else {
      const vistos = new Set();
      for (const item of d.itens) {
        if (!item || !inteiroEntre(item.produto, 1, 2147483647)) { erros.itens = 'Produto inválido no carrinho'; break; }
        if (!inteiroEntre(item.quantidade, 1, 999)) { erros.itens = 'Quantidade deve ser um inteiro de 1 a 999'; break; }
        if (vistos.has(item.produto)) { erros.itens = 'Produto repetido no carrinho'; break; }
        vistos.add(item.produto);
      }
    }
    return erros;
  }

  function validarReposicao(d = {}) {
    const erros = {};
    if (!inteiroEntre(d.quantidade, 1, 10000)) erros.quantidade = 'Quantidade deve ser um inteiro de 1 a 10.000';
    const motivo = texto(d.motivo);
    if (motivo.length < 3 || motivo.length > 60) erros.motivo = 'Motivo deve ter de 3 a 60 caracteres';
    return erros;
  }

  function validarPreco(d = {}) {
    const erros = {};
    const p = d.preco;
    if (typeof p !== 'number' || !Number.isFinite(p) || p <= 0 || p > 999999.99) {
      erros.preco = 'Preço deve estar entre R$ 0,01 e R$ 999.999,99';
    } else if (Math.round(p * 100) / 100 !== p) {
      erros.preco = 'Use no máximo 2 casas decimais';
    }
    return erros;
  }

  return {
    RE_CLIENTE_ID, RE_PEDIDO_ID,
    soDigitos, cpfValido, emailValido,
    validarLogin, validarCliente, validarVenda, validarReposicao, validarPreco,
  };
});
