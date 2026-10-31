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

    const { bank, account, name, amount } = req.body;
    const soTien = Number(amount);
    if (!bank || !account || !name) throw new Error('Thiếu thông tin ngân hàng');
    if (!Number.isInteger(soTien) || soTien < 100000 || soTien > 500000) {
      throw new Error('Số tiền phải từ 100,000đ đến 500,000đ');
    }
    const diamondsNeeded = soTien; // 1đ = 1 kim cương

    const userRef = db.collection('users').doc(uid);

    await db.runTransaction(async (t) => {
      const userDoc = await t.get(userRef);
      if (!userDoc.exists) throw new Error('Không tìm thấy user');

      const currentDiamonds = userDoc.data().diamonds || 0;
      if (currentDiamonds < diamondsNeeded) {
        throw new Error(`Bạn chỉ có ${currentDiamonds} 💎, không đủ để rút!`);
      }

      t.update(userRef, { diamonds: FieldValue.increment(-diamondsNeeded) });

      const withdrawRef = db.collection('withdrawals').doc();
      t.set(withdrawRef, {
        uid, bank, account, name, amount: soTien,
        diamondsDeducted: diamondsNeeded,
        status: 'pending',
        createdAt: new Date().toISOString()
      });
    });

    return res.status(200).json({ success: true, message: 'Tạo lệnh rút thành công' });
  } catch (error) {
    console.error('Lỗi rút tiền:', error);
    return res.status(400).json({ error: error.message });
  }
}
