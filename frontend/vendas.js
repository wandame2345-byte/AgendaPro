/* AgendaPro: carregar este arquivo DEPOIS de app.js. */
(() => {
  'use strict';

  if (window.agendaSalonSalesLoaded) return;
  window.agendaSalonSalesLoaded = true;

  let products = [];
  let sales = [];
  let ready = false;
  let sequence = 0;

  let productId = null;
  let saleId = null;
  let editId = null;

  let productSaving = false;
  let saleSaving = false;
  let editSaving = false;

  let originalItems = '';
  let productPhotoURL = null;

  const byId = id => document.getElementById(id);
  const html = value => esc(value);
  const cents = value => Math.round(Number(value || 0) * 100);

  const staff = () => currentUser && currentUser.role !== 'cliente';
  const isAdmin = () => currentUser?.role === 'admin';

  const base = {
    nav: navItemsFor,
    refresh: refreshData,
    logout,
    renderAll,
    totals: periodTotals,
    dashboard: renderDashboard,
    actions: appointmentActions,
    dashboardFilter: applyDashboardFilter,
    clearDashboard: clearDashboardFilter,
    reportPeriod: updateReportPeriod
  };

  function salesInPeriod(start, end) {
    return sales.filter(sale =>
      sale.status === 'Confirmada' &&
      sale.date >= start &&
      sale.date <= end
    );
  }

  function combinedTotals(start, end) {
    const services = base.totals(start, end);
    const list = salesInPeriod(start, end);
    const productCents = list.reduce((sum, sale) => sum + cents(sale.total), 0);
    return {
      ...services,
      serviceRevenue: services.revenue,
      productRevenue: productCents / 100,
      salesCount: list.length,
      revenue: (cents(services.revenue) + productCents) / 100
    };
  }

  function setMessage(id, text, error = false) {
    const node = byId(id);
    if (!node) return;
    node.textContent = text;
    node.style.color = error ? 'var(--danger)' : 'var(--muted)';
  }

  function closeDialog(id) {
    const dialog = byId(id);
    if (dialog?.open) dialog.close();
  }

  function showDialog(id) {
    if (byId('dailyDialog')?.open) byId('dailyDialog').close();
    if (!byId(id).open) byId(id).showModal();
  }

  function preserveOptions(select, markup) {
    const previous = select.value;
    select.innerHTML = markup;
    if ([...select.options].some(option => option.value === previous)) {
      select.value = previous;
    }
  }

  function clientOptions(empty = 'Selecione o cliente') {
    return `<option value="">${empty}</option>` +
      clients.map(client => `
        <option value="${html(client.id)}">
          ${html(client.name)} — ${html(client.phone)}
        </option>
      `).join('');
  }

  function productOptions(selected = '', savedName = '') {
    const options = products.filter(product =>
      product.active !== false || String(product.id) === String(selected)
    );
    let result = '<option value="">Selecione o produto</option>' +
      options.map(product => `
        <option value="${html(product.id)}" ${product.active === false ? 'disabled' : ''}>
          ${html(product.name)} ${product.active === false ? ' (inativo)' : ''}
        </option>
      `).join('');
    if (selected && !options.some(product => String(product.id) === String(selected))) {
      result += `<option value="${html(selected)}" disabled>${html(savedName || 'Produto antigo')} (inativo)</option>`;
    }
    return result;
  }

  function summaryCards(values) {
    return values.map(([label, value]) => `
      <div><small>${html(label)}</small><strong>${html(value)}</strong></div>
    `).join('');
  }

  function addDialog(id, title, content) {
    const dialog = document.createElement('dialog');
    dialog.id = id;
    dialog.className = 'salon-dialog';
    dialog.setAttribute('aria-labelledby', id + 'Title');
    dialog.innerHTML = `<h2 id="${id}Title">${title}</h2>${content}`;
    document.body.appendChild(dialog);
    return dialog;
  }

  function mount() {
    const style = document.createElement('style');
    style.textContent = `
      .salon-actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
      .salon-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}
      .salon-grid label{display:grid;gap:6px;min-width:0}
      .salon-full{grid-column:1/-1}
      .salon-dialog{width:min(820px,calc(100vw - 28px));max-height:90dvh;overflow:auto;padding:24px;border:1px solid var(--border,#ead5dd);border-radius:18px;background:var(--card,#fff);color:var(--text,#362f38);box-sizing:border-box}
      .salon-dialog::backdrop{background:#0008}
      .salon-dialog h2{margin:0 0 18px}
      .salon-dialog fieldset{border:0;padding:0;margin:0;min-width:0}
      .salon-dialog input,.salon-dialog select,.salon-dialog textarea,#salonSales input,#salonSales select{box-sizing:border-box;max-width:100%;padding:11px;border:1px solid var(--border,#dec8d0);border-radius:9px;background:var(--card,#fff);color:var(--text,#362f38);font:inherit;min-height:44px}
      .salon-dialog label input,.salon-dialog label select,.salon-dialog textarea{width:100%}
      .salon-dialog button{min-height:40px}
      .salon-message{min-height:22px;margin:12px 0;line-height:1.5}
      .salon-catalog{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:16px}
      .salon-product{border:1px solid var(--border,#ead5dd);border-radius:14px;padding:14px;background:var(--card,#fff);overflow:hidden}
      .salon-product h3{margin:12px 0 6px;overflow-wrap:anywhere}
      .salon-product p{color:var(--muted);overflow-wrap:anywhere}
      .salon-product img,.salon-photo-empty{display:block;width:100%;height:150px;object-fit:contain;border-radius:10px;background:var(--bg,#f8f3f5)}
      .salon-photo-empty{display:grid;place-items:center;color:var(--muted)}
      .salon-preview{width:120px;height:120px;object-fit:contain;border-radius:10px;margin-top:8px}
      .salon-line{display:grid;grid-template-columns:minmax(160px,2fr) 80px 110px auto;gap:8px;align-items:end;border:1px solid var(--border,#ead5dd);padding:12px;border-radius:12px;margin:10px 0}
      .salon-line label{display:grid;gap:5px;font-size:13px;min-width:0}
      .salon-line-total{grid-column:1/-1;color:var(--muted);font-size:13px}
      .salon-summary{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin:16px 0}
      .salon-summary>div{background:var(--card,#fff);border:1px solid var(--border,#ead5dd);border-radius:12px;padding:14px}
      .salon-summary small{display:block;color:var(--muted);margin-bottom:8px}
      .salon-summary strong{font-size:21px}
      .salon-filters{display:flex;flex-wrap:wrap;gap:12px;align-items:end;margin:16px 0}
      .salon-filters label{display:grid;gap:6px;flex:1 1 155px;min-width:0}
      #salonSales .panel{margin-bottom:20px}
      #salonSales table{min-width:880px}
      #salonSales .table-wrap{overflow:auto}
      #salonSales [hidden],.salon-dialog [hidden],#salonFinance[hidden]{display:none!important}
      .salon-history-items{min-width:210px;line-height:1.6}
      .salon-history-note{display:block;color:var(--muted);max-width:260px;overflow-wrap:anywhere}
      @media(max-width:600px){
        .salon-dialog{padding:16px}
        .salon-grid,.salon-summary{grid-template-columns:1fr}
        .salon-line{grid-template-columns:1fr 1fr}
        .salon-line label:first-child,.salon-line button{grid-column:1/-1}
        .salon-catalog{grid-template-columns:repeat(2,minmax(0,1fr))}
        .salon-product{padding:10px}
        .salon-product img,.salon-photo-empty{height:110px}
        .salon-product .btn{width:100%}
      }
    `;
    document.head.appendChild(style);

    const section = document.createElement('section');
    section.id = 'salonSales';
    section.className = 'section';
    section.innerHTML = `
      <div class="top">
        <div><h1>Vendas Salão</h1><p>Produtos, vendas para clientes e histórico de compras.</p></div>
        <div class="salon-actions">
          <button id="newSalonProduct" class="btn secondary" type="button">+ Cadastrar produto</button>
          <button id="newSalonSale" class="btn primary" type="button">+ Nova venda</button>
        </div>
      </div>
      <p id="salonLoadMessage" class="salon-message" role="status"></p>
      <div class="panel">
        <h2>Produtos</h2>
        <div class="salon-filters">
          <label>Buscar produto<input id="salonProductSearch" type="search" placeholder="Nome do produto"></label>
          <label id="salonInactiveWrap">Exibição<select id="salonProductVisibility"><option value="active">Produtos ativos</option><option value="all">Todos, incluindo inativos</option></select></label>
        </div>
        <div id="salonCatalog" class="salon-catalog"></div>
      </div>
      <div class="panel">
        <h2>Histórico de vendas</h2>
        <div class="salon-filters">
          <label>Data inicial<input id="salonStart" type="date"></label>
          <label>Data final<input id="salonEnd" type="date"></label>
          <label>Cliente<select id="salonClientFilter"></select></label>
          <label>Produto<select id="salonProductFilter"></select></label>
          <label>Situação<select id="salonStatusFilter"><option value="">Todas</option><option>Confirmada</option><option>Cancelada</option></select></label>
          <button id="salonFilter" type="button" class="btn primary">Filtrar</button>
          <button id="salonClearFilter" type="button" class="btn secondary">Limpar</button>
        </div>
        <div id="salonSalesSummary" class="salon-summary"></div>
        <div id="salonHistory" class="table-wrap"></div>
      </div>
    `;
    byId('clientes').insertAdjacentElement('afterend', section);

    const panel = document.createElement('div');
    panel.id = 'salonFinance';
    panel.className = 'panel';
    panel.innerHTML = `
      <h2>Financeiro do mês</h2>
      <p>Atendimentos não cancelados + vendas confirmadas de produtos.</p>
      <div id="salonFinanceCards" class="salon-summary"></div>
      <p id="salonFinanceMessage" role="status"></p>
    `;
    byId('dashboard').appendChild(panel);

    const productDialog = addDialog('salonProductDialog', 'Cadastrar produto', `
      <form id="salonProductForm"><fieldset id="salonProductFields">
        <div class="salon-grid">
          <label class="salon-full">Nome do produto<input id="salonProductName" maxlength="150" required></label>
          <label>Preço (R$)<input id="salonProductPrice" type="number" min="0" max="99999999.99" step="0.01" required></label>
          <label>Foto do produto<input id="salonProductPhoto" type="file" accept="image/jpeg,image/png,image/webp,image/gif"></label>
          <div class="salon-full"><img id="salonProductPreview" class="salon-preview" alt="Foto do produto" hidden></div>
          <label class="salon-full">Descrição / observação<textarea id="salonProductDescription" rows="3"></textarea></label>
        </div>
      </fieldset>
      <p id="salonProductMessage" class="salon-message" role="status"></p>
      <div class="salon-actions">
        <button id="salonProductSave" class="btn primary" type="submit">Salvar produto</button>
        <button id="salonProductClose" class="btn secondary" type="button">Fechar</button>
      </div></form>
    `);
    productDialog.addEventListener('cancel', event =>
