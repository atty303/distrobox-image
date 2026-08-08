const DAY_MS = 24 * 60 * 60 * 1000;

function jstDate(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)!.value;
  return `${value("year")}/${value("month")}/${value("day")}`;
}

export async function resolveArchSnapshot(
  now: Date,
  request: typeof fetch = fetch,
): Promise<string> {
  for (let daysAgo = 1; daysAgo <= 7; daysAgo++) {
    const date = jstDate(new Date(now.getTime() - daysAgo * DAY_MS));
    let missing = false;
    for (const repository of ["core", "extra"]) {
      const response = await request(
        `https://archive.archlinux.org/repos/${date}/${repository}/os/x86_64/${repository}.db`,
        { method: "HEAD" },
      );
      if (response.status === 404) {
        missing = true;
        break;
      }
      if (!response.ok) {
        throw new Error(`Arch snapshot probe failed with HTTP ${response.status}`);
      }
    }
    if (!missing) return date;
  }
  throw new Error("no complete Arch snapshot found in the previous 7 days");
}
