import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

if (!getApps().length) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  initializeApp({ credential: cert(serviceAccount) });
}
const db = getFirestore();
const auth = getAuth();

// Bảng giá TRÊN SERVER — client không sửa được
const OPS = ['viettel', 'vinaphone', 'mobifone', 'garena'];
const MENH_GIA = [10000, 20000, 50000, 100000, 200000, 500000];

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Chưa đăng nhập' });
    }
    const idToken = authHeader.split('Bearer ')[1];
    const decodedToken = await auth.verifyIdToken(idToken);
    const uid = decodedToken.uid;

    const { op, opName, amount } = req.body;
    if (!OPS.includes(op) || !MENH_GIA.includes(Number(amount))) {
      return res.status(400).json({ error: 'Sai nhà mạng hoặc mệnh giá' });
    }
    const cost = Number(amount); // 1 điểm = 1đ, server tự quyết

    const userRef = db.collection('users').doc(uid);

    await db.runTransaction(async (t) => {
      const userDoc = await t.get(userRef);
      if (!userDoc.exists) throw new Error('Không tìm thấy user');

      const currentPoints = userDoc.data().points || 0;
      if (currentPoints < cost) {
        throw new Error(`Bạn chỉ có ${currentPoints} điểm, không đủ để đổi!`);
      }

      t.update(userRef, { points: FieldValue.increment(-cost) });

      const orderRef = db.collection('card_orders').doc();
      t.set(orderRef, {
        uid, op, opName, amount: cost, cost,
        status: 'pending',
        createdAt: new Date().toISOString()
      });
    });

    return res.status(200).json({ success: true, message: 'Tạo lệnh đổi thẻ thành công' });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
}
