import crypto from 'crypto';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

function admin() {
  if (!getApps().length) {
    initializeApp({ credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
  }
  return getFirestore();
}

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const q = req.query;
  const secret = process.env.OWM_SECRET_KEY || '';
  const log = msg => console.log('[owm] ' + msg);

  try {
    const uid = String(q.user_id || '').trim();
    const txid = String(q.transaction_id || q.txid || '').trim();
    const status = String(q.status || '').trim();
    const points = Math.round(Number(String(q.amount || '').replace(',', '.')) || 0);

    // 1. Kiểm tra khóa bí mật (Secret Key) - BẢO MẬT
    const secretKey = String(q.secret || '').trim();
    if (!secretKey || secretKey !== 'Adminquanbodoivolamdog22122007999999@@9999') {
      log('KHÓA BÍ MẬT KHÔNG HỢP LỆ từ IP ' + (req.headers['x-forwarded-for'] || '?'));
      return res.status(401).json({ error: 'invalid_secret' });
    }

    // 2. Chỉ cộng khi nhiệm vụ được duyệt
    const approved = ['1', 'approved', 'complete', 'completed'];
    if (!approved.includes(status.toLowerCase())) {
      log('Bỏ qua, status = ' + status);
      return res.status(200).json({ message: 'ignored' });
    }

    if (!uid || points <= 0) {
      return res.status(400).json({ error: 'bad_params' });
    }

    const db = admin();

    // 3. Chống cộng 2 lần
    const txRef = db.collection('owm_paid').doc(txid || `notxid_${Date.now()}`);
    const txSnap = await txRef.get();
    if (txSnap.exists) {
      log('Giao dịch đã tồn tại: ' + txid);
      return res.status(200).json({ message: 'duplicate' });
    }

    // 4. Kiểm tra user tồn tại
    const userRef = db.collection('users').doc(uid);
    const userSnap = await userRef.get();
    if (!userSnap.exists) {
      log('User không tồn tại: ' + uid);
      return res.status(404).json({ error: 'user_not_found' });
    }

    const currentPoints = Number(userSnap.data().points) || 0;
    const now = new Date();

    // 5. Atomic transaction
    await db.runTransaction(async t => {
      t.set(txRef, {
        uid,
        points,
        txid,
        status,
        createdAt: now.toISOString()
      });
      t.update(userRef, {
        points: currentPoints + points,
        history: [
          {
            type: 'owm',
            amount: points,
            title: 'Nhiệm vụ kiếm điểm',
            status: 'completed',
            time: now.toLocaleString('vi-VN')
          },
          ...(userSnap.data().history || []).slice(0, 149)
        ]
      });
    });

    log(`✅ +${points} điểm cho ${uid} (tx: ${txid})`);
    return res.status(200).json({ success: true, points_added: points });
  } catch (e) {
    log('❌ Lỗi: ' + e.message);
    return res.status(500).json({ error: 'internal_error' });
  }
}
