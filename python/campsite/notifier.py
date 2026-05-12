from __future__ import annotations
import smtplib
import subprocess
from dataclasses import dataclass
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from campsite.config import NotificationsConfig


@dataclass
class NotificationEvent:
    title: str
    message: str
    url: str = ""


def notify(event: NotificationEvent, config: NotificationsConfig) -> None:
    if config.terminal:
        _notify_terminal(event)
    if config.desktop:
        _notify_desktop(event)
    if config.email.enabled:
        try:
            _notify_email(event, config)
        except Exception as e:
            print(f"  [email failed: {e}]", flush=True)


def _notify_terminal(event: NotificationEvent) -> None:
    bar = "=" * 50
    print(f"\n{bar}\n  {event.title}\n  {event.message}\n{bar}\n")


def _notify_desktop(event: NotificationEvent) -> None:
    script = f'display notification "{event.message}" with title "{event.title}"'
    subprocess.run(["osascript", "-e", script], check=False)


def _notify_email(event: NotificationEvent, config: NotificationsConfig) -> None:
    msg = MIMEMultipart("alternative")
    msg["Subject"] = event.title
    msg["From"] = config.email.sender
    msg["To"] = config.email.recipient

    # Plain text fallback
    plain = f"{event.title}\n\n{event.message}"
    if event.url:
        plain += f"\n\nBook now: {event.url}"
    msg.attach(MIMEText(plain, "plain"))

    # HTML version
    lines = event.message.replace("\n", "<br>")
    book_btn = (
        f'<a href="{event.url}" style="display:inline-block;margin-top:20px;'
        f'padding:12px 24px;background:#1a7a4a;color:#fff;text-decoration:none;'
        f'border-radius:6px;font-weight:bold;">Book Now on BC Parks</a>'
        if event.url else ""
    )
    html = f"""
<html><body style="font-family:sans-serif;color:#222;max-width:480px;margin:32px auto;">
  <h2 style="margin:0 0 16px;color:#1a7a4a;">{event.title}</h2>
  <div style="background:#f5f5f5;border-radius:8px;padding:16px 20px;line-height:1.7;">
    {lines}
  </div>
  {book_btn}
  <p style="margin:16px 0 0;font-size:12px;color:#999;">
    Sent by campsite-booking &mdash;
    <a href="https://camping.bcparks.ca" style="color:#999;">camping.bcparks.ca</a>
  </p>
</body></html>"""
    msg.attach(MIMEText(html, "html"))

    with smtplib.SMTP(config.email.smtp_host, config.email.smtp_port) as smtp:
        smtp.starttls()
        smtp.login(config.email.sender, config.email.password)
        smtp.send_message(msg)
