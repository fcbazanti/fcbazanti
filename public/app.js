// sdílené drobnosti
const $ = (sel) => document.querySelector(sel);
const msg = (el, type, text) => {
  el.innerHTML = `<div class="${type}">${text}</div>`;
};

// rok v patičce
const y = document.getElementById('year');
if (y) y.textContent = new Date().getFullYear();

// Tabs (záložky)
const tabs = document.querySelectorAll('.tab');
const contents = document.querySelectorAll('.tab-content');
if (tabs.length) {
  tabs.forEach(t => {
    t.addEventListener('click', (e) => {
      const target = t.getAttribute('data-tab');
      if (!target) return; // pro odkaz na /admin.html
      tabs.forEach(x => x.classList.remove('active'));
      t.classList.add('active');
      contents.forEach(c => c.classList.remove('active'));
      const el = document.getElementById(`tab-${target}`);
      if (el) el.classList.add('active');
      document.getElementById('tabs').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });
}

// Odeslání rezervace
const form = document.getElementById('bookForm');
if (form) {
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = {
      class: form.class.value,
      name: form.name.value,
      email: form.email.value,
    };
    const msgEl = document.getElementById('msg');
    msg(msgEl, 'notice', 'Odesílám…');
    try {
      const res = await fetch('/api/book', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      const j = await res.json();
      if (j.ok) {
        msg(msgEl, 'success', `Hotovo! ID rezervace: ${j.id}.`);
        form.reset();
      } else {
        msg(msgEl, 'error', j.error || 'Něco se nepovedlo.');
      }
    } catch (err) {
      msg(msgEl, 'error', 'Chyba spojení se serverem.');
    }
  });
}

// Admin login a práce s rezervacemi
const loginBtn = document.getElementById('loginBtn');
if (loginBtn) {
  const loginBox = document.getElementById('loginBox');
  const adminArea = document.getElementById('adminArea');
  const loginMsg = document.getElementById('loginMsg');
  const rezTbody = document.querySelector('#rezTable tbody');

  async function loadReservations() {
    const res = await fetch('/api/reservations');
    const j = await res.json();
    if (!j.ok) {
      msg(loginMsg, 'error', j.error || 'Nelze načíst rezervace.');
      return;
    }
    rezTbody.innerHTML = '';
    j.reservations.forEach(r => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${r.id}</td>
        <td>${r.class}</td>
        <td>${r.name}</td>
        <td>${r.email}</td>
        <td>${new Date(r.created_at).toLocaleString()}</td>
        <td><button data-id="${r.id}" class="secondary del">Smazat</button></td>`;
      rezTbody.appendChild(tr);
    });
  }

  loginBtn.addEventListener('click', async () => {
    const password = document.getElementById('password').value;
    const res = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password })
    });
    const j = await res.json();
    if (j.ok) {
      loginBox.style.display = 'none';
      adminArea.style.display = 'block';
      await loadReservations();
    } else {
      msg(loginMsg, 'error', j.error || 'Špatné heslo.');
    }
  });

  document.getElementById('logoutBtn').addEventListener('click', async () => {
    await fetch('/api/admin/logout', { method: 'POST' });
    location.reload();
  });

  document.addEventListener('click', async (e) => {
    if (e.target.classList.contains('del')) {
      const id = e.target.getAttribute('data-id');
      if (confirm(`Smazat rezervaci #${id}?`)) {
        const res = await fetch(`/api/reservations/${id}`, { method: 'DELETE' });
        const j = await res.json();
        if (j.ok) await loadReservations();
      }
    }
  });
}