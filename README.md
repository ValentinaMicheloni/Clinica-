# Turnero de Clínica (con Obras Sociales, Motivo y Email)

## Requisitos
- Node.js 18+

## Pasos para correr local
```bash
npm install
# Opcional: configurar email
export SMTP_HOST="smtp.tu-proveedor.com"
export SMTP_PORT="587"
export SMTP_USER="usuario"
export SMTP_PASS="password"
export MAIL_FROM="Clínica <no-reply@clinica.com>"
export CLINIC_EMAIL="recepcion@clinica.com"
# Cambiar clave admin
export ADMIN_PASSWORD="clave_secreta"
npm start
```
Abrí: http://localhost:3000

- Público: Home + Turnos
- Panel Admin: http://localhost:3000/admin (clave por defecto `admin123` si no seteás env).

## Funcionalidades
- Alta de médicos con **especialidad** y **obras sociales** aceptadas (multi-selección).
- Carga de **disponibilidad** por rango e intervalo.
- Turnero: elegir **especialidad → médico → fecha → horario**.
- Durante la reserva, el paciente indica **Obra Social** (Avalian, Jerárquicos, Sancor Salud, OSDE, Swiss Medical, Medife, Galeno o **Otra**) y **Motivo de consulta**.
- Si elige **Otra** o una OS no aceptada por el médico, se marca como **fuera de cartilla**.
- Confirmación por **email** al paciente (y notificación a la clínica). El mail indica que la clínica enviará el **monto**.
- Cancelación de turnos desde Admin con reposición automática de disponibilidad.

## Estructura
- `server.js` : API + servidor Express + SQLite + Nodemailer.
- `public/index.html` : Home y flujo de reserva.
- `public/admin.html` : Panel Administrativo.
- `public/styles.css`, `public/script.js`, `public/admin.js`.
- DB: `data.db` (SQLite).

## Deploy rápido (Railway/Render/Fly/Heroku-like)
- Recordá setear las variables de entorno: `SMTP_*`, `MAIL_FROM`, `CLINIC_EMAIL`, `ADMIN_PASSWORD`.
- Podés persistir `DB_PATH` hacia un volumen si tu PaaS lo permite.

---

### API breve
- `POST /api/admin/doctors` (admin): `{ name, specialty, insurers: [..] }`
- `POST /api/admin/availability` (admin): `{ doctor_id, slots:[{date, time}] }`
- `GET /api/availability?doctor_id&date` (público)
- `POST /api/book` (público): `{ doctor_id, date, time, patient_name, patient_email, patient_insurer, patient_insurer_other, reason }`

**Notas**: Si no configurás SMTP, los emails se **loguean** en consola (modo mock).
