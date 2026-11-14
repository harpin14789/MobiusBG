# Signup email delivery

Mobius uses Supabase to send signup confirmation and password-reset emails. Configure the sender in **Supabase → Project settings → Authentication → SMTP settings** (the dashboard may group this under Authentication → Email). No SMTP password or API key belongs in GitHub, Netlify's public variables, or chat.

Hosted signup is deliberately disabled until this setup is complete. The signup form is implemented at `https://mobiusbg.netlify.app/join`; it reports when account creation is unavailable rather than claiming an email was sent.

## Starting with Gmail

For a small initial group, the existing Gmail account can be used as the SMTP sender without purchasing a domain. This depends on Google offering App Passwords for the account; some account policies or protection settings prevent them.

1. Sign into the Google account that will send email. Enable [2-Step Verification](https://myaccount.google.com/security).
2. Open [App Passwords](https://myaccount.google.com/apppasswords) and create one named `Mobius Supabase`. If this option is unavailable, use a supported dedicated SMTP provider instead; do not enter your normal Google password in Supabase.
3. Enable custom SMTP in Supabase and enter:

   | Setting | Value |
   | --- | --- |
   | Sender email | `themobiusenterprises@gmail.com` |
   | Sender name | `Mobius` |
   | SMTP host | `smtp.gmail.com` |
   | Port | `587` (STARTTLS) |
   | Username | `themobiusenterprises@gmail.com` |
   | Password | The Google App Password, entered privately |

4. Save the SMTP configuration. Preserve TLS; do not use a setting that skips certificate validation.
5. Review **Authentication → Rate limits**. The project's current limit is 2 emails per hour. After custom SMTP is configured, choose a modest limit appropriate for the group (for example, 30 per hour) within the sender account's quota. Google's separate sending limits apply across normal Gmail messages and app email; review [Google's current Gmail sending guidance](https://support.google.com/mail/answer/22839).

Gmail is a starting option, with account-level sending limits and anti-abuse restrictions. A dedicated transactional email provider is preferable as volume or reliability requirements grow.

## Dedicated provider alternative: Resend

[Resend](https://resend.com) integrates with Supabase through SMTP. Verify its current [pricing and free-plan allowance](https://resend.com/pricing) before signing up. Sending to your members requires verifying a domain you control; the shared `netlify.app` domain and `gmail.com` cannot be verified as yours. You can keep the website on Netlify while using a separate domain or subdomain for email.

Add the DNS records shown by Resend at your domain's DNS provider. Once verified, use the SMTP settings shown in Resend, a sender under the verified domain, and a sending API key as the SMTP password. Store that key only in Supabase's SMTP settings. Provider signup, domain verification, and credentials must be completed in the user's accounts.

## Enable and verify signup

After saving SMTP, enable **Allow new users to sign up** in Supabase Authentication. Keep **Confirm email** enabled and anonymous sign-ins disabled. Keep the Site URL and redirect URLs set to `https://mobiusbg.netlify.app` (the trailing-slash root is also allowed).

Register one intended test member through `/join`. Verify that the confirmation email arrives, its link returns to the Mobius site, and the confirmed account sees **Awaiting group approval**. Sign in as the administrator, open **Members**, and select **Approve membership** for that exact email. Only then should the new member see deals. If delivery fails, check the provider and Supabase Auth logs and correct SMTP before inviting the rest of the group. Never turn off email confirmation as a delivery workaround.
