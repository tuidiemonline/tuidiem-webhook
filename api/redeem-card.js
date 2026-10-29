import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

if (!getApps().length) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  initializeApp({ credential: cert(serviceAccount) });
}
const db = getFirestore();
const auth = getAuth();

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  try {
    // 1. Xác thực
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Chưa đăng nhập' });
    }
    const idToken = authHeader.split('Bearer ')[1];
    const decodedToken = await auth.verifyIdToken(idToken);
    const uid = decodedToken.uid;

    // 2. Lấy dữ liệu
    const { op, opName, amount, cost } = req.body;
    const userRef = db.collection('users').doc(uid);
    
    // 3. Kiểm tra và trừ ĐIỂM (points) trên Server
    await db.runTransaction(async (t) => {
      const userDoc = await t.get(userRef);
      if (!userDoc.exists) throw new Error('Không tìm thấy user');

      const currentPoints = userDoc.data().points || 0;
      if (currentPoints < cost) {
        throw new Error(`Bạn chỉ có ${currentPoints} điểm, không đủ để đổi!`);
      }

      // TRỪ ĐIỂM TRÊN SERVER
      t.update(userRef, { points: FieldValue.increment(-cost) });

      // Tạo lệnh đổi thẻ (Chờ Admin gửi mã)
      const orderRef = db.collection('card_orders').doc();
      t.set(orderRef, {
        uid: uid,
        op: op,
        opName: opName,
        amount: amount,
        cost: cost,
        status: 'pending', // Đang chờ Admin gửi mã thẻ
        createdAt: new Date().toISOString()
      });
    });

    return res.status(200).json({ success: true, message: 'Tạo lệnh đổi thẻ thành công' });

  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
}
