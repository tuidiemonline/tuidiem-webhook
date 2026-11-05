import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

if (!getApps().length) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  initializeApp({ credential: cert(serviceAccount) });
}
const db = getFirestore();
const authAdmin = getAuth();

const APPROVED = ['1', 'approved', 'complete', 'completed', 'valid', 'success'];

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  try {
    // 1. Xác thực Firebase ID Token
    const authHeader = req.headers.authorization || '';
    const idToken = authHeader.replace('Bearer ', '');
    if (!idToken) {
      return res.status(401).json({ error: 'Thiếu token xác thực' });
    }

    let decoded;
    try {
      decoded = await authAdmin.verifyIdToken(idToken);
    } catch (err) {
      return res.status(401).json({ error: 'Token không hợp lệ hoặc đã hết hạn' });
    }

    const realUid = decoded.uid; // UID thật từ Google – không thể giả mạo

    // 2. Parse body
    let body = req.body || {};
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch (e) { body = {}; }
    }
    const q = { ...req.query, ...body };

    // 3. Lấy thông tin – KHÔNG dùng secret, KHÔNG dùng uid từ body
    const points = Math.floor(Number(q.amount || q.points || q.reward || 0));
    const txid = String(q.transaction_id || q.txid || q.id || '');
    const status = q.status !== undefined ? String(q.status).toLowerCase() : '';

    if (points <= 0) {
      return res.status(400).json({ error: 'Thiếu hoặc sai số điểm' });
    }

    // 4. Nếu trạng thái không phải approved thì bỏ qua (trả 200 để OWM không retry)
    if (status && !APPROVED.includes(status)) {
      return res.status(200).send('OK');
    }

    // 5. Cộng điểm, chống trùng giao dịch
    await db.runTransaction(async (t) => {
      if (txid) {
        const txRef = db.collection('postbacks').doc(txid);
        const txDoc = await t.get(txRef);
        if (txDoc.exists) throw new Error('DA_CONG');
        t.set(txRef, { uid: realUid, points, status, createdAt: new Date().toISOString() });
      }
      t.set(
        db.collection('users').doc(realUid),
        { points: FieldValue.increment(points) },
        { merge: true }
      );
    });

    return res.status(200).send('OK');
  } catch (error) {
    if (error.message === 'DA_CONG') return res.status(200).send('OK');
    console.error('Lỗi postback:', error);
    return res.status(400).json({ error: error.message });
  }
}
