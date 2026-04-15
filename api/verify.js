export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  const { reference } = req.body;

  if (!reference) {
    return res.status(400).json({ success: false, message: 'No reference provided' });
  }

  try {
    // Step 1: Verify payment with Paystack
    const paystackRes = await fetch(
      `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
          'Content-Type': 'application/json',
        },
      }
    );

    const paystackData = await paystackRes.json();

    if (!paystackData.status || paystackData.data.status !== 'success') {
      return res.status(400).json({ success: false, message: 'Payment not verified' });
    }

    // Step 2: Generate one-time Telegram invite link
    const telegramRes = await fetch(
      `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/createChatInviteLink`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: process.env.TELEGRAM_GROUP_ID,
          member_limit: 1,        // one-time use only
          expire_date: Math.floor(Date.now() / 1000) + 60 * 60 * 24, // expires in 24 hours
        }),
      }
    );

    const telegramData = await telegramRes.json();

    if (!telegramData.ok) {
      console.error('Telegram error:', telegramData);
      // Payment was successful even if Telegram fails — still return success
      return res.status(200).json({ success: true, telegramLink: null });
    }

    return res.status(200).json({
      success: true,
      telegramLink: telegramData.result.invite_link,
    });

  } catch (error) {
    console.error('Server error:', error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
}