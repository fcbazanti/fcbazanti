// Odeslání rezervace
const form = document.getElementById('bookForm');
if (form) {
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = { 
      class: form.class.value, 
      name: form.name.value, 
      email: form.email.value,
      match_id: form.match.value
    };
    const msgEl = document.getElementById('msg');
    msg(msgEl, 'notice', 'Odesílám…');
    try {
      const res = await fetch('/api/book', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
      const j = await res.json();
      if (j.ok) { msg(msgEl, 'success', `Hotovo! ID rezervace: ${j.id}.`); form.reset(); }
      else { msg(msgEl, 'error', j.error || 'Něco se nepovedlo.'); }
    } catch { msg(msgEl, 'error', 'Chyba spojení se serverem.'); }
  });

  // Naplnění zápasů do selectu
  (async () => {
    const select = document.getElementById('match');
    try {
      const res = await fetch('/api/matches/upcoming');
      const j = await res.json();
      if (!j.ok) return;
      if (!j.matches.length) {
        select.innerHTML = '<option disabled selected>Žádné nadcházející zápasy</option>';
        select.disabled = true;
        return;
      }
      select.innerHTML = '';
      j.matches.forEach(m => {
        const d = new Date(m.date + 'T' + m.time);
        const option = document.createElement('option');
        option.value = m.id;
        const dateStr = d.toLocaleDateString('cs-CZ') + ' ' + m.time;
        option.textContent = `${dateStr} – ${m.title}`;
        // je plno ve všech třídách?
        const CAPACITY = { "1. třída": 5, "2. třída": 5, "3. třída": 10 };
        const full = Object.keys(CAPACITY).every(cls => m.capacity[cls] >= CAPACITY[cls]);
        if (full) {
          option.className = 'red';
          option.disabled = true;
        } else {
          option.className = 'green';
        }
        select.appendChild(option);
      });
    } catch (e) {
      select.innerHTML = '<option disabled>Nelze načíst zápasy</option>';
      select.disabled = true;
    }
  })();
}

// Admin: přidání zápasu s časem
const matchForm = document.getElementById('matchForm');
if (matchForm) {
  matchForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const title = document.getElementById('mTitle').value;
    const date = document.getElementById('mDate').value;
    const time = document.getElementById('mTime').value;
    const res = await fetch('/api/matches', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title, date, time }) });
    const j = await res.json();
    if (j.ok) { msg(mMsg, 'success', 'Zápas přidán.'); matchForm.reset(); await loadMatches(); }
    else { msg(mMsg, 'error', j.error || 'Nepodařilo se přidat.'); }
  });
}
