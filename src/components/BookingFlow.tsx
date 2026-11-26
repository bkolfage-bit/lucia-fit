import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import {
  ArrowLeft,
  ArrowRight,
  CalendarCheck,
  Check,
  Clock3,
  CreditCard,
  Download,
  House,
  LoaderCircle,
  MapPin,
  ShieldCheck,
  Users,
  WalletCards,
  X,
} from "lucide-react";
import { trpc } from "@/providers/trpc";
import { ALL_TIMES, SERVICES, formatPrice, getBookableDates, getSessionPrice } from "@contracts/training";
import type { ServiceId, SessionDuration } from "@contracts/training";

type TimeSlot = (typeof ALL_TIMES)[number];

type Step = "session" | "details" | "confirmed";

function localDateValue(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function friendlyDate(value: string, long = false) {
  return new Intl.DateTimeFormat("en-US", {
    weekday: long ? "long" : "short",
    month: long ? "long" : "short",
    day: "numeric",
  }).format(new Date(`${value}T12:00:00`));
}

function friendlyTime(value: string) {
  const [hour, minute] = value.split(":").map(Number);
  const date = new Date(2026, 0, 1, hour, minute);
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(date);
}

function icsEscape(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/,/g, "\\,").replace(/;/g, "\\;").replace(/\n/g, "\\n");
}

