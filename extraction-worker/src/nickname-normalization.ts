export function normalizeNicknameForLookup(nickname: string | null): string | null {
  if (nickname === null) {
    return null;
  }

  const normalized = nickname.trim().toLowerCase().replace(/\s+/g, ' ');
  return normalized.length > 0 ? normalized : null;
}
