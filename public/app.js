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

// === NOVINKY (admin) ===
const newsForm = document.getElementById('newsForm');
if (newsForm) {
  const newsMsg = document.getElementById('newsMsg');
  const newsTbody = document.querySelector('#newsTable tbody');

  async function loadNews() {
    const res = await fetch('/api/news');
    const j = await res.json();
    if (!j.ok) return msg(newsMsg, 'error', 'Nelze načíst novinky.');
    newsTbody.innerHTML = '';
    j.news.forEach(n => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${new Date(n.created_at).toLocaleDateString('cs-CZ')}</td>
        <td>${n.text}</td>
        <td><button data-id="${n.id}" class="secondary del-news">Smazat</button></td>`;
      newsTbody.appendChild(tr);
    });
  }

  newsForm.addEventListener('submit', async e => {
    e.preventDefault();
    const text = document.getElementById('nText').value.trim();
    if (!text) return;
    const res = await fetch('/api/news', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text })
    });
    const j = await res.json();
    if (j.ok) {
      msg(newsMsg, 'success', 'Novinka přidána.');
      newsForm.reset();
      await loadNews();
    } else msg(newsMsg, 'error', j.error);
  });

  document.addEventListener('click', async e => {
    if (e.target.classList.contains('del-news')) {
      const id = e.target.dataset.id;
      if (confirm('Smazat novinku?')) {
        await fetch(`/api/news/${id}`, { method: 'DELETE' });
        await loadNews();
      }
    }
  });

  loadNews();
}

// === ZOBRAZENÍ NOVINEK NA HLAVNÍ STRÁNCE ===
const newsBox = document.getElementById('newsBox');
if (newsBox) {
  (async () => {
    const res = await fetch('/api/news');
    const j = await res.json();
    if (!j.ok || !j.news.length) {
      newsBox.innerHTML = '<div class="notice">Zatím žádné novinky.</div>';
      return;
    }
    newsBox.innerHTML = '';
    j.news.forEach(n => {
      const d = new Date(n.created_at).toLocaleDateString('cs-CZ');
      const div = document.createElement('div');
      div.className = 'card';
      div.innerHTML = `<strong>${d}</strong><br>${n.text}`;
      newsBox.appendChild(div);
    });
  })();
}

// === STRIPE LOGIKA ===
const bookForm = document.getElementById('bookForm');
if (bookForm) {
  bookForm.addEventListener('submit', async e => {
    e.preventDefault();
    const cls = bookForm.class.value;

    if (cls === '1. třída') return (window.location.href = 'https://buy.stripe.com/link1');
    if (cls === '2. třída') return (window.location.href = 'https://buy.stripe.com/link2');

    alert('Platba probíhá na stadionu, rezervace bude uložena.');
  });
}
