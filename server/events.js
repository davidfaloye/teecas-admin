// Live updates for the admin dashboard over Server-Sent Events. New and updated orders are
// pushed to every signed-in admin who can see that branch.

const clients = new Set();

export function subscribe(req, res) {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();
  res.write('retry: 4000\n\n');
  const client = { res, user: req.user };
  clients.add(client);
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => {
    clearInterval(ping);
    clients.delete(client);
  });
}

export function publish(type, payload, branchId) {
  const data = `event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const c of clients) {
    if (c.user.role !== 'owner' && c.user.branchId !== branchId) continue;
    c.res.write(data);
  }
}

export const clientCount = () => clients.size;
