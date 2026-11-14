# Google sign-in

Both `/workspace` and `/join` offer **Continue with Google**. The browser uses Supabase OAuth, returns to the site's root, and forwards the callback to `/workspace`. New Google accounts use the same database trigger as email signup: they start as inactive members and cannot access group records until an administrator approves them. User metadata cannot grant membership or administrator status.

## Provider configuration

1. Create an External application in Google Auth Platform with only the basic `openid`, `email`, and `profile` scopes. Configure its support and developer contact information.
2. Create a Web application OAuth client with JavaScript origin `https://mobiusbg.netlify.app` and redirect URI `https://etifpdcqrunvltzboxya.supabase.co/auth/v1/callback`.
3. In Supabase Authentication → Sign In / Providers → Google, enable the provider and save the Client ID and Client secret. Leave **Skip nonce checks** and **Allow users without an email** disabled. Store the secret only in Supabase, never in the app or public environment variables.
4. Keep Supabase's Site URL and root redirect allowlist set to `https://mobiusbg.netlify.app`. Allow new users to sign up if new Google members should be able to create accounts. Keep email confirmation required for email/password signup and anonymous sign-in disabled.
5. While Google is in Testing mode, add intended test accounts in Google Auth Platform → Audience. Before opening Google sign-in to the group, use Google's publishing flow and complete any requirements it displays.

Google verifies the provider account, so a new Google-only signup does not require Mobius SMTP confirmation email. Email/password signup and password resets still require working email delivery. Existing email/password users may be linked by Supabase when the provider meets its account-linking requirements; do not create another profile or change approval status in the browser. An already approved account stays approved when its verified identity is linked.

## Verification

The local suite verifies OAuth initiation from both screens and cancellation callback handling using a simulated provider redirect. It separately exercises pending-member access denial and administrator approval against the real local Auth/database stack. It does not sign into a real Google account or verify the hosted OAuth client's credentials.

For the production check, open `/join` in a private browser window, select **Continue with Google**, and choose an intended test account. A new account should reach **Awaiting group approval**. Approve that exact account in the administrator's **Members** tab, then check membership again. An existing approved administrator should reach their workspace. If Google reports `redirect_uri_mismatch`, compare the exact Supabase callback URI above with the Google client's authorized redirect URI.
