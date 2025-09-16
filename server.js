// Backend Turnero (Node + Express + SQLite + CORS + Nodemailer)
// Env: PORT, ADMIN_PASSWORD, DB_PATH, SMTP_HOST, SMTP_PORT, SMTP_SECURE (true/false), SMTP_USER, SMTP_PASS, MAIL_FROM, CLINIC_EMAIL
const path = require('path');
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const nodemailer = require('nodemailer');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data.db');

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// --- CORS básico (para servir a GitHub Pages)
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,X-Admin-Token');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// --- Email ---
let transporter = null;
if (process.env.SMTP_HOST) {
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: (process.env.SMTP_SECURE || 'false') === 'true',
    auth: (process.env.SMTP_USER && process.env.SMTP_PASS) ? {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    } : undefined
  });
}
const MAIL_FROM = process.env.MAIL_FROM || 'no-reply@clinica.local';
const CLINIC_EMAIL = process.env.CLINIC_EMAIL || 'recepcion@clinica.local';

async function sendMailSafe(opts) {
  if (!transporter) { console.log('[EMAIL MOCK]', opts.subject, '->', opts.to); return; }
  await transporter.sendMail({ from: MAIL_FROM, ...opts });
}

// --- DB ---
const db = new sqlite3.Database(DB_PATH);
db.serialize(() => {
  db.run(`PRAGMA foreign_keys = ON`);
  db.run(`CREATE TABLE IF NOT EXISTS doctors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    specialty TEXT NOT NULL
  );`);
  db.run(`CREATE TABLE IF NOT EXISTS doctor_insurers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    doctor_id INTEGER NOT NULL,
    insurer TEXT NOT NULL,
    FOREIGN KEY (doctor_id) REFERENCES doctors(id) ON DELETE CASCADE,
    UNIQUE(doctor_id, insurer)
  );`);
  db.run(`CREATE TABLE IF NOT EXISTS availability (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    doctor_id INTEGER NOT NULL,
    date TEXT NOT NULL, time TEXT NOT NULL,
    FOREIGN KEY (doctor_id) REFERENCES doctors(id) ON DELETE CASCADE,
    UNIQUE(doctor_id, date, time)
  );`);
  db.run(`CREATE TABLE IF NOT EXISTS bookings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    doctor_id INTEGER NOT NULL,
    date TEXT NOT NULL, time TEXT NOT NULL,
    patient_name TEXT NOT NULL, patient_email TEXT NOT NULL,
    patient_insurer TEXT, patient_insurer_other TEXT,
    out_of_network INTEGER DEFAULT 0, reason TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (doctor_id) REFERENCES doctors(id) ON DELETE CASCADE,
    UNIQUE(doctor_id, date, time)
  );`);
  db.all(`PRAGMA table_info(bookings)`, [], (err, cols) => {
    if (err) return;
    const names = cols.map(c=>c.name);
    const toAdd = [
      ['patient_insurer', 'TEXT'],
      ['patient_insurer_other', 'TEXT'],
      ['out_of_network', 'INTEGER DEFAULT 0'],
      ['reason', 'TEXT']
    ];
    toAdd.forEach(([col, type]) => {
      if (!names.includes(col)) db.run(`ALTER TABLE bookings ADD COLUMN ${col} ${type}`);
    });
  });
});

// Sesiones simples para admin
const sessions = new Set();
const token = () => [...Array(40)].map(()=>'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random()*36)]).join('');
const requireAdmin = (req,res,next)=>{
  const t = req.headers['x-admin-token'] || req.query.token;
  if (!t || !sessions.has(t)) return res.status(401).json({ error: 'No autorizado' });
  next();
};

// Helpers
function getDoctorInsurers(cb){
  db.all(`SELECT doctor_id, insurer FROM doctor_insurers`, [], (err, rows) => {
    if (err) return cb(err);
    const map = {}; (rows||[]).forEach(r => { (map[r.doctor_id] ||= []).push(r.insurer); });
    cb(null, map);
  });
}

// --- API pública ---
app.get('/api/doctors', (req, res) => {
  db.all(`SELECT id, name, specialty FROM doctors ORDER BY specialty, name`, [], (err, docs) => {
    if (err) return res.status(500).json({ error: err.message });
    getDoctorInsurers((err2, map) => {
      if (err2) return res.status(500).json({ error: err2.message });
      res.json(docs.map(d => ({...d, insurers: map[d.id] || [] })));
    });
  });
});

app.get('/api/specialties', (req, res) => {
  db.all(`SELECT DISTINCT specialty FROM doctors ORDER BY specialty`, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows.map(r => r.specialty));
  });
});

