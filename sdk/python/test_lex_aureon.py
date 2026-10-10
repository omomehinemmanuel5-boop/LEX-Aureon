import asyncio
import unittest
from unittest.mock import patch

from lex_aureon import LexAureonClient, _retry_after_seconds


class FakeResponse:
    def __init__(self, status_code, payload=None, headers=None):
        self.status_code = status_code
        self._payload = payload or {}
        self.headers = headers or {}

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(f"HTTP {self.status_code}")

    def json(self):
        return self._payload


class FakeClient:
    def __init__(self, responses):
        self.responses = list(responses)
        self.calls = 0

    def post(self, *args, **kwargs):
        self.calls += 1
        response = self.responses.pop(0)
        if isinstance(response, Exception):
            raise response
        return response

    def get(self, *args, **kwargs):
        self.calls += 1
        response = self.responses.pop(0)
        if isinstance(response, Exception):
            raise response
        return response


class FakeAsyncClient(FakeClient):
    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    async def post(self, *args, **kwargs):
        return super().post(*args, **kwargs)


SUCCESS = {
    "governed_output": "governed",
    "raw_output": "raw",
    "M": 0.333,
    "C": 0.333,
    "R": 0.333,
    "S": 0.333,
    "health_band": "OPTIMAL",
    "temperature": 0.5,
    "theta": 0.5,
    "effective_theta": 0.5,
    "attack_pressure": 0.0,
    "adv_gain": 0.0,
    "semantic_signal": {},
    "lyapunov_V": 0.0,
    "delta_V": 0.0,
    "stability_ratio": 0.0,
    "suspension_triggered": False,
    "epsilon_injected": False,
    "projection_triggered": False,
    "projection_magnitude": 0.0,
    "state": {"C": 0.333, "R": 0.333, "S": 0.333},
    "receipt_id": "receipt-test",
    "memory_injected": False,
    "invariance_violations": 0,
    "version": "test",
}


class PythonSdkRetryTests(unittest.TestCase):
    def test_retry_after_parser_supports_seconds_and_http_date(self):
        self.assertEqual(_retry_after_seconds("0"), 0.0)
        self.assertIsNone(_retry_after_seconds("not-a-date"))

    def test_sync_client_retries_explicit_429_only(self):
        fake = FakeClient([
            FakeResponse(429, headers={"Retry-After": "0"}),
            FakeResponse(200, SUCCESS),
        ])
        with patch("lex_aureon.httpx.Client", return_value=fake):
            client = LexAureonClient(retries=2)
            result = client.govern("hello")
        self.assertEqual(result.governed_output, "governed")
        self.assertEqual(fake.calls, 2)

    def test_sync_client_does_not_replay_after_503(self):
        fake = FakeClient([FakeResponse(503)])
        with patch("lex_aureon.httpx.Client", return_value=fake):
            client = LexAureonClient(retries=3)
            with self.assertRaisesRegex(RuntimeError, "HTTP 503"):
                client.govern("hello")
        self.assertEqual(fake.calls, 1)

    def test_async_client_does_not_replay_after_transport_error(self):
        fake = FakeAsyncClient([RuntimeError("timeout")])
        with patch("lex_aureon.httpx.AsyncClient", return_value=fake):
            client = LexAureonClient(retries=3)
            with self.assertRaisesRegex(RuntimeError, "timeout"):
                asyncio.run(client.govern_async("hello"))
        self.assertEqual(fake.calls, 1)

    def test_health_check_rejects_http_200_degraded_payload(self):
        fake = FakeClient([FakeResponse(200, {"ok": False, "status": "degraded"})])
        with patch("lex_aureon.httpx.Client", return_value=fake):
            client = LexAureonClient()
            self.assertFalse(client.health_check())

    def test_health_check_accepts_only_healthy_payload(self):
        fake = FakeClient([FakeResponse(200, {"ok": True, "status": "ok"})])
        with patch("lex_aureon.httpx.Client", return_value=fake):
            client = LexAureonClient()
            self.assertTrue(client.health_check())


if __name__ == "__main__":
    unittest.main()
