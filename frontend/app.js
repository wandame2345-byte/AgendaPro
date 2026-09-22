let openingHours = null;
let openingHoursDirty = false;

let currentUser = null;
let pendingRole = null;
let procedures = [];
let clients = [];
let appointments = [];
let selectedSlot = "";
let clientSlotsRequestId = 0;

const $ = id => document.getElementById(id);

const money = value =>
  new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL"
  }).format(Number(value) || 0);

const localDate = () => {
  const date = new Date();

  return new Date(
    date.getTime() - date.getTimezoneOffset() * 60000
  ).toISOString().slice(0, 10);
};

const fmtDate = value => {
  if (!value) return "—";

  const date = new Date(
    String(value).slice(0, 10) + "T12:00:00"
  );

  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleDateString("pt-BR");
};

const esc = value =>
  String(value ?? "").replace(
    /[&<>"']/g,
    character => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    })[character]
  );

const idArgument = value =>
  esc(JSON.stringify(String(value)));

async function api(url, options = {}) {
  const response = await fetch(url, {
    credentials: "include",
    ...options
  });

  let data = null;

  try {
    data = await response.json();
  } catch {
    data = null;
  }

  if (!response.ok) {
    throw new Error(
      data?.error ||
      "Não foi possível concluir a operação."
    );
  }

  return data;
}

/* =========================
   HORÁRIOS DE FUNCIONAMENTO
========================= */

function openingSlots(settings, date) {
  if (!settings || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return [];
  }

  const value = new Date(date + "T12:00:00Z");

  if (
    Number.isNaN(value.getTime()) ||
    value.toISOString().slice(0, 10) !== date
  ) {
    return [];
  }

  const day = settings.days[value.getUTCDay()];

  if (!day.open) return [];

  const minutes = time => {
    const [hours, mins] = time.split(":").map(Number);
    return hours * 60 + mins;
  };

  const start = minutes(day.start);
  const end = minutes(day.end);

  const ranges = day.breakStart
    ? [
        [start, minutes(day.breakStart)],
        [minutes(day.breakEnd), end]
      ]
    : [[start, end]];

  const slots = [];

  for (const [from, until] of ranges) {
    for (
      let minute = from;
      minute + settings.interval <= until;
      minute += settings.interval
    ) {
      const hourText = String(
        Math.floor(minute / 60)
      ).padStart(2, "0");

      const minuteText = String(
        minute % 60
      ).padStart(2, "0");

      slots.push(`${hourText}:${minuteText}`);
    }
  }

  return slots;
}

function mountOpeningHoursPanel() {
  let panel = $("openingHoursPanel");

  if (!panel) {
    const style = document.createElement("style");

    style.textContent = `
      #openingHoursPanel {
        margin-bottom: 22px;
      }

      #openingHoursPanel summary {
        cursor: pointer;
        font-weight: 700;
        padding: 4px 0;
      }

      #openingHoursPanel p {
        color: var(--muted);
        margin: 14px 0;
      }

      #openingHoursPanel .opening-day {
        display: grid;
        grid-template-columns: 170px minmax(0, 1fr);
        gap: 16px;
        align-items: center;
        padding: 12px 0;
        border-bottom: 1px solid var(--border, #f1d7dc);
      }

      #openingHoursPanel .opening-day-toggle {
        display: flex;
        align-items: center;
        gap: 9px;
      }

      #openingHoursPanel input[type=checkbox] {
        width: 18px;
        height: 18px;
        accent-color: var(--primary, #d77f98);
      }

      #openingHoursPanel .opening-times {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 12px;
        border: 0;
        padding: 0;
        margin: 0;
        min-width: 0;
      }

      #openingHoursPanel .opening-times:disabled {
        opacity: .5;
      }

      #openingHoursPanel label {
        font-size: 13px;
      }

      #openingHoursPanel .opening-times label {
        display: grid;
        gap: 5px;
        min-width: 0;
      }

      #openingHoursPanel input[type=time] {
        width: 100%;
        min-width: 0;
        box-sizing: border-box;
      }

      #openingHoursPanel .opening-actions {
        display: flex;
        flex-wrap: wrap;
        align-items: end;
        gap: 16px;
        margin-top: 18px;
      }

      #openingHoursPanel .opening-interval {
        display: grid;
        gap: 6px;
      }

      #openingHoursPanel input[type=number] {
        width: 120px;
      }

      #openingHoursMessage {
        min-height: 20px;
        margin-top: 12px;
      }

      @media(max-width: 750px) {
        #openingHoursPanel .opening-day {
          grid-template-columns: 1fr;
          gap: 10px;
        }

        #openingHoursPanel .opening-times {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
      }
    `;

    document.head.appendChild(style);

    panel = document.createElement("details");
    panel.id = "openingHoursPanel";
    panel.className = "panel";

    panel.innerHTML = `
      <summary>⚙️ Horários de funcionamento</summary>

      <p>
        Marque os dias abertos e ajuste o expediente.
        Para trabalhar sem pausa, deixe os dois campos
        de pausa vazios.
      </p>

      <form id="openingHoursForm">
        <div id="openingHoursDays">
          Carregando horários...
        </div>

        <div class="opening-actions">
          <label
            class="opening-interval"
            for="openingInterval"
          >
            Intervalo dos agendamentos (minutos)
            <input
              id="openingInterval"
              type="number"
              min="5"
              max="240"
              step="1"
              required
              value="60"
            >
          </label>

          <button
            id="saveOpeningHours"
            type="submit"
            class="btn primary"
            disabled
          >
            Salvar horários
          </button>
        </div>

        <p>
          Os horários são gerados com o intervalo escolhido
          e precisam caber antes da pausa ou do fechamento.
          Os agendamentos existentes serão mantidos.
        </p>

        <div
          id="openingHoursMessage"
          role="status"
          aria-live="polite"
        ></div>
      </form>
    `;

    $("agenda")
      .querySelector(".top")
      .insertAdjacentElement("afterend", panel);

    $("openingHoursForm").addEventListener(
      "submit",
      saveOpeningHours
    );

    $("openingHoursForm").addEventListener(
      "input",
      event => {
        openingHoursDirty = true;

        $("openingHoursMessage").textContent =
          "Alterações ainda não salvas.";

        if (event.target.dataset.openingDay !== undefined) {
          $(
            "openingTimes" + event.target.dataset.openingDay
          ).disabled = !event.target.checked;
        }
      }
    );
  }

  panel.hidden = currentUser?.role !== "admin";
}

