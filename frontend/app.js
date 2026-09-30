let openingHours = null;
let openingHoursDirty = false;
let currentUser = null;
let pendingRole = null;
let procedures = [];
let clients = [];
let appointments = [];
let selectedSlot = "";
let clientSlotsRequestId = 0;

let returnSaving = false;
let returnSlotsRequestId = 0;
let returnSlotsReady = false;

let liveTimer = null;
let refreshBusy = false;
let refreshSequence = 0;
let lastDataDate = "";
let notificationDate = "";
let notifiedIds = new Set();
let toastTimer = null;

let appointmentSaving = false;
let publicBookingSaving = false;
let bookingClientId = null;

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
  const date = new Date(String(value).slice(0, 10) + "T12:00:00");
  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleDateString("pt-BR");
};

const esc = value =>
  String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[character]);

const idArgument = value => esc(JSON.stringify(String(value)));

function monthEnd(date) {
  const [year, month] = date.split("-").map(Number);
  return `${year}-${String(month).padStart(2, "0")}-` +
    new Date(year, month, 0).getDate();
}

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
      data?.error || "Não foi possível concluir a operação."
    );
  }

  return data;
}

// =====================================================
// HORÁRIOS DE ATENDIMENTO
// =====================================================

function openingSlots(settings, date) {
  if (!settings || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return [];

  const value = new Date(date + "T12:00:00Z");

  if (
    Number.isNaN(value.getTime()) ||
    value.toISOString().slice(0, 10) !== date
  ) return [];

  if (Array.isArray(settings.slots)) return [...settings.slots];

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
      const hour = String(Math.floor(minute / 60)).padStart(2, "0");
      const mins = String(minute % 60).padStart(2, "0");
      slots.push(`${hour}:${mins}`);
    }
  }

  return slots;
}

function mountOpeningHoursPanel() {
  let panel = $("openingHoursPanel");

  if (!panel || !panel.dataset.bound) {
    let button = $("editAvailableHours");

    if (!button) {
      button = document.createElement("button");
      button.id = "editAvailableHours";
      button.type = "button";
      button.className = "btn primary";
      $("agenda").querySelector(".top")
        .insertAdjacentElement("afterend", button);
    }

    if (!panel) {
      panel = document.createElement("div");
      panel.id = "openingHoursPanel";
      panel.className = "panel";
      button.insertAdjacentElement("afterend", panel);
    }

    panel.innerHTML = `
      <p>Altere os horários disponíveis e clique em Salvar horários.</p>
      <form id="openingHoursForm">
        <div id="openingHoursDays"></div>
        <div class="return-actions">
          <button id="addAttendanceTime" type="button" class="btn secondary">
            + Adicionar horário
          </button>
          <button id="saveOpeningHours" type="submit" class="btn primary">
            Salvar horários
          </button>
        </div>
        <p>
          A lista vale para todos os dias.
          Os agendamentos existentes serão mantidos.
        </p>
        <div id="openingHoursMessage" role="status"></div>
      </form>
    `;

    panel.dataset.bound = "true";

    button.onclick = () => {
      panel.hidden = !panel.hidden;
      button.setAttribute("aria-expanded", String(!panel.hidden));
      button.textContent = panel.hidden
        ? "✏️ Alterar horários disponíveis"
        : "Fechar edição dos horários";

      if (!panel.hidden) renderOpeningHoursEditor();
    };

    $("openingHoursForm").addEventListener("submit", saveOpeningHours);
    $("openingHoursForm").addEventListener("input", markAttendanceHoursDirty);

    $("addAttendanceTime").onclick = () => {
      appendAttendanceTime("");
      markAttendanceHoursDirty();
      $("openingHoursDays").lastElementChild.querySelector("input").focus();
    };
  }

  $("editAvailableHours").hidden = currentUser?.role !== "admin";
  $("editAvailableHours").textContent = "✏️ Alterar horários disponíveis";
  panel.hidden = true;
}

function markAttendanceHoursDirty() {
  openingHoursDirty = true;
  $("openingHoursMessage").style.color = "var(--muted)";
  $("openingHoursMessage").textContent = "Alterações ainda não salvas.";
}

function appendAttendanceTime(time) {
  const row = document.createElement("div");
  row.className = "attendance-row";

  row.innerHTML = `
    <label>
      Horário disponível
      <input type="time" step="60" required value="${esc(time)}">
    </label>
    <button type="button" class="btn danger btn-sm">Remover</button>
  `;

  row.querySelector("button").addEventListener("click", () => {
    row.remove();
    markAttendanceHoursDirty();
  });

  $("openingHoursDays").appendChild(row);
}

function renderOpeningHoursEditor() {
  if (
    !$("openingHoursPanel") ||
    currentUser?.role !== "admin" ||
    !openingHours ||
    openingHoursDirty
  ) return;

  $("openingHoursDays").innerHTML = "";
  openingSlots(openingHours, localDate()).forEach(appendAttendanceTime);
  $("saveOpeningHours").disabled = false;
  $("addAttendanceTime").disabled = false;
}

async function saveOpeningHours(event) {
  event.preventDefault();

  const button = $("saveOpeningHours");
  if (button.disabled || currentUser?.role !== "admin") return;

  const message = $("openingHoursMessage");
  const slots = Array.from(
    $("openingHoursDays").querySelectorAll("input"),
    input => input.value
  );

  if (slots.some(time => !/^([01]\d|2[0-3]):[0-5]\d$/.test(time))) {
    message.style.color = "var(--danger)";
    message.textContent = "Preencha todos os horários antes de salvar.";
    return;
  }

  if (new Set(slots).size !== slots.length) {
    message.style.color = "var(--danger)";
    message.textContent = "Existem horários repetidos. Remova a repetição.";
    return;
  }

  const controls = Array.from(
    $("openingHoursForm").querySelectorAll("input, button")
  );

  controls.forEach(control => control.disabled = true);
  button.textContent = "Salvando...";
  message.textContent = "";

  try {
    openingHours = await api("/api/opening-hours", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slots })
    });

    openingHoursDirty = false;
    renderOpeningHoursEditor();
    fillTimes();
    renderAll();

    message.style.color = "var(--success)";
    message.textContent = "Horários salvos! Essa lista será usada todos os dias.";
  } catch (error) {
    message.style.color = "var(--danger)";
    message.textContent = error.message;
  } finally {
    controls.forEach(control => control.disabled = false);
    button.textContent = "Salvar horários";
  }
}

// =====================================================
// LOGIN E ACESSO
// =====================================================

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
      : "Entrando como Funcionário") + " — " + roleEmail(role);

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
      headers: { "Content-Type": "application/json" },
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
  clearInterval(liveTimer);
  liveTimer = null;
  refreshSequence++;
  refreshBusy = false;
  notificationDate = "";
  notifiedIds = new Set();
  clearTimeout(toastTimer);

  if ($("dailyDialog")?.open) $("dailyDialog").close();
  if ($("returnDialog")?.open) $("returnDialog").close();
  if ($("dailyToast")) $("dailyToast").hidden = true;

  if (currentUser?.role !== "cliente") {
    await api("/api/auth/logout", { method: "POST" }).catch(() => {});
  }

  currentUser = null;
  appointments = [];
  clients = [];
  openingHoursDirty = false;
  closeModal();

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

// =====================================================
// NAVEGAÇÃO
// =====================================================

function navItemsFor(role) {
  return [
    { id: "dashboard", label: "🏠 Dashboard", roles: ["admin", "funcionario"] },
    { id: "agenda", label: "📅 Agenda", roles: ["admin", "funcionario"] },
    { id: "atendimentos", label: "🔄 Atendimentos", roles: ["admin", "funcionario"] },
    { id: "clientes", label: "👥 Clientes", roles: ["admin", "funcionario"] },
    { id: "procedimentos", label: "🧾 Procedimentos", roles: ["admin"] },
    { id: "relatorios", label: "📊 Relatórios", roles: ["admin"] },
    { id: "configuracoes", label: "⚙️ Configurações", roles: ["admin", "funcionario"] }
  ].filter(item => item.roles.includes(role));
}

function renderNav() {
  const items = navItemsFor(currentUser.role);
  const mainItems = items.filter(item => item.id !== "configuracoes");

  document.querySelector(".nav").innerHTML = mainItems.map(item => `
    <button data-section="${item.id}">${item.label}</button>
  `).join("");

  document.querySelectorAll(".nav button").forEach(button => {
    button.onclick = () => showSection(button.dataset.section);
  });

  const configButton = $("configNavBtn");

  if (configButton) {
    configButton.style.display = items.some(
      item => item.id === "configuracoes"
    ) ? "" : "none";
    configButton.onclick = () => showSection("configuracoes");
  }

  $("userTag").textContent = currentUser.role === "admin"
    ? "👑 Administrador"
    : "👤 Funcionário";

  showSection(mainItems[0].id);
}

