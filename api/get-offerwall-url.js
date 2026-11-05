import crypto from 'crypto';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

if (!getApps().length) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  initializeApp({ credential: cert(serviceAccount) });
}
const authAdmin = getAuth();

// Public Key KHÔNG bí mật (nằm ngay trong URL offerwall).
// Ghi thẳng để tránh nhầm với biến OWM_PUBLIC_KEY cũ trên Vercel.
const PUBLIC_KEY = 'ZIZB92jR36CeUlPNBYvU39erLFPboR';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Cache-Control', 'no-store'); // luôn tạo link mới, không dùng link hết hạn
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const secret = process.env.OWM_SECRET_KEY;
    if (!secret) {
      return res.status(500).json({ error: 'Chưa cấu hình OWM_SECRET_KEY trên Vercel' });
    }

    // 1. Xác thực Firebase ID Token -> lấy UID thật, không tin uid gửi từ trình duyệt
    const idToken = (req.headers.authorization || '').replace('Bearer ', '');
    if (!idToken) return res.status(401).json({ error: 'Thiếu token xác thực' });

    let decoded;
    try {
      decoded = await authAdmin.verifyIdToken(idToken);
    } catch (e) {
      return res.status(401).json({ error: 'Token không hợp lệ hoặc đã hết hạn' });
    }
    const uid = decoded.uid;

    // 2. Ký theo chuẩn Offerwall.me Signed user IDs
    //    message = offerwall-user-v1\nPUBLIC_API_KEY\nEXACT_USER_ID\nEXPIRY_UNIX_SECONDS
    //    signature = hex(HMAC-SHA256(secret, message)) — 64 ký tự
    const expires = Math.floor(Date.now() / 1000) + 3600; // 1 giờ (tối đa 24h)
    const message = `offerwall-user-v1\n${PUBLIC_KEY}\n${uid}\n${expires}`;
    const signature = crypto
      .createHmac('sha256', secret)
      .update(message, 'utf8')
      .digest('hex');

    const url =
      `https://offerwall.me/offerwall/${encodeURIComponent(PUBLIC_KEY)}/${encodeURIComponent(uid)}` +
      `?identityExpires=${expires}&identitySignature=${signature}`;

    return res.status(200).json({ url });
  } catch (err) {
    console.error('Lỗi tạo offerwall url:', err);
    return res.status(500).json({ error: 'Không tạo được link nhiệm vụ' });
  }
}