function renderOpeningHoursEditor() {
  if (
    !$("openingHoursPanel") ||
    currentUser?.role !== "admin" ||
    !openingHours ||
    openingHoursDirty
  ) {
    return;
  }

  const labels = [
    "Domingo",
    "Segunda-feira",
    "Terça-feira",
    "Quarta-feira",
    "Quinta-feira",
    "Sexta-feira",
    "Sábado"
  ];

  $("openingHoursDays").innerHTML =
    [1, 2, 3, 4, 5, 6, 0].map(index => {
      const day = openingHours.days[index];

      return `
        <div class="opening-day">
          <label class="opening-day-toggle">
            <input
              type="checkbox"
              id="openingOpen${index}"
              data-opening-day="${index}"
              ${day.open ? "checked" : ""}
            >
            ${labels[index]}
          </label>

          <fieldset
            class="opening-times"
            id="openingTimes${index}"
            aria-label="Expediente de ${labels[index]}"
            ${day.open ? "" : "disabled"}
          >
            <label>
              Abertura
              <input
                id="openingStart${index}"
                type="time"
                required
                value="${esc(day.start)}"
              >
            </label>

            <label>
              Fechamento
              <input
                id="openingEnd${index}"
                type="time"
                required
                value="${esc(day.end)}"
              >
            </label>

            <label>
              Início da pausa
              <input
                id="openingBreakStart${index}"
                type="time"
                value="${esc(day.breakStart)}"
              >
            </label>

            <label>
              Fim da pausa
              <input
                id="openingBreakEnd${index}"
                type="time"
                value="${esc(day.breakEnd)}"
              >
            </label>
          </fieldset>
        </div>
      `;
    }).join("");

  $("openingInterval").value = openingHours.interval;
  $("saveOpeningHours").disabled = false;
}

async function saveOpeningHours(event) {
  event.preventDefault();

  const button = $("saveOpeningHours");

  if (
    button.disabled ||
    currentUser?.role !== "admin"
  ) {
    return;
  }

  const message = $("openingHoursMessage");

  const settings = {
    interval: Number($("openingInterval").value),

    days: Array.from({ length: 7 }, (_, index) => ({
      open: $("openingOpen" + index).checked,
      start: $("openingStart" + index).value,
      end: $("openingEnd" + index).value,
      breakStart: $("openingBreakStart" + index).value,
      breakEnd: $("openingBreakEnd" + index).value
    }))
  };

  button.disabled = true;
  button.textContent = "Salvando...";
  message.textContent = "";

  try {
    openingHours = await api("/api/opening-hours", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(settings)
    });

    openingHoursDirty = false;

    renderOpeningHoursEditor();
    fillTimes();
    renderAll();

    message.style.color = "var(--success)";
    message.textContent =
      "Horários salvos! A agenda e as novas reservas já usam essa configuração.";
  } catch (error) {
    message.style.color = "var(--danger)";
    message.textContent = error.message;
  } finally {
    button.disabled = false;
    button.textContent = "Salvar horários";
  }
}

/* =========================
   LOGIN E ACESSO
========================= */

function selectRole(role) {
  if (role === "cliente") {
    currentUser = { role: "cliente" };
    enterApp();
    return;
  }

  pendingRole = role;

  $("roleSelect").style.display = "none";
  $("loginForm").style.display = "block";

  $("loginRoleLabel").textContent =
    (role === "admin"
      ? "Entrando como Administrador"
      : "Entrando como Funcionário") +
    " — " +
    roleEmail(role);

  $("loginPassword").value = "";
  $("loginError").textContent = "";
  $("loginPassword").focus();
}

function backToRoles() {
  pendingRole = null;
  $("loginForm").style.display = "none";
  $("roleSelect").style.display = "block";
}

function roleEmail(role) {
  return role === "admin"
    ? "admin@agendapro.local"
    : "funcionario@agendapro.local";
}

$("loginForm").addEventListener("submit", async event => {
  event.preventDefault();

  try {
    const data = await api("/api/auth/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        email: roleEmail(pendingRole),
        password: $("loginPassword").value,
        role: pendingRole
      })
    });

    currentUser = data.user;
    enterApp();
  } catch (error) {
    $("loginError").textContent = error.message;
  }
});

async function logout() {
  if (currentUser?.role !== "cliente") {
    await api("/api/auth/logout", {
      method: "POST"
    }).catch(() => {});
  }

  currentUser = null;
  openingHoursDirty = false;

  $("app").style.display = "none";
  $("clientPage").style.display = "none";
  $("authScreen").style.display = "flex";

  backToRoles();
}

