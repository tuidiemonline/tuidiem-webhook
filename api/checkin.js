import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

if (!getApps().length) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  initializeApp({ credential: cert(serviceAccount) });
}
const db = getFirestore();
const auth = getAuth();

const GAP_MS = 50 * 60 * 1000; // 50 phút
const POINTS = 24;
const MAX_PER_DAY = 20;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Chưa đăng nhập' });
    }
    const idToken = authHeader.split('Bearer ')[1];
    const decodedToken = await auth.verifyIdToken(idToken);
    const uid = decodedToken.uid;

    const userRef = db.collection('users').doc(uid);

    const kq = await db.runTransaction(async (t) => {
      const userDoc = await t.get(userRef);
      const now = Date.now();
      const d = userDoc.exists ? userDoc.data() : {};

      const conLai = GAP_MS - (now - (d.lastCheckin || 0));
      if (conLai > 0) throw new Error('TOO_EARLY:' + conLai);

      const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(now);
      let todayPoints = d.todayKey === today ? (d.todayPoints || 0) : 0;
      let todayCount  = d.todayKey === today ? (d.todayCount || 0) : 0;
      if (todayCount >= MAX_PER_DAY) throw new Error('Hết lượt điểm danh hôm nay!');

      const moi = {
        points: (d.points || 0) + POINTS,
        todayPoints: todayPoints + POINTS,
        todayCount: todayCount + 1,
        todayKey: today,
        lastCheckin: now,
      };
      t.set(userRef, moi, { merge: true });
      return moi;
    });

    return res.status(200).json({ success: true, ...kq });
  } catch (error) {
    if (String(error.message).startsWith('TOO_EARLY:')) {
      return res.status(429).json({ error: 'TOO_EARLY', remainMs: Number(error.message.split(':')[1]) });
    }
    console.error('Lỗi điểm danh:', error);
    return res.status(400).json({ error: error.message });
  }
}