function showSection(id) {
  if (!currentUser || currentUser.role === "cliente") return;

  const allowedSections = navItemsFor(currentUser.role).map(item => item.id);
  if (!allowedSections.includes(id)) id = allowedSections[0];

  document.querySelectorAll(".section").forEach(section => {
    section.classList.remove("active");
  });

  $(id).classList.add("active");

  document.querySelectorAll(".nav button").forEach(button => {
    button.classList.toggle("active", button.dataset.section === id);
  });

  $("configNavBtn")?.classList.toggle("active", id === "configuracoes");
  renderAll();
}

// =====================================================
// INICIALIZAÇÃO E ATUALIZAÇÃO
// =====================================================

async function initAdminApp() {
  mountReturnUI();
  mountDailyUI();
  mountOpeningHoursPanel();
  renderNav();

  if ($("agendaDate")) $("agendaDate").value = localDate();
  $("date").value = localDate();
  fillTimes();

  const today = localDate();
  $("reportStartDate").value = today.slice(0, 7) + "-01";
  $("reportEndDate").value = monthEnd(today);

  await refreshData();
  startLiveUpdates();
}

async function refreshData(options = {}) {
  if (!currentUser || currentUser.role === "cliente") return false;

  const sequence = ++refreshSequence;
  const userId = currentUser.id;
  refreshBusy = true;

  try {
    const data = await Promise.all([
      api("/api/procedures"),
      api("/api/clients"),
      api("/api/appointments"),
      api("/api/opening-hours")
    ]);

    if (
      sequence !== refreshSequence ||
      currentUser?.id !== userId
    ) return false;

    [procedures, clients, appointments, openingHours] = data;

    appointments = appointments.map(appointment => ({
      ...appointment,
      date: String(appointment.date || "").slice(0, 10),
      time: String(appointment.time || "").slice(0, 5)
    }));

    const today = localDate();

    if (
      lastDataDate &&
      lastDataDate !== today &&
      $("agendaDate")?.value === lastDataDate
    ) {
      $("agendaDate").value = today;
    }

    lastDataDate = today;
    fillAllProcedureSelects();
    fillTimes();
    renderOpeningHoursEditor();
    renderAll();

    if ($("liveUpdateMessage")) $("liveUpdateMessage").textContent = "";
    return true;
  } catch (error) {
    if (
      sequence !== refreshSequence ||
      currentUser?.id !== userId
    ) return false;

    if (options.silent) {
      if ($("liveUpdateMessage")) {
        $("liveUpdateMessage").textContent =
          "Não foi possível atualizar agora. Tentaremos novamente.";
      }
    } else {
      alert(error.message);
    }

    if (/sessão|autentic/i.test(error.message)) logout();
    return false;
  } finally {
    if (sequence === refreshSequence) refreshBusy = false;
  }
}

function startLiveUpdates() {
  clearInterval(liveTimer);
  if (!currentUser || currentUser.role === "cliente") return;

  liveTimer = setInterval(() => {
    if (currentUser && currentUser.role !== "cliente" && !refreshBusy) {
      refreshData({ silent: true });
    }
  }, 60000);
}

document.addEventListener("visibilitychange", () => {
  if (
    document.visibilityState === "visible" &&
    currentUser &&
    currentUser.role !== "cliente" &&
    !refreshBusy
  ) {
    refreshData({ silent: true });
  }
});

// =====================================================
// NOVO AGENDAMENTO
// =====================================================

function fillTimes() {
  const select = $("time");
  const previous = select.value;
  const date = $("date").value || localDate();
  const available = openingSlots(openingHours, date);

  select.innerHTML =
    '<option value="">' +
    (available.length ? "Selecione" : "Nenhum horário disponível") +
    "</option>" +
    available.map(hour => `
      <option value="${esc(hour)}">${esc(hour)}</option>
    `).join("");

  select.value = available.includes(previous) ? previous : "";
}

$("date").addEventListener("change", fillTimes);

function resetBookingClient() {
  bookingClientId = null;
  $("name").readOnly = false;
  $("phone").readOnly = false;
  $("price").readOnly = false;

  if ($("bookingClientNotice")) {
    $("bookingClientNotice").hidden = true;
  }
}

function openModal(date = localDate(), time = "") {
  if (appointmentSaving) return;

  resetBookingClient();
  $("appointmentForm").reset();

  $("status").innerHTML =
    "<option>Confirmado</option><option>Cancelado</option>";

  $("date").value = date;
  fillAllProcedureSelects();

  $("procedure").value = "";
  $("price").value = "";

  fillTimes();
  $("time").value = time;
  $("modal").classList.add("show");
}

function openClientAppointment(id) {
  if (
    appointmentSaving ||
    !currentUser ||
    currentUser.role === "cliente"
  ) return;

  const client = clients.find(item => String(item.id) === String(id));

  if (!client) {
    alert("Cliente não encontrado. Atualize a lista.");
    return;
  }

  openModal();
  bookingClientId = String(client.id);

  $("name").value = client.name;
  $("phone").value = client.phone;

  $("name").readOnly = true;
  $("phone").readOnly = true;
  $("price").readOnly = true;

  let notice = $("bookingClientNotice");

  if (!notice) {
    notice = document.createElement("p");
    notice.id = "bookingClientNotice";
    notice.className = "booking-client-notice";
    $("appointmentForm").prepend(notice);
  }

  notice.textContent =
    "Agendamento para " + client.name +
    ". Escolha procedimento, data e horário. " +
    "O valor é preenchido automaticamente; a observação é opcional.";

  notice.hidden = false;

  requestAnimationFrame(() => $("procedure").focus());
}

function closeModal() {
  $("modal").classList.remove("show");
  $("appointmentForm").reset();
  $("date").value = localDate();
  resetBookingClient();
}