function enterApp() {
  $("authScreen").style.display = "none";

  if (currentUser.role === "cliente") {
    $("app").style.display = "none";
    $("clientPage").style.display = "block";
    initClientPage();
    return;
  }

  $("clientPage").style.display = "none";
  $("app").style.display = "flex";

  initAdminApp();
}

/* =========================
   NAVEGAÇÃO
========================= */

function navItemsFor(role) {
  return [
    {
      id: "dashboard",
      label: "🏠 Dashboard",
      roles: ["admin", "funcionario"]
    },
    {
      id: "agenda",
      label: "📅 Agenda",
      roles: ["admin", "funcionario"]
    },
    {
      id: "clientes",
      label: "👥 Clientes",
      roles: ["admin", "funcionario"]
    },
    {
      id: "procedimentos",
      label: "🧾 Procedimentos",
      roles: ["admin"]
    },
    {
      id: "relatorios",
      label: "📊 Relatórios",
      roles: ["admin"]
    },
    {
      id: "configuracoes",
      label: "⚙️ Configurações",
      roles: ["admin", "funcionario"]
    }
  ].filter(item => item.roles.includes(role));
}

function renderNav() {
  const items = navItemsFor(currentUser.role);

  const mainItems = items.filter(
    item => item.id !== "configuracoes"
  );

  document.querySelector(".nav").innerHTML =
    mainItems.map(item => `
      <button data-section="${item.id}">
        ${item.label}
      </button>
    `).join("");

  document.querySelectorAll(".nav button").forEach(button => {
    button.onclick = () =>
      showSection(button.dataset.section);
  });

  const configButton = $("configNavBtn");

  if (configButton) {
    const canConfigure = items.some(
      item => item.id === "configuracoes"
    );

    configButton.style.display =
      canConfigure ? "" : "none";

    configButton.onclick = () =>
      showSection("configuracoes");
  }

  $("userTag").textContent =
    currentUser.role === "admin"
      ? "👑 Administrador"
      : "👤 Funcionário";

  showSection(mainItems[0].id);
}

function showSection(id) {
  const allowedSections =
    navItemsFor(currentUser.role).map(item => item.id);

  if (!allowedSections.includes(id)) {
    id = allowedSections[0];
  }

  document.querySelectorAll(".section").forEach(section => {
    section.classList.remove("active");
  });

  $(id).classList.add("active");

  document.querySelectorAll(".nav button").forEach(button => {
    button.classList.toggle(
      "active",
      button.dataset.section === id
    );
  });

  const configButton = $("configNavBtn");

  if (configButton) {
    configButton.classList.toggle(
      "active",
      id === "configuracoes"
    );
  }

  renderAll();
}

/* =========================
   INICIALIZAÇÃO DO PAINEL
========================= */

async function initAdminApp() {
  mountOpeningHoursPanel();
  renderNav();

  if ($("agendaDate")) {
    $("agendaDate").value = localDate();
  }

  $("date").value = localDate();

  fillTimes();

  const today = localDate();

  $("reportStartDate").value =
    today.slice(0, 7) + "-01";

  $("reportEndDate").value = today;

  await refreshData();
}

async function refreshData() {
  try {
    [procedures, clients, appointments, openingHours] =
      await Promise.all([
        api("/api/procedures"),
        api("/api/clients"),
        api("/api/appointments"),
        api("/api/opening-hours")
      ]);

    appointments = appointments.map(appointment => ({
      ...appointment,
      date: String(appointment.date || "").slice(0, 10),
      time: String(appointment.time || "").slice(0, 5)
    }));

    fillAllProcedureSelects();
    fillTimes();
    renderOpeningHoursEditor();
    renderAll();
  } catch (error) {
    alert(error.message);

    if (/sessão|autentic/i.test(error.message)) {
      logout();
    }
  }
}

function fillTimes() {
  const select = $("time");
  const previous = select.value;
  const date = $("date").value || localDate();

  const available = openingSlots(
    openingHours,
    date
  ).filter(hour =>
    !appointments.some(
      item =>
        item.date === date &&
        item.time === hour &&
        item.status !== "Cancelado"
    )
  );

  select.innerHTML =
    '<option value="">' +
    (
      available.length
        ? "Selecione"
        : "Nenhum horário disponível"
    ) +
    "</option>" +
    available.map(hour => `<option>${hour}</option>`).join("");

  select.value = available.includes(previous)
    ? previous
    : "";
}

$("date").addEventListener("change", fillTimes);

function openModal(date = localDate(), time = "") {
  $("modal").classList.add("show");
  $("date").value = date;

  fillTimes();

  $("time").value = time;

  fillAllProcedureSelects();
}

function closeModal() {
  $("modal").classList.remove("show");
  $("appointmentForm").reset();
  $("date").value = localDate();
}

$("appointmentForm").addEventListener("submit", async event => {
  event.preventDefault();

  try {
    await api("/api/appointments", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        name: $("name").value.trim(),
        phone: $("phone").value.trim(),
        date: $("date").value,
        time: $("time").value,
        procedureId: $("procedure").value,
        price: Number($("price").value),
        status: $("status").value,
        note: $("note").value.trim()
      })
    });

    closeModal();
    await refreshData();

    alert("Agendamento salvo com sucesso!");
  } catch (error) {
    alert(error.message);
  }
});

$("procedure").addEventListener("change", event => {
  const procedure = procedures.find(
    item => String(item.id) === String(event.target.value)
  );

  if (procedure) {
    $("price").value = procedure.price;
  }
});

if ($("phone")) {
  $("phone").addEventListener("input", () => {
    $("phone").value =
      $("phone").value.replace(/\D/g, "");
  });
}

