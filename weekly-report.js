const SHEET_BASE = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQscA-Y05gGsr6xx54awNYgJJnCLoirIf5IKsNHRmLFYyBqtUL1khVmy3cP_L3U0pG1G6vMPPOqiNNO/pub';
const PATIENT_GID = '1310523268';
const MANAGER_GID = '86288854';

// ── CSV Parser (simple, no dependencies) ──
function parseCSV(text) {
  const lines = text.split('\n');
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

// ── Doctor name normalizer (same as dashboard) ──
function normDoctor(name) {
  const v = (name || '').trim();
  if (!v || v === '#N/A' || v === 'N/A') return '';
  let x = v.replace(/\bDr\.?\s+/gi, 'Dr ').replace(/\s+/g, ' ').trim();
  return x.split(' ').map(w => {
    if (w.toLowerCase() === 'dr') return 'Dr';
    return w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : '';
  }).join(' ');
}

// ── Date parser for Purchase date (MM/DD/YYYY) ──
function parsePurchaseDate(s) {
  const v = (s || '').trim();
  if (!v) return null;
  const parts = v.split('/');
  if (parts.length === 3) {
    return new Date(parseInt(parts[2]), parseInt(parts[0]) - 1, parseInt(parts[1]));
  }
  const d = new Date(v);
  return isNaN(d) ? null : d;
}

// ── CSV cell escaper ──
function csvCell(val) {
  const s = String(val == null ? '' : val);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

// ── Build Dr Weekly Report CSV for filtered patients ──
function buildDrWeeklyCSV(patients) {
  // Get date range
  const dates = patients.map(r => r._date).filter(d => d);
  if (!dates.length) return '';

  const minDate = new Date(Math.min(...dates));
  const maxDate = new Date(Math.max(...dates));

  // Build weeks
  const weeks = [];
  let ws = new Date(minDate);
  ws.setDate(ws.getDate() - ws.getDay() + 1); // Monday
  while (ws <= maxDate) {
    const we = new Date(ws);
    we.setDate(we.getDate() + 6);
    weeks.push([new Date(ws), new Date(we)]);
    ws.setDate(ws.getDate() + 7);
  }

  const weekLabels = weeks.map(w => {
    const f = w[0].toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
    const t = w[1].toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
    return f + ' - ' + t;
  });

  // Get all doctors
  const allDoctors = [...new Set(patients.map(r => r.doctor).filter(Boolean))].sort();

  // Build pivot: doctor -> week -> count
  const pivot = {};
  allDoctors.forEach(dr => { pivot[dr] = {}; });
  patients.forEach(r => {
    if (!r.doctor || !r._date) return;
    for (let i = 0; i < weeks.length; i++) {
      if (r._date >= weeks[i][0] && r._date <= weeks[i][1]) {
        const wl = weekLabels[i];
        pivot[r.doctor] = pivot[r.doctor] || {};
        pivot[r.doctor][wl] = (pivot[r.doctor][wl] || 0) + 1;
        break;
      }
    }
  });

  // Headers
  const headers = ['MCR Code', 'Employee Name', 'Zone', 'Region', 'Area', 'Headquarter',
    'Doctor Name', 'Doctor City', 'Doctor State', 'Drug',
    'Diet Booked', 'Diet Completed', 'Physio Booked', 'Physio Completed']
    .concat(weekLabels).concat(['Total Patients']);

  const csvRows = [headers.map(csvCell).join(',')];

  // Data rows
  allDoctors.forEach(dr => {
    const drRows = patients.filter(r => r.doctor === dr);
    const drFirst = drRows[0] || {};
    const drugs = [...new Set(drRows.map(r => r.drug).filter(Boolean))].join(', ');
    const dietBkd = drRows.reduce((s, r) => s + (r.dietBooked || 0), 0);
    const dietCmp = drRows.reduce((s, r) => s + (r.dietCompleted || 0), 0);
    const phyBkd = drRows.reduce((s, r) => s + (r.physioBooked || 0), 0);
    const phyCmp = drRows.reduce((s, r) => s + (r.physioCompleted || 0), 0);

    const row = [
      csvCell(drFirst.mcrCode || ''), csvCell(drFirst.employeeName || ''),
      csvCell(drFirst.zone || ''), csvCell(drFirst.region || ''),
      csvCell(drFirst.area || ''), csvCell(drFirst.hq || ''),
      csvCell(dr), csvCell(drFirst.doctorCity || ''), csvCell(drFirst.doctorState || ''),
      csvCell(drugs || ''), String(dietBkd), String(dietCmp), String(phyBkd), String(phyCmp)
    ];

    let total = 0;
    weekLabels.forEach(wl => {
      const cnt = (pivot[dr] && pivot[dr][wl]) || 0;
      total += cnt;
      row.push(String(cnt));
    });
    row.push(String(total));
    csvRows.push(row.join(','));
  });

  return csvRows.join('\n');
}

// ── Main handler ──
module.exports = async function handler(req, res) {
  const RESEND_KEY = process.env.RESEND_API_KEY;
  if (!RESEND_KEY) {
    res.status(500).json({ error: 'RESEND_API_KEY not configured' });
    return;
  }

  try {
    // 1. Fetch patient data
    const patientResp = await fetch(SHEET_BASE + '?gid=' + PATIENT_GID + '&single=true&output=csv');
    const patientCSV = await patientResp.text();
    const patientData = parseCSV(patientCSV);

    // 2. Fetch manager mapping
    const managerResp = await fetch(SHEET_BASE + '?gid=' + MANAGER_GID + '&single=true&output=csv');
    const managerCSV = await managerResp.text();
    const managerData = parseCSV(managerCSV);

    // 3. Transform patient data
    const patients = patientData.rows.filter(r => r['Mobile no']).map(r => ({
      mobile: (r['Mobile no'] || '').trim(),
      name: (r['Name'] || '').trim(),
      state: (r['State'] || '').trim(),
      city: (r['Patient City'] || r['City'] || '').trim(),
      _date: parsePurchaseDate(r['Purchase date']),
      drug: (r['Drug Name'] || '').trim(),
      doctor: normDoctor(r['Doctor name']),
      doctorCity: (r['Doctor City'] || '').trim(),
      doctorState: (r['Doctor State'] || '').trim(),
      mcrCode: (r['MCR Code'] || '').trim(),
      employeeName: (r['Employee Name'] || '').trim(),
      zone: (r['Zone'] || '').trim(),
      region: (r['Region'] || '').trim(),
      area: (r['Area'] || '').trim(),
      hq: (r['Headquarter'] || '').trim(),
      dietBooked: parseInt(r['Diet booking count'] || '0') || 0,
      dietCompleted: parseInt(r['Diet completion count'] || '0') || 0,
      physioBooked: parseInt(r['Physio Booking count'] || '0') || 0,
      physioCompleted: parseInt(r['Physio completion count'] || '0') || 0,
    }));

    // 4. Process each manager
    const results = [];
    const today = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

    for (const mgr of managerData.rows) {
      const zone = (mgr['Zone'] || '').trim();
      const region = (mgr['Region'] || '').trim();
      const email = (mgr['Email ID'] || '').trim();
      const role = (mgr['Role'] || '').trim().toUpperCase();

      if (!email) continue;

      // Filter patients by zone (ZBM) or region (RBM)
      let filtered;
      let scopeLabel;
      if (role === 'ZBM') {
        filtered = patients.filter(r => r.zone.toUpperCase() === zone.toUpperCase());
        scopeLabel = 'Zone: ' + zone;
      } else {
        filtered = patients.filter(r => r.region.toUpperCase() === region.toUpperCase());
        scopeLabel = 'Region: ' + region;
      }

      if (!filtered.length) {
        results.push({ email, scope: scopeLabel, status: 'skipped', reason: 'No patients found' });
        continue;
      }

      // Build CSV
      const csvContent = buildDrWeeklyCSV(filtered);
      const csvBase64 = Buffer.from('\uFEFF' + csvContent, 'utf-8').toString('base64');

      // Build filename
      const filename = 'MySaathi_Dr_Weekly_' + (role === 'ZBM' ? zone : region).replace(/\s+/g, '_') + '_' + new Date().toISOString().slice(0, 10) + '.csv';

      // Send email via Resend
      const subject = 'MySaathi Dr. Weekly Report — ' + scopeLabel + ' (' + today + ')';
      const bodyHtml = '<div style="font-family:Arial,sans-serif;padding:20px;">'
        + '<h2 style="color:#0e2a33;">MySaathi Dr. Weekly Report</h2>'
        + '<p><strong>' + scopeLabel + '</strong></p>'
        + '<p>Total Patients: <strong>' + filtered.length + '</strong></p>'
        + '<p>Total Doctors: <strong>' + new Set(filtered.map(r => r.doctor).filter(Boolean)).size + '</strong></p>'
        + '<p>Report Date: ' + today + '</p>'
        + '<br><p>Please find the detailed Dr. Weekly Report attached.</p>'
        + '<br><p style="color:#888;font-size:12px;">This is an automated report from MySaathi Dashboard.</p>'
        + '</div>';

      const emailResp = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + RESEND_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: 'MySaathi Dashboard <onboarding@resend.dev>',
          to: [email],
          subject: subject,
          html: bodyHtml,
          attachments: [{
            filename: filename,
            content: csvBase64,
          }],
        }),
      });

      const emailResult = await emailResp.json();
      results.push({
        email, scope: scopeLabel, role,
        patients: filtered.length,
        doctors: new Set(filtered.map(r => r.doctor).filter(Boolean)).size,
        status: emailResp.ok ? 'sent' : 'failed',
        response: emailResult,
      });
    }

    res.status(200).json({
      success: true,
      timestamp: new Date().toISOString(),
      totalManagers: managerData.rows.length,
      results,
    });

  } catch (error) {
    res.status(500).json({ error: error.message, stack: error.stack });
  }
};