$("appointmentForm").addEventListener("submit", async event => {
  event.preventDefault();
  if (appointmentSaving) return;

  const bookingClient = bookingClientId === null
    ? null
    : clients.find(item => String(item.id) === bookingClientId);

  if (bookingClientId !== null && !bookingClient) {
    alert(
      "Este cliente não está mais na lista. " +
      "Feche o formulário e atualize os clientes."
    );
    return;
  }

  appointmentSaving = true;

  const submit = event.currentTarget.querySelector(
    'button[type="submit"], button:not([type])'
  );

  if (submit) submit.disabled = true;

  try {
    await api("/api/appointments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: bookingClient ? bookingClient.name : $("name").value.trim(),
        phone: bookingClient ? bookingClient.phone : $("phone").value.trim(),
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
  } finally {
    appointmentSaving = false;
    if (submit) submit.disabled = false;
  }
});

$("procedure").addEventListener("change", event => {
  const procedure = procedures.find(
    item => String(item.id) === String(event.target.value)
  );

  $("price").value = procedure ? procedure.price : "";
});

if ($("phone")) {
  $("phone").addEventListener("input", () => {
    $("phone").value = $("phone").value.replace(/\D/g, "");
  });
}

function fillProcedureSelect(element, withPrice = false) {
  if (!element) return;
  const previous = element.value;

  element.innerHTML = '<option value="">Selecione</option>' +
    procedures.map(procedure => `
      <option value="${esc(procedure.id)}" data-price="${esc(procedure.price)}">
        ${esc(procedure.name)}
        ${withPrice ? ` — ${money(procedure.price)}` : ""}
      </option>
    `).join("");

  if ([...element.options].some(option => option.value === previous)) {
    element.value = previous;
  }
}

function fillAllProcedureSelects() {
  fillProcedureSelect($("procedure"), false);
  fillProcedureSelect($("clientProcedure"), true);
}

function renderAll() {
  if (!currentUser || currentUser.role === "cliente") return;

  renderDashboard();
  renderAgenda();
  renderClients();
  renderAttendances();
  renderDailyUI();
  refreshVisibleFilters();

  if (currentUser.role === "admin") {
    renderReports();
    renderProcedures();
  }
}

function validSales(appointment) {
  return appointment.status !== "Cancelado";
}

function pendingAppointment(appointment) {
  return !["Cancelado", "Atendido"].includes(appointment.status);
}

function periodTotals(start, end) {
  const filtered = appointments.filter(appointment =>
    validSales(appointment) &&
    appointment.date >= start &&
    appointment.date <= end
  );

  return {
    revenue: filtered.reduce(
      (total, appointment) => total + Number(appointment.price), 0
    ),
    count: filtered.length
  };
}

function startWeek(dateValue) {
  const date = new Date(dateValue + "T12:00:00");
  const weekday = date.getDay();

  date.setDate(date.getDate() - (weekday === 0 ? 6 : weekday - 1));
  return date.toISOString().slice(0, 10);
}

function endWeek(dateValue) {
  const date = new Date(startWeek(dateValue) + "T12:00:00");
  date.setDate(date.getDate() + 6);
  return date.toISOString().slice(0, 10);
}

function todayAppointments() {
  const today = localDate();

  return appointments
    .filter(appointment =>
      appointment.date === today && pendingAppointment(appointment)
    )
    .sort((a, b) => a.time.localeCompare(b.time));
}

function futureAppointments() {
  const today = localDate();

  return appointments
    .filter(appointment =>
      appointment.date > today && pendingAppointment(appointment)
    )
    .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
}

// =====================================================
// DASHBOARD
// =====================================================

function renderDashboard() {
  const today = localDate();
  const week = periodTotals(startWeek(today), endWeek(today));
  const month = periodTotals(today.slice(0, 7) + "-01", monthEnd(today));
  const day = periodTotals(today, today);

  $("todayLabel").textContent =
    new Date(today + "T12:00:00").toLocaleDateString("pt-BR", {
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

  $("freeCount").textContent = openingSlots(openingHours, today).length;

  const list = todayAppointments();

  $("nextAppointments").innerHTML = list.length
    ? `
      <div class="table-wrap">
        <table>
          <tr>
            <th>Data</th><th>Hora</th><th>Cliente</th><th>Valor</th><th>Ações</th>
          </tr>
          ${list.map(appointment => `
            <tr>
              <td>${fmtDate(appointment.date)}</td>
              <td>${esc(appointment.time)}</td>
              <td>
                <b>${esc(appointment.name)}</b><br>
                <small>
                  ${esc(appointment.procedure)}
                  ${isReturn(appointment) ? " · 🔄 Retorno" : ""}
                </small>
              </td>
              <td>${money(appointment.price)}</td>
              <td>
                <button type="button" class="btn secondary btn-sm"
                  onclick="showAppointmentDetails(${idArgument(appointment.id)})">
                  Ver detalhes
                </button>
              </td>
            </tr>
          `).join("")}
        </table>
      </div>
    `
    : '<div class="empty">Nenhum atendimento pendente para hoje.</div>';

  const average = month.count ? month.revenue / month.count : 0;

  $("monthSummary").innerHTML = `
    <p><b>${month.count}</b> atendimento(s) no mês</p>
    <p>Ticket médio: <b>${money(average)}</b></p>
    <p>Faturamento: <b>${money(month.revenue)}</b></p>
  `;

  const isAdmin = currentUser?.role === "admin";
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
    `Tipo: ${isReturn(appointment) ? "Retorno" : "Atendimento"}\n` +
    `Observação: ${appointment.note || "-"}`
  );
}

// =====================================================
// NOTIFICAÇÕES E ATENDIMENTOS FUTUROS
// =====================================================

function mountDailyUI() {
  if ($("notificationBell")) return;

  const style = document.createElement("style");

  style.textContent = `
    .notification-bell {
      display:flex;align-items:center;justify-content:space-between;
      gap:10px;width:100%;padding:12px;border:1px solid #e2b4c2;
      border-radius:12px;color:#563344;background:#fff7fa;
      font:inherit;cursor:pointer;margin:12px 0;
    }
    .notification-count {
      border-radius:20px;background:#ba577b;color:white;
      padding:3px 9px;font-weight:bold;
    }
    #futurePanel {margin-top:24px}
    #futurePanel .table-wrap {max-height:500px;overflow:auto}
    #futurePanel h2 {margin-top:0}
    #futureCount {color:#8a6475}
    .multi-slot {
      font:inherit;text-align:left;cursor:pointer;width:100%;color:inherit;
    }
    .multi-slot span,.multi-slot small {display:block;margin-top:5px}
    #dailyDialog {
      width:min(850px,calc(100vw - 32px));max-height:85vh;overflow:auto;
      padding:22px;box-sizing:border-box;border:1px solid #f1d7dc;
      border-radius:18px;color:#302c38;background:white;
    }
    #dailyDialog::backdrop {background:rgba(35,20,30,.45)}
    #dailyDialog .table-wrap {overflow:auto}
    #dailyDialog table {min-width:720px}
    #dailyToast[hidden] {display:none!important}
    #dailyToast {
      position:fixed;z-index:9999;right:18px;bottom:18px;
      width:min(370px,calc(100vw - 36px));box-sizing:border-box;
      padding:18px;background:white;color:#42313a;
      border:1px solid #e8b8c8;border-left:5px solid #c26a89;
      border-radius:14px;box-shadow:0 8px 30px #0002;
    }
    #dailyToast p {margin:0 0 12px}
    #liveUpdateMessage {color:#9b4b64;font-size:13px}
  `;

  document.head.appendChild(style);

  const bell = document.createElement("button");
  bell.id = "notificationBell";
  bell.type = "button";
  bell.className = "notification-bell";

  bell.innerHTML = `
    <span>🔔 Atendimentos de hoje</span>
    <span id="notificationCount" class="notification-count">0</span>
  `;

  document.querySelector(".nav").insertAdjacentElement("beforebegin", bell);
  bell.onclick = openDailyNotifications;

  const panel = document.createElement("div");
  panel.id = "futurePanel";
  panel.className = "panel";

  panel.innerHTML = `
    <h2>📅 Atendimentos futuros</h2>
    <p id="futureCount"></p>
    <div id="futureAppointmentsTable" class="table-wrap"></div>
    <p id="liveUpdateMessage" role="status"></p>
  `;

  $("dashboard").appendChild(panel);

  const heading = $("nextAppointments")?.closest(".panel")?.querySelector("h2");
  if (heading) heading.textContent = "Atendimentos de hoje";

  const freeCard = $("freeCount")?.closest(".card");

  if (freeCard?.querySelector(".label")) {
    freeCard.querySelector(".label").textContent = "Horários para agendar hoje";
  }

  if (freeCard?.querySelector(".small")) {
    freeCard.querySelector(".small").textContent = "Permite vários clientes por horário";
  }

  const dialog = document.createElement("dialog");
  dialog.id = "dailyDialog";
  dialog.setAttribute("aria-labelledby", "dailyTitle");

  dialog.innerHTML = `
    <h2 id="dailyTitle">🔔 Atendimentos de hoje</h2>
    <p id="dailySummary"></p>
    <div id="dailyTable" class="table-wrap"></div>
    <p>Os avisos são atualizados enquanto o sistema estiver aberto.</p>
    <div class="return-actions">
      <button type="button" id="dailyRefresh" class="btn primary">Atualizar</button>
      <button type="button" id="dailyClose" class="btn secondary">Fechar</button>
    </div>
  `;

  document.body.appendChild(dialog);
  $("dailyClose").onclick = () => dialog.close();

  $("dailyRefresh").onclick = async () => {
    $("dailyRefresh").disabled = true;
    try {
      await refreshData();
    } finally {
      $("dailyRefresh").disabled = false;
    }
  };

  const toast = document.createElement("div");
  toast.id = "dailyToast";
  toast.hidden = true;
  toast.setAttribute("role", "status");
  toast.setAttribute("aria-live", "polite");

  toast.innerHTML = `
    <p id="dailyToastText"></p>
    <div class="return-actions">
      <button type="button" id="toastView" class="btn primary btn-sm">
        Ver atendimentos
      </button>
      <button type="button" id="toastClose" class="btn secondary btn-sm">Fechar</button>
    </div>
  `;

  document.body.appendChild(toast);

  $("toastView").onclick = openDailyNotifications;
  $("toastClose").onclick = () => {
    toast.hidden = true;
    clearTimeout(toastTimer);
  };
}

function renderDailyUI() {
  if (
    !$("notificationBell") ||
    !currentUser ||
    currentUser.role === "cliente"
  ) return;

  const today = localDate();
  const list = todayAppointments();
  const future = futureAppointments();

  $("notificationCount").textContent = list.length;

  $("notificationBell").setAttribute(
    "aria-label", `${list.length} atendimento(s) pendente(s) hoje`
  );

  $("dailySummary").textContent =
    `${fmtDate(today)} · ${list.length} atendimento(s) pendente(s)`;

  $("dailyTable").innerHTML = list.length
    ? renderPeriodTable(list)
    : '<div class="empty">Nenhum atendimento pendente para hoje.</div>';

  $("futureCount").textContent =
    `${future.length} agendamento(s) futuro(s), em ordem de data.`;

  $("futureAppointmentsTable").innerHTML = future.length
    ? renderPeriodTable(future)
    : '<div class="empty">Nenhum agendamento futuro pendente.</div>';

  const ids = new Set(list.map(appointment => String(appointment.id)));
  const newDay = notificationDate !== today;
  const added = [...ids].some(id => !notifiedIds.has(id));

  if (list.length && (newDay || added)) {
    $("dailyToastText").textContent =
      `🔔 Você tem ${list.length} atendimento(s) para hoje, ${fmtDate(today)}.`;

    $("dailyToast").hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => $("dailyToast").hidden = true, 15000);
  }

  if (!list.length) $("dailyToast").hidden = true;

  notificationDate = today;
  notifiedIds = ids;
}

function openDailyNotifications() {
  if (!$("dailyDialog")) return;

  $("dailyToast").hidden = true;
  clearTimeout(toastTimer);

  if (!$("dailyDialog").open) $("dailyDialog").showModal();
  if (!refreshBusy) refreshData({ silent: true });
}

// =====================================================
// FILTROS POR PERÍODO
// =====================================================

function periodListAndTotals(start, end) {
  const list = appointments.filter(appointment =>
    validSales(appointment) &&
    appointment.date >= start &&
    appointment.date <= end
  ).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));

  const revenue = list.reduce(
    (total, appointment) => total + Number(appointment.price), 0
  );

  return {
    list,
    revenue,
    count: list.length,
    ticket: list.length ? revenue / list.length : 0
  };
}