function fillProcedureSelect(element, withPrice = false) {
  if (!element) return;

  element.innerHTML =
    '<option value="">Selecione</option>' +
    procedures.map(procedure => `
      <option
        value="${procedure.id}"
        data-price="${procedure.price}"
      >
        ${esc(procedure.name)}
        ${withPrice ? ` — ${money(procedure.price)}` : ""}
      </option>
    `).join("");
}

function fillAllProcedureSelects() {
  fillProcedureSelect($("procedure"), false);
  fillProcedureSelect($("clientProcedure"), true);
}

function renderAll() {
  renderDashboard();
  renderAgenda();
  renderClients();

  if (currentUser?.role === "admin") {
    renderReports();
    renderProcedures();
  }
}

function validSales(appointment) {
  return appointment.status !== "Cancelado";
}

function periodTotals(start, end) {
  const filtered = appointments.filter(
    appointment =>
      validSales(appointment) &&
      appointment.date >= start &&
      appointment.date <= end
  );

  return {
    revenue: filtered.reduce(
      (total, appointment) =>
        total + Number(appointment.price),
      0
    ),
    count: filtered.length
  };
}

function startWeek(dateValue) {
  const date = new Date(dateValue + "T12:00:00");
  const weekday = date.getDay();

  date.setDate(
    date.getDate() - (weekday === 0 ? 6 : weekday - 1)
  );

  return date.toISOString().slice(0, 10);
}

function endWeek(dateValue) {
  const date = new Date(
    startWeek(dateValue) + "T12:00:00"
  );

  date.setDate(date.getDate() + 6);

  return date.toISOString().slice(0, 10);
}

/* =========================
   DASHBOARD
========================= */

function renderDashboard() {
  const today = localDate();

  const week = periodTotals(
    startWeek(today),
    endWeek(today)
  );

  const currentDate = new Date(today + "T12:00:00");

  const lastDayOfMonth = new Date(
    currentDate.getFullYear(),
    currentDate.getMonth() + 1,
    0
  ).toISOString().slice(0, 10);

  const month = periodTotals(
    today.slice(0, 7) + "-01",
    lastDayOfMonth
  );

  const day = periodTotals(today, today);

  $("todayLabel").textContent =
    currentDate.toLocaleDateString("pt-BR", {
      weekday: "long",
      day: "2-digit",
      month: "long",
      year: "numeric"
    });

  $("todayRevenue").textContent = money(day.revenue);
  $("todayCount").textContent = `${day.count} atendimento(s)`;

  $("weekRevenue").textContent = money(week.revenue);
  $("weekCount").textContent = `${week.count} atendimento(s)`;

  $("monthRevenue").textContent = money(month.revenue);
  $("monthCount").textContent = `${month.count} atendimento(s)`;

  $("freeCount").textContent = openingSlots(
    openingHours,
    today
  ).filter(
    hour => !appointments.some(
      appointment =>
        appointment.date === today &&
        appointment.time === hour &&
        appointment.status !== "Cancelado"
    )
  ).length;

  const upcoming = appointments
    .filter(
      appointment =>
        appointment.date >= today &&
        appointment.status !== "Cancelado"
    )
    .sort(
      (first, second) =>
        (first.date + first.time).localeCompare(
          second.date + second.time
        )
    )
    .slice(0, 7);

  $("nextAppointments").innerHTML = upcoming.length
    ? `
      <div class="table-wrap">
        <table>
          <tr>
            <th>Data</th>
            <th>Hora</th>
            <th>Cliente</th>
            <th>Valor</th>
            <th>Ações</th>
          </tr>
          ${upcoming.map(appointment => `
            <tr>
              <td>${fmtDate(appointment.date)}</td>
              <td>${appointment.time}</td>
              <td>
                <b>${esc(appointment.name)}</b>
                <br>
                <small>${esc(appointment.procedure)}</small>
              </td>
              <td>${money(appointment.price)}</td>
              <td>
                <button
                  type="button"
                  class="btn secondary btn-sm"
                  onclick="showAppointmentDetails(${idArgument(appointment.id)})"
                >
                  Ver detalhes
                </button>
              </td>
            </tr>
          `).join("")}
        </table>
      </div>
    `
    : `
      <div class="empty">
        Nenhum próximo atendimento.
      </div>
    `;

  const count = month.count;
  const average = count ? month.revenue / count : 0;

  $("monthSummary").innerHTML = `
    <p>
      <b>${count}</b> atendimento(s) no mês
    </p>
    <p>
      Ticket médio: <b>${money(average)}</b>
    </p>
    <p>
      Faturamento: <b>${money(month.revenue)}</b>
    </p>
  `;

  const isAdmin = currentUser.role === "admin";

  $("monthCardWrap").style.display = isAdmin ? "" : "none";
  $("monthSummaryPanel").style.display = isAdmin ? "" : "none";
  $("dashCards").classList.toggle("cols-3", !isAdmin);
}

function showAppointmentDetails(id) {
  const appointment = appointments.find(
    item => String(item.id) === String(id)
  );

  if (!appointment) {
    alert("Atendimento não encontrado.");
    return;
  }

  alert(
    `Cliente: ${appointment.name}\n` +
    `Telefone: ${appointment.phone}\n` +
    `Data: ${fmtDate(appointment.date)}\n` +
    `Horário: ${appointment.time}\n` +
    `Procedimento: ${appointment.procedure}\n` +
    `Valor: ${money(appointment.price)}\n` +
    `Status: ${appointment.status}\n` +
    `Observação: ${appointment.note || "-"}`
  );
}

