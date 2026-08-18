const net = require('net');
const tls = require('tls');

const SHEET_BASE = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQscA-Y05gGsr6xx54awNYgJJnCLoirIf5IKsNHRmLFYyBqtUL1khVmy3cP_L3U0pG1G6vMPPOqiNNO/pub';
const PATIENT_GID = '1310523268';
const MANAGER_GID = '86288854';

// ── Minimal SMTP client (AUTH LOGIN for Office 365) ──
function sendEmail({ host, port, user, pass, from, to, subject, html, attachments }) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(port, host);
    let step = 0;
    let tlsSocket = null;

    function send(cmd) { (tlsSocket || socket).write(cmd + '\r\n'); }

    function buildMessage() {
      const boundary = 'boundary_' + Date.now();
      let msg = 'From: ' + from + '\r\n';
      msg += 'To: ' + to + '\r\n';
      msg += 'Subject: ' + subject + '\r\n';
      msg += 'MIME-Version: 1.0\r\n';
      msg += 'Content-Type: multipart/mixed; boundary="' + boundary + '"\r\n\r\n';
      msg += '--' + boundary + '\r\n';
      msg += 'Content-Type: text/html; charset=UTF-8\r\n\r\n';
      msg += html + '\r\n';
      if (attachments && attachments.length) {
        attachments.forEach(att => {
          msg += '--' + boundary + '\r\n';
          msg += 'Content-Type: text/csv; name="' + att.filename + '"\r\n';
          msg += 'Content-Disposition: attachment; filename="' + att.filename + '"\r\n';
          msg += 'Content-Transfer-Encoding: base64\r\n\r\n';
          msg += att.content.toString('base64') + '\r\n';
        });
      }
      msg += '--' + boundary + '--\r\n';
      return msg;
    }

    function handleResponse(data) {
      const code = parseInt(data.substring(0, 3));
      switch (step) {
        case 0: send('EHLO mysaathi-dashboard.vercel.app'); step = 1; break;
        case 1: send('STARTTLS'); step = 2; break;
        case 2:
          tlsSocket = tls.connect({ socket: socket, host: host, servername: host }, () => {
            send('EHLO mysaathi-dashboard.vercel.app'); step = 3;
          });
          tlsSocket.on('data', d => handleResponse(d.toString()));
          tlsSocket.on('error', e => reject(e));
          break;
        case 3: send('AUTH LOGIN'); step = 4; break;
        case 4:
          if (code !== 334) { reject(new Error('AUTH LOGIN rejected: ' + data)); return; }
          send(Buffer.from(user).toString('base64')); step = 5; break;
        case 5:
          if (code !== 334) { reject(new Error('Username rejected: ' + data)); return; }
          send(Buffer.from(pass).toString('base64')); step = 6; break;
        case 6:
          if (code !== 235) { reject(new Error('Auth failed: ' + data)); return; }
          send('MAIL FROM:<' + user + '>'); step = 7; break;
        case 7: send('RCPT TO:<' + to + '>'); step = 8; break;
        case 8: send('DATA'); step = 9; break;
        case 9: send(buildMessage() + '\r\n.'); step = 10; break;
        case 10: send('QUIT'); resolve({ success: true }); break;
      }
    }

    socket.on('data', d => handleResponse(d.toString()));
    socket.on('error', e => reject(e));
    socket.setTimeout(15000, () => { socket.destroy(); reject(new Error('SMTP timeout')); });
  });
}


// ── Delay between emails to prevent duplicates ──
function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
// ── CSV Parser ──
function parseCSV(text) {
  const lines = text.replace(/\r/g, '').split('\n');
  const headers = parseCSVLine(lines[0]);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const vals = parseCSVLine(lines[i]);
    const row = {};
    headers.forEach((h, j) => { row[h] = (vals[j] || '').trim(); });
    rows.push(row);
  }
  return { headers, rows };
}

function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') { current += '"'; i++; }
      else if (ch === '"') { inQuotes = false; }
      else { current += ch; }
    } else {
      if (ch === '"') { inQuotes = true; }
      else if (ch === ',') { result.push(current); current = ''; }
      else { current += ch; }
    }
  }
  result.push(current);
  return result;
}