function statusMarkup(appointment) {
  const label = appointment.status +
    (isReturn(appointment) && appointment.status !== "Retorno" ? " · Retorno" : "");

  return `<span class="badge ${badge(appointment.status)}">${esc(label)}</span>`;
}

function renderPeriodTable(list) {
  if (!list.length) {
    return '<div class="empty">Nenhum atendimento encontrado.</div>';
  }

  return `
    <table>
      <tr>
        <th>Data</th><th>Hora</th><th>Cliente</th><th>Procedimento</th>
        <th>Valor</th><th>Status</th><th>Ações</th>
      </tr>
      ${list.map(appointment => `
        <tr>
          <td>${fmtDate(appointment.date)}</td>
          <td>${esc(appointment.time)}</td>
          <td>${esc(appointment.name)}</td>
          <td>${esc(appointment.procedure)}</td>
          <td>${money(appointment.price)}</td>
          <td>${statusMarkup(appointment)}</td>
          <td>${appointmentActions(appointment)}</td>
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
    alert("A data inicial precisa ser anterior ou igual à data final.");
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
    alert("A data inicial precisa ser anterior ou igual à data final.");
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

function refreshVisibleFilters() {
  for (const [prefix, apply] of [
    ["dash", applyDashboardFilter],
    ["agenda", applyAgendaFilter]
  ]) {
    const start = $(prefix + "FilterStart")?.value;
    const end = $(prefix + "FilterEnd")?.value;
    if (start && end && start <= end) apply();
  }
}

// =====================================================
// AGENDA
// =====================================================

function setStatus(id, newStatus) {
  if (newStatus === "Retorno") {
    openReturnModal(id);
    return;
  }

  if (newStatus === "Cancelado" && !confirm("Cancelar este agendamento?")) return;

  api(`/api/appointments/${encodeURIComponent(id)}/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status: newStatus })
  })
    .then(() => refreshData())
    .catch(error => alert(error.message));
}

function appointmentActions(appointment) {
  const id = idArgument(appointment.id);

  return `
    <div class="return-actions">
      <button type="button" class="btn success btn-sm"
        onclick="setStatus(${id}, 'Confirmado')"
        ${appointment.status === "Confirmado" ? "disabled" : ""}>
        Confirmado
      </button>
      <button type="button" class="btn danger btn-sm"
        onclick="setStatus(${id}, 'Cancelado')"
        ${appointment.status === "Cancelado" ? "disabled" : ""}>
        Cancelado
      </button>
      <button type="button" class="btn primary btn-sm"
        onclick="openReturnModal(${id})"
        ${appointment.status === "Cancelado" ? "disabled" : ""}>
        🔄 Retorno
      </button>
    </div>
  `;
}

function renderAgenda() {
  const selectedDate = $("agendaDate")?.value || localDate();

  const list = appointments
    .filter(appointment => appointment.date === selectedDate)
    .sort((a, b) => a.time.localeCompare(b.time));

  const dayHours = openingSlots(openingHours, selectedDate);

  $("slots").innerHTML = dayHours.map(hour => {
    const group = list.filter(appointment =>
      appointment.time === hour && appointment.status !== "Cancelado"
    );

    return `
      <button type="button" class="slot free multi-slot"
        onclick="openModal('${selectedDate}', '${hour}')">
        <strong>${esc(hour)}</strong>
        <span>${group.length ? group.length + " agendamento(s)" : "Disponível"}</span>
        ${group.map(appointment => `
          <small>
            ${esc(appointment.name)}
            ${isReturn(appointment) ? " · Retorno" : ""}
          </small>
        `).join("")}
        <small>+ Agendar neste horário</small>
      </button>
    `;
  }).join("") || `
    <div class="empty">Nenhum horário de atendimento disponível nesta data.</div>
  `;

  $("dayTable").innerHTML = list.length
    ? `
      <table>
        <tr>
          <th>Hora</th><th>Cliente</th><th>Foto</th><th>Procedimento</th>
          <th>Valor</th><th>Status</th><th>Obs.</th><th>Ações</th>
        </tr>
        ${list.map(appointment => {
          const client = clients.find(item => item.phone === appointment.phone);
          return `
            <tr>
              <td><b>${esc(appointment.time)}</b></td>
              <td>${esc(appointment.name)}<br><small>${esc(appointment.phone)}</small></td>
              <td>${
                client?.photo
                  ? `<img src="${esc(client.photo)}" class="client-photo" alt="Foto do cliente">`
                  : "<small>Sem foto</small>"
              }</td>
              <td>${esc(appointment.procedure)}</td>
              <td>${money(appointment.price)}</td>
              <td>${statusMarkup(appointment)}</td>
              <td>${esc(appointment.note || "-")}</td>
              <td>${appointmentActions(appointment)}</td>
            </tr>
          `;
        }).join("")}
      </table>
    `
    : '<div class="empty">Nenhum agendamento para esta data.</div>';
}

function badge(status) {
  return {
    Agendado: "b-agendado",
    Confirmado: "b-confirmado",
    Atendido: "b-atendido",
    Cancelado: "b-cancelado",
    Retorno: "b-retorno"
  }[status] || "b-agendado";
}

function changeDay(numberOfDays) {
  const date = new Date(($("agendaDate").value || localDate()) + "T12:00:00");
  date.setDate(date.getDate() + numberOfDays);
  $("agendaDate").value = date.toISOString().slice(0, 10);
  renderAgenda();
}

function goToday() {
  if ($("agendaDate")) $("agendaDate").value = localDate();
  renderAgenda();
}

// =====================================================
// CLIENTES
// =====================================================

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
    $("clientPhone").value = $("clientPhone").value.replace(/\D/g, "");
  });
}

$("clientForm").addEventListener("submit", async event => {
  event.preventDefault();

  try {
    const form = new FormData();
    form.append("name", $("clientName").value.trim());
    form.append("phone", $("clientPhone").value.trim());
    form.append("note", $("clientNote").value.trim());

    if ($("clientPhoto").files[0]) form.append("photo", $("clientPhoto").files[0]);

    await api("/api/clients", { method: "POST", body: form });

    closeClientModal();
    await refreshData();
    alert("Cliente salvo com sucesso!");
  } catch (error) {
    alert(error.message);
  }
});

async function downloadClientPhoto(id) {
  const client = clients.find(item => String(item.id) === String(id));

  if (!client?.photo) {
    alert("Este cliente não tem foto cadastrada.");
    return;
  }

  try {
    const response = await fetch(client.photo, {
      credentials: "same-origin",
      cache: "no-store"
    });

    if (!response.ok) {
      throw new Error("Não foi possível obter a foto (HTTP " + response.status + ").");
    }

    const blob = await response.blob();
    const mime = blob.type.split(";")[0].toLowerCase();

    if (!mime.startsWith("image/") || !blob.size) {
      throw new Error("O servidor não devolveu uma imagem válida.");
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
      .trim().replace(/[^a-zA-Z0-9À-ÿ_-]+/g, "_") || "cliente";

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${name}.${extension}`;
    document.body.appendChild(link);
    link.click();
    link.remove();

    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (error) {
    alert(error.message || "Não foi possível baixar a foto.");
  }
}

function renderClients() {
  const search = ($("clientSearch").value || "").toLowerCase();

  const filteredClients = clients.filter(client =>
    (client.name + client.phone).toLowerCase().includes(search)
  );

  $("clientTable").innerHTML = filteredClients.length
    ? `
      <table>
        <tr>
          <th>Cliente</th><th>Contato</th><th>Atendimentos</th><th>Total</th>
          <th>Último atendimento</th><th>Observação</th><th>Ações</th>
        </tr>
        ${filteredClients.map(client => `
          <tr>
            <td>
              ${client.photo
                ? `<img class="client-photo" src="${esc(client.photo)}" alt="Foto do cliente">`
                : ""}
              <b>${esc(client.name)}</b>
            </td>
            <td>${esc(client.phone)}</td>
            <td>${client.count}</td>
            <td>${money(client.total)}</td>
            <td>${client.last ? fmtDate(client.last) : "—"}</td>
            <td>${esc(client.note || "-")}</td>
            <td>
              <div class="return-actions">
                <button type="button" class="btn primary btn-sm"
                  onclick="openClientAppointment(${idArgument(client.id)})">
                  + Novo agendamento
                </button>
                <button type="button" class="btn secondary btn-sm"
                  onclick="openClientReturn(${idArgument(client.id)})">
                  🔄 Retorno
                </button>
                ${client.photo ? `
                  <button type="button" class="btn secondary btn-sm"
                    onclick="downloadClientPhoto(${idArgument(client.id)})">
                    ⬇️ Baixar foto
                  </button>
                ` : ""}
                ${currentUser?.role === "admin" ? `
                  <button type="button" class="btn danger btn-sm"
                    onclick="removeClient(${idArgument(client.id)})">
                    Remover
                  </button>
                ` : ""}
              </div>
            </td>
          </tr>
        `).join("")}
      </table>
    `
    : '<div class="empty">Nenhum cliente encontrado.</div>';
}

async function removeClient(id) {
  if (!confirm(
    "Excluir definitivamente este cliente e todos os seus " +
    "agendamentos, retornos e atendimentos? Os valores também " +
    "serão removidos dos relatórios."
  )) return;

  try {
    await api(`/api/clients/${encodeURIComponent(id)}`, { method: "DELETE" });
    await refreshData();
  } catch (error) {
    alert(error.message);
  }
}

// =====================================================
// ATENDIMENTOS E RETORNOS
// =====================================================

function isReturn(appointment) {
  return Boolean(
    appointment.isReturn ||
    appointment.originalAppointmentId ||
    appointment.status === "Retorno"
  );
}

function mountReturnUI() {
  if ($("returnDialog")) return;

  const style = document.createElement("style");

  style.textContent = `
    .b-retorno {background:#eee3ff;color:#66359a}
    .return-actions {display:flex;gap:8px;flex-wrap:wrap;margin:8px 0}
    .return-actions button {white-space:nowrap}
    #openingHoursPanel[hidden],#editAvailableHours[hidden] {display:none!important}
    #openingHoursDays {
      display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px;
    }
    .attendance-row {
      display:flex;gap:10px;align-items:end;padding:10px;
      border:1px solid #f1d7dc;border-radius:10px;
    }
    .attendance-row label {flex:1;min-width:0}
    .attendance-row input {width:100%;box-sizing:border-box}
    #returnDialog {
      width:min(600px,calc(100vw - 32px));max-height:90vh;overflow:auto;
      box-sizing:border-box;padding:24px;border:1px solid #f1d7dc;
      border-radius:18px;color:#302c38;background:white;
    }
    #returnDialog::backdrop {background:rgba(35,20,30,.45)}
    #returnDialog h2 {margin:0 0 8px}
    #returnClientLabel {color:#7a6570}
    #returnFields {border:0;padding:0;margin:0;min-width:0}
    .return-grid {display:grid;grid-template-columns:1fr 1fr;gap:14px}
    .return-grid label {display:grid;gap:6px;font-size:14px}
    .return-full {grid-column:1/-1}
    .return-grid input,.return-grid select,.return-grid textarea {
      width:100%;box-sizing:border-box;padding:12px;border:1px solid #e8cbd3;
      border-radius:9px;font:inherit;background:white;color:inherit;
    }
    #returnMessage {min-height:22px;color:#a12442;margin:12px 0}
    #returnDialog button:disabled {opacity:.55;cursor:wait}
    #atendimentos table {min-width:780px}
    #atendimentos .filters {display:flex;gap:12px;flex-wrap:wrap;margin-bottom:16px}
    #atendimentos .filters input,#atendimentos .filters select {
      padding:12px;border:1px solid #efd1d9;border-radius:9px;
    }
    @media(max-width:600px) {
      .return-grid {grid-template-columns:1fr}
      #returnDialog {padding:18px}
      .return-actions .btn {padding:9px}
    }
  `;

  document.head.appendChild(style);

  const section = document.createElement("section");
  section.id = "atendimentos";
  section.className = "section";

  section.innerHTML = `
    <div class="top">
      <div>
        <h1>Atendimentos e retornos</h1>
        <p>Confirme, cancele ou escolha a data do próximo atendimento.</p>
      </div>
    </div>
    <div class="panel">
      <div class="filters">
        <input id="attendanceSearch" type="search"
          placeholder="Buscar cliente ou procedimento" aria-label="Buscar atendimento">
        <select id="attendanceFilter" aria-label="Filtrar atendimentos">
          <option value="">Todos</option>
          <option value="Retorno">Retornos</option>
          <option value="Confirmado">Confirmados</option>
          <option value="Cancelado">Cancelados</option>
        </select>
      </div>
      <div id="attendanceTable" class="table-wrap"></div>
    </div>
  `;

  $("agenda").insertAdjacentElement("afterend", section);
  $("attendanceSearch").addEventListener("input", renderAttendances);
  $("attendanceFilter").addEventListener("change", renderAttendances);

  const dialog = document.createElement("dialog");
  dialog.id = "returnDialog";
  dialog.setAttribute("aria-labelledby", "returnTitle");

  dialog.innerHTML = `
    <h2 id="returnTitle">🔄 Agendar retorno</h2>
    <p id="returnClientLabel"></p>
    <form id="returnForm">
      <fieldset id="returnFields">
        <div class="return-grid">
          <label class="return-full">
            Atendimento original
            <select id="returnOriginal" required></select>
          </label>
          <label class="return-full">
            Procedimento
            <select id="returnProcedure" required></select>
          </label>
          <label>
            Data do retorno
            <input id="returnDate" type="date" required>
          </label>
          <label>
            Horário
            <select id="returnTime" required>
              <option value="">Escolha a data</option>
            </select>
          </label>
          <label>
            Valor (R$)
            <input id="returnPrice" type="number" min="0"
              max="99999999.99" step="0.01" required>
          </label>
          <label class="return-full">
            Observação
            <textarea id="returnNote" rows="3"
              placeholder="Orientações para o retorno"></textarea>
          </label>
        </div>
      </fieldset>
      <div id="returnMessage" role="status" aria-live="polite"></div>
      <div class="return-actions">
        <button id="returnClose" type="button" class="btn secondary">Fechar</button>
        <button id="returnSave" type="submit" class="btn primary">Agendar retorno</button>
      </div>
    </form>
  `;

  document.body.appendChild(dialog);
  $("returnClose").onclick = closeReturnModal;

  dialog.addEventListener("cancel", event => {
    if (returnSaving) event.preventDefault();
  });

  dialog.addEventListener("close", () => {
    returnSlotsRequestId++;
    returnSlotsReady = false;
  });

  $("returnOriginal").addEventListener("change", selectReturnSource);
  $("returnDate").addEventListener("change", loadReturnSlots);

  $("returnProcedure").addEventListener("change", () => {
    const procedure = procedures.find(
      item => String(item.id) === $("returnProcedure").value
    );
    $("returnPrice").value = procedure ? procedure.price : "";
  });

  $("returnForm").addEventListener("submit", saveReturn);
}

function renderAttendances() {
  if (!$("attendanceTable")) return;

  const search = $("attendanceSearch").value.trim().toLowerCase();
  const status = $("attendanceFilter").value;

  const list = appointments.filter(appointment => {
    const matchesSearch =
      `${appointment.name} ${appointment.phone} ${appointment.procedure}`
        .toLowerCase().includes(search);

    const matchesStatus =
      !status ||
      (status === "Retorno"
        ? isReturn(appointment)
        : appointment.status === status);

    return matchesSearch && matchesStatus;
  }).sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time));

  $("attendanceTable").innerHTML = renderPeriodTable(list);
}

