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
    // Lưu ý: Tên biến phải khớp với trên Offerwall.me (?user_id=...&amount=...)
    const userId = req.query.user_id; 
    const reward = req.query.amount;
    const status = req.query.status;

    // 2. Kiểm tra dữ liệu hợp lệ
    if (!userId || !reward) {
      return res.status(400).send('Thiếu tham số user_id hoặc amount');
    }

    // 3. Tính toán số điểm (Chuyển đổi từ amount sang điểm)
    // Tùy thuộc vào Offerwall trả về tiền ($) hay điểm, bạn có thể nhân với hệ số.
    // Ví dụ: amount là 1.23 thì điểm là 1230. Nếu amount đã là điểm rồi thì cứ để nguyên.
    const pointsToAdd = Math.abs(Number(reward) || 0); 

    if (pointsToAdd <= 0) {
      return res.status(400).send('Số điểm không hợp lệ');
    }

    // 4. Tạo mã giao dịch (transId) để tránh cộng điểm trùng lặp
    // Vì Offerwall.me không gửi transId, ta tự tạo từ userId + số điểm + thời gian
    const transId = `owm_${userId}_${pointsToAdd}_${Date.now()}`;
    const txRef = db.collection('postbacks').doc(transId);

    // 5. Cập nhật điểm vào Firestore
    // (Đảm bảo collection 'users' và trường 'points' tồn tại trong Firestore của bạn)
    const userRef = db.collection('users').doc(userId);
    
    // Cộng điểm
    await userRef.update({ 
      points: admin.firestore.FieldValue.increment(pointsToAdd) 
    });

    // Lưu lại lịch sử
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
