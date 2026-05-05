from __future__ import annotations
import smtplib
import subprocess
from dataclasses import dataclass
from email.mime.text import MIMEText
from campsite.config import NotificationsConfig


@dataclass
class NotificationEvent:
    title: str
    message: str


def notify(event: NotificationEvent, config: NotificationsConfig) -> None:
    if config.terminal:
        _notify_terminal(event)
    if config.desktop:
        _notify_desktop(event)
    if config.email.enabled:
        _notify_email(event, config)


def _notify_terminal(event: NotificationEvent) -> None:
    bar = "=" * 50
    print(f"\n{bar}\n  {event.title}\n  {event.message}\n{bar}\n")


def _notify_desktop(event: NotificationEvent) -> None:
    script = f'display notification "{event.message}" with title "{event.title}"'
    subprocess.run(["osascript", "-e", script], check=False)


def _notify_email(event: NotificationEvent, config: NotificationsConfig) -> None:
    msg = MIMEText(event.message)
    msg["Subject"] = event.title
    msg["From"] = config.email.sender
    msg["To"] = config.email.recipient
    with smtplib.SMTP(config.email.smtp_host, config.email.smtp_port) as smtp:
        smtp.starttls()
        smtp.login(config.email.sender, config.email.password)
        smtp.send_message(msg)
