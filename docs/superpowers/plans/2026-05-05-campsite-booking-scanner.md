# Campsite Booking Scanner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Python CLI that polls BC Parks for campsite cancellations, books the first available match automatically, and notifies via terminal, desktop popup, and email.

**Architecture:** httpx polls the BC Parks internal REST API (discovered via `campsite discover`) on a configurable interval; on a match, Playwright drives the full browser booking flow including payment; results flow to a notifier that dispatches to all configured channels simultaneously.

**Tech Stack:** Python 3.11+, Click, Pydantic v2, PyYAML, httpx, Playwright, pytest, pytest-asyncio, respx

---

## File Map

```
campsite-booking/
├── pyproject.toml
├── config.yaml.example
├── campsite/
│   ├── __init__.py
│   ├── cli.py          # Click entry point: discover, scan, check, config check
│   ├── config.py       # Pydantic AppConfig + load_config() with env var resolution
│   ├── models.py       # AvailableSite, BookingResult + parse_date_expression()
│   ├── api.py          # BCParksAPI (httpx) — interface stub, filled in post-discovery
│   ├── scanner.py      # Scanner class — polling loop + priority iteration + filtering
│   ├── booker.py       # book_site() — Playwright automation, filled in post-discovery
│   └── notifier.py     # notify() — terminal, macOS desktop popup, SMTP email
├── tests/
│   ├── __init__.py
│   ├── test_models.py
│   ├── test_config.py
│   ├── test_notifier.py
│   └── test_scanner.py
└── docs/
    ├── api-notes.md        (populated by campsite discover — not created until then)
    ├── booking-flow.py     (populated by campsite discover — not created until then)
    └── superpowers/
        ├── specs/
        │   └── 2026-05-05-campsite-booking-design.md
        └── plans/
            └── 2026-05-05-campsite-booking-scanner.md
```

---

### Task 1: Project setup

**Files:**
- Create: `pyproject.toml`
- Create: `campsite/__init__.py`
- Create: `campsite/cli.py` (minimal stub)
- Create: `tests/__init__.py`
- Create: `config.yaml.example`

- [ ] **Step 1: Create `pyproject.toml`**

```toml
[project]
name = "campsite-booking"
version = "0.1.0"
requires-python = ">=3.11"
dependencies = [
    "click>=8.1",
    "pydantic>=2.0",
    "pyyaml>=6.0",
    "httpx>=0.27",
    "playwright>=1.44",
]

[project.scripts]
campsite = "campsite.cli:cli"

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[tool.pytest.ini_options]
testpaths = ["tests"]
asyncio_mode = "auto"

[dependency-groups]
dev = [
    "pytest>=8.0",
    "pytest-asyncio>=0.23",
    "respx>=0.21",
]
```

- [ ] **Step 2: Create `campsite/__init__.py` and `tests/__init__.py`**

Both are empty files.

- [ ] **Step 3: Create `campsite/cli.py` (minimal stub)**

```python
import click

@click.group()
def cli():
    """BC Parks campsite scanner and auto-booker."""
    pass
```

- [ ] **Step 4: Create `config.yaml.example`**

```yaml
poll_interval_seconds: 60

campgrounds:
  - name: "Garibaldi Lake"
    park_id: "1234"       # replace with real ID from campsite discover
    priority: 1
  - name: "Cultus Lake"
    park_id: "5678"
    priority: 2

dates:
  - "2026/06/20-2026/06/23"
  - "2026/07/FRIDAY-SUNDAY"
  - "2026/07/FRI"
  - "2026/07/05"
  - "2026/07/05-07"

filters:
  no_walkin: true
  no_double: true

credentials:
  bcparks_email: "you@example.com"
  bcparks_password: "${BCPARKS_PASSWORD}"
  party_size: 4
  vehicle_plate: "ABC 1234"

payment:
  card_number: "${CARD_NUMBER}"
  card_expiry: "${CARD_EXPIRY}"
  card_cvv: "${CARD_CVV}"
  name_on_card: "Your Name"

notifications:
  terminal: true
  desktop: true
  email:
    enabled: true
    smtp_host: "smtp.gmail.com"
    smtp_port: 587
    sender: "you@example.com"
    recipient: "you@example.com"
    password: "${EMAIL_PASSWORD}"

auto_book: true
```

- [ ] **Step 5: Install dependencies**

```bash
pip install -e ".[dev]"
playwright install chromium
```

Expected: no errors, `campsite --help` prints the help message.

- [ ] **Step 6: Verify CLI stub**

```bash
campsite --help
```

Expected output:
```
Usage: campsite [OPTIONS] COMMAND [ARGS]...

  BC Parks campsite scanner and auto-booker.

Options:
  --help  Show this message and exit.
```

- [ ] **Step 7: Commit**

```bash
git init
git add pyproject.toml campsite/ tests/ config.yaml.example docs/
git commit -m "feat: initial project scaffold"
```

---

### Task 2: Data models

**Files:**
- Create: `campsite/models.py`
- Create: `tests/test_models.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_models.py
from datetime import date
from campsite.models import AvailableSite, BookingResult

def test_available_site_fields():
    site = AvailableSite(
        site_id="s1",
        campground_id="c1",
        is_walkin=False,
        is_double=False,
        check_in=date(2026, 7, 3),
        check_out=date(2026, 7, 5),
    )
    assert site.site_id == "s1"
    assert site.is_walkin is False

def test_booking_result_success():
    site = AvailableSite(
        site_id="s1", campground_id="c1", is_walkin=False, is_double=False,
        check_in=date(2026, 7, 3), check_out=date(2026, 7, 5),
    )
    result = BookingResult(success=True, site=site, confirmation_number="BC-12345")
    assert result.success is True
    assert result.confirmation_number == "BC-12345"

def test_booking_result_failure():
    result = BookingResult(success=False, error_message="Site taken")
    assert result.success is False
    assert result.site is None
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
pytest tests/test_models.py -v
```

