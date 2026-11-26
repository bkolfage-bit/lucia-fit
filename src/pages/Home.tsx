import { useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronDown,
  Clock3,
  Dumbbell,
  House,
  Instagram,
  Mail,
  Menu,
  Move,
  Sparkles,
  X,
  Zap,
} from "lucide-react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Lenis from "lenis";
import BookingFlow from "@/components/BookingFlow";
import { SERVICES, formatPrice } from "@contracts/training";
import type { ServiceId } from "@contracts/training";
import "../App.css";

gsap.registerPlugin(ScrollTrigger);

const goals = [
  { id: "strength", label: "Get stronger", service: "strength" as ServiceId },
  { id: "energy", label: "Feel more energized", service: "reset" as ServiceId },
  { id: "mobility", label: "Move without stiffness", service: "mobility" as ServiceId },
];

const experienceLevels = ["I’m just starting", "I train sometimes", "I train regularly"];

const faqs = [
  {
    question: "Where does Lucia train clients?",
    answer: "Lucia is based in Palm Beach, Florida, and provides at-home personal training in Palm Beach. Add your training address when booking so Lucia can confirm the session location with you.",
  },
  {
    question: "Do I need a home gym?",
    answer: "Not at all. Your session is designed around your space and whatever equipment you already have. Lucia can build an effective session with bodyweight and a few versatile training tools. Add your available equipment to the booking notes.",
  },
  {
    question: "What happens after I book?",
    answer: "You’ll receive an on-screen confirmation with your booking reference and a calendar file. Your selected time is reserved immediately. If you chose pay at session, you can settle with Lucia directly; online card payments are completed through secure checkout.",
  },
  {
    question: "Can I train if I’m a beginner?",
    answer: "Absolutely. The session starts at your current level, not an imaginary fitness baseline. Use the session finder for a starting recommendation, then share your goals and any injuries or concerns in your booking form.",
  },
  {
    question: "How much space do we need?",
    answer: "Enough room for a mat and comfortable movement is a useful starting point. A living room, garage, backyard, or building gym can all work. Your exact training address is collected securely during booking.",
  },
];

function CircularBookLink() {
  return (
    <a className="circular-book" href="#book" aria-label="Book your training session">
      <svg viewBox="0 0 120 120" aria-hidden="true">
        <defs><path id="bookCircle" d="M60,60 m-44,0 a44,44 0 1,1 88,0 a44,44 0 1,1 -88,0" /></defs>
        <text><textPath href="#bookCircle">BOOK YOUR SESSION • AT-HOME TRAINING • </textPath></text>
      </svg>
      <span><ArrowDown size={28} /></span>
    </a>
  );
}

