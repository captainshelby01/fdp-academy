const https = require('https');

// ── Telegram Group Chat IDs ──────────────────────────────────────
const GROUPS = {
  group1: '-5017934097',   // Courses 1–5 (individual)
  group2: '-5135215777',   // Courses 6–10 (individual)
  total:  '-5169240038',   // Total Package (₦20,000)
};

// Which individual skills go to which group
const GROUP1_SKILLS = [
  'digital marketing',
  'customer service',
  'virtual assistance',
  'social media management',
  'copywriting',
];

function getGroupId(plan, skill) {
  // Total package → always group 3
  if (plan && plan.toLowerCase().includes('total')) {
    return GROUPS.total;
  }

  // Individual skill → route by skill name
  if (skill) {
    const s = skill.toLowerCase().trim();
    if (GROUP1_SKILLS.includes(s)) return GROUPS.group1;
    return GROUPS.group2; // courses 6–10
  }

  // Fallback: if somehow no skill provided but amount matches
  return GROUPS.group1;
}

function paystackRequest(path) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.paystack.co',
      path,
      method: 'GET',
      headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` },
    };
    https.get(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

function telegramRequest(method, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const options = {
      hostname: 'api.telegram.org',
      path: `/bot${process.env.TELEGRAM_BOT_TOKEN}/${method}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { reference } = req.body;
  if (!reference) {
    return res.status(400).json({ error: 'No reference provided' });
  }

  try {
    // 1. Verify payment with Paystack
    const paystackData = await paystackRequest(
      `/transaction/verify/${encodeURIComponent(reference)}`
    );

    if (!paystackData.status || paystackData.data?.status !== 'success') {
      return res.status(400).json({ success: false, error: 'Payment not successful' });
    }

    const txn = paystackData.data;

    // 2. Extract plan and skill from metadata
    const fields      = txn.metadata?.custom_fields || [];
    const planField   = fields.find((f) => f.variable_name === 'plan');
    const skillField  = fields.find((f) => f.variable_name === 'skill');
    const plan        = planField?.value  || '';
    const skill       = skillField?.value || '';

    // 3. Determine correct Telegram group
    const chatId = getGroupId(plan, skill);

    // 4. Create one-time invite link (expires in 1 hour, single use)
    const expireDate = Math.floor(Date.now() / 1000) + 3600;
    const inviteRes  = await telegramRequest('createChatInviteLink', {
      chat_id:              chatId,
      member_limit:         1,
      expire_date:          expireDate,
      creates_join_request: false,
    });

    if (!inviteRes.ok) {
      console.error('Telegram error:', JSON.stringify(inviteRes));
      return res.status(500).json({ success: false, error: 'Could not create invite link' });
    }

    const telegramLink = inviteRes.result.invite_link;
    return res.status(200).json({ success: true, telegramLink });

  } catch (err) {
    console.error('Verify error:', err);
    return res.status(500).json({ success: false, error: 'Server error' });
  }
};