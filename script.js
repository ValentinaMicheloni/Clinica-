// Front (público) - GitHub Pages friendly
const API_BASE = (window.API_BASE || "").replace(/\/+$/,''); // sin slash final
const specialtySelect = document.getElementById('specialtySelect');
const doctorSelect = document.getElementById('doctorSelect');
const dateInput = document.getElementById('dateInput');
const findSlotsBtn = document.getElementById('findSlotsBtn');
const clearFiltersBtn = document.getElementById('clearFiltersBtn');
const slotsContainer = document.getElementById('slotsContainer');
const feedback = document.getElementById('feedback');

const bookModal = document.getElementById('bookModal');
const modalInfo = document.getElementById('modalInfo');
const modalFeedback = document.getElementById('modalFeedback');
const patientName = document.getElementById('patientName');
const patientEmail = document.getElementById('patientEmail');
const confirmBookingBtn = document.getElementById('confirmBookingBtn');
const cancelBookingBtn = document.getElementById('cancelBookingBtn');

const insurerSelect = document.getElementById('insurerSelect');
const insurerOtherWrap = document.getElementById('insurerOtherWrap');
const insurerOther = document.getElementById('insurerOther');
const reason = document.getElementById('reason');

let doctors = [];
let currentDoctor = null;
let selectedSlot = null;

document.getElementById('year').textContent = new Date().getFullYear();

const BASE_INSURERS = ['Avalian','Jerárquicos','Sancor Salud','OSDE','Swiss Medical','Medife','Galeno','Otra'];

async function fetchJSON(url, opts){ const r = await fetch(url, opts); if(!r.ok){ const j = await r.json().catch(()=>({})); throw new Error(j.error||('HTTP '+r.status)); } return r.json(); }

async function fetchDoctors() {
  const url = `${API_BASE}/api/doctors`;
  const res = await fetch(url);
  doctors = await res.json();
  const specs = [...new Set(doctors.map(d => d.specialty))];
  specialtySelect.innerHTML = `<option value="">Seleccionar...</option>` + specs.map(s=>`<option>${s}</option>`).join('');
}
fetchDoctors().catch(e=> feedback.innerHTML = `<div class="alert err">${e.message}</div>`);

specialtySelect.addEventListener('change', () => {
  const spec = specialtySelect.value;
  const filtered = doctors.filter(d => !spec || d.specialty === spec);
  doctorSelect.innerHTML = `<option value="">Seleccionar...</option>` + filtered.map(d=>`<option value="${d.id}">${d.name}</option>`).join('');
  doctorSelect.disabled = !spec;
});

doctorSelect.addEventListener('change', ()=>{
  const did = parseInt(doctorSelect.value, 10);
  currentDoctor = doctors.find(d => d.id === did) || null;
  const accepted = (currentDoctor?.insurers || []);
  const opts = (accepted.length ? accepted : BASE_INSURERS.filter(x=>x!=='Otra')).concat(['Otra']);
  insurerSelect.innerHTML = opts.map(o=>`<option>${o}</option>`).join('');
  insurerOtherWrap.style.display = 'none';
  insurerOther.value = '';
});

insurerSelect.addEventListener('change', ()=>{
  insurerOtherWrap.style.display = insurerSelect.value === 'Otra' ? 'block' : 'none';
  if (insurerSelect.value !== 'Otra') insurerOther.value = '';
});

clearFiltersBtn.addEventListener('click', ()=>{
  specialtySelect.value = '';
  doctorSelect.innerHTML = '<option value="">Seleccioná especialidad</option>';
  doctorSelect.disabled = true;
  dateInput.value = '';
  slotsContainer.innerHTML = '';
  feedback.innerHTML = '';
});

findSlotsBtn.addEventListener('click', async ()=>{
  feedback.innerHTML = '';
  slotsContainer.innerHTML = '';
  const doctor_id = doctorSelect.value;
  const date = dateInput.value;
  if (!doctor_id || !date) {
    feedback.innerHTML = `<div class="alert err">Elegí médico/a y fecha.</div>`;
    return;
  }
  try{
    const data = await fetchJSON(`${API_BASE}/api/availability?doctor_id=${doctor_id}&date=${date}`);
    if (Array.isArray(data) && data.length){
      for (const slot of data){
        const btn = document.createElement('button');
        btn.className = 'time-btn'; btn.textContent = `${slot.time} hs`;
        btn.addEventListener('click', () => openBookingModal(slot));
        slotsContainer.appendChild(btn);
      }
    } else {
      slotsContainer.innerHTML = `<div class="alert">No hay horarios disponibles para ese día.</div>`;
    }
  }catch(e){ feedback.innerHTML = `<div class="alert err">${e.message}</div>`; }
});

function openBookingModal(slot){
  selectedSlot = slot;
  modalInfo.textContent = `Vas a reservar con ${slot.doctor_name} (${slot.specialty}) el ${slot.date} a las ${slot.time} hs.`;
  patientName.value = ''; patientEmail.value = '';
  const firstIns = (currentDoctor?.insurers?.[0]) || 'Avalian';
  insurerSelect.value = firstIns;
  insurerOther.value = ''; insurerOtherWrap.style.display = 'none';
  reason.value = ''; modalFeedback.innerHTML = '';
  bookModal.classList.add('open');
}

cancelBookingBtn.addEventListener('click', ()=> bookModal.classList.remove('open'));

confirmBookingBtn.addEventListener('click', async ()=>{
  modalFeedback.innerHTML = '';
  const name = (patientName.value || '').trim();
  const email = (patientEmail.value || '').trim();
  const insurer = insurerSelect.value;
  const insurer_other = insurer === 'Otra' ? (insurerOther.value || '').trim() : '';
  const why = (reason.value || '').trim();

  if (!name || !email || !why){
    modalFeedback.innerHTML = `<div class="alert err">Completá nombre, email y motivo de consulta.</div>`; return;
  }
  if (insurer === 'Otra' && !insurer_other){
    modalFeedback.innerHTML = `<div class="alert err">Indicá la obra social en "Otra".</div>`; return;
  }

  confirmBookingBtn.disabled = true;
  try {
    const res = await fetch(`${API_BASE}/api/book`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        doctor_id: selectedSlot.doctor_id, date: selectedSlot.date, time: selectedSlot.time,
        patient_name: name, patient_email: email,
        patient_insurer: insurer, patient_insurer_other: insurer_other, reason: why
      })
    });
    const result = await res.json();
    if (!res.ok) throw new Error(result.error || 'Error al reservar');
    modalFeedback.innerHTML = `<div class="alert ok">Turno reservado con éxito ✅</div>`;
    [...slotsContainer.children].forEach(btn => { if (btn.textContent.includes(selectedSlot.time)) btn.remove(); });
    setTimeout(()=>{
      bookModal.classList.remove('open');
      feedback.innerHTML = `<div class="alert ok">Te enviamos una confirmación por email con el detalle. La clínica te informará el monto.</div>`;
    }, 800);
  } catch (e) {
    modalFeedback.innerHTML = `<div class="alert err">${e.message}</div>`;
  } finally { confirmBookingBtn.disabled = false; }
});
