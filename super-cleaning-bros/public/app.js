const START_MIN = 7 * 60;
const END_MIN = 19 * 60;
const HOUR_PX = 48;
const CREW_COLORS = ["#1f6b45", "#3e6b4f", "#8a6230", "#6b4e62", "#3f5d57", "#8d5a3c"];

const state = {
  health: null,
  authRequired: false,
  session: null,
  view: "home",
  returnView: "schedule",
  error: "",
  notice: "",
  technicians: [],
  customers: [],
  estimates: [],
  jobs: [],
  job: null,
  jobTab: "overview",
  customerId: "",
  estimateId: "",
  report: null,
  events: [],
  focusDate: denverDate(),
  cal: "week",
  fieldCal: "list",
  query: "",
  queryFocus: false,
  createOpen: false,
  moreOpen: false,
  drawer: "",
  collapsed: localStorage.getItem("scb-sidebar") === "1",
  showUnassigned: true,
  crewOn: {},
};

const app = document.querySelector("#app");
document.body.addEventListener("click", (event) => {
  const target = event.target.closest("[data-action]");
  if (!target || skipClick) {
    skipClick = false;
    return;
  }
  void onClick(target, event);
});
document.body.addEventListener("submit", (event) => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;
  event.preventDefault();
  void onSubmit(form);
});
document.body.addEventListener("change", (event) => {
  const target = event.target;
  if (target instanceof HTMLSelectElement && target.dataset.action === "pick-customer") fillAddresses(target.value);
  if (target instanceof HTMLSelectElement && target.dataset.action === "cal-mode") {
    state.cal = target.value;
    render();
  }
  if (target instanceof HTMLInputElement && target.dataset.action === "crew-toggle") {
    state.crewOn[target.value] = target.checked;
    render();
  }
  if (target instanceof HTMLInputElement && target.dataset.action === "unassigned-toggle") {
    state.showUnassigned = target.checked;
    render();
  }
});
document.body.addEventListener("input", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement) || target.dataset.action !== "search") return;
  state.query = target.value;
  state.queryFocus = true;
  render();
});

let draggingId = "";
let skipClick = false;
document.body.addEventListener("dragstart", (event) => {
  const tile = event.target.closest?.("[data-drag-job]");
  if (!tile || state.session?.role === "technician") return;
  draggingId = tile.dataset.dragJob ?? "";
  event.dataTransfer?.setData("text/plain", draggingId);
  if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
});
document.body.addEventListener("dragover", (event) => {
  if (event.target.closest?.("[data-drop-day]")) event.preventDefault();
});
document.body.addEventListener("drop", (event) => {
  const lane = event.target.closest?.("[data-drop-day]");
  if (!lane || !draggingId || state.session?.role === "technician") return;
  event.preventDefault();
  const id = draggingId;
  draggingId = "";
  skipClick = true;
  void moveJob(id, lane, event);
});

await boot();

async function boot() {
  state.health = await api("/api/health");
  const session = await api("/api/session");
  state.authRequired = session.authRequired;
  state.session = session.session;
  if (state.session?.role === "technician") state.view = "field-home";
  if (state.session) await refresh();
  render();
}

async function refresh() {
  const from = addDays(denverDate(), -120);
  const to = addDays(denverDate(), 180);
  state.jobs = (await api(`/api/jobs?from=${from}&to=${to}`)).jobs;
  if (state.session?.role !== "technician") {
    state.technicians = (await api("/api/technicians")).technicians;
    state.customers = (await api("/api/customers")).customers;
    state.estimates = (await api("/api/estimates")).estimates;
    for (const tech of state.technicians) {
      if (state.crewOn[tech.id] === undefined) state.crewOn[tech.id] = true;
    }
    if (!state.report) await loadReport();
  }
}

