const admin = require('firebase-admin');

// Khởi tạo Firebase Admin (Lấy thông tin từ biến môi trường Vercel)
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
    })
  });
}

const db = admin.firestore();

module.exports = async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).send('Method Not Allowed');
  }

  // Lấy thông tin từ Postback của MyLead
  const { player_id, points, payout, trans_id, status } = req.query;

  if (!player_id || !trans_id) {
    return res.status(400).send('Thiếu tham số (Missing parameters)');
  }

  try {
    const userRef = db.collection('users').doc(player_id);
    const userDoc = await userRef.get();

    if (!userDoc.exists) {
      return res.status(404).send('Không tìm thấy User');
    }

    // TÍNH ĐIỂM: MyLead trả về điểm ảo (vd 0.24). Bạn muốn 1 điểm ảo = bao nhiêu điểm app?
    // Ví dụ dưới đây: Nhân 1000 lên. Bạn có thể sửa số 1000 này tùy thích.
    const pointsToAdd = Math.floor(parseFloat(points) * 1000) || 0; 

    if (pointsToAdd > 0) {
      await userRef.update({
        points: admin.firestore.FieldValue.increment(pointsToAdd)
      });
      console.log(`Đã cộng ${pointsToAdd} điểm cho user ${player_id}`);
    }

    return res.status(200).send('OK');

  } catch (error) {
    console.error('Lỗi webhook:', error);
    return res.status(500).send('Internal Server Error');
  }
};
