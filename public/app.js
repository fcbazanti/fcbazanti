const $ = (sel) => document.querySelector(sel);

const msg = (el, type, text) => {
  el.innerHTML = `<div class="${type}">${text}</div>`;
};

const y = document.getElementById('year');
if (y) y.textContent = new Date().getFullYear();

// Tabs
const tabs = document.querySelectorAll('.tab');
const contents = document.querySelectorAll('.tab-content');

if (tabs.length) {
  tabs.forEach(t => {
    t.addEventListener('click', () => {
      const target = t.getAttribute('data-tab');
      if (!target) return;

      tabs.forEach(x => x.classList.remove('active'));
      t.classList.add('active');

      contents.forEach(c => c.classList.remove('active'));

      const el = document.getElementById(`tab-${target}`);
      if (el) el.classList.add('active');

      document.getElementById('tabs').scrollIntoView({ 
        behavior: 'smooth', 
        block: 'start' 
      });
    });
  });
}

// Cenový hint podle třídy
const classSelect = document.getElementById('class');
const priceHint = document.getElementById('priceHint');

if (classSelect && priceHint) {
  const map = {
    '1. třída': '80 Kč / zápas, permanentka 1000 Kč',
    '2. třída': '35 Kč / zápas, permanentka 500 Kč',
    '3. třída': '20 Kč / zápas, permanentka 250 Kč',
  };

  const upd = () => {
    priceHint.textContent = map[classSelect.value] || '';
  };

  classSelect.addEventListener('change', upd);
  upd();
}

// Odeslání rezervace
const form = document.getElementById('bookForm');
if (form) {
  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const data = {
      class: form.class.value,
      name: form.name.value,
      email: form.email.value
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
    } catch {
      msg(msgEl, 'error', 'Chyba spojení se serverem.');
    }
  });
}

// Veřejný kalendář – příští měsíc
const upcomingBox = document.getElementById('upcoming');
if (upcomingBox) {
  (async () => {
    try {
      const res = await fetch('/api/matches/upcoming');
      const j = await res.json();

      if (!j.ok) return;
      if (!j.matches.length) {
        upcomingBox.innerHTML = '<div class="notice">Zatím žádné zápasy pro příští měsíc.</div>';
        return;
      }

      upcomingBox.innerHTML = '';
      j.matches.forEach(m => {
        const d = new Date(m.date + 'T00:00:00');
        const item = document.createElement('div');
        item.className = 'card';
        item.innerHTML = `<strong>${d.toLocaleDateString()}</strong><br>${m.title}`;
        upcomingBox.appendChild(item);
      });

    } catch (e) {
      upcomingBox.innerHTML = '<div class="notice">Nelze načíst kalendář.</div>';
    }
  })();
}

// Admin
const loginBtn = document.getElementById('loginBtn');
if (loginBtn) {
  const loginBox = document.getElementById('loginBox');
  const adminArea = document.getElementById('adminArea');
  const loginMsg = document.getElementById('loginMsg');
  const rezTbody = document.querySelector('#rezTable tbody');
  const matchTbody = document.querySelector('#matchTable tbody');
  const mMsg = document.getElementById('mMsg');

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
        <td><button data-id="${r.id}" class="secondary del-rez">Smazat</button></td>
      `;
      rezTbody.appendChild(tr);
    });
  }

  async function loadMatches() {
    const res = await fetch('/api/matches');
    const j = await res.json();
    if (!j.ok) {
      msg(mMsg, 'error', j.error || 'Nelze načíst zápasy.');
      return;
    }

    matchTbody.innerHTML = '';
    j.matches.forEach(m => {
      const d = new Date(m.date + 'T00:00:00');
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${d.toLocaleDateString()}</td>
        <td>${m.title}</td>
        <td><button data-id="${m.id}" class="secondary del-match">Smazat</button></td>
      `;
      matchTbody.appendChild(tr);
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
      await loadMatches();
    } else {
      msg(loginMsg, 'error', j.error || 'Špatné heslo.');
    }
  });

  document.getElementById('logoutBtn').addEventListener('click', async () => {
    await fetch('/api/admin/logout', { method: 'POST' });
    location.reload();
  });

  document.addEventListener('click', async (e) => {
    if (e.target.classList.contains('del-rez')) {
      const id = e.target.getAttribute('data-id');
      if (confirm(`Smazat rezervaci #${id}?`)) {
        const res = await fetch(`/api/reservations/${id}`, { method: 'DELETE' });
        const j = await res.json();
        if (j.ok) await loadReservations();
      }
    }

    if (e.target.classList.contains('del-match')) {
      const id = e.target.getAttribute('data-id');
      if (confirm(`Smazat zápas #${id}?`)) {
        const res = await fetch(`/api/matches/${id}`, { method: 'DELETE' });
        const j = await res.json();
        if (j.ok) await loadMatches();
      }
    }
  });

  const matchForm = document.getElementById('matchForm');
  matchForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const title = document.getElementById('mTitle').value;
    const date = document.getElementById('mDate').value;

    const res = await fetch('/api/matches', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, date })
    });

    const j = await res.json();
    if (j.ok) {
      msg(mMsg, 'success', 'Zápas přidán.');
      matchForm.reset();
      await loadMatches();
    } else {
      msg(mMsg, 'error', j.error || 'Nepodařilo se přidat.');
    }
  });
}
