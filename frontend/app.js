python3 - <<'PY'
from pathlib import Path

arquivo = Path("frontend/app.js")
codigo = arquivo.read_text(encoding="utf-8")

inicio = codigo.find("async function downloadClientPhoto(id)")

if inicio == -1:
    inicio = codigo.find("function downloadClientPhoto(id)")

marcador = """/* =========================
   PROCEDIMENTOS"""

fim = codigo.find(marcador, inicio)

if inicio == -1 or fim == -1:
    raise SystemExit(
        "ERRO: não encontrei a seção CLIENTES no app.js."
    )

secao_corrigida = r'''async function downloadClientPhoto(photo, clientName) {
  if (!photo) {
    alert('Este cliente não tem foto cadastrada.');
    return;
  }

  try {
    const response = await fetch(photo, {
      credentials: 'include',
      cache: 'no-store'
    });

    if (!response.ok) {
      throw new Error(
        'A foto não está mais disponível no servidor.'
      );
    }

    const photoFile = await response.blob();
    let extension = 'jpg';

    if (photoFile.type === 'image/png') {
      extension = 'png';
    } else if (photoFile.type === 'image/webp') {
      extension = 'webp';
    } else if (photoFile.type === 'image/gif') {
      extension = 'gif';
    }

    const safeName = (clientName || 'cliente')
      .trim()
      .replace(/[^a-zA-Z0-9À-ÿ_-]+/g, '_');

    const temporaryUrl =
      URL.createObjectURL(photoFile);

    const link = document.createElement('a');

    link.href = temporaryUrl;
    link.download = `${safeName}.${extension}`;

    document.body.appendChild(link);
    link.click();
    link.remove();

    setTimeout(() => {
      URL.revokeObjectURL(temporaryUrl);
    }, 1000);
  } catch (error) {
    alert(
      error.message ||
      'Não foi possível baixar a foto.'
    );
  }
}

function renderClients() {
  const search =
    ($('clientSearch').value || '')
      .toLowerCase();

  const filteredClients =
    clients.filter(client =>
      (
        client.name +
        client.phone
      ).toLowerCase().includes(search)
    );

  $('clientTable').innerHTML =
    filteredClients.length
      ? `
        <table>
          <tr>
            <th>Cliente</th>
            <th>Contato</th>
            <th>Atendimentos</th>
            <th>Total</th>
            <th>Último atendimento</th>
            <th>Observação</th>
            <th>Ações</th>
          </tr>

          ${filteredClients.map(client => `
            <tr>
              <td>
                ${
                  client.photo
                    ? `
                      <img
                        class="client-photo"
                        src="${esc(client.photo)}"
                      >
                    `
                    : ''
                }

                <b>${esc(client.name)}</b>
              </td>

              <td>${esc(client.phone)}</td>
              <td>${client.count}</td>
              <td>${money(client.total)}</td>

              <td>
                ${
                  client.last
                    ? fmtDate(client.last)
                    : '—'
                }
              </td>

              <td>${esc(client.note || '-')}</td>

              <td>
                ${
                  client.photo
                    ? `
                      <a
                        class="btn secondary btn-sm"
                        href="${esc(client.photo)}"
                        download
                      >
                        ⬇️ Baixar foto
                      </a>
                    `
                    : ''
                }

                <button
                  type="button"
                  class="btn danger btn-sm"
                  onclick="removeClient(${client.id})"
                >
                  Remover
                </button>
              </td>
            </tr>
          `).join('')}
        </table>
      `
      : `
        <div class="empty">
          Nenhum cliente encontrado.
        </div>
      `;
}

function removeClient(id) {
  if (
    !confirm(
      'Tem certeza de que deseja remover este cliente?'
    )
  ) {
    return;
  }

  api(
    `/api/clients/${id}`,
    { method: 'DELETE' }
  )
    .then(refreshData)
    .catch(error => alert(error.message));
}

'''

arquivo.write_text(
    codigo[:inicio] +
    secao_corrigida +
    codigo[fim:],
    encoding="utf-8"
)

print("app.js corrigido com sucesso.")
PY

node --check frontend/app.js