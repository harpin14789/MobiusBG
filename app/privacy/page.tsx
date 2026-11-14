import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Infinity as InfinityIcon } from "lucide-react";
import styles from "./privacy.module.css";

export const metadata: Metadata = {
  title: "Privacy Policy · Mobius",
  description: "How Mobius collects, uses, stores, and shares information for buying group accounts, deliveries, and payout records.",
};

export default function PrivacyPage() {
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <Link className={styles.brand} href="/" aria-label="Mobius home"><InfinityIcon size={32} /> mobius</Link>
        <Link className={styles.back} href="/"><ArrowLeft size={15} /> Back to home</Link>
      </header>
      <main className={styles.content}>
        <p className={styles.eyebrow}>YOUR INFORMATION. HANDLED WITH CARE.</p>
        <h1>Privacy policy</h1>
        <p className={styles.date}>Effective and last updated: November 14, 2026</p>
        <p className={styles.intro}>Mobius is a buying group workspace operated by The Mobius Enterprises. This policy explains how information is handled when you visit <a href="https://mobiusbg.netlify.app">mobiusbg.netlify.app</a>, create an account, or use the member workspace.</p>

        <section aria-labelledby="collect">
          <h2 id="collect">1. Information we collect</h2>
          <ul>
            <li><strong>Account information:</strong> your email address, account identifier, membership role, approval status, and account-related timestamps. When you register using email and a password, Supabase handles password authentication.</li>
            <li><strong>Google sign-in information:</strong> if you choose Google, we receive the account identifier and basic profile information Google provides, such as your email address, name, and profile picture. Mobius does not receive your Google password.</li>
            <li><strong>Buying group records:</strong> deals you create or reserve, reserved quantities, saved payout terms, delivery methods, tracking numbers or drop-off references, received quantities, and recorded payments. We also keep audit records of relevant membership and transaction changes.</li>
            <li><strong>Communications:</strong> information you choose to send when contacting us or requesting support.</li>
            <li><strong>Technical information:</strong> our hosting and authentication providers may process IP addresses, browser and device information, sign-in events, and request logs to operate and protect the service.</li>
          </ul>
          <p>Mobius records payout status; it does not process payments or request card numbers or bank-account details through the workspace. Please do not put sensitive financial information in delivery references or support messages.</p>
        </section>

        <section aria-labelledby="use">
          <h2 id="use">2. How we use information</h2>
          <p>We use information to create and authenticate accounts, review membership requests, manage deals and reservations, coordinate deliveries, track receipts and payments, respond to support requests, prevent misuse, and maintain business and audit records. Administrators decide whether to approve membership; signing in does not automatically grant access to the group.</p>
        </section>

        <section aria-labelledby="google">
          <h2 id="google">3. Google account data</h2>
          <p>Google sign-in is optional. We use Google account information to identify you, sign you in, and connect you with your Mobius membership. The current sign-in integration requests basic identity information; it does not request access to Gmail messages, Google Drive files, or your contacts.</p>
          <p>We do not sell Google user data, use it for advertising, or use it to train generalized artificial intelligence models. Our use and transfer of information received from Google APIs will adhere to the <a href="https://developers.google.com/terms/api-services-user-data-policy">Google API Services User Data Policy</a>, including its Limited Use requirements.</p>
        </section>

        <section aria-labelledby="sharing">
          <h2 id="sharing">4. Who can access information</h2>
          <p>Approved members can see shared deals and group availability, along with their own reservations and payout details. Other members cannot view your private reservation and payout records through the workspace. Posting-only admins can view and create deals. The super administrator can access membership, delivery, and payment records to operate the buying group. When a new account verifies its email and awaits approval, we send its email address to the super administrator in an approval notification.</p>
          <p>We use service providers to operate Mobius: <a href="https://supabase.com/privacy">Supabase</a> for authentication and database storage, <a href="https://www.netlify.com/privacy/">Netlify</a> for hosting, and <a href="https://policies.google.com/privacy">Google</a> when you choose Google sign-in. A configured email provider also processes recipient addresses and message contents to deliver account confirmation and recovery emails. These providers process information under their applicable terms and policies.</p>
          <p>We may disclose information when required by law or reasonably necessary to protect users, address fraud or security incidents, or enforce our agreements. We do not sell your personal information.</p>
        </section>

        <section aria-labelledby="storage">
          <h2 id="storage">5. Browser storage</h2>
          <p>Mobius uses browser storage for authentication sessions so you can stay signed in. Signing out removes the active session from the app. Clearing site storage can also sign you out. If an explicitly enabled local demo is used, its sample records are saved in that browser separately from hosted member records.</p>
          <p>The app does not currently include advertising pixels or third-party marketing analytics. Hosting and authentication services may use their own operational logs and security technologies.</p>
        </section>

        <section aria-labelledby="retention">
          <h2 id="retention">6. Retention and security</h2>
          <p>We retain account and buying group records for as long as reasonably needed to operate the service, resolve outstanding reservations or payments, maintain accounting and audit records, and meet applicable legal obligations. Closing or deactivating an account does not necessarily remove records needed for those purposes. Provider logs and backups may have separate retention periods.</p>
          <p>We use authenticated accounts, membership approval, encrypted HTTPS connections, and database access controls to protect information. No online service can guarantee absolute security. Our service providers may process information in countries other than where you live.</p>
        </section>

        <section aria-labelledby="choices">
          <h2 id="choices">7. Your choices and requests</h2>
          <p>You can choose email/password signup instead of Google sign-in, sign out of your account, or revoke Mobius access through your <a href="https://myaccount.google.com/connections">Google account connections</a>. Revoking Google access does not automatically delete existing Mobius records.</p>
          <p>To request access to, correction of, or deletion of your information or account, email <a href="mailto:themobiusenterprises@gmail.com?subject=Mobius%20privacy%20request">themobiusenterprises@gmail.com</a> from your registered address. We may need to verify your identity before acting. Some records may need to be retained for outstanding transactions, security, or legal obligations. Depending on where you live, you may have additional rights under applicable privacy laws.</p>
        </section>

        <section aria-labelledby="children">
          <h2 id="children">8. Children</h2>
          <p>Mobius is intended for adult buying group members and is not directed to children under 13. If you believe a child has provided personal information, contact us so we can investigate and address it.</p>
        </section>

        <section aria-labelledby="changes">
          <h2 id="changes">9. Changes and contact</h2>
          <p>We may update this policy as the service changes. The date above identifies the latest version. We will provide additional notice when required by applicable law.</p>
          <p>For privacy questions or requests, contact <strong>The Mobius Enterprises</strong> at <a href="mailto:themobiusenterprises@gmail.com?subject=Mobius%20privacy%20request">themobiusenterprises@gmail.com</a>.</p>
        </section>
      </main>
      <footer className={styles.footer}><span>Mobius · The Mobius Enterprises</span><Link href="/workspace">Member sign in →</Link></footer>
    </div>
  );
}
