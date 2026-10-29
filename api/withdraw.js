import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

// Cấu hình Firebase Admin
if (!getApps().length) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  initializeApp({ credential: cert(serviceAccount) });
}
const db = getFirestore();
const auth = getAuth();

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  try {
    // 1. Xác thực user qua Token
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Chưa đăng nhập' });
    }
    const idToken = authHeader.split('Bearer ')[1];
    const decodedToken = await auth.verifyIdToken(idToken);
    const uid = decodedToken.uid;

    // 2. Lấy dữ liệu gửi lên
    const { bank, account, name, amount } = req.body;
    
    // Tỷ lệ quy đổi của bạn: 1đ = 1 Kim cương
    const diamondsNeeded = amount; 

    const userRef = db.collection('users').doc(uid);
    
    // 3. Dùng Transaction để kiểm tra và trừ điểm an toàn
    await db.runTransaction(async (t) => {
      const userDoc = await t.get(userRef);
      if (!userDoc.exists) throw new Error('Không tìm thấy user');

      const currentDiamonds = userDoc.data().diamonds || 0;

      if (currentDiamonds < diamondsNeeded) {
        throw new Error(`Bạn chỉ có ${currentDiamonds} 💎, không đủ để rút!`);
      }

      // TRỪ KIM CƯƠNG TRÊN SERVER
      t.update(userRef, { diamonds: FieldValue.increment(-diamondsNeeded) });

      // Tạo lệnh rút tiền
      const withdrawRef = db.collection('withdrawals').doc();
      t.set(withdrawRef, {
        uid: uid,
        bank, account, name, amount, 
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