Expected: `ImportError: cannot import name 'AvailableSite' from 'campsite.models'`

- [ ] **Step 3: Implement `campsite/models.py`**

```python
from __future__ import annotations
from dataclasses import dataclass, field
from datetime import date

@dataclass
class AvailableSite:
    site_id: str
    campground_id: str
    is_walkin: bool
    is_double: bool
    check_in: date
    check_out: date

@dataclass
class BookingResult:
    success: bool
    site: AvailableSite | None = None
    confirmation_number: str | None = None
    error_message: str | None = None
```

- [ ] **Step 4: Run test — expect PASS**

```bash
pytest tests/test_models.py -v
```

Expected: 3 passed

- [ ] **Step 5: Commit**

```bash
git add campsite/models.py tests/test_models.py
git commit -m "feat: add AvailableSite and BookingResult models"
```

---

### Task 3: Date expression parser

**Files:**
- Modify: `campsite/models.py` (add `parse_date_expression`)
- Modify: `tests/test_models.py` (add parser tests)

- [ ] **Step 1: Write the failing tests**

Add to `tests/test_models.py`:

```python
from campsite.models import parse_date_expression

def test_parse_specific_range():
    result = parse_date_expression("2026/06/20-2026/06/23")
    assert result == [(date(2026, 6, 20), date(2026, 6, 23))]

def test_parse_shorthand_range_same_month():
    result = parse_date_expression("2026/07/05-07")
    assert result == [(date(2026, 7, 5), date(2026, 7, 7))]

def test_parse_single_night():
    result = parse_date_expression("2026/07/05")
    assert result == [(date(2026, 7, 5), date(2026, 7, 6))]

def test_parse_dayname_range_full():
    # 2026/07/FRIDAY-SUNDAY → all Fri→Sun spans in July 2026
    # Fridays in July 2026: Jul 3, 10, 17, 24, 31
    result = parse_date_expression("2026/07/FRIDAY-SUNDAY")
    assert result == [
        (date(2026, 7, 3), date(2026, 7, 5)),
        (date(2026, 7, 10), date(2026, 7, 12)),
        (date(2026, 7, 17), date(2026, 7, 19)),
        (date(2026, 7, 24), date(2026, 7, 26)),
        (date(2026, 7, 31), date(2026, 8, 2)),
    ]

def test_parse_dayname_range_abbreviated():
    result = parse_date_expression("2026/07/FRI-SUN")
    assert result == parse_date_expression("2026/07/FRIDAY-SUNDAY")

def test_parse_single_dayname():
    # 2026/07/FRI → all Fridays in July as one-night stays (Fri→Sat)
    result = parse_date_expression("2026/07/FRI")
    assert result == [
        (date(2026, 7, 3), date(2026, 7, 4)),
        (date(2026, 7, 10), date(2026, 7, 11)),
        (date(2026, 7, 17), date(2026, 7, 18)),
        (date(2026, 7, 24), date(2026, 7, 25)),
        (date(2026, 7, 31), date(2026, 8, 1)),
    ]

def test_parse_dayname_case_insensitive():
    assert parse_date_expression("2026/07/fri") == parse_date_expression("2026/07/FRI")

def test_parse_invalid_expression():
    import pytest
    with pytest.raises(ValueError, match="Unrecognized date expression"):
        parse_date_expression("not-a-date")
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
pytest tests/test_models.py -k "parse" -v
```

Expected: `ImportError: cannot import name 'parse_date_expression'`

- [ ] **Step 3: Implement `parse_date_expression` in `campsite/models.py`**

Add to the bottom of `campsite/models.py`:

