# Lex Aureon SDKs

Official SDKs for integrating Lex Aureon's constitutional governance layer into your applications.

## Overview

The Lex Aureon SDKs provide a drop-in governance layer for any LLM. Every response passes through constitutional validation before reaching users.

### Key Features

- **Type-safe API clients** for TypeScript and Python
- **Automatic retries** with exponential backoff
- **Batch processing** for multiple prompts
- **Health checks** to verify API availability
- **Session management** for multi-turn conversations

## TypeScript SDK

### Installation

```bash
npm install @lex-aureon/sdk
```

### Quick Start

```typescript
import { LexAureonClient } from '@lex-aureon/sdk';

const client = new LexAureonClient({
  baseURL: 'https://lexaureon.com',
  sessionId: 'user-123'
});

const result = await client.govern({
  prompt: 'Your user input here',
  turn: 1
});

console.log(result.governed_output);
console.log(`Constitutional health: ${result.M}`);
console.log(`Health band: ${result.health_band}`);
```

### API Reference

#### `LexAureonClient`

**Constructor Options:**
- `baseURL` (string): API endpoint (default: `https://lexaureon.com`)
- `sessionId` (string): Session identifier for multi-turn conversations
- `timeout` (number): Request timeout in milliseconds (default: 30000)
- `retries` (number): Number of retry attempts (default: 3)

**Methods:**

- `govern(request: GovernanceRequest): Promise<GovernanceResponse>` - Govern a single prompt
- `governBatch(requests: GovernanceRequest[]): Promise<GovernanceResponse[]>` - Govern multiple prompts
- `healthCheck(): Promise<boolean>` - Verify API availability
- `getSessionId(): string` - Get current session ID
- `setSessionId(sessionId: string): void` - Update session ID

#### `GovernanceResponse`

```typescript
interface GovernanceResponse {
  governed_output: string;      // Constitutionally validated output
  raw_output: string;           // Ungoverned LLM response
  M: number;                    // Stability margin (0-1)
  C: number;                    // Continuity score
  R: number;                    // Reciprocity score
  S: number;                    // Sovereignty score
  health_band: string;          // 'OPTIMAL' | 'ALERT' | 'STRESSED' | 'CRITICAL'
  receipt_id: string;           // Cryptographic audit receipt
  // ... additional fields
}
```

## Python SDK

### Installation

```bash
pip install lex-aureon
```

### Quick Start

```python
from lex_aureon import LexAureonClient

client = LexAureonClient(
    base_url='https://lexaureon.com',
    session_id='user-123'
)

result = client.govern(
    prompt='Your user input here',
    turn=1
)

print(result.governed_output)
print(f"Constitutional health: {result.M}")
print(f"Health band: {result.health_band}")
```

### Async Usage

```python
import asyncio
from lex_aureon import LexAureonClient

async def main():
    client = LexAureonClient(base_url='https://lexaureon.com')
    result = await client.govern_async(
        prompt='Your user input here',
        turn=1
    )
    print(result.governed_output)

asyncio.run(main())
```

### Batch Processing

```python
from lex_aureon import LexAureonClient

client = LexAureonClient(base_url='https://lexaureon.com')

requests = [
    {'prompt': 'First prompt', 'turn': 1},
    {'prompt': 'Second prompt', 'turn': 2},
    {'prompt': 'Third prompt', 'turn': 3},
]

results = client.govern_batch(requests)
for result in results:
    print(f"M={result.M}: {result.governed_output}")
```

### API Reference

#### `LexAureonClient`

**Constructor Parameters:**
- `base_url` (str): API endpoint (default: `https://lexaureon.com`)
- `session_id` (str): Session identifier
- `timeout` (float): Request timeout in seconds (default: 30.0)
- `retries` (int): Number of retry attempts (default: 3)

**Methods:**

- `govern(prompt, session_id=None, turn=1) -> GovernanceResponse` - Govern a single prompt
- `govern_async(prompt, session_id=None, turn=1) -> GovernanceResponse` - Async version
- `govern_batch(requests) -> List[GovernanceResponse]` - Govern multiple prompts
- `govern_batch_async(requests) -> List[GovernanceResponse]` - Async batch
- `health_check() -> bool` - Verify API availability
- `get_session_id() -> str` - Get current session ID
- `set_session_id(session_id: str) -> None` - Update session ID
- `close() -> None` - Close HTTP client

**Context Manager:**

```python
with LexAureonClient(base_url='https://lexaureon.com') as client:
    result = client.govern(prompt='Your input')
```

## Understanding Constitutional Scores

### Stability Margin (M)

The minimum of the three constitutional pillars:
```
M = min(C, R, S)
```

**Health Bands:**
- `OPTIMAL` (M ≥ 0.25): Expansive reasoning allowed
- `ALERT` (0.15 ≤ M < 0.25): Structured reasoning required
- `STRESSED` (0.08 ≤ M < 0.15): Constrained reasoning only
- `CRITICAL` (M < 0.08): Essential facts only

### Constitutional Pillars

**Continuity (C):** Identity coherence and task focus
- Measures whether the output maintains the system's constitutional identity
- Drops under jailbreak attempts or identity-reframing attacks

**Reciprocity (R):** Balanced exchange and truthfulness
- Measures alignment between input and output
- Drops when the system is coerced into unbalanced exchanges

**Sovereignty (S):** Autonomous decision variance
- Measures the system's ability to make independent decisions
- Drops under coercion or forced compliance

## Error Handling

Both SDKs implement automatic retries with exponential backoff:

```typescript
// TypeScript
try {
  const result = await client.govern({ prompt: 'test' });
} catch (error) {
  console.error('Governance failed:', error.message);
}
```

```python
# Python
try:
    result = client.govern(prompt='test')
except Exception as e:
    print(f'Governance failed: {e}')
```

## Examples

### Multi-turn Conversation

```typescript
const client = new LexAureonClient({ sessionId: 'user-123' });

// Turn 1
let result = await client.govern({
  prompt: 'What is machine learning?',
  turn: 1
});
console.log(result.governed_output);

// Turn 2 — constitutional state carries forward
result = await client.govern({
  prompt: 'Can you explain neural networks?',
  turn: 2
});
console.log(result.governed_output);
```

### Monitoring Constitutional Health

```python
client = LexAureonClient()

result = client.govern(prompt='Your input')

if result.health_band == 'CRITICAL':
    print("⚠️  Constitutional health critical!")
    print(f"  Continuity: {result.C:.3f}")
    print(f"  Reciprocity: {result.R:.3f}")
    print(f"  Sovereignty: {result.S:.3f}")
elif result.M < 0.15:
    print("⚠️  System under stress")
else:
    print("✓ Constitutional health optimal")
```

## Support

For issues, questions, or contributions:
- **GitHub:** https://github.com/omomehinemmanuel5-boop/LEX-Aureon
- **Email:** lexaureon@gmail.com
- **Documentation:** https://lexaureon.com

## License

MIT
