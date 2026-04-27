const SHEET_BASE = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQscA-Y05gGsr6xx54awNYgJJnCLoirIf5IKsNHRmLFYyBqtUL1khVmy3cP_L3U0pG1G6vMPPOqiNNO/pub';
const ALLOWED_GIDS = ['1310523268', '1879543153', '419247046', '975503331'];

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  const gid = req.query.gid;

  if (!gid || !ALLOWED_GIDS.includes(gid)) {
    res.status(400).json({ error: 'Invalid or missing GID' });
    return;
  }

  const url = SHEET_BASE + '?gid=' + gid + '&single=true&output=csv';

  try {
    const response = await fetch(url);

    if (!response.ok) {
      res.status(response.status).json({ error: 'Google Sheets error: ' + response.status });
      return;
    }

    const csvText = await response.text();
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=60');
    res.status(200).send(csvText);

  } catch (error) {
    res.status(500).json({ error: 'Fetch failed: ' + error.message });
  }
};
