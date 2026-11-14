import Link from "next/link";
import { ArrowDown, ArrowRight, Check, Infinity as InfinityIcon, Package, ShieldCheck, Truck, Wallet } from "lucide-react";
import styles from "./landing.module.css";

const contact = "mailto:themobiusenterprises@gmail.com?subject=Mobius%20membership%20inquiry";

export default function Landing() {
  return (
    <div className={styles.page}>
      <a className={styles.skip} href="#main">Skip to content</a>
      <header className={styles.header}>
        <Link className={styles.logo} href="/" aria-label="Mobius home"><InfinityIcon size={36} strokeWidth={2.2} /> mobius<span>BUYING GROUP</span></Link>
        <nav aria-label="Main navigation"><a className={styles.navLink} href="#how-it-works">How it works</a><a className={styles.navLink} href="#membership">Membership</a><Link className={styles.login} href="/workspace">Member sign in <ArrowRight size={16} /></Link></nav>
      </header>

      <main id="main">
        <section className={styles.hero} aria-labelledby="hero-title">
          <div className={styles.heroCopy}>
            <p className={styles.eyebrow}><span /> INDIVIDUAL BUYERS. SHARED OPPORTUNITY.</p>
            <h1 id="hero-title">A smarter way<br />to buy.<br /><em>Together.</em></h1>
            <p className={styles.intro}>Find a deal. Reserve your units. Keep every delivery and payout in view. Mobius brings your buying group together, from the first purchase to the final payment.</p>
            <div className={styles.actions}><Link className={styles.primary} href="/workspace">Enter your workspace <ArrowRight size={18} /></Link><a className={styles.secondary} href="#how-it-works">See how it works <ArrowDown size={16} /></a></div>
            <p className={styles.memberNote}><ShieldCheck size={16} /> A private workspace for approved members.</p>
          </div>
          <div className={styles.art} role="img" aria-label="Illustration of a connected buying journey: reserve, deliver, and track payouts">
            <div className={styles.artHeading}><span>THE MOBIUS WAY</span><span>01 — 03</span></div>
            <svg className={styles.orbit} viewBox="0 0 520 500" aria-hidden="true"><path d="M70 295C-20 155 150 80 255 240S520 355 463 195 295 100 255 240 130 420 70 295Z" fill="none" stroke="#b6c8ad" strokeWidth="1.5" strokeDasharray="5 7" /><path d="M80 310C20 205 138 128 250 250S470 343 450 216" fill="none" stroke="#244b3d" strokeWidth="46" strokeLinecap="round" /><path d="M80 310C20 205 138 128 250 250S470 343 450 216" fill="none" stroke="#456653" strokeWidth="2" /><circle cx="86" cy="310" r="7" fill="#ed975c" /><circle cx="451" cy="216" r="7" fill="#ed975c" /></svg>
            <div className={styles.box}><Package size={64} strokeWidth={1} /><span>GOOD THINGS<br />COME TOGETHER.</span></div>
            <div className={`${styles.artCard} ${styles.reserveCard}`}><span className={styles.miniIcon}><Package size={19} /></span><div><small>01 / FIND YOUR NEXT DEAL</small><strong>Reserve your units</strong></div><Check size={17} /></div>
            <div className={`${styles.artCard} ${styles.deliveryCard}`}><span className={styles.miniIcon}><Truck size={19} /></span><div><small>02 / KEEP IT MOVING</small><strong>Track your delivery</strong></div></div>
            <div className={`${styles.artCard} ${styles.payoutCard}`}><span className={styles.miniIcon}><Wallet size={19} /></span><div><small>03 / CLOSE THE LOOP</small><strong>Follow your payout</strong></div><span className={styles.statusDot} /></div>
            <div className={styles.artFooter}><InfinityIcon size={23} /><span>One group. Every step connected.</span></div>
          </div>
        </section>

        <div className={styles.ribbon}><span>Clear deal terms</span><span>Live group capacity</span><span>Private member records</span><span>Delivery & payout tracking</span></div>

        <section className={styles.how} id="how-it-works" aria-labelledby="how-title">
          <div className={styles.sectionHeading}><div><p className={styles.eyebrow}>LESS GUESSWORK. MORE CLARITY.</p><h2 id="how-title">From opportunity<br />to full circle.</h2></div><p>A straightforward process.<br />One place to keep it all organized.</p></div>
          <div className={styles.steps}>
            <article><span className={styles.stepNumber}>01</span><Package size={29} strokeWidth={1.4} /><h3>Find your deal.</h3><p>Browse available opportunities, review the purchase and payout terms, and reserve the quantity that works for you.</p></article>
            <article><span className={styles.stepNumber}>02</span><Truck size={29} strokeWidth={1.4} /><h3>Make your move.</h3><p>Purchase your reserved units with your own funds. Follow the deal’s instructions and add your delivery details.</p></article>
            <article><span className={styles.stepNumber}>03</span><Wallet size={29} strokeWidth={1.4} /><h3>Stay in the loop.</h3><p>See received quantities and recorded payments in your workspace, based on the payout terms saved with your reservation.</p></article>
          </div>
        </section>

        <section className={styles.membership} id="membership" aria-labelledby="membership-title"><div><p className={styles.eyebrow}>A GROUP BUILT ON CONNECTION.</p><h2 id="membership-title">Your next opportunity<br />starts with a conversation.</h2><p>Mobius is a private buying group. Create your account and confirm your email to request membership. Once an administrator approves you, your workspace is ready.</p><div className={styles.actions}><Link className={styles.lightButton} href="/join">Join Mobius <ArrowRight size={18} /></Link><Link className={styles.darkLink} href="/workspace">Member sign in <ArrowRight size={17} /></Link></div></div><InfinityIcon className={styles.largeInfinity} strokeWidth={0.7} aria-hidden="true" /></section>

        <section className={styles.faq} aria-labelledby="faq-title"><h2 id="faq-title">A few things to know.</h2><div><details><summary>How do I join Mobius?</summary><p><Link href="/join">Create an account</Link> with your email and password, then confirm your email. An administrator must approve your membership before you can access deals. Need help? Contact <a href={contact}>themobiusenterprises@gmail.com</a>.</p></details><details><summary>How do purchases and payouts work?</summary><p>Members purchase reserved units with their own funds and follow each deal’s delivery instructions. Each reservation saves the advertised base payout and any stated commission. Administrators record received units and payments; the workspace tracks these records, while payments happen separately.</p></details><details><summary>Can other members see my records?</summary><p>Members can view shared deal availability, but only their own reservations and payout details. Administrators can access the group’s records to manage deliveries, payments, and membership.</p></details></div></section>
      </main>
      <footer className={styles.footer}><Link className={styles.footerLogo} href="/"><InfinityIcon size={28} /> mobius</Link><span>The Mobius Enterprises · Buying together, connected.</span><a href={contact}>Get in touch <ArrowRight size={15} /></a></footer>
    </div>
  );
}
