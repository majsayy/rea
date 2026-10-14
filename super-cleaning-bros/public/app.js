const state = {
  health: null,
  authRequired: false,
  session: null,
  view: "schedule",
  error: "",
  notice: "",
  technicians: [],
  customers: [],
  estimates: [],
  jobs: [],
  job: null,
  report: null,
  events: [],
  weekStart: mondayOf(denverDate()),
  techFilter: localStorage.getItem("scb-tech") || "",
};

const app = document.querySelector("#app");
document.body.addEventListener("click", (event) => {
  const target = event.target.closest("[data-action]");
  if (!target) return;
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
  if (!(target instanceof HTMLSelectElement) || target.dataset.action !== "pick-customer") return;
  fillAddresses(target.value);
});

await boot();

async function boot() {
  state.health = await api("/api/health");
  const session = await api("/api/session");
  state.authRequired = session.authRequired;
  state.session = session.session;
  if (state.session) await refresh();
  render();
}

async function refresh() {
  if (state.session?.role === "technician") state.view = state.view === "schedule" ? "tech" : state.view;
  const from = state.weekStart;
  const to = addDays(from, 7);
  const jobs = await api(`/api/jobs?from=${from}&to=${to}`);
  state.jobs = jobs.jobs;
  if (state.session?.role !== "technician") {
    state.technicians = (await api("/api/technicians")).technicians;
    state.customers = (await api("/api/customers")).customers;
    state.estimates = (await api("/api/estimates")).estimates;
  }
}

async function onClick(target, event) {
  const action = target.dataset.action;
  state.error = "";
  try {
    if (action === "nav") {
      state.view = target.dataset.view;
      state.job = null;
      if (state.view === "reports") await loadReport();
      if (state.view === "import") state.events = (await api("/api/ghl/events")).events;
      render();
    } else if (action === "week") {
      state.weekStart = addDays(state.weekStart, Number(target.dataset.days));
      await refresh();
      render();
    } else if (action === "open-job") {
      state.job = await api(`/api/jobs/${target.dataset.id}`);
      state.view = "job";
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
    } else if (action === "invoice") {
      const result = await api(`/api/jobs/${state.job.job.id}/invoice`, { method: "POST", body: "{}" });
      state.notice = `Invoice ${result.invoice.number} is ready.`;
      state.job = await api(`/api/jobs/${state.job.job.id}`);
      render();
    } else if (action === "charge") {
      const result = await api(`/api/invoices/${state.job.invoice.id}/charge`, { method: "POST", body: "{}" });
      state.notice = result.payment.provider === "manual"
        ? "Payment recorded locally. No card was sent to a processor."
        : "Card payment captured.";
      state.job = await api(`/api/jobs/${state.job.job.id}`);
      render();
    } else if (action === "logout") {
      await api("/api/logout", { method: "POST", body: "{}" });
      state.session = null;
      render();
    }
  } catch (error) {
    state.error = error.message;
    render();
  }
  event.preventDefault();
}