```python
import re
from datetime import timedelta
from typing import Iterator

_DAY_NAMES: dict[str, int] = {
    "MON": 0, "MONDAY": 0,
    "TUE": 1, "TUESDAY": 1,
    "WED": 2, "WEDNESDAY": 2,
    "THU": 3, "THURSDAY": 3,
    "FRI": 4, "FRIDAY": 4,
    "SAT": 5, "SATURDAY": 5,
    "SUN": 6, "SUNDAY": 6,
}

def parse_date_expression(expr: str) -> list[tuple[date, date]]:
    """Parse a date expression into a list of (check_in, check_out) pairs."""
    s = expr.strip()

    # YYYY/MM/DD-YYYY/MM/DD — specific cross-month range
    m = re.fullmatch(r"(\d{4})/(\d{2})/(\d{2})-(\d{4})/(\d{2})/(\d{2})", s)
    if m:
        y1, m1, d1, y2, m2, d2 = (int(x) for x in m.groups())
        return [(date(y1, m1, d1), date(y2, m2, d2))]

    # YYYY/MM/DD-DD — shorthand range within the same month
    m = re.fullmatch(r"(\d{4})/(\d{2})/(\d{2})-(\d{2})", s)
    if m:
        y, mo, d1, d2 = int(m.group(1)), int(m.group(2)), int(m.group(3)), int(m.group(4))
        return [(date(y, mo, d1), date(y, mo, d2))]

    # YYYY/MM/DD — single night (check_out = check_in + 1 day)
    m = re.fullmatch(r"(\d{4})/(\d{2})/(\d{2})", s)
    if m:
        y, mo, d = int(m.group(1)), int(m.group(2)), int(m.group(3))
        check_in = date(y, mo, d)
        return [(check_in, check_in + timedelta(days=1))]

    upper = s.upper()

    # YYYY/MM/DAYNAME-DAYNAME — all weekday spans in the month
    m = re.fullmatch(r"(\d{4})/(\d{2})/([A-Z]+)-([A-Z]+)", upper)
    if m:
        y, mo, start_name, end_name = int(m.group(1)), int(m.group(2)), m.group(3), m.group(4)
        if start_name not in _DAY_NAMES or end_name not in _DAY_NAMES:
            raise ValueError(f"Unrecognized day name in: {expr!r}")
        start_dow = _DAY_NAMES[start_name]
        end_dow = _DAY_NAMES[end_name]
        nights = (end_dow - start_dow) % 7 or 7
        return list(_weekday_spans_in_month(y, mo, start_dow, nights))

    # YYYY/MM/DAYNAME — all occurrences of that weekday as one-night stays
    m = re.fullmatch(r"(\d{4})/(\d{2})/([A-Z]+)", upper)
    if m:
        y, mo, day_name = int(m.group(1)), int(m.group(2)), m.group(3)
        if day_name not in _DAY_NAMES:
            raise ValueError(f"Unrecognized day name in: {expr!r}")
        return list(_weekday_spans_in_month(y, mo, _DAY_NAMES[day_name], 1))

    raise ValueError(f"Unrecognized date expression: {expr!r}")


def _weekday_spans_in_month(
    year: int, month: int, start_weekday: int, nights: int
) -> Iterator[tuple[date, date]]:
    d = date(year, month, 1)
    days_ahead = (start_weekday - d.weekday()) % 7
    d += timedelta(days=days_ahead)
    while d.month == month:
        yield (d, d + timedelta(days=nights))
        d += timedelta(weeks=1)
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
pytest tests/test_models.py -v
```

Expected: all tests pass

- [ ] **Step 5: Commit**

```bash
git add campsite/models.py tests/test_models.py
git commit -m "feat: add date expression parser with all supported formats"
```

---

### Task 4: Config loader

**Files:**
- Create: `campsite/config.py`
- Create: `tests/test_config.py`

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_config.py
import os
import pytest
from pathlib import Path
from campsite.config import load_config, AppConfig

MINIMAL_CONFIG = """
poll_interval_seconds: 30
campgrounds:
  - name: "Test Park"
    park_id: "42"
    priority: 1
dates:
  - "2026/07/05"
filters:
  no_walkin: true
  no_double: false
credentials:
  bcparks_email: "test@example.com"
  bcparks_password: "secret"
  party_size: 2
  vehicle_plate: "XYZ 999"
payment:
  card_number: "4111111111111111"
  card_expiry: "12/28"
  card_cvv: "123"
  name_on_card: "Test User"
notifications:
  terminal: true
  desktop: false
  email:
    enabled: false
auto_book: false
"""

def test_load_config(tmp_path):
    cfg_file = tmp_path / "config.yaml"
    cfg_file.write_text(MINIMAL_CONFIG)
    config = load_config(cfg_file)
    assert config.poll_interval_seconds == 30
    assert len(config.campgrounds) == 1
    assert config.campgrounds[0].name == "Test Park"
    assert config.campgrounds[0].park_id == "42"
    assert config.filters.no_walkin is True
    assert config.filters.no_double is False
    assert config.auto_book is False

def test_env_var_resolution(tmp_path, monkeypatch):
    monkeypatch.setenv("TEST_PASSWORD", "supersecret")
    cfg_file = tmp_path / "config.yaml"
    cfg_file.write_text(MINIMAL_CONFIG.replace('"secret"', '"${TEST_PASSWORD}"'))
    config = load_config(cfg_file)
    assert config.credentials.bcparks_password == "supersecret"

def test_missing_env_var_raises(tmp_path):
    cfg_file = tmp_path / "config.yaml"
    cfg_file.write_text(MINIMAL_CONFIG.replace('"secret"', '"${DOES_NOT_EXIST_XYZ}"'))
    with pytest.raises(ValueError, match="DOES_NOT_EXIST_XYZ"):
        load_config(cfg_file)

def test_invalid_config_raises(tmp_path):
    cfg_file = tmp_path / "config.yaml"
    cfg_file.write_text("campgrounds: not_a_list\n")
    with pytest.raises(Exception):
        load_config(cfg_file)
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
pytest tests/test_config.py -v
```

Expected: `ImportError: cannot import name 'load_config'`

- [ ] **Step 3: Implement `campsite/config.py`**

```python
from __future__ import annotations
import os
import re
from pathlib import Path
from pydantic import BaseModel, model_validator
import yaml

_ENV_RE = re.compile(r"\$\{([^}]+)\}")


