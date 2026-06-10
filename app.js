const CONFIG = window.APP_CONFIG || {
  supabaseUrl: "https://YOUR_PROJECT.supabase.co",
  supabaseAnonKey: "YOUR_SUPABASE_ANON_KEY",
};

const $ = (selector) => document.querySelector(selector);
const state = {
  customerId: localStorage.getItem("loyalty_customer_id") || "",
  isAdmin: false,
  client: null,
  demoMode: false,
};

const demoDb = {
  customers: JSON.parse(localStorage.getItem("demo_customers") || "{}"),
  codes: JSON.parse(localStorage.getItem("demo_codes") || "[]"),
};

function persistDemo() {
  localStorage.setItem("demo_customers", JSON.stringify(demoDb.customers));
  localStorage.setItem("demo_codes", JSON.stringify(demoDb.codes));
}

function initSupabase() {
  const ready =
    CONFIG.supabaseUrl.includes(".supabase.co") &&
    !CONFIG.supabaseUrl.includes("YOUR_PROJECT") &&
    CONFIG.supabaseAnonKey !== "YOUR_SUPABASE_ANON_KEY";

  if (!ready || !window.supabase) {
    state.demoMode = true;
    return;
  }

  state.client = window.supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabaseAnonKey);
}

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("is-visible");
  window.setTimeout(() => toast.classList.remove("is-visible"), 3600);
}

function setView(view) {
  const isAdmin = view === "admin";
  $("#clientTab").classList.toggle("is-active", !isAdmin);
  $("#adminTab").classList.toggle("is-active", isAdmin);
  $("#clientView").classList.toggle("is-active", !isAdmin);
  $("#adminView").classList.toggle("is-active", isAdmin);
}

function getDemoCustomer(customerId) {
  return demoDb.customers[customerId] || { paid_count: 0, free_count: 0, log: [] };
}

function saveDemoCustomer(customerId, customer) {
  demoDb.customers[customerId] = customer;
  persistDemo();
}

async function api(method, payload = {}) {
  if (state.demoMode) return demoApi(method, payload);

  const { data, error } = await state.client.rpc(method, payload);
  if (error) throw new Error(error.message);
  return data;
}

async function demoApi(method, payload) {
  await new Promise((resolve) => window.setTimeout(resolve, 120));

  const customerId = payload.p_customer_id;

  if (method === "get_customer_summary") {
    const customer = getDemoCustomer(customerId);
    return customer;
  }

  if (method === "add_paid_lunches") {
    if (!state.isAdmin) throw new Error("Debes iniciar sesión como administrador.");

    const quantity = Number(payload.p_quantity || 0);
    if (!Number.isInteger(quantity) || quantity < 1) {
      throw new Error("Ingresa una cantidad válida.");
    }

    const customer = getDemoCustomer(customerId);
    const totalPaid = customer.paid_count + quantity;
    const freeEarned = Math.floor(totalPaid / 10);

    customer.paid_count = totalPaid % 10;
    customer.free_count += freeEarned;
    customer.log.unshift({
      label: `Se asignaron ${quantity} almuerzos`,
      happened_at: new Date().toISOString(),
      code: null,
    });
    if (freeEarned > 0) {
      customer.log.unshift({
        label: `Se convirtieron ${freeEarned * 10} almuerzos pagos en ${freeEarned} gratis`,
        happened_at: new Date().toISOString(),
        code: null,
      });
    }
    saveDemoCustomer(customerId, customer);
    return customer;
  }

  if (method === "list_customer_events") {
    if (!state.isAdmin) throw new Error("Debes iniciar sesión como administrador.");

    const events = Object.entries(demoDb.customers)
      .flatMap(([id, customer]) =>
        customer.log.map((entry) => ({
          customer_id: id,
          label: entry.label,
          happened_at: entry.happened_at,
        })),
      )
      .sort((a, b) => new Date(b.happened_at) - new Date(a.happened_at));

    return events.slice(0, 30);
  }

  if (method === "redeem_free_lunch") {
    if (!state.isAdmin) throw new Error("Debes iniciar sesión como administrador.");

    const customer = getDemoCustomer(customerId);
    if (customer.free_count < 1) {
      throw new Error("Este cliente no tiene almuerzos gratis disponibles.");
    }

    customer.free_count -= 1;
    customer.log.unshift({
      label: "Almuerzo gratis entregado",
      happened_at: new Date().toISOString(),
      code: null,
    });
    saveDemoCustomer(customerId, customer);
    return customer;
  }

  throw new Error("Método no soportado.");
}

