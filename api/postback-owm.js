import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

if (!getApps().length) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  initializeApp({ credential: cert(serviceAccount) });
}
const db = getFirestore();

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  try {
    const q = { ...req.query, ...(req.body || {}) };

    // 1. Phải có secret đúng (đặt OWM_SECRET trong Vercel env)
    if (!q.secret || q.secret !== process.env.OWM_SECRET) {
      return res.status(403).json({ error: 'Sai secret' });
    }

    // 2. Lấy dữ liệu đối tác gửi (đổi tên biến theo đúng doc OWM nếu khác)
    const uid = String(q.subid || q.sub_id || q.uid || '');
    const points = Math.floor(Number(q.points || q.amount || q.reward || 0));
    const txid = String(q.transaction_id || q.txid || q.id || '');
    if (!uid || points <= 0) return res.status(400).json({ error: 'Thiếu tham số' });

    // 3. Cộng điểm — mỗi giao dịch chỉ cộng 1 lần
    await db.runTransaction(async (t) => {
      if (txid) {
        const txRef = db.collection('postbacks').doc(txid);
        const txDoc = await t.get(txRef);
        if (txDoc.exists) throw new Error('DA_CONG');
        t.set(txRef, { uid, points, createdAt: new Date().toISOString() });
      }
      const userRef = db.collection('users').doc(uid);
      t.set(userRef, { points: FieldValue.increment(points) }, { merge: true });
    });

    return res.status(200).send('OK');
  } catch (error) {
    if (error.message === 'DA_CONG') return res.status(200).send('OK');
    console.error('Lỗi postback:', error);
    return res.status(400).json({ error: error.message });
  }
}