async function onSubmit(form) {
  state.error = "";
  const data = Object.fromEntries(new FormData(form).entries());
  try {
    if (form.dataset.form === "login-office") {
      state.session = await api("/api/login", { method: "POST", body: JSON.stringify({ password: data.password }) });
      await refresh();
    } else if (form.dataset.form === "login-tech") {
      state.session = await api("/api/login", { method: "POST", body: JSON.stringify({ name: data.name, pin: data.pin }) });
      state.view = "tech";
      await refresh();
    } else if (form.dataset.form === "technician") {
      await api("/api/technicians", {
        method: "POST",
        body: JSON.stringify({ name: data.name, phone: data.phone, pin: data.pin }),
      });
      state.notice = "Crew member added.";
      await refresh();
    } else if (form.dataset.form === "customer") {
      const result = await api("/api/customers", {
        method: "POST",
        body: JSON.stringify({
          firstName: data.firstName,
          lastName: data.lastName,
          phone: data.phone,
          email: data.email,
          address: {
            line1: data.line1,
            city: data.city,
            state: data.state,
            postalCode: data.postalCode,
          },
        }),
      });
      state.notice = result.matchedExisting
        ? `Matched an existing customer by ${result.matchedOn.join(" and ") || "GoHighLevel id"}.`
        : "Customer saved.";
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
      await refresh();
    } else if (form.dataset.form === "note") {
      await api(`/api/jobs/${state.job.job.id}/notes`, {
        method: "POST",
        body: JSON.stringify({ body: data.body }),
      });
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
    } else if (form.dataset.form === "tech-filter") {
      state.techFilter = data.techId;
      localStorage.setItem("scb-tech", state.techFilter);
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
  const tech = state.session?.role === "technician";
  app.innerHTML = `
    <main class="shell">
      <header class="topbar">
        <div class="brand">
          <strong>Super Cleaning Bros</strong>
          <span>Field service · Erie, CO 80516</span>
        </div>
        <nav class="nav">
          ${tech ? "" : nav("schedule", "Schedule")}
          ${tech ? "" : nav("customers", "Customers")}
          ${tech ? "" : nav("estimates", "Estimates")}
          ${tech ? "" : nav("reports", "Reports")}
          ${tech ? "" : nav("import", "Import")}
          ${nav("tech", "Crew phone")}
          ${state.authRequired ? `<button type="button" data-action="logout">Sign out</button>` : ""}
        </nav>
      </header>
      ${state.health?.payments === "manual" ? `<div class="banner">Payments are in local practice mode. A card on file is not sent to Stripe until STRIPE_SECRET_KEY is set.</div>` : ""}
      ${state.error ? `<div class="error">${esc(state.error)}</div>` : ""}
      ${state.notice ? `<div class="notice">${esc(state.notice)}</div>` : ""}
      ${view()}
    </main>`;
  if (state.view === "estimates" || state.view === "schedule") fillAddresses(document.querySelector("[data-customer]")?.value || "");
}

function view() {
  if (state.view === "customers") return customersView();
  if (state.view === "estimates") return estimatesView();
  if (state.view === "reports") return reportsView();
  if (state.view === "import") return importView();
  if (state.view === "tech") return techView();
  if (state.view === "job" && state.job) return jobView();
  return scheduleView();
}

function scheduleView() {
  return `
    <section class="day">
      <div class="row">
        <button type="button" data-action="week" data-days="-7">Previous week</button>
        <strong>Week of ${esc(state.weekStart)}</strong>
        <button type="button" data-action="week" data-days="7">Next week</button>
      </div>
      ${weekDays()}
    </section>
    <section class="panel stack" style="margin-top:16px">
      <h2>Schedule a job</h2>
      <form class="stack" data-form="job">
        ${customerFields()}
        <label>Title <input name="title" value="Cleaning" required /></label>
        <div class="grid">
          <label>Start <input name="start" type="datetime-local" required /></label>
          <label>End <input name="end" type="datetime-local" required /></label>
        </div>
        <label>Accepted estimate
          <select name="estimateId">
            <option value="">Price this job now</option>
            ${state.estimates.filter((estimate) => estimate.status === "accepted").map((estimate) => `<option value="${esc(estimate.id)}">${esc(estimate.customerName)} · ${money(estimate.totalCents)}</option>`).join("")}
          </select>
        </label>
        <label>Service price in dollars, if there is no accepted estimate <input name="dollars" inputmode="decimal" placeholder="180" /></label>
        <div class="row">${state.technicians.map((tech) => `<label class="row"><input type="checkbox" name="technician" value="${esc(tech.id)}" /> ${esc(tech.name)}</label>`).join("") || "<span class='quiet'>Add crew from the customer page area below.</span>"}</div>
        <button class="primary" type="submit">Schedule</button>
      </form>
      <form class="row" data-form="technician">
        <input name="name" placeholder="Crew name" required />
        <input name="pin" placeholder="PIN" required minlength="4" />
        <button type="submit">Add crew</button>
      </form>
    </section>`;
}

function weekDays() {
  const days = Array.from({ length: 7 }, (_, index) => addDays(state.weekStart, index));
  return days.map((day) => {
    const jobs = state.jobs.filter((job) => denverDate(new Date(job.scheduledStart)) === day);
    return `<div class="day"><h3>${esc(day)}</h3>${jobs.map(jobCard).join("") || "<p class='quiet'>No jobs.</p>"}</div>`;
  }).join("");
}

function jobCard(job) {
  return `<button class="card job" type="button" data-action="open-job" data-id="${esc(job.id)}">
    <strong>${esc(job.title)} · ${esc(job.customerName)}</strong>
    <span>${esc(formatWhen(job.scheduledStart))} – ${esc(formatWhen(job.scheduledEnd))}</span>
    <span>${esc(job.addressLine)}</span>
    <span class="row"><span class="pill ${job.status === "done" ? "done" : job.status === "in_progress" ? "progress" : ""}">${esc(job.status.replace("_", " "))}</span><span class="money">${money(job.totalCents)}</span>${job.priceLocked ? "<span class='quiet'>Price locked</span>" : ""}</span>
  </button>`;
}

function customersView() {
  return `<div class="grid">
    <form class="panel stack" data-form="customer">
      <h2>New customer</h2>
      <label>First name <input name="firstName" /></label>
      <label>Last name <input name="lastName" required /></label>
      <label>Phone <input name="phone" required /></label>
      <label>Email <input name="email" type="email" /></label>
      <label>Street <input name="line1" required /></label>
      <div class="grid">
        <label>City <input name="city" value="Erie" required /></label>
        <label>State <input name="state" value="CO" required /></label>
        <label>ZIP <input name="postalCode" value="80516" required /></label>
      </div>
      <button class="primary" type="submit">Save customer</button>
    </form>
    <div class="stack">
      ${state.customers.map((customer) => `<article class="card person">
        <strong>${esc(customer.firstName)} ${esc(customer.lastName)}</strong>
        <span>${esc(customer.phone)}</span>
        <span>${customer.addresses.map((address) => esc(`${address.line1}, ${address.city} ${address.postalCode}`)).join("<br>")}</span>
        <span class="quiet">${customer.cardOnFile ? "Card on file" : "No card on file"} ${customer.ghlContactId ? "· Synced to GoHighLevel" : ""}</span>
      </article>`).join("") || "<p class='quiet'>No customers yet.</p>"}
      <form class="panel stack" data-form="card">
        <h2>Card on file</h2>
        <p class="quiet">Store the provider's customer and payment-method ids. Do not type a card number.</p>
        <label>Customer <select name="customerId">${options(state.customers, (customer) => [customer.id, `${customer.firstName} ${customer.lastName}`])}</select></label>
        <label>Provider customer id <input name="providerCustomerId" required /></label>
        <label>Payment method id <input name="providerPaymentMethodId" required /></label>
        <div class="grid"><label>Brand <input name="brand" /></label><label>Last 4 <input name="last4" maxlength="4" /></label></div>
        <button type="submit">Save card reference</button>
      </form>
    </div>
  </div>`;
}

function estimatesView() {
  return `<div class="grid">
    <form class="panel stack" data-form="estimate">
      <h2>New estimate</h2>
      ${customerFields()}
      <label>Description <input name="description" value="Standard clean" required /></label>
      <label>Service price in dollars <input name="dollars" inputmode="decimal" required /></label>
      <button class="primary" type="submit">Save estimate</button>
    </form>
    <div class="stack">
      ${state.estimates.map((estimate) => `<article class="card">
        <strong>${esc(estimate.customerName)}</strong>
        <div>${esc(estimate.lineItems.map((item) => item.description).join(", "))}</div>
        <div class="money">${money(estimate.totalCents)} ${estimate.travelFeeCents ? `including ${money(estimate.travelFeeCents)} travel` : ""}</div>
        <div class="quiet">${estimate.driveMinutes === null ? "Drive time unknown" : `${estimate.driveMinutes} min from Erie`} · ${esc(estimate.travelBasis)}</div>
        ${estimate.priceLocked ? "<div>Keeps a previously accepted price.</div>" : ""}
        ${estimate.travelReviewRequired ? "<div class='error'>Confirm drive time before accepting.</div>" : ""}
        <div class="row"><span class="pill">${esc(estimate.status)}</span>
          ${estimate.status === "draft" ? `<button type="button" data-action="accept-estimate" data-id="${esc(estimate.id)}">Accept price</button>` : ""}
        </div>
      </article>`).join("") || "<p class='quiet'>No estimates yet.</p>"}
    </div>
  </div>`;
}

function jobView() {
  const { job, customer, address, notes, photos, invoice, charge } = state.job;
  const tech = state.session?.role === "technician";
  return `<section class="panel stack">
    <div class="row"><button type="button" data-action="nav" data-view="${tech ? "tech" : "schedule"}">Back</button><h2>${esc(job.title)}</h2></div>
    <p><strong>${esc(customer.firstName)} ${esc(customer.lastName)}</strong><br>${esc(customer.phone)}<br>${esc(address.line1)}, ${esc(address.city)} ${esc(address.state)} ${esc(address.postalCode)}</p>
    <p>${esc(formatWhen(job.scheduledStart))} – ${esc(formatWhen(job.scheduledEnd))}</p>
    <p class="money">${money(job.totalCents)} ${job.priceLocked ? "· accepted price is locked" : ""} ${job.travelFeeCents ? `· travel ${money(job.travelFeeCents)}` : ""}</p>
    <div class="row tech-actions">
      ${job.status === "scheduled" ? `<button class="primary" type="button" data-action="status" data-status="in_progress">Start job</button>` : ""}
      ${job.status === "in_progress" ? `<button class="primary" type="button" data-action="status" data-status="done">Mark done</button>` : ""}
      ${job.postWalkthroughComplete ? "<span class='pill done'>Walkthrough complete</span>" : `<button type="button" data-action="walkthrough" data-value="yes">Walkthrough done</button>`}
    </div>
    <h3>Notes</h3>
    ${notes.map((note) => `<p><strong>${esc(note.authorName)}</strong> · ${esc(formatWhen(note.createdAt))}<br>${esc(note.body)}</p>`).join("") || "<p class='quiet'>No notes yet.</p>"}
    <form class="stack" data-form="note"><label>Note for the crew <textarea name="body" required></textarea></label><button type="submit">Add note</button></form>
    <h3>Before and after</h3>
    <div class="photos">${photos.map((photo) => `<img alt="${esc(photo.kind)} photo" src="/api/jobs/${job.id}/photos/${photo.id}" />`).join("")}</div>
    <form class="row" data-form="photo">
      <select name="kind"><option value="before">Before</option><option value="after">After</option><option value="walkthrough">Walkthrough</option></select>
      <input type="file" accept="image/jpeg,image/png,image/webp" required />
      <button type="submit">Upload</button>
    </form>
    ${tech ? "" : `<h3>Invoice</h3>
      ${invoice ? `<p>${esc(invoice.number)} · ${money(invoice.totalCents)} · ${esc(invoice.status)}</p>` : `<button type="button" data-action="invoice">Create invoice</button>`}
      ${invoice && invoice.status !== "paid" ? `<button class="primary" type="button" data-action="charge" ${charge.ok ? "" : "disabled"}>Charge card on file</button>` : ""}
      ${charge.ok ? "" : `<p class="quiet">${esc(charge.message)}</p>`}`}
  </section>`;
}

function techView() {
  const mine = state.session?.role === "technician"
    ? state.jobs
    : state.jobs.filter((job) => !state.techFilter || job.technicianIds.includes(state.techFilter));
  return `<section class="stack">
    <h2>Today and this week</h2>
    ${state.session?.role === "technician" ? "" : `<form class="row" data-form="tech-filter"><label>Show crew <select name="techId"><option value="">Everyone</option>${state.technicians.map((tech) => `<option value="${esc(tech.id)}" ${tech.id === state.techFilter ? "selected" : ""}>${esc(tech.name)}</option>`).join("")}</select></label><button type="submit">Filter</button></form>`}
    ${mine.map(jobCard).join("") || "<p class='quiet'>Nothing assigned in this week.</p>"}
  </section>`;
}

function reportsView() {
  const today = denverDate();
  const report = state.report;
  return `<section class="stack">
    <form class="row" data-form="report">
      <label>From <input type="date" name="from" value="${esc(report ? denverDate(new Date(report.from)) : addDays(today, -30))}" /></label>
      <label>To <input type="date" name="to" value="${today}" /></label>
      <button type="submit">Run report</button>
    </form>
    ${report ? `<div class="stats">
      ${stat("Jobs", report.jobs)}
      ${stat("Done", report.jobsByStatus.done)}
      ${stat("Collected", money(report.collectedCents))}
      ${stat("Outstanding", money(report.outstandingCents))}
      ${stat("Travel fees", money(report.travelFeesCents))}
      ${stat("Average completed", money(report.averageCompletedTicketCents))}
    </div>` : "<p class='quiet'>Choose a range.</p>"}
  </section>`;
}

function importView() {
  return `<section class="grid">
    <form class="panel stack" data-form="import">
      <h2>Import from a spreadsheet</h2>
      <p class="quiet">Use the column guide in the migration note. Cards and photos do not transfer.</p>
      <input type="file" accept=".csv,text/csv" />
      <textarea name="csv" placeholder="First Name,Last Name,Mobile Number,Address,City,State,Zip"></textarea>
      <button class="primary" type="submit">Import</button>
    </form>
    <div class="panel">
      <h2>GoHighLevel activity</h2>
      ${state.events.map((event) => `<p><strong>${esc(event.eventType)}</strong> · ${esc(event.status)}<br><span class="quiet">${esc(event.detail || "")}</span></p>`).join("") || "<p class='quiet'>No sync events yet.</p>"}
    </div>
  </section>`;
}

function loginView() {
  return `<main class="shell login panel stack">
    <div class="brand"><strong>Super Cleaning Bros</strong><span>Erie, CO</span></div>
    ${state.error ? `<div class="error">${esc(state.error)}</div>` : ""}
    <form class="stack" data-form="login-office"><h2>Office</h2><label>Password <input type="password" name="password" required /></label><button class="primary" type="submit">Sign in</button></form>
    <form class="stack" data-form="login-tech"><h2>Crew</h2><label>Name <input name="name" required /></label><label>PIN <input name="pin" required /></label><button type="submit">Open my jobs</button></form>
  </main>`;
}

function customerFields() {
  return `<label>Customer <select name="customerId" data-customer data-action="pick-customer">${options(state.customers, (customer) => [customer.id, `${customer.firstName} ${customer.lastName}`])}</select></label>
    <label>Address <select name="addressId" data-addresses></select></label>`;
}

function fillAddresses(customerId) {
  const select = document.querySelector("[data-addresses]");
  if (!select) return;
  const customer = state.customers.find((item) => item.id === customerId);
  select.innerHTML = (customer?.addresses ?? []).map((address) => `<option value="${esc(address.id)}">${esc(address.line1)}, ${esc(address.postalCode)}</option>`).join("");
}

async function loadReport(from = addDays(denverDate(), -30), to = addDays(denverDate(), 1)) {
  state.report = await api(`/api/reports?from=${from}&to=${to}`);
}

function nav(view, label) {
  return `<button type="button" data-action="nav" data-view="${view}" aria-current="${state.view === view ? "page" : "false"}">${label}</button>`;
}

function options(items, map) {
  return items.map((item) => {
    const [value, label] = map(item);
    return `<option value="${esc(value)}">${esc(label)}</option>`;
  }).join("");
}

function stat(label, value) {
  return `<div><span class="quiet">${label}</span><strong>${value}</strong></div>`;
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
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Denver",
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

function denverDate(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Denver",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
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

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[char]);
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