app.get('/api/availability', (req, res) => {
  const { doctor_id, date } = req.query;
  const params = []; let sql = `SELECT a.id, a.date, a.time, a.doctor_id, d.name as doctor_name, d.specialty
             FROM availability a JOIN doctors d ON d.id = a.doctor_id WHERE 1=1`;
  if (doctor_id) { sql += ` AND a.doctor_id = ?`; params.push(doctor_id); }
  if (date) { sql += ` AND a.date = ?`; params.push(date); }
  sql += ` ORDER BY a.date, a.time`;
  db.all(sql, params, (err, rows) => err ? res.status(500).json({ error: err.message }) : res.json(rows));
});

app.post('/api/book', (req, res) => {
  const { doctor_id, date, time, patient_name, patient_email, patient_insurer, patient_insurer_other, reason } = req.body || {};
  if (!doctor_id || !date || !time || !patient_name || !patient_email || !reason) return res.status(400).json({ error: 'Datos incompletos' });
  db.all(`SELECT insurer FROM doctor_insurers WHERE doctor_id = ?`, [doctor_id], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    const accepted = new Set((rows || []).map(r => r.insurer));
    const chosen = (patient_insurer || '').trim();
    const isOther = chosen === 'Otra';
    const actualName = isOther ? (patient_insurer_other || '').trim() : chosen;
    const outOfNet = isOther ? 1 : (accepted.has(chosen) ? 0 : 1);

    db.serialize(() => {
      db.run('BEGIN TRANSACTION');
      db.get(`SELECT id FROM availability WHERE doctor_id = ? AND date = ? AND time = ?`, [doctor_id, date, time], (err2, slot) => {
        if (err2) { db.run('ROLLBACK'); return res.status(500).json({ error: err2.message }); }
        if (!slot) { db.run('ROLLBACK'); return res.status(409).json({ error: 'El horario ya no está disponible' }); }
        const createdAt = new Date().toISOString();
        db.run(`INSERT INTO bookings (doctor_id, date, time, patient_name, patient_email, patient_insurer, patient_insurer_other, out_of_network, reason, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [doctor_id, date, time, patient_name.trim(), patient_email.trim(), chosen, isOther ? actualName : null, outOfNet, reason.trim(), createdAt],
          function (err3) {
            if (err3) { db.run('ROLLBACK'); if (err3.message?.includes('UNIQUE')) return res.status(409).json({ error: 'Turno ocupado' }); return res.status(500).json({ error: err3.message }); }
            db.run(`DELETE FROM availability WHERE id = ?`, [slot.id], async (err4) => {
              if (err4) { db.run('ROLLBACK'); return res.status(500).json({ error: err4.message }); }
              db.run('COMMIT');
              const booking_id = this.lastID;
              (async () => {
                try {
                  await sendMailSafe({
                    to: patient_email.trim(),
                    subject: 'Confirmación de turno - Clínica',
                    text: `Hola ${patient_name},

Tu turno fue reservado:
- Médico: #${doctor_id}
- Fecha: ${date}
- Hora: ${time}
- Obra social: ${isOther ? `Otra (${actualName})` : (chosen || 'No especificada')}${outOfNet ? ' (fuera de cartilla)' : ''}
- Motivo: ${reason.trim()}

La clínica te enviará el monto de la consulta por este medio.
Gracias, Clínica`
                  });
                  await sendMailSafe({
                    to: process.env.CLINIC_EMAIL || 'recepcion@clinica.local',
                    subject: 'Nuevo turno reservado',
                    text: `Nuevo turno:
- Booking ID: ${booking_id}
- Doctor ID: ${doctor_id}
- Fecha: ${date} ${time}
- Paciente: ${patient_name} <${patient_email}>
- Obra social: ${isOther ? `Otra (${actualName})` : (chosen || 'No especificada')}
- Fuera de cartilla: ${outOfNet ? 'Sí' : 'No'}
- Motivo: ${reason.trim()}

Por favor, enviar el monto de la consulta al paciente.`
                  });
                } catch(e){ console.log('Email error:', e.message); }
              })();
              res.json({ success: true, booking_id, message: 'Turno reservado con éxito' });
            });
          });
      });
    });
  });
});

// --- API Admin ---
app.post('/api/admin/login', (req, res) => {
  const { password } = req.body || {};
  if (password === ADMIN_PASSWORD) {
    const t = token(); sessions.add(t); setTimeout(()=>sessions.delete(t), 12*60*60*1000);
    return res.json({ success: true, token: t });
  }
  res.status(401).json({ error: 'Contraseña incorrecta' });
});

app.post('/api/admin/doctors', (req, res) => {
  const t = req.headers['x-admin-token']; if (!t || !sessions.has(t)) return res.status(401).json({ error: 'No autorizado' });
  const { name, specialty, insurers } = req.body || {};
  if (!name || !specialty) return res.status(400).json({ error: 'Falta nombre o especialidad' });
  db.run(`INSERT INTO doctors (name, specialty) VALUES (?, ?)`, [name.trim(), specialty.trim()], function (err) {
    if (err) return res.status(500).json({ error: err.message });
    const doctorId = this.lastID;
    if (Array.isArray(insurers) && insurers.length){
      const stmt = db.prepare(`INSERT OR IGNORE INTO doctor_insurers (doctor_id, insurer) VALUES (?, ?)`);
      insurers.forEach(i => { if (i) stmt.run([doctorId, String(i).trim()]); });
      stmt.finalize();
    }
    res.json({ success: true, id: doctorId });
  });
});

app.get('/api/admin/bookings', (req, res) => {
  const t = req.headers['x-admin-token']; if (!t || !sessions.has(t)) return res.status(401).json({ error: 'No autorizado' });
  const { doctor_id, date } = req.query || {};
  const params = []; let sql = `SELECT b.id, b.date, b.time, b.patient_name, b.patient_email, b.patient_insurer, b.patient_insurer_other, b.out_of_network, b.reason, b.created_at,
                    d.id as doctor_id, d.name as doctor_name, d.specialty
             FROM bookings b JOIN doctors d ON d.id = b.doctor_id WHERE 1=1`;
  if (doctor_id) { sql += ` AND b.doctor_id = ?`; params.push(doctor_id); }
  if (date) { sql += ` AND b.date = ?`; params.push(date); }
  sql += ` ORDER BY b.date, b.time`;
  db.all(sql, params, (err, rows) => err ? res.status(500).json({ error: err.message }) : res.json(rows));
});

app.get('/api/admin/availability', (req, res) => {
  const t = req.headers['x-admin-token']; if (!t || !sessions.has(t)) return res.status(401).json({ error: 'No autorizado' });
  const { doctor_id, date } = req.query || {};
  const params = []; let sql = `SELECT a.id, a.date, a.time, a.doctor_id, d.name as doctor_name, d.specialty
             FROM availability a JOIN doctors d ON d.id = a.doctor_id WHERE 1=1`;
  if (doctor_id) { sql += ` AND a.doctor_id = ?`; params.push(doctor_id); }
  if (date) { sql += ` AND a.date = ?`; params.push(date); }
  sql += ` ORDER BY a.date, a.time`;
  db.all(sql, params, (err, rows) => err ? res.status(500).json({ error: err.message }) : res.json(rows));
});

app.post('/api/admin/availability', (req, res) => {
  const t = req.headers['x-admin-token']; if (!t || !sessions.has(t)) return res.status(401).json({ error: 'No autorizado' });
  const { doctor_id, slots } = req.body || {};
  if (!doctor_id || !Array.isArray(slots) || !slots.length) return res.status(400).json({ error: 'Datos inválidos' });
  db.serialize(() => {
    db.run('BEGIN TRANSACTION');
    const stmt = db.prepare(`INSERT OR IGNORE INTO availability (doctor_id, date, time) VALUES (?, ?, ?)`);
    slots.forEach(s => { if (s?.date && s?.time) stmt.run([doctor_id, s.date, s.time]); });
    stmt.finalize(err => {
      if (err){ db.run('ROLLBACK'); return res.status(500).json({ error: err.message }); }
      db.run('COMMIT'); res.json({ success: true });
    });
  });
});

app.delete('/api/admin/availability/:id', (req, res) => {
  const t = req.headers['x-admin-token']; if (!t || !sessions.has(t)) return res.status(401).json({ error: 'No autorizado' });
  db.run(`DELETE FROM availability WHERE id = ?`, [req.params.id], function(err){ if (err) return res.status(500).json({ error: err.message }); res.json({ success: true, deleted: this.changes }); });
});

app.delete('/api/admin/bookings/:id', (req, res) => {
  const t = req.headers['x-admin-token']; if (!t || !sessions.has(t)) return res.status(401).json({ error: 'No autorizado' });
  const id = req.params.id;
  db.get(`SELECT * FROM bookings WHERE id = ?`, [id], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!row) return res.status(404).json({ error: 'No existe la reserva' });
    db.serialize(() => {
      db.run('BEGIN TRANSACTION');
      db.run(`DELETE FROM bookings WHERE id = ?`, [id], function(err2){
        if (err2){ db.run('ROLLBACK'); return res.status(500).json({ error: err2.message }); }
        db.run(`INSERT OR IGNORE INTO availability (doctor_id, date, time) VALUES (?, ?, ?)`, [row.doctor_id, row.date, row.time], (err3) => {
          if (err3){ db.run('ROLLBACK'); return res.status(500).json({ error: err3.message }); }
          db.run('COMMIT'); res.json({ success: true });
        });
      });
    });
  });
});

app.listen(PORT, () => console.log(`Backend listo en :${PORT}`));
