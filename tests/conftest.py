import pytest

from ai_chess_lab import retry


@pytest.fixture(autouse=True)
def no_retry_pauses(monkeypatch):
    monkeypatch.setattr(retry, "PAUSES", (0.0, 0.0, 0.0))
