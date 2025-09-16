// Admin panel
const yearEl = document.getElementById('year'); if (yearEl) yearEl.textContent = new Date().getFullYear();
const loginSection = document.getElementById('loginSection');
const adminSection = document.getElementById('adminSection');
const adminPassword = document.getElementById('adminPassword');
const loginBtn = document.getElementById('loginBtn');
const loginFeedback = document.getElementById('loginFeedback');

const doctorName = document.getElementById('doctorName');
const doctorSpec = document.getElementById('doctorSpec');
const doctorInsurers = document.getElementById('doctorInsurers');
const addDoctorBtn = document.getElementById('addDoctorBtn');
const addDoctorFeedback = document.getElementById('addDoctorFeedback');

const doctorSelectAdmin = document.getElementById('doctorSelectAdmin');
const doctorFilterAvail = document.getElementById('doctorFilterAvail');
const doctorFilterBook = document.getElementById('doctorFilterBook');

const dateAdmin = document.getElementById('dateAdmin');
const fromTime = document.getElementById('fromTime');
const toTime = document.getElementById('toTime');
const intervalMin = document.getElementById('intervalMin');

const generateSlotsBtn = document.getElementById('generateSlotsBtn');
const generatedSlots = document.getElementById('generatedSlots');
const saveSlotsBtn = document.getElementById('saveSlotsBtn');
const saveSlotsFeedback = document.getElementById('saveSlotsFeedback');

const dateFilterAvail = document.getElementById('dateFilterAvail');
const loadAvailBtn = document.getElementById('loadAvailBtn');
const availList = document.getElementById('availList');

const dateFilterBook = document.getElementById('dateFilterBook');
const loadBookingsBtn = document.getElementById('loadBookingsBtn');
const bookingList = document.getElementById('bookingList');

let token = localStorage.getItem('admin_token') || null;
let doctors = [];

function setLoggedIn(logged){
  loginSection.style.display = logged ? 'none' : 'block';
  adminSection.style.display = logged ? 'block' : 'none';
}

setLoggedIn(!!token);

async function login(){
  loginFeedback.innerHTML = '';
  const password = (adminPassword.value || '').trim();
  if (!password) {
    loginFeedback.innerHTML = `<div class="alert err">Ingresá la contraseña.</div>`;
    return;
  }
  try {
    const res = await fetch('/api/admin/login', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ password })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'No autorizado');
    token = data.token;
    localStorage.setItem('admin_token', token);
    setLoggedIn(true);
    await refreshDoctors();
  } catch (e) {
    loginFeedback.innerHTML = `<div class="alert err">${e.message}</div>`;
  }
}
loginBtn.addEventListener('click', login);

async function refreshDoctors(){
  const res = await fetch('/api/doctors');
  doctors = await res.json();
  const options = doctors.map(d => `<option value="${d.id}">${d.name} — ${d.specialty}</option>`).join('');
  doctorSelectAdmin.innerHTML = `<option value="">Seleccionar...</option>${options}`;
  doctorFilterAvail.innerHTML = `<option value="">Todos</option>${options}`;
  doctorFilterBook.innerHTML = `<option value="">Todos</option>${options}`;
}

if (token) refreshDoctors();

