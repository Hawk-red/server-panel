// Строгая проверка IP на фронте (то же правило, что на бэкенде): только корректный IPv4 или IPv6 без пробелов и лишних символов
export function isValidIp(v: string): boolean {
  if (v.length < 2 || v.length > 45 || !/^[0-9A-Fa-f:.]+$/.test(v)) return false
  if (!v.includes(':')) return /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/.test(v)
  try {
    new URL(`http://[${v}]/`) // разбор IPv6-литерала движком браузера
    return true
  } catch {
    return false
  }
}
