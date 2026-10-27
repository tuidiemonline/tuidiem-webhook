const crypto = require('crypto');
const admin = require('firebase-admin');
if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
const db = admin.firestore();
module.exports = async (req, res) => {
  const { subId, transId, reward, status, signature, payout, offer_name, country } = req.body;
  const expected = crypto.createHash('md5').update(`${subId}${transId}${reward}${process.env.OWM_SECRET_KEY}`).digest('hex');
  if (expected !== signature) return res.status(403).send('bad sign');
  const txRef = db.collection('postbacks').doc(transId);
  if ((await txRef.get()).exists) return res.send('ok');
  const amount = Math.abs(Number(reward) || 0);
  if (!subId || !transId || amount <= 0) return res.status(400).send('missing params');
  await txRef.set({ subId, transId, reward, payout, offer_name, country, status, createdAt: admin.firestore.FieldValue.serverTimestamp() });
  const delta = status == '2' ? -amount : amount;
  await db.collection('users').doc(subId).update({ points: admin.firestore.FieldValue.increment(delta) });
  res.send('ok');
};