export default function BookingFlow() {
  const dates = useMemo(() => getBookableDates(), []);
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const initialToken = params.get("booking");
  const [step, setStep] = useState<Step>(initialToken ? "confirmed" : "session");
  const [serviceId, setServiceId] = useState<ServiceId>("strength");
  const [sessionDuration, setSessionDuration] = useState<SessionDuration>(60);
  const [participants, setParticipants] = useState<1 | 2>(1);
  const [sessionDate, setSessionDate] = useState(dates[0]);
  const [startTime, setStartTime] = useState<TimeSlot | "">("");
  const [paymentMethod, setPaymentMethod] = useState<"stripe" | "pay_later">("pay_later");
  const [manageToken, setManageToken] = useState(initialToken || "");
  const [cancelArmed, setCancelArmed] = useState(false);
  const [calendarSaved, setCalendarSaved] = useState(false);
  const verifyStarted = useRef(false);
  const utils = trpc.useUtils();

  const service = SERVICES.find((item) => item.id === serviceId) ?? SERVICES[0];
  const sessionPrice = getSessionPrice(service, participants, sessionDuration);
  const availability = trpc.booking.availability.useQuery(
    { date: sessionDate, duration: sessionDuration },
    { enabled: step === "session", staleTime: 15_000 },
  );
  const paymentConfig = trpc.booking.paymentConfig.useQuery(undefined, { staleTime: 60_000 });
  const currentBooking = trpc.booking.byToken.useQuery(
    { token: manageToken },
    { enabled: Boolean(manageToken && step === "confirmed"), retry: 1 },
  );

  const verifyPayment = trpc.booking.verifyPayment.useMutation({
    onSuccess: () => currentBooking.refetch(),
  });
  const cancelBooking = trpc.booking.cancel.useMutation({
    onSuccess: () => {
      setCancelArmed(false);
      currentBooking.refetch();
      utils.booking.availability.invalidate();
    },
  });

  const createBooking = trpc.booking.create.useMutation({
    onSuccess: async (result) => {
      await utils.booking.availability.invalidate({ date: sessionDate });
      if (result.checkoutUrl) {
        window.location.assign(result.checkoutUrl);
        return;
      }
      setManageToken(result.manageToken);
      setStep("confirmed");
      const url = new URL(window.location.href);
      url.searchParams.set("booking", result.manageToken);
      url.searchParams.delete("payment");
      window.history.replaceState({}, "", `${url.pathname}?${url.searchParams.toString()}#book`);
    },
  });

  useEffect(() => {
    if (step === "session" && !manageToken) return;
    const timer = window.setTimeout(() => {
      document.querySelector(".booking-shell")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 60);
    return () => window.clearTimeout(timer);
  }, [step, manageToken]);

  useEffect(() => {
    const selectService = (event: Event) => {
      const detail = (event as CustomEvent<{ serviceId?: ServiceId }>).detail;
      if (detail?.serviceId) {
        const selectedService = SERVICES.find((item) => item.id === detail.serviceId) ?? SERVICES[0];
        setServiceId(detail.serviceId);
        setSessionDuration(selectedService.duration);
        setStep("session");
        setManageToken("");
        setStartTime("");
      }
    };
    window.addEventListener("lucia:select-service", selectService);
    return () => window.removeEventListener("lucia:select-service", selectService);
  }, []);

  useEffect(() => {
    if (paymentConfig.data?.stripeEnabled) setPaymentMethod("stripe");
  }, [paymentConfig.data?.stripeEnabled]);

  useEffect(() => {
    const sessionId = params.get("session_id");
    if (
      params.get("payment") === "success" &&
      manageToken &&
      sessionId &&
      !verifyStarted.current
    ) {
      verifyStarted.current = true;
      verifyPayment.mutate({ token: manageToken, sessionId });
    }
  }, [manageToken, params, verifyPayment]);

  function downloadCalendar() {
    const booking = currentBooking.data;
    if (!booking) return;
    const compactDate = booking.sessionDate.replaceAll("-", "");
    const compactTime = booking.startTime.replace(":", "") + "00";
    const end = new Date(`${booking.sessionDate}T${booking.startTime}:00`);
    end.setMinutes(end.getMinutes() + booking.duration);
    const endDate = localDateValue(end).replaceAll("-", "");
    const endTime = `${String(end.getHours()).padStart(2, "0")}${String(end.getMinutes()).padStart(2, "0")}00`;
    const ics = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Lucia Nuzzi//Personal Training//EN",
      "BEGIN:VEVENT",
      `UID:${booking.manageToken}@lucianuzzi.training`,
      `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "")}`,
      `DTSTART:${compactDate}T${compactTime}`,
      `DTEND:${endDate}T${endTime}`,
      `SUMMARY:${icsEscape(booking.serviceName)} with Lucia Nuzzi`,
      `LOCATION:${icsEscape(booking.address)}`,
      `DESCRIPTION:${icsEscape(`At-home personal training with Lucia Nuzzi for ${booking.participants} ${booking.participants === 1 ? "person" : "people"}. Booking LN-${String(booking.id).padStart(5, "0")}.`)}`,
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `lucia-nuzzi-${booking.sessionDate}.ics`;
    anchor.click();
    URL.revokeObjectURL(url);
    setCalendarSaved(true);
  }

  function startAnother() {
    const url = new URL(window.location.href);
    url.search = "";
    window.history.replaceState({}, "", `${url.pathname}#book`);
    setManageToken("");
    setStartTime("");
    setStep("session");
    setCalendarSaved(false);
    createBooking.reset();
    cancelBooking.reset();
  }

  function submitDetails(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!startTime) {
      setStep("session");
      return;
    }
    const form = new FormData(event.currentTarget);
    createBooking.mutate({
      serviceId,
      sessionDate,
      startTime,
      duration: sessionDuration,
      participants,
      customerName: String(form.get("customerName") || ""),
      email: String(form.get("email") || ""),
      phone: String(form.get("phone") || ""),
      address: String(form.get("address") || ""),
      goals: String(form.get("goals") || ""),
      notes: String(form.get("notes") || ""),
      paymentMethod,
    });
  }

  return (
    <div className="booking-shell">
      <div className="booking-topline">
        <div>
          <span className="booking-kicker">Live booking</span>
          <h3>Make it official.</h3>
        </div>
        <div className="booking-steps" aria-label="Booking progress">
          {["Session", "Details", "Done"].map((label, index) => {
            const activeIndex = step === "session" ? 0 : step === "details" ? 1 : 2;
            return (
              <span key={label} className={index <= activeIndex ? "is-active" : ""}>
                <i>{index < activeIndex ? <Check size={12} /> : index + 1}</i>
                {label}
              </span>
            );
          })}
        </div>
      </div>

      {step === "session" && (
        <div className="booking-stage">
          <fieldset className="booking-block">
            <legend>Choose your session</legend>
            <div className="service-picker">
              {SERVICES.map((item) => (
                <button
                  type="button"
                  key={item.id}
                  className={serviceId === item.id ? "service-option is-selected" : "service-option"}
                  onClick={() => {
                    setServiceId(item.id);
                    setSessionDuration(item.duration);
                    setStartTime("");
                  }}
                  aria-pressed={serviceId === item.id}
                >
                  <span>
                    <strong>{item.name}</strong>
                    <small>{item.durationOptions.length > 1 ? "1 or 2 hours" : `${item.duration} minutes`} · At your home</small>
                  </span>
                  <b>{formatPrice(getSessionPrice(item, participants))}</b>
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset className="booking-block">
            <legend>Who’s training?</legend>
            <div className="participant-picker">
              {([1, 2] as const).map((count) => (
                <button
                  type="button"
                  key={count}
                  className={participants === count ? "participant-option is-selected" : "participant-option"}
                  onClick={() => setParticipants(count)}
                  aria-pressed={participants === count}
                >
                  <Users size={20} />
                  <span><strong>{count === 1 ? "Just me" : "Two of us"}</strong><small>{service.durationOptions.length === 1 ? `${formatPrice(getSessionPrice(service, count, service.duration))} for ${service.duration} minutes` : count === 1 ? "$165 per hour" : "$250 per hour · train together"}</small></span>
                  {participants === count && <Check size={18} />}
                </button>
              ))}
            </div>
          </fieldset>

          {service.durationOptions.length > 1 && (
            <fieldset className="booking-block">
              <legend>Choose your session length</legend>
              <div className="participant-picker duration-picker">
                {service.durationOptions.map((duration) => (
                  <button
                    type="button"
                    key={duration}
                    className={sessionDuration === duration ? "participant-option is-selected" : "participant-option"}
                    onClick={() => {
                      setSessionDuration(duration);
                      setStartTime("");
                    }}
                    aria-pressed={sessionDuration === duration}
                  >
                    <Clock3 size={20} />
                    <span><strong>{duration === 60 ? "1 hour" : "2 hours"}</strong><small>{formatPrice(getSessionPrice(service, participants, duration))} total</small></span>
                    {sessionDuration === duration && <Check size={18} />}
                  </button>
                ))}
              </div>
            </fieldset>
          )}

          <fieldset className="booking-block">
            <legend>Pick a day</legend>
            <div className="date-picker" role="group" aria-label="Available dates">
              {dates.map((date) => {
                const day = new Date(`${date}T12:00:00`);
                return (
                  <button
                    type="button"
                    key={date}
                    className={sessionDate === date ? "date-option is-selected" : "date-option"}
                    onClick={() => {
                      setSessionDate(date);
                      setStartTime("");
                    }}
                    aria-pressed={sessionDate === date}
                    aria-label={friendlyDate(date, true)}
                  >
                    <span>{new Intl.DateTimeFormat("en-US", { weekday: "short" }).format(day)}</span>
                    <strong>{day.getDate()}</strong>
                    <small>{new Intl.DateTimeFormat("en-US", { month: "short" }).format(day)}</small>
                  </button>
                );
              })}
            </div>
          </fieldset>

          <fieldset className="booking-block">
            <legend>Pick a time <span>· Local time</span></legend>
            {availability.isLoading ? (
              <div className="availability-loading"><LoaderCircle className="spin" size={20} /> Checking Lucia’s calendar…</div>
            ) : availability.isError ? (
              <div className="booking-error" role="alert">Availability could not load. <button type="button" onClick={() => availability.refetch()}>Try again</button></div>
            ) : (
              <div className="time-picker">
                {availability.data?.map((slot) => (
                  <button
                    type="button"
                    key={slot.time}
                    disabled={!slot.available}
                    className={startTime === slot.time ? "time-option is-selected" : "time-option"}
                    onClick={() => setStartTime(slot.time)}
                    aria-pressed={startTime === slot.time}
                  >
                    {friendlyTime(slot.time)}
                    {!slot.available && <small>Booked</small>}
                  </button>
                ))}
              </div>
            )}
          </fieldset>

          <div className="booking-actionbar">
            <div className="booking-mini-summary">
              <CalendarCheck size={20} />
              <span><strong>{service.shortName} · {sessionDuration} min · {participants === 1 ? "1 person" : "2 people"}</strong>{friendlyDate(sessionDate)}{startTime ? ` · ${friendlyTime(startTime)}` : ""} · {formatPrice(sessionPrice)}</span>
            </div>
            <button className="button button-dark" type="button" disabled={!startTime} onClick={() => setStep("details")}>
              Continue <ArrowRight size={18} />
            </button>
          </div>
        </div>
      )}

      {step === "details" && (
        <form className="booking-stage details-stage" onSubmit={submitDetails}>
          <button type="button" className="back-button" onClick={() => setStep("session")}>
            <ArrowLeft size={17} /> Back to session
          </button>
          <div className="details-grid">
            <div className="details-fields">
              <div className="field-row">
                <label className="field-label">Full name
                  <input name="customerName" autoComplete="name" required minLength={2} placeholder="Your name" />
                </label>
                <label className="field-label">Email
                  <input name="email" type="email" autoComplete="email" required placeholder="you@example.com" />
                </label>
              </div>
              <div className="field-row">
                <label className="field-label">Phone
                  <input name="phone" type="tel" autoComplete="tel" required minLength={7} placeholder="Best number to reach you" />
                </label>
                <label className="field-label">Training address
                  <input name="address" autoComplete="street-address" required minLength={5} placeholder="Where should Lucia meet you?" />
                </label>
              </div>
              <label className="field-label">What would you like to work on?
                <textarea name="goals" rows={3} placeholder="Strength, energy, mobility, consistency…" />
              </label>
              <label className="field-label">Anything Lucia should know? <span>Optional</span>
                <textarea name="notes" rows={2} placeholder="Injuries, equipment, access notes, or preferences" />
              </label>
            </div>

            <aside className="checkout-summary">
              <span className="summary-label">Your session</span>
              <h4>{service.name}</h4>
              <ul>
                <li><CalendarCheck size={17} /> {friendlyDate(sessionDate, true)}</li>
                <li><Clock3 size={17} /> {friendlyTime(startTime)} · {sessionDuration} min</li>
                <li><House size={17} /> At your home</li>
                <li><Users size={17} /> {participants === 1 ? "1 person" : "2 people training together"}</li>
              </ul>
              <div className="summary-price"><span>Total</span><strong>{formatPrice(sessionPrice)}</strong></div>
              <fieldset className="payment-options">
                <legend>Payment</legend>
                <label className={paymentMethod === "stripe" ? "payment-option is-selected" : "payment-option"}>
                  <input
                    type="radio"
                    name="payment"
                    value="stripe"
                    checked={paymentMethod === "stripe"}
                    onChange={() => setPaymentMethod("stripe")}
                    disabled={!paymentConfig.data?.stripeEnabled}
                  />
                  <CreditCard size={20} />
                  <span><strong>Pay securely online</strong><small>{paymentConfig.data?.stripeEnabled ? "Card · Apple Pay · Google Pay" : "Activates when Stripe is connected"}</small></span>
                </label>
                <label className={paymentMethod === "pay_later" ? "payment-option is-selected" : "payment-option"}>
                  <input type="radio" name="payment" value="pay_later" checked={paymentMethod === "pay_later"} onChange={() => setPaymentMethod("pay_later")} />
                  <WalletCards size={20} />
                  <span><strong>Pay at the session</strong><small>Reserve now, settle with Lucia directly</small></span>
                </label>
              </fieldset>
              <button className="button button-yellow checkout-button" type="submit" disabled={createBooking.isPending}>
                {createBooking.isPending ? <><LoaderCircle className="spin" size={18} /> Reserving…</> : paymentMethod === "stripe" ? <>Continue to secure payment <ArrowRight size={18} /></> : <>Confirm my session <ArrowRight size={18} /></>}
              </button>
              <p className="secure-note"><ShieldCheck size={15} /> Your details are used only to manage this booking.</p>
              {createBooking.isError && <p className="form-error" role="alert">{createBooking.error.message}</p>}
            </aside>
          </div>
        </form>
      )}

      {step === "confirmed" && (
        <div className="booking-stage confirmation-stage">
          {currentBooking.isLoading || verifyPayment.isPending ? (
            <div className="confirmation-loading"><LoaderCircle className="spin" size={30} /><h3>Confirming your session…</h3></div>
          ) : currentBooking.isError ? (
            <div className="confirmation-loading"><h3>We couldn’t retrieve that booking.</h3><button className="button button-dark" onClick={startAnother}>Start a new booking</button></div>
          ) : currentBooking.data ? (
            currentBooking.data.bookingStatus === "cancelled" ? (
              <div className="cancelled-state">
                <X size={34} />
                <span className="booking-kicker">Booking LN-{String(currentBooking.data.id).padStart(5, "0")}</span>
                <h3>This session was cancelled.</h3>
                <p>The time is available again. Ready to choose another?</p>
                <button className="button button-dark" type="button" onClick={startAnother}>Find another time <ArrowRight size={18} /></button>
              </div>
            ) : (
              <div className="confirmation-grid">
                <div className="confirmation-message">
                  <div className="confirmation-mark"><Check size={38} strokeWidth={2.5} /></div>
                  <span className="booking-kicker">Booking LN-{String(currentBooking.data.id).padStart(5, "0")}</span>
                  <h3>{currentBooking.data.bookingStatus === "confirmed" ? "You’re booked. Let’s move." : "Your time is reserved."}</h3>
                  <p>{currentBooking.data.customerName.split(" ")[0]}, your session details are below. {currentBooking.data.paymentStatus === "paid" ? "Payment is complete." : currentBooking.data.paymentMethod === "pay_later" ? "You can pay Lucia at the session." : "Complete payment to finalize your booking."}</p>
                  {params.get("payment") === "cancelled" && <p className="payment-notice">Card checkout was closed before payment. Your reservation is still visible here; you can cancel it and choose another option.</p>}
                  <div className="confirmation-actions">
                    <button className="button button-dark" type="button" onClick={downloadCalendar}><Download size={18} /> {calendarSaved ? "Calendar file saved" : "Add to calendar"}</button>
                    <button className="text-button" type="button" onClick={startAnother}>Book another session</button>
                  </div>
                </div>
                <div className="ticket">
                  <div className="ticket-top"><span>LUCIA NUZZI</span><span>AT-HOME / PERSONAL</span></div>
                  <h4>{currentBooking.data.serviceName}</h4>
                  <div className="ticket-date"><strong>{new Date(`${currentBooking.data.sessionDate}T12:00:00`).getDate()}</strong><span>{friendlyDate(currentBooking.data.sessionDate)}<br />{friendlyTime(currentBooking.data.startTime)}</span></div>
                  <div className="ticket-line"><MapPin size={18} /><span>{currentBooking.data.address}</span></div>
                  <div className="ticket-line"><Clock3 size={18} /><span>{currentBooking.data.duration} minutes</span></div>
                  <div className="ticket-line"><Users size={18} /><span>{currentBooking.data.participants === 1 ? "1 person" : "2 people training together"}</span></div>
                  <div className="ticket-total"><span>{currentBooking.data.paymentStatus === "paid" ? "Paid online" : "Due at session"}</span><strong>{formatPrice(currentBooking.data.amountCents)}</strong></div>
                  {currentBooking.data.paymentStatus === "processing" ? <p className="processing-note">Payment review in progress. Contact Lucia to change this session.</p> : !cancelArmed ? (
                    <button className="cancel-link" type="button" onClick={() => setCancelArmed(true)}>Need to cancel?</button>
                  ) : (
                    <div className="cancel-confirm">
                      <p>Cancel this reservation?</p>
                      <button type="button" onClick={() => cancelBooking.mutate({ token: manageToken })} disabled={cancelBooking.isPending}>Yes, cancel</button>
                      <button type="button" onClick={() => setCancelArmed(false)}>Keep it</button>
                    </div>
                  )}
                  {cancelBooking.isError && <p className="form-error">{cancelBooking.error.message}</p>}
                </div>
              </div>
            )
          ) : null}
        </div>
      )}
    </div>
  );
}