def _resolve(obj: object) -> object:
    if isinstance(obj, str):
        def _sub(m: re.Match) -> str:
            key = m.group(1)
            val = os.environ.get(key)
            if val is None:
                raise ValueError(f"Environment variable ${{{key}}} not set")
            return val
        return _ENV_RE.sub(_sub, obj)
    if isinstance(obj, dict):
        return {k: _resolve(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_resolve(v) for v in obj]
    return obj


class CampgroundConfig(BaseModel):
    name: str
    park_id: str
    priority: int


class FiltersConfig(BaseModel):
    no_walkin: bool = True
    no_double: bool = True


class CredentialsConfig(BaseModel):
    bcparks_email: str
    bcparks_password: str
    party_size: int
    vehicle_plate: str


class PaymentConfig(BaseModel):
    card_number: str
    card_expiry: str
    card_cvv: str
    name_on_card: str


class EmailConfig(BaseModel):
    enabled: bool = False
    smtp_host: str = ""
    smtp_port: int = 587
    sender: str = ""
    recipient: str = ""
    password: str = ""


class NotificationsConfig(BaseModel):
    terminal: bool = True
    desktop: bool = False
    email: EmailConfig = EmailConfig()


class AppConfig(BaseModel):
    poll_interval_seconds: int = 60
    campgrounds: list[CampgroundConfig]
    dates: list[str]
    filters: FiltersConfig = FiltersConfig()
    credentials: CredentialsConfig
    payment: PaymentConfig
    notifications: NotificationsConfig = NotificationsConfig()
    auto_book: bool = False


def load_config(path: Path) -> AppConfig:
    raw = yaml.safe_load(path.read_text())
    resolved = _resolve(raw)
    return AppConfig.model_validate(resolved)
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
pytest tests/test_config.py -v
```

Expected: 4 passed

- [ ] **Step 5: Commit**

```bash
git add campsite/config.py tests/test_config.py
git commit -m "feat: add config loader with env var resolution"
```

---

### Task 5: Notifier

**Files:**
- Create: `campsite/notifier.py`
- Create: `tests/test_notifier.py`

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_notifier.py
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

    mock_smtp = MagicMock()
    with patch("smtplib.SMTP", return_value=mock_smtp.__enter__.return_value):
        mock_smtp.__enter__.return_value = mock_smtp
        notify(event, config)
        mock_smtp.starttls.assert_called_once()
        mock_smtp.login.assert_called_once_with("from@example.com", "pw")
        mock_smtp.send_message.assert_called_once()

def test_email_disabled():
    event = NotificationEvent(title="T", message="M")
    config = NotificationsConfig(terminal=False, desktop=False)
    with patch("smtplib.SMTP") as mock_smtp:
        notify(event, config)
        mock_smtp.assert_not_called()
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
pytest tests/test_notifier.py -v
```

Expected: `ImportError: cannot import name 'notify'`

- [ ] **Step 3: Implement `campsite/notifier.py`**

```python
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
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
pytest tests/test_notifier.py -v
```

Expected: 6 passed

- [ ] **Step 5: Commit**

```bash
git add campsite/notifier.py tests/test_notifier.py
git commit -m "feat: add notifier for terminal, desktop, and email channels"
```

---

### Task 6: BC Parks API client interface

The implementation cannot be written until `campsite discover` is run and `docs/api-notes.md` is populated (Task 8). This task defines the interface so the scanner can be built and tested against it.

**Files:**
- Create: `campsite/api.py`

- [ ] **Step 1: Create `campsite/api.py` with the interface**

```python
from __future__ import annotations
import httpx
from datetime import date
from campsite.models import AvailableSite


class BCParksAPI:
    """
    Client for the BC Parks internal REST API.

    BEFORE IMPLEMENTING: run `campsite discover` and read docs/api-notes.md.
    That file contains the real endpoint URLs, required headers, and response
    schemas discovered from a live browser session.

    Fill in get_availability() based on what you find there.
    """

    def __init__(self) -> None:
        # BASE_URL and any auth headers come from docs/api-notes.md
        self._client = httpx.AsyncClient()

    async def get_availability(
        self,
        campground_id: str,
        check_in: date,
        check_out: date,
    ) -> list[AvailableSite]:
        """
        Return available sites for the given campground and date range.

        Implementation guide (fill in after campsite discover):
        1. Find the availability endpoint in docs/api-notes.md
        2. Note the required query params (campground_id, dates, resource type, etc.)
        3. Note required headers (auth tokens, session cookies)
        4. Map the response JSON fields to AvailableSite fields:
           - is_walkin: look for a field like "resourceLocationId", "siteType", or "walkIn"
           - is_double: look for a field like "double", "groupSite", or site name containing "double"
        """
        raise NotImplementedError(
            "Run 'campsite discover' first, then implement based on docs/api-notes.md"
        )

    async def close(self) -> None:
        await self._client.aclose()
```

- [ ] **Step 2: Verify it imports cleanly**

```bash
python -c "from campsite.api import BCParksAPI; print('OK')"
```

Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add campsite/api.py
git commit -m "feat: add BCParksAPI interface stub (implementation requires campsite discover)"
```

---

### Task 7: Scanner

**Files:**
- Create: `campsite/scanner.py`
- Create: `tests/test_scanner.py`

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_scanner.py
import asyncio
from datetime import date
from unittest.mock import AsyncMock
import pytest
from campsite.models import AvailableSite, parse_date_expression
from campsite.config import AppConfig, CampgroundConfig, FiltersConfig, CredentialsConfig, PaymentConfig
from campsite.scanner import Scanner


def _make_site(campground_id="c1", is_walkin=False, is_double=False) -> AvailableSite:
    return AvailableSite(
        site_id="s1",
        campground_id=campground_id,
        is_walkin=is_walkin,
        is_double=is_double,
        check_in=date(2026, 7, 5),
        check_out=date(2026, 7, 6),
    )


def _make_config(campgrounds=None, dates=None, filters=None) -> AppConfig:
    return AppConfig(
        poll_interval_seconds=1,
        campgrounds=campgrounds or [CampgroundConfig(name="A", park_id="c1", priority=1)],
        dates=dates or ["2026/07/05"],
        filters=filters or FiltersConfig(),
        credentials=CredentialsConfig(
            bcparks_email="e@e.com", bcparks_password="pw",
            party_size=2, vehicle_plate="X1"
        ),
        payment=PaymentConfig(
            card_number="4111", card_expiry="12/28", card_cvv="123", name_on_card="Test"
        ),
    )


async def test_run_once_returns_match():
    api = AsyncMock()
    api.get_availability.return_value = [_make_site()]
    scanner = Scanner(_make_config(), api)
    result = await scanner.run_once()
    assert result is not None
    assert result.campground_id == "c1"


async def test_run_once_returns_none_when_empty():
    api = AsyncMock()
    api.get_availability.return_value = []
    scanner = Scanner(_make_config(), api)
    result = await scanner.run_once()
    assert result is None


async def test_filter_walkin_excluded():
    api = AsyncMock()
    api.get_availability.return_value = [_make_site(is_walkin=True)]
    config = _make_config(filters=FiltersConfig(no_walkin=True, no_double=False))
    scanner = Scanner(config, api)
    result = await scanner.run_once()
    assert result is None


async def test_filter_double_excluded():
    api = AsyncMock()
    api.get_availability.return_value = [_make_site(is_double=True)]
    config = _make_config(filters=FiltersConfig(no_walkin=False, no_double=True))
    scanner = Scanner(config, api)
    result = await scanner.run_once()
    assert result is None


async def test_priority_order():
    """Campground 1 (priority 1) should be checked before campground 2."""
    calls = []

    async def fake_availability(campground_id, check_in, check_out):
        calls.append(campground_id)
        return [_make_site(campground_id=campground_id)] if campground_id == "c2" else []

    api = AsyncMock()
    api.get_availability.side_effect = fake_availability
    config = _make_config(campgrounds=[
        CampgroundConfig(name="A", park_id="c1", priority=1),
        CampgroundConfig(name="B", park_id="c2", priority=2),
    ])
    scanner = Scanner(config, api)
    result = await scanner.run_once()
    assert calls[0] == "c1"
    assert result.campground_id == "c2"


async def test_deduplication_skips_attempted():
    api = AsyncMock()
    api.get_availability.return_value = [_make_site()]
    scanner = Scanner(_make_config(), api)

    first = await scanner.run_once()
    assert first is not None
    scanner.mark_attempted(first)

    second = await scanner.run_once()
    assert second is None
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
pytest tests/test_scanner.py -v
```

Expected: `ImportError: cannot import name 'Scanner'`

- [ ] **Step 3: Implement `campsite/scanner.py`**

```python
from __future__ import annotations
import asyncio
from datetime import date
from campsite.config import AppConfig
from campsite.models import AvailableSite, parse_date_expression
from campsite.api import BCParksAPI


class Scanner:
    def __init__(self, config: AppConfig, api: BCParksAPI) -> None:
        self._config = config
        self._api = api
        self._attempted: set[tuple[str, date, date]] = set()

    async def run_once(self) -> AvailableSite | None:
        """Check all campground × date pairs in priority order. Returns the first match."""
        date_ranges: list[tuple[date, date]] = []
        for expr in self._config.dates:
            date_ranges.extend(parse_date_expression(expr))

        for campground in sorted(self._config.campgrounds, key=lambda c: c.priority):
            for check_in, check_out in date_ranges:
                key = (campground.park_id, check_in, check_out)
                if key in self._attempted:
                    continue
                sites = await self._api.get_availability(campground.park_id, check_in, check_out)
                matches = self._apply_filters(sites)
                if matches:
                    return matches[0]
        return None

    def _apply_filters(self, sites: list[AvailableSite]) -> list[AvailableSite]:
        result = sites
        if self._config.filters.no_walkin:
            result = [s for s in result if not s.is_walkin]
        if self._config.filters.no_double:
            result = [s for s in result if not s.is_double]
        return result

    def mark_attempted(self, site: AvailableSite) -> None:
        self._attempted.add((site.campground_id, site.check_in, site.check_out))

    async def run_loop(self, on_match: callable) -> None:
        """Poll until on_match returns True (booking succeeded), then stop."""
        while True:
            match = await self.run_once()
            if match:
                success = await on_match(match)
                if success:
                    return
                self.mark_attempted(match)
            await asyncio.sleep(self._config.poll_interval_seconds)
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
pytest tests/test_scanner.py -v
```

Expected: 6 passed

- [ ] **Step 5: Commit**

```bash
git add campsite/scanner.py tests/test_scanner.py
git commit -m "feat: add scanner with priority iteration, filtering, and deduplication"
```

---

### Task 8: Discovery command (`campsite discover`)

This command opens a real browser, records all XHR/Fetch API calls while you use the site, saves them to `docs/api-notes.md`, then launches `playwright codegen` to record the booking flow.

**Files:**
- Modify: `campsite/cli.py`

- [ ] **Step 1: Add the discover command to `campsite/cli.py`**

Replace the entire contents of `campsite/cli.py`:

```python
from __future__ import annotations
import asyncio
import json
import subprocess
from pathlib import Path

import click

from campsite.config import load_config


@click.group()
def cli():
    """BC Parks campsite scanner and auto-booker."""
    pass


@cli.command()
def discover():
    """
    Record BC Parks API calls and booking flow from a live browser session.

    Phase 1: Browse the site normally while network traffic is recorded.
    Phase 2: Go through checkout while your clicks are recorded as Playwright code.

    Output: docs/api-notes.md and docs/booking-flow.py
    """
    asyncio.run(_run_discover())


async def _run_discover() -> None:
    from playwright.async_api import async_playwright

    docs = Path("docs")
    docs.mkdir(exist_ok=True)

    api_calls: list[dict] = []

    click.echo("=== Phase 1: API Discovery ===")
    click.echo("A browser window will open. Browse normally:")
    click.echo("  1. Search for a campground")
    click.echo("  2. Select dates and view available sites")
    click.echo("  3. Add a site to cart and go through checkout")
    click.echo("  4. Stop before entering payment")
    click.echo("\nAll API calls are recorded automatically.")
    click.echo("Press Enter here when you are done browsing...\n")

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=False)
        context = await browser.new_context()
        page = await context.new_page()

        response_bodies: dict[str, object] = {}

        async def on_response(response):
            if response.request.resource_type in ("xhr", "fetch"):
                try:
                    body = await response.json()
                except Exception:
                    try:
                        body = await response.text()
                    except Exception:
                        body = None
                response_bodies[response.url] = body

        page.on("response", on_response)

        page.on("request", lambda req: api_calls.append({
            "url": req.url,
            "method": req.method,
            "resource_type": req.resource_type,
            "headers": dict(req.headers),
            "post_data": req.post_data,
        }) if req.resource_type in ("xhr", "fetch") else None)

        await page.goto("https://camping.bcparks.ca")
        input()  # wait for user to finish browsing

        await context.close()
        await browser.close()

    # Merge response bodies into api_calls
    for call in api_calls:
        call["response"] = response_bodies.get(call["url"])

    # Write api-notes.md
    lines = ["# BC Parks API Notes\n\n",
             "_Generated by `campsite discover`. Edit to add implementation notes._\n\n"]
    for call in api_calls:
        lines.append(f"## {call['method']} {call['url']}\n\n")
        if call.get("post_data"):
            lines.append(f"**Request body:**\n```\n{call['post_data']}\n```\n\n")
        if call.get("response"):
            body = call["response"]
            formatted = json.dumps(body, indent=2) if isinstance(body, (dict, list)) else str(body)
            lines.append(f"**Response:**\n```json\n{formatted[:2000]}\n```\n\n")

    notes_path = docs / "api-notes.md"
    notes_path.write_text("".join(lines))
    click.echo(f"API notes saved to {notes_path}")

    # Phase 2: codegen for booking flow
    click.echo("\n=== Phase 2: Booking Flow Recording ===")
    click.echo("A new browser window will open.")
    click.echo("Go through the COMPLETE checkout including payment.")
    click.echo("Close the browser window when done.\n")

    flow_path = docs / "booking-flow.py"
    subprocess.run(
        ["playwright", "codegen", "--output", str(flow_path), "https://camping.bcparks.ca"],
        check=False,
    )
    click.echo(f"Booking flow saved to {flow_path}")
    click.echo("\nDiscovery complete. Review docs/api-notes.md and docs/booking-flow.py,")
    click.echo("then implement campsite/api.py and campsite/booker.py.")
```

- [ ] **Step 2: Verify the command appears**

```bash
campsite --help
```

Expected: `discover` appears in the command list

```bash
campsite discover --help
```

Expected: shows help text for the discover command

- [ ] **Step 3: Commit**

```bash
git add campsite/cli.py
git commit -m "feat: add campsite discover command for API and booking flow recording"
```

---

### Task 9: `campsite check` and `campsite config check` commands

**Files:**
- Modify: `campsite/cli.py`

- [ ] **Step 1: Add the `check` and `config check` commands to `campsite/cli.py`**

Add after the `discover` command definition:

```python
@cli.command()
@click.option("--file", "config_file", default="config.yaml", show_default=True,
              type=click.Path(exists=True), help="Path to config.yaml")
def check(config_file: str) -> None:
    """One-shot availability check across all configured campgrounds and dates. Does not book."""
    config = load_config(Path(config_file))
    asyncio.run(_run_check(config))


async def _run_check(config) -> None:
    from campsite.api import BCParksAPI
    from campsite.scanner import Scanner

    api = BCParksAPI()
    try:
        scanner = Scanner(config, api)
        match = await scanner.run_once()
        if match:
            click.echo(f"Available: {match.campground_id} | {match.check_in} → {match.check_out} | site {match.site_id}")
        else:
            click.echo("No availability found for your campgrounds and dates.")
    finally:
        await api.close()


@cli.group("config")
def config_group() -> None:
    """Config management commands."""
    pass


@config_group.command("check")
@click.option("--file", "config_file", default="config.yaml", show_default=True,
              type=click.Path(exists=True), help="Path to config.yaml")
def config_check(config_file: str) -> None:
    """Validate config.yaml without running the scanner."""
    try:
        load_config(Path(config_file))
        click.echo("Config is valid.")
    except Exception as e:
        click.echo(f"Config error: {e}", err=True)
        raise SystemExit(1)
```

- [ ] **Step 2: Verify commands appear**

```bash
campsite --help
campsite config --help
campsite config check --help
campsite check --help
```

Expected: all commands show without errors

- [ ] **Step 3: Test config check with the example config**

```bash
cp config.yaml.example config.yaml
campsite config check
```

Expected: `Config is valid.`

- [ ] **Step 4: Commit**

```bash
git add campsite/cli.py
git commit -m "feat: add campsite check and campsite config check commands"
```

---

### Task 10: Post-discovery — implement `api.py`

**Run `campsite discover` first.** Open `docs/api-notes.md` and find:
- The availability endpoint URL and query parameters
- Required headers (auth token, session cookie format)
- The response JSON structure — specifically which fields indicate walk-in vs drive-in, single vs double

**Files:**
- Modify: `campsite/api.py`

- [ ] **Step 1: Read `docs/api-notes.md` and identify the availability endpoint**

Look for a GET or POST request that:
- Is called after you select a campground and dates
- Returns a list of sites with availability information
- Contains fields for site type or site category

Note the exact URL pattern, required query parameters, and required headers.

- [ ] **Step 2: Implement `get_availability` in `campsite/api.py`**

Replace the `get_availability` method body with the real implementation. The structure will look like this (fill in the actual values from `docs/api-notes.md`):

```python
async def get_availability(
    self,
    campground_id: str,
    check_in: date,
    check_out: date,
) -> list[AvailableSite]:
    # Fill in from docs/api-notes.md:
    # - Replace ENDPOINT_URL with the actual URL
    # - Replace the params dict with the actual query parameters
    # - Replace the headers dict with required auth headers
    # - Replace the response parsing with the actual field names
    response = await self._client.get(
        "ENDPOINT_URL",  # e.g., "/api/availability/resources"
        params={
            "parkId": campground_id,
            "startDate": check_in.isoformat(),
            "endDate": check_out.isoformat(),
            # add other required params from api-notes.md
        },
        headers={
            # add required auth headers from api-notes.md
            # e.g., "Authorization": f"Bearer {self._token}"
        },
    )
    response.raise_for_status()
    data = response.json()

    # Parse the response into AvailableSite objects.
    # Field names below are placeholders — use the actual names from api-notes.md.
    sites = []
    for item in data:  # adjust if response is nested, e.g., data["availability"]
        sites.append(AvailableSite(
            site_id=str(item["siteId"]),       # actual field name from response
            campground_id=campground_id,
            is_walkin=item.get("walkIn", False),   # actual field name from response
            is_double=item.get("double", False),    # actual field name from response
            check_in=check_in,
            check_out=check_out,
        ))
    return sites
```

- [ ] **Step 3: Handle authentication**

If the API requires a bearer token or session cookie (common), add an `_authenticate` method and call it in `__init__` or lazily before the first request:

```python
async def _authenticate(self) -> None:
    # Fill in from docs/api-notes.md — look for the login POST request
    response = await self._client.post(
        "AUTH_ENDPOINT_URL",
        json={"email": "...", "password": "..."},
    )
    response.raise_for_status()
    token = response.json()["token"]  # actual field name from response
    self._client.headers["Authorization"] = f"Bearer {token}"
```

- [ ] **Step 4: Smoke test against the live site**

```bash
campsite check --file config.yaml
```

Expected: either lists available sites or prints "No availability found" — no exceptions.

- [ ] **Step 5: Commit**

```bash
git add campsite/api.py docs/api-notes.md
git commit -m "feat: implement BCParksAPI.get_availability from discovered endpoints"
```

---

### Task 11: Post-discovery — implement `booker.py`

**Run `campsite discover` first.** Open `docs/booking-flow.py` and study the recorded Playwright script. It contains the exact sequence of clicks, form fills, and navigations from your live session.

**Files:**
- Create: `campsite/booker.py`

- [ ] **Step 1: Read `docs/booking-flow.py` and identify the booking steps**

The file contains auto-generated Playwright code from your session. You need to translate it into a `book_site()` function that:
1. Uses site ID and dates from the `AvailableSite` argument (rather than hardcoded values)
2. Uses credentials and payment info from `AppConfig` (rather than hardcoded values)
3. Returns `True` on a confirmation page, `False` if the site was taken mid-flow

- [ ] **Step 2: Create `campsite/booker.py`**

```python
from __future__ import annotations
from playwright.async_api import async_playwright, Page
from campsite.models import AvailableSite, BookingResult
from campsite.config import AppConfig


async def book_site(site: AvailableSite, config: AppConfig) -> BookingResult:
    """
    Book the given site using the Playwright flow from docs/booking-flow.py.

    Returns BookingResult with success=True and confirmation_number on success.
    Returns BookingResult with success=False and error_message if the site was taken.
    """
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=False)
        page = await browser.new_page()
        try:
            return await _run_booking_flow(page, site, config)
        finally:
            await browser.close()


async def _run_booking_flow(page: Page, site: AvailableSite, config: AppConfig) -> BookingResult:
    creds = config.credentials
    payment = config.payment

    # ── Step 1: Log in ──────────────────────────────────────────────────────
    # Fill in from docs/booking-flow.py. Typically:
    #   await page.goto("https://camping.bcparks.ca/login")
    #   await page.fill("SELECTOR_EMAIL", creds.bcparks_email)
    #   await page.fill("SELECTOR_PASSWORD", creds.bcparks_password)
    #   await page.click("SELECTOR_LOGIN_BUTTON")

    # ── Step 2: Navigate to the site ─────────────────────────────────────────
    # Fill in from docs/booking-flow.py. The URL likely includes site_id and dates.
    #   await page.goto(f"https://camping.bcparks.ca/.../{site.site_id}?startDate={site.check_in}&endDate={site.check_out}")

    # ── Step 3: Add to cart ──────────────────────────────────────────────────
    # Fill in from docs/booking-flow.py.
    #   await page.click("SELECTOR_ADD_TO_CART")

    # ── Step 4: Fill party and vehicle info ──────────────────────────────────
    # Fill in from docs/booking-flow.py.
    #   await page.fill("SELECTOR_PARTY_SIZE", str(creds.party_size))
    #   await page.fill("SELECTOR_VEHICLE_PLATE", creds.vehicle_plate)

    # ── Step 5: Enter payment details ────────────────────────────────────────
    # Fill in from docs/booking-flow.py.
    #   await page.fill("SELECTOR_CARD_NUMBER", payment.card_number)
    #   await page.fill("SELECTOR_CARD_EXPIRY", payment.card_expiry)
    #   await page.fill("SELECTOR_CARD_CVV", payment.card_cvv)
    #   await page.fill("SELECTOR_NAME_ON_CARD", payment.name_on_card)

    # ── Step 6: Submit and check outcome ─────────────────────────────────────
    # Fill in from docs/booking-flow.py.
    #   await page.click("SELECTOR_SUBMIT_PAYMENT")
    #
    # Check for confirmation vs. error:
    #   if await page.query_selector("SELECTOR_CONFIRMATION_NUMBER"):
    #       number = await page.inner_text("SELECTOR_CONFIRMATION_NUMBER")
    #       return BookingResult(success=True, site=site, confirmation_number=number)
    #   elif await page.query_selector("SELECTOR_UNAVAILABLE_ERROR"):
    #       return BookingResult(success=False, site=site, error_message="Site no longer available")
    #   return BookingResult(success=False, site=site, error_message="Unknown booking failure")

    raise NotImplementedError(
        "Implement this function using the steps in docs/booking-flow.py.\n"
        "Replace the placeholder selectors with actual CSS/Playwright selectors."
    )
```

- [ ] **Step 3: Replace all placeholder selectors**

Go through `docs/booking-flow.py` line by line. For each `page.click`, `page.fill`, and `page.goto`, copy the actual selector or URL into the corresponding step in `_run_booking_flow`. Replace every `SELECTOR_*` and `URL_*` placeholder.

- [ ] **Step 4: Smoke test**

Run with `auto_book: false` in `config.yaml` first, then manually trigger the booker:

```python
# run this in a scratch script to test booking without the scanner
import asyncio
from datetime import date
from pathlib import Path
from campsite.config import load_config
from campsite.models import AvailableSite
from campsite.booker import book_site

config = load_config(Path("config.yaml"))
site = AvailableSite(
    site_id="REAL_SITE_ID",   # use a real site ID from campsite check
    campground_id="REAL_PARK_ID",
    is_walkin=False,
    is_double=False,
    check_in=date(2026, 7, 5),
    check_out=date(2026, 7, 6),
)
result = asyncio.run(book_site(site, config))
print(result)
```

- [ ] **Step 5: Commit**

```bash
git add campsite/booker.py
git commit -m "feat: implement book_site Playwright flow from recorded session"
```

---

### Task 12: `campsite scan` command (full auto-booking loop)

**Files:**
- Modify: `campsite/cli.py`

- [ ] **Step 1: Add the `scan` command to `campsite/cli.py`**

Add after the `check` command:

```python
@cli.command()
@click.option("--file", "config_file", default="config.yaml", show_default=True,
              type=click.Path(exists=True), help="Path to config.yaml")
def scan(config_file: str) -> None:
    """
    Start the polling loop. Scans for availability, books the first match, then stops.
    Runs until a campsite is successfully booked or you press Ctrl+C.
    """
    config = load_config(Path(config_file))
    asyncio.run(_run_scan(config))


async def _run_scan(config) -> None:
    from campsite.api import BCParksAPI
    from campsite.scanner import Scanner
    from campsite.booker import book_site
    from campsite.notifier import notify, NotificationEvent

    api = BCParksAPI()
    scanner = Scanner(config, api)

    click.echo(f"Scanning every {config.poll_interval_seconds}s. Press Ctrl+C to stop.")

    async def on_match(site) -> bool:
        notify(
            NotificationEvent(
                title="Campsite Available!",
                message=f"{site.campground_id} | {site.check_in} → {site.check_out} | site {site.site_id}",
            ),
            config.notifications,
        )
        if not config.auto_book:
            click.echo("auto_book is false — not booking. Continuing to scan.")
            return False

        click.echo("Attempting to book...")
        result = await book_site(site, config)

        if result.success:
            notify(
                NotificationEvent(
                    title="Booking Confirmed!",
                    message=f"Confirmation: {result.confirmation_number} | {site.check_in} → {site.check_out}",
                ),
                config.notifications,
            )
            return True
        elif result.error_message and "payment" in result.error_message.lower():
            # Payment failure: notify and pause — user must intervene
            notify(
                NotificationEvent(
                    title="Payment Failed — Action Required",
                    message=f"{result.error_message} — scanning paused. Restart campsite scan to resume.",
                ),
                config.notifications,
            )
            raise SystemExit(1)
        else:
            notify(
                NotificationEvent(
                    title="Booking Failed",
                    message=f"{result.error_message} — trying next campground",
                ),
                config.notifications,
            )
            return False

    try:
        await scanner.run_loop(on_match)
        click.echo("Done — campsite booked successfully.")
    except KeyboardInterrupt:
        click.echo("\nScan stopped.")
    finally:
        await api.close()
```

- [ ] **Step 2: Verify the scan command**

```bash
campsite scan --help
```

Expected: shows usage without errors

- [ ] **Step 3: End-to-end smoke test**

Set `auto_book: false` in `config.yaml` to safely test scanning without booking:

```bash
campsite scan --file config.yaml
```

Expected: polls every N seconds, prints "No availability found" or lists found sites, stops cleanly on Ctrl+C.

- [ ] **Step 4: Run the full test suite**

```bash
pytest -v
```

Expected: all tests pass

- [ ] **Step 5: Commit**

```bash
git add campsite/cli.py
git commit -m "feat: add campsite scan command wiring scanner, booker, and notifier"
```

---

## Implementation order summary

Tasks 1–9 can be completed fully right now. Tasks 10–12 require `campsite discover` to be run first:

1. Project setup → 2. Models → 3. Date parser → 4. Config → 5. Notifier → 6. API interface → 7. Scanner → 8. Discovery command → 9. check + config check
2. **Run `campsite discover`** (manual step — browse the site)
3. 10. API implementation → 11. Booker → 12. scan command