function openReturnModal(id) {
  mountReturnUI();

  const source = appointments.find(
    appointment => String(appointment.id) === String(id)
  );

  if (!source || source.status === "Cancelado") {
    alert("Escolha um atendimento que não esteja cancelado.");
    return;
  }

  showReturnSources([source]);
}

function openClientReturn(id) {
  mountReturnUI();

  const client = clients.find(item => String(item.id) === String(id));
  if (!client) return;

  const sources = appointments.filter(appointment =>
    appointment.status !== "Cancelado" &&
    (appointment.clientId
      ? String(appointment.clientId) === String(client.id)
      : appointment.phone === client.phone)
  ).sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time));

  if (!sources.length) {
    alert(
      "Este cliente ainda não possui um atendimento para vincular o retorno. " +
      "Use o botão Novo agendamento para marcar o primeiro atendimento."
    );
    return;
  }

  showReturnSources(sources);
}

function showReturnSources(sources) {
  if (returnSaving) return;
  if ($("dailyDialog")?.open) $("dailyDialog").close();

  $("returnForm").reset();
  $("returnFields").disabled = false;

  $("returnOriginal").innerHTML = sources.map(appointment => `
    <option value="${esc(appointment.id)}">
      ${fmtDate(appointment.date)} às ${esc(appointment.time)}
      — ${esc(appointment.procedure)}
    </option>
  `).join("");

  fillProcedureSelect($("returnProcedure"), true);

  if (!$("returnDialog").open) $("returnDialog").showModal();
  selectReturnSource();
}

