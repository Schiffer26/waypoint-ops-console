/** Main-process-only authority; tokens are generations, never renderer input. */
export interface SenderContext { sender: object; senderFrame: object | null }
export interface WindowContext { webContents: object; mainFrame: object; url: string }
export class ConsoleSession {
  private owner: object | null = null;
  private generation = 0;
  invalidate(): void { this.owner = null; this.generation++; }
  snapshot(): number { return this.generation; }
  isActive(window: WindowContext | null): boolean { return !!window && this.owner === window.webContents; }
  requireMain(event: SenderContext, window: WindowContext | null, expectedUrl: string): void {
    if (!window || event.sender !== window.webContents || event.senderFrame !== window.mainFrame || window.url !== expectedUrl) {
      throw new Error("Authorization denied: untrusted renderer");
    }
  }
  requireAuthenticated(event: SenderContext, window: WindowContext | null, expectedUrl: string): void {
    this.requireMain(event, window, expectedUrl);
    if (!this.isActive(window)) throw new Error("Authorization denied: authentication required");
  }
  grant(event: SenderContext, window: WindowContext | null, expectedUrl: string, generation: number): void {
    this.requireMain(event, window, expectedUrl);
    if (generation !== this.generation) throw new Error("Authorization denied: session expired");
    this.owner = event.sender;
  }
}