/* =========================
   FILTROS POR PERÍODO
========================= */

function periodListAndTotals(start, end) {
  const list = appointments
    .filter(
      appointment =>
        validSales(appointment) &&
        appointment.date >= start &&
        appointment.date <= end
    )
    .sort(
      (first, second) =>
        (first.date + first.time).localeCompare(
          second.date + second.time
        )
    );

  const revenue = list.reduce(
    (total, appointment) =>
      total + Number(appointment.price),
    0
  );

  const count = list.length;

  return {
    list,
    revenue,
    count,
    ticket: count ? revenue / count : 0
  };
}

function renderPeriodTable(list) {
  if (!list.length) {
    return `
      <div class="empty">
        Nenhum atendimento no período selecionado.
      </div>
    `;
  }

  return `
    <table>
      <tr>
        <th>Data</th>
        <th>Hora</th>
        <th>Cliente</th>
        <th>Procedimento</th>
        <th>Valor</th>
        <th>Status</th>
      </tr>
      ${list.map(appointment => `
        <tr>
          <td>${fmtDate(appointment.date)}</td>
          <td>${appointment.time}</td>
          <td>${esc(appointment.name)}</td>
          <td>${esc(appointment.procedure)}</td>
          <td>${money(appointment.price)}</td>
          <td>
            <span class="badge ${badge(appointment.status)}">
              ${esc(appointment.status)}
            </span>
          </td>
        </tr>
      `).join("")}
    </table>
  `;
}

function applyDashboardFilter() {
  const start = $("dashFilterStart").value;
  const end = $("dashFilterEnd").value;

  if (!start || !end) {
    alert("Selecione a data inicial e a data final.");
    return;
  }

  if (start > end) {
    alert(
      "A data inicial precisa ser anterior ou igual à data final."
    );
    return;
  }

  const result = periodListAndTotals(start, end);

  $("dashFilterCards").style.display = "";
  $("dashFilterRevenue").textContent = money(result.revenue);
  $("dashFilterCount").textContent = result.count;
  $("dashFilterTicket").textContent = money(result.ticket);
  $("dashFilterTable").innerHTML = renderPeriodTable(result.list);
}

function clearDashboardFilter() {
  $("dashFilterStart").value = "";
  $("dashFilterEnd").value = "";
  $("dashFilterCards").style.display = "none";
  $("dashFilterTable").innerHTML = "";
}

function applyAgendaFilter() {
  const start = $("agendaFilterStart").value;
  const end = $("agendaFilterEnd").value;

  if (!start || !end) {
    alert("Selecione a data inicial e a data final.");
    return;
  }

  if (start > end) {
    alert(
      "A data inicial precisa ser anterior ou igual à data final."
    );
    return;
  }

  const result = periodListAndTotals(start, end);

  $("agendaFilterCards").style.display = "";
  $("agendaFilterRevenue").textContent = money(result.revenue);
  $("agendaFilterCount").textContent = result.count;
  $("agendaFilterTicket").textContent = money(result.ticket);
  $("agendaFilterTable").innerHTML = renderPeriodTable(result.list);
}

function clearAgendaFilter() {
  $("agendaFilterStart").value = "";
  $("agendaFilterEnd").value = "";
  $("agendaFilterCards").style.display = "none";
  $("agendaFilterTable").innerHTML = "";
}

/* =========================
   AGENDA
========================= */

function setStatus(id, newStatus) {
  api(`/api/appointments/${id}/status`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      status: newStatus
    })
  })
    .then(refreshData)
    .catch(error => alert(error.message));
}

function renderAgenda() {
  const selectedDate =
    $("agendaDate")?.value || localDate();

  const list = appointments
    .filter(
      appointment => appointment.date === selectedDate
    )
    .sort(
      (first, second) =>
        first.time.localeCompare(second.time)
    );

  const dayHours = openingSlots(
    openingHours,
    selectedDate
  );

  $("slots").innerHTML = dayHours.map(hour => {
    const appointment = list.find(
      item =>
        item.time === hour &&
        item.status !== "Cancelado"
    );

    if (appointment) {
      return `
        <div class="slot busy">
          <strong>${hour}</strong>
          ${esc(appointment.name)}
          <small>
            ${esc(appointment.procedure)}
            • ${money(appointment.price)}
          </small>
        </div>
      `;
    }

    return `
      <div
        class="slot free"
        onclick="openModal('${selectedDate}', '${hour}')"
      >
        <strong>${hour}</strong>
        Disponível
        <small>Clique para agendar</small>
      </div>
    `;
  }).join("") || `
    <div class="empty">
      ${
        openingHours
          ? "Sem expediente nesta data."
          : "Carregando horários..."
      }
    </div>
  `;

  $("dayTable").innerHTML = list.length
    ? `
      <table>
        <tr>
          <th>Hora</th>
          <th>Cliente</th>
          <th>Foto</th>
          <th>Procedimento</th>
          <th>Valor</th>
          <th>Status</th>
          <th>Obs.</th>
          <th>Ações</th>
        </tr>
        ${list.map(appointment => {
          const client = clients.find(
            item => item.phone === appointment.phone
          );

          return `
            <tr>
              <td><b>${appointment.time}</b></td>
              <td>
                ${esc(appointment.name)}
                <br>
                <small>${esc(appointment.phone)}</small>
              </td>
              <td>
                ${client?.photo
                  ? `
                    <img
                      src="${esc(client.photo)}"
                      class="client-photo"
                    >
                  `
                  : `
                    <small style="color:var(--muted)">
                      Sem foto
                    </small>
                  `
                }
              </td>
              <td>${esc(appointment.procedure)}</td>
              <td>${money(appointment.price)}</td>
              <td>
                <span class="badge ${badge(appointment.status)}">
                  ${esc(appointment.status)}
                </span>
              </td>
              <td>${esc(appointment.note || "-")}</td>
              <td>
                <button
                  type="button"
                  class="btn success btn-sm"
                  onclick="setStatus(${idArgument(appointment.id)}, 'Atendido')"
                >
                  Concluído
                </button>
                <button
                  type="button"
                  class="btn danger btn-sm"
                  onclick="setStatus(${idArgument(appointment.id)}, 'Cancelado')"
                >
                  Não Concluído
                </button>
              </td>
            </tr>
          `;
        }).join("")}
      </table>
    `
    : `
      <div class="empty">
        Nenhum agendamento para esta data.
      </div>
    `;
}