addDoctorBtn.addEventListener('click', async ()=>{
  addDoctorFeedback.innerHTML = '';
  const name = (doctorName.value || '').trim();
  const spec = (doctorSpec.value || '').trim();
  const insurers = [...doctorInsurers.selectedOptions].map(o => o.value);
  if (!name || !spec){
    addDoctorFeedback.innerHTML = `<div class="alert err">Completá nombre y especialidad.</div>`;
    return;
  }
  try {
    const res = await fetch('/api/admin/doctors', {
      method: 'POST',
      headers: {'Content-Type':'application/json','x-admin-token': token},
      body: JSON.stringify({ name, specialty: spec, insurers })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al cargar');
    addDoctorFeedback.innerHTML = `<div class="alert ok">Médico/a agregado/a.</div>`;
    doctorName.value = ''; doctorSpec.value = ''; [...doctorInsurers.options].forEach(o=>o.selected=false);
    refreshDoctors();
  } catch (e) {
    addDoctorFeedback.innerHTML = `<div class="alert err">${e.message}</div>`;
  }
});

function generateTimes(from, to, stepMin){
  const [fh, fm] = from.split(':').map(Number);
  const [th, tm] = to.split(':').map(Number);
  let start = fh*60 + fm;
  const end = th*60 + tm;
  const out = [];
  while (start < end){
    const h = Math.floor(start/60).toString().padStart(2,'0');
    const m = (start%60).toString().padStart(2,'0');
    out.push(`${h}:${m}`);
    start += stepMin;
  }
  return out;
}

let generated = [];
generateSlotsBtn.addEventListener('click', ()=>{
  generatedSlots.innerHTML = '';
  generated = [];
  const d = dateAdmin.value;
  const from = fromTime.value;
  const to = toTime.value;
  const step = Math.max(5, parseInt(intervalMin.value || '30', 10));
  if (!d || !from || !to) {
    generatedSlots.innerHTML = `<div class="alert err">Completá fecha, desde y hasta.</div>`;
    return;
  }
  const times = generateTimes(from, to, step);
  if (!times.length){
    generatedSlots.innerHTML = `<div class="alert">No hay horarios en ese rango.</div>`;
    return;
  }
  times.forEach(t => {
    const btn = document.createElement('button');
    btn.className = 'time-btn';
    btn.textContent = t + ' hs';
    btn.addEventListener('click', ()=>{
      if (btn.classList.contains('selected')){
        btn.classList.remove('selected');
        generated = generated.filter(x=>x.time!==t);
      } else {
        btn.classList.add('selected');
        generated.push({ date: d, time: t });
      }
    });
    generatedSlots.appendChild(btn);
  });
});

saveSlotsBtn.addEventListener('click', async ()=>{
  saveSlotsFeedback.innerHTML = '';
  const doctor_id = doctorSelectAdmin.value;
  if (!doctor_id){ saveSlotsFeedback.innerHTML = `<div class="alert err">Elegí médico/a.</div>`; return; }
  if (!generated.length){ saveSlotsFeedback.innerHTML = `<div class="alert err">Generá y seleccioná horarios.</div>`; return; }
  try {
    const res = await fetch('/api/admin/availability', {
      method: 'POST',
      headers: { 'Content-Type':'application/json', 'x-admin-token': token },
      body: JSON.stringify({ doctor_id, slots: generated })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al guardar');
    saveSlotsFeedback.innerHTML = `<div class="alert ok">Disponibilidad guardada.</div>`;
    generatedSlots.innerHTML = '';
    generated = [];
  } catch (e) {
    saveSlotsFeedback.innerHTML = `<div class="alert err">${e.message}</div>`;
  }
});

loadAvailBtn.addEventListener('click', async ()=>{
  const did = doctorFilterAvail.value;
  const d = dateFilterAvail.value;
  const url = new URL(location.origin + '/api/admin/availability');
  if (did) url.searchParams.set('doctor_id', did);
  if (d) url.searchParams.set('date', d);
  const res = await fetch(url, { headers: { 'x-admin-token': token } });
  const data = await res.json();
  if (!Array.isArray(data) || !data.length){
    availList.innerHTML = `<div class="alert">Sin resultados.</div>`;
    return;
  }
  const list = document.createElement('div');
  data.forEach(item => {
    const row = document.createElement('div');
    row.className = 'card';
    row.style.marginBottom = '8px';
    row.innerHTML = `<strong>${item.date}</strong> — ${item.time} hs · ${item.doctor_name} (${item.specialty})
      <div style="float:right; display:inline-flex; gap:8px;">
        <button class="ghost" data-id="${item.id}">Eliminar</button>
      </div>`;
    list.appendChild(row);
  });
  availList.innerHTML = '';
  availList.appendChild(list);
  [...availList.querySelectorAll('button.ghost')].forEach(btn => {
    btn.addEventListener('click', async ()=>{
      const id = btn.getAttribute('data-id');
      if (!confirm('¿Eliminar este horario?')) return;
      const res2 = await fetch('/api/admin/availability/' + id, { method: 'DELETE', headers: { 'x-admin-token': token } });
      const j = await res2.json();
      if (res2.ok){
        btn.closest('.card').remove();
      } else {
        alert(j.error || 'Error');
      }
    });
  });
});

loadBookingsBtn.addEventListener('click', async ()=>{
  const did = doctorFilterBook.value;
  const d = dateFilterBook.value;
  const url = new URL(location.origin + '/api/admin/bookings');
  if (did) url.searchParams.set('doctor_id', did);
  if (d) url.searchParams.set('date', d);
  const res = await fetch(url, { headers: { 'x-admin-token': token } });
  const data = await res.json();
  if (!Array.isArray(data) || !data.length){
    bookingList.innerHTML = `<div class="alert">Sin resultados.</div>`;
    return;
  }
  const list = document.createElement('div');
  data.forEach(b => {
    const os = b.patient_insurer === 'Otra' ? `Otra (${b.patient_insurer_other||''})` : (b.patient_insurer || '—');
    const oon = b.out_of_network ? ' · <span style="color:#991b1b">Fuera de cartilla</span>' : '';
    const row = document.createElement('div');
    row.className = 'card';
    row.style.marginBottom = '8px';
    row.innerHTML = `<strong>${b.date} — ${b.time} hs</strong><br>
    ${b.doctor_name} (${b.specialty})<br>
    Paciente: ${b.patient_name} · ${b.patient_email}<br>
    Obra social: ${os}${oon}<br>
    Motivo: ${b.reason || '—'}
    <div style="float:right; display:inline-flex; gap:8px; margin-top:6px;">
      <button class="ghost" data-id="${b.id}">Cancelar</button>
    </div>`;
    list.appendChild(row);
  });
  bookingList.innerHTML = '';
  bookingList.appendChild(list);

  [...bookingList.querySelectorAll('button.ghost')].forEach(btn => {
    btn.addEventListener('click', async ()=>{
      const id = btn.getAttribute('data-id');
      if (!confirm('¿Cancelar este turno? Se repondrá la disponibilidad.')) return;
      const res2 = await fetch('/api/admin/bookings/' + id, { method: 'DELETE', headers: { 'x-admin-token': token } });
      const j = await res2.json();
      if (res2.ok){
        btn.closest('.card').remove();
      } else {
        alert(j.error || 'Error');
      }
    });
  });
});
