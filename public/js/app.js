/* LojaTech — frontend (HTML/CSS/JS puro, sem framework) */
(() => {
  'use strict';
  const V = window.Validacao;
  const $ = (sel, raiz = document) => raiz.querySelector(sel);
  const $$ = (sel, raiz = document) => [...raiz.querySelectorAll(sel)];

  const estado = {
    token: lerSessao(),
    usuario: null,
    categorias: [],
    carrinho: new Map(),        // produtoId -> { produto, quantidade }
    clienteVenda: '',
  };

  function lerSessao() { try { return sessionStorage.getItem('lojatech_token'); } catch { return null; } }
  function gravarSessao(t) { try { t ? sessionStorage.setItem('lojatech_token', t) : sessionStorage.removeItem('lojatech_token'); } catch { /* sem storage */ } }

  // ------------------------------------------------------------------
  // Utilidades
  // ------------------------------------------------------------------
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const moeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  const fmtMoeda = (v) => moeda.format(Number(v) || 0);
  const fmtData = (s) => {
    if (!s) return '—';
    const [d, h = ''] = String(s).split(' ');
    const [a, m, dia] = d.split('-');
    return `${dia}/${m}/${a}${h ? ' ' + h.slice(0, 5) : ''}`;
  };
  const iniciais = (n) => String(n || '?').split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();
  const fonte = (tipo, nome) => `<span class="fonte ${tipo === 'VIEW' ? 'view' : tipo === 'PROCEDURE' ? 'proc' : tipo === 'MONGODB' ? 'mongo' : ''}" title="Origem dos dados">${tipo} <code>${esc(nome)}</code></span>`;
  const rotuloAtributo = (k) => k.replace(/_/g, ' ');
  const valorAtributo = (v) => (Array.isArray(v) ? v.join(', ') : typeof v === 'boolean' ? (v ? 'sim' : 'não') : String(v));
  const icone = {
    ok: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M20 6 9 17l-5-5"/></svg>',
    info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>',
    mais: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 5v14M5 12h14"/></svg>',
    lixo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg>',
  };

  function etiquetaEstoque(p) {
    if (p.estoque === 0) return '<span class="etiqueta zero">Esgotado</span>';
    if (p.estoque <= p.estoque_minimo) return '<span class="etiqueta baixo">Baixo</span>';
    return '<span class="etiqueta ok">Normal</span>';
  }

  function toast(msg, tipo = '') {
    const el = document.createElement('div');
    el.className = `toast ${tipo}`;
    el.textContent = msg;
    $('#toasts').append(el);
    setTimeout(() => el.remove(), tipo === 'erro' ? 6000 : 3500);
  }

  async function api(metodo, url, corpo) {
    const resp = await fetch(url, {
      method: metodo,
      headers: { 'Content-Type': 'application/json', ...(estado.token ? { Authorization: `Bearer ${estado.token}` } : {}) },
      body: corpo ? JSON.stringify(corpo) : undefined,
    });
    const dados = await resp.json().catch(() => ({}));
    if (resp.status === 401 && estado.token) { sair(); toast(dados.erro || 'Sessão expirada', 'erro'); }
    if (!resp.ok) {
      const e = new Error(dados.erro || `Erro ${resp.status}`);
      e.campos = dados.campos; e.status = resp.status;
      throw e;
    }
    return dados;
  }

  // ------------------------------------------------------------------
  // Formulários: erros por campo (mesmas mensagens no front e na API)
  // ------------------------------------------------------------------
  function mostrarErros(form, erros = {}) {
    $$('.campo', form).forEach((c) => c.classList.remove('invalido'));
    $$('[data-erro]', form).forEach((s) => { s.textContent = ''; });
    let primeiro = null;
    for (const [campo, msg] of Object.entries(erros)) {
      const span = $(`[data-erro="${campo}"]`, form);
      if (!span) continue;
      span.textContent = msg;
      const bloco = span.closest('.campo');
      bloco?.classList.add('invalido');
      const input = $('input, select', bloco);
      input?.setAttribute('aria-invalid', 'true');
      primeiro ??= input;
    }
    $$('input, select', form).forEach((i) => { if (!$(`[data-erro="${i.name}"]`, form)?.textContent) i.removeAttribute('aria-invalid'); });
    primeiro?.focus();
    return Object.keys(erros).length === 0;
  }

  function mascaraCpf(v) {
    const d = V.soDigitos(v).slice(0, 11);
    return d.replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d{1,2})$/, '$1-$2');
  }
  function mascaraTelefone(v) {
    const d = V.soDigitos(v).slice(0, 11);
    if (d.length <= 2) return d ? `(${d}` : '';
    if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
    if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
    return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  }

  // ------------------------------------------------------------------
  // Diálogo
  // ------------------------------------------------------------------
  function abrirDialogo({ titulo, corpo, acoes = [] }) {
    const dlg = $('#dialogo');
    dlg.innerHTML = `
      <div class="dialogo-topo"><h2>${esc(titulo)}</h2>
        <button class="btn btn-texto" data-fechar aria-label="Fechar">✕</button></div>
      <div class="dialogo-corpo">${corpo}</div>
      ${acoes.length ? `<div class="dialogo-acoes">${acoes.map((a, i) => `<button class="btn ${a.classe || 'btn-contorno'}" data-acao="${i}" type="${a.submit ? 'submit' : 'button'}" ${a.submit ? `form="${a.submit}"` : ''}>${esc(a.texto)}</button>`).join('')}</div>` : ''}`;
    dlg.querySelector('[data-fechar]').onclick = () => dlg.close();
    acoes.forEach((a, i) => { if (a.acao) dlg.querySelector(`[data-acao="${i}"]`).onclick = a.acao; });
    dlg.showModal();
    return dlg;
  }
  $('#dialogo').addEventListener('click', (e) => { if (e.target.id === 'dialogo') e.target.close(); });

  // ------------------------------------------------------------------
  // Login / sessão
  // ------------------------------------------------------------------
  function mostrarLogin() {
    $('#tela-app').hidden = true;
    $('#tela-login').hidden = false;
    $('#login-email').focus();
  }

  async function iniciarApp() {
    $('#tela-login').hidden = true;
    $('#tela-app').hidden = false;
    const u = estado.usuario;
    $('#nome-usuario').textContent = u.nome;
    $('#grupo-usuario').textContent = u.grupo;
    $('#avatar').textContent = iniciais(u.nome);
    api('GET', '/api/seguranca').then((s) => { $('#conta-bd').textContent = s.conta_bd; }).catch(() => {});
    estado.categorias = await api('GET', '/api/categorias').catch(() => []);
    atualizarContadorEstoque();
    if (!location.hash) location.hash = '#/painel'; else rotear();
  }

  function sair() {
    estado.token = null; estado.usuario = null; estado.carrinho.clear();
    gravarSessao(null);
    history.replaceState(null, '', location.pathname);
    mostrarLogin();
  }

  $('#form-login').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const form = ev.currentTarget;
    const dados = { email: form.email.value.trim(), senha: form.senha.value };
    $('#login-alerta').hidden = true;
    if (!mostrarErros(form, V.validarLogin(dados))) return;
    const btn = $('button[type=submit]', form);
    btn.disabled = true;
    try {
      const r = await api('POST', '/api/login', dados);
      estado.token = r.token; estado.usuario = r.usuario;
      gravarSessao(r.token);
      form.senha.value = '';
      await iniciarApp();
    } catch (e) {
      if (e.campos) mostrarErros(form, e.campos);
      $('#login-alerta').textContent = e.message;
      $('#login-alerta').hidden = false;
    } finally { btn.disabled = false; }
  });
  $$('.chip[data-email]').forEach((c) => c.addEventListener('click', () => {
    $('#login-email').value = c.dataset.email;
    $('#login-senha').value = c.dataset.senha;
    $('#form-login').requestSubmit();
  }));
  $('#btn-sair').addEventListener('click', sair);

  async function atualizarContadorEstoque() {
    try {
      const l = await api('GET', '/api/estoque-baixo');
      const c = $('#contador-estoque');
      c.textContent = l.length; c.hidden = l.length === 0;
    } catch { /* silencioso: contador é auxiliar */ }
  }

  // ------------------------------------------------------------------
  // Roteamento por hash
  // ------------------------------------------------------------------
  const paginas = { painel, venda, pedidos, clientes, produtos, estoque, equipe, seguranca, nosql };

  async function rotear() {
    if (!estado.usuario) return;
    const nome = (location.hash.match(/^#\/(\w+)/) || [])[1] || 'painel';
    const pagina = paginas[nome] || painel;
    $$('.nav a').forEach((a) => a.classList.toggle('ativo', a.dataset.rota === nome));
    const alvo = $('#conteudo');
    alvo.innerHTML = '<div class="carregando">Carregando…</div>';
    try {
      await pagina(alvo);
    } catch (e) {
      alvo.innerHTML = `<div class="cartao"><div class="cartao-corpo"><div class="aviso alerta">${icone.info}<span>${esc(e.message)}</span></div></div></div>`;
    }
    alvo.focus({ preventScroll: true });
  }
  window.addEventListener('hashchange', rotear);

  const cabecalho = (titulo, sub, extra = '') =>
    `<div class="cabecalho"><div><h1>${esc(titulo)}</h1>${sub ? `<p>${sub}</p>` : ''}</div>${extra}</div>`;

  // ------------------------------------------------------------------
  // PAINEL
  // ------------------------------------------------------------------
  async function painel(alvo) {
    const { indicadores: k, recentes, estoqueBaixo } = await api('GET', '/api/painel');
    alvo.innerHTML = `
      ${cabecalho(`Olá, ${estado.usuario.nome.split(' ')[0]}`, 'Resumo da operação de hoje.', fonte('VIEW', 'vw_painel'))}
      <div class="grade-kpi">
        <div class="cartao kpi"><div class="rotulo">Faturamento hoje</div><div class="valor">${fmtMoeda(k.faturamento_hoje)}</div><div class="detalhe">${k.pedidos_hoje} pedido(s)</div></div>
        <div class="cartao kpi ciano"><div class="rotulo">Faturamento no mês</div><div class="valor">${fmtMoeda(k.faturamento_mes)}</div><div class="detalhe">${k.pedidos_mes} pedido(s)</div></div>
        <div class="cartao kpi laranja"><div class="rotulo">Estoque baixo</div><div class="valor">${k.produtos_estoque_baixo}</div><div class="detalhe">de ${k.produtos_ativos} produtos ativos</div></div>
        <div class="cartao kpi"><div class="rotulo">Clientes</div><div class="valor">${k.total_clientes}</div><div class="detalhe">cadastrados</div></div>
      </div>
      <div class="grade-2">
        <section class="cartao">
          <div class="cartao-topo"><h2>Pedidos recentes</h2>${fonte('VIEW', 'vw_resumo_pedidos')}</div>
          <div class="tabela-rolagem"><table>
            <thead><tr><th>Pedido</th><th>Cliente</th><th class="num">Total</th></tr></thead>
            <tbody>${recentes.map((p) => `<tr class="clicavel" data-pedido="${esc(p.pedido)}"><td><span class="mono">${esc(p.pedido)}</span><br><small class="suave">${fmtData(p.data_pedido)}</small></td><td>${esc(p.cliente)}</td><td class="num">${fmtMoeda(p.total)}</td></tr>`).join('') || '<tr><td colspan="3" class="vazio">Nenhum pedido ainda.</td></tr>'}</tbody>
          </table></div>
        </section>
        <section class="cartao">
          <div class="cartao-topo"><h2>Precisam de reposição</h2>${fonte('VIEW', 'vw_estoque_baixo')}</div>
          <div class="tabela-rolagem"><table>
            <thead><tr><th>Produto</th><th class="num">Estoque</th><th class="num">Mínimo</th></tr></thead>
            <tbody>${estoqueBaixo.map((p) => `<tr><td>${esc(p.nome)}<br><small class="suave">${esc(p.categoria)}</small></td><td class="num">${etiquetaEstoque(p)} ${p.estoque}</td><td class="num">${p.estoque_minimo}</td></tr>`).join('') || '<tr><td colspan="3" class="vazio">Tudo abastecido.</td></tr>'}</tbody>
          </table></div>
        </section>
      </div>`;
    $$('[data-pedido]', alvo).forEach((tr) => tr.addEventListener('click', () => verPedido(tr.dataset.pedido)));
  }

  // ------------------------------------------------------------------
  // NOVA VENDA (carrinho → sp_registrar_venda)
  // ------------------------------------------------------------------
  async function venda(alvo) {
    const podeVender = !!estado.usuario.pode_vender;
    const [produtosLista, clientesLista, fichasLista] = await Promise.all([
      api('GET', '/api/produtos'), api('GET', '/api/clientes'),
      api('GET', '/api/fichas').catch(() => []),            // MongoDB fora do ar não impede a venda
    ]);
    const fichaPorId = new Map(fichasLista.map((f) => [f._id, f]));
    const produtosAtivos = produtosLista.filter((p) => p.ativo);
    const porId = new Map(produtosAtivos.map((p) => [p.id, p]));
    // Mantém o carrinho coerente com o estoque atual
    for (const [id, item] of estado.carrinho) {
      const p = porId.get(id);
      if (!p || p.estoque === 0) estado.carrinho.delete(id);
      else { item.produto = p; item.quantidade = Math.min(item.quantidade, p.estoque); }
    }

    alvo.innerHTML = `
      ${cabecalho('Nova venda', 'Monte o carrinho e finalize. Tudo é gravado numa única transação.', fonte('PROCEDURE', 'sp_registrar_venda'))}
      ${podeVender ? '' : `<div class="aviso alerta mb">${icone.info}<span>Seu perfil <b>${esc(estado.usuario.grupo)}</b> não tem permissão para vender. A tela fica em modo consulta.</span></div>`}
      <div class="venda">
        <section class="cartao">
          <div class="cartao-topo"><h2>Catálogo</h2>
            <div class="filtros">
              <label class="filtro"><span class="sr-only">Buscar produto</span><input id="venda-busca" type="search" placeholder="Buscar produto…" maxlength="60"></label>
              <label class="filtro"><span class="sr-only">Categoria</span><select id="venda-cat"><option value="">Todas as categorias</option>${estado.categorias.map((c) => `<option value="${c.id}">${esc(c.nome)}</option>`).join('')}</select></label>
            </div>
          </div>
          <div class="cartao-corpo"><div class="catalogo" id="catalogo"></div></div>
        </section>
        <aside class="cartao carrinho">
          <div class="cartao-topo"><h2>Carrinho</h2><span class="suave" id="qtd-itens"></span></div>
          <form class="cartao-corpo" id="form-venda" novalidate>
            <div class="campo">
              <label for="venda-cliente">Cliente</label>
              <select id="venda-cliente" name="cliente" ${podeVender ? '' : 'disabled'}>
                <option value="">Selecione o cliente…</option>
                ${clientesLista.map((c) => `<option value="${esc(c.id)}">${esc(c.nome)} · ${esc(c.cpf_mascarado)}</option>`).join('')}
              </select>
              <span class="erro" data-erro="cliente"></span>
              ${estado.usuario.pode_cadastrar_clientes ? '<a href="#/clientes" class="dica">+ Cadastrar novo cliente</a>' : ''}
            </div>
            <div id="itens-carrinho"></div>
            <div class="campo"><span class="erro" data-erro="itens"></span></div>
            <div class="total-carrinho"><span>Total</span><strong id="total-carrinho">R$ 0,00</strong></div>
            <button class="btn btn-primario btn-largo" type="submit" ${podeVender ? '' : 'disabled'}>Finalizar venda</button>
          </form>
        </aside>
      </div>`;

    const selCliente = $('#venda-cliente');
    selCliente.value = estado.clienteVenda;
    selCliente.addEventListener('change', () => { estado.clienteVenda = selCliente.value; });

    const renderCatalogo = () => {
      const termo = $('#venda-busca').value.trim().toLowerCase();
      const cat = Number($('#venda-cat').value) || null;
      const lista = produtosAtivos.filter((p) => (!cat || p.categoria_id === cat) && p.nome.toLowerCase().includes(termo));
      $('#catalogo').innerHTML = lista.map((p) => {
        const noCarrinho = estado.carrinho.get(p.id)?.quantidade || 0;
        const disponivel = p.estoque - noCarrinho;
        return `<div class="produto-card">
          <span class="cat">${esc(p.categoria)}</span>
          <span class="nome">${esc(p.nome)}</span>
          ${(() => { const f = fichaPorId.get(p.id); return f ? `<span class="specs" title="Ficha técnica (MongoDB)">${Object.entries(f.atributos).slice(0, 3).map(([k, v]) => `<span>${esc(rotuloAtributo(k))}: <b>${esc(valorAtributo(v))}</b></span>`).join('')}</span>` : ''; })()}
          <span class="preco">${fmtMoeda(p.preco)}</span>
          <div class="rodape"><small class="suave">${etiquetaEstoque(p)} ${p.estoque} un.</small>
            <button class="btn btn-destaque btn-pequeno" data-add="${p.id}" type="button" ${!podeVender || disponivel <= 0 ? 'disabled' : ''} aria-label="Adicionar ${esc(p.nome)}">${icone.mais}</button></div>
        </div>`;
      }).join('') || '<p class="vazio">Nenhum produto encontrado.</p>';
      $$('[data-add]', alvo).forEach((b) => b.addEventListener('click', () => {
        const p = porId.get(Number(b.dataset.add));
        const item = estado.carrinho.get(p.id);
        if (item) item.quantidade = Math.min(item.quantidade + 1, p.estoque);
        else if (estado.carrinho.size >= 20) return toast('O carrinho aceita no máximo 20 produtos', 'erro');
        else estado.carrinho.set(p.id, { produto: p, quantidade: 1 });
        renderTudo();
      }));
    };

    const renderCarrinho = () => {
      const itens = [...estado.carrinho.values()];
      $('#qtd-itens').textContent = itens.length ? `${itens.length} produto(s)` : '';
      $('#itens-carrinho').innerHTML = itens.length ? itens.map(({ produto: p, quantidade }) => `
        <div class="item-carrinho">
          <div><div class="nome">${esc(p.nome)}</div><small>${fmtMoeda(p.preco)} · máx. ${p.estoque}</small></div>
          <div class="qtd">
            <button type="button" data-menos="${p.id}" aria-label="Diminuir">−</button>
            <input type="number" inputmode="numeric" min="1" max="${Math.min(p.estoque, 999)}" value="${quantidade}" data-qtd="${p.id}" aria-label="Quantidade de ${esc(p.nome)}">
            <button type="button" data-mais="${p.id}" aria-label="Aumentar">+</button>
          </div>
          <button type="button" class="btn btn-texto btn-pequeno" data-remover="${p.id}" aria-label="Remover ${esc(p.nome)}">${icone.lixo}</button>
        </div>`).join('') : '<div class="aviso info">' + icone.info + '<span>Adicione produtos do catálogo ao carrinho.</span></div>';
      const total = itens.reduce((s, i) => s + i.produto.preco * i.quantidade, 0);
      $('#total-carrinho').textContent = fmtMoeda(total);
      const ajustar = (id, nova) => {
        const item = estado.carrinho.get(id);
        if (!item) return;
        if (nova <= 0) estado.carrinho.delete(id);
        else item.quantidade = Math.min(nova, item.produto.estoque, 999);
        renderTudo();
      };
      $$('[data-menos]', alvo).forEach((b) => b.addEventListener('click', () => ajustar(Number(b.dataset.menos), estado.carrinho.get(Number(b.dataset.menos)).quantidade - 1)));
      $$('[data-mais]', alvo).forEach((b) => b.addEventListener('click', () => ajustar(Number(b.dataset.mais), estado.carrinho.get(Number(b.dataset.mais)).quantidade + 1)));
      $$('[data-remover]', alvo).forEach((b) => b.addEventListener('click', () => ajustar(Number(b.dataset.remover), 0)));
      $$('[data-qtd]', alvo).forEach((i) => i.addEventListener('change', () => {
        const v = Math.floor(Number(i.value));
        ajustar(Number(i.dataset.qtd), Number.isFinite(v) ? v : 1);
      }));
    };

    const renderTudo = () => { renderCatalogo(); renderCarrinho(); };
    $('#venda-busca').addEventListener('input', renderCatalogo);
    $('#venda-cat').addEventListener('change', renderCatalogo);
    renderTudo();

    $('#form-venda').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const form = ev.currentTarget;
      const dados = {
        cliente: selCliente.value,
        itens: [...estado.carrinho.values()].map((i) => ({ produto: i.produto.id, quantidade: i.quantidade })),
      };
      const erros = V.validarVenda(dados);
      const semEstoque = [...estado.carrinho.values()].find((i) => i.quantidade > i.produto.estoque);
      if (!erros.itens && semEstoque) erros.itens = `Estoque insuficiente para "${semEstoque.produto.nome}"`;
      if (!mostrarErros(form, erros)) return;
      const btn = $('button[type=submit]', form);
      btn.disabled = true;
      try {
        const r = await api('POST', '/api/vendas', dados);
        estado.carrinho.clear(); estado.clienteVenda = '';
        atualizarContadorEstoque();
        await rotear();                    // recarrega catálogo/estoque e esvazia o carrinho na tela
        abrirDialogo({
          titulo: 'Venda registrada',
          corpo: `<div class="sucesso-venda"><div class="icone">${icone.ok}</div>
            <p class="suave">Pedido gravado com COMMIT</p>
            <div class="codigo">${esc(r.pedido)}</div>
            <p>Total: <b>${fmtMoeda(r.total)}</b></p>
            <p class="suave"><small>ID gerado por <code>fn_gerar_id_pedido()</code>; estoque baixado pelo trigger <code>trg_itens_ai_baixa_estoque</code>.</small></p></div>`,
          acoes: [
            { texto: 'Ver pedido', acao: () => { $('#dialogo').close(); verPedido(r.pedido); } },
            { texto: 'Nova venda', classe: 'btn-primario', acao: () => $('#dialogo').close() },
          ],
        });
      } catch (e) {
        mostrarErros(form, e.campos || {});
        toast(e.status === 422 ? `${e.message}. A transação foi desfeita (ROLLBACK).` : e.message, 'erro');
        if (e.status === 422) rotear();   // recarrega estoque real
      } finally { btn.disabled = !podeVender; }
    });
  }

  // ------------------------------------------------------------------
  // PEDIDOS
  // ------------------------------------------------------------------
  async function pedidos(alvo) {
    const lista = await api('GET', '/api/pedidos');
    alvo.innerHTML = `
      ${cabecalho('Pedidos', 'Clique em um pedido para ver os itens.', fonte('VIEW', 'vw_resumo_pedidos'))}
      <section class="cartao"><div class="tabela-rolagem"><table>
        <thead><tr><th>Pedido</th><th>Data</th><th>Cliente</th><th>Vendedor</th><th class="num">Itens</th><th class="num">Total</th></tr></thead>
        <tbody>${lista.map((p) => `<tr class="clicavel" data-pedido="${esc(p.pedido)}" tabindex="0">
          <td class="mono">${esc(p.pedido)}</td><td>${fmtData(p.data_pedido)}</td><td>${esc(p.cliente)}</td><td>${esc(p.vendedor)}</td>
          <td class="num">${p.itens} <small class="suave">(${p.unidades} un.)</small></td><td class="num"><b>${fmtMoeda(p.total)}</b></td></tr>`).join('') || '<tr><td colspan="6" class="vazio">Nenhum pedido registrado.</td></tr>'}</tbody>
      </table></div></section>`;
    $$('[data-pedido]', alvo).forEach((tr) => {
      tr.addEventListener('click', () => verPedido(tr.dataset.pedido));
      tr.addEventListener('keydown', (e) => { if (e.key === 'Enter') verPedido(tr.dataset.pedido); });
    });
  }

  async function verPedido(id) {
    try {
      const r = await api('GET', `/api/pedidos/${encodeURIComponent(id)}`);
      const i0 = r.itens[0];
      abrirDialogo({
        titulo: `Pedido ${r.pedido}`,
        corpo: `<p>${fmtData(i0.data_pedido)} · Cliente <b>${esc(i0.cliente)}</b> · Vendedor ${esc(i0.vendedor)}</p>
          <p>${fonte('VIEW', 'vw_vendas_detalhadas')} ${fonte('FUNCTION', 'fn_total_pedido')}</p>
          <div class="tabela-rolagem"><table>
            <thead><tr><th>Produto</th><th class="num">Qtd.</th><th class="num">Preço un.</th><th class="num">Subtotal</th></tr></thead>
            <tbody>${r.itens.map((i) => `<tr><td>${esc(i.produto)}</td><td class="num">${i.quantidade}</td><td class="num">${fmtMoeda(i.preco_unitario)}</td><td class="num">${fmtMoeda(i.subtotal)}</td></tr>`).join('')}</tbody>
            <tfoot><tr><th colspan="3">Total</th><th class="num">${fmtMoeda(r.total)}</th></tr></tfoot>
          </table></div>`,
        acoes: [{ texto: 'Fechar', classe: 'btn-primario', acao: () => $('#dialogo').close() }],
      });
    } catch (e) { toast(e.message, 'erro'); }
  }

  // ------------------------------------------------------------------
  // CLIENTES (cadastro com validação ponta a ponta)
  // ------------------------------------------------------------------
  async function clientes(alvo) {
    const pode = !!estado.usuario.pode_cadastrar_clientes;
    alvo.innerHTML = `
      ${cabecalho('Clientes', 'CPF exibido mascarado (LGPD): a aplicação não tem acesso ao CPF completo.', fonte('VIEW', 'vw_clientes'))}
      <div class="grade-2">
        <section class="cartao">
          <div class="cartao-topo"><h2>Novo cliente</h2>${fonte('PROCEDURE', 'sp_cadastrar_cliente')}</div>
          ${pode ? `<form class="cartao-corpo" id="form-cliente" novalidate>
            <div class="campo"><label for="cli-nome">Nome completo</label>
              <input id="cli-nome" name="nome" maxlength="80" autocomplete="name" required><span class="erro" data-erro="nome"></span></div>
            <div class="linha-campos">
              <div class="campo"><label for="cli-cpf">CPF</label>
                <input id="cli-cpf" name="cpf" inputmode="numeric" placeholder="000.000.000-00" maxlength="14" required>
                <span class="dica">Validado no navegador, na API e no banco (fn_cpf_valido)</span><span class="erro" data-erro="cpf"></span></div>
              <div class="campo"><label for="cli-tel">Telefone <span class="suave">(opcional)</span></label>
                <input id="cli-tel" name="telefone" inputmode="tel" placeholder="(61) 99999-9999" maxlength="15" autocomplete="tel"><span class="erro" data-erro="telefone"></span></div>
            </div>
            <div class="campo"><label for="cli-email">E-mail</label>
              <input id="cli-email" name="email" type="email" maxlength="120" autocomplete="email" required><span class="erro" data-erro="email"></span></div>
            <button class="btn btn-primario" type="submit">Cadastrar cliente</button>
          </form>` : `<div class="cartao-corpo"><div class="aviso alerta">${icone.info}<span>Seu perfil <b>${esc(estado.usuario.grupo)}</b> não pode cadastrar clientes.</span></div></div>`}
        </section>
        <section class="cartao">
          <div class="cartao-topo"><h2>Cadastrados</h2>
            <label class="filtro"><span class="sr-only">Buscar cliente</span><input id="cli-busca" type="search" placeholder="Buscar por nome ou e-mail…" maxlength="60"></label></div>
          <div class="tabela-rolagem"><table>
            <thead><tr><th>Cliente</th><th>CPF</th><th>Contato</th></tr></thead><tbody id="lista-clientes"></tbody>
          </table></div>
        </section>
      </div>`;

    let ultimaBusca = 0;
    const carregar = async () => {
      const n = ++ultimaBusca;
      const lista = await api('GET', `/api/clientes?busca=${encodeURIComponent($('#cli-busca').value)}`);
      if (n !== ultimaBusca) return;
      $('#lista-clientes').innerHTML = lista.map((c) => `<tr>
        <td><b>${esc(c.nome)}</b><br><small class="mono suave">${esc(c.id)}</small></td>
        <td class="mono">${esc(c.cpf_mascarado)}</td>
        <td>${esc(c.email)}${c.telefone ? `<br><small class="suave">${esc(mascaraTelefone(c.telefone))}</small>` : ''}</td></tr>`).join('')
        || '<tr><td colspan="3" class="vazio">Nenhum cliente encontrado.</td></tr>';
    };
    let atraso;
    $('#cli-busca').addEventListener('input', () => { clearTimeout(atraso); atraso = setTimeout(carregar, 250); });
    await carregar();

    if (!pode) return;
    const form = $('#form-cliente');
    form.cpf.addEventListener('input', () => { form.cpf.value = mascaraCpf(form.cpf.value); });
    form.telefone.addEventListener('input', () => { form.telefone.value = mascaraTelefone(form.telefone.value); });
    // Feedback ao sair do campo
    $$('input', form).forEach((i) => i.addEventListener('blur', () => {
      if (!i.value) return;
      const erros = V.validarCliente(lerCliente());
      const span = $(`[data-erro="${i.name}"]`, form);
      span.textContent = erros[i.name] || '';
      i.closest('.campo').classList.toggle('invalido', !!erros[i.name]);
    }));
    const lerCliente = () => ({ nome: form.nome.value, cpf: form.cpf.value, email: form.email.value, telefone: form.telefone.value });
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const dados = lerCliente();
      if (!mostrarErros(form, V.validarCliente(dados))) return;
      const btn = $('button[type=submit]', form);
      btn.disabled = true;
      try {
        const r = await api('POST', '/api/clientes', dados);
        toast(`Cliente cadastrado: ${r.id}`, 'sucesso');
        form.reset();
        estado.clienteVenda = r.id;
        await carregar();
      } catch (e) {
        if (e.campos) mostrarErros(form, e.campos);
        else if (/CPF/i.test(e.message)) mostrarErros(form, { cpf: e.message });
        else if (/e-mail/i.test(e.message)) mostrarErros(form, { email: e.message });
        else if (/telefone/i.test(e.message)) mostrarErros(form, { telefone: e.message });
        toast(e.message, 'erro');
      } finally { btn.disabled = false; }
    });
  }

  // ------------------------------------------------------------------
  // PRODUTOS (entidade: tabela produtos)
  // ------------------------------------------------------------------
  async function produtos(alvo) {
    const gerencia = !!estado.usuario.pode_gerenciar_estoque;
    alvo.innerHTML = `
      ${cabecalho('Produtos', 'Catálogo lido diretamente da tabela.', fonte('TABELA', 'produtos'))}
      <section class="cartao">
        <div class="cartao-topo">
          <div class="filtros">
            <label class="filtro"><span class="sr-only">Buscar</span><input id="prod-busca" type="search" placeholder="Buscar produto…" maxlength="60"></label>
            <label class="filtro"><span class="sr-only">Categoria</span><select id="prod-cat"><option value="">Todas as categorias</option>${estado.categorias.map((c) => `<option value="${c.id}">${esc(c.nome)}</option>`).join('')}</select></label>
          </div>
          ${gerencia ? '' : '<span class="suave">Somente leitura para o seu perfil</span>'}
        </div>
        <div class="tabela-rolagem"><table>
          <thead><tr><th>#</th><th>Produto</th><th>Categoria</th><th class="num">Preço</th><th>Estoque</th><th class="num">Mín.</th><th></th></tr></thead>
          <tbody id="lista-produtos"></tbody>
        </table></div>
      </section>`;
    let lista = [];
    let n = 0;
    const carregar = async () => {
      const meu = ++n;
      const q = new URLSearchParams({ busca: $('#prod-busca').value, categoria: $('#prod-cat').value });
      const r = await api('GET', `/api/produtos?${q}`);
      if (meu !== n) return;
      lista = r;
      $('#lista-produtos').innerHTML = lista.map((p) => {
        const classe = p.estoque === 0 ? 'zero' : p.estoque <= p.estoque_minimo ? 'baixo' : '';
        return `<tr>
          <td class="suave">${p.id}</td><td><b>${esc(p.nome)}</b></td><td>${esc(p.categoria)}</td>
          <td class="num">${fmtMoeda(p.preco)}</td>
          <td><div class="estoque-barra"><b class="num">${p.estoque}</b><span class="trilho"><span class="${classe}" data-larg="${Math.min(100, (p.estoque / Math.max(p.estoque_minimo * 3, 1)) * 100)}"></span></span>${etiquetaEstoque(p)}</div></td>
          <td class="num">${p.estoque_minimo}</td>
          <td class="acoes"><button class="btn btn-texto btn-pequeno" data-ficha="${p.id}" title="Ficha técnica (MongoDB)">Ficha</button>${gerencia ? `<button class="btn btn-texto btn-pequeno" data-repor="${p.id}">Repor</button><button class="btn btn-texto btn-pequeno" data-preco="${p.id}">Preço</button>` : ''}</td>
        </tr>`;
      }).join('') || `<tr><td colspan="7" class="vazio">Nenhum produto encontrado.</td></tr>`;
      $$('[data-larg]', alvo).forEach((s) => { s.style.width = `${s.dataset.larg}%`; });
      $$('[data-repor]', alvo).forEach((b) => b.addEventListener('click', () => dialogoReposicao(lista.find((p) => p.id === Number(b.dataset.repor)), carregar)));
      $$('[data-preco]', alvo).forEach((b) => b.addEventListener('click', () => dialogoPreco(lista.find((p) => p.id === Number(b.dataset.preco)), carregar)));
      $$('[data-ficha]', alvo).forEach((b) => b.addEventListener('click', () => dialogoFicha(lista.find((p) => p.id === Number(b.dataset.ficha)), gerencia)));
    };
    let atraso;
    $('#prod-busca').addEventListener('input', () => { clearTimeout(atraso); atraso = setTimeout(carregar, 250); });
    $('#prod-cat').addEventListener('change', carregar);
    await carregar();
  }

  function dialogoReposicao(p, depois) {
    const dlg = abrirDialogo({
      titulo: `Repor estoque · ${p.nome}`,
      corpo: `<form id="form-repor" novalidate>
        <p class="suave">Estoque atual: <b>${p.estoque}</b> · mínimo ${p.estoque_minimo} &nbsp; ${fonte('PROCEDURE', 'sp_repor_estoque')}</p>
        <div class="campo"><label for="rep-qtd">Quantidade de entrada</label>
          <input id="rep-qtd" name="quantidade" type="number" inputmode="numeric" min="1" max="10000" step="1" value="${Math.max(p.estoque_minimo * 2 - p.estoque, 1)}" required><span class="erro" data-erro="quantidade"></span></div>
        <div class="campo"><label for="rep-motivo">Motivo</label>
          <input id="rep-motivo" name="motivo" maxlength="60" placeholder="Ex.: Nota fiscal 1234" required><span class="dica">Fica registrado em log_estoque com o seu usuário</span><span class="erro" data-erro="motivo"></span></div>
      </form>`,
      acoes: [{ texto: 'Cancelar', acao: () => $('#dialogo').close() }, { texto: 'Confirmar reposição', classe: 'btn-primario', submit: 'form-repor' }],
    });
    const form = $('#form-repor', dlg);
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const dados = { quantidade: Number(form.quantidade.value), motivo: form.motivo.value };
      if (!mostrarErros(form, V.validarReposicao(dados))) return;
      try {
        await api('POST', `/api/produtos/${p.id}/reposicao`, dados);
        dlg.close();
        toast(`Estoque de "${p.nome}" atualizado (+${dados.quantidade})`, 'sucesso');
        atualizarContadorEstoque();
        depois();
      } catch (e) { if (e.campos) mostrarErros(form, e.campos); toast(e.message, 'erro'); }
    });
  }

  function dialogoPreco(p, depois) {
    const dlg = abrirDialogo({
      titulo: `Alterar preço · ${p.nome}`,
      corpo: `<form id="form-preco" novalidate>
        <p class="suave">Preço atual: <b>${fmtMoeda(p.preco)}</b> &nbsp; ${fonte('PROCEDURE', 'sp_atualizar_preco')}</p>
        <div class="campo"><label for="novo-preco">Novo preço (R$)</label>
          <input id="novo-preco" name="preco" type="number" inputmode="decimal" min="0.01" max="999999.99" step="0.01" value="${p.preco}" required>
          <span class="dica">O trigger trg_produtos_au_historico_preco grava o histórico automaticamente</span><span class="erro" data-erro="preco"></span></div>
      </form>`,
      acoes: [{ texto: 'Cancelar', acao: () => $('#dialogo').close() }, { texto: 'Salvar preço', classe: 'btn-primario', submit: 'form-preco' }],
    });
    const form = $('#form-preco', dlg);
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const dados = { preco: form.preco.value === '' ? NaN : Number(form.preco.value) };
      if (!mostrarErros(form, V.validarPreco(dados))) return;
      try {
        await api('PUT', `/api/produtos/${p.id}/preco`, dados);
        dlg.close();
        toast(`Preço de "${p.nome}" alterado para ${fmtMoeda(dados.preco)}`, 'sucesso');
        depois();
      } catch (e) { if (e.campos) mostrarErros(form, e.campos); toast(e.message, 'erro'); }
    });
  }

  // ------------------------------------------------------------------
  // ESTOQUE BAIXO
  // ------------------------------------------------------------------
  async function estoque(alvo) {
    const gerencia = !!estado.usuario.pode_gerenciar_estoque;
    const lista = await api('GET', '/api/estoque-baixo');
    alvo.innerHTML = `
      ${cabecalho('Estoque baixo', 'Produtos ativos com estoque menor ou igual ao mínimo definido.', fonte('VIEW', 'vw_estoque_baixo'))}
      <section class="cartao"><div class="tabela-rolagem"><table>
        <thead><tr><th>Produto</th><th>Categoria</th><th class="num">Estoque</th><th class="num">Mínimo</th><th class="num">Sugestão</th>${gerencia ? '<th></th>' : ''}</tr></thead>
        <tbody>${lista.map((p) => `<tr><td><b>${esc(p.nome)}</b></td><td>${esc(p.categoria)}</td>
          <td class="num">${etiquetaEstoque(p)} ${p.estoque}</td><td class="num">${p.estoque_minimo}</td><td class="num">+${p.sugestao_reposicao}</td>
          ${gerencia ? `<td class="acoes"><button class="btn btn-contorno btn-pequeno" data-repor="${p.id}">Repor</button></td>` : ''}</tr>`).join('')
          || '<tr><td colspan="6" class="vazio">Nenhum produto abaixo do mínimo. 🎉</td></tr>'}</tbody>
      </table></div></section>`;
    $$('[data-repor]', alvo).forEach((b) => b.addEventListener('click', () => {
      const p = lista.find((x) => x.id === Number(b.dataset.repor));
      dialogoReposicao(p, () => rotear());
    }));
  }

  // ------------------------------------------------------------------
  // EQUIPE (usuarios + grupos_usuarios)
  // ------------------------------------------------------------------
  async function equipe(alvo) {
    const lista = await api('GET', '/api/usuarios');
    const marca = (v) => (v ? '<span class="etiqueta ok">Sim</span>' : '<span class="etiqueta neutra">Não</span>');
    alvo.innerHTML = `
      ${cabecalho('Equipe e grupos', 'Usuários do sistema e as permissões herdadas do grupo. Colunas de senha não são expostas.', fonte('VIEW', 'vw_usuarios_publico'))}
      <section class="cartao"><div class="tabela-rolagem"><table>
        <thead><tr><th>Usuário</th><th>Grupo</th><th>Vende</th><th>Gerencia estoque</th><th>Cadastra clientes</th><th>Último acesso</th></tr></thead>
        <tbody>${lista.map((u) => `<tr><td><b>${esc(u.nome)}</b><br><small class="suave"><span class="mono">${esc(u.id)}</span> · ${esc(u.email)}</small></td>
          <td><span class="etiqueta grupo">${esc(u.grupo)}</span></td><td>${marca(u.pode_vender)}</td><td>${marca(u.pode_gerenciar_estoque)}</td><td>${marca(u.pode_cadastrar_clientes)}</td>
          <td>${fmtData(u.ultimo_login)}</td></tr>`).join('')}</tbody>
      </table></div></section>`;
  }

  // ------------------------------------------------------------------
  // SEGURANÇA DO BD (evidências para a apresentação)
  // ------------------------------------------------------------------
  const DESCRICAO_TESTE = {
    ler_senhas: 'Ler hashes de senha da tabela usuarios',
    ler_cpf: 'Ler CPF completo direto da tabela clientes',
    alterar_preco: 'Alterar preço sem passar pela procedure',
    apagar_pedidos: 'Apagar pedidos',
    criar_tabela: 'Criar uma tabela (DDL)',
    criar_usuario: 'Criar usuário do sistema (procedure restrita ao DBA)',
  };

  async function seguranca(alvo) {
    const s = await api('GET', '/api/seguranca');
    const realce = (g) => esc(g).replace(/\b(GRANT|SELECT|EXECUTE|USAGE|ON|TO|PROCEDURE|FUNCTION)\b/g, '<span class="kw">$1</span>');
    alvo.innerHTML = `
      ${cabecalho('Segurança do banco de dados', 'Evidências, ao vivo, de que a API usa uma conta de menor privilégio e não o root.')}
      <div class="grade-kpi">
        <div class="cartao kpi"><div class="rotulo">Conta MySQL da API</div><div class="valor mono">${esc(s.conta_bd)}</div><div class="detalhe">CURRENT_USER()</div></div>
        <div class="cartao kpi ciano"><div class="rotulo">Roles ativas</div><div class="valor mono valor-pequeno">${esc(s.roles).replace(/,/g, '<br>')}</div><div class="detalhe">CURRENT_ROLE()</div></div>
        <div class="cartao kpi laranja"><div class="rotulo">Servidor</div><div class="valor">MySQL ${esc(String(s.versao_mysql).split('-')[0])}</div><div class="detalhe">VERSION()</div></div>
      </div>
      <div class="grade-2">
        <section class="cartao">
          <div class="cartao-topo"><h2>Privilégios concedidos</h2><span class="fonte">SHOW GRANTS</span></div>
          <div class="cartao-corpo"><pre class="grants">${s.grants.map(realce).join('\n')}</pre>
          <p class="suave"><small>Sem INSERT, UPDATE ou DELETE em tabelas: toda escrita passa por procedures, que validam as regras e controlam a transação.</small></p></div>
        </section>
        <section class="cartao">
          <div class="cartao-topo"><h2>Tentativas proibidas</h2><span class="suave">Executadas pela API</span></div>
          <div class="cartao-corpo">
            ${s.testes.map((t) => `<div class="teste-acesso" data-teste="${esc(t.id)}">
              <div><b>${esc(DESCRICAO_TESTE[t.id] || t.id)}</b><br><code>${esc(t.sql)}</code></div>
              <button class="btn btn-perigo btn-pequeno" type="button">Tentar</button>
              <div class="resultado-teste" hidden></div></div>`).join('')}
            <button class="btn btn-contorno mt" type="button" id="testar-todos">Tentar todas</button>
          </div>
        </section>
      </div>`;
    const testar = async (bloco) => {
      const r = await api('POST', `/api/seguranca/testar/${bloco.dataset.teste}`);
      const res = $('.resultado-teste', bloco);
      res.hidden = false;
      res.className = `resultado-teste ${r.permitido ? 'permitido' : 'negado'}`;
      res.textContent = r.permitido ? '⚠ PERMITIDO: a conta tem privilégio demais!' : `✔ NEGADO pelo MySQL: ${r.codigo} · ${r.mensagem}`;
    };
    $$('[data-teste]', alvo).forEach((b) => $('button', b).addEventListener('click', () => testar(b).catch((e) => toast(e.message, 'erro'))));
    $('#testar-todos').addEventListener('click', async () => { for (const b of $$('[data-teste]', alvo)) await testar(b).catch((e) => toast(e.message, 'erro')); });
  }

  // ------------------------------------------------------------------
  // FICHA TÉCNICA (MongoDB · coleção fichas_tecnicas)
  // ------------------------------------------------------------------
  async function dialogoFicha(p, podeEditar) {
    let ficha;
    try { ficha = await api('GET', `/api/produtos/${p.id}/ficha`); } catch (e) { return toast(e.message, 'erro'); }
    const linhas = Object.entries(ficha.atributos || {});
    const json = JSON.stringify({ _id: ficha._id, categoria: ficha.categoria, atributos: ficha.atributos, destaques: ficha.destaques, atualizado_por: ficha.atualizado_por }, null, 2);
    const leitura = `
      <p>${fonte('MONGODB', 'fichas_tecnicas')} <span class="suave"><small>Preço e estoque continuam no MySQL.</small></span></p>
      ${linhas.length ? `<table><tbody>${linhas.map(([k, v]) => `<tr><th>${esc(rotuloAtributo(k))}</th><td>${esc(valorAtributo(v))}</td></tr>`).join('')}</tbody></table>` : '<p class="vazio">Sem ficha técnica cadastrada.</p>'}
      ${(ficha.destaques || []).length ? `<p class="specs">${ficha.destaques.map((d) => `<span>★ ${esc(d)}</span>`).join('')}</p>` : ''}
      <details class="mt"><summary>Ver documento JSON</summary><pre class="grants">${esc(json)}</pre></details>`;
    const edicao = `
      <form id="form-ficha" novalidate>
        <p>${fonte('MONGODB', 'fichas_tecnicas')} <span class="suave"><small>Cada categoria tem atributos próprios: esquema flexível.</small></span></p>
        <div id="linhas-ficha"></div>
        <button type="button" class="btn btn-texto btn-pequeno" id="add-linha">${icone.mais} Adicionar atributo</button>
        <div class="campo"><span class="erro" data-erro="atributos"></span></div>
        <div class="campo"><label for="ficha-destaques">Destaques <span class="suave">(um por linha, até 5)</span></label>
          <textarea id="ficha-destaques" name="destaques" rows="3" maxlength="420">${esc((ficha.destaques || []).join('\n'))}</textarea>
          <span class="erro" data-erro="destaques"></span></div>
        <p class="dica suave"><small>Valores numéricos viram número; "sim/não" viram booleano; itens separados por vírgula viram lista.</small></p>
        <details><summary>Ver documento JSON atual</summary><pre class="grants">${esc(json)}</pre></details>
      </form>`;
    const dlg = abrirDialogo({
      titulo: `Ficha técnica · ${p.nome}`,
      corpo: podeEditar ? edicao : leitura,
      acoes: podeEditar
        ? [{ texto: 'Cancelar', acao: () => $('#dialogo').close() }, { texto: 'Salvar no MongoDB', classe: 'btn-primario', submit: 'form-ficha' }]
        : [{ texto: 'Fechar', classe: 'btn-primario', acao: () => $('#dialogo').close() }],
    });
    if (!podeEditar) return;
    const caixa = $('#linhas-ficha', dlg);
    const addLinha = (k = '', v = '') => {
      const div = document.createElement('div');
      div.className = 'linha-atributo';
      div.innerHTML = `<input aria-label="Atributo" placeholder="atributo (ex.: taxa_hz)" maxlength="40" value="${esc(k)}">
        <input aria-label="Valor" placeholder="valor" maxlength="200" value="${esc(v === '' ? '' : valorAtributo(v))}">
        <button type="button" class="btn btn-texto btn-pequeno" aria-label="Remover atributo">${icone.lixo}</button>`;
      div.querySelector('button').onclick = () => div.remove();
      caixa.append(div);
    };
    linhas.forEach(([k, v]) => addLinha(k, v));
    if (!linhas.length) addLinha();
    $('#add-linha', dlg).onclick = () => addLinha();
    const form = $('#form-ficha', dlg);
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const atributos = {};
      for (const l of $$('.linha-atributo', caixa)) {
        const [ik, iv] = $$('input', l);
        const k = ik.value.trim().toLowerCase();
        if (!k && !iv.value.trim()) continue;
        atributos[k] = iv.value.trim() === '' ? '' : V.converterValorAtributo(iv.value);
      }
      const destaques = form.destaques.value.split('\n').map((x) => x.trim()).filter(Boolean);
      if (!mostrarErros(form, V.validarFicha({ atributos, destaques }))) return;
      try {
        await api('PUT', `/api/produtos/${p.id}/ficha`, { atributos, destaques });
        dlg.close();
        toast(`Ficha de "${p.nome}" salva no MongoDB`, 'sucesso');
      } catch (e) { if (e.campos) mostrarErros(form, e.campos); toast(e.message, 'erro'); }
    });
  }

  // ------------------------------------------------------------------
  // NoSQL · MongoDB (recurso extra)
  // ------------------------------------------------------------------
  const NOME_EVENTO = {
    login_sucesso: 'Login', login_falha: 'Login falhou', login_bloqueado: 'Login bloqueado',
    venda_registrada: 'Venda', venda_recusada: 'Venda recusada', cliente_cadastrado: 'Cliente cadastrado',
    cliente_recusado: 'Cliente recusado', estoque_reposto: 'Reposição', preco_alterado: 'Preço alterado',
    ficha_atualizada: 'Ficha atualizada', acesso_negado: 'Acesso negado',
  };
  const classeEvento = (t) => (/falha|recusad|bloquead|negado/.test(t) ? 'zero' : /venda_registrada|cadastrado|reposto/.test(t) ? 'ok' : 'grupo');
  const resumoEvento = (e) => {
    const d = e.dados || {};
    if (e.tipo === 'venda_registrada') return `${d.pedido} · ${fmtMoeda(d.total)}`;
    if (d.motivo) return d.motivo;
    if (d.produto) return `produto #${d.produto}${d.quantidade ? ` · +${d.quantidade}` : ''}${d.preco ? ` · ${fmtMoeda(d.preco)}` : ''}`;
    if (d.cliente) return d.cliente;
    if (d.email) return d.email;
    if (d.permissao) return d.permissao;
    return '';
  };
  const hora = (iso) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });

  async function nosql(alvo) {
    let d;
    try {
      d = await api('GET', '/api/nosql/painel');
    } catch (e) {
      if (e.status !== 503) throw e;
      alvo.innerHTML = `${cabecalho('NoSQL · MongoDB', '')}
        <div class="cartao"><div class="cartao-corpo"><div class="aviso alerta">${icone.info}<span><b>MongoDB indisponível.</b> Repare que vendas, estoque e cadastros continuam funcionando: o núcleo transacional está no MySQL e o NoSQL é complementar (degradação graciosa).</span></div></div></div>`;
      return;
    }
    const eventos24h = d.porTipo.reduce((s, x) => s + x.total, 0);
    const maxTipo = Math.max(1, ...d.porTipo.map((x) => x.total));
    alvo.innerHTML = `
      ${cabecalho('NoSQL · MongoDB', 'Persistência poliglota: o MySQL guarda o que exige transação; o MongoDB, o que pede esquema flexível e alto volume.', fonte('MONGODB', 'lojatech_nosql'))}
      <div class="grade-kpi">
        <div class="cartao kpi"><div class="rotulo">Conta MongoDB da API</div><div class="valor mono valor-pequeno">${esc(d.conta)}</div><div class="detalhe">${esc(d.roles.join(', '))}</div></div>
        <div class="cartao kpi ciano"><div class="rotulo">Fichas técnicas</div><div class="valor">${d.totais.fichas}</div><div class="detalhe">${d.chaves.length} atributos diferentes</div></div>
        <div class="cartao kpi laranja"><div class="rotulo">Eventos registrados</div><div class="valor">${d.totais.eventos}</div><div class="detalhe">${eventos24h} nas últimas 24 h</div></div>
      </div>

      <div class="grade-2 mb">
        <section class="cartao">
          <div class="cartao-topo"><h2>Por que MongoDB aqui?</h2></div>
          <div class="cartao-corpo porques">
            <div><h3>Fichas técnicas</h3><p>Mouse tem <i>DPI</i>, monitor tem <i>Hz</i>, SSD tem <i>MB/s</i>. No relacional seriam dezenas de colunas quase sempre nulas, ou o modelo EAV, lento e difícil de consultar. No MongoDB cada documento tem seus próprios atributos, com <b>validação $jsonSchema</b> e <b>índice curinga</b> para buscar por qualquer um deles.</p></div>
            <div><h3>Log de eventos</h3><p>Escrita intensa, formato que varia por tipo de evento, sem necessidade de transação. O <b>índice TTL</b> apaga sozinho o que tem mais de 90 dias, e o <b>aggregation pipeline</b> gera os painéis abaixo sem pesar no MySQL das vendas.</p></div>
            <div><h3>Fonte da verdade</h3><p>Preço, estoque e pedidos ficam <b>só no MySQL</b> (ACID). A ficha usa o mesmo <code>id</code> do produto. Se o MongoDB cair, a loja continua vendendo.</p></div>
          </div>
        </section>
        <section class="cartao">
          <div class="cartao-topo"><h2>Busca por atributo</h2><span class="fonte mongo">índice <code>atributos.$**</code></span></div>
          <form class="cartao-corpo" id="form-busca" novalidate>
            <div class="linha-busca">
              <div class="campo"><label for="b-chave">Atributo</label><input id="b-chave" name="chave" list="lista-chaves" placeholder="ex.: taxa_hz" maxlength="40" value="capacidade_gb"><span class="erro" data-erro="chave"></span></div>
              <div class="campo"><label for="b-op">Condição</label><select id="b-op" name="operador"><option value="gte">≥</option><option value="lte">≤</option><option value="eq">=</option><option value="contem">contém</option></select><span class="erro" data-erro="operador"></span></div>
              <div class="campo"><label for="b-valor">Valor</label><input id="b-valor" name="valor" maxlength="40" value="1000"><span class="erro" data-erro="valor"></span></div>
            </div>
            <datalist id="lista-chaves">${d.chaves.map((c) => `<option value="${esc(c._id)}">${c.produtos} produto(s)</option>`).join('')}</datalist>
            <button class="btn btn-primario" type="submit">Buscar no MongoDB</button>
            <div id="resultado-busca" class="mt"></div>
          </form>
        </section>
      </div>

      <div class="grade-2 mb">
        <section class="cartao">
          <div class="cartao-topo"><h2>Atividade nas últimas 24 h</h2><span class="fonte mongo">$match → $group → $sort</span></div>
          <div class="cartao-corpo">${d.porTipo.length ? d.porTipo.map((x) => `
            <div class="barra-h"><span>${esc(NOME_EVENTO[x._id] || x._id)}</span><span class="trilho"><span class="${classeEvento(x._id)}" data-larg="${(x.total / maxTipo) * 100}"></span></span><b class="num">${x.total}</b></div>`).join('') : '<p class="vazio">Nenhum evento ainda. Faça um login ou uma venda.</p>'}
            ${d.porUsuario.length ? `<h3 class="mt">Vendas por vendedor (24 h)</h3><table><tbody>${d.porUsuario.map((u) => `<tr><td>${esc(u._id)}</td><td class="num">${u.vendas} venda(s)</td><td class="num"><b>${fmtMoeda(u.faturamento)}</b></td></tr>`).join('')}</tbody></table>` : ''}
          </div>
        </section>
        <section class="cartao">
          <div class="cartao-topo"><h2>Eventos recentes</h2><span class="fonte mongo">coleção <code>eventos</code></span></div>
          <ul class="eventos">${d.recentes.map((e) => `<li><span class="etiqueta ${classeEvento(e.tipo)}">${esc(NOME_EVENTO[e.tipo] || e.tipo)}</span>
            <span class="evento-txt"><b>${esc(e.usuario?.nome || 'anônimo')}</b> ${esc(resumoEvento(e))}</span><small class="suave">${hora(e.quando)}</small></li>`).join('') || '<li class="vazio">Sem eventos.</li>'}</ul>
        </section>
      </div>

      <div class="grade-2">
        <section class="cartao">
          <div class="cartao-topo"><h2>Índices</h2><span class="suave">getIndexes()</span></div>
          <div class="tabela-rolagem"><table><thead><tr><th>Coleção</th><th>Índice</th><th>Chave</th></tr></thead><tbody>
            ${d.indices.flatMap((c) => c.indices.map((i) => `<tr><td>${esc(c.colecao)}</td><td class="mono">${esc(i.nome)}${i.ttl_dias ? ` <span class="etiqueta baixo">TTL ${i.ttl_dias} dias</span>` : ''}</td><td class="mono">${esc(JSON.stringify(i.chave))}</td></tr>`)).join('')}
          </tbody></table></div>
        </section>
        <section class="cartao">
          <div class="cartao-topo"><h2>Menor privilégio no MongoDB</h2><span class="suave">O log é imutável para a API</span></div>
          <div class="cartao-corpo">
            ${d.testes.map((t) => `<div class="teste-acesso" data-teste-mongo="${esc(t.id)}"><div><code>${esc(t.descricao)}</code></div>
              <button class="btn btn-perigo btn-pequeno" type="button">Tentar</button><div class="resultado-teste" hidden></div></div>`).join('')}
          </div>
        </section>
      </div>`;

    $$('[data-larg]', alvo).forEach((s) => { s.style.width = `${s.dataset.larg}%`; });
    $$('[data-teste-mongo]', alvo).forEach((b) => $('button', b).addEventListener('click', async () => {
      try {
        const r = await api('POST', `/api/nosql/testar/${b.dataset.testeMongo}`);
        const res = $('.resultado-teste', b);
        res.hidden = false;
        res.className = `resultado-teste ${r.permitido ? 'permitido' : 'negado'}`;
        res.textContent = r.permitido ? '⚠ PERMITIDO: privilégio demais!' : `✔ NEGADO pelo MongoDB: ${r.codigo}`;
      } catch (e) { toast(e.message, 'erro'); }
    }));

    const form = $('#form-busca', alvo);
    const buscar = async () => {
      const dados = { chave: form.chave.value.trim(), operador: form.operador.value, valor: form.valor.value.trim() };
      if (!mostrarErros(form, V.validarBuscaAtributo(dados))) return;
      const saida = $('#resultado-busca', alvo);
      try {
        const r = await api('GET', `/api/nosql/busca?${new URLSearchParams(dados)}`);
        saida.innerHTML = `
          <p><span class="etiqueta ${r.plano.estagio === 'IXSCAN' ? 'ok' : 'baixo'}">${esc(r.plano.estagio)}</span>
            ${r.plano.indice ? `<code>${esc(r.plano.indice)}</code>` : ''} · ${r.plano.docs_examinados} documento(s) examinado(s)</p>
          <pre class="grants">db.fichas_tecnicas.find(${esc(JSON.stringify(r.filtro))})</pre>
          <div class="tabela-rolagem"><table><thead><tr><th>Produto</th><th>${esc(rotuloAtributo(dados.chave))}</th><th class="num">Preço <small>(MySQL)</small></th><th class="num">Estoque <small>(MySQL)</small></th></tr></thead>
          <tbody>${r.resultados.map((x) => `<tr><td><b>${esc(x.nome || `#${x.id}`)}</b><br><small class="suave">${esc(x.categoria)}</small></td><td>${esc(valorAtributo(x.valor))}</td><td class="num">${x.preco != null ? fmtMoeda(x.preco) : '—'}</td><td class="num">${x.estoque ?? '—'}</td></tr>`).join('') || '<tr><td colspan="4" class="vazio">Nenhum produto com esse atributo.</td></tr>'}</tbody></table></div>`;
      } catch (e) { if (e.campos) mostrarErros(form, e.campos); toast(e.message, 'erro'); }
    };
    form.addEventListener('submit', (ev) => { ev.preventDefault(); buscar(); });
    buscar();
  }

  // ------------------------------------------------------------------
  // Início
  // ------------------------------------------------------------------
  (async () => {
    if (!estado.token) return mostrarLogin();
    try {
      estado.usuario = await api('GET', '/api/me');
      await iniciarApp();
    } catch { sair(); }
  })();
})();
