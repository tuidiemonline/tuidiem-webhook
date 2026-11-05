import crypto from 'crypto';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const { user_id, amount, status, secret, transaction_id } = req.query;

    // 1. Kiểm tra Secret Key (phải khớp với biến OWM_SECRET_KEY trên Vercel)
    if (secret !== process.env.OWM_SECRET_KEY) {
      return res.status(401).json({ error: 'Invalid secret' });
    }

    // 2. Chỉ cộng điểm khi status = 1 (hoàn thành nhiệm vụ)
    if (status !== '1') {
      return res.status(200).json({ message: 'Skipped, status not completed' });
    }

    // 3. Kiểm tra thiếu thông tin
    if (!user_id || !amount) {
      return res.status(400).json({ error: 'Missing user_id or amount' });
    }

    // 4. Cộng điểm cho user vào Firebase
    const { initializeApp, cert, getApps } = await import('firebase-admin/app');
    const { getFirestore } = await import('firebase-admin/firestore');
    
    if (!getApps().length) {
      initializeApp({ credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
    }
    const db = getFirestore();

    const userRef = db.collection('users').doc(user_id);
    await userRef.set({
      points: parseInt(amount)
    }, { merge: true });

    console.log(`Credited ${amount} points to user ${user_id}`);
    return res.status(200).json({ success: true });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
}
