// Возврат после входа — только на внутренние пути панели: "/updates?focus=apply" да, "//evil.com", "/\evil.com", "https://…" нет
export function safeRedirect(target: string | undefined | null): string {
  if (!target || !target.startsWith('/') || target.startsWith('//') || target.includes('\\') || [...target].some((c) => c.charCodeAt(0) < 32)) return '/'
  return target
}