function selectReturnSource() {
  const source = appointments.find(
    appointment => String(appointment.id) === $("returnOriginal").value
  );
  if (!source) return;

  $("returnClientLabel").textContent = `${source.name} · ${source.phone}`;
  $("returnProcedure").value = String(source.procedureId);

  const procedure = procedures.find(
    item => String(item.id) === $("returnProcedure").value
  );

  $("returnPrice").value = procedure ? procedure.price : "";

  const minimum = source.date > localDate() ? source.date : localDate();
  $("returnDate").min = minimum;
  $("returnDate").value = minimum;
  $("returnNote").value = "";

  loadReturnSlots();
}

async function loadReturnSlots() {
  const requestId = ++returnSlotsRequestId;
  returnSlotsReady = false;

  $("returnSave").disabled = true;
  $("returnTime").innerHTML = '<option value="">Carregando horários...</option>';
  $("returnMessage").textContent = "";

  const date = $("returnDate").value;
  const source = appointments.find(
    appointment => String(appointment.id) === $("returnOriginal").value
  );

  if (!source || !date || date < $("returnDate").min) {
    $("returnTime").innerHTML = '<option value="">Escolha uma data válida</option>';
    return;
  }

  try {
    const data = await api("/api/public/slots?date=" + encodeURIComponent(date));

    if (requestId !== returnSlotsRequestId || !$("returnDialog").open) return;

    const slots = (data.slots || []).filter(
      time => date !== source.date || time > source.time
    );

    $("returnTime").innerHTML =
      '<option value="">Selecione</option>' +
      slots.map(time => `<option value="${esc(time)}">${esc(time)}</option>`).join("");

    returnSlotsReady = slots.length > 0;
    $("returnSave").disabled = !returnSlotsReady || returnSaving;

    if (!slots.length) {
      $("returnMessage").textContent =
        "Nenhum horário disponível nesta data. Escolha outro dia.";
    }
  } catch (error) {
    if (requestId !== returnSlotsRequestId) return;

    $("returnTime").innerHTML = '<option value="">Horários indisponíveis</option>';
    $("returnMessage").textContent = error.message + " Selecione a data novamente.";
  }
}

async function saveReturn(event) {
  event.preventDefault();

  if (returnSaving || !returnSlotsReady || !$("returnForm").reportValidity()) return;

  const id = $("returnOriginal").value;
  const payload = {
    date: $("returnDate").value,
    time: $("returnTime").value,
    procedureId: $("returnProcedure").value,
    price: $("returnPrice").value,
    note: $("returnNote").value.trim()
  };

  returnSaving = true;
  $("returnFields").disabled = true;
  $("returnSave").disabled = true;
  $("returnClose").disabled = true;
  $("returnSave").textContent = "Salvando...";
  $("returnMessage").textContent = "";

  try {
    await api("/api/appointments/" + encodeURIComponent(id) + "/return", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    $("returnDialog").close();
    await refreshData();
    showSection("atendimentos");

    alert(`Retorno agendado para ${fmtDate(payload.date)} às ${payload.time}.`);
  } catch (error) {
    $("returnMessage").textContent = error.message;
  } finally {
    returnSaving = false;
    $("returnFields").disabled = false;
    $("returnSave").disabled = !returnSlotsReady;
    $("returnClose").disabled = false;
    $("returnSave").textContent = "Agendar retorno";
  }
}

function closeReturnModal() {
  if (!returnSaving) $("returnDialog").close();
}

// =====================================================
// PROCEDIMENTOS
// =====================================================

function readProcedurePrice(value) {
  const text = String(value ?? "").trim().replace(",", ".");
  if (!/^\d{1,8}(\.\d{1,2})?$/.test(text)) return null;

  const price = Number(text);
  return Number.isFinite(price) && price <= 99999999.99 ? price : null;
}

async function addProcedure() {
  const name = $("procName").value.trim();
  const price = readProcedurePrice($("procPrice").value);

  if (!name || name.length > 150) {
    alert("Informe um nome de até 150 caracteres.");
    return;
  }

  if (price === null) {
    alert("Informe um valor válido, como 40 ou 40,50.");
    return;
  }

  try {
    await api("/api/procedures", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, price })
    });

    $("procName").value = "";
    $("procPrice").value = "";
    await refreshData();
  } catch (error) {
    alert(error.message);
  }
}

async function editProcedurePrice(id) {
  const procedure = procedures.find(item => String(item.id) === String(id));
  if (!procedure) return;

  const value = prompt(
    'Novo valor de "' + procedure.name + '" (R$):',
    Number(procedure.price).toFixed(2).replace(".", ",")
  );

  if (value === null) return;

  const price = readProcedurePrice(value);

  if (price === null) {
    alert("Informe um valor válido, como 40 ou 40,50.");
    return;
  }

  try {
    await api("/api/procedures/" + encodeURIComponent(id) + "/price", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ price })
    });

    await refreshData();
    alert("Valor atualizado! O novo preço será usado nos próximos agendamentos.");
  } catch (error) {
    alert(error.message);
  }
}

async function removeProcedure(id) {
  if (!confirm(
    "Remover este procedimento? Os agendamentos já feitos serão mantidos."
  )) return;

  try {
    await api("/api/procedures/" + encodeURIComponent(id), { method: "DELETE" });
    await refreshData();
  } catch (error) {
    alert(error.message);
  }
}

function renderProcedures() {
  $("procedureTable").innerHTML = procedures.length
    ? `
      <table>
        <tr><th>Procedimento</th><th>Valor padrão</th><th>Ações</th></tr>
        ${procedures.map(procedure => `
          <tr>
            <td>${esc(procedure.name)}</td>
            <td>${money(procedure.price)}</td>
            <td>
              <button type="button" class="btn secondary btn-sm"
                onclick="editProcedurePrice(${idArgument(procedure.id)})">
                Alterar valor
              </button>
              <button type="button" class="btn danger btn-sm"
                onclick="removeProcedure(${idArgument(procedure.id)})">
                Remover
              </button>
            </td>
          </tr>
        `).join("")}
      </table>
    `
    : '<div class="empty">Nenhum procedimento cadastrado.</div>';
}

// =====================================================
// RELATÓRIOS
// =====================================================

function updateReportPeriod(start, end) {
  const result = periodListAndTotals(start, end);

  $("filteredRevenue").textContent = money(result.revenue);
  $("filteredCount").textContent = result.count;
  $("filteredTicket").textContent = money(result.ticket);

  const proceduresMap = {};

  result.list.forEach(appointment => {
    const procedure = appointment.procedure || "Sem procedimento";
    proceduresMap[procedure] = (proceduresMap[procedure] || 0) + 1;
  });

  const rows = Object.entries(proceduresMap).sort((a, b) => b[1] - a[1]);
  const maximum = rows[0]?.[1] || 1;
  const label = `${fmtDate(start)} até ${fmtDate(end)}`;

  $("procedureReport").innerHTML = `
    <p style="color:var(--muted)">Período: <b>${esc(label)}</b></p>
  ` + (
    rows.length
      ? rows.map(([procedure, count]) => `
        <div style="margin:14px 0">
          <div style="display:flex;justify-content:space-between;margin-bottom:6px">
            <span>${esc(procedure)}</span><b>${count}</b>
          </div>
          <div class="bar"><i style="width:${count / maximum * 100}%"></i></div>
        </div>
      `).join("")
      : '<div class="empty">Não há atendimentos no período selecionado.</div>'
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
    alert("A data inicial precisa ser anterior ou igual à data final.");
    return;
  }

  updateReportPeriod(start, end);
}