function normDoctor(name) {
  const v = (name || '').trim();
  if (!v || v === '#N/A' || v === 'N/A') return '';
  let x = v.replace(/\bDr\.?\s+/gi, 'Dr ').replace(/\s+/g, ' ').trim();
  return x.split(' ').map(w => {
    if (w.toLowerCase() === 'dr') return 'Dr';
    return w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : '';
  }).join(' ');
}

function parsePurchaseDate(s) {
  const v = (s || '').trim();
  if (!v) return null;
  const parts = v.split('/');
  if (parts.length === 3) return new Date(parseInt(parts[2]), parseInt(parts[0]) - 1, parseInt(parts[1]));
  const d = new Date(v);
  return isNaN(d) ? null : d;
}

function csvCell(val) {
  const s = String(val == null ? '' : val);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function buildDrWeeklyCSV(patients) {
  const dates = patients.map(r => r._date).filter(d => d);
  if (!dates.length) return '';
  const minDate = new Date(Math.min(...dates));
  const maxDate = new Date(Math.max(...dates));
  const weeks = [];
  let ws = new Date(minDate);
  ws.setDate(ws.getDate() - ws.getDay() + 1);
  while (ws <= maxDate) {
    const we = new Date(ws); we.setDate(we.getDate() + 6);
    weeks.push([new Date(ws), new Date(we)]);
    ws.setDate(ws.getDate() + 7);
  }
  const weekLabels = weeks.map(w => {
    return w[0].toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) + ' - ' + w[1].toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
  });
  const allDoctors = [...new Set(patients.map(r => r.doctor).filter(Boolean))].sort();
  const pivot = {};
  allDoctors.forEach(dr => { pivot[dr] = {}; });
  patients.forEach(r => {
    if (!r.doctor || !r._date) return;
    for (let i = 0; i < weeks.length; i++) {
      if (r._date >= weeks[i][0] && r._date <= weeks[i][1]) {
        pivot[r.doctor] = pivot[r.doctor] || {};
        pivot[r.doctor][weekLabels[i]] = (pivot[r.doctor][weekLabels[i]] || 0) + 1;
        break;
      }
    }
  });
  const headers = ['MCR Code', 'Employee Name', 'Zone', 'Region', 'Area', 'Headquarter',
    'Doctor Name', 'Doctor City', 'Doctor State', 'Drug',
    'Diet Booked', 'Diet Completed', 'Physio Booked', 'Physio Completed']
    .concat(weekLabels).concat(['Total Patients']);
  const csvRows = [headers.map(csvCell).join(',')];
  allDoctors.forEach(dr => {
    const drRows = patients.filter(r => r.doctor === dr);
    const drFirst = drRows[0] || {};
    const drugs = [...new Set(drRows.map(r => r.drug).filter(Boolean))].join(', ');
    const dietBkd = drRows.reduce((s, r) => s + (r.dietBooked || 0), 0);
    const dietCmp = drRows.reduce((s, r) => s + (r.dietCompleted || 0), 0);
    const phyBkd = drRows.reduce((s, r) => s + (r.physioBooked || 0), 0);
    const phyCmp = drRows.reduce((s, r) => s + (r.physioCompleted || 0), 0);
    const row = [csvCell(drFirst.mcrCode || ''), csvCell(drFirst.employeeName || ''),
      csvCell(drFirst.zone || ''), csvCell(drFirst.region || ''),
      csvCell(drFirst.area || ''), csvCell(drFirst.hq || ''),
      csvCell(dr), csvCell(drFirst.doctorCity || ''), csvCell(drFirst.doctorState || ''),
      csvCell(drugs || ''), String(dietBkd), String(dietCmp), String(phyBkd), String(phyCmp)];
    let total = 0;
    weekLabels.forEach(wl => { const cnt = (pivot[dr] && pivot[dr][wl]) || 0; total += cnt; row.push(String(cnt)); });
    row.push(String(total));
    csvRows.push(row.join(','));
  });
  return csvRows.join('\n');
}