function badge(status) {
  return {
    Agendado: "b-agendado",
    Confirmado: "b-confirmado",
    Atendido: "b-atendido",
    Cancelado: "b-cancelado"
  }[status] || "b-agendado";
}

function changeDay(numberOfDays) {
  const date = new Date(
    ($("agendaDate").value || localDate()) + "T12:00:00"
  );

  date.setDate(date.getDate() + numberOfDays);

  $("agendaDate").value =
    date.toISOString().slice(0, 10);

  renderAgenda();
}

function goToday() {
  if ($("agendaDate")) {
    $("agendaDate").value = localDate();
  }

  renderAgenda();
}

/* =========================
   CLIENTES
========================= */

function openClientModal() {
  $("clientModal").classList.add("show");
}

function closeClientModal() {
  $("clientModal").classList.remove("show");
  $("clientForm").reset();
  $("photoPreview").style.display = "none";
  $("photoPreview").src = "";
}

$("clientPhoto").addEventListener("change", () => {
  const file = $("clientPhoto").files[0];

  if (!file) return;

  const reader = new FileReader();

  reader.onload = event => {
    $("photoPreview").src = event.target.result;
    $("photoPreview").style.display = "block";
  };

  reader.readAsDataURL(file);
});

if ($("clientPhone")) {
  $("clientPhone").addEventListener("input", () => {
    $("clientPhone").value =
      $("clientPhone").value.replace(/\D/g, "");
  });
}

$("clientForm").addEventListener("submit", async event => {
  event.preventDefault();

  try {
    const form = new FormData();

    form.append("name", $("clientName").value.trim());
    form.append("phone", $("clientPhone").value.trim());
    form.append("note", $("clientNote").value.trim());

    if ($("clientPhoto").files[0]) {
      form.append("photo", $("clientPhoto").files[0]);
    }

    await api("/api/clients", {
      method: "POST",
      body: form
    });

    closeClientModal();
    await refreshData();

    alert("Cliente salvo com sucesso!");
  } catch (error) {
    alert(error.message);
  }
});

async function downloadClientPhoto(id) {
  const client = clients.find(
    item => String(item.id) === String(id)
  );

  if (!client || !client.photo) {
    alert("Este cliente não tem foto cadastrada.");
    return;
  }

  try {
    const response = await fetch(client.photo, {
      credentials: "same-origin",
      cache: "no-store"
    });

    if (!response.ok) {
      throw new Error(
        "Não foi possível obter a foto (HTTP " +
        response.status +
        "). O arquivo pode estar indisponível ou o endereço estar incorreto."
      );
    }

    const blob = await response.blob();
    const mime = blob.type.split(";")[0].toLowerCase();

    if (!mime.startsWith("image/") || !blob.size) {
      throw new Error(
        "O servidor não devolveu uma imagem válida."
      );
    }

    const extensions = {
      "image/jpeg": "jpg",
      "image/png": "png",
      "image/webp": "webp",
      "image/gif": "gif",
      "image/avif": "avif",
      "image/heic": "heic",
      "image/heif": "heif",
      "image/bmp": "bmp",
      "image/svg+xml": "svg",
      "image/tiff": "tiff"
    };

    const extension = extensions[mime] || "img";

    const name = String(client.name || "cliente")
      .trim()
      .replace(/[^a-zA-Z0-9À-ÿ_-]+/g, "_") || "cliente";

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = `${name}.${extension}`;

    document.body.appendChild(link);
    link.click();
    link.remove();

    setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 60000);
  } catch (error) {
    alert(
      error.message ||
      "Não foi possível baixar a foto."
    );
  }
}

function renderClients() {
  const search =
    ($("clientSearch").value || "").toLowerCase();

  const filteredClients = clients.filter(
    client =>
      (client.name + client.phone)
        .toLowerCase()
        .includes(search)
  );

  $("clientTable").innerHTML = filteredClients.length
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
              ${client.photo
                ? `
                  <img
                    class="client-photo"
                    src="${esc(client.photo)}"
                  >
                `
                : ""
              }
              <b>${esc(client.name)}</b>
            </td>
            <td>${esc(client.phone)}</td>
            <td>${client.count}</td>
            <td>${money(client.total)}</td>
            <td>
              ${client.last ? fmtDate(client.last) : "—"}
            </td>
            <td>${esc(client.note || "-")}</td>
            <td>
              ${client.photo
                ? `
                  <button
                    type="button"
                    class="btn secondary btn-sm"
                    onclick="downloadClientPhoto(${idArgument(client.id)})"
                  >
                    ⬇️ Baixar foto
                  </button>
                `
                : ""
              }
              <button
                type="button"
                class="btn danger btn-sm"
                onclick="removeClient(${idArgument(client.id)})"
              >
                Remover
              </button>
            </td>
          </tr>
        `).join("")}
      </table>
    `
    : `
      <div class="empty">
        Nenhum cliente encontrado.
      </div>
    `;
}

