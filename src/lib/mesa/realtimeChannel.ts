/** Nome público do canal de invalidação da Mesa. Seguro para uso no cliente. */
export function mesaChannelName(sessionId: string): string {
  return `mesa:${sessionId}`;
}
