export function formatSize(bytes: number): string {
  if (bytes < 1000) {
    return `(${bytes} B)`;
  }

  const units = ["KB", "MB", "GB", "TB"];
  let unitIndex = -1;
  let value = bytes;

  while (value >= 1000 && unitIndex < units.length - 1) {
    value /= 1000;
    unitIndex++;
  }

  // Use truncation to one decimal place as required by the tests
  const truncated = Math.floor(value * 10) / 10;
  // Ensure we format as "1.0" if it's exactly 1
  const formattedValue = Number.isInteger(truncated) ? `${truncated}.0` : truncated.toString();

  return `(${formattedValue} ${units[unitIndex]} / ${bytes} B)`;
}

export function formatBlockLine(entry: {
  ts: string;
  path: string;
  sizeBytes: number;
  turnIndex: number;
}): string {
  const sizeFormatted = formatSize(entry.sizeBytes);
  const escapedPath = entry.path.replace(/`/g, "\\`");
  return `\`${entry.ts}\` \`${escapedPath}\` ${sizeFormatted} — turn ${entry.turnIndex}`;
}

export function formatCycleHeader(
  cycleNum: number,
  startTs: string,
  endTs: string,
  totalTurns: number,
  readsAttempted: number,
  blockedCount: number
): string {
  const turnsStr = totalTurns === 1 ? "1 turn" : `${totalTurns} turns`;
  return `## Cycle ${cycleNum} — ${startTs} → ${endTs} (${turnsStr})\n**Reads** : ${readsAttempted} tentés / ${blockedCount} bloqués\n`;
}
