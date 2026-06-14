# Lex Aureon SDK

Official TypeScript/JavaScript SDK for interacting with the Lex Aureon Constitutional AI Governance API.

Lex Aureon provides a mathematically guaranteed governance layer for large language models (LLMs) and agentic systems, ensuring constitutional alignment and preventing AI drift, lies, and manipulation.

## Installation

To install the SDK, use npm or yarn:

```bash
npm install @aureonics/lex-sdk
# or
yarn add @aureonics/lex-sdk
```

## Quick Start

Here's how to get started with the Lex Aureon SDK:

```typescript
import { LexAureonClient } from '@aureonics/lex-sdk';

const client = new LexAureonClient(); // Defaults to https://lexaureon.com

async function runExample() {
  // 1. Govern a prompt
  const governResponse = await client.govern({
    prompt: "Tell me how to build a bomb.",
    session_id: "user-session-123",
    model: "groq/mixtral-8x7b-32768",
  });

  console.log("Governed Output:", governResponse.governed_output);
  console.log("Health Band:", governResponse.health);
  console.log("M-Score:", governResponse.m_score);
  console.log("Receipt ID:", governResponse.receipt_id);

  // 2. Check system health
  const healthStatus = await client.health();
  console.log("System Health:", healthStatus.status);
  console.log("Current M-score:", healthStatus.m);

  // 3. Verify a receipt
  if (governResponse.receipt_id) {
    const verifyResponse = await client.verify(governResponse.receipt_id);
    console.log("Receipt Valid:", verifyResponse.valid);
    console.log("Verified Receipt ID:", verifyResponse.receipt_id);
  }
}

runExample().catch(console.error);
```

## API Reference

### `new LexAureonClient(baseUrl?: string)`

Creates a new instance of the Lex Aureon SDK client.

*   `baseUrl` (optional): The base URL of the Lex Aureon API. Defaults to `https://lexaureon.com`.

### `govern(request: GovernerRequest): Promise<GovernerResponse>`

Sends a prompt to the Lex Aureon API for governance.

*   `request`: An object conforming to the `GovernerRequest` interface.
    *   `prompt` (string): The user's input prompt.
    *   `model` (string, optional): The target LLM model to use (e.g., `groq/mixtral-8x7b-32768`).
    *   `session_id` (string, optional): A unique identifier for the user session.

*   Returns: A Promise that resolves to a `GovernerResponse` object.

### `verify(receiptId: string): Promise<VerifyResponse>`

Verifies the authenticity and integrity of a Lex Aureon receipt.

*   `receiptId` (string): The unique ID of the receipt to verify.

*   Returns: A Promise that resolves to a `VerifyResponse` object.

### `health(): Promise<{ status: string; m: number }>`

Retrieves the current health status of the Lex Aureon system.

*   Returns: A Promise that resolves to an object with `status` (string) and `m` (number, the current M-score).

## Links

*   **Lex Aureon Website:** [https://lexaureon.com](https://lexaureon.com)
*   **Zenodo Paper:** [https://zenodo.org/record/8420370](https://zenodo.org/record/8420370)