async function onClick(target, event) {
  const action = target.dataset.action;
  state.error = "";
  if (action !== "toggle-create" && action !== "search") state.createOpen = false;
  try {
    if (action === "nav") {
      state.view = target.dataset.view;
      state.job = null;
      state.moreOpen = false;
      state.drawer = "";
      if (state.view === "reports" || state.view === "home") await loadReport();
      if (state.view === "import") state.events = (await api("/api/ghl/events")).events;
      render();
    } else if (action === "toggle-create") {
      state.createOpen = !state.createOpen;
      state.moreOpen = false;
      render();
    } else if (action === "more") {
      state.moreOpen = !state.moreOpen;
      state.createOpen = false;
      render();
    } else if (action === "create") {
      state.drawer = target.dataset.kind;
      state.moreOpen = false;
      if (target.dataset.kind === "job") state.view = "schedule";
      if (target.dataset.kind === "estimate") state.view = "estimates";
      if (target.dataset.kind === "customer") state.view = "customers";
      render();
    } else if (action === "close-drawer") {
      state.drawer = "";
      state.moreOpen = false;
      state.createOpen = false;
      render();
    } else if (action === "collapse") {
      state.collapsed = !state.collapsed;
      localStorage.setItem("scb-sidebar", state.collapsed ? "1" : "0");
      render();
    } else if (action === "today") {
      state.focusDate = denverDate();
      render();
    } else if (action === "shift") {
      const dir = Number(target.dataset.dir);
      if (state.cal === "month") state.focusDate = shiftMonth(state.focusDate, dir);
      else if (state.cal === "week") state.focusDate = addDays(state.focusDate, dir * 7);
      else state.focusDate = addDays(state.focusDate, dir);
      render();
    } else if (action === "pick-day") {
      state.focusDate = target.dataset.date;
      if (target.dataset.cal) state.cal = target.dataset.cal;
      if (state.session?.role === "technician") state.fieldCal = state.fieldCal;
      render();
    } else if (action === "field-cal") {
      state.fieldCal = target.dataset.mode;
      render();
    } else if (action === "tab") {
      state.jobTab = target.dataset.tab;
      render();
    } else if (action === "open-job") {
      if (target.dataset.clearSearch === "yes") state.query = "";
      state.returnView = state.view;
      state.jobTab = target.dataset.tab || (state.session?.role === "technician" ? "details" : "overview");
      state.job = await api(`/api/jobs/${target.dataset.id}`);
      state.view = "job";
      render();
    } else if (action === "open-customer") {
      if (target.dataset.clearSearch === "yes") state.query = "";
      state.customerId = target.dataset.id;
      state.view = "customer";
      render();
    } else if (action === "open-estimate") {
      state.estimateId = target.dataset.id;
      state.view = "estimate";
      render();
    } else if (action === "status") {
      state.job = await api(`/api/jobs/${state.job.job.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: target.dataset.status }),
      });
      state.notice = "Job updated.";
      await refresh();
      render();
    } else if (action === "walkthrough") {
      state.job = await api(`/api/jobs/${state.job.job.id}`, {
        method: "PATCH",
        body: JSON.stringify({ postWalkthroughComplete: target.dataset.value === "yes" }),
      });
      await refresh();
      render();
    } else if (action === "accept-estimate") {
      await api(`/api/estimates/${target.dataset.id}/accept`, { method: "POST", body: "{}" });
      state.notice = "Price accepted and locked.";
      await refresh();
      render();
    } else if (action === "decline-estimate") {
      await api(`/api/estimates/${target.dataset.id}/decline`, { method: "POST", body: "{}" });
      state.notice = "Estimate declined.";
      await refresh();
      render();
    } else if (action === "invoice") {
      const result = await api(`/api/jobs/${state.job.job.id}/invoice`, { method: "POST", body: "{}" });
      state.notice = `Invoice ${result.invoice.number} is ready.`;
      state.jobTab = "invoice";
      state.job = await api(`/api/jobs/${state.job.job.id}`);
      await refresh();
      render();
    } else if (action === "charge") {
      const result = await api(`/api/invoices/${state.job.invoice.id}/charge`, { method: "POST", body: "{}" });
      state.notice = result.payment.provider === "manual"
        ? "Payment recorded locally. No card was sent to a processor."
        : "Card payment captured.";
      state.job = await api(`/api/jobs/${state.job.job.id}`);
      await refresh();
      render();
    } else if (action === "logout") {
      await api("/api/logout", { method: "POST", body: "{}" });
      state.session = null;
      state.view = "home";
      render();
    }
  } catch (error) {
    state.error = error.message;
    render();
  }
  event.preventDefault();
}

async function moveJob(id, lane, event) {
  const job = state.jobs.find((item) => item.id === id);
  if (!job) return;
  const rect = lane.getBoundingClientRect();
  const ratio = rect.height ? (event.clientY - rect.top) / rect.height : 0;
  const span = END_MIN - START_MIN;
  let minutes = START_MIN + Math.round((ratio * span) / 15) * 15;
  minutes = Math.min(Math.max(minutes, START_MIN), END_MIN - 15);
  const duration = Math.max(15, Math.round((new Date(job.scheduledEnd) - new Date(job.scheduledStart)) / 60000));
  const scheduledStart = denverStamp(lane.dataset.dropDay, minutes);
  const scheduledEnd = addMinutesLocal(lane.dataset.dropDay, minutes, duration);
  const body = { scheduledStart, scheduledEnd };
  if (lane.dataset.dropTech !== undefined) body.technicianIds = lane.dataset.dropTech ? [lane.dataset.dropTech] : [];
  try {
    await api(`/api/jobs/${id}`, { method: "PATCH", body: JSON.stringify(body) });
    state.notice = "Job moved on the schedule.";
    await refresh();
  } catch (error) {
    state.error = error.message;
  }
  render();
}

async function onSubmit(form) {
  state.error = "";
  const data = Object.fromEntries(new FormData(form).entries());
  try {
    if (form.dataset.form === "login-office") {
      state.session = await api("/api/login", { method: "POST", body: JSON.stringify({ password: data.password }) });
      state.view = "home";
      await refresh();
    } else if (form.dataset.form === "login-tech") {
      state.session = await api("/api/login", { method: "POST", body: JSON.stringify({ name: data.name, pin: data.pin }) });
      state.view = "field-home";
      await refresh();
    } else if (form.dataset.form === "technician") {
      await api("/api/technicians", { method: "POST", body: JSON.stringify({ name: data.name, phone: data.phone, pin: data.pin }) });
      state.notice = "Crew member added.";
      state.drawer = "";
      await refresh();
    } else if (form.dataset.form === "customer") {
      const result = await api("/api/customers", {
        method: "POST",
        body: JSON.stringify({
          firstName: data.firstName,
          lastName: data.lastName,
          phone: data.phone,
          email: data.email,
          address: { line1: data.line1, city: data.city, state: data.state, postalCode: data.postalCode },
        }),
      });
      state.notice = result.matchedExisting
        ? `Matched an existing customer by ${result.matchedOn.join(" and ") || "GoHighLevel id"}.`
        : "Customer saved.";
      state.drawer = "";
      state.customerId = result.customer?.id || state.customerId;
      await refresh();
    } else if (form.dataset.form === "estimate") {
      await api("/api/estimates", {
        method: "POST",
        body: JSON.stringify({
          customerId: data.customerId,
          addressId: data.addressId,
          description: data.description,
          serviceCents: dollarsToCents(data.dollars),
        }),
      });
      state.notice = "Estimate saved.";
      state.drawer = "";
      await refresh();
    } else if (form.dataset.form === "job") {
      const technicianIds = [...form.querySelectorAll("input[name=technician]:checked")].map((input) => input.value);
      const body = {
        customerId: data.customerId,
        addressId: data.addressId,
        title: data.title,
        scheduledStart: data.start,
        scheduledEnd: data.end,
        technicianIds,
      };
      if (data.estimateId) body.estimateId = data.estimateId;
      else body.serviceCents = dollarsToCents(data.dollars || "0");
      await api("/api/jobs", { method: "POST", body: JSON.stringify(body) });
      state.notice = "Job scheduled.";
      state.drawer = "";
      await refresh();
    } else if (form.dataset.form === "note") {
      await api(`/api/jobs/${state.job.job.id}/notes`, { method: "POST", body: JSON.stringify({ body: data.body }) });
      state.job = await api(`/api/jobs/${state.job.job.id}`);
    } else if (form.dataset.form === "photo") {
      const file = form.querySelector("input[type=file]")?.files?.[0];
      if (!file) throw new Error("Choose a photo.");
      const dataBase64 = await fileToBase64(file);
      await api(`/api/jobs/${state.job.job.id}/photos`, {
        method: "POST",
        body: JSON.stringify({ kind: data.kind, contentType: file.type, dataBase64 }),
      });
      state.job = await api(`/api/jobs/${state.job.job.id}`);
    } else if (form.dataset.form === "card") {
      await api(`/api/customers/${data.customerId}/card`, {
        method: "PUT",
        body: JSON.stringify({
          provider: state.health.payments,
          providerCustomerId: data.providerCustomerId,
          providerPaymentMethodId: data.providerPaymentMethodId,
          brand: data.brand,
          last4: data.last4,
        }),
      });
      state.notice = "Card reference saved. The full card number is not stored here.";
      await refresh();
    } else if (form.dataset.form === "import") {
      const file = form.querySelector("input[type=file]")?.files?.[0];
      const csv = file ? await file.text() : data.csv;
      const result = await api("/api/import/customers", { method: "POST", body: JSON.stringify({ csv }) });
      state.notice = `Imported ${result.created} new customers, matched ${result.matched}, scheduled ${result.jobs} jobs.`;
      if (result.errors.length) state.error = result.errors.map((item) => `Line ${item.line}: ${item.message}`).join(" ");
      await refresh();
    } else if (form.dataset.form === "report") {
      await loadReport(data.from, addDays(data.to, 1));
    }
    render();
  } catch (error) {
    state.error = error.message;
    render();
  }
}

function render() {
  if (state.authRequired && !state.session) {
    app.innerHTML = loginView();
    return;
  }
  app.innerHTML = state.session?.role === "technician" ? fieldShell() : officeShell();
  fillAddresses(document.querySelector("[data-customer]")?.value || "");
  if (state.queryFocus) {
    const box = document.querySelector("[data-action=search]");
    if (box instanceof HTMLInputElement) {
      box.focus();
      box.setSelectionRange(box.value.length, box.value.length);
    }
  }
}

function officeShell() {
  const detail = ["job", "customer", "estimate"].includes(state.view);
  return `<div class="office${state.collapsed ? " is-collapsed" : ""}${detail ? " in-detail" : ""}">
    <aside class="sidebar">
      <div class="brand-lockup"><div class="mark">SC</div><div class="brand-copy"><strong>Super Cleaning Bros</strong><span>Erie, CO</span></div></div>
      <button class="create" type="button" data-action="toggle-create"><span>+</span><span class="nav-label">Create</span></button>
      ${state.createOpen ? `<div class="menu">${createChoices()}</div>` : ""}
      <nav class="side-nav">
        ${sideLink("home", "Home", "home")}
        ${sideLink("schedule", "Schedule", "calendar")}
        ${sideLink("customers", "Customers", "people")}
        ${sideLink("jobs", "Jobs", "briefcase")}
        ${sideLink("estimates", "Estimates", "clipboard")}
        ${sideLink("invoices", "Invoices", "card")}
        ${sideLink("reports", "Reporting", "chart")}
        ${sideLink("team", "Team", "crew")}
      </nav>
      <div class="sidebar-foot">
        ${sideLink("import", "Import & sync", "tray")}
        <button type="button" data-action="collapse"><span class="icon">${svg("collapse")}</span><span class="nav-label">${state.collapsed ? "Expand" : "Collapse"}</span></button>
        <div class="who"><div class="avatar">SC</div><div class="nav-label"><strong>${esc(state.session?.name || "Office")}</strong><div class="quiet">Erie office</div></div></div>
        ${state.authRequired ? `<button type="button" data-action="logout"><span class="nav-label">Sign out</span></button>` : ""}
      </div>
    </aside>
    <div class="workspace">
      <header class="topbar">
        <h1>${esc(pageTitle())}</h1>
        <div class="search-wrap">
          <input data-action="search" value="${esc(state.query)}" placeholder="Search customers, jobs, or addresses" aria-label="Search" />
          ${searchResults()}
        </div>
        ${state.health?.payments === "manual" ? `<span class="chip">Local practice payments</span>` : ""}
      </header>
      <main class="content">
        ${state.error ? `<div class="error">${esc(state.error)}</div>` : ""}
        ${state.notice ? `<div class="notice">${esc(state.notice)}</div>` : ""}
        ${officeView()}
      </main>
    </div>
    ${detail ? "" : `<nav class="bottom-tabs">
      ${tab("home", "Home", "home")}
      ${tab("schedule", "Schedule", "calendar")}
      ${tab("customers", "Customers", "people")}
      ${tab("jobs", "Jobs", "briefcase")}
      <button type="button" data-action="more">${svg("more")}<span>More</span></button>
    </nav>`}
    ${detail ? "" : `<button class="fab" type="button" data-action="toggle-create" aria-label="Create">+</button>`}
    ${state.moreOpen ? `<div class="sheet-wrap"><div class="sheet"><button type="button" data-action="close-drawer">Close</button>${moreLinks()}</div></div>` : ""}
    ${state.createOpen ? `<div class="sheet-wrap create-sheet"><div class="sheet"><button type="button" data-action="close-drawer">Close</button>${createChoices()}</div></div>` : ""}
    ${drawer()}
  </div>`;
}

function fieldShell() {
  const detail = state.view === "job";
  return `<div class="field-app">
    <header class="field-top"><div class="brand-lockup"><div class="mark">SC</div><div><strong>Super Cleaning Bros</strong><span>${esc(state.session?.name || "Crew")}</span></div></div>
      ${state.authRequired ? `<button class="ghost" type="button" data-action="logout">Sign out</button>` : ""}
    </header>
    ${state.error ? `<div class="error" style="margin:12px">${esc(state.error)}</div>` : ""}
    ${state.notice ? `<div class="notice" style="margin:12px">${esc(state.notice)}</div>` : ""}
    <main class="field-main">${detail ? jobView() : fieldBody()}</main>
    ${detail ? "" : `<nav class="field-tabs">
      ${fieldTab("field-home", "Home", "home")}
      ${fieldTab("field-schedule", "Schedule", "calendar")}
      ${fieldTab("field-jobs", "Jobs", "briefcase")}
    </nav>`}
  </div>`;
}

function fieldBody() {
  if (state.view === "field-schedule") return fieldSchedule();
  if (state.view === "field-jobs") return `<h2>My jobs</h2>${jobCards(state.jobs) || empty("Nothing assigned in this range.")}`;
  const today = denverDate();
  const open = state.jobs.filter((job) => job.status === "in_progress");
  const upcoming = state.jobs.filter((job) => job.status === "scheduled" && denverDate(new Date(job.scheduledStart)) >= today);
  return `<h2>Today</h2>
    <p class="quiet">${esc(formatDay(today))}</p>
    <h3>Open work</h3>
    ${jobCards(open) || empty("No job in progress.")}
    <h3>Upcoming</h3>
    ${jobCards(upcoming) || empty("No upcoming jobs.")}`;
}

function fieldSchedule() {
  const start = mondayOf(denverDate());
  const days = Array.from({ length: 14 }, (_, index) => addDays(start, index));
  const selected = jobsOn(state.focusDate);
  return `<div class="row">
      <button class="ghost" type="button" data-action="field-cal" data-mode="list" aria-current="${state.fieldCal === "list" ? "page" : "false"}">List</button>
      <button class="ghost" type="button" data-action="field-cal" data-mode="day" aria-current="${state.fieldCal === "day" ? "page" : "false"}">Day</button>
    </div>
    <div class="day-strip">${days.map((day) => `<button type="button" data-action="pick-day" data-date="${esc(day)}" aria-current="${day === state.focusDate ? "date" : "false"}"><span>${esc(weekdayShort(day))}</span><strong>${esc(day.slice(-2))}</strong></button>`).join("")}</div>
    <h2>${esc(formatDay(state.focusDate))}</h2>
    ${state.fieldCal === "day" ? dayGrid(state.focusDate) : jobCards(selected) || empty("No jobs this day.")}`;
}

function officeView() {
  if (state.view === "schedule") return scheduleView();
  if (state.view === "customers") return customersView();
  if (state.view === "customer") return customerView();
  if (state.view === "jobs") return jobsView();
  if (state.view === "estimates") return estimatesView();
  if (state.view === "estimate") return estimateView();
  if (state.view === "invoices") return invoicesView();
  if (state.view === "reports") return reportsView();
  if (state.view === "team") return teamView();
  if (state.view === "import") return importView();
  if (state.view === "job" && state.job) return jobView();
  return homeView();
}

function homeView() {
  const today = denverDate();
  const todays = state.jobs.filter((job) => denverDate(new Date(job.scheduledStart)) === today);
  const working = state.jobs.filter((job) => job.status === "in_progress");
  const openInvoices = state.jobs.filter((job) => job.invoice?.status === "issued");
  const review = state.estimates.filter((estimate) => estimate.travelReviewRequired && estimate.status === "draft");
  const report = state.report;
  return `<div class="stats">
      ${stat("Today", todays.length)}
      ${stat("In progress", working.length)}
      ${stat("Open invoices", openInvoices.length)}
      ${stat("Collected", report ? money(report.collectedCents) : "—")}
    </div>
    <div class="grid-2" style="margin-top:12px">
      <section class="panel stack">
        <h2>Today's schedule</h2>
        ${todays.map((job) => jobLine(job)).join("") || empty("Nothing on the board today.")}
      </section>
      <section class="panel stack">
        <h2>Crew</h2>
        ${state.technicians.map((tech) => {
          const active = working.find((job) => job.technicianIds.includes(tech.id));
          const next = state.jobs.find((job) => job.status === "scheduled" && job.technicianIds.includes(tech.id));
          return `<div class="row"><span class="dot" style="background:${esc(colorFor(tech.id))}"></span><strong>${esc(tech.name)}</strong><span class="quiet">${active ? `On ${esc(active.customerName)}` : next ? `Next ${esc(formatWhen(next.scheduledStart))}` : "Open"}</span></div>`;
        }).join("") || empty("Add crew from Team.")}
        <h2>Needs a look</h2>
        ${openInvoices.map((job) => `<button class="ghost" type="button" data-action="open-job" data-id="${esc(job.id)}" data-tab="invoice">${esc(job.invoice.number)} · ${esc(job.customerName)} · ${money(job.invoice.totalCents)}</button>`).join("")}
        ${review.map((estimate) => `<button class="ghost" type="button" data-action="open-estimate" data-id="${esc(estimate.id)}">Confirm drive time · ${esc(estimate.customerName)}</button>`).join("")}
        ${openInvoices.length || review.length ? "" : empty("Nothing waiting.")}
      </section>
    </div>`;
}

function scheduleView() {
  const month = monthGrid(state.focusDate);
  const lanes = laneModel();
  return `<div class="schedule-layout">
    <details class="schedule-menu" open>
      <summary>Schedule menu</summary>
      <div class="row" style="margin-top:8px"><strong>${esc(month.label)}</strong></div>
      <div class="mini-month">${["M", "T", "W", "T", "F", "S", "S"].map((label) => `<span class="quiet" style="text-align:center">${label}</span>`).join("")}
        ${month.days.map((day) => `<button type="button" class="${day.slice(0, 7) === state.focusDate.slice(0, 7) ? "" : "muted"}" data-action="pick-day" data-date="${esc(day)}" aria-current="${day === state.focusDate ? "date" : "false"}">${esc(String(Number(day.slice(-2))))}</button>`).join("")}
      </div>
      <div class="stack" style="margin-top:10px">
        <label class="check"><input type="checkbox" data-action="unassigned-toggle" ${state.showUnassigned ? "checked" : ""} /> Unassigned</label>
        ${state.technicians.map((tech) => `<label class="check"><input type="checkbox" data-action="crew-toggle" value="${esc(tech.id)}" ${state.crewOn[tech.id] !== false ? "checked" : ""} /><span class="dot" style="background:${esc(colorFor(tech.id))}"></span>${esc(tech.name)}</label>`).join("")}
      </div>
    </details>
    <div>
      <div class="toolbar">
        <button class="ghost" type="button" data-action="shift" data-dir="-1" aria-label="Previous">‹</button>
        <button class="ghost" type="button" data-action="today">Today</button>
        <button class="ghost" type="button" data-action="shift" data-dir="1" aria-label="Next">›</button>
        <strong>${esc(rangeLabel())}</strong>
        <select data-action="cal-mode" aria-label="Calendar view">
          ${["dispatch", "day", "week", "month"].map((mode) => `<option value="${mode}" ${state.cal === mode ? "selected" : ""}>${mode[0].toUpperCase()}${mode.slice(1)}</option>`).join("")}
        </select>
        <button class="primary" type="button" data-action="create" data-kind="job">New job</button>
      </div>
      ${state.cal === "month" ? monthView() : timeBoard(lanes)}
    </div>
  </div>`;
}

function laneModel() {
  if (state.cal === "week") {
    const start = mondayOf(state.focusDate);
    return Array.from({ length: 7 }, (_, index) => {
      const day = addDays(start, index);
      return { key: day, label: formatDay(day), day, tech: undefined, jobs: jobsOn(day) };
    });
  }
  if (state.cal === "dispatch") {
    const lanes = [];
    if (state.showUnassigned) lanes.push({ key: "unassigned", label: "Unassigned", day: state.focusDate, tech: "", jobs: jobsOn(state.focusDate).filter((job) => job.technicianIds.length === 0) });
    for (const tech of state.technicians) {
      if (state.crewOn[tech.id] === false) continue;
      lanes.push({
        key: tech.id,
        label: tech.name,
        day: state.focusDate,
        tech: tech.id,
        jobs: jobsOn(state.focusDate).filter((job) => job.technicianIds.includes(tech.id)),
      });
    }
    if (lanes.length === 0) lanes.push({ key: "none", label: "Schedule", day: state.focusDate, tech: undefined, jobs: jobsOn(state.focusDate) });
    return lanes;
  }
  return [{ key: state.focusDate, label: formatDay(state.focusDate), day: state.focusDate, tech: undefined, jobs: jobsOn(state.focusDate) }];
}

function timeBoard(lanes) {
  const outside = lanes.flatMap((lane) => lane.jobs.filter((job) => !tileBox(job)));
  const hours = Array.from({ length: 12 }, (_, index) => START_MIN / 60 + index);
  return `${outside.length ? `<div class="outside">${outside.map((job) => `<button class="ghost" type="button" data-action="open-job" data-id="${esc(job.id)}">${esc(formatTime(job.scheduledStart))} ${esc(job.customerName)}</button>`).join("")}</div>` : ""}
    <div class="dispatch" style="--lanes:${lanes.length}">
      <div class="corner"></div>
      ${lanes.map((lane) => `<div class="day-head"><strong>${esc(lane.label)}</strong></div>`).join("")}
      <div class="hours">${hours.map((hour) => `<span style="top:${(hour - 7) * HOUR_PX}px">${hourLabel(hour)}</span>`).join("")}</div>
      ${lanes.map((lane) => `<div class="lane" data-drop-day="${esc(lane.day)}" ${lane.tech === undefined ? "" : `data-drop-tech="${esc(lane.tech)}"`}>${lane.jobs.map((job) => tile(job)).join("")}</div>`).join("")}
    </div>`;
}

function dayGrid(day) {
  return timeBoard([{ key: day, label: formatDay(day), day, tech: undefined, jobs: state.jobs.filter((job) => denverDate(new Date(job.scheduledStart)) === day) }]);
}

function tile(job) {
  const box = tileBox(job);
  if (!box) return "";
  const color = job.technicianIds[0] ? colorFor(job.technicianIds[0]) : "#5c675f";
  let background = color;
  let text = "#fff";
  let border = "0";
  if (job.status === "in_progress") {
    background = "#fff";
    text = "#1c2420";
    border = `2px solid ${color}`;
  } else if (job.status === "done") {
    background = "#e6eae7";
    text = "#3d4741";
    border = job.invoice?.status === "issued" ? "2px solid #9a4a32" : "0";
  }
  return `<button class="tile" type="button" draggable="true" data-drag-job="${esc(job.id)}" data-action="open-job" data-id="${esc(job.id)}" style="top:${box.top}px;height:${box.height}px;background:${background};color:${text};border:${border}">
    <strong>${esc(job.customerName)}</strong><br>${esc(formatTime(job.scheduledStart))} · ${esc(job.title)}<br>${money(job.totalCents)}
  </button>`;
}

function monthView() {
  const month = monthGrid(state.focusDate);
  return `<div class="month-grid">${["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((label) => `<div class="quiet">${label}</div>`).join("")}
    ${month.days.map((day) => {
      const jobs = jobsOn(day).slice(0, 3);
      const extra = jobsOn(day).length - jobs.length;
      return `<div class="month-cell"><button type="button" data-action="pick-day" data-date="${esc(day)}" data-cal="day"><strong>${esc(String(Number(day.slice(-2))))}</strong></button>${jobs.map((job) => `<button class="month-job" type="button" data-action="open-job" data-id="${esc(job.id)}">${esc(job.customerName)}</button>`).join("")}${extra > 0 ? `<span class="quiet">+${extra}</span>` : ""}</div>`;
    }).join("")}
  </div>`;
}

function customersView() {
  const rows = state.customers.filter((customer) => textMatch(`${customer.firstName} ${customer.lastName} ${customer.phone} ${customer.email || ""} ${customer.addresses.map((address) => `${address.line1} ${address.city} ${address.postalCode}`).join(" ")}`));
  return `${table(["Customer", "Phone", "Address", "Card"], rows.map((customer) => `<tr data-action="open-customer" data-id="${esc(customer.id)}"><td><strong>${esc(customer.firstName)} ${esc(customer.lastName)}</strong></td><td>${esc(customer.phone)}</td><td>${customer.addresses.map((address) => esc(`${address.line1}, ${address.city} ${address.postalCode}`)).join("<br>")}</td><td>${customer.cardOnFile ? "On file" : "—"}</td></tr>`))}`;
}

function customerView() {
  const customer = state.customers.find((item) => item.id === state.customerId);
  if (!customer) return empty("That customer is not in the list.");
  const jobs = state.jobs.filter((job) => job.customerId === customer.id);
  const estimates = state.estimates.filter((estimate) => estimate.customerId === customer.id);
  const invoices = jobs.filter((job) => job.invoice);
  return `<button class="ghost" type="button" data-action="nav" data-view="customers">Back to customers</button>
    <div class="split" style="margin-top:12px">
      <aside class="panel stack">
        <h2>${esc(customer.firstName)} ${esc(customer.lastName)}</h2>
        <div>${esc(customer.phone)}</div>
        <div>${esc(customer.email || "No email")}</div>
        ${customer.addresses.map((address) => `<div>${esc(address.line1)}<br>${esc(address.city)}, ${esc(address.state)} ${esc(address.postalCode)}</div>`).join("")}
        <div class="quiet">${customer.cardOnFile ? "Card on file" : "No card on file"}${customer.ghlContactId ? " · Synced to GoHighLevel" : ""}</div>
        <form class="stack" data-form="card">
          <h3>Card reference</h3>
          <p class="quiet">Store the provider ids. Do not type a card number.</p>
          <input type="hidden" name="customerId" value="${esc(customer.id)}" />
          <label>Provider customer id <input name="providerCustomerId" required /></label>
          <label>Payment method id <input name="providerPaymentMethodId" required /></label>
          <div class="row"><label>Brand <input name="brand" /></label><label>Last 4 <input name="last4" maxlength="4" /></label></div>
          <button class="secondary" type="submit">Save card reference</button>
        </form>
      </aside>
      <div class="stack">
        <section class="panel"><h3>Jobs</h3>${jobs.map((job) => jobLine(job)).join("") || empty("No jobs in the loaded range.")}</section>
        <section class="panel"><h3>Estimates</h3>${estimates.map((estimate) => `<button class="ghost" type="button" data-action="open-estimate" data-id="${esc(estimate.id)}">${esc(estimate.lineItems.map((item) => item.description).join(", "))} · ${money(estimate.totalCents)} · ${esc(estimate.status)}</button>`).join("") || empty("No estimates.")}</section>
        <section class="panel"><h3>Invoices</h3>${invoices.map((job) => `<button class="ghost" type="button" data-action="open-job" data-id="${esc(job.id)}" data-tab="invoice">${esc(job.invoice.number)} · ${money(job.invoice.totalCents)} · ${esc(job.invoice.status)}</button>`).join("") || empty("No invoices.")}</section>
      </div>
    </div>`;
}

function jobsView() {
  const rows = state.jobs.filter((job) => textMatch(`${job.customerName} ${job.title} ${job.addressLine} ${job.phone} ${crewNames(job.technicianIds)}`));
  return table(["Job", "When", "Address", "Crew", "Status", "Amount"], rows.map((job) => `<tr data-action="open-job" data-id="${esc(job.id)}"><td><strong>${esc(job.title)}</strong><br>${esc(job.customerName)}</td><td>${esc(formatWhen(job.scheduledStart))}</td><td>${esc(job.addressLine)}</td><td>${esc(crewNames(job.technicianIds))}</td><td>${statusPill(job.status)}</td><td class="money">${money(job.totalCents)}${job.priceLocked ? "<br><span class='quiet'>Price locked</span>" : ""}</td></tr>`));
}

function estimatesView() {
  const rows = state.estimates.filter((estimate) => textMatch(`${estimate.customerName} ${estimate.status}`));
  return table(["Customer", "Work", "Drive", "Total", "Status"], rows.map((estimate) => `<tr data-action="open-estimate" data-id="${esc(estimate.id)}"><td>${esc(estimate.customerName)}</td><td>${esc(estimate.lineItems.map((item) => item.description).join(", "))}</td><td>${estimate.driveMinutes === null ? "Unknown" : `${estimate.driveMinutes} min`}</td><td class="money">${money(estimate.totalCents)}</td><td>${statusPill(estimate.status)}</td></tr>`));
}

function estimateView() {
  const estimate = state.estimates.find((item) => item.id === state.estimateId);
  if (!estimate) return empty("That estimate is not in the list.");
  const customer = state.customers.find((item) => item.id === estimate.customerId);
  const address = customer?.addresses?.find((item) => item.id === estimate.addressId) || customer?.addresses?.[0];
  return `<button class="ghost" type="button" data-action="nav" data-view="estimates">Back to estimates</button>
    <article class="property" style="margin-top:12px"><div class="property-band"></div><div class="property-body">
      <div class="quiet">${address ? `${esc(address.line1)}, ${esc(address.city)} ${esc(address.postalCode)}` : ""}</div>
      <h2>${esc(estimate.lineItems[0]?.description || "Estimate")} · ${esc(estimate.customerName)}</h2>
      <div class="row">${statusPill(estimate.status)}${estimate.priceLocked ? "<span class='quiet'>Keeps a previously accepted price.</span>" : ""}</div>
    </div></article>
    ${estimate.travelReviewRequired ? `<div class="error" style="margin-top:12px">Confirm drive time before accepting.</div>` : ""}
    <section class="panel" style="margin-top:12px">${lineTable(estimate.lineItems, estimate.totalCents)}
      <p class="quiet">${estimate.driveMinutes === null ? "Drive time unknown" : `${estimate.driveMinutes} min from Erie`} · ${esc(estimate.travelBasis)}${estimate.travelFeeCents ? ` · travel ${money(estimate.travelFeeCents)}` : ""}</p>
      ${estimate.status === "draft" ? `<div class="row" style="margin-top:10px"><button class="primary" type="button" data-action="accept-estimate" data-id="${esc(estimate.id)}">Accept price</button><button class="secondary" type="button" data-action="decline-estimate" data-id="${esc(estimate.id)}">Decline</button></div>` : ""}
    </section>`;
}

function invoicesView() {
  const rows = state.jobs.filter((job) => job.invoice && textMatch(`${job.customerName} ${job.invoice.number} ${job.addressLine}`));
  return table(["Invoice", "Customer", "Job", "Status", "Amount"], rows.map((job) => `<tr data-action="open-job" data-id="${esc(job.id)}" data-tab="invoice"><td>${esc(job.invoice.number)}</td><td>${esc(job.customerName)}</td><td>${esc(job.title)}</td><td>${statusPill(job.invoice.status)}</td><td class="money">${money(job.invoice.totalCents)}</td></tr>`), "No invoices yet. Open a finished job and create one.");
}

function jobView() {
  const { job, customer, address, notes, photos, invoice, charge, technicianIds = [], technicians = [] } = state.job;
  const tech = state.session?.role === "technician";
  const tabs = tech
    ? [["details", "Details"], ["notes", "Notes"], ["photos", "Photos"]]
    : [["overview", "Overview"], ["lines", "Line items"], ["notes", "Notes"], ["photos", "Photos"], ["invoice", "Invoice"]];
  const back = tech ? (state.returnView.startsWith("field-") ? state.returnView : "field-home") : (state.returnView || "schedule");
  return `<button class="ghost" type="button" data-action="nav" data-view="${esc(back)}">Back</button>
    <article class="property" style="margin-top:12px"><div class="property-band"></div><div class="property-body">
      <div class="quiet">${esc(address.line1)}</div>
      <div>${esc(address.city)}, ${esc(address.state)} ${esc(address.postalCode)}</div>
      <h2>${esc(job.title)} · ${esc(customer.firstName)} ${esc(customer.lastName)}</h2>
      <div class="row">${statusPill(job.status)}<span>${esc(formatWhen(job.scheduledStart))} – ${esc(formatTime(job.scheduledEnd))}</span><span class="money">${money(job.totalCents)}</span>${job.priceLocked ? "<span class='quiet'>Accepted price is locked</span>" : ""}</div>
    </div></article>
    <div class="job-toolbar">
      ${job.status === "scheduled" ? `<button class="primary" type="button" data-action="status" data-status="in_progress">Start</button>` : ""}
      ${job.status === "in_progress" ? `<button class="primary" type="button" data-action="status" data-status="done">Finish</button>` : ""}
      ${job.postWalkthroughComplete ? `<span class="status done">Walkthrough complete</span>` : `<button class="secondary" type="button" data-action="walkthrough" data-value="yes">Walkthrough done</button>`}
      ${tech ? "" : `<span class="quiet">${esc(customer.phone)}</span>`}
    </div>
    <div class="tabs">${tabs.map(([id, label]) => `<button type="button" data-action="tab" data-tab="${id}" aria-current="${state.jobTab === id ? "page" : "false"}">${label}</button>`).join("")}</div>
    <section class="panel" style="margin-top:12px">${jobPanel(tech, job, customer, address, notes, photos, invoice, charge, technicianIds, technicians)}</section>`;
}

function jobPanel(tech, job, customer, address, notes, photos, invoice, charge, technicianIds, technicians) {
  const tab = state.jobTab;
  const crew = technicians.length ? technicians.map((tech) => tech.name).join(", ") : crewNames(technicianIds);
  if (tab === "lines") return lineTable(job.lineItems, job.totalCents) + (job.travelFeeCents ? `<p class="quiet">Travel ${money(job.travelFeeCents)} is inside the total when the price was accepted.</p>` : "");
  if (tab === "notes") return notesBlock(notes);
  if (tab === "photos") return photosBlock(photos, job.id);
  if (tab === "invoice") return invoiceBlock(invoice, charge);
  if (tech || tab === "details") {
    return `<p><strong>${esc(customer.firstName)} ${esc(customer.lastName)}</strong><br>${esc(customer.phone)}<br>${esc(address.line1)}, ${esc(address.city)} ${esc(address.state)} ${esc(address.postalCode)}</p>
      <p style="margin-top:8px">${esc(crew)}</p>
      ${lineTable(job.lineItems, job.totalCents)}
      <h3 style="margin-top:12px">Notes</h3>${notesBlock(notes)}`;
  }
  return `<div class="grid-2"><div><h3>Customer</h3><p>${esc(customer.firstName)} ${esc(customer.lastName)}<br>${esc(customer.phone)}</p><h3 style="margin-top:10px">Crew</h3><p>${esc(crew)}</p></div><div><h3>Price</h3><p class="money">${money(job.totalCents)}</p>${job.priceLocked ? "<p>Accepted price is locked.</p>" : ""}<p class="quiet">${job.travelFeeCents ? `Travel ${money(job.travelFeeCents)}` : "No travel fee"}</p>${charge?.ok ? "" : `<p class="quiet">${esc(charge?.message || "")}</p>`}</div></div>`;
}

function notesBlock(notes) {
  return `${notes.map((note) => `<p style="margin-top:8px"><strong>${esc(note.authorName)}</strong> · ${esc(formatWhen(note.createdAt))}<br>${esc(note.body)}</p>`).join("") || empty("No notes yet.")}
    <form class="stack" data-form="note" style="margin-top:10px"><label>Note <textarea name="body" required></textarea></label><button class="secondary" type="submit">Add note</button></form>`;
}

function photosBlock(photos, jobId) {
  return `<div class="photos">${photos.map((photo) => `<figure><img alt="${esc(photo.kind)} photo" src="/api/jobs/${jobId}/photos/${photo.id}" /><figcaption>${esc(photo.kind)}</figcaption></figure>`).join("")}</div>
    <form class="row" data-form="photo" style="margin-top:10px"><select name="kind"><option value="before">Before</option><option value="after">After</option><option value="walkthrough">Walkthrough</option></select><input type="file" accept="image/jpeg,image/png,image/webp" required /><button class="secondary" type="submit">Upload</button></form>`;
}

function invoiceBlock(invoice, charge) {
  if (!invoice) return `<p>Create the invoice when the work is ready to bill. The card is not charged until the job is done and the walkthrough or both photos are in.</p><button class="primary" type="button" data-action="invoice">Create invoice</button>`;
  const job = state.job.job;
  return `${lineTable(invoice.lineItems || job.lineItems, invoice.totalCents)}
    <p style="margin-top:8px"><strong>${esc(invoice.number)}</strong> · ${statusPill(invoice.status)} · ${money(invoice.totalCents)}</p>
    ${invoice.status !== "paid" ? `<button class="primary" type="button" data-action="charge" ${charge.ok ? "" : "disabled"}>Charge card on file</button>` : `<p class="notice">Paid</p>`}
    ${charge.ok ? "" : `<p class="quiet">${esc(charge.message)}</p>`}`;
}

function reportsView() {
  const today = denverDate();
  const report = state.report;
  const end = report ? addDays(denverDate(new Date(report.to)), -1) : today;
  return `<form class="toolbar" data-form="report">
      <label>From <input type="date" name="from" value="${esc(report ? denverDate(new Date(report.from)) : addDays(today, -30))}" /></label>
      <label>To <input type="date" name="to" value="${esc(end)}" /></label>
      <button class="primary" type="submit">Run report</button>
    </form>
    ${report ? `<div class="stats">
      ${stat("Jobs", report.jobs)}
      ${stat("Done", report.jobsByStatus.done)}
      ${stat("Collected", money(report.collectedCents))}
      ${stat("Outstanding", money(report.outstandingCents))}
      ${stat("Travel fees", money(report.travelFeesCents))}
      ${stat("Average completed", money(report.averageCompletedTicketCents))}
    </div>
    <p class="quiet" style="margin-top:8px">Job counts follow the scheduled start. Collected money follows the payment time.</p>` : empty("Choose a range.")}`;
}

function teamView() {
  return `<div class="grid-2">
    <form class="panel stack" data-form="technician"><h2>Add crew</h2><label>Name <input name="name" required /></label><label>Phone <input name="phone" /></label><label>PIN <input name="pin" required minlength="4" /></label><button class="primary" type="submit">Save crew member</button></form>
    <section class="panel stack"><h2>Team</h2>${state.technicians.map((tech) => `<div class="row"><span class="dot" style="background:${esc(colorFor(tech.id))}"></span><strong>${esc(tech.name)}</strong><span class="quiet">${esc(tech.phone || "")}</span></div>`).join("") || empty("No crew yet.")}</section>
  </div>`;
}

function importView() {
  return `<div class="grid-2">
    <form class="panel stack" data-form="import"><h2>Import from a spreadsheet</h2><p class="quiet">Use the column guide in the migration note. Cards and photos do not transfer.</p><input type="file" accept=".csv,text/csv" /><textarea name="csv" placeholder="First Name,Last Name,Mobile Number,Address,City,State,Zip"></textarea><button class="primary" type="submit">Import</button></form>
    <section class="panel"><h2>GoHighLevel activity</h2>${state.events.map((event) => `<p style="margin-top:8px"><strong>${esc(event.eventType)}</strong> · ${esc(event.status)}<br><span class="quiet">${esc(event.detail || "")}</span></p>`).join("") || empty("No sync events yet.")}</section>
  </div>`;
}

function drawer() {
  if (!state.drawer) return "";
  const title = state.drawer === "customer" ? "New customer" : state.drawer === "estimate" ? "New estimate" : "New job";
  return `<div class="sheet-wrap"><form class="sheet stack" data-form="${esc(state.drawer === "customer" ? "customer" : state.drawer)}">
    <div class="row"><h2>${title}</h2><button class="ghost" type="button" data-action="close-drawer">Close</button></div>
    ${state.drawer === "customer" ? customerForm() : state.drawer === "estimate" ? estimateForm() : jobForm()}
  </form></div>`;
}

function customerForm() {
  return `<label>First name <input name="firstName" /></label><label>Last name <input name="lastName" required /></label><label>Phone <input name="phone" required /></label><label>Email <input name="email" type="email" /></label><label>Street <input name="line1" required /></label><div class="row"><label>City <input name="city" value="Erie" required /></label><label>State <input name="state" value="CO" required /></label><label>ZIP <input name="postalCode" value="80516" required /></label></div><button class="primary" type="submit">Save customer</button>`;
}

function estimateForm() {
  return `${customerFields()}<label>Description <input name="description" value="Standard clean" required /></label><label>Service price in dollars <input name="dollars" inputmode="decimal" required /></label><button class="primary" type="submit">Save estimate</button>`;
}

function jobForm() {
  return `${customerFields()}<label>Title <input name="title" value="Cleaning" required /></label><div class="row"><label>Start <input name="start" type="datetime-local" required /></label><label>End <input name="end" type="datetime-local" required /></label></div>
    <label>Accepted estimate <select name="estimateId"><option value="">Price this job now</option>${state.estimates.filter((estimate) => estimate.status === "accepted").map((estimate) => `<option value="${esc(estimate.id)}">${esc(estimate.customerName)} · ${money(estimate.totalCents)}</option>`).join("")}</select></label>
    <label>Service price in dollars, if there is no accepted estimate <input name="dollars" inputmode="decimal" placeholder="180" /></label>
    <div class="row">${state.technicians.map((tech) => `<label class="check"><input type="checkbox" name="technician" value="${esc(tech.id)}" /> ${esc(tech.name)}</label>`).join("") || "<span class='quiet'>Add crew from Team first.</span>"}</div>
    <button class="primary" type="submit">Schedule</button>`;
}

function loginView() {
  return `<main class="login-wrap"><div class="stack" style="width:min(860px,100%)">
    <div class="brand-lockup"><div class="mark">SC</div><div><strong>Super Cleaning Bros</strong><span>Erie, CO</span></div></div>
    ${state.error ? `<div class="error">${esc(state.error)}</div>` : ""}
    <div class="login-card">
      <form class="panel stack" data-form="login-office"><h2>Office</h2><label>Password <input type="password" name="password" required /></label><button class="primary" type="submit">Sign in</button></form>
      <form class="panel stack" data-form="login-tech"><h2>Crew</h2><label>Name <input name="name" required /></label><label>PIN <input name="pin" required /></label><button class="secondary" type="submit">Open my jobs</button></form>
    </div>
  </div></main>`;
}

function createChoices() {
  return `<button type="button" data-action="create" data-kind="job">Job</button><button type="button" data-action="create" data-kind="estimate">Estimate</button><button type="button" data-action="create" data-kind="customer">Customer</button>`;
}

function moreLinks() {
  return [["estimates", "Estimates"], ["invoices", "Invoices"], ["reports", "Reporting"], ["team", "Team"], ["import", "Import & sync"]].map(([view, label]) => `<button type="button" data-action="nav" data-view="${view}">${label}</button>`).join("") + (state.authRequired ? `<button type="button" data-action="logout">Sign out</button>` : "");
}

function sideLink(view, label, iconName) {
  return `<button type="button" data-action="nav" data-view="${view}" aria-current="${navCurrent(view)}"><span class="icon">${svg(iconName)}</span><span class="nav-label">${label}</span></button>`;
}

function tab(view, label, iconName) {
  return `<button type="button" data-action="nav" data-view="${view}" aria-current="${navCurrent(view)}">${svg(iconName)}<span>${label}</span></button>`;
}

function fieldTab(view, label, iconName) {
  return `<button type="button" data-action="nav" data-view="${view}" aria-current="${state.view === view ? "page" : "false"}">${svg(iconName)}<span>${label}</span></button>`;
}

function navCurrent(view) {
  const aliases = { customer: "customers", estimate: "estimates" };
  let active = aliases[state.view] || state.view;
  if (state.view === "job") active = ["home", "schedule", "customers", "estimates", "invoices", "jobs"].includes(state.returnView) ? state.returnView : "jobs";
  return active === view ? "page" : "false";
}

function pageTitle() {
  const titles = { home: "Home", schedule: "Schedule", customers: "Customers", customer: "Customer", jobs: "Jobs", estimates: "Estimates", estimate: "Estimate", invoices: "Invoices", reports: "Reporting", team: "Team", import: "Import & sync", job: "Job" };
  return titles[state.view] || "Home";
}

function searchResults() {
  const q = state.query.trim().toLowerCase();
  if (q.length < 2) return "";
  const customers = state.customers.filter((customer) => textMatch(`${customer.firstName} ${customer.lastName} ${customer.phone}`)).slice(0, 5);
  const jobs = state.jobs.filter((job) => textMatch(`${job.customerName} ${job.title} ${job.addressLine}`)).slice(0, 5);
  if (!customers.length && !jobs.length) return `<div class="search-results"><div class="quiet" style="padding:8px">No matches</div></div>`;
  return `<div class="search-results">${customers.map((customer) => `<button type="button" data-action="open-customer" data-id="${esc(customer.id)}" data-clear-search="yes">${esc(customer.firstName)} ${esc(customer.lastName)}<br><span class="quiet">${esc(customer.phone)}</span></button>`).join("")}${jobs.map((job) => `<button type="button" data-action="open-job" data-id="${esc(job.id)}" data-clear-search="yes">${esc(job.title)} · ${esc(job.customerName)}<br><span class="quiet">${esc(formatWhen(job.scheduledStart))}</span></button>`).join("")}</div>`;
}

function table(headers, rows, emptyText = "Nothing in this list yet.") {
  return `<table class="data-table"><thead><tr>${headers.map((header) => `<th>${header}</th>`).join("")}</tr></thead><tbody>${rows.join("") || `<tr><td colspan="${headers.length}">${emptyText}</td></tr>`}</tbody></table>`;
}

function jobCards(jobs) {
  return jobs.map((job) => `<button class="job-card ${job.status === "in_progress" ? "progress" : job.status === "done" ? "done" : ""}" type="button" data-action="open-job" data-id="${esc(job.id)}">
    <span class="row"><strong>${esc(formatTime(job.scheduledStart))} – ${esc(formatTime(job.scheduledEnd))}</strong>${statusPill(job.status)}</span>
    <strong>${esc(job.title)} · ${esc(job.customerName)}</strong>
    <span>${esc(job.addressLine)}</span>
    <span class="money">${money(job.totalCents)}${job.priceLocked ? " · Price locked" : ""}</span>
  </button>`).join("");
}

function jobLine(job) {
  return `<button class="ghost" type="button" data-action="open-job" data-id="${esc(job.id)}">${esc(formatTime(job.scheduledStart))} · ${esc(job.customerName)} · ${esc(job.title)} · ${money(job.totalCents)}</button>`;
}

function lineTable(items, total) {
  return `<table class="lines"><thead><tr><th>Description</th><th>Amount</th></tr></thead><tbody>${(items || []).map((item) => `<tr><td>${esc(item.description)}</td><td>${money(item.amountCents)}</td></tr>`).join("")}</tbody><tfoot><tr><th>Total</th><th>${money(total)}</th></tr></tfoot></table>`;
}

function statusPill(status) {
  const labels = { in_progress: "In progress", scheduled: "Scheduled", done: "Done", issued: "Open", paid: "Paid", draft: "Draft", accepted: "Accepted", declined: "Declined", sent: "Sent" };
  return `<span class="status ${esc(status)}">${esc(labels[status] || status)}</span>`;
}

function stat(label, value) {
  return `<div class="stat"><span class="quiet">${label}</span><strong>${value}</strong></div>`;
}

function empty(text) {
  return `<p class="quiet">${esc(text)}</p>`;
}

function customerFields() {
  return `<label>Customer <select name="customerId" data-customer data-action="pick-customer">${options(state.customers, (customer) => [customer.id, `${customer.firstName} ${customer.lastName}`])}</select></label><label>Address <select name="addressId" data-addresses></select></label>`;
}

function fillAddresses(customerId) {
  const select = document.querySelector("[data-addresses]");
  if (!select) return;
  const customer = state.customers.find((item) => item.id === customerId);
  select.innerHTML = (customer?.addresses ?? []).map((address) => `<option value="${esc(address.id)}">${esc(address.line1)}, ${esc(address.postalCode)}</option>`).join("");
}

function crewNames(ids) {
  if (!ids?.length) return "Unassigned";
  return ids.map((id) => state.technicians.find((tech) => tech.id === id)?.name || "Crew").join(", ");
}

function colorFor(id) {
  const index = Math.max(0, state.technicians.findIndex((tech) => tech.id === id));
  return CREW_COLORS[index % CREW_COLORS.length];
}

function jobsOn(day) {
  return state.jobs.filter((job) => denverDate(new Date(job.scheduledStart)) === day && crewVisible(job) && textMatch(`${job.customerName} ${job.title} ${job.addressLine} ${job.phone}`));
}

function crewVisible(job) {
  if (!job.technicianIds.length) return state.showUnassigned;
  return job.technicianIds.some((id) => state.crewOn[id] !== false);
}

function textMatch(text) {
  const q = state.query.trim().toLowerCase();
  if (!q) return true;
  return String(text).toLowerCase().includes(q);
}

function tileBox(job) {
  const start = minutesDenver(job.scheduledStart);
  const duration = Math.max(15, Math.round((new Date(job.scheduledEnd) - new Date(job.scheduledStart)) / 60000));
  if (start < START_MIN || start >= END_MIN) return null;
  const top = ((start - START_MIN) / 60) * HOUR_PX;
  const height = Math.min(Math.max(22, (duration / 60) * HOUR_PX), ((END_MIN - START_MIN) / 60) * HOUR_PX - top);
  return { top, height };
}

function minutesDenver(iso) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Denver", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(iso));
  const part = (type) => Number(parts.find((item) => item.type === type)?.value ?? "0");
  return part("hour") * 60 + part("minute");
}

function rangeLabel() {
  if (state.cal === "month") return formatMonth(state.focusDate);
  if (state.cal === "week") {
    const start = mondayOf(state.focusDate);
    return `${formatDay(start)} – ${formatDay(addDays(start, 6))}`;
  }
  return formatDay(state.focusDate);
}

function monthGrid(isoDate) {
  const [year, month] = isoDate.split("-").map(Number);
  const first = `${year}-${String(month).padStart(2, "0")}-01`;
  const start = mondayOf(first);
  return { label: formatMonth(first), days: Array.from({ length: 42 }, (_, index) => addDays(start, index)) };
}

async function loadReport(from = addDays(denverDate(), -30), to = addDays(denverDate(), 1)) {
  state.report = await api(`/api/reports?from=${from}&to=${to}`);
}

function options(items, map) {
  return items.map((item) => {
    const [value, label] = map(item);
    return `<option value="${esc(value)}">${esc(label)}</option>`;
  }).join("");
}

function money(cents) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format((cents ?? 0) / 100);
}

function dollarsToCents(value) {
  const amount = Number(String(value).replace(/[$,]/g, ""));
  if (!Number.isFinite(amount)) throw new Error("Enter a dollar amount.");
  return Math.round(amount * 100);
}

function formatWhen(iso) {
  return new Intl.DateTimeFormat("en-US", { timeZone: "America/Denver", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(iso));
}

function formatTime(iso) {
  return new Intl.DateTimeFormat("en-US", { timeZone: "America/Denver", hour: "numeric", minute: "2-digit" }).format(new Date(iso));
}

function formatDay(isoDate) {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(year, month - 1, day)));
}

function formatMonth(isoDate) {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(year, month - 1, day)));
}

function weekdayShort(isoDate) {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" }).format(new Date(Date.UTC(year, month - 1, day)));
}

function hourLabel(hour) {
  const suffix = hour >= 12 ? "PM" : "AM";
  return `${hour % 12 || 12} ${suffix}`;
}

function denverStamp(dateStr, minutes) {
  const hour = String(Math.floor(minutes / 60)).padStart(2, "0");
  const minute = String(minutes % 60).padStart(2, "0");
  return `${dateStr}T${hour}:${minute}`;
}

function addMinutesLocal(dateStr, minutes, plus) {
  const total = minutes + plus;
  const dayShift = Math.floor(total / 1440);
  const mins = ((total % 1440) + 1440) % 1440;
  return denverStamp(addDays(dateStr, dayShift), mins);
}

function denverDate(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Denver", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const part = (type) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function mondayOf(isoDate) {
  const [year, month, day] = isoDate.split("-").map(Number);
  const utc = new Date(Date.UTC(year, month - 1, day));
  const weekday = utc.getUTCDay();
  return addDays(isoDate, weekday === 0 ? -6 : 1 - weekday);
}

function addDays(isoDate, days) {
  const [year, month, day] = isoDate.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

function shiftMonth(isoDate, delta) {
  const [year, month, day] = isoDate.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1 + delta, 1));
  const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), Math.min(day, last))).toISOString().slice(0, 10);
}

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

function svg(name) {
  const paths = {
    home: "M4 11 L12 4 L20 11 V20 H15 V14 H9 V20 H4 Z",
    calendar: "M5 5 H19 V19 H5 Z M5 9 H19 M8 3 V7 M16 3 V7",
    people: "M9 11 A3 3 0 1 0 9 5 A3 3 0 1 0 9 11 M16 11 A2.5 2.5 0 1 0 16 6 A2.5 2.5 0 1 0 16 11 M4 19 C4 16 6.5 14 9 14 C11.5 14 14 16 14 19 M14 14.5 C16 14.2 18 15.5 18 18.5",
    briefcase: "M8 7 V5 H16 V7 M4 7 H20 V19 H4 Z",
    clipboard: "M8 4 H16 V7 H8 Z M7 6 H5 V20 H19 V6 H17",
    card: "M3 7 H21 V17 H3 Z M3 11 H21",
    chart: "M4 19 H20 M7 16 V10 M12 16 V6 M17 16 V12",
    crew: "M8 12 A3 3 0 1 0 8 6 A3 3 0 1 0 8 12 M16 11 A2.5 2.5 0 1 0 16 6 M3 19 C3 16 5.2 14 8 14 C10.8 14 13 16 13 19 M14 14 C16.2 14 18 15.6 18 18",
    tray: "M4 8 H20 V18 H4 Z M4 14 H9 L10 16 H14 L15 14 H20",
    collapse: "M8 6 L4 12 L8 18 M16 6 L20 12 L16 18",
  };
  if (name === "more") {
    return `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="6" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="18" cy="12" r="1.4"/></svg>`;
  }
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true">${(paths[name] || "").split(" M").map((part, index) => `<path d="${index ? "M" : ""}${part}"/>`).join("")}</svg>`;
}

async function fileToBase64(file) {
  const data = await file.arrayBuffer();
  let binary = "";
  const bytes = new Uint8Array(data);
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: "same-origin",
    ...options,
    headers: { "content-type": "application/json", ...(options.headers || {}) },
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : {};
  if (response.status === 401 && path !== "/api/login") {
    state.session = null;
    render();
    throw new Error(body.error?.message || "Sign in required.");
  }
  if (!response.ok) throw new Error(body.error?.message || "Request failed.");
  return body;
}
