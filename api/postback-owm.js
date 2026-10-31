import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

if (!getApps().length) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  initializeApp({ credential: cert(serviceAccount) });
}
const db = getFirestore();

const APPROVED = ['1', 'approved', 'complete', 'completed', 'valid', 'success'];

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  try {
    const q = { ...req.query, ...(req.body || {}) };

    // 1. Secret bắt buộc
    if (!q.secret || q.secret !== process.env.OWM_SECRET_KEY) {
      return res.status(403).json({ error: 'Sai secret' });
    }

    // 2. OWM dùng user_id / amount / status
    const uid = String(q.user_id || q.subid || q.sub_id || q.uid || '');
    const points = Math.floor(Number(q.amount || q.points || q.reward || 0));
    const txid = String(q.transaction_id || q.txid || q.id || '');
    const status = q.status !== undefined ? String(q.status).toLowerCase() : '';

    if (!uid || points <= 0) return res.status(400).json({ error: 'Thiếu tham số' });

    // 3. Chỉ cộng khi task được duyệt (status approved); trả 200 để OWM không retry
    if (status && !APPROVED.includes(status)) return res.status(200).send('OK');

    // 4. Cộng điểm, chống trùng giao dịch
    await db.runTransaction(async (t) => {
      if (txid) {
        const txRef = db.collection('postbacks').doc(txid);
        const txDoc = await t.get(txRef);
        if (txDoc.exists) throw new Error('DA_CONG');
        t.set(txRef, { uid, points, status, createdAt: new Date().toISOString() });
      }
      t.set(db.collection('users').doc(uid), { points: FieldValue.increment(points) }, { merge: true });
    });

    return res.status(200).send('OK');
  } catch (error) {
    if (error.message === 'DA_CONG') return res.status(200).send('OK');
    console.error('Lỗi postback:', error);
    return res.status(400).json({ error: error.message });
  }
}
