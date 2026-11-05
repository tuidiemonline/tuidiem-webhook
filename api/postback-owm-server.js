import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

// ============ CẤU HÌNH ============
// Offerwall.me: 1$ = 1500 Điểm (cài ở Currency Configuration)
// → amount mà Offerwall gửi về CHÍNH LÀ Điểm, không cần nhân chia gì thêm
// Muốn đổi tỉ lệ: sửa ô EXCHANGE RATE trên Offerwall.me, không sửa code này

function admin() {
  if (!getApps().length) {
    initializeApp({ credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
  }
  return getFirestore();
}

// Offerwall.me gọi về: ?user_id=&amount=&status=&transaction_id=&sig=
export default async function handler(req, res) {
  const q = req.query;
  const secret = process.env.OWM_SECRET_KEY || '';
  const log = msg => console.log('[owm] ' + msg);

  try {
    const uid = String(q.user_id || '').trim();
    const txid = String(q.transaction_id || q.txid || '').trim();
    const status = String(q.status || '').trim();
    // amount = số Điểm (đã làm tròn theo EXCHANGE RATE của Offerwall)
    const points = Math.round(Number(String(q.amount || '').replace(',', '.')) || 0);

    // 1. Xác thực chữ ký: sha256(uid + txid + amount + status + secret)
    const raw = `${uid}${txid}${q.amount || ''}${status}${secret}`;
    const h = Buffer.from(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw))
    ).toString('hex');
    const sig = String(q.sig || q.hash || '').toLowerCase();
    const okSig = secret && (sig === h || sig === h.slice(0, 16));

    // Chỉ bật kiểm tra chữ ký khi có truyền sig.
    // Nếu Offerwall.me không hỗ trợ biến {sig} → tắt bằng cách xóa 2 dòng dưới
    if (q.sig !== undefined && !okSig) {
      log('SAI CHU KY tu IP ' + (req.headers['x-forwarded-for'] || '?'));
      return res.status(401).send('bad signature');
    }

    // 2. Chỉ cộng khi nhiệm vụ được duyệt (status = 1 / approved / completed)
    const approved = ['1', 'approved', 'complete', 'completed']
      .includes(status.toLowerCase());
    if (!approved) {
      log('bo qua status=' + status);
      return res.status(200).send('ignored');
    }

    if (!uid || points <= 0) return res.status(400).send('bad params');

    const db = admin();

    // 3. Chống cộng 2 lần: 1 transaction_id chỉ cộng 1 lần
    const txRef = db.collection('owm_paid').doc(txid || `n_${Date.now()}`);
    const tx = await txRef.get();
    if (tx.exists) {
      log('da cong roi txid=' + txid);
      return res.status(200).send('already');
    }

    // 4. Phải là user thật (tránh test bắn lung tung tạo user rỗng)
    const uRef = db.collection('users').doc(uid);
    const u = await uRef.get();
    if (!u.exists) {
      log('user khong ton tai: ' + uid);
      return res.status(404).send('no user');
    }

    const now = new Date();

    await db.runTransaction(async t => {
      // Khoá giao dịch TRƯỚC rồi mới cộng điểm (chống test 2 lần cùng lúc)
      t.set(txRef, { uid, points, at: now.toISOString() });
      t.update(uRef, {
        points: (Number(u.data().points) || 0) + points,
        history: [
          {
            type: 'owm',
            amount: points,
            title: 'Nhiệm vụ kiếm điểm',
            status: 'completed',
            time: now.toLocaleString('vi-VN')
          },
          ...((u.data().history || []).slice(0, 99))
        ]
      });
    });

    log(`+${points} Điểm cho ${uid} (tx ${txid})`);
    return res.status(200).send('OK');
  } catch (e) {
    log('LOI ' + e.message);
    return res.status(500).send('error');
  }
}
