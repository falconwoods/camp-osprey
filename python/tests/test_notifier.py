from unittest.mock import patch, MagicMock
from campsite.notifier import notify, NotificationEvent
from campsite.config import NotificationsConfig, EmailConfig


def _make_config(**kwargs) -> NotificationsConfig:
    return NotificationsConfig(**kwargs)


def test_terminal_notification(capsys):
    event = NotificationEvent(title="Test Title", message="Test message")
    notify(event, _make_config(terminal=True, desktop=False))
    captured = capsys.readouterr()
    assert "Test Title" in captured.out
    assert "Test message" in captured.out


def test_terminal_disabled(capsys):
    event = NotificationEvent(title="T", message="M")
    notify(event, _make_config(terminal=False, desktop=False))
    captured = capsys.readouterr()
    assert captured.out == ""


def test_desktop_notification():
    event = NotificationEvent(title="Alert", message="Site available!")
    with patch("subprocess.run") as mock_run:
        notify(event, _make_config(terminal=False, desktop=True))
        mock_run.assert_called_once()
        args = mock_run.call_args[0][0]
        assert args[0] == "osascript"
        assert "Alert" in args[2]
        assert "Site available!" in args[2]


def test_desktop_disabled():
    event = NotificationEvent(title="T", message="M")
    with patch("subprocess.run") as mock_run:
        notify(event, _make_config(terminal=False, desktop=False))
        mock_run.assert_not_called()


def test_email_notification():
    event = NotificationEvent(title="Booked!", message="Garibaldi Jul 3-5")
    email_cfg = EmailConfig(
        enabled=True,
        smtp_host="smtp.example.com",
        smtp_port=587,
        sender="from@example.com",
        recipient="to@example.com",
        password="pw",
    )
    config = NotificationsConfig(terminal=False, desktop=False, email=email_cfg)

    with patch("smtplib.SMTP") as mock_smtp_class:
        mock_instance = mock_smtp_class.return_value.__enter__.return_value
        notify(event, config)
        mock_instance.starttls.assert_called_once()
        mock_instance.login.assert_called_once_with("from@example.com", "pw")
        mock_instance.send_message.assert_called_once()


def test_email_disabled():
    event = NotificationEvent(title="T", message="M")
    config = NotificationsConfig(terminal=False, desktop=False)
    with patch("smtplib.SMTP") as mock_smtp:
        notify(event, config)
        mock_smtp.assert_not_called()