function clearReportFilter() {
  const today = localDate();
  $("reportStartDate").value = today.slice(0, 7) + "-01";
  $("reportEndDate").value = monthEnd(today);
  updateReportPeriod($("reportStartDate").value, $("reportEndDate").value);
}

async function renderReports() {
  if (currentUser?.role !== "admin") return;

  try {
    const summary = await api("/api/reports/summary");
    $("rToday").textContent = money(summary.today.revenue);
    $("rMonth").textContent = money(summary.month.revenue);
    $("rYear").textContent = money(summary.year.revenue);

    const start = $("reportStartDate").value;
    const end = $("reportEndDate").value;

    if (start && end && start <= end) updateReportPeriod(start, end);
  } catch (error) {
    console.error("Erro ao carregar relatórios:", error);
  }
}

async function downloadReportPDF(type) {
  try {
    const start = $("reportStartDate").value || localDate();
    const end = $("reportEndDate").value || localDate();
    const params = { type };

    if (type === "day") params.date = end;
    if (type === "month") params.month = start.slice(0, 7);
    if (type === "year") params.year = start.slice(0, 4);

    const response = await fetch(
      "/api/reports/pdf?" + new URLSearchParams(params),
      { credentials: "include" }
    );

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || "Não foi possível gerar o PDF.");
    }

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `Relatorio_${type}.pdf`;

    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (error) {
    alert(error.message);
  }
}

// =====================================================
// ALTERAÇÃO DE SENHA
// =====================================================

async function changePassword(event) {
  event.preventDefault();

  const currentPassword = $("currentPassword").value;
  const newPassword = $("newPassword").value;
  const confirmPassword = $("confirmPassword").value;
  const message = $("passwordMessage");

  message.textContent = "";
  message.style.color = "var(--danger)";

  if (!currentPassword || !newPassword || !confirmPassword) {
    message.textContent = "Preencha todos os campos.";
    return;
  }

  if (newPassword !== confirmPassword) {
    message.textContent = "A nova senha e a confirmação não são iguais.";
    return;
  }

  if (newPassword.length < 6) {
    message.textContent = "A nova senha deve ter pelo menos 6 caracteres.";
    return;
  }

  if (currentPassword === newPassword) {
    message.textContent = "A nova senha deve ser diferente da senha atual.";
    return;
  }

  try {
    const result = await api("/api/auth/password", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword, newPassword, confirmPassword })
    });

    message.style.color = "var(--success)";
    message.textContent = result.message || "Senha alterada com sucesso!";
    $("passwordForm").reset();
  } catch (error) {
    message.textContent = error.message;
  }
}

function clearPasswordForm() {
  $("passwordForm").reset();
  $("passwordMessage").textContent = "";
}

// =====================================================
// AGENDAMENTO PÚBLICO
// =====================================================

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
  $("cbSlots").innerHTML = '<div class="empty">Carregando horários...</div>';

  const requestId = ++clientSlotsRequestId;

  try {
    const data = await api("/api/public/slots?date=" + encodeURIComponent(date));
    if (requestId !== clientSlotsRequestId) return;

    selectedSlot = "";

    $("cbSlots").innerHTML = (data.slots || []).map(hour => {
      const count = Number(data.bookingsByTime?.[hour]) || 0;

      return `
        <button type="button" class="slot free multi-slot"
          data-time="${esc(hour)}" onclick="pickSlot(${idArgument(hour)})">
          <strong>${esc(hour)}</strong>
          <span>Disponível</span>
          <small>${
            count
              ? count + " agendamento(s) · aceita novas reservas"
              : "Clique para escolher"
          }</small>
        </button>
      `;
    }).join("") || `
      <div class="empty">
        Nenhum horário disponível nesta data. Escolha outro dia.
      </div>
    `;
  } catch (error) {
    if (requestId !== clientSlotsRequestId) return;

    $("cbSlots").innerHTML = `
      <div class="empty">
        Não foi possível carregar os horários. Selecione a data novamente.
      </div>
    `;
    alert(error.message);
  }
}

