const admin = require('firebase-admin');

// Khởi tạo Firebase Admin
if (!admin.apps.length) {
  try {
    admin.initializeApp({ 
      credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) 
    });
  } catch (error) {
    console.error('Lỗi cấu hình Firebase:', error);
  }
}
const db = admin.firestore();

module.exports = async (req, res) => {
  try {
    // 1. Lấy dữ liệu từ URL (vì Offerwall.me đang gửi qua GET)
    const userId = req.query.user_id; 
    const reward = req.query.amount;
    const status = req.query.status;

    // 2. Kiểm tra dữ liệu hợp lệ
    if (!userId || !reward) {
      return res.status(400).send('Thiếu tham số user_id hoặc amount');
    }

    // 3. Tính toán số điểm (Nếu reward là tiền $ thì nhân lên, ở đây giữ nguyên theo số lượng gửi sang)
    const pointsToAdd = Math.abs(Number(reward) || 0); 

    if (pointsToAdd <= 0) {
      return res.status(400).send('Số điểm không hợp lệ');
    }

    // 4. Tạo mã giao dịch để tránh cộng điểm trùng lặp
    const transId = `owm_${userId}_${pointsToAdd}_${Date.now()}`;
    const txRef = db.collection('postbacks').doc(transId);

    // 5. Cập nhật điểm vào Firestore
    const userRef = db.collection('users').doc(userId);
    
    // ĐÃ SỬA: Dùng .set với { merge: true } để tự động tạo user nếu chưa có (tránh lỗi 500)
    await userRef.set({ 
      points: admin.firestore.FieldValue.increment(pointsToAdd) 
    }, { merge: true });

    // Lưu lại lịch sử giao dịch
    await txRef.set({ 
      userId, 
      pointsAdded: pointsToAdd, 
      status: status || '1', 
      createdAt: admin.firestore.FieldValue.serverTimestamp() 
    });

    // 6. Trả về thành công cho Offerwall.me
    return res.status(200).send('ok');

  } catch (error) {
    console.error("Lỗi xử lý postback:", error);
    return res.status(500).send("Lỗi Server");
  }
};
