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
