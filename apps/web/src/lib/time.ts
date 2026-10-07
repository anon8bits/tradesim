const IST = "Asia/Kolkata";

const timeFormat = new Intl.DateTimeFormat("en-IN", {
  timeZone: IST,
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

const dateTimeFormat = new Intl.DateTimeFormat("en-IN", {
  timeZone: IST,
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const dateFormat = new Intl.DateTimeFormat("en-IN", {
  timeZone: IST,
  day: "2-digit",
  month: "short",
  year: "numeric",
});

function valid(iso: string): Date | null {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatTimeIST(iso: string): string {
  const date = valid(iso);
  return date ? `${timeFormat.format(date)} IST` : "—";
}

export function formatDateTimeIST(iso: string): string {
  const date = valid(iso);
  return date ? dateTimeFormat.format(date) : "—";
}

export function formatDateIST(iso: string): string {
  const date = valid(iso);
  return date ? dateFormat.format(date) : "—";
}

export function formatAge(iso: string, now: number = Date.now()): string {
  const date = valid(iso);
  if (!date) return "—";
  const seconds = Math.max(0, Math.round((now - date.getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return formatDateIST(iso);
}