function renderCustomer(summary) {
  const paid = summary.paid_count || 0;
  const free = summary.free_count || 0;
  const remaining = paid === 0 ? 10 : 10 - paid;

  $("#signedOutState").hidden = true;
  $("#customerArea").hidden = false;
  $("#paidCount").textContent = paid;
  $("#freeCount").textContent = free;
  $("#remainingCount").textContent = remaining;
  $("#progressBar").style.width = `${Math.min(100, paid * 10)}%`;

  const log = summary.log || [];
  $("#customerLog").innerHTML =
    log.length === 0
      ? "<li><span>Sin movimientos todavía</span><span></span></li>"
      : log
          .slice(0, 6)
          .map(
            (item) => `<li><span>${item.label || "Movimiento"}</span><span>${new Date(
              item.happened_at,
            ).toLocaleDateString("es-CO")}</span></li>`,
          )
          .join("");
}

function renderAdminEvents(events) {
  $("#adminEvents").innerHTML =
    events.length === 0
      ? '<tr><td colspan="3">No hay movimientos registrados.</td></tr>'
      : events
          .map((item) => {
            return `<tr>
              <td>${item.customer_id}</td>
              <td>${item.label}</td>
              <td>${new Date(item.happened_at).toLocaleDateString("es-CO")}</td>
            </tr>`;
          })
          .join("");
}

async function loadCustomer() {
  if (!state.customerId) return;
  $("#customerId").value = state.customerId;
  const summary = await api("get_customer_summary", { p_customer_id: state.customerId });
  renderCustomer(summary);
}

async function loadAdminEvents() {
  const events = await api("list_customer_events");
  renderAdminEvents(events || []);
}

async function restoreAdminSession() {
  if (state.demoMode) return;

  const { data } = await state.client.auth.getSession();
  if (!data.session) return;

  state.isAdmin = true;
  $("#adminArea").hidden = false;
  await loadAdminEvents();
}

function wireEvents() {
  $("#clientTab").addEventListener("click", () => setView("client"));
  $("#adminTab").addEventListener("click", () => setView("admin"));

  $("#clientForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const customerId = $("#customerId").value.trim();
    if (!/^[0-9A-Za-z.-]{4,30}$/.test(customerId)) {
      showToast("Ingresa una identificación válida.");
      return;
    }
    state.customerId = customerId;
    localStorage.setItem("loyalty_customer_id", customerId);
    try {
      await loadCustomer();
      showToast("Sesión de cliente guardada.");
    } catch (error) {
      showToast(error.message);
    }
  });

  $("#adminLoginForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const email = $("#adminEmail").value.trim();
    const password = $("#adminPassword").value;

    try {
      if (state.demoMode) {
        if (password !== "admin") throw new Error("Contraseña inválida.");
      } else {
        if (!email) throw new Error("Ingresa el correo del administrador.");
        const { error } = await state.client.auth.signInWithPassword({ email, password });
        if (error) throw new Error(error.message);
      }
      state.isAdmin = true;
      $("#adminArea").hidden = false;
      await loadAdminEvents();
      showToast("Admin activo.");
    } catch (error) {
      showToast(error.message);
    }
  });

  $("#assignLunchForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const customerId = $("#assignCustomerId").value.trim();
      const quantity = Number($("#assignQuantity").value);
      const summary = await api("add_paid_lunches", {
        p_customer_id: customerId,
        p_quantity: quantity,
      });
      if (customerId === state.customerId) {
        renderCustomer(summary);
      }
      $("#assignCustomerId").value = "";
      $("#assignQuantity").value = "1";
      await loadAdminEvents();
      showToast("Almuerzos asignados.");
    } catch (error) {
      showToast(error.message);
    }
  });

  $("#refreshAdmin").addEventListener("click", async () => {
    try {
      await loadAdminEvents();
      showToast("Listado actualizado.");
    } catch (error) {
      showToast(error.message);
    }
  });

  $("#freeLunchForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const customerId = $("#freeCustomerId").value.trim();
      const summary = await api("redeem_free_lunch", {
        p_customer_id: customerId,
      });
      if (customerId === state.customerId) {
        renderCustomer(summary);
      }
      $("#freeCustomerId").value = "";
      await loadAdminEvents();
      showToast("Almuerzo gratis marcado como usado.");
    } catch (error) {
      showToast(error.message);
    }
  });
}

initSupabase();
wireEvents();
loadCustomer().catch((error) => showToast(error.message));
restoreAdminSession().catch(() => {
  state.isAdmin = false;
  $("#adminArea").hidden = true;
});

if (state.demoMode) {
  showToast("Modo demo local. Configura Supabase en app.js para persistencia real.");
}
