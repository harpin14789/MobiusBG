import { createClient } from "npm:@supabase/supabase-js@2.119.0";
import nodemailer from "npm:nodemailer@10.5.0";
import { createHandler } from "./handler.mjs";

function required(name: string) {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing worker setting: ${name}`);
  return value;
}

const smtpHost = required("MOBIUS_SMTP_HOST");
const smtpPort = Number(required("MOBIUS_SMTP_PORT"));
if (![465, 587].includes(smtpPort)) throw new Error("Use a TLS SMTP port");
const transport = nodemailer.createTransport({
  host: smtpHost,
  port: smtpPort,
  secure: smtpPort === 465,
  requireTLS: smtpPort === 587,
  auth: { user: required("MOBIUS_SMTP_USER"), pass: required("MOBIUS_SMTP_PASSWORD") },
  connectionTimeout: 15000,
  greetingTimeout: 15000,
  socketTimeout: 20000,
  tls: { servername: smtpHost, rejectUnauthorized: true, minVersion: "TLSv1.2" },
  disableFileAccess: true,
  disableUrlAccess: true,
});

Deno.serve(createHandler({
  secret: required("MOBIUS_ALERT_SECRET"),
  client: createClient(required("SUPABASE_URL"), required("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  }),
  sendMail: (message: object) => transport.sendMail(message),
  sender: { name: "Mobius", address: required("MOBIUS_SMTP_SENDER") },
  recipient: required("MOBIUS_APPROVAL_RECIPIENT"),
  siteUrl: "https://mobiusbg.netlify.app",
}));