async function removeClient(id) {
  if (!confirm(
    "Remover este cliente da lista? Os agendamentos e valores dos relatórios serão mantidos."
  )) {
    return;
  }

  try {
    await api(`/api/clients/${encodeURIComponent(id)}`, {
      method: "DELETE"
    });

    await refreshData();
  } catch (error) {
    alert(error.message);
  }
}

/* =========================
   PROCEDIMENTOS
========================= */

async function addProcedure() {
  const name = $("procName").value.trim();
  const price = Number($("procPrice").value) || 0;

  if (!name) {
    alert("Informe o nome do procedimento.");
    return;
  }

  try {
    await api("/api/procedures", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        name,
        price
      })
    });

    $("procName").value = "";
    $("procPrice").value = "";

    await refreshData();
  } catch (error) {
    alert(error.message);
  }
}

function removeProcedure(id) {
  if (!confirm("Remover este procedimento?")) {
    return;
  }

  api(`/api/procedures/${id}`, {
    method: "DELETE"
  })
    .then(refreshData)
    .catch(error => alert(error.message));
}

function renderProcedures() {
  $("procedureTable").innerHTML = procedures.length
    ? `
      <table>
        <tr>
          <th>Procedimento</th>
          <th>Valor padrão</th>
          <th></th>
        </tr>
        ${procedures.map(procedure => `
          <tr>
            <td>${esc(procedure.name)}</td>
            <td>${money(procedure.price)}</td>
            <td>
              <button
                type="button"
                class="btn secondary"
                onclick="removeProcedure(${idArgument(procedure.id)})"
              >
                Remover
              </button>
            </td>
          </tr>
        `).join("")}
      </table>
    `
    : `
      <div class="empty">
        Nenhum procedimento cadastrado.
      </div>
    `;
}

/* =========================
   RELATÓRIOS
========================= */

function updateReportPeriod(start, end) {
  const result = periodListAndTotals(start, end);

  $("filteredRevenue").textContent = money(result.revenue);
  $("filteredCount").textContent = result.count;
  $("filteredTicket").textContent = money(result.ticket);

  const proceduresMap = {};

  result.list.forEach(appointment => {
    const procedure =
      appointment.procedure || "Sem procedimento";

    proceduresMap[procedure] =
      (proceduresMap[procedure] || 0) + 1;
  });

  const rows = Object.entries(proceduresMap).sort(
    (first, second) => second[1] - first[1]
  );

  const maximum = rows[0]?.[1] || 1;
  const label = `${fmtDate(start)} até ${fmtDate(end)}`;

  $("procedureReport").innerHTML = `
    <p style="color:var(--muted)">
      Período: <b>${esc(label)}</b>
    </p>
  ` + (
    rows.length
      ? rows.map(([procedure, count]) => `
        <div style="margin:14px 0">
          <div style="
            display:flex;
            justify-content:space-between;
            margin-bottom:6px
          ">
            <span>${esc(procedure)}</span>
            <b>${count}</b>
          </div>
          <div class="bar">
            <i style="width:${count / maximum * 100}%"></i>
          </div>
        </div>
      `).join("")
      : `
        <div class="empty">
          Não há atendimentos no período selecionado.
        </div>
      `
  );
}

function applyReportFilter() {
  const start = $("reportStartDate").value;
  const end = $("reportEndDate").value;

  if (!start || !end) {
    alert("Selecione a data inicial e a data final.");
    return;
  }

  if (start > end) {
    alert(
      "A data inicial precisa ser anterior ou igual à data final."
    );
    return;
  }

  updateReportPeriod(start, end);
}

function clearReportFilter() {
  const today = localDate();

  $("reportStartDate").value =
    today.slice(0, 7) + "-01";

  $("reportEndDate").value = today;

  updateReportPeriod(
    $("reportStartDate").value,
    $("reportEndDate").value
  );
}

async function renderReports() {
  if (currentUser?.role !== "admin") {
    return;
  }

  try {
    const summary = await api("/api/reports/summary");

    $("rToday").textContent = money(summary.today.revenue);
    $("rMonth").textContent = money(summary.month.revenue);
    $("rYear").textContent = money(summary.year.revenue);

    const start = $("reportStartDate").value;
    const end = $("reportEndDate").value;

    if (start && end && start <= end) {
      updateReportPeriod(start, end);
    }
  } catch (error) {
    console.error("Erro ao carregar relatórios:", error);
  }
}

async function downloadReportPDF(type) {
  try {
    const start =
      $("reportStartDate").value || localDate();

    const end =
      $("reportEndDate").value || localDate();

    const params = { type };

    if (type === "day") {
      params.date = end;
    }

    if (type === "month") {
      params.month = start.slice(0, 7);
    }

    if (type === "year") {
      params.year = start.slice(0, 4);
    }

    const response = await fetch(
      "/api/reports/pdf?" + new URLSearchParams(params),
      {
        credentials: "include"
      }
    );

    if (!response.ok) {
      const data = await response
        .json()
        .catch(() => ({}));

      throw new Error(
        data.error ||
        "Não foi possível gerar o PDF."
      );
    }

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = `Relatorio_${type}.pdf`;

    link.click();
    URL.revokeObjectURL(url);
  } catch (error) {
    alert(error.message);
  }
}

/* =========================
   ALTERAÇÃO DE SENHA
========================= */

