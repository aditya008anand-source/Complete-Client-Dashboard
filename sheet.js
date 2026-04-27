// Vercel Serverless Proxy — fetches Google Sheets CSV server-side
// Client browser never directly contacts docs.google.com
// This bypasses corporate firewalls that block Google Sheets

const SHEET_BASE = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQscA-Y05gGsr6xx54awNYgJJnCLoirIf5IKsNHRmLFYyBqtUL1khVmy3cP_L3U0pG1G6vMPPOqiNNO/pub';

// Allowed GIDs — only these sheets can be fetched
const ALLOWED_GIDS = ['1310523268', '1879543153', '419247046', '975503331'];

export default async function handler(req, res) {
  // CORS — allow dashboard to call this from any origin
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Handle preflight
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  const { gid } = req.query;

  // Validate GID — security check
  if (!gid || !ALLOWED_GIDS.includes(gid)) {
    res.status(400).json({ error: 'Invalid or missing GID parameter' });
    return;
  }

  const url = `${SHEET_BASE}?gid=${gid}&single=true&output=csv`;

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; MySaathi-Dashboard/1.0)',
      },
    });

    if (!response.ok) {
      res.status(response.status).json({
        error: `Google Sheets returned ${response.status}. Ensure sheet is published to web.`,
      });
      return;
    }

    const csvText = await response.text();

    // Return CSV with proper headers
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    // Cache for 5 minutes — reduces unnecessary fetches
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=60');
    res.status(200).send(csvText);

  } catch (error) {
    console.error('Proxy fetch error:', error);
    res.status(500).json({
      error: 'Failed to fetch sheet data. Please try again.',
      details: error.message,
    });
  }
}
