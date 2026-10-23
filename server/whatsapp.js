// WhatsApp notifications.
//
// Default (same as the teecas.online menu today): the ordering app opens a wa.me link with the
// order pre-written, addressed to the branch's WhatsApp number, and the customer taps Send.
// The API builds that message and link so the app and website stay consistent.
//
// Optional: if WHATSAPP_TOKEN and WHATSAPP_PHONE_NUMBER_ID are set (Meta WhatsApp Cloud API),
// the server also messages the branch directly the moment an order is saved, so the restaurant
// is notified even if the customer never taps Send. Business-initiated messages outside a
// 24-hour customer window need an approved template; set WHATSAPP_TEMPLATE to use one.

import { naira } from './lib.js';

export function orderMessage(order, branch) {
  const lines = order.items.map((i) => `${i.name} ~ ${i.qty}`);
  const parts = [
    `Hello, I'd like to place an order for:`,
    '',
    ...lines,
    '',
    `Order: #${order.number}`,
    ...(branch?.name && order.branchId ? [`Branch: ${branch.name}`] : []),
    order.fulfilment === 'delivery' ? `Delivery to: ${order.customer.address}` : `Pickup at ${order.branchName || 'the branch'} (as soon as it's ready)`,
    order.fulfilment === 'delivery'
      ? `Total: ${naira(order.total)} (pay on delivery${order.deliveryFeeExcluded ? ', delivery fee excluded' : ''})`
      : `Total: ${naira(order.total)} (pay at pickup)`,
    `Name: ${order.customer.name}`,
    `Phone: ${order.customer.phone}`,
  ];
  if (order.note) parts.push(`Note: ${order.note}`);
  return parts.join('\n');
}

export function waLink(phone, text) {
  return `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
}

export function cloudApiEnabled() {
  return Boolean(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID);
}

export async function notifyBranch(order, branch) {
  if (!cloudApiEnabled() || !branch.whatsapp) return { sent: false, reason: 'cloud_api_off' };
  const url = `https://graph.facebook.com/v21.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;
  const template = process.env.WHATSAPP_TEMPLATE;
  const body = template
    ? {
        messaging_product: 'whatsapp',
        to: branch.whatsapp,
        type: 'template',
        template: {
          name: template,
          language: { code: process.env.WHATSAPP_TEMPLATE_LANG || 'en' },
          components: [
            {
              type: 'body',
              parameters: [
                { type: 'text', text: String(order.number) },
                { type: 'text', text: naira(order.total) },
                { type: 'text', text: order.customer.name },
              ],
            },
          ],
        },
      }
    : {
        messaging_product: 'whatsapp',
        to: branch.whatsapp,
        type: 'text',
        text: { body: `New app order\n\n${orderMessage(order, branch)}` },
      };
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) {
      const text = await r.text();
      console.warn('[whatsapp] Cloud API send failed', r.status, text.slice(0, 300));
      return { sent: false, reason: `http_${r.status}` };
    }
    return { sent: true };
  } catch (e) {
    console.warn('[whatsapp] Cloud API send error', e.message);
    return { sent: false, reason: 'network' };
  }
}
