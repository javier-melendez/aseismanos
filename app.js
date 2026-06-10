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

function normalizeCode(code) {
  return code.trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
}

function codePool() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const codes = [];

  for (let index = 0; index < 10000; index += 1) {
    let value = ((index + 1) * 2654435761) >>> 0;
    let code = "";
    for (let charIndex = 0; charIndex < 6; charIndex += 1) {
      value = (value * 1664525 + 1013904223) >>> 0;
      code += alphabet[value % alphabet.length];
    }
    codes.push(code);
  }

  return [...new Set(codes)];
}

async function api(method, payload = {}) {
  if (state.demoMode) return demoApi(method, payload);

  const { data, error } = await state.client.rpc(method, payload);
  if (error) throw new Error(error.message);
  return data;
}

async function demoApi(method, payload) {
  await new Promise((resolve) => window.setTimeout(resolve, 120));

  if (method === "get_customer_summary") {
    const customer = demoDb.customers[payload.p_customer_id] || { paid_count: 0, free_count: 0, log: [] };
    return customer;
  }

  if (method === "redeem_lunch_code") {
    const code = normalizeCode(payload.p_code);
    const item = demoDb.codes.find((entry) => entry.code === code);
    if (!item) throw new Error("Código inexistente.");
    if (item.used_at) throw new Error("Este código ya fue usado.");

    const customer = demoDb.customers[payload.p_customer_id] || { paid_count: 0, free_count: 0, log: [] };
    customer.paid_count += 1;
    if (customer.paid_count >= 10) {
      customer.paid_count -= 10;
      customer.free_count += 1;
    }
    customer.log.unshift({
      label: "Almuerzo registrado",
      happened_at: new Date().toISOString(),
      code,
    });
    item.used_at = new Date().toISOString();
    item.used_by = payload.p_customer_id;
    demoDb.customers[payload.p_customer_id] = customer;
    persistDemo();
    return customer;
  }

  if (method === "create_lunch_code") {
    if (!state.isAdmin) throw new Error("Debes iniciar sesión como administrador.");
    const pool = codePool();
    const used = new Set(demoDb.codes.map((entry) => entry.code));
    const code = pool.find((candidate) => !used.has(candidate));
    if (!code) throw new Error("No quedan códigos disponibles.");

    const item = {
      code,
      used_at: null,
      used_by: null,
      created_at: new Date().toISOString(),
    };
    demoDb.codes.unshift(item);
    persistDemo();
    return item;
  }

  if (method === "list_lunch_codes") {
    if (!state.isAdmin) throw new Error("Debes iniciar sesión como administrador.");
    return demoDb.codes.slice(0, 30);
  }

  if (method === "redeem_free_lunch") {
    if (!state.isAdmin) throw new Error("Debes iniciar sesión como administrador.");
    const customer = demoDb.customers[payload.p_customer_id];
    if (!customer || customer.free_count < 1) {
      throw new Error("Este cliente no tiene almuerzos gratis disponibles.");
    }
    customer.free_count -= 1;
    customer.log.unshift({
      label: "Almuerzo gratis entregado",
      happened_at: new Date().toISOString(),
      code: null,
    });
    persistDemo();
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

function renderAdminCodes(codes) {
  $("#adminCodes").innerHTML =
    codes.length === 0
      ? '<tr><td colspan="4">No hay códigos creados.</td></tr>'
      : codes
          .map((item) => {
            const status = item.used_at ? "Usado" : "Disponible";
            return `<tr>
              <td><strong>${item.code}</strong></td>
              <td>${new Date(item.created_at).toLocaleDateString("es-CO")}</td>
              <td>${status}</td>
              <td>${item.used_by || "-"}</td>
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

async function loadAdminCodes() {
  const codes = await api("list_lunch_codes");
  renderAdminCodes(codes || []);
}

async function restoreAdminSession() {
  if (state.demoMode) return;

  const { data } = await state.client.auth.getSession();
  if (!data.session) return;

  state.isAdmin = true;
  $("#adminArea").hidden = false;
  await loadAdminCodes();
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

  $("#redeemForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!state.customerId) return;
    const code = normalizeCode($("#promoCode").value);
    $("#promoCode").value = code;
    try {
      const summary = await api("redeem_lunch_code", {
        p_customer_id: state.customerId,
        p_code: code,
      });
      renderCustomer(summary);
      $("#promoCode").value = "";
      showToast("Almuerzo registrado.");
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
      await loadAdminCodes();
      showToast("Admin activo.");
    } catch (error) {
      showToast(error.message);
    }
  });

  $("#createCodeButton").addEventListener("click", async () => {
    try {
      const item = await api("create_lunch_code");
      $("#generatedCode").hidden = false;
      $("#generatedCode strong").textContent = item.code;
      await loadAdminCodes();
      showToast("Código creado.");
    } catch (error) {
      showToast(error.message);
    }
  });

  $("#refreshAdmin").addEventListener("click", async () => {
    try {
      await loadAdminCodes();
      showToast("Listado actualizado.");
    } catch (error) {
      showToast(error.message);
    }
  });

  $("#freeLunchForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await api("redeem_free_lunch", {
        p_customer_id: $("#freeCustomerId").value.trim(),
      });
      if ($("#freeCustomerId").value.trim() === state.customerId) {
        await loadCustomer();
      }
      $("#freeCustomerId").value = "";
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
