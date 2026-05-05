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
