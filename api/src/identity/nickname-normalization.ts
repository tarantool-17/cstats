export function normalizeNicknameForLookup(nickname: string): string {
  return nickname.trim().toLowerCase().replace(/\s+/g, ' ');
}
