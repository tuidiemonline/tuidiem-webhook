const crypto = require('crypto');
const admin = require('firebase-admin');
if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
module.exports = async (req, res) => {
  try {
    const idToken = (req.headers.authorization || '').replace('Bearer ', '');
    const { uid } = await admin.auth().verifyIdToken(idToken);
    const pub = process.env.OWM_PUBLIC_KEY, sec = process.env.OWM_SECRET_KEY;
    const expires = Math.floor(Date.now()/1000) + 3600;
    const sig = crypto.createHmac('sha256', sec).update(`offerwall-user-v1\n${pub}\n${uid}\n${expires}`, 'utf8').digest('hex');
    res.json({ url: `https://offerwall.me/offerwall/${encodeURIComponent(pub)}/${encodeURIComponent(uid)}?identityExpires=${expires}&identitySignature=${sig}` });
  } catch (e) { res.status(401).json({ error: 'unauthorized' }); }
};