function SessionFinder() {
  const [goal, setGoal] = useState("strength");
  const [experience, setExperience] = useState(experienceLevels[0]);
  const recommendation = goals.find((item) => item.id === goal) ?? goals[0];
  const service = SERVICES.find((item) => item.id === recommendation.service) ?? SERVICES[0];
  const plan = goal === "strength"
    ? ["Full-body foundational strength", "Simple progression between sessions", "Form coaching in your own space"]
    : goal === "energy"
      ? ["Low-impact conditioning intervals", "Strength circuits paced to you", "A mobility finish that resets"]
      : ["Controlled range-of-motion work", "Stability for everyday movement", "Breathing and recovery techniques"];

  function bookRecommendation() {
    window.dispatchEvent(new CustomEvent("lucia:select-service", { detail: { serviceId: service.id } }));
    document.getElementById("book")?.scrollIntoView({ behavior: "smooth" });
  }

  return (
    <div className="finder-grid">
      <div className="finder-controls">
        <fieldset>
          <legend>What matters most right now?</legend>
          <div className="finder-options">
            {goals.map((item) => (
              <button key={item.id} type="button" className={goal === item.id ? "is-selected" : ""} onClick={() => setGoal(item.id)} aria-pressed={goal === item.id}>
                {item.label}<span>{goal === item.id ? <Check size={18} /> : <ArrowRight size={18} />}</span>
              </button>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend>Where are you starting?</legend>
          <div className="experience-options">
            {experienceLevels.map((level) => (
              <button key={level} type="button" className={experience === level ? "is-selected" : ""} onClick={() => setExperience(level)} aria-pressed={experience === level}>{level}</button>
            ))}
          </div>
        </fieldset>
      </div>
      <div className="finder-result" aria-live="polite">
        <span className="finder-result-label"><Sparkles size={16} /> Your best starting point</span>
        <h3>{service.name}</h3>
        <p>{service.description}</p>
        <ul>{plan.map((item) => <li key={item}><Check size={17} />{item}</li>)}</ul>
        <div className="finder-result-bottom">
          <span><Clock3 size={17} /> {service.durationOptions.length > 1 ? "1–2 hours" : `${service.duration} min`} <b>{formatPrice(service.priceCents)}</b></span>
          <button className="button button-yellow" type="button" onClick={bookRecommendation}>Book this session <ArrowRight size={18} /></button>
        </div>
      </div>
    </div>
  );
}

export default function Home() {
  const root = useRef<HTMLDivElement>(null);
  const hero = useRef<HTMLElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [bookingInView, setBookingInView] = useState(false);

  useEffect(() => {
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion || !root.current) return;
    const lenis = new Lenis({ smoothWheel: true });
    lenis.on("scroll", ScrollTrigger.update);
    const tick = (time: number) => lenis.raf(time * 1000);
    gsap.ticker.add(tick);
    gsap.ticker.lagSmoothing(0);

    const context = gsap.context(() => {
      gsap.from(".hero-word", { yPercent: 110, duration: 1, stagger: 0.12, ease: "power3.out" });
      gsap.from(".hero-intro", { opacity: 0, y: 24, duration: 0.8, delay: 0.45, ease: "power2.out" });
      gsap.utils.toArray<HTMLElement>(".parallax-image").forEach((image) => {
        gsap.fromTo(image, { yPercent: -7 }, {
          yPercent: 7,
          ease: "none",
          scrollTrigger: { trigger: image.parentElement, start: "top bottom", end: "bottom top", scrub: 0.6 },
        });
      });
      gsap.utils.toArray<HTMLElement>(".image-color").forEach((image) => {
        gsap.fromTo(image, { opacity: 0 }, {
          opacity: 1,
          ease: "none",
          scrollTrigger: { trigger: image.parentElement, start: "top 85%", end: "center 45%", scrub: 0.5 },
        });
      });
      gsap.to(".hero-image-wrap", {
        yPercent: 16,
        ease: "none",
        scrollTrigger: { trigger: hero.current, start: "top top", end: "bottom top", scrub: 0.7 },
      });
    }, root);

    return () => {
      context.revert();
      gsap.ticker.remove(tick);
      lenis.destroy();
    };
  }, []);

  useEffect(() => {
    document.body.style.overflow = menuOpen ? "hidden" : "";
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("keydown", close);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", close);
    };
  }, [menuOpen]);

  useEffect(() => {
    const booking = document.getElementById("book");
    if (!booking) return;
    const observer = new IntersectionObserver(
      ([entry]) => setBookingInView(entry.isIntersecting),
      { rootMargin: "-5% 0px -5% 0px" },
    );
    observer.observe(booking);
    return () => observer.disconnect();
  }, []);

  function moveHeroImage(event: React.PointerEvent<HTMLElement>) {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || event.pointerType === "touch") return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - bounds.left) / bounds.width - 0.5;
    const y = (event.clientY - bounds.top) / bounds.height - 0.5;
    gsap.to(".hero-image-inner", { x: x * 22, y: y * 16, duration: 0.8, ease: "power2.out" });
    gsap.to(".hero-burst", { x: x * -18, y: y * -12, duration: 1, ease: "power2.out" });
  }

  function selectService(serviceId: ServiceId) {
    window.dispatchEvent(new CustomEvent("lucia:select-service", { detail: { serviceId } }));
    document.getElementById("book")?.scrollIntoView({ behavior: "smooth" });
  }

  return (
    <div ref={root} className="site-shell" id="top">
      <header className="site-header">
        <a className="brand" href="#top" aria-label="Lucia Nuzzi home">
          <span className="brand-mark">LN</span>
          <span>Lucia Nuzzi<small>Personal training</small></span>
        </a>
        <nav className="desktop-nav" aria-label="Main navigation">
          <a href="#coaching">Coaching</a>
          <a href="#method">The method</a>
          <a href="#about">Meet Lucia</a>
          <a href="#finder">Session finder</a>
        </nav>
        <div className="header-actions">
          <a className="header-contact" href="mailto:Lucia@fitbylucia.com?subject=Personal%20training%20inquiry" aria-label="Email Lucia at Lucia@fitbylucia.com"><Mail size={16} /> Contact Lucia</a>
          <a className="header-book" href="#book">Book a session <ArrowUpRight size={17} /></a>
        </div>
        <button className="menu-button" type="button" onClick={() => setMenuOpen(true)} aria-label="Open menu" aria-expanded={menuOpen}><Menu /></button>
      </header>

      <div className={menuOpen ? "mobile-menu is-open" : "mobile-menu"} aria-hidden={!menuOpen}>
        <div className="mobile-menu-top"><span>LN / MENU</span><button type="button" onClick={() => setMenuOpen(false)} aria-label="Close menu"><X /></button></div>
        <nav aria-label="Mobile navigation">
          {[["Coaching", "#coaching"], ["The method", "#method"], ["Meet Lucia", "#about"], ["Session finder", "#finder"], ["Book a session", "#book"]].map(([label, href], index) => (
            <a key={href} href={href} onClick={() => setMenuOpen(false)} tabIndex={menuOpen ? 0 : -1}><span>0{index + 1}</span>{label}<ArrowUpRight /></a>
          ))}
        </nav>
        <a className="mobile-contact button button-yellow" href="mailto:Lucia@fitbylucia.com?subject=Personal%20training%20inquiry" onClick={() => setMenuOpen(false)} tabIndex={menuOpen ? 0 : -1}><Mail size={18} /> Contact Lucia</a>
        <a className="mobile-instagram" href="https://www.instagram.com/lucialuciafit/" target="_blank" rel="noreferrer" tabIndex={menuOpen ? 0 : -1}><Instagram size={18} /> @lucialuciafit</a>
      </div>

      <main>
        <section ref={hero} className="hero" onPointerMove={moveHeroImage} aria-labelledby="hero-title">
          <div className="hero-burst" aria-hidden="true" />
          <div className="hero-image-wrap" aria-hidden="true">
            <div className="hero-image-inner"><img src="/images/lucia-nuzzi.webp" alt="" fetchPriority="high" /></div>
          </div>
          <div className="hero-intro">
            <span className="availability-pill"><i /> Palm Beach · At-home sessions</span>
            <p>Palm Beach personal training that comes to you.<br />Built around your body. Made for your life.</p>
            <a className="button button-dark" href="#book">Book your first session <ArrowRight size={18} /></a>
          </div>
          <CircularBookLink />
          <h1 id="hero-title" className="hero-title">
            <span className="hero-line"><span className="hero-word">LUCIA</span></span>
            <span className="hero-line hero-line-right"><span className="hero-word">NUZZI</span></span>
          </h1>
          <div className="hero-side-note">PERSONAL / YOUR SPACE / REAL PROGRESS</div>
        </section>

        <div className="motion-strip" aria-hidden="true">
          <div>STRENGTH <Zap /> MOBILITY <Move /> CONFIDENCE <Dumbbell /> ENERGY <Zap /> STRENGTH <Zap /> MOBILITY <Move /> CONFIDENCE <Dumbbell /> ENERGY <Zap /></div>
        </div>

        <section className="manifesto section-dark">
          <div className="section-index">01 / THE DIFFERENCE</div>
          <div className="manifesto-copy">
            <h2>Your space.<br />Your pace.<br /><span>Real progress.</span></h2>
            <div className="manifesto-detail">
              <p>No commute. No crowded gym. No generic printout. Just focused, personal coaching that turns the place you live into the place you get stronger—solo or with a training partner.</p>
              <a href="#method" className="text-link">See how it works <ArrowDown size={18} /></a>
            </div>
          </div>
          <div className="manifesto-metrics">
            <div><strong>1–2</strong><span>Train solo or together</span></div>
            <div><strong>0</strong><span>Commute or gym intimidation</span></div>
            <div><strong>100%</strong><span>Built around you</span></div>
          </div>
        </section>

        <section className="coaching section-light" id="coaching">
          <div className="section-heading">
            <div className="section-index">02 / COACHING</div>
            <h2>Not a workout.<br /><span>A way forward.</span></h2>
            <p>Every session has a purpose. Every movement meets you where you are. Choose your focus and Lucia will shape the rest.</p>
          </div>
          <div className="program-composition">
            <figure className="floating-photo photo-one">
              <div className="photo-window"><img className="parallax-image" src="/images/lucia-assisted-knee-stretch.webp" alt="Lucia guiding a client through an assisted knee stretch" loading="lazy" /><img className="parallax-image image-color" src="/images/lucia-assisted-knee-stretch.webp" alt="" loading="lazy" /></div>
              <figcaption>Personal guidance. Purposeful movement.</figcaption>
            </figure>
            <div className="program-list">
              {SERVICES.map((service, index) => (
                <article className="program-row" key={service.id}>
                  <span className="program-number">0{index + 1}</span>
                  <div><h3>{service.name}</h3><p>{service.description}</p><span className="program-meta">{service.durationOptions.length > 1 ? "1 OR 2 HOURS" : `${service.duration} MIN`} / 1 OR 2 PEOPLE / FROM {formatPrice(service.priceCents)}</span></div>
                  <button type="button" onClick={() => selectService(service.id)} aria-label={`Book ${service.name}`}><ArrowUpRight /></button>
                </article>
              ))}
            </div>
            <figure className="floating-photo photo-two">
              <div className="photo-window"><img className="parallax-image" src="/images/lucia-assisted-shoulder-stretch.webp" alt="Lucia guiding a client through an assisted shoulder stretch" loading="lazy" /><img className="parallax-image image-color" src="/images/lucia-assisted-shoulder-stretch.webp" alt="" loading="lazy" /></div>
              <figcaption>Mobility, with hands-on coaching.</figcaption>
            </figure>
          </div>
        </section>

        <section className="finder section-blue" id="finder">
          <div className="section-heading finder-heading">
            <div className="section-index">03 / SESSION FINDER</div>
            <h2>Start with<br />what you need.</h2>
            <p>Two quick choices. One useful starting point. No fitness jargon required.</p>
          </div>
          <SessionFinder />
        </section>

        <section className="method section-light" id="method">
          <div className="method-sticky">
            <div className="section-index">04 / THE METHOD</div>
            <h2>Less guessing.<br />More <span>moving.</span></h2>
            <p>Lucia brings the plan, the coaching, and the energy. You bring yourself.</p>
            <a className="button button-dark" href="#book">Find your time <ArrowRight size={18} /></a>
          </div>
          <div className="method-steps">
            {[
              ["Show up as you are", "Your session starts with a quick check-in: how you feel, what you need, and what will make the next hour count."],
              ["Train with intention", "Clear demonstrations, thoughtful progressions, and real-time form guidance keep every rep purposeful."],
              ["Leave with momentum", "Finish with a simple next step, not a complicated homework packet. Consistency should feel doable."],
            ].map(([title, copy], index) => (
              <article key={title} className="method-step">
                <span>0{index + 1}</span><div><h3>{title}</h3><p>{copy}</p></div>
              </article>
            ))}
            <figure className="method-photo">
              <div className="photo-window"><img className="parallax-image" src="/images/lucia-dumbbell-training.webp" alt="Lucia performing a focused dumbbell training exercise" loading="lazy" /><img className="parallax-image image-color" src="/images/lucia-dumbbell-training.webp" alt="" loading="lazy" /></div>
              <figcaption>Coaching you can feel. Strength you can own.</figcaption>
            </figure>
          </div>
        </section>

        <section className="lucia-note section-yellow" id="about" aria-labelledby="about-title">
          <div className="lucia-monogram" aria-hidden="true">LN</div>
          <div className="about-header">
            <div className="section-index">05 / YOUR COACH</div>
            <h2 id="about-title">Meet <span>Lucia.</span></h2>
            <p className="about-credential">NASM-Certified Personal Trainer <span>|</span> Strength, Posture &amp; Mobility Specialist</p>
          </div>
          <div className="about-layout">
            <figure className="about-portrait">
              <div className="about-portrait-window"><img src="/images/lucia-nuzzi.webp" alt="Lucia Nuzzi, NASM-certified personal trainer" loading="lazy" /></div>
              <figcaption><span>Lucia Nuzzi</span><span>Strength / Posture / Mobility</span></figcaption>
            </figure>
            <div className="about-content">
              <p>Based in Palm Beach, Florida, Lucia is a NASM-Certified Personal Trainer with a lifelong passion for movement, athletic performance, and helping others unlock their physical potential.</p>
              <p>Growing up as an avid equestrian, Lucia developed a deep appreciation for balance, coordination, body awareness, and the relationship between movement and control. Her passion for athletics extends beyond horseback riding to motorcycle track riding, tennis, and golf, giving her a diverse perspective on physical performance.</p>
              <p>Lucia believes fitness is about more than aesthetics—it’s about building a strong, capable, and resilient body that allows you to live and perform at your best.</p>
              <p>Specializing in posture and mobility training, she helps clients improve alignment, flexibility, stability, strength, and overall movement quality. Her personalized approach combines functional movement, strength training, and mobility techniques tailored to each client’s individual needs, abilities, and goals.</p>
              <p>Whether you’re looking to enhance athletic performance, improve your posture, build strength, or simply move and feel better in everyday life, Lucia is dedicated to helping you achieve meaningful, sustainable results.</p>
              <blockquote>Move better.<br />Feel stronger.<br />Live with confidence.</blockquote>
              <a className="text-link" href="https://www.instagram.com/lucialuciafit/" target="_blank" rel="noreferrer"><Instagram size={18} /> Meet Lucia on Instagram <ArrowUpRight size={18} /></a>
            </div>
          </div>
        </section>

        <section className="booking section-light" id="book">
          <div className="booking-heading">
            <div className="section-index">06 / BOOK LUCIA</div>
            <h2>Your next session<br />starts <span>here.</span></h2>
            <p>Solo training is $165/hour. Train together for $250/hour. Mobility & stretching is $165 for 60 minutes.</p>
          </div>
          <BookingFlow />
        </section>

        <section className="faq section-light">
          <div className="faq-title"><div className="section-index">07 / GOOD TO KNOW</div><h2>Before we<br />get moving.</h2><House size={54} strokeWidth={1.3} /></div>
          <div className="faq-list">
            {faqs.map((faq, index) => (
              <details key={faq.question} open={index === 0}>
                <summary><span>{faq.question}</span><ChevronDown /></summary>
                <p>{faq.answer}</p>
              </details>
            ))}
          </div>
        </section>
      </main>

      <footer className="site-footer">
        <div className="footer-top"><span>PALM BEACH, FLORIDA</span><span>AT-HOME PERSONAL TRAINING</span></div>
        <a href="#book" className="footer-cta"><span>LET’S MOVE.</span><i><ArrowUpRight /></i></a>
        <div className="footer-bottom">
          <a className="brand footer-brand" href="#top"><span className="brand-mark">LN</span><span>Lucia Nuzzi<small>Personal training</small></span></a>
          <div><a href="#coaching">Coaching</a><a href="#method">Method</a><a href="#book">Book</a></div>
          <a href="https://www.instagram.com/lucialuciafit/" target="_blank" rel="noreferrer"><Instagram size={18} /> @lucialuciafit</a>
          <span>© {new Date().getFullYear()} Lucia Nuzzi</span>
        </div>
      </footer>

      <a className={bookingInView ? "mobile-sticky-book is-hidden" : "mobile-sticky-book"} href="#book" tabIndex={bookingInView ? -1 : 0} aria-hidden={bookingInView}>Book Lucia <ArrowRight size={18} /></a>
    </div>
  );
}
