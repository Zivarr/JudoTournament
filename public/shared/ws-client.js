export class WsClient {
  constructor(url) {
    this._url = url;
    this._handlers = {};
    this._ws = null;
    this._retryDelay = 1000;
    this._maxDelay = 30000;
    this._intentionalClose = false;
    this._connectPromise = null;
    this.connect();
  }

  on(event, handler) {
    if (!this._handlers[event]) {
      this._handlers[event] = [];
    }
    this._handlers[event].push(handler);
    return this; // chainable
  }

  off(event, handler) {
    if (this._handlers[event]) {
      this._handlers[event] = this._handlers[event].filter(h => h !== handler);
    }
  }

  send(type, data) {
    const msg = JSON.stringify({ type, ...data });
    if (this._ws && this._ws.readyState === WebSocket.OPEN) {
      this._ws.send(msg);
    } else {
      console.warn('WS not connected, queuing message', type);
      // Queue message to send after reconnect
      if (!this._queue) this._queue = [];
      this._queue.push(msg);
    }
  }

  connect() {
    if (this._ws && (this._ws.readyState === WebSocket.CONNECTING || this._ws.readyState === WebSocket.OPEN)) {
      return;
    }
    this._intentionalClose = false;
    this._ws = new WebSocket(this._url);

    this._ws.addEventListener('open', () => {
      this._retryDelay = 1000;
      this._emit('open', {});
      // Flush queue
      if (this._queue && this._queue.length > 0) {
        for (const msg of this._queue) {
          this._ws.send(msg);
        }
        this._queue = [];
      }
    });

    this._ws.addEventListener('message', (event) => {
      try {
        const data = JSON.parse(event.data);
        const type = data.type;
        if (type) {
          this._emit(type, data);
        }
        this._emit('message', data);
      } catch (e) {
        console.error('WS parse error:', e);
      }
    });

    this._ws.addEventListener('close', (event) => {
      this._emit('close', { code: event.code, reason: event.reason });
      if (!this._intentionalClose) {
        setTimeout(() => {
          this._retryDelay = Math.min(this._retryDelay * 2, this._maxDelay);
          this.connect();
        }, this._retryDelay);
      }
    });

    this._ws.addEventListener('error', (err) => {
      this._emit('error', { error: err });
    });
  }

  disconnect() {
    this._intentionalClose = true;
    if (this._ws) {
      this._ws.close();
    }
  }

  get readyState() {
    return this._ws ? this._ws.readyState : WebSocket.CLOSED;
  }

  _emit(event, data) {
    const handlers = this._handlers[event];
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(data);
        } catch (e) {
          console.error(`Handler error for event ${event}:`, e);
        }
      }
    }
  }
}

export function getWsUrl() {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}/ws`;
}
