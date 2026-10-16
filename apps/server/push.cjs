// Phone notifications for the Owner (Web Push, through the installed AI Stoica app on aistoica.ro).
// The VAPID keys come from VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY, or are generated once and kept in system_settings,
// so nothing has to be added to .env. Expired phone subscriptions (404/410) are removed when a send fails.
const { BRAND_NAME, BRAND_DOMAIN } = require("./brand.cjs");
const webpush = require("web-push");

const MAX_SUBSCRIPTIONS_PER_USER = 10;

function createPush({ pool, ownerEmail, log = console }) {
  let keys = null;

  async function vapidKeys() {
    if (keys) return keys;
    const envPublic = String(process.env.VAPID_PUBLIC_KEY || "").trim(), envPrivate = String(process.env.VAPID_PRIVATE_KEY || "").trim();
    if (envPublic && envPrivate) keys = { publicKey: envPublic, privateKey: envPrivate };
    else {
      const saved = await pool.query("SELECT value FROM system_settings WHERE key='vapid_keys'");
      const v = saved.rows[0]?.value;
      if (v?.publicKey && v?.privateKey) keys = { publicKey: v.publicKey, privateKey: v.privateKey };
      else {
        const fresh = webpush.generateVAPIDKeys();
        // Two API containers starting together keep the first pair written.
        await pool.query(
          "INSERT INTO system_settings(key,value) VALUES('vapid_keys',$1::jsonb) ON CONFLICT(key) DO NOTHING",
          [JSON.stringify(fresh)]
        );
        const again = (await pool.query("SELECT value FROM system_settings WHERE key='vapid_keys'")).rows[0]?.value;
        keys = again?.publicKey && again?.privateKey ? { publicKey: again.publicKey, privateKey: again.privateKey } : fresh;
      }
    }
    return keys;
  }

  function validSubscription(s) {
    const endpoint = String(s?.endpoint || ""), p256dh = String(s?.keys?.p256dh || ""), auth = String(s?.keys?.auth || "");
    if (!/^https:\/\//.test(endpoint) || endpoint.length > 2000) return null;
    if (!/^[A-Za-z0-9_-]{20,200}$/.test(p256dh) || !/^[A-Za-z0-9_-]{8,100}$/.test(auth)) return null;
    return { endpoint, p256dh, auth };
  }

  async function subscribe(userId, subscription, userAgent = "") {
    const s = validSubscription(subscription);
    if (!s) return false;
    await pool.query(
      `INSERT INTO push_subscriptions(endpoint,user_id,p256dh,auth,user_agent) VALUES($1,$2,$3,$4,$5)
       ON CONFLICT(endpoint) DO UPDATE SET user_id=EXCLUDED.user_id, p256dh=EXCLUDED.p256dh, auth=EXCLUDED.auth, user_agent=EXCLUDED.user_agent`,
      [s.endpoint, userId, s.p256dh, s.auth, String(userAgent).slice(0, 300)]
    );
    // Old phones and browsers beyond the newest ten are forgotten.
    await pool.query(
      `DELETE FROM push_subscriptions WHERE user_id=$1 AND endpoint NOT IN
       (SELECT endpoint FROM push_subscriptions WHERE user_id=$1 ORDER BY created_at DESC LIMIT ${MAX_SUBSCRIPTIONS_PER_USER})`,
      [userId]
    );
    return true;
  }

  async function unsubscribe(userId, endpoint) {
    await pool.query("DELETE FROM push_subscriptions WHERE user_id=$1 AND endpoint=$2", [userId, String(endpoint || "")]);
  }

  async function count(userId) {
    const r = await pool.query("SELECT COUNT(*)::int AS n FROM push_subscriptions WHERE user_id=$1", [userId]);
    return Number(r.rows[0]?.n || 0);
  }

  // Sends to every phone of the user; returns how many received it.
  async function sendToUser(userId, payload) {
    if (!userId) return 0;
    const subs = (await pool.query("SELECT endpoint,p256dh,auth FROM push_subscriptions WHERE user_id=$1", [userId])).rows;
    if (!subs.length) return 0;
    const k = await vapidKeys();
    const subject = "mailto:" + (ownerEmail || `owner@${BRAND_DOMAIN}`);
    let delivered = 0;
    await Promise.all(subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          JSON.stringify(payload),
          { vapidDetails: { subject, publicKey: k.publicKey, privateKey: k.privateKey }, TTL: 7 * 24 * 3600, urgency: "high", timeout: 10000 }
        );
        delivered++;
        await pool.query("UPDATE push_subscriptions SET last_success_at=NOW() WHERE endpoint=$1", [s.endpoint]).catch(() => {});
      } catch (e) {
        if (e?.statusCode === 404 || e?.statusCode === 410) await pool.query("DELETE FROM push_subscriptions WHERE endpoint=$1", [s.endpoint]).catch(() => {});
        else log.warn?.(`[${BRAND_NAME}] Push failed:`, e?.statusCode || e?.code || e?.message);
      }
    }));
    return delivered;
  }

  return { vapidKeys, subscribe, unsubscribe, count, sendToUser, validSubscription };
}

module.exports = { createPush };
