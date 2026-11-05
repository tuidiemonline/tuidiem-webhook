const crypto = require('crypto');
const admin = require('firebase-admin');

/* ===== api/offerwall-url.js — BẢN ĐÃ SỬA LỖI =====
   - Thêm Access-Control-Allow-Methods + giữ Authorization (hết lỗi preflight/CORS)
   - Kiểm tra đủ biến môi trường, báo rõ lý do thay vì 401 chung chung
   - Khởi tạo Firebase Admin lazy (không crash toàn hàm khi thiếu env)
   - Giữ nguyên chữ ký HMAC-SHA256 cho link offerwall.me */

let ready = false;
function initAdmin() {
  if (ready) return;
  const sa = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!sa) throw new Error('Thiếu FIREBASE_SERVICE_ACCOUNT trên Vercel');
  if (!admin.apps.length) {
    admin.initializeApp({ credential: admin.credential.cert(JSON.parse(sa)) });
  }
  ready = true;
}

module.exports = async (req, res) => {
  // ---- CORS: phải đặt TRƯỚC mọi return, kể cả OPTIONS ----
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const pub = process.env.OWM_PUBLIC_KEY;
    const sec = process.env.OWM_SECRET_KEY;
    if (!pub || !sec) {
      return res.status(500).json({ error: 'missing_env', details: 'Cần OWM_PUBLIC_KEY và OWM_SECRET_KEY trên Vercel' });
    }

    initAdmin();

    const idToken = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (!idToken) return res.status(401).json({ error: 'missing_token' });

    const { uid } = await admin.auth().verifyIdToken(idToken);
    const expires = Math.floor(Date.now() / 1000) + 3600;
    const sig = crypto
      .createHmac('sha256', sec)
      .update(`offerwall-user-v1\n${pub}\n${uid}\n${expires}`, 'utf8')
      .digest('hex');

    return res.status(200).json({
      url: `https://offerwall.me/offerwall/${encodeURIComponent(pub)}/${encodeURIComponent(uid)}?identityExpires=${expires}&identitySignature=${sig}`
    });
  } catch (e) {
    console.log('[offerwall-url]', e && e.message);
    return res.status(401).json({ error: 'unauthorized', details: String(e && e.message || e).slice(0, 160) });
  }
};
