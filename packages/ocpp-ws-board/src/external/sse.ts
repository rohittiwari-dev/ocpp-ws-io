/** SSE Broker for broadcasting real-time events to connected clients */
export class SSEBroker {
  private clients = new Set<(data: string) => void>();
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;

  constructor(heartbeatMs = 15000) {
    this.heartbeatInterval = setInterval(() => {
      this.broadcast(": heartbeat\n\n");
    }, heartbeatMs);
  }

  subscribe(send: (data: string) => void): () => void {
    this.clients.add(send);
    return () => {
      this.clients.delete(send);
    };
  }

  emit(event: string, data: unknown): void {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    this.broadcast(payload);
  }

  private broadcast(raw: string): void {
    for (const send of this.clients) {
      try {
        send(raw);
      } catch {
        this.clients.delete(send);
      }
    }
  }

  get clientCount(): number {
    return this.clients.size;
  }

  close(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    this.clients.clear();
  }
}
