/**
 * Id визита, который придумывает телефон: по нему сервер узнаёт повторную
 * отправку (офлайн-очередь, обрыв связи) и не создаёт дубль.
 * crypto.randomUUID есть только на HTTPS/localhost — при проверке с телефона
 * по http://192.168… его нет, поэтому запасной вариант на getRandomValues.
 */
export function newClientId() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
