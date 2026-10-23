// Push notifications to the customer's phone when their order moves. The ordering app sends an
// Expo push token with the order (or later, from its settings); we keep it on the order and send
// one notification per status change through Expo's push service. Best effort: a failed push
// never blocks the status change.

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const TOKEN_RE = /^Expo(nent)?PushToken\[[^\]]{10,200}\]$/;

export function cleanPushToken(v) {
  if (v === null || v === undefined || v === '') return null;
  const s = String(v).trim();
  return TOKEN_RE.test(s) ? s : null;
}

const MESSAGES = {
  accepted: (o) => ['Order accepted', `${o.branchName || 'Teecas'} is preparing order #${o.number}.`],
  preparing: (o) => ['Being prepared', `Order #${o.number} is being prepared.`],
  ready: (o) =>
    o.fulfilment === 'pickup'
      ? ['Ready for pickup', `Order #${o.number} is ready. Pick it up at ${o.branchName || 'Teecas'} and pay there.`]
      : ['Order ready', `Order #${o.number} is ready.`],
  out_for_delivery: (o) => ['On the way', `Order #${o.number} is on its way. Have your payment ready.`],
  completed: (o) =>
    o.fulfilment === 'pickup'
      ? ['Collected', `Order #${o.number} has been collected. Enjoy your meal!`]
      : ['Delivered', `Order #${o.number} has been delivered. Enjoy your meal!`],
  cancelled: (o) => ['Order cancelled', `Order #${o.number} was cancelled${o.cancelReason ? `: ${o.cancelReason}` : '.'}`],
};

export async function notifyCustomer(order) {
  const to = cleanPushToken(order?.pushToken);
  const msg = MESSAGES[order?.status];
  if (!to || !msg || process.env.PUSH_DISABLED === '1') return { sent: false };
  const [title, body] = msg(order);
  try {
    const res = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        to,
        title,
        body,
        sound: 'default',
        channelId: 'orders',
        priority: 'high',
        data: { orderId: order._id, token: order.trackingToken, status: order.status },
      }),
    });
    return { sent: res.ok };
  } catch {
    return { sent: false };
  }
}