async function changePassword(event) {
  event.preventDefault();

  const currentPassword = $("currentPassword").value;
  const newPassword = $("newPassword").value;
  const confirmPassword = $("confirmPassword").value;
  const message = $("passwordMessage");

  message.textContent = "";
  message.style.color = "var(--danger)";

  if (
    !currentPassword ||
    !newPassword ||
    !confirmPassword
  ) {
    message.textContent = "Preencha todos os campos.";
    return;
  }

  if (newPassword !== confirmPassword) {
    message.textContent =
      "A nova senha e a confirmação não são iguais.";
    return;
  }

  if (newPassword.length < 6) {
    message.textContent =
      "A nova senha deve ter pelo menos 6 caracteres.";
    return;
  }

  if (currentPassword === newPassword) {
    message.textContent =
      "A nova senha deve ser diferente da senha atual.";
    return;
  }

  try {
    const result = await api("/api/auth/password", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        currentPassword,
        newPassword,
        confirmPassword
      })
    });

    message.style.color = "var(--success)";
    message.textContent =
      result.message || "Senha alterada com sucesso!";

    $("passwordForm").reset();
  } catch (error) {
    message.textContent = error.message;
  }
}

function clearPasswordForm() {
  $("passwordForm").reset();
  $("passwordMessage").textContent = "";
}

/* =========================
   AGENDAMENTO DO CLIENTE
========================= */

async function initClientPage() {
  try {
    [procedures, openingHours] = await Promise.all([
      api("/api/procedures"),
      api("/api/opening-hours")
    ]);
  } catch (error) {
    alert(error.message);
    return;
  }

  $("clientBookingForm").reset();
  $("cbPhotoPreview").style.display = "none";
  $("clientStepForm").style.display = "block";
  $("clientSuccess").style.display = "none";
  $("cbDate").value = localDate();

  fillProcedureSelect($("clientProcedure"), true);

  selectedSlot = "";

  renderClientSlots();
}

$("cbDate").addEventListener("change", renderClientSlots);

async function renderClientSlots() {
  const date = $("cbDate").value || localDate();

  selectedSlot = "";

  $("cbSlots").innerHTML = `
    <div class="empty">
      Carregando horários...
    </div>
  `;

  const requestId = ++clientSlotsRequestId;

  try {
    const data = await api(
      "/api/public/slots?date=" + encodeURIComponent(date)
    );

    if (requestId !== clientSlotsRequestId) return;

    const taken = new Set(
      (data.taken || []).map(
        time => String(time).slice(0, 5)
      )
    );

    selectedSlot = "";

    $("cbSlots").innerHTML = (data.slots || []).map(hour => {
      if (taken.has(hour)) {
        return `
          <div class="slot busy">
            <strong>${hour}</strong>
            Ocupado
          </div>
        `;
      }

      return `
        <div
          class="slot free"
          data-time="${hour}"
          onclick="pickSlot('${hour}')"
        >
          <strong>${hour}</strong>
          Disponível
        </div>
      `;
    }).join("") || `
      <div class="empty">
        Sem expediente nesta data. Escolha outro dia.
      </div>
    `;
  } catch (error) {
    if (requestId !== clientSlotsRequestId) return;

    $("cbSlots").innerHTML = `
      <div class="empty">
        Não foi possível carregar os horários.
        Selecione a data novamente.
      </div>
    `;

    alert(error.message);
  }
}

function pickSlot(hour) {
  selectedSlot = hour;

  document.querySelectorAll("#cbSlots .slot").forEach(element => {
    element.classList.remove("selected");
  });

  document.querySelector(
    `#cbSlots .slot[data-time="${hour}"]`
  )?.classList.add("selected");
}

$("cbPhoto").addEventListener("change", () => {
  const file = $("cbPhoto").files[0];

  if (!file) return;

  const reader = new FileReader();

  reader.onload = event => {
    $("cbPhotoPreview").src = event.target.result;
    $("cbPhotoPreview").style.display = "block";
  };

  reader.readAsDataURL(file);
});

$("cbPhone").addEventListener("input", () => {
  $("cbPhone").value =
    $("cbPhone").value.replace(/\D/g, "");
});

$("clientBookingForm").addEventListener("submit", async event => {
  event.preventDefault();

  if (!selectedSlot) {
    alert("Escolha um horário disponível.");
    return;
  }

  try {
    const form = new FormData();

    form.append("name", $("cbName").value.trim());
    form.append("phone", $("cbPhone").value.trim());
    form.append("date", $("cbDate").value);
    form.append("time", selectedSlot);
    form.append("procedureId", $("clientProcedure").value);
    form.append("note", $("cbNote").value.trim());

    if ($("cbPhoto").files[0]) {
      form.append("photo", $("cbPhoto").files[0]);
    }

    const result = await api("/api/public/bookings", {
      method: "POST",
      body: form
    });

    $("clientStepForm").style.display = "none";
    $("clientSuccess").style.display = "block";
    $("successDetails").textContent = result.details;
  } catch (error) {
    alert(error.message);
    renderClientSlots();
  }
});

function newClientBooking() {
  initClientPage();
}

/* =========================
   INICIALIZAÇÃO
========================= */

document.addEventListener("DOMContentLoaded", () => {
  const passwordForm = $("passwordForm");

  if (passwordForm) {
    passwordForm.addEventListener(
      "submit",
      changePassword
    );
  }
});

async function boot() {
  try {
    const data = await api("/api/auth/me");

    currentUser = data.user;
    enterApp();
  } catch {
    $("authScreen").style.display = "flex";
  }
}

boot();