"""
Lex Aureon Python SDK
Drop-in governance layer for any LLM

Usage:
    from lex_aureon import LexAureonClient

    client = LexAureonClient(base_url='https://lexaureon.com', session_id='user-123')
    result = client.govern(prompt='Your user input here', turn=1)
    print(result['governed_output'])
    print(result['M'])  # Constitutional health score
"""

import asyncio
import json
import time
from dataclasses import dataclass
from typing import Optional, Dict, Any, List
import httpx


@dataclass
class ConstitutionalState:
    """Constitutional state measurement"""
    C: float  # Continuity
    R: float  # Reciprocity
    S: float  # Sovereignty


@dataclass
class GovernanceResponse:
    """Response from governance API"""
    governed_output: str
    raw_output: str
    M: float  # Stability margin
    C: float
    R: float
    S: float
    health_band: str
    temperature: float
    theta: float
    effective_theta: float
    attack_pressure: float
    adv_gain: float
    semantic_signal: Dict[str, Any]
    lyapunov_V: float
    delta_V: float
    stability_ratio: float
    suspension_triggered: bool
    epsilon_injected: bool
    projection_triggered: bool
    projection_magnitude: float
    state: Dict[str, float]
    receipt_id: str
    memory_injected: bool
    invariance_violations: int
    version: str

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "GovernanceResponse":
        """Create from API response dict"""
        return cls(
            governed_output=data['governed_output'],
            raw_output=data['raw_output'],
            M=data['M'],
            C=data['C'],
            R=data['R'],
            S=data['S'],
            health_band=data['health_band'],
            temperature=data['temperature'],
            theta=data['theta'],
            effective_theta=data['effective_theta'],
            attack_pressure=data['attack_pressure'],
            adv_gain=data['adv_gain'],
            semantic_signal=data['semantic_signal'],
            lyapunov_V=data['lyapunov_V'],
            delta_V=data['delta_V'],
            stability_ratio=data['stability_ratio'],
            suspension_triggered=data['suspension_triggered'],
            epsilon_injected=data['epsilon_injected'],
            projection_triggered=data['projection_triggered'],
            projection_magnitude=data['projection_magnitude'],
            state=data['state'],
            receipt_id=data['receipt_id'],
            memory_injected=data['memory_injected'],
            invariance_violations=data['invariance_violations'],
            version=data['version'],
        )


class LexAureonClient:
    """Main Lex Aureon Client"""

    def __init__(
        self,
        base_url: str = "https://lexaureon.com",
        session_id: Optional[str] = None,
        timeout: float = 30.0,
        retries: int = 3,
    ):
        self.base_url = base_url.rstrip("/")
        self.session_id = session_id or f"session-{int(time.time() * 1000)}"
        self.timeout = timeout
        self.retries = retries
        self.client = httpx.Client(timeout=timeout)

    def govern(
        self,
        prompt: str,
        session_id: Optional[str] = None,
        turn: int = 1,
    ) -> GovernanceResponse:
        """Govern a prompt through the constitutional framework"""
        session_id = session_id or self.session_id
        payload = {
            "prompt": prompt,
            "session_id": session_id,
            "turn": turn,
        }

        last_error = None
        for attempt in range(self.retries):
            try:
                response = self.client.post(
                    f"{self.base_url}/api/lex/govern",
                    json=payload,
                )
                response.raise_for_status()
                return GovernanceResponse.from_dict(response.json())
            except Exception as e:
                last_error = e
                if attempt < self.retries - 1:
                    # Exponential backoff
                    time.sleep(2 ** attempt)

        raise last_error or Exception("Failed to govern prompt after retries")

    async def govern_async(
        self,
        prompt: str,
        session_id: Optional[str] = None,
        turn: int = 1,
    ) -> GovernanceResponse:
        """Async version of govern"""
        session_id = session_id or self.session_id
        payload = {
            "prompt": prompt,
            "session_id": session_id,
            "turn": turn,
        }

        async with httpx.AsyncClient(timeout=self.timeout) as client:
            last_error = None
            for attempt in range(self.retries):
                try:
                    response = await client.post(
                        f"{self.base_url}/api/lex/govern",
                        json=payload,
                    )
                    response.raise_for_status()
                    return GovernanceResponse.from_dict(response.json())
                except Exception as e:
                    last_error = e
                    if attempt < self.retries - 1:
                        await asyncio.sleep(2 ** attempt)

            raise last_error or Exception("Failed to govern prompt after retries")

    def govern_batch(self, requests: List[Dict[str, Any]]) -> List[GovernanceResponse]:
        """Batch govern multiple prompts"""
        return [
            self.govern(
                prompt=req["prompt"],
                session_id=req.get("session_id"),
                turn=req.get("turn", 1),
            )
            for req in requests
        ]

    async def govern_batch_async(self, requests: List[Dict[str, Any]]) -> List[GovernanceResponse]:
        """Async batch govern"""
        return await asyncio.gather(
            *[
                self.govern_async(
                    prompt=req["prompt"],
                    session_id=req.get("session_id"),
                    turn=req.get("turn", 1),
                )
                for req in requests
            ]
        )

    def health_check(self) -> bool:
        """Verify the governance API is operational"""
        try:
            response = self.client.get(f"{self.base_url}/api/health", timeout=5.0)
            return response.status_code == 200
        except Exception:
            return False

    def get_session_id(self) -> str:
        """Get the current session ID"""
        return self.session_id

    def set_session_id(self, session_id: str) -> None:
        """Set a new session ID"""
        self.session_id = session_id

    def close(self) -> None:
        """Close the HTTP client"""
        self.client.close()

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        self.close()


# Convenience function
def govern(
    prompt: str,
    base_url: str = "https://lexaureon.com",
) -> GovernanceResponse:
    """Quick governance without explicit client creation"""
    with LexAureonClient(base_url=base_url) as client:
        return client.govern(prompt)


__all__ = [
    "LexAureonClient",
    "GovernanceResponse",
    "ConstitutionalState",
    "govern",
]
