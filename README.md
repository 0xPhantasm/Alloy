# VeiledChests

A provably fair on-chain chest guessing game built on Solana, using [Arcium](https://arcium.com/) multi-party computation (MPC) for trustless randomness and encrypted player inputs.

Players select a chest, place a bet, and submit their choice encrypted. The Arcium MPC network independently generates a random winning chest and compares it to the player's sealed choice -- neither the player nor the house can influence the outcome after commitment.

---

## Table of Contents

- [Architecture](#architecture)
- [How It Works](#how-it-works)
- [Project Structure](#project-structure)
- [Prerequisites](#prerequisites)
- [Setup](#setup)
- [Running Locally](#running-locally)
- [Testing](#testing)
- [Devnet Deployment](#devnet-deployment)
- [Configuration](#configuration)
- [Tech Stack](#tech-stack)
- [License](#license)

---

## Architecture

```
Player (Browser)                    Solana                         Arcium MPC Network
      |                               |                                   |
      |  1. Encrypt choice (x25519)   |                                   |
      |  2. Send tx: play_chest_game  |                                   |
      |------------------------------>|                                   |
      |                               |  3. Queue computation             |
      |                               |---------------------------------->|
      |                               |                                   |
      |                               |  4. MPC executes circuit:         |
      |                               |     - Decrypt player choice       |
      |                               |     - Generate random bits (RNG)  |
      |                               |     - Compute winning chest       |
      |                               |     - Compare and return result   |
      |                               |                                   |
      |                               |  5. Callback: play_chest_game_cb  |
      |                               |<----------------------------------|
      |                               |                                   |
      |  6. Poll game account status  |                                   |
      |<------------------------------|                                   |
      |  7. Parse result, show UI     |                                   |
```

The player's choice is never visible on-chain in plaintext. The winning chest is determined inside the MPC circuit using distributed random number generation across multiple nodes, making it impossible for any single party (including the house) to predict or manipulate the result.

---

## How It Works

1. **Stake Selection** -- The player chooses a bet amount (0.1 to 1.0 SOL) and the number of chests (2 to 5).

2. **Chest Selection** -- The player picks a chest. Their choice is encrypted client-side using x25519 key exchange with the MPC network's public key, then sealed with a Rescue cipher.

3. **Transaction Submission** -- The encrypted choice, encryption public key, and nonce are submitted on-chain via the `play_chest_game` instruction. The bet is transferred to the game PDA. The program queues an MPC computation on the Arcium network.

4. **MPC Execution** -- The Arcium MPC nodes jointly execute the `play_chest_game` circuit:
   - Decrypt the player's choice using threshold secret sharing.
   - Generate 3 random bits via `ArcisRNG::bool()` to produce a value in [0, 7].
   - Map to the valid chest range via modulo: `winning_chest = random_3bit % num_chests`.
   - Compare the player's choice to the winning chest.
   - Return `(player_won, winning_chest)` as revealed plaintext.

5. **Callback** -- The MPC network submits a callback transaction with a BLS-signed result. The program verifies the signature, settles the bet (pay out winnings from the treasury or transfer the bet to the treasury), and emits a `GameResultEvent`.

6. **Result** -- The frontend polls the game account for status changes, then parses the callback transaction logs and decoded Anchor events to display the outcome.

**Payout formula:** If the player wins, they receive `bet_amount * num_chests` (e.g., 0.5 SOL bet with 4 chests pays 2.0 SOL). The house edge is zero by construction -- the expected value equals the bet.

---

## Project Structure

```
.
├── programs/veiled_chests/       # Solana program (Anchor)
│   └── src/lib.rs                #   Game logic, MPC integration, callback handler
├── encrypted-ixs/                # Arcium MPC circuit (arcis DSL)
│   └── src/lib.rs                #   Encrypted instruction: RNG, comparison, reveal
├── build/                        # Compiled circuit binary (.arcis)
├── app/                          # Next.js frontend
│   └── src/
│       ├── components/
│       │   ├── ChestGame.tsx     #   Main game component (encryption, tx, polling)
│       │   └── WalletProvider.tsx #   Solana wallet adapter setup
│       ├── idl/                  #   Program IDL and TypeScript types
│       └── app/                  #   Next.js pages and layout
├── tests/                        # Integration tests (ts-mocha)
│   └── veiled_chests.ts          #   Full game lifecycle test
├── scripts/                      # Deployment utilities
│   ├── init-comp-def.ts          #   Initialize computation definition on devnet
│   └── upload-circuit-supabase.ts#   Upload circuit binary for off-chain source
├── Anchor.toml                   # Anchor workspace configuration
├── Arcium.toml                   # Arcium localnet and cluster configuration
├── Cargo.toml                    # Rust workspace (program + circuit)
└── package.json                  # Root JS dependencies (Anchor, Arcium client)
```

---

## Prerequisites

- [Rust](https://rustup.rs/) (1.89.0 via `rust-toolchain.toml`)
- [Solana CLI](https://docs.solanalabs.com/cli/install) (v2.x)
- [Anchor CLI](https://www.anchor-lang.com/docs/installation) (0.32.x)
- [Arcium CLI](https://docs.arcium.com/) (0.8.x)
- [Node.js](https://nodejs.org/) (18+)
- [Yarn](https://yarnpkg.com/) (1.x, used by Anchor)
- [Docker](https://www.docker.com/) (required for Arcium localnet MPC nodes)

---

## Setup

```bash
# Clone the repository
git clone https://github.com/0xPhantasm/Alloy.git
cd Alloy

# Install JavaScript dependencies
yarn install

# Install frontend dependencies
cd app && yarn install && cd ..

# Verify toolchains
solana --version
anchor --version
arcium --version
```

Generate a local Solana keypair if you do not have one:

```bash
solana-keygen new --no-bip39-passphrase
```

---

## Running Locally

Arcium localnet requires Docker for running MPC nodes. The localnet provisions a local Solana validator with all necessary Arcium accounts (MXE, cluster, fee pool, etc.) pre-loaded as genesis accounts.

### Start localnet

```bash
arcium localnet
```

This starts: a Solana test validator with the program and Arcium accounts, a Docker Compose environment with 2 MXE ARX nodes, and performs keygen so the MPC network is ready to process computations.

Wait until you see the localnet is ready (typically 30-60 seconds for keygen).

### Start the frontend

In a separate terminal:

```bash
cd app
yarn dev
```

The app defaults to `http://127.0.0.1:8899` for the Solana RPC endpoint. If running in GitHub Codespaces, configure port-forwarded URLs in `app/.env.local`:

```env
NEXT_PUBLIC_ARCIUM_CLUSTER_OFFSET=0
NEXT_PUBLIC_RPC_URL=https://<codespace>-8899.app.github.dev
NEXT_PUBLIC_WS_RPC_URL=wss://<codespace>-8899.app.github.dev
```

### Initialize on-chain state

Before the first game, initialize the computation definition and treasury. The integration test does this automatically, or you can do it manually via `arcium test`.

---

## Testing

The integration test suite covers the full game lifecycle: computation definition initialization, treasury setup, funding, game play, MPC finalization, and result verification.

```bash
arcium test
```

This will:
1. Clean and rebuild the circuit and program.
2. Start a fresh localnet with genesis accounts.
3. Run the test suite via `ts-mocha`.

Tests are located in [tests/veiled_chests.ts](tests/veiled_chests.ts). The test:
- Waits for MXE keygen to complete (up to 60 seconds).
- Initializes the `play_chest_game` computation definition and finalizes it.
- Initializes and funds the treasury with 10 SOL.
- Encrypts a player choice, submits the game transaction, and waits for MPC finalization.
- Asserts the `GameResultEvent` payout matches the expected formula.

Note: On localnet, the MPC nodes use a fixed RNG seed, so the winning chest is deterministic across runs. This is expected behavior -- true randomness is a property of the distributed network on devnet and mainnet.

---

## Devnet Deployment

1. **Configure Solana CLI for devnet:**

   ```bash
   solana config set --url https://api.devnet.solana.com
   ```

2. **Update `Anchor.toml`** -- set the cluster to `devnet` and ensure the program ID under `[programs.devnet]` matches your deployed program.

3. **Build and deploy the program:**

   ```bash
   arcium build
   anchor build
   anchor deploy --provider.cluster devnet
   ```

4. **Upload the circuit** (required for off-chain circuit source on devnet):

   ```bash
   # Upload to your preferred hosting. The program expects a raw GitHub URL.
   # Then update the CircuitSource::OffChain URL in programs/veiled_chests/src/lib.rs
   ```

5. **Initialize the computation definition on devnet:**

   ```bash
   npx ts-node scripts/init-comp-def.ts
   ```

6. **Update the frontend IDL:**

   ```bash
   cp target/idl/veiled_chests.json app/src/idl/veiled_chests.json
   cp target/types/veiled_chests.ts app/src/idl/veiled_chests.ts
   ```

7. **Set frontend environment variables** in `app/.env.local`:

   ```env
   NEXT_PUBLIC_ARCIUM_CLUSTER_OFFSET=456
   NEXT_PUBLIC_RPC_URL=https://api.devnet.solana.com
   ```

---

## Configuration

### Arcium.toml

| Key | Description |
|-----|-------------|
| `localnet.nodes` | Number of MPC nodes in the local cluster (default: 2) |
| `localnet.localnet_timeout_secs` | Timeout waiting for localnet startup (default: 60) |
| `localnet.backends` | MPC backend type: `"Cerberus"` or `"Manticore"` |
| `clusters.devnet.offset` | Cluster offset for devnet deployment |

### Environment Variables (Frontend)

| Variable | Description | Default |
|----------|-------------|---------|
| `NEXT_PUBLIC_ARCIUM_CLUSTER_OFFSET` | Arcium cluster offset (0 for localnet) | `456` |
| `NEXT_PUBLIC_RPC_URL` | Solana RPC endpoint | `http://127.0.0.1:8899` |
| `NEXT_PUBLIC_WS_RPC_URL` | Solana WebSocket endpoint | `ws://127.0.0.1:8900` |

### Game Parameters

| Parameter | Range | Description |
|-----------|-------|-------------|
| Bet amount | 0.01 - 1.0 SOL | Player's wager |
| Number of chests | 2 - 5 | Determines payout multiplier and win probability |
| Payout multiplier | Equal to chest count | e.g., 3 chests = 3x payout on win |

---

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Smart contract framework | Anchor 0.32.1 |
| Blockchain | Solana |
| MPC framework | Arcium 0.8.0 (arcis DSL, Cerberus backend) |
| Encryption | x25519 key exchange + Rescue cipher |
| Circuit RNG | `ArcisRNG::bool()` (threshold distributed randomness) |
| Frontend | Next.js 16, React 19, Tailwind CSS |
| Wallet integration | Solana Wallet Adapter |
| Language (on-chain) | Rust |
| Language (frontend) | TypeScript |
| Testing | ts-mocha, Chai |

---

## License

ISC