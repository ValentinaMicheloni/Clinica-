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

// --- CORS básico (para que funcione con GitHub Pages)
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
    secure: String(process.env.SMTP_SECURE || 'false') === 'true',
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
    date TEXT NOT NULL,
    time TEXT NOT NULL,
    FOREIGN KEY (doctor_id) REFERENCES doctors(id) ON DELETE CASCADE,
    UNIQUE(doctor_id, date, time)
  );`);
  db.run(`CREATE TABLE IF NOT EXISTS bookings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    doctor_id INTEGER NOT NULL,
    date TEXT NOT NULL,
    time TEXT NOT NULL,
    patient_name TEXT NOT NULL,
    patient_email TEXT NOT NULL,
    patient_insurer TEXT,
    patient_insurer_other TEXT,
    out_of_network INTEGER DEFAULT 0,
    reason TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (doctor_id) REFERENCES doctors(id) ON DELETE CASCADE,
    UNIQUE(doctor_id, date, time)
  );`);
  // Migración: por si venías de una versión previa
  db.all(`PRAGMA table_info(bookings)`, [], (err, cols) => {
    if (err) return;
    const names = (cols || []).map(c => c.name);
    const addCol = (n, t) => { if (names.indexOf(n) === -1) db.run(`ALTER TABLE bookings ADD COLUMN ${n} ${t}`); };
    addCol('patient_insurer', 'TEXT');
    addCol('patient_insurer_other', 'TEXT');
    addCol('out_of_network', 'INTEGER DEFAULT 0');
    addCol('reason', 'TEXT');
  });
});

// Sesiones simples para admin
const sessions = new Set();
function makeToken(){ return Array.from({length:40},()=> 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random()*36)]).join(''); }
function requireAdmin(req, res, next){
  const t = req.headers['x-admin-token'] || req.query.token;
  if (!t || !sessions.has(t)) return res.status(401).json({ error: 'No autorizado' });
  next();
}

// Helpers
function getDoctorInsurers(cb){
  db.all(`SELECT doctor_id, insurer FROM doctor_insurers`, [], (err, rows) => {
    if (err) return cb(err);
    const map = {};
    (rows || []).forEach(r => {
      if (!map[r.doctor_id]) map[r.doctor_id] = [];
      map[r.doctor_id].push(r.insurer);
    });
    cb(null, map);
  });
}

// --- API pública ---
app.get('/api/doctors', (req, res) => {
  db.all(`SELECT id, name, specialty FROM doctors ORDER BY specialty, name`, [], (err, docs) => {
    if (err) return res.status(500).json({ error: err.message });
    getDoctorInsurers((err2, map) => {
      if (err2) return res.status(500).json({ error: err2.message });
      res.json(docs.map(d => ({ ...d, insurers: map[d.id] || [] })));
    });
  });
});

app.get('/api/availability', (req, res) => {
  const doctor_id = req.query.doctor_id;
  const date = req.query.date;
  const params = [];
  let sql = `SELECT a.id, a.date, a.time, a.doctor_id, d.name as doctor_name, d.specialty
             FROM availability a JOIN doctors d ON d.id = a.doctor_id WHERE 1=1`;
  if (doctor_id) { sql += ` AND a.doctor_id = ?`; params.push(doctor_id); }
  if (date) { sql += ` AND a.date = ?`; params.push(date); }
  sql += ` ORDER BY a.date, a.time`;
  db.all(sql, params, (err, rows) => err ? res.status(500).json({ error: err.message }) : res.json(rows));
});

app.post('/api/book', (req, res) => {
  const body = req.body || {};
  const doctor_id = body.doctor_id;
  const date = body.date;
  const time = body.time;
  const patient_name = (body.patient_name || '').trim();
  const patient_email = (body.patient_email || '').trim();
  const patient_insurer = (body.patient_insurer || '').trim();
  const patient_insurer_other = (body.patient_insurer_other || '').trim();
  const reason = (body.reason || '').trim();

  if (!doctor_id || !date || !time || !patient_name || !patient_email || !reason) {
    return res.status(400).json({ error: 'Datos incompletos' });
  }

  db.all(`SELECT insurer FROM doctor_insurers WHERE doctor_id = ?`, [doctor_id], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });

    const accepted = new Set((rows || []).map(r => r.insurer));
    const isOther = patient_insurer === 'Otra';
    const actualName = isOther ? patient_insurer_other : patient_insurer;
    const outOfNet = isOther ? 1 : (accepted.has(patient_insurer) ? 0 : 1);

    db.serialize(() => {
      db.run('BEGIN TRANSACTION');
      db.get(`SELECT id FROM availability WHERE doctor_id = ? AND date = ? AND time = ?`,
        [doctor_id, date, time],
        function (err2, slot) {
          if (err2) { db.run('ROLLBACK'); return res.status(500).json({ error: err2.message }); }
          if (!slot) { db.run('ROLLBACK'); return res.status(409).json({ error: 'El horario ya no está disponible' }); }

          const createdAt = new Date().toISOString();
          const insertSql = `INSERT INTO bookings
            (doctor_id, date, time, patient_name, patient_email, patient_insurer, patient_insurer_other, out_of_network, reason, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

          db.run(insertSql,
            [doctor_id, date, time, patient_name, patient_email, patient_insurer, isOther ? actualName : null, outOfNet, reason, createdAt],
            function (err3) {
              if (err3) {
                db.run('ROLLBACK');
                if (String(err3.message || '').includes('UNIQUE')) return res.status(409).json({ error: 'Turno ocupado' });
                return res.status(500).json({ error: err3.message });
              }

              const booking_id = this.lastID; // mantener referencia
              db.run(`DELETE FROM availability WHERE id = ?`, [slot.id], async function (err4) {
                if (err4) { db.run('ROLLBACK'); return res.status(500).json({ error: err4.message }); }
                db.run('COMMIT');

                // Emails
                const osLine = isOther ? `Otra (${actualName})` : (patient_insurer || 'No especificada');
                const outNetSuffix = outOfNet ? ' (fuera de cartilla)' : '';
                (async () => {
                  try {
                    await sendMailSafe({
                      to: patient_email,
                      subject: 'Confirmación de turno - Clínica',
                      text:
`Hola ${patient_name},

Tu turno fue reservado:
- Médico: #${doctor_id}
- Fecha: ${date}
- Hora: ${time}
- Obra social: ${osLine}${outNetSuffix}
- Motivo: ${reason}

La clínica te enviará el monto de la consulta por este medio.
Gracias, Clínica`
                    });
                    await sendMailSafe({
                      to: CLINIC_EMAIL,
                      subject: 'Nuevo turno reservado',
                      text:
`Nuevo turno:
- Booking ID: ${booking_id}
- Doctor ID: ${doctor_id}
- Fecha: ${date} ${time}
- Paciente: ${patient_name} <${patient_email}>
- Obra social: ${osLine}
- Fuera de cartilla: ${outOfNet ? 'Sí' : 'No'}
- Motivo: ${reason}

Por favor, enviar el monto de la consulta al paciente.`
                    });
                  } catch(e) {
                    console.log('Email error:', e.message);
                  }
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
  const password = (req.body && req.body.password) || '';
  if (password === ADMIN_PASSWORD) {
    const t = makeToken();
    sessions.add(t);
    setTimeout(() => sessions.delete(t), 12 * 60 * 60 * 1000);
    return res.json({ success: true, token: t });
  }
  res.status(401).json({ error: 'Contraseña incorrecta' });
});

app.post('/api/admin/doctors', requireAdmin, (req, res) => {
  const name = (req.body && req.body.name) ? String(req.body.name).trim() : '';
  const specialty = (req.body && req.body.specialty) ? String(req.body.specialty).trim() : '';
  const insurers = Array.isArray(req.body && req.body.insurers) ? req.body.insurers : [];
  if (!name || !specialty) return res.status(400).json({ error: 'Falta nombre o especialidad' });

  db.run(`INSERT INTO doctors (name, specialty) VALUES (?, ?)`, [name, specialty], function (err) {
    if (err) return res.status(500).json({ error: err.message });
    const doctorId = this.lastID;
    if (insurers.length) {
      const stmt = db.prepare(`INSERT OR IGNORE INTO doctor_insurers (doctor_id, insurer) VALUES (?, ?)`);
      insurers.forEach(i => { if (i) stmt.run([doctorId, String(i).trim()]); });
      stmt.finalize();
    }
    res.json({ success: true, id: doctorId });
  });
});

app.get('/api/admin/availability', requireAdmin, (req, res) => {
  const doctor_id = req.query.doctor_id;
  const date = req.query.date;
  const params = [];
  let sql = `SELECT a.id, a.date, a.time, a.doctor_id, d.name as doctor_name, d.specialty
             FROM availability a JOIN doctors d ON d.id = a.doctor_id WHERE 1=1`;
  if (doctor_id) { sql += ` AND a.doctor_id = ?`; params.push(doctor_id); }
  if (date) { sql += ` AND a.date = ?`; params.push(date); }
  sql += ` ORDER BY a.date, a.time`;
  db.all(sql, params, (err, rows) => err ? res.status(500).json({ error: err.message }) : res.json(rows));
});

app.post('/api/admin/availability', requireAdmin, (req, res) => {
  const doctor_id = req.body && req.body.doctor_id;
  const slots = (req.body && Array.isArray(req.body.slots)) ? req.b
