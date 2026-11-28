import { useMemo, useState } from "react";
import { Link } from "react-router";
import {
  ArrowLeft,
  Ban,
  CalendarCheck,
  CalendarX2,
  Check,
  ChevronDown,
  Clock,
  DollarSign,
  LoaderCircle,
  Lock,
  LogOut,
  Mail,
  MapPin,
  MessageSquareText,
  Phone,
  Search,
  Trash2,
  UserRound,
  Users,
} from "lucide-react";
import { trpc } from "@/providers/trpc";
import { ALL_TIMES, formatPrice } from "@contracts/training";

type Tab = "schedule" | "availability" | "clients";

function friendlyDate(value: string, withWeekday = true) {
  return new Intl.DateTimeFormat("en-US", {
    weekday: withWeekday ? "short" : undefined,
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(`${value}T12:00:00`));
}

function friendlyTime(value: string) {
  const [hour, minute] = value.split(":").map(Number);
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" })
    .format(new Date(2026, 0, 1, hour, minute));
}

function localToday() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function firstName(full: string) {
  return full.trim().split(/\s+/)[0] ?? full;
}

function smsHref(phone: string, body: string) {
  const digits = phone.replace(/[^\d+]/g, "");
  return `sms:${digits}?&body=${encodeURIComponent(body)}`;
}

function mailHref(email: string, subject: string, body: string) {
  return `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

export default function Admin() {
  const session = trpc.admin.session.useQuery(undefined, { retry: false, staleTime: 5_000 });

  if (session.isLoading) {
    return (
      <main className="admin-shell admin-center">
        <LoaderCircle className="spin" size={28} />
      </main>
    );
  }

  if (session.data && !session.data.configured) {
    return (
      <main className="admin-shell admin-center">
        <div className="admin-login-card">
          <Lock size={26} />
          <h1>Admin isn’t set up yet</h1>
          <p>The server needs an admin passcode before the dashboard can be used. Add it to the server environment, then reload this page.</p>
          <Link className="button button-dark" to="/">Back to site</Link>
        </div>
      </main>
    );
  }

  if (!session.data?.authenticated) {
    return <Login onSuccess={() => session.refetch()} />;
  }

  return <Dashboard />;
}

function Login({ onSuccess }: { onSuccess: () => void }) {
  const [passcode, setPasscode] = useState("");
  const login = trpc.admin.login.useMutation({ onSuccess });

  return (
    <main className="admin-shell admin-center">
      <form
        className="admin-login-card"
        onSubmit={(event) => {
          event.preventDefault();
          login.mutate({ passcode });
        }}
      >
        <Lock size={26} />
        <h1>Lucia’s dashboard</h1>
        <p>Enter your admin passcode to manage bookings, availability, and clients.</p>
        <input
          type="password"
          value={passcode}
          onChange={(event) => setPasscode(event.target.value)}
          placeholder="Admin passcode"
          autoComplete="current-password"
          autoFocus
        />
        {login.isError && <p className="admin-error" role="alert">{login.error.message}</p>}
        <button className="button button-dark" type="submit" disabled={!passcode || login.isPending}>
          {login.isPending ? "Checking…" : "Sign in"}
        </button>
        <Link className="admin-backlink" to="/"><ArrowLeft size={15} /> Back to site</Link>
      </form>
    </main>
  );
}

function Dashboard() {
  const [tab, setTab] = useState<Tab>("schedule");
  const utils = trpc.useUtils();
  const overview = trpc.admin.overview.useQuery();
  const logout = trpc.admin.logout.useMutation({
    onSuccess: () => utils.admin.session.invalidate(),
  });

  return (
    <main className="admin-shell">
      <header className="admin-header">
        <div>
          <p className="admin-kicker">Fit by Lucia</p>
          <h1>Dashboard</h1>
        </div>
        <div className="admin-header-actions">
          <Link className="admin-backlink" to="/"><ArrowLeft size={15} /> View site</Link>
          <button type="button" className="admin-icon-button" onClick={() => logout.mutate()} aria-label="Sign out">
            <LogOut size={17} /> Sign out
          </button>
        </div>
      </header>

      <section className="admin-stats" aria-label="Overview">
        <div className="admin-stat">
          <CalendarCheck size={18} />
          <div><strong>{overview.data?.upcomingSessions ?? "–"}</strong><span>Upcoming sessions</span></div>
        </div>
        <div className="admin-stat">
          <DollarSign size={18} />
          <div><strong>{overview.data?.pendingPayments ?? "–"}</strong><span>Awaiting payment</span></div>
        </div>
        <div className="admin-stat">
          <Users size={18} />
          <div><strong>{overview.data?.clients ?? "–"}</strong><span>Clients</span></div>
        </div>
        <div className="admin-stat">
          <Ban size={18} />
          <div><strong>{overview.data?.blockedEntries ?? "–"}</strong><span>Blocked entries</span></div>
        </div>
      </section>

      <nav className="admin-tabs" aria-label="Dashboard sections">
        {([
          ["schedule", "Schedule"],
          ["availability", "Availability"],
          ["clients", "Clients"],
        ] as [Tab, string][]).map(([key, label]) => (
          <button
            key={key}
            type="button"
            className={tab === key ? "admin-tab is-active" : "admin-tab"}
            onClick={() => setTab(key)}
            aria-pressed={tab === key}
          >
            {label}
          </button>
        ))}
      </nav>

      {tab === "schedule" && <ScheduleTab />}
      {tab === "availability" && <AvailabilityTab />}
      {tab === "clients" && <ClientsTab />}
    </main>
  );
}

/* ---------------- Schedule tab ---------------- */

type BookingRow = {
  id: number;
  serviceName: string;
  duration: number;
  amountCents: number;
  sessionDate: string;
  startTime: string;
  customerName: string;
  email: string;
  phone: string;
  address: string;
  goals: string | null;
  notes: string | null;
  paymentMethod: "stripe" | "pay_later" | "venmo";
  paymentStatus: "unpaid" | "pending" | "processing" | "paid" | "refunded";
  bookingStatus: "pending" | "confirmed" | "cancelled" | "completed";
  createdAt: Date;
};

const paymentLabel: Record<BookingRow["paymentStatus"], string> = {
  paid: "Paid",
  pending: "Payment pending",
  processing: "Processing",
  unpaid: "Pays at session",
  refunded: "Refunded",
};

const bookingLabel: Record<BookingRow["bookingStatus"], string> = {
  pending: "Awaiting confirmation",
  confirmed: "Confirmed",
  completed: "Completed",
  cancelled: "Cancelled",
};

function ScheduleTab() {
  const [filter, setFilter] = useState<"upcoming" | "past" | "all">("upcoming");
  const bookings = trpc.admin.bookings.useQuery({ filter });

  return (
    <section className="admin-panel">
      <div className="admin-panel-head">
        <h2>Sessions</h2>
        <div className="admin-filter" role="group" aria-label="Filter sessions">
          {(["upcoming", "past", "all"] as const).map((value) => (
            <button
              key={value}
              type="button"
              className={filter === value ? "is-active" : ""}
              onClick={() => setFilter(value)}
            >
              {value[0].toUpperCase() + value.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {bookings.isLoading && <div className="admin-loading"><LoaderCircle className="spin" size={20} /> Loading sessions…</div>}
      {bookings.isError && <p className="admin-error" role="alert">Couldn’t load sessions. <button type="button" onClick={() => bookings.refetch()}>Try again</button></p>}
      {bookings.data?.length === 0 && <p className="admin-empty">No sessions here yet.</p>}

      <div className="admin-cards">
        {(bookings.data as BookingRow[] | undefined)?.map((booking) => (
          <BookingCard key={booking.id} booking={booking} />
        ))}
      </div>
    </section>
  );
}

function BookingCard({ booking }: { booking: BookingRow }) {
  const utils = trpc.useUtils();
  const [cancelArmed, setCancelArmed] = useState(false);
  const update = trpc.admin.updateBooking.useMutation({
    onSuccess: () => {
      setCancelArmed(false);
      utils.admin.bookings.invalidate();
      utils.admin.overview.invalidate();
      utils.admin.clients.invalidate();
      utils.booking.availability.invalidate();
    },
  });

  const cancelled = booking.bookingStatus === "cancelled";
  const emailBody = `Hi ${firstName(booking.customerName)},\n\nAbout your ${booking.serviceName} session on ${friendlyDate(booking.sessionDate)} at ${friendlyTime(booking.startTime)}:\n\n\n\n— Lucia`;

  return (
    <article className={cancelled ? "admin-card is-dimmed" : "admin-card"}>
      <div className="admin-card-top">
        <div className="admin-card-when">
          <strong>{friendlyDate(booking.sessionDate)}</strong>
          <span><Clock size={14} /> {friendlyTime(booking.startTime)} · {booking.duration} min</span>
        </div>
        <div className="admin-pills">
          <span className={`pill pill-${booking.bookingStatus}`}>{bookingLabel[booking.bookingStatus]}</span>
          <span className={`pill pill-pay-${booking.paymentStatus}`}>{paymentLabel[booking.paymentStatus]}</span>
        </div>
      </div>

      <div className="admin-card-body">
        <p className="admin-card-title">{booking.customerName} <span>· {booking.serviceName} · {formatPrice(booking.amountCents)} · {booking.paymentMethod === "venmo" ? "Venmo" : booking.paymentMethod === "stripe" ? "Card" : "At session"}</span></p>
        <p className="admin-card-line"><MapPin size={14} /> {booking.address}</p>
        {booking.goals && <p className="admin-card-line admin-note">Goals: {booking.goals}</p>}
        {booking.notes && <p className="admin-card-line admin-note">Notes: {booking.notes}</p>}
      </div>

      <div className="admin-card-contact">
        <a href={`tel:${booking.phone.replace(/[^\d+]/g, "")}`} className="admin-chip"><Phone size={14} /> {booking.phone}</a>
        <a href={mailHref(booking.email, "Your session with Lucia", emailBody)} className="admin-chip"><Mail size={14} /> Email</a>
        <a href={smsHref(booking.phone, `Hi ${firstName(booking.customerName)}, it’s Lucia about your session on ${friendlyDate(booking.sessionDate)} at ${friendlyTime(booking.startTime)}. `)} className="admin-chip"><MessageSquareText size={14} /> Text</a>
      </div>

      {!cancelled && (
        <div className="admin-card-actions">
          {booking.paymentStatus !== "paid" && (
            <button type="button" disabled={update.isPending} onClick={() => update.mutate({ id: booking.id, action: "mark_paid" })}>
              <DollarSign size={14} /> Mark paid
            </button>
          )}
          {booking.bookingStatus === "pending" && (
            <button type="button" disabled={update.isPending} onClick={() => update.mutate({ id: booking.id, action: "confirm" })}>
              <Check size={14} /> Confirm
            </button>
          )}
          {booking.bookingStatus === "confirmed" && (
            <button type="button" disabled={update.isPending} onClick={() => update.mutate({ id: booking.id, action: "complete" })}>
              <Check size={14} /> Complete
            </button>
          )}
          <button
            type="button"
            className={cancelArmed ? "is-danger" : ""}
            disabled={update.isPending}
            onClick={() => {
              if (!cancelArmed) {
                setCancelArmed(true);
                return;
              }
              update.mutate({ id: booking.id, action: "cancel" });
            }}
          >
            {cancelArmed ? "Tap again to cancel" : "Cancel session"}
          </button>
        </div>
      )}
      {update.isError && <p className="admin-error" role="alert">{update.error.message}</p>}
    </article>
  );
}

/* ---------------- Availability tab ---------------- */

type BlockRow = { id: number; blockDate: string; startTime: string | null; reason: string | null };

function AvailabilityTab() {
  const utils = trpc.useUtils();
  const blocks = trpc.admin.blocks.useQuery();
  const [date, setDate] = useState("");
  const [time, setTime] = useState<string>("");
  const [reason, setReason] = useState("");

  const invalidate = () => {
    utils.admin.blocks.invalidate();
    utils.admin.overview.invalidate();
    utils.booking.blockedDays.invalidate();
    utils.booking.availability.invalidate();
  };
  const addBlock = trpc.admin.addBlock.useMutation({
    onSuccess: () => {
      setDate("");
      setTime("");
      setReason("");
      invalidate();
    },
  });
  const removeBlock = trpc.admin.removeBlock.useMutation({ onSuccess: invalidate });

  const grouped = useMemo(() => {
    const map = new Map<string, BlockRow[]>();
    for (const block of (blocks.data ?? []) as BlockRow[]) {
      const list = map.get(block.blockDate) ?? [];
      list.push(block);
      map.set(block.blockDate, list);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [blocks.data]);

  return (
    <section className="admin-panel">
      <div className="admin-panel-head">
        <h2>Block out time</h2>
        <p>Blocked days and times disappear from the booking calendar automatically.</p>
      </div>

      <form
        className="admin-block-form"
        onSubmit={(event) => {
          event.preventDefault();
          addBlock.mutate({ date, time: time ? (time as (typeof ALL_TIMES)[number]) : null, reason: reason || undefined });
        }}
      >
        <label>
          <span>Day</span>
          <input type="date" required min={localToday()} value={date} onChange={(event) => setDate(event.target.value)} />
        </label>
        <label>
          <span>Time</span>
          <select value={time} onChange={(event) => setTime(event.target.value)}>
            <option value="">All day</option>
            {ALL_TIMES.map((slot) => (
              <option key={slot} value={slot}>{friendlyTime(slot)}</option>
            ))}
          </select>
        </label>
        <label className="admin-block-reason">
          <span>Reason (optional, only you see this)</span>
          <input type="text" maxLength={200} placeholder="Vacation, doctor’s appointment…" value={reason} onChange={(event) => setReason(event.target.value)} />
        </label>
        <button className="button button-dark" type="submit" disabled={!date || addBlock.isPending}>
          <CalendarX2 size={16} /> {addBlock.isPending ? "Blocking…" : time ? "Block this time" : "Block whole day"}
        </button>
        {addBlock.isError && <p className="admin-error" role="alert">{addBlock.error.message}</p>}
      </form>

      {blocks.isLoading && <div className="admin-loading"><LoaderCircle className="spin" size={20} /> Loading blocked time…</div>}
      {blocks.data && grouped.length === 0 && <p className="admin-empty">Nothing blocked — your full calendar is open.</p>}

      <div className="admin-blocks">
        {grouped.map(([blockDate, list]) => (
          <div className="admin-block-day" key={blockDate}>
            <h3>{friendlyDate(blockDate)}</h3>
            <div className="admin-block-items">
              {list.map((block) => (
                <span className={block.startTime ? "admin-block-item" : "admin-block-item is-fullday"} key={block.id}>
                  {block.startTime ? friendlyTime(block.startTime) : "All day"}
                  {block.reason && <em>· {block.reason}</em>}
                  <button
                    type="button"
                    aria-label={`Remove block ${block.startTime ? friendlyTime(block.startTime) : "all day"}`}
                    disabled={removeBlock.isPending}
                    onClick={() => removeBlock.mutate({ id: block.id })}
                  >
                    <Trash2 size={13} />
                  </button>
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ---------------- Clients tab ---------------- */

type ClientRow = {
  name: string;
  email: string;
  phone: string;
  address: string;
  sessions: number;
  upcoming: number;
  completedSessions: number;
  totalCents: number;
  lastSession: string | null;
  nextSession: string | null;
};

function ClientsTab() {
  const clients = trpc.admin.clients.useQuery();
  const [query, setQuery] = useState("");
  const [openEmail, setOpenEmail] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const list = (clients.data ?? []) as ClientRow[];
    const needle = query.trim().toLowerCase();
    if (!needle) return list;
    return list.filter(
      (client) =>
        client.name.toLowerCase().includes(needle) ||
        client.email.toLowerCase().includes(needle) ||
        client.phone.toLowerCase().includes(needle),
    );
  }, [clients.data, query]);

  return (
    <section className="admin-panel">
      <div className="admin-panel-head">
        <h2>Clients</h2>
        <p>Everyone who books is added here automatically, with their contact details ready to use.</p>
      </div>

      <label className="admin-search">
        <Search size={16} />
        <input
          type="search"
          placeholder="Search by name, email, or phone…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>

      {clients.isLoading && <div className="admin-loading"><LoaderCircle className="spin" size={20} /> Loading clients…</div>}
      {clients.data && filtered.length === 0 && (
        <p className="admin-empty">{query ? "No clients match that search." : "No clients yet — they’ll appear here after their first booking."}</p>
      )}

      <div className="admin-cards">
        {filtered.map((client) => (
          <ClientCard
            key={client.email}
            client={client}
            open={openEmail === client.email}
            onToggle={() => setOpenEmail(openEmail === client.email ? null : client.email)}
          />
        ))}
      </div>
    </section>
  );
}

function ClientCard({ client, open, onToggle }: { client: ClientRow; open: boolean; onToggle: () => void }) {
  const history = trpc.admin.clientBookings.useQuery(
    { email: client.email },
    { enabled: open },
  );
  const [message, setMessage] = useState("");

  const defaultMessage = `Hi ${firstName(client.name)}, it’s Lucia! `;
  const body = message || defaultMessage;

  return (
    <article className="admin-card">
      <div className="admin-card-top">
        <div className="admin-card-client">
          <span className="admin-avatar" aria-hidden="true"><UserRound size={18} /></span>
          <div>
            <strong>{client.name}</strong>
            <span>{client.sessions} session{client.sessions === 1 ? "" : "s"}
              {client.completedSessions > 0 && ` · ${client.completedSessions} completed`}
              {client.totalCents > 0 && ` · ${formatPrice(client.totalCents)} paid`}
            </span>
          </div>
        </div>
        {client.nextSession && <span className="pill pill-confirmed">Next: {friendlyDate(client.nextSession, false)}</span>}
      </div>

      <div className="admin-card-body">
        <p className="admin-card-line"><Mail size={14} /> {client.email}</p>
        <p className="admin-card-line"><Phone size={14} /> {client.phone}</p>
        <p className="admin-card-line"><MapPin size={14} /> {client.address}</p>
      </div>

      <div className="admin-contact-compose">
        <textarea
          rows={3}
          placeholder={defaultMessage}
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          aria-label={`Message for ${client.name}`}
        />
        <div className="admin-card-contact">
          <a className="admin-chip" href={mailHref(client.email, "Training with Lucia", body)}><Mail size={14} /> Email</a>
          <a className="admin-chip" href={smsHref(client.phone, body)}><MessageSquareText size={14} /> Text</a>
          <a className="admin-chip" href={`tel:${client.phone.replace(/[^\d+]/g, "")}`}><Phone size={14} /> Call</a>
          <button type="button" className="admin-chip" onClick={onToggle} aria-expanded={open}>
            <ChevronDown size={14} style={{ transform: open ? "rotate(180deg)" : undefined }} /> History
          </button>
        </div>
      </div>

      {open && (
        <div className="admin-history">
          {history.isLoading && <div className="admin-loading"><LoaderCircle className="spin" size={16} /> Loading…</div>}
          {history.data?.length === 0 && <p className="admin-empty">No bookings on record.</p>}
          {(history.data as BookingRow[] | undefined)?.map((row) => (
            <div className="admin-history-row" key={row.id}>
              <span>{friendlyDate(row.sessionDate, false)} · {friendlyTime(row.startTime)}</span>
              <span>{row.serviceName}</span>
              <span className={`pill pill-${row.bookingStatus}`}>{bookingLabel[row.bookingStatus]}</span>
              <span className={`pill pill-pay-${row.paymentStatus}`}>{paymentLabel[row.paymentStatus]}</span>
            </div>
          ))}
        </div>
      )}
    </article>
  );
}
