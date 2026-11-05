import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';

if (!getApps().length) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  initializeApp({ credential: cert(serviceAccount) });
}
const db = getFirestore();
const authAdmin = getAuth();

const APPROVED = ['1', 'approved', 'complete', 'completed', 'valid', 'success'];

// ===== ĐÃ SỬA: cấu hình riêng cho luồng xem video VAST =====
// index.html gọi API này với transaction_id có dạng 'vd_<time>_<random>'
// và amount = 2. Phân luồng bằng prefix để KHÔNG làm hỏng postback Offerwall.
const VIDEO_PREFIX      = 'vd_';
const VIDEO_REWARD      = 2;       // cũ 20 -> 2 điểm / lượt
const VIDEO_COOLDOWN_MS = 120000;  // 2 phút giữa 2 lượt (khớp đồng hồ 02:00 trên web)
const VIDEO_MAX_PER_DAY = 20;      // giữ nguyên 20 lượt / ngày
const VN_TZ             = 'Asia/Ho_Chi_Minh';

function vnToday(ms) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: VN_TZ }).format(new Date(ms));
}

function toMillis(v) {
  if (!v) return 0;
  if (typeof v.toMillis === 'function') return v.toMillis();
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

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

    // ===== ĐÃ SỬA: phân luồng video / Offerwall =====
    // Với video: BỎ QUA số điểm do client gửi, ép cứng 2 điểm.
    // (Chặn kiểu F12 sửa amount=9999 để farm điểm)
    // Với Offerwall: giữ nguyên số điểm OWM gửi sang.
    const isVideo = txid.startsWith(VIDEO_PREFIX);
    const reward  = isVideo ? VIDEO_REWARD : points;

    // 5. Cộng điểm, chống trùng giao dịch
    await db.runTransaction(async (t) => {
      const userRef = db.collection('users').doc(realUid);
      const txRef   = txid ? db.collection('postbacks').doc(txid) : null;

      // --- Firestore bắt buộc: ĐỌC hết TRƯỚC khi GHI ---
      const txDoc = txRef ? await t.get(txRef) : null;
      if (txDoc && txDoc.exists) throw new Error('DA_CONG');

      let video = null;
      if (isVideo) {
        const userDoc = await t.get(userRef);
        const d = userDoc.exists ? userDoc.data() : {};
        const now = Date.now();

        // a) Chống spam: 2 phút giữa 2 lượt (lớp server, chặn cả gọi thẳng API)
        const last = toMillis(d.lastVideoAt);
        if (now - last < VIDEO_COOLDOWN_MS) throw new Error('VIDEO_COOLDOWN');

        // b) Giới hạn 20 lượt / ngày, reset 0h00 giờ VN
        const today = vnToday(now);
        const sameDay = d.videoKey === today;
        const count = sameDay ? (d.videoCount || 0) : 0;
        if (count >= VIDEO_MAX_PER_DAY) throw new Error('VIDEO_LIMIT');

        video = {
          now,
          today,
          count: count + 1,
          points: (sameDay ? (d.videoPoints || 0) : 0) + reward
        };
      }

      // --- GHI ---
      if (txRef) {
        t.set(txRef, { uid: realUid, points: reward, status, createdAt: new Date().toISOString() });
      }

      if (isVideo) {
        t.set(userRef, {
          points: FieldValue.increment(reward),
          lastVideoAt: Timestamp.fromMillis(video.now),
          videoKey: video.today,
          videoCount: video.count,
          videoPoints: video.points
        }, { merge: true });
      } else {
        t.set(userRef, { points: FieldValue.increment(reward) }, { merge: true });
      }
    });

    return res.status(200).send('OK');
  } catch (error) {
    if (error.message === 'DA_CONG') return res.status(200).send('OK');
    // Trả text (không phải JSON) để index.html nhận diện qua res.ok + txt
    if (error.message === 'VIDEO_COOLDOWN') return res.status(429).send('Chờ 2 phút giữa 2 lượt xem');
    if (error.message === 'VIDEO_LIMIT') return res.status(429).send('Hết 20 lượt xem hôm nay');
    console.error('Lỗi postback:', error);
    return res.status(400).json({ error: error.message });
  }
}
