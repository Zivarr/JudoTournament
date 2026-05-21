import { v4 as uuidv4 } from 'uuid';

// Map<connectionId, { ws, role, tatami }>
export const connections = new Map();

export function register(ws, role, tatami) {
  const id = uuidv4();
  ws._connId = id;
  connections.set(id, { ws, role: role || 'viewer', tatami: tatami || null });
  return id;
}

export function unregister(ws) {
  if (ws._connId) {
    connections.delete(ws._connId);
  }
}

export function updateConnection(ws, role, tatami) {
  if (ws._connId && connections.has(ws._connId)) {
    const conn = connections.get(ws._connId);
    connections.set(ws._connId, {
      ...conn,
      role: role !== undefined ? role : conn.role,
      tatami: tatami !== undefined ? tatami : conn.tatami
    });
  }
}

export function broadcast(event, data, filter) {
  const msg = JSON.stringify({ type: event, ...data });
  for (const [, conn] of connections) {
    if (conn.ws.readyState !== 1) continue; // 1 = OPEN
    if (filter) {
      if (filter.role && conn.role !== filter.role) continue;
      if (filter.tatami !== undefined && filter.tatami !== null && conn.tatami !== filter.tatami) continue;
    }
    try {
      conn.ws.send(msg);
    } catch (e) {
      // ignore send errors
    }
  }
}

export function broadcastToTatami(n, event, data) {
  const msg = JSON.stringify({ type: event, ...data });
  for (const [, conn] of connections) {
    if (conn.ws.readyState !== 1) continue;
    const tatamiMatch = conn.tatami === n || conn.tatami === String(n) || conn.tatami === Number(n);
    const isOverview = conn.role === 'overview';
    const isAdmin = conn.role === 'admin';
    if (tatamiMatch || isOverview || isAdmin) {
      try {
        conn.ws.send(msg);
      } catch (e) {
        // ignore
      }
    }
  }
}

export function broadcastAll(event, data) {
  broadcast(event, data, null);
}