function pickSlot(hour) {
  selectedSlot = hour;
  document.querySelectorAll("#cbSlots .slot").forEach(element => {
    element.classList.toggle("selected", element.dataset.time === hour);
  });
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

$("cbPhone").type = "tel";
$("cbPhone").inputMode = "numeric";
$("cbPhone").maxLength = 11;
$("cbPhone").placeholder = "85999999999";

$("cbPhone").addEventListener("input", () => {
  $("cbPhone").value = $("cbPhone").value.replace(/\D/g, "").slice(0, 11);
});

$("clientBookingForm").addEventListener("submit", async event => {
  event.preventDefault();

  if (!selectedSlot) {
    alert("Escolha um horário disponível.");
    return;
  }

  if (publicBookingSaving) return;
  publicBookingSaving = true;

  const submit = event.currentTarget.querySelector(
    'button[type="submit"], button:not([type])'
  );
  if (submit) submit.disabled = true;

  try {
    const form = new FormData();
    form.append("name", $("cbName").value.trim());
    form.append("phone", $("cbPhone").value.trim());
    form.append("date", $("cbDate").value);
    form.append("time", selectedSlot);
    form.append("procedureId", $("clientProcedure").value);
    form.append("note", $("cbNote").value.trim());

    if ($("cbPhoto").files[0]) form.append("photo", $("cbPhoto").files[0]);

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
  } finally {
    publicBookingSaving = false;
    if (submit) submit.disabled = false;
  }
});

function newClientBooking() {
  initClientPage();
}

// =====================================================
// TEMA CLARO / ESCURO
// =====================================================

const themeStorageKey = "agendapro.theme";
let preferredTheme = null;

const themeMedia = window.matchMedia
  ? window.matchMedia("(prefers-color-scheme: dark)")
  : null;

function applyTheme(theme, save = false) {
  const dark = theme === "dark";

  document.documentElement.dataset.theme = dark ? "dark" : "light";
  document.documentElement.style.colorScheme = dark ? "dark" : "light";

  if (save) {
    preferredTheme = dark ? "dark" : "light";
    try {
      localStorage.setItem(themeStorageKey, preferredTheme);
    } catch {
      // O tema continua funcionando se o armazenamento estiver bloqueado.
    }
  }

  document.querySelectorAll(".theme-toggle").forEach(button => {
    button.textContent = dark ? "☀️ Tema claro" : "🌙 Tema escuro";
    button.setAttribute(
      "aria-label",
      dark ? "Ativar tema claro" : "Ativar tema escuro"
    );
    button.setAttribute("aria-pressed", String(dark));
    button.title = dark ? "Mudar para tema claro" : "Mudar para tema escuro";
  });

  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = dark ? "#171b24" : "#a94f6e";
}

function mountThemeUI() {
  if ($("agendaThemeStyles")) return;

  const style = document.createElement("style");
  style.id = "agendaThemeStyles";

  style.textContent = `
    .theme-toggle {
      display:inline-flex;
      align-items:center;
      justify-content:center;
      gap:8px;
      min-height:44px;
      padding:10px 14px;
      border:1px solid var(--border,#e1cdd4);
      border-radius:12px;
      background:var(--card,#fff);
      color:var(--text,#372c35);
      font:inherit;
      font-size:14px;
      font-weight:650;
      cursor:pointer;
    }

    .theme-toggle:focus-visible {
      outline:3px solid #b05c7e;
      outline-offset:3px;
    }

    .theme-sidebar {
      display:flex;
      justify-content:stretch;
      margin:12px 0;
    }

    .theme-sidebar .theme-toggle {width:100%}

    .theme-public {
      display:flex;
      justify-content:flex-end;
      padding:12px 18px;
    }

    #authScreen {
      position:relative;
      padding-top:76px;
      box-sizing:border-box;
    }

    .theme-auth {
      position:absolute;
      right:18px;
      top:18px;
      z-index:2;
    }

    .booking-client-notice {
      padding:12px 14px;
      border:1px solid var(--border,#e1cdd4);
      background:var(--bg,#fdf6f4);
      color:var(--text,#372c35);
      border-radius:10px;
      line-height:1.5;
    }

    .booking-client-notice[hidden] {display:none!important}

    #appointmentForm input[readonly] {
      opacity:1;
      background:var(--bg,#f4f1f3);
      color:var(--text,#372c35);
      cursor:default;
    }

    html[data-theme="dark"] {
      --bg:#11151c;
      --card:#1c222d;
      --surface:#1c222d;
      --surface-soft:#252d3a;
      --text:#edf0f7;
      --muted:#bbc2d0;
      --primary:#a94f6e;
      --primary2:#c9678b;
      --border:#414b5e;
      --success:#8cdbb2;
      --danger:#ff9caf;
      --warning:#f1cb83;
      --sbar-bg:#171d27;
      --sbar-text:#d1d7e3;
      --sbar-active-bg:#403043;
      --sbar-active-text:#ffe2ed;
      --sbar-border:#414b5e;
      --sidebar-bg:#171d27;
      --shadow:0 8px 30px #0004;
      color-scheme:dark;
    }

    html[data-theme="dark"] body,
    html[data-theme="dark"] #app,
    html[data-theme="dark"] main,
    html[data-theme="dark"] .main,
    html[data-theme="dark"] #clientPage {
      background:#11151c!important;
      color:#edf0f7!important;
    }

    html[data-theme="dark"] #authScreen {
      background:linear-gradient(135deg,#141924,#302338)!important;
      color:#edf0f7!important;
    }

    html[data-theme="dark"] :is(
      .authBox,.auth-box,.auth-card,.auth-shell,.auth-panel,
      .auth-form,.auth-form-panel,.login-card,.panel,.card,
      .modal-box,.modal-content,.modalBox,.client-card,
      .booking-card,.clientBox,dialog,#dailyToast
    ) {
      background:#1c222d!important;
      color:#edf0f7!important;
      border-color:#414b5e!important;
    }

    html[data-theme="dark"] :is(
      .sidebar,aside,.app-header,.topbar,.top-bar,.header,.mobile-header
    ) {
      background:#171d27!important;
      color:#edf0f7!important;
      border-color:#414b5e!important;
    }

    html[data-theme="dark"] :is(
      h1,h2,h3,h4,label,.brand,.authLogo,.value,.stat-value
    ) {
      color:#edf0f7;
    }

    html[data-theme="dark"] :is(
      .muted,.small,.label,.empty,.authSub,.auth-subtitle,
      .subtitle,.top p,.section-heading p,small,#futureCount,#returnClientLabel
    ) {
      color:#bbc2d0!important;
    }

    html[data-theme="dark"] :is(
      .role-btn,.roleBtn,.role-card,.role-option,
      .role-button,.notification-bell,.theme-toggle
    ) {
      background:#252d3a!important;
      color:#edf0f7!important;
      border-color:#505d73!important;
    }

    html[data-theme="dark"] :is(input,select,textarea) {
      background:#141a24!important;
      color:#edf0f7!important;
      border-color:#59657b!important;
    }

    html[data-theme="dark"] :is(input,textarea)::placeholder {
      color:#a8b3c7!important;
      opacity:1;
    }

    html[data-theme="dark"] :is(input,select,textarea):focus {
      outline:2px solid #f0a6c2;
      outline-offset:2px;
    }

    html[data-theme="dark"] input[readonly] {
      background:#293241!important;
    }

    html[data-theme="dark"] :is(
      .btn.secondary,.btn.ghost,.btn.outline,.icon-btn,.close-btn
    ) {
      background:#30394a!important;
      color:#edf0f7!important;
      border-color:#59657b!important;
    }

    html[data-theme="dark"] .btn.primary {
      background:#a04467!important;
      color:#fff!important;
      border-color:#cb7c9a!important;
    }

    html[data-theme="dark"] .btn.success {
      background:#285b46!important;
      color:#edfff6!important;
      border-color:#6aa887!important;
    }

    html[data-theme="dark"] .btn.danger {
      background:#813448!important;
      color:#fff!important;
      border-color:#c9778a!important;
    }

    html[data-theme="dark"] :is(
      .nav button,.sidebar-bottom button,#configNavBtn
    ) {
      color:#d1d7e3!important;
    }

    html[data-theme="dark"] :is(
      .nav button.active,.nav button:hover,#configNavBtn.active
    ) {
      background:#403043!important;
      color:#ffe2ed!important;
    }

    html[data-theme="dark"] :is(table,tbody,tr,td) {
      background:transparent;
      color:#edf0f7;
      border-color:#414b5e!important;
    }

    html[data-theme="dark"] th {
      background:#252d3a!important;
      color:#d1d7e3!important;
      border-color:#414b5e!important;
    }

    html[data-theme="dark"] tr:hover td {
      background:#252d3a!important;
    }

    html[data-theme="dark"] :is(.slot,.slot.free) {
      background:#1d352e!important;
      color:#d8f5e7!important;
      border-color:#487462!important;
    }

    html[data-theme="dark"] .slot.busy {
      background:#402b36!important;
      color:#ffdde8!important;
    }

    html[data-theme="dark"] .slot.selected {
      background:#43314e!important;
      color:#fff!important;
      outline:3px solid #dba0ec!important;
    }

    html[data-theme="dark"] :is(.b-agendado,.badge.b-agendado) {
      background:#45303e!important;
      color:#ffdbeb!important;
    }

    html[data-theme="dark"] :is(.b-confirmado,.badge.b-confirmado) {
      background:#254c3b!important;
      color:#c5f6dd!important;
    }

    html[data-theme="dark"] :is(.b-cancelado,.badge.b-cancelado) {
      background:#582d3b!important;
      color:#ffd1dc!important;
    }

    html[data-theme="dark"] :is(.b-atendido,.badge.b-atendido) {
      background:#4a4026!important;
      color:#ffe6ad!important;
    }

    html[data-theme="dark"] :is(.b-retorno,.badge.b-retorno) {
      background:#45315d!important;
      color:#ebd3ff!important;
    }

    html[data-theme="dark"] :is(.attendance-row,.booking-client-notice) {
      background:#252d3a!important;
      color:#edf0f7!important;
      border-color:#505d73!important;
    }

    html[data-theme="dark"] :is(#returnMessage,#liveUpdateMessage,#loginError) {
      color:#ffafc1!important;
    }

    html[data-theme="dark"] .bar {
      background:#30394a!important;
    }

    html[data-theme="dark"] dialog::backdrop {
      background:#0009;
    }

    @media(max-width:600px) {
      .theme-auth {top:12px;right:12px}
      .theme-toggle {font-size:13px}
      .theme-public {padding:10px 12px}
    }
  `;

  document.head.appendChild(style);

  const addButton = (parent, className, before = null) => {
    if (!parent) return;

    const host = document.createElement("div");
    host.className = className;

    const button = document.createElement("button");
    button.type = "button";
    button.className = "theme-toggle";

    button.onclick = () => {
      applyTheme(
        document.documentElement.dataset.theme === "dark" ? "light" : "dark",
        true
      );
    };

    host.appendChild(button);

    if (before) {
      parent.insertBefore(host, before);
    } else {
      parent.prepend(host);
    }
  };

  addButton($("authScreen"), "theme-auth");

  const nav = document.querySelector(".nav");
  if (nav) addButton(nav.parentElement, "theme-sidebar", nav);

  addButton($("clientPage"), "theme-public");

  try {
    const saved = localStorage.getItem(themeStorageKey);
    if (saved === "dark" || saved === "light") preferredTheme = saved;
  } catch {
    // Sem armazenamento, usa a preferência do aparelho.
  }

  applyTheme(preferredTheme || (themeMedia?.matches ? "dark" : "light"));

  const followSystem = event => {
    if (!preferredTheme) applyTheme(event.matches ? "dark" : "light");
  };

  if (themeMedia?.addEventListener) {
    themeMedia.addEventListener("change", followSystem);
  }

  window.addEventListener("storage", event => {
    if (event.key !== themeStorageKey && event.key !== null) return;

    preferredTheme =
      event.newValue === "dark" || event.newValue === "light"
        ? event.newValue
        : null;

    applyTheme(preferredTheme || (themeMedia?.matches ? "dark" : "light"));
  });
}

// =====================================================
// INICIALIZAÇÃO FINAL
// =====================================================

function bindPasswordForm() {
  const form = $("passwordForm");

  if (form && !form.dataset.bound) {
    form.dataset.bound = "true";
    form.addEventListener("submit", changePassword);
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bindPasswordForm);
} else {
  bindPasswordForm();
}

async function boot() {
  try {
    const data = await api("/api/auth/me");
    currentUser = data.user;
    enterApp();
  } catch {
    $("authScreen").style.display = "flex";
  }
}

mountThemeUI();
boot();