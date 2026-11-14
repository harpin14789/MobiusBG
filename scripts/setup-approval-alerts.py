"""Deploy the trusted approval-email worker using existing Supabase settings.

Run from the repository root with SUPABASE_ACCESS_TOKEN supplied by the managed
environment. Credentials stay in memory, Supabase Edge secrets, and Vault.
The optional --send-test sends one clearly labeled setup email to the owner.
"""
import argparse
import json
import os
from pathlib import Path
import secrets
import string
import urllib.error
import urllib.request

REF = "etifpdcqrunvltzboxya"
BASE = f"https://api.supabase.com/v1/projects/{REF}"
OWNER = "themobiusenterprises@gmail.com"
ROOT = Path(__file__).resolve().parents[1]


def call(path, data=None, method=None, content_type="application/json"):
    payload = json.dumps(data).encode() if data is not None and not isinstance(data, bytes) else data
    req = urllib.request.Request(BASE + path, data=payload, method=method, headers={
        "Authorization": "Bearer " + os.environ["SUPABASE_ACCESS_TOKEN"],
        "Content-Type": content_type,
    })
    try:
        with urllib.request.urlopen(req, timeout=120) as response:
            raw = response.read()
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as error:
        # Never dump request headers or responses from credential endpoints.
        if "/functions/deploy" in path:
            detail = error.read(4000).decode(errors="replace")
            raise RuntimeError(f"Function deployment HTTP {error.code}: {detail}") from None
        raise RuntimeError(f"Supabase operation failed: {path}, HTTP {error.code}") from None


def query(sql, read_only=False):
    return call("/database/query", {"query": sql, "read_only": read_only})


def sql_string(value):
    return "'" + value.replace("'", "''") + "'"


def migrate():
    for name in ["20261114000100_member_roles", "20261114000200_approval_alerts", "20261114000300_delivery_submissions", "20261114000400_shipping_label_requests", "20261114000500_member_payment_profiles", "20261114000600_member_reservations_only", "20261114000700_deal_management", "20261114000800_member_event_emails", "20261114000900_multiple_payment_methods", "20261114001000_edit_reservations", "20261114001100_member_specific_deal_terms", "20261114001200_member_regions"]:
        version = name.split("_")[0]
        done = query("select version from supabase_migrations.schema_migrations where version = " + sql_string(version), True)
        if done:
            print("Migration already recorded:", version, flush=True)
            continue
        sql = (ROOT / "supabase/migrations" / (name + ".sql")).read_text().strip()
        assert sql.startswith("begin;") and sql.endswith("commit;")
        history = "insert into supabase_migrations.schema_migrations(version,name,statements) values (" + ",".join([
            sql_string(version), sql_string(name.split("_", 1)[1]), "array[" + sql_string(sql) + "]",
        ]) + ");"
        query(sql.removesuffix("commit;") + history + "\nnotify pgrst, 'reload schema';\ncommit;")
        print("Migration applied:", version, flush=True)


def deploy():
    boundary = "mobius" + secrets.token_hex(12)
    parts = []
    metadata = {"entrypoint_path": "index.ts", "name": "approval-alerts", "verify_jwt": False}
    parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="metadata"\r\nContent-Type: application/json\r\n\r\n{json.dumps(metadata)}\r\n'.encode())
    for name in ["index.ts", "handler.mjs"]:
        data = (ROOT / "supabase/functions/approval-alerts" / name).read_bytes()
        parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{name}"\r\nContent-Type: application/octet-stream\r\n\r\n'.encode() + data + b"\r\n")
    parts.append(f"--{boundary}--\r\n".encode())
    result = call("/functions/deploy?slug=approval-alerts", b"".join(parts), content_type="multipart/form-data; boundary=" + boundary)
    print("Function deployed:", result.get("slug", "approval-alerts"), "status:", result.get("status"), flush=True)


def configure():
    config = call("/config/auth")
    password = config.get("smtp_pass") or ""
    if not config.get("smtp_host") or not config.get("smtp_user"):
        raise RuntimeError("Configure SMTP in Supabase Auth first.")
    # Edge runtimes support Gmail's implicit TLS port. Auth can keep STARTTLS.
    port = "465" if config["smtp_host"] == "smtp.gmail.com" else str(config.get("smtp_port", "465"))
    worker_secret = secrets.token_urlsafe(48)
    values = {
        "MOBIUS_SMTP_HOST": config["smtp_host"], "MOBIUS_SMTP_PORT": port,
        "MOBIUS_SMTP_USER": config["smtp_user"],
        "MOBIUS_SMTP_SENDER": config["smtp_admin_email"],
        "MOBIUS_APPROVAL_RECIPIENT": OWNER, "MOBIUS_ALERT_SECRET": worker_secret,
    }
    # Auth returns a SHA-256 fingerprint, not the recoverable Gmail password.
    # Never overwrite a manually configured Edge secret with that fingerprint.
    fingerprint = len(password) == 64 and all(c in string.hexdigits for c in password)
    masked = not password or set(password) <= {"*", "•"}
    if not fingerprint and not masked:
        values["MOBIUS_SMTP_PASSWORD"] = password.replace(" ", "") if config["smtp_host"] == "smtp.gmail.com" else password
    else:
        print("Preserving the SMTP password entered directly in Edge Function secrets.", flush=True)
    call("/secrets", [{"name": name, "value": value} for name, value in values.items()])
    endpoint = f"https://{REF}.supabase.co/functions/v1/approval-alerts"
    for name, value in {"mobius_alerts_url": endpoint, "mobius_alerts_secret": worker_secret}.items():
        # Vault contents never appear in migration files or cron command text.
        sql = "do $vault$ declare existing uuid; begin select id into existing from vault.secrets where name = " + sql_string(name) + "; "
        sql += "if existing is null then perform vault.create_secret(" + sql_string(value) + "," + sql_string(name) + "); "
        sql += "else perform vault.update_secret(existing," + sql_string(value) + "); end if; end; $vault$;"
        query(sql)
    print("Worker secrets and scheduler Vault bindings saved privately.", flush=True)
    return endpoint, worker_secret


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--send-test", action="store_true")
    args = parser.parse_args()
    migrate()
    endpoint, worker_secret = configure()
    deploy()
    if args.send_test:
        req = urllib.request.Request(endpoint, data=b'{"action":"test"}', headers={
            "Content-Type": "application/json", "X-Mobius-Alert-Secret": worker_secret,
        })
        try:
            with urllib.request.urlopen(req, timeout=90) as response:
                result = json.load(response)
                assert result == {"test": "sent"}
        except urllib.error.HTTPError as error:
            try:
                detail = json.load(error).get("code", "unknown")
            except (ValueError, AttributeError):
                detail = "unknown"
            if not isinstance(detail, str) or not detail.replace("_", "").isalnum():
                detail = "unknown"
            raise RuntimeError(f"SMTP setup test failed with HTTP {error.code}, category {detail}.") from None
        print("SMTP provider accepted the setup email to the configured owner.", flush=True)
    query((ROOT / "supabase/approval-alerts-schedule.sql").read_text())
    print("Approval alert schedule enabled: every two minutes.", flush=True)


if __name__ == "__main__":
    main()