module.exports = async function handler(req, res) {
  const SMTP_USER = process.env.SMTP_USER;
  const SMTP_PASS = process.env.SMTP_PASS;
  if (!SMTP_USER || !SMTP_PASS) { res.status(500).json({ error: 'SMTP credentials not configured' }); return; }

  try {
    const patientResp = await fetch(SHEET_BASE + '?gid=' + PATIENT_GID + '&single=true&output=csv');
    const patientData = parseCSV(await patientResp.text());
    const managerResp = await fetch(SHEET_BASE + '?gid=' + MANAGER_GID + '&single=true&output=csv');
    const managerData = parseCSV(await managerResp.text());

    const patients = patientData.rows.filter(r => r['Mobile no']).map(r => ({
      mobile: (r['Mobile no'] || '').trim(), name: (r['Name'] || '').trim(),
      state: (r['State'] || '').trim(), city: (r['Patient City'] || r['City'] || '').trim(),
      _date: parsePurchaseDate(r['Purchase date']), drug: (r['Drug Name'] || '').trim(),
      doctor: normDoctor(r['Doctor name']),
      doctorCity: (r['Doctor City'] || '').trim(), doctorState: (r['Doctor State'] || '').trim(),
      mcrCode: (r['MCR Code'] || '').trim(), employeeName: (r['Employee Name'] || '').trim(),
      zone: (r['Zone'] || '').trim(), region: (r['Region'] || '').trim(),
      area: (r['Area'] || '').trim(), hq: (r['Headquarter'] || '').trim(),
      dietBooked: parseInt(r['Diet booking count'] || '0') || 0,
      dietCompleted: parseInt(r['Diet completion count'] || '0') || 0,
      physioBooked: parseInt(r['Physio Booking count'] || '0') || 0,
      physioCompleted: parseInt(r['Physio completion count'] || '0') || 0,
    }));

    const results = [];
    const today = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

    for (const mgr of managerData.rows) {
      const zone = (mgr['Zone'] || '').trim();
      const region = (mgr['Region'] || '').trim();
      const email = (mgr['Email ID'] || '').trim();
      const role = (mgr['Role'] || '').trim().toUpperCase();
      if (!email) continue;

      let filtered, scopeLabel;
      if (role === 'ZBM') {
        filtered = patients.filter(r => r.zone.toUpperCase() === zone.toUpperCase());
        scopeLabel = 'Zone: ' + zone;
      } else {
        filtered = patients.filter(r => r.region.toUpperCase() === region.toUpperCase());
        scopeLabel = 'Region: ' + region;
      }

      if (!filtered.length) { results.push({ email, scope: scopeLabel, status: 'skipped', reason: 'No patients found' }); continue; }

      const csvContent = '\uFEFF' + buildDrWeeklyCSV(filtered);
      const filename = 'MySaathi_Dr_Weekly_' + (role === 'ZBM' ? zone : region).replace(/\s+/g, '_') + '_' + new Date().toISOString().slice(0, 10) + '.csv';
      const subject = 'MySaathi Dr. Weekly Report \u2014 ' + scopeLabel + ' (' + today + ')';
      const htmlBody = '<div style="font-family:Arial,sans-serif;padding:20px;">'
        + '<h2 style="color:#0e2a33;">MySaathi Dr. Weekly Report</h2>'
        + '<p><strong>' + scopeLabel + '</strong></p>'
        + '<p>Total Patients: <strong>' + filtered.length + '</strong></p>'
        + '<p>Total Doctors: <strong>' + new Set(filtered.map(r => r.doctor).filter(Boolean)).size + '</strong></p>'
        + '<p>Report Date: ' + today + '</p>'
        + '<br><p>Please find the detailed Dr. Weekly Report attached.</p>'
        + '<br><p style="color:#888;font-size:12px;">This is an automated report from MySaathi Dashboard.</p>'
        + '</div>';

      try {
        await sendEmail({
          host: 'smtp.office365.com', port: 587,
          user: SMTP_USER, pass: SMTP_PASS,
          from: '"MySaathi Dashboard" <' + SMTP_USER + '>',
          to: email, subject, html: htmlBody,
          attachments: [{ filename, content: Buffer.from(csvContent, 'utf-8') }],
        });
        results.push({ email, scope: scopeLabel, role, patients: filtered.length, status: 'sent' });
        await delay(2000);
      } catch (emailErr) {
        results.push({ email, scope: scopeLabel, status: 'failed', error: emailErr.message });
        await delay(1000);
      }
    }

    res.status(200).json({ success: true, timestamp: new Date().toISOString(), totalManagers: managerData.rows.length, results });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
