export const SERVICES = [
  {
    id: "strength",
    name: "Strength & conditioning",
    shortName: "Strength",
    duration: 60,
    durationOptions: [60, 120],
    priceCents: 16500,
    priceCentsTwo: 25000,
    description: "A focused full-body session built around your goals, your space, and the equipment you have.",
    bestFor: "Build strength & confidence",
  },
  {
    id: "mobility",
    name: "Mobility & stretching",
    shortName: "Mobility",
    duration: 60,
    durationOptions: [60],
    priceCents: 16500,
    priceCentsTwo: 25000,
    description: "Guided stretching and mobility work to improve flexibility, posture, and ease of movement.",
    bestFor: "Move better & recover",
  },
  {
    id: "reset",
    name: "The total reset",
    shortName: "Total reset",
    duration: 60,
    durationOptions: [60, 120],
    priceCents: 16500,
    priceCentsTwo: 25000,
    description: "An energizing mix of strength, low-impact conditioning, and a deliberate mobility finish.",
    bestFor: "Energy & consistency",
  },
] as const;

export type ServiceId = (typeof SERVICES)[number]["id"];
export type SessionDuration = 45 | 60 | 120;
export const SERVICE_IDS = SERVICES.map((service) => service.id) as [ServiceId, ...ServiceId[]];
export const BOOKING_WINDOW_DAYS = 30;
export const ALL_TIMES = Array.from({ length: 22 }, (_, index) => {
  const minutes = 7 * 60 + 30 + index * 30;
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}) as [string, ...string[]];

export function getBookableDates(limit = BOOKING_WINDOW_DAYS) {
  const dates: string[] = [];
  const cursor = new Date();
  cursor.setHours(12, 0, 0, 0);
  cursor.setDate(cursor.getDate() + 1);
  while (dates.length < limit) {
    if (cursor.getDay() !== 0) {
      const year = cursor.getFullYear();
      const month = String(cursor.getMonth() + 1).padStart(2, "0");
      const day = String(cursor.getDate()).padStart(2, "0");
      dates.push(`${year}-${month}-${day}`);
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
}

export function getService(id: string) {
  return SERVICES.find((service) => service.id === id);
}

export function supportsDuration(service: (typeof SERVICES)[number], duration: number) {
  return (service.durationOptions as readonly number[]).includes(duration);
}

export function getSessionPrice(
  service: (typeof SERVICES)[number],
  participants: 1 | 2,
  duration: number = service.duration,
) {
  const basePrice = participants === 2 ? service.priceCentsTwo : service.priceCents;
  return service.durationOptions.length > 1 ? basePrice * (duration / 60) : basePrice;
}

export function timeToMinutes(time: string) {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

export function sessionsOverlap(
  firstStart: string,
  firstDuration: number,
  secondStart: string,
  secondDuration: number,
) {
  const firstStartMinutes = timeToMinutes(firstStart);
  const secondStartMinutes = timeToMinutes(secondStart);
  return (
    firstStartMinutes < secondStartMinutes + secondDuration &&
    secondStartMinutes < firstStartMinutes + firstDuration
  );
}

export function formatPrice(cents: number) {
  const hasCents = cents % 100 !== 0;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: hasCents ? 2 : 0,
    maximumFractionDigits: hasCents ? 2 : 0,
  }).format(cents / 100);
}
