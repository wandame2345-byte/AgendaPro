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

  // ===================================================
  // UTILITÁRIOS E FINANCEIRO
  // ===================================================

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

    const productCents = list.reduce(
      (sum, sale) => sum + cents(sale.total),
      0
    );

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
    if (byId('dailyDialog')?.open) {
      byId('dailyDialog').close();
    }

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
      product.active !== false ||
      String(product.id) === String(selected)
    );

    let result = '<option value="">Selecione o produto</option>' +
      options.map(product => `
        <option
          value="${html(product.id)}"
          ${product.active === false ? 'disabled' : ''}
        >
          ${html(product.name)}
          ${product.active === false ? ' (inativo)' : ''}
        </option>
      `).join('');

    if (
      selected &&
      !options.some(product => String(product.id) === String(selected))
    ) {
      result += `
        <option value="${html(selected)}" disabled>
          ${html(savedName || 'Produto antigo')} (inativo)
        </option>
      `;
    }

    return result;
  }

  function summaryCards(values) {
    return values.map(([label, value]) => `
      <div>
        <small>${html(label)}</small>
        <strong>${html(value)}</strong>
      </div>
    `).join('');
  }

  function addDialog(id, title, content) {
    const dialog = document.createElement('dialog');

    dialog.id = id;
    dialog.className = 'salon-dialog';
    dialog.setAttribute('aria-labelledby', id + 'Title');

    dialog.innerHTML = `
      <h2 id="${id}Title">${title}</h2>
      ${content}
    `;

    document.body.appendChild(dialog);
    return dialog;
  }

  // ===================================================
  // INTERFACE
  // ===================================================

  function mount() {
    const style = document.createElement('style');

    style.textContent = `
      .salon-actions {
        display:flex;
        gap:8px;
        flex-wrap:wrap;
        align-items:center;
      }

      .salon-grid {
        display:grid;
        grid-template-columns:repeat(2,minmax(0,1fr));
        gap:14px;
      }

      .salon-grid label {
        display:grid;
        gap:6px;
        min-width:0;
      }

      .salon-full {
        grid-column:1/-1;
      }

      .salon-dialog {
        width:min(820px,calc(100vw - 28px));
        max-height:90dvh;
        overflow:auto;
        padding:24px;
        border:1px solid var(--border,#ead5dd);
        border-radius:18px;
        background:var(--card,#fff);
        color:var(--text,#362f38);
        box-sizing:border-box;
      }

      .salon-dialog::backdrop {
        background:#0008;
      }

      .salon-dialog h2 {
        margin:0 0 18px;
      }

      .salon-dialog fieldset {
        border:0;
        padding:0;
        margin:0;
        min-width:0;
      }

      .salon-dialog input,
      .salon-dialog select,
      .salon-dialog textarea,
      #salonSales input,
      #salonSales select {
        box-sizing:border-box;
        max-width:100%;
        padding:11px;
        border:1px solid var(--border,#dec8d0);
        border-radius:9px;
        background:var(--card,#fff);
        color:var(--text,#362f38);
        font:inherit;
        min-height:44px;
      }

      .salon-dialog label input,
      .salon-dialog label select,
      .salon-dialog textarea {
        width:100%;
      }

      .salon-dialog button {
        min-height:40px;
      }

      .salon-message {
        min-height:22px;
        margin:12px 0;
        line-height:1.5;
      }

      .salon-catalog {
        display:grid;
        grid-template-columns:repeat(auto-fill,minmax(190px,1fr));
        gap:16px;
      }

      .salon-product {
        border:1px solid var(--border,#ead5dd);
        border-radius:14px;
        padding:14px;
        background:var(--card,#fff);
        overflow:hidden;
      }

      .salon-product h3 {
        margin:12px 0 6px;
        overflow-wrap:anywhere;
      }

      .salon-product p {
        color:var(--muted);
        overflow-wrap:anywhere;
      }

      .salon-product img,
      .salon-photo-empty {
        display:block;
        width:100%;
        height:150px;
        object-fit:contain;
        border-radius:10px;
        background:var(--bg,#f8f3f5);
      }

      .salon-photo-empty {
        display:grid;
        place-items:center;
        color:var(--muted);
      }

      .salon-preview {
        width:120px;
        height:120px;
        object-fit:contain;
        border-radius:10px;
        margin-top:8px;
      }

      .salon-line {
        display:grid;
        grid-template-columns:minmax(160px,2fr) 80px 110px auto;
        gap:8px;
        align-items:end;
        border:1px solid var(--border,#ead5dd);
        padding:12px;
        border-radius:12px;
        margin:10px 0;
      }

      .salon-line label {
        display:grid;
        gap:5px;
        font-size:13px;
        min-width:0;
      }

      .salon-line-total {
        grid-column:1/-1;
        color:var(--muted);
        font-size:13px;
      }

      .salon-summary {
        display:grid;
        grid-template-columns:repeat(3,minmax(0,1fr));
        gap:12px;
        margin:16px 0;
      }

      .salon-summary > div {
        background:var(--card,#fff);
        border:1px solid var(--border,#ead5dd);
        border-radius:12px;
        padding:14px;
      }

      .salon-summary small {
        display:block;
        color:var(--muted);
        margin-bottom:8px;
      }

      .salon-summary strong {
        font-size:21px;
      }

      .salon-filters {
        display:flex;
        flex-wrap:wrap;
        gap:12px;
        align-items:end;
        margin:16px 0;
      }

      .salon-filters label {
        display:grid;
        gap:6px;
        flex:1 1 155px;
        min-width:0;
      }

      #salonSales .panel {
        margin-bottom:20px;
      }

      #salonSales table {
        min-width:880px;
      }

      #salonSales .table-wrap {
        overflow:auto;
      }

      #salonSales [hidden],
      .salon-dialog [hidden],
      #salonFinance[hidden] {
        display:none!important;
      }

      .salon-history-items {
        min-width:210px;
        line-height:1.6;
      }

      .salon-history-note {
        display:block;
        color:var(--muted);
        max-width:260px;
        overflow-wrap:anywhere;
      }

      @media(max-width:600px) {
        .salon-dialog {
          padding:16px;
        }

        .salon-grid,
        .salon-summary {
          grid-template-columns:1fr;
        }

        .salon-line {
          grid-template-columns:1fr 1fr;
        }

        .salon-line label:first-child,
        .salon-line button {
          grid-column:1/-1;
        }

        .salon-catalog {
          grid-template-columns:repeat(2,minmax(0,1fr));
        }

        .salon-product {
          padding:10px;
        }

        .salon-product img,
        .salon-photo-empty {
          height:110px;
        }

        .salon-product .btn {
          width:100%;
        }
      }
    `;

    document.head.appendChild(style);

    const section = document.createElement('section');

    section.id = 'salonSales';
    section.className = 'section';

    section.innerHTML = `
      <div class="top">
        <div>
          <h1>Vendas Salão</h1>
          <p>Produtos, vendas para clientes e histórico de compras.</p>
        </div>

        <div class="salon-actions">
          <button id="newSalonProduct" class="btn secondary" type="button">
            + Cadastrar produto
          </button>

          <button id="newSalonSale" class="btn primary" type="button">
            + Nova venda
          </button>
        </div>
      </div>

      <p id="salonLoadMessage" class="salon-message" role="status"></p>

      <div class="panel">
        <h2>Produtos</h2>

        <div class="salon-filters">
          <label>
            Buscar produto
            <input
              id="salonProductSearch"
              type="search"
              placeholder="Nome do produto"
            >
          </label>

          <label id="salonInactiveWrap">
            Exibição
            <select id="salonProductVisibility">
              <option value="active">Produtos ativos</option>
              <option value="all">Todos, incluindo inativos</option>
            </select>
          </label>
        </div>

        <div id="salonCatalog" class="salon-catalog"></div>
      </div>

      <div class="panel">
        <h2>Histórico de vendas</h2>

        <div class="salon-filters">
          <label>
            Data inicial
            <input id="salonStart" type="date">
          </label>

          <label>
            Data final
            <input id="salonEnd" type="date">
          </label>

          <label>
            Cliente
            <select id="salonClientFilter"></select>
          </label>

          <label>
            Produto
            <select id="salonProductFilter"></select>
          </label>

          <label>
            Situação
            <select id="salonStatusFilter">
              <option value="">Todas</option>
              <option>Confirmada</option>
              <option>Cancelada</option>
            </select>
          </label>

          <button id="salonFilter" type="button" class="btn primary">
            Filtrar
          </button>

          <button id="salonClearFilter" type="button" class="btn secondary">
            Limpar
          </button>
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

    const productDialog = addDialog(
      'salonProductDialog',
      'Cadastrar produto',
      `
        <form id="salonProductForm">
          <fieldset id="salonProductFields">
            <div class="salon-grid">
              <label class="salon-full">
                Nome do produto
                <input id="salonProductName" maxlength="150" required>
              </label>

              <label>
                Preço (R$)
                <input
                  id="salonProductPrice"
                  type="number"
                  min="0"
                  max="99999999.99"
                  step="0.01"
                  required
                >
              </label>

              <label>
                Foto do produto
                <input
                  id="salonProductPhoto"
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                >
              </label>

              <div class="salon-full">
                <img
                  id="salonProductPreview"
                  class="salon-preview"
                  alt="Foto do produto"
                  hidden
                >
              </div>

              <label class="salon-full">
                Descrição / observação
                <textarea id="salonProductDescription" rows="3"></textarea>
              </label>
            </div>
          </fieldset>

          <p id="salonProductMessage" class="salon-message" role="status"></p>

          <div class="salon-actions">
            <button id="salonProductSave" class="btn primary" type="submit">
              Salvar produto
            </button>

            <button id="salonProductClose" class="btn secondary" type="button">
              Fechar
            </button>
          </div>
        </form>
      `
    );

    productDialog.addEventListener('cancel', event => {
      if (productSaving) event.preventDefault();
    });

    productDialog.addEventListener('close', clearProductPreview);

    const saleDialog = addDialog(
      'salonSaleDialog',
      'Nova venda',
      `
        <form id="salonSaleForm">
          <fieldset id="salonSaleFields">
            <div class="salon-grid">
              <label class="salon-full">
                Cliente cadastrado
                <select id="salonSaleClient" required></select>
              </label>

              <label>
                Data da venda
                <input id="salonSaleDate" type="date" required>
              </label>

              <label>
                Situação
                <select id="salonSaleStatus">
                  <option>Confirmada</option>
                  <option>Cancelada</option>
                </select>
              </label>
            </div>

            <h3>Produtos da venda</h3>
            <div id="salonSaleLines"></div>

            <button id="salonAddLine" class="btn secondary" type="button">
              + Adicionar produto
            </button>

            <p><strong id="salonSaleTotal">Total: R$ 0,00</strong></p>

            <label class="salon-full">
              Observação
              <textarea id="salonSaleNote" rows="3"></textarea>
            </label>
          </fieldset>

          <p id="salonSaleMessage" class="salon-message" role="status"></p>

          <div class="salon-actions">
            <button id="salonSaleSave" class="btn primary" type="submit">
              Salvar venda
            </button>

            <button id="salonSaleClose" class="btn secondary" type="button">
              Fechar
            </button>
          </div>
        </form>
      `
    );

    saleDialog.addEventListener('cancel', event => {
      if (saleSaving) event.preventDefault();
    });

    const editDialog = addDialog(
      'salonEditDialog',
      'Editar atendimento',
      `
        <form id="salonEditForm">
          <fieldset id="salonEditFields">
            <div class="salon-grid">
              <label class="salon-full">
                Cliente
                <select id="salonEditClient" required></select>
              </label>

              <label class="salon-full">
                Procedimento
                <select id="salonEditProcedure" required></select>
              </label>

              <label>
                Data
                <input id="salonEditDate" type="date" required>
              </label>

              <label>
                Horário
                <select id="salonEditTime" required></select>
              </label>

              <label>
                Valor (R$)
                <input
                  id="salonEditPrice"
                  type="number"
                  min="0"
                  max="99999999.99"
                  step="0.01"
                  required
                >
              </label>

              <label>
                Status
                <select id="salonEditStatus"></select>
              </label>

              <label class="salon-full">
                Observação
                <textarea id="salonEditNote" rows="3"></textarea>
              </label>
            </div>
          </fieldset>

          <p id="salonEditMessage" class="salon-message" role="status"></p>

          <div class="salon-actions">
            <button id="salonEditSave" class="btn primary" type="submit">
              Salvar alterações
            </button>

            <button id="salonEditClose" class="btn secondary" type="button">
              Fechar
            </button>
          </div>
        </form>
      `
    );

    editDialog.addEventListener('cancel', event => {
      if (editSaving) event.preventDefault();
    });

    byId('newSalonProduct').onclick = () => openProduct();
    byId('newSalonSale').onclick = () => openSale();

    byId('salonProductSearch').oninput = renderCatalog;
    byId('salonProductVisibility').onchange = renderCatalog;

    byId('salonFilter').onclick = renderHistory;

    byId('salonClearFilter').onclick = () => {
      [
        'salonStart',
        'salonEnd',
        'salonClientFilter',
        'salonProductFilter',
        'salonStatusFilter'
      ].forEach(id => byId(id).value = '');

      renderHistory();
    };

    byId('salonProductForm').onsubmit = saveProduct;
    byId('salonSaleForm').onsubmit = saveSale;
    byId('salonEditForm').onsubmit = saveEdit;

    byId('salonProductClose').onclick = () => {
      if (!productSaving) closeDialog('salonProductDialog');
    };

    byId('salonSaleClose').onclick = () => {
      if (!saleSaving) closeDialog('salonSaleDialog');
    };

    byId('salonEditClose').onclick = () => {
      if (!editSaving) closeDialog('salonEditDialog');
    };

    byId('salonProductPhoto').onchange = previewProductPhoto;
    byId('salonAddLine').onclick = () => addSaleLine();

    byId('salonEditDate').onchange = fillEditTimes;

    byId('salonEditProcedure').onchange = () => {
      const procedure = procedures.find(
        item => String(item.id) === byId('salonEditProcedure').value
      );

      if (procedure) byId('salonEditPrice').value = procedure.price;
    };

    section.addEventListener('click', async event => {
      const button = event.target.closest('button[data-salon-action]');
      if (!button || button.disabled) return;

      const action = button.dataset.salonAction;
      const id = button.dataset.id;

      if (action === 'edit-product') openProduct(id);
      if (action === 'sell-product') openSale(null, id);
      if (action === 'edit-sale') openSale(id);
      if (action === 'toggle-product') await toggleProduct(id, button);
      if (action === 'toggle-sale') await toggleSale(id, button);
    });

    document.addEventListener('click', event => {
      const button = event.target.closest('button[data-edit-attendance]');

      if (button) {
        openEdit(button.dataset.editAttendance);
      }
    });
  }

  // ===================================================
  // CATÁLOGO DE PRODUTOS
  // ===================================================

  function renderCatalog() {
    byId('newSalonProduct').hidden = !isAdmin();
    byId('salonInactiveWrap').hidden = !isAdmin();

    const search = byId('salonProductSearch').value.trim().toLowerCase();

    const all =
      isAdmin() &&
      byId('salonProductVisibility').value === 'all';

    const list = products.filter(product =>
      (all || product.active !== false) &&
      product.name.toLowerCase().includes(search)
    );

    byId('salonCatalog').innerHTML = list.map(product => `
      <article class="salon-product">
        ${
          product.photo
            ? `
              <img
                src="${html(product.photo)}"
                alt="${html(product.name)}"
                loading="lazy"
              >
            `
            : '<div class="salon-photo-empty">Sem foto</div>'
        }

        <h3>${html(product.name)}</h3>
        <strong>${money(product.price)}</strong>
        <p>${html(product.description || '')}</p>

        ${product.active === false ? '<p>Produto inativo</p>' : ''}

        <div class="salon-actions">
          ${
            product.active !== false
              ? `
                <button
                  type="button"
                  class="btn primary btn-sm"
                  data-salon-action="sell-product"
                  data-id="${html(product.id)}"
                >
                  Vender
                </button>
              `
              : ''
          }

          ${
            isAdmin()
              ? `
                <button
                  type="button"
                  class="btn secondary btn-sm"
                  data-salon-action="edit-product"
                  data-id="${html(product.id)}"
                >
                  Editar
                </button>

                <button
                  type="button"
                  class="btn secondary btn-sm"
                  data-salon-action="toggle-product"
                  data-id="${html(product.id)}"
                >
                  ${product.active === false ? 'Reativar' : 'Desativar'}
                </button>
              `
              : ''
          }
        </div>
      </article>
    `).join('') || '<div class="empty">Nenhum produto encontrado.</div>';
  }

  function refreshFilterOptions() {
    preserveOptions(
      byId('salonClientFilter'),
      clientOptions('Todos os clientes')
    );

    const map = new Map(
      products.map(product => [String(product.id), product.name])
    );

    sales.forEach(sale => {
      sale.items.forEach(item => {
        if (!map.has(String(item.productId))) {
          map.set(String(item.productId), item.name);
        }
      });
    });

    preserveOptions(
      byId('salonProductFilter'),
      '<option value="">Todos os produtos</option>' +
      [...map].map(([id, name]) => `
        <option value="${html(id)}">${html(name)}</option>
      `).join('')
    );
  }

  function clearProductPreview() {
    if (productPhotoURL) URL.revokeObjectURL(productPhotoURL);
    productPhotoURL = null;
  }

  function openProduct(id = null) {
    if (!isAdmin() || productSaving) return;

    const product = id
      ? products.find(item => String(item.id) === String(id))
      : null;

    if (id && !product) return;

    productId = product?.id || null;

    clearProductPreview();
    byId('salonProductForm').reset();

    byId('salonProductDialogTitle').textContent =
      product ? 'Editar produto' : 'Cadastrar produto';

    byId('salonProductName').value = product?.name || '';
    byId('salonProductPrice').value = product?.price ?? '';
    byId('salonProductDescription').value = product?.description || '';

    const preview = byId('salonProductPreview');

    preview.hidden = !product?.photo;

    if (product?.photo) {
      preview.src = product.photo;
    } else {
      preview.removeAttribute('src');
    }

    setMessage('salonProductMessage', 'Foto opcional, até 5 MB.');
    showDialog('salonProductDialog');
  }

  function previewProductPhoto() {
    clearProductPreview();

    const file = byId('salonProductPhoto').files[0];
    const preview = byId('salonProductPreview');

    if (!file) {
      preview.hidden = true;
      preview.removeAttribute('src');
      return;
    }

    if (
      file.size > 5 * 1024 * 1024 ||
      !['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.type)
    ) {
      byId('salonProductPhoto').value = '';
      preview.hidden = true;
      preview.removeAttribute('src');

      setMessage(
        'salonProductMessage',
        'Use JPG, PNG, WEBP ou GIF de até 5 MB.',
        true
      );

      return;
    }

    productPhotoURL = URL.createObjectURL(file);
    preview.src = productPhotoURL;
    preview.hidden = false;

    setMessage(
      'salonProductMessage',
      'Foto selecionada. Clique em Salvar produto.'
    );
  }

  async function saveProduct(event) {
    event.preventDefault();
    if (productSaving) return;

    const form = new FormData();

    form.append('name', byId('salonProductName').value.trim());
    form.append('price', byId('salonProductPrice').value);
    form.append('description', byId('salonProductDescription').value.trim());

    const file = byId('salonProductPhoto').files[0];
    if (file) form.append('photo', file);

    productSaving = true;

    byId('salonProductFields').disabled = true;
    byId('salonProductSave').disabled = true;
    byId('salonProductClose').disabled = true;

    setMessage('salonProductMessage', 'Salvando...');

    try {
      await api(
        '/api/products' +
        (productId ? '/' + encodeURIComponent(productId) : ''),
        {
          method: productId ? 'PATCH' : 'POST',
          body: form
        }
      );

      closeDialog('salonProductDialog');
      await refreshData();
    } catch (error) {
      setMessage('salonProductMessage', error.message, true);
    } finally {
      productSaving = false;

      byId('salonProductFields').disabled = false;
      byId('salonProductSave').disabled = false;
      byId('salonProductClose').disabled = false;
    }
  }

  async function toggleProduct(id, button) {
    const product = products.find(item => String(item.id) === String(id));

    if (!product || !isAdmin()) return;

    if (!confirm(
      `${product.active === false ? 'Reativar' : 'Desativar'} ` +
      `o produto ${product.name}? As vendas antigas serão mantidas.`
    )) return;

    button.disabled = true;

    try {
      await api('/api/products/' + encodeURIComponent(id), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          active: product.active === false
        })
      });

      await refreshData();
    } catch (error) {
      alert(error.message);
    } finally {
      button.disabled = false;
    }
  }

  // ===================================================
  // NOVA VENDA / EDIÇÃO DA VENDA
  // ===================================================

  function addSaleLine(item = {}) {
    const row = document.createElement('div');

    row.className = 'salon-line';

    row.innerHTML = `
      <label>
        Produto
        <select class="sale-product" required>
          ${productOptions(item.productId, item.name)}
        </select>
      </label>

      <label>
        Quantidade
        <input
          class="sale-quantity"
          type="number"
          min="1"
          max="10000"
          step="1"
          required
          value="${html(item.quantity || 1)}"
        >
      </label>

      <label>
        Valor unitário
        <input
          class="sale-price"
          type="number"
          min="0"
          max="99999999.99"
          step="0.01"
          required
          value="${html(item.unitPrice ?? '')}"
        >
      </label>

      <button type="button" class="btn danger btn-sm">Remover</button>
      <div class="salon-line-total"></div>
    `;

    const select = row.querySelector('.sale-product');

    select.value = item.productId ? String(item.productId) : '';

    select.onchange = () => {
      const product = products.find(
        item => String(item.id) === select.value
      );

      row.querySelector('.sale-price').value = product?.price ?? '';
      calculateSale();
    };

    row.querySelector('button').onclick = () => {
      row.remove();
      calculateSale();
    };

    row.addEventListener('input', calculateSale);

    byId('salonSaleLines').appendChild(row);
    calculateSale();
  }

  function saleItems() {
    return [...byId('salonSaleLines').children].map(row => ({
      productId: row.querySelector('.sale-product').value,
      quantity: Number(row.querySelector('.sale-quantity').value),
      unitPrice: Number(row.querySelector('.sale-price').value)
    }));
  }

  function calculateSale() {
    let total = 0;

    [...byId('salonSaleLines').children].forEach(row => {
      const quantity = Number(
        row.querySelector('.sale-quantity').value
      ) || 0;

      const subtotal =
        cents(row.querySelector('.sale-price').value) * quantity;

      total += subtotal;

      row.querySelector('.salon-line-total').textContent =
        'Subtotal: ' + money(subtotal / 100);
    });

    byId('salonSaleTotal').textContent = 'Total: ' + money(total / 100);
  }

  function openSale(id = null, chosenProduct = null) {
    if (saleSaving || !staff()) return;

    if (!ready) {
      alert('Aguarde carregar os produtos e as vendas.');
      return;
    }

    const sale = id
      ? sales.find(item => String(item.id) === String(id))
      : null;

    if (id && !sale) return;

    if (!clients.length) {
      alert('Cadastre primeiro o cliente na aba Clientes.');
      return;
    }

    if (!sale && !products.some(product => product.active !== false)) {
      alert('Cadastre primeiro um produto ativo.');
      return;
    }

    saleId = sale?.id || null;

    byId('salonSaleForm').reset();

    byId('salonSaleDialogTitle').textContent =
      sale ? 'Editar venda' : 'Nova venda';

    byId('salonSaleClient').innerHTML = clientOptions();

    if (
      sale &&
      !clients.some(client => String(client.id) === String(sale.clientId))
    ) {
      const option = document.createElement('option');

      option.value = sale.clientId;
      option.textContent = sale.name + ' — ' + sale.phone;

      byId('salonSaleClient').appendChild(option);
    }

    byId('salonSaleClient').value = sale ? String(sale.clientId) : '';
    byId('salonSaleDate').value = sale?.date || localDate();
    byId('salonSaleStatus').value = sale?.status || 'Confirmada';
    byId('salonSaleNote').value = sale?.note || '';

    byId('salonSaleLines').innerHTML = '';

    if (sale) {
      sale.items.forEach(addSaleLine);
    } else {
      const product = products.find(
        item => String(item.id) === String(chosenProduct)
      );

      addSaleLine(
        product
          ? {
              productId: product.id,
              name: product.name,
              quantity: 1,
              unitPrice: product.price
            }
          : {}
      );
    }

    originalItems = JSON.stringify(saleItems());

    setMessage(
      'salonSaleMessage',
      'O telefone vem do cadastro do cliente.'
    );

    showDialog('salonSaleDialog');
  }

  async function saveSale(event) {
    event.preventDefault();
    if (saleSaving) return;

    const items = saleItems();

    if (!items.length) {
      setMessage('salonSaleMessage', 'Adicione pelo menos um produto.', true);
      return;
    }

    if (items.some(item =>
      !item.productId ||
      !Number.isInteger(item.quantity) ||
      item.quantity < 1 ||
      item.quantity > 10000 ||
      !Number.isFinite(item.unitPrice) ||
      item.unitPrice < 0
    )) {
      setMessage(
        'salonSaleMessage',
        'Confira produto, quantidade e valor de cada item.',
        true
      );

      return;
    }

    const payload = {
      clientId: byId('salonSaleClient').value,
      date: byId('salonSaleDate').value,
      status: byId('salonSaleStatus').value,
      note: byId('salonSaleNote').value.trim()
    };

    // Preserva os preços históricos quando só a data,
    // cliente, observação ou situação forem alterados.
    if (!saleId || JSON.stringify(items) !== originalItems) {
      payload.items = items;
    }

    saleSaving = true;

    byId('salonSaleFields').disabled = true;
    byId('salonSaleSave').disabled = true;
    byId('salonSaleClose').disabled = true;

    setMessage('salonSaleMessage', 'Salvando...');

    try {
      await api(
        '/api/sales' + (saleId ? '/' + encodeURIComponent(saleId) : ''),
        {
          method: saleId ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        }
      );

      closeDialog('salonSaleDialog');
      await refreshData();
    } catch (error) {
      setMessage('salonSaleMessage', error.message, true);
    } finally {
      saleSaving = false;

      byId('salonSaleFields').disabled = false;
      byId('salonSaleSave').disabled = false;
      byId('salonSaleClose').disabled = false;
    }
  }

  async function toggleSale(id, button) {
    const sale = sales.find(item => String(item.id) === String(id));
    if (!sale) return;

    const status = sale.status === 'Confirmada'
      ? 'Cancelada'
      : 'Confirmada';

    if (!confirm(
      `${status === 'Cancelada' ? 'Cancelar' : 'Confirmar'} ` +
      `esta venda de ${money(sale.total)} para ${sale.name}?`
    )) return;

    button.disabled = true;

    try {
      await api('/api/sales/' + encodeURIComponent(id) + '/status', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status })
      });

      await refreshData();
    } catch (error) {
      alert(error.message);
    } finally {
      button.disabled = false;
    }
  }

  // ===================================================
  // HISTÓRICO E FILTROS
  // ===================================================

  function renderHistory() {
    const start = byId('salonStart').value;
    const end = byId('salonEnd').value;

    if (start && end && start > end) {
      setMessage(
        'salonLoadMessage',
        'A data inicial deve ser anterior à data final.',
        true
      );
      return;
    }

    const client = byId('salonClientFilter').value;
    const product = byId('salonProductFilter').value;
    const status = byId('salonStatusFilter').value;

    const list = sales.filter(sale =>
      (!start || sale.date >= start) &&
      (!end || sale.date <= end) &&
      (!client || String(sale.clientId) === client) &&
      (!status || sale.status === status) &&
      (
        !product ||
        sale.items.some(item => String(item.productId) === product)
      )
    );

    const confirmed = list.filter(sale => sale.status === 'Confirmada');

    const total = confirmed.reduce(
      (sum, sale) => sum + cents(sale.total),
      0
    ) / 100;

    const productTotal = confirmed.reduce((sum, sale) =>
      sum + sale.items
        .filter(item => !product || String(item.productId) === product)
        .reduce((subtotal, item) => subtotal + cents(item.total), 0),
      0
    ) / 100;

    byId('salonSalesSummary').innerHTML = summaryCards([
      ['Vendas encontradas', String(list.length)],
      ['Total das vendas confirmadas', money(total)],
      [
        product
          ? 'Produto selecionado nas vendas confirmadas'
          : 'Vendas canceladas',
        product
          ? money(productTotal)
          : String(list.length - confirmed.length)
      ]
    ]);

    byId('salonHistory').innerHTML = list.length
      ? `
        <table>
          <thead>
            <tr>
              <th>Data</th>
              <th>Cliente</th>
              <th>Produtos</th>
              <th>Total</th>
              <th>Situação</th>
              <th>Ações</th>
            </tr>
          </thead>

          <tbody>
            ${list.map(sale => `
              <tr>
                <td>${fmtDate(sale.date)}</td>

                <td>
                  <b>${html(sale.name)}</b><br>
                  <small>${html(sale.phone)}</small>
                </td>

                <td class="salon-history-items">
                  ${sale.items.map(item => `
                    <div>
                      ${html(item.name)} —
                      ${item.quantity} × ${money(item.unitPrice)}
                      = ${money(item.total)}
                    </div>
                  `).join('')}

                  <small class="salon-history-note">
                    ${html(sale.note)}
                  </small>
                </td>

                <td>${money(sale.total)}</td>

                <td>
                  <span class="badge ${
                    sale.status === 'Confirmada'
                      ? 'b-confirmado'
                      : 'b-cancelado'
                  }">
                    ${html(sale.status)}
                  </span>
                </td>

                <td>
                  <div class="salon-actions">
                    <button
                      type="button"
                      class="btn secondary btn-sm"
                      data-salon-action="edit-sale"
                      data-id="${html(sale.id)}"
                    >
                      Editar
                    </button>

                    <button
                      type="button"
                      class="btn ${
                        sale.status === 'Confirmada' ? 'danger' : 'success'
                      } btn-sm"
                      data-salon-action="toggle-sale"
                      data-id="${html(sale.id)}"
                    >
                      ${sale.status === 'Confirmada' ? 'Cancelar' : 'Confirmar'}
                    </button>
                  </div>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `
      : '<div class="empty">Nenhuma venda neste filtro.</div>';
  }

  function renderSales() {
    if (!staff()) return;

    renderCatalog();
    refreshFilterOptions();
    renderHistory();
  }

  // ===================================================
  // EDITAR ATENDIMENTOS
  // ===================================================

  function fillEditTimes() {
    const date = byId('salonEditDate').value;
    const previous = byId('salonEditTime').value;

    const source = appointments.find(
      item => String(item.id) === String(editId)
    );

    const slots = openingSlots(openingHours, date);

    if (
      source &&
      date === source.date &&
      !slots.includes(source.time)
    ) {
      slots.push(source.time);
    }

    byId('salonEditTime').innerHTML =
      '<option value="">Selecione</option>' +
      slots.sort().map(time => `
        <option value="${html(time)}">${html(time)}</option>
      `).join('');

    byId('salonEditTime').value =
      slots.includes(previous) ? previous : '';
  }

  function openEdit(id) {
    if (editSaving || !staff()) return;

    const appointment = appointments.find(
      item => String(item.id) === String(id)
    );

    if (!appointment) {
      alert('Atendimento não encontrado. Atualize a lista.');
      return;
    }

    editId = appointment.id;

    byId('salonEditForm').reset();
    byId('salonEditClient').innerHTML = clientOptions();

    if (
      !clients.some(client =>
        String(client.id) === String(appointment.clientId)
      )
    ) {
      const option = document.createElement('option');

      option.value = appointment.clientId || '';
      option.textContent = appointment.name;

      byId('salonEditClient').appendChild(option);
    }

    byId('salonEditClient').value = String(appointment.clientId || '');

    const linked =
      Boolean(appointment.originalAppointmentId) ||
      appointments.some(item =>
        String(item.originalAppointmentId) === String(appointment.id)
      );

    byId('salonEditClient').disabled = linked;

    byId('salonEditProcedure').innerHTML =
      '<option value="">Selecione</option>' +
      procedures.map(procedure => `
        <option value="${html(procedure.id)}">
          ${html(procedure.name)}
        </option>
      `).join('');

    if (
      !procedures.some(procedure =>
        String(procedure.id) === String(appointment.procedureId)
      )
    ) {
      const option = document.createElement('option');

      option.value = appointment.procedureId;
      option.textContent = appointment.procedure + ' (inativo)';

      byId('salonEditProcedure').appendChild(option);
    }

    byId('salonEditProcedure').value = String(appointment.procedureId);
    byId('salonEditDate').value = appointment.date;

    fillEditTimes();

    byId('salonEditTime').value = appointment.time;
    byId('salonEditPrice').value = appointment.price;

    const statuses = [
      'Agendado',
      'Confirmado',
      'Atendido',
      'Cancelado'
    ];

    if (isReturn(appointment)) statuses.push('Retorno');

    byId('salonEditStatus').innerHTML = statuses
      .map(status => `<option>${status}</option>`)
      .join('');

    byId('salonEditStatus').value = appointment.status;
    byId('salonEditNote').value = appointment.note || '';

    setMessage(
      'salonEditMessage',
      linked
        ? 'Cliente fixo porque este atendimento está vinculado a um retorno.'
        : 'Altere os dados e clique em Salvar alterações.'
    );

    showDialog('salonEditDialog');
  }

  async function saveEdit(event) {
    event.preventDefault();
    if (editSaving) return;

    const payload = {
      clientId: byId('salonEditClient').value,
      procedureId: byId('salonEditProcedure').value,
      date: byId('salonEditDate').value,
      time: byId('salonEditTime').value,
      price: byId('salonEditPrice').value,
      status: byId('salonEditStatus').value,
      note: byId('salonEditNote').value.trim()
    };

    editSaving = true;

    byId('salonEditFields').disabled = true;
    byId('salonEditSave').disabled = true;
    byId('salonEditClose').disabled = true;

    setMessage('salonEditMessage', 'Salvando...');

    try {
      await api('/api/appointments/' + encodeURIComponent(editId), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      closeDialog('salonEditDialog');
      await refreshData();
    } catch (error) {
      setMessage('salonEditMessage', error.message, true);
    } finally {
      editSaving = false;

      byId('salonEditFields').disabled = false;
      byId('salonEditSave').disabled = false;
      byId('salonEditClose').disabled = false;
    }
  }

  // ===================================================
  // DASHBOARD COM SERVIÇOS + PRODUTOS
  // ===================================================

  function renderFinance() {
    if (!staff()) return;

    const today = localDate();
    const start = today.slice(0, 7) + '-01';
    const end = monthEnd(today);

    const total = combinedTotals(start, end);

    byId('salonFinance').hidden = !isAdmin();

    byId('salonFinanceCards').innerHTML = summaryCards([
      ['Atendimentos do mês', money(total.serviceRevenue)],
      ['Produtos vendidos no mês', money(total.productRevenue)],
      ['Total combinado do mês', money(total.revenue)]
    ]);

    setMessage(
      'salonFinanceMessage',
      ready
        ? 'Inclui agendamentos não cancelados e vendas confirmadas.'
        : 'Vendas ainda não atualizadas; os valores podem estar incompletos.'
    );

    byId('monthSummary').innerHTML = `
      <p>
        Atendimentos: <b>${total.count}</b> ·
        ${money(total.serviceRevenue)}
      </p>

      <p>
        Vendas de produtos: <b>${total.salesCount}</b> ·
        ${money(total.productRevenue)}
      </p>

      <p>
        Ticket médio dos atendimentos:
        <b>${
          money(total.count ? total.serviceRevenue / total.count : 0)
        }</b>
      </p>

      <p>Total combinado: <b>${money(total.revenue)}</b></p>
    `;

    const labels = {
      todayRevenue: 'Total hoje · serviços + produtos',
      weekRevenue: 'Total da semana · serviços + produtos',
      monthRevenue: 'Total do mês · serviços + produtos'
    };

    Object.entries(labels).forEach(([id, text]) => {
      const label = byId(id)?.closest('.card')?.querySelector('.label');
      if (label) label.textContent = text;
    });
  }

  // ===================================================
  // INTEGRAÇÃO COM O APP.JS EXISTENTE
  // ===================================================

  mount();

  navItemsFor = function(role) {
    const items = base.nav(role);

    if (['admin', 'funcionario'].includes(role)) {
      items.splice(Math.min(4, items.length), 0, {
        id: 'salonSales',
        label: '🛍️ Vendas Salão',
        roles: ['admin', 'funcionario']
      });
    }

    return items;
  };

  periodTotals = combinedTotals;

  renderDashboard = function() {
    base.dashboard();
    renderFinance();
  };

  appointmentActions = function(appointment) {
    return `
      <button
        type="button"
        class="btn secondary btn-sm"
        data-edit-attendance="${html(appointment.id)}"
      >
        ✏️ Editar
      </button>
    ` + base.actions(appointment);
  };

  renderAll = function() {
    base.renderAll();
    if (staff()) renderSales();
  };

  applyDashboardFilter = function() {
    base.dashboardFilter();

    const start = byId('dashFilterStart').value;
    const end = byId('dashFilterEnd').value;

    if (!start || !end || start > end) return;

    const total = combinedTotals(start, end);

    byId('dashFilterRevenue').textContent = money(total.revenue);

    let note = byId('salonDashboardPeriod');

    if (!note) {
      note = document.createElement('p');
      note.id = 'salonDashboardPeriod';

      byId('dashFilterTable').insertAdjacentElement('beforebegin', note);
    }

    note.textContent =
      `Atendimentos: ${money(total.serviceRevenue)} · ` +
      `Produtos: ${money(total.productRevenue)} ` +
      `(${total.salesCount} venda(s)). ` +
      'Ticket médio refere-se aos atendimentos.';
  };

  clearDashboardFilter = function() {
    base.clearDashboard();

    if (byId('salonDashboardPeriod')) {
      byId('salonDashboardPeriod').textContent = '';
    }
  };

  updateReportPeriod = function(start, end) {
    base.reportPeriod(start, end);

    const total = combinedTotals(start, end);

    byId('filteredRevenue').textContent = money(total.revenue);

    let note = byId('salonReportPeriod');

    if (!note) {
      note = document.createElement('p');
      note.id = 'salonReportPeriod';

      byId('procedureReport').insertAdjacentElement('beforebegin', note);
    }

    note.textContent =
      `Total combinado: ${money(total.revenue)} · ` +
      `Atendimentos: ${money(total.serviceRevenue)} · ` +
      `Produtos: ${money(total.productRevenue)}. ` +
      'Quantidade, ticket médio e procedimentos referem-se aos atendimentos.';
  };

  refreshData = async function(options = {}) {
    if (!staff()) return base.refresh(options);

    const request = ++sequence;
    const userId = String(currentUser.id);

    ready = false;

    const ok = await base.refresh(options);

    if (
      !ok ||
      request !== sequence ||
      !staff() ||
      String(currentUser.id) !== userId
    ) {
      return false;
    }

    try {
      const [catalog, history] = await Promise.all([
        api('/api/products?includeInactive=true'),
        api('/api/sales')
      ]);

      if (
        request !== sequence ||
        !staff() ||
        String(currentUser.id) !== userId
      ) {
        return false;
      }

      products = catalog;

      sales = history.map(sale => ({
        ...sale,
        date: String(sale.date).slice(0, 10),
        items: sale.items || []
      }));

      ready = true;

      setMessage('salonLoadMessage', '');
      renderAll();

      return true;
    } catch (error) {
      if (
        request !== sequence ||
        !staff() ||
        String(currentUser.id) !== userId
      ) {
        return false;
      }

      setMessage(
        'salonLoadMessage',
        'Não foi possível carregar produtos e vendas. ' +
        'Confira a publicação do server.js. ' + error.message,
        true
      );

      renderFinance();
      return false;
    }
  };

  logout = async function() {
    sequence++;
    ready = false;
    products = [];
    sales = [];

    [
      'salonProductDialog',
      'salonSaleDialog',
      'salonEditDialog'
    ].forEach(closeDialog);

    clearProductPreview();
    await base.logout();
  };

  if (staff()) {
    const active = document.querySelector('.section.active')?.id;

    renderNav();
    if (active) showSection(active);

    if (!refreshBusy) refreshData({ silent: true });
  }
})();