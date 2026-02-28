"use client";

import { FC, useState, useCallback, useEffect } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { PublicKey, SystemProgram, LAMPORTS_PER_SOL, ComputeBudgetProgram, Transaction } from "@solana/web3.js";
import { Program, AnchorProvider, BN } from "@coral-xyz/anchor";
import * as anchor from "@coral-xyz/anchor";
import { x25519 } from "@noble/curves/ed25519";
import IDL from "@/idl/veiled_chests.json";
import type { VeiledChests } from "@/idl/veiled_chests";

// Constants - Program ID derived from IDL
const PROGRAM_ID = new PublicKey(IDL.address);
const CLUSTER_OFFSET = parseInt(process.env.NEXT_PUBLIC_ARCIUM_CLUSTER_OFFSET || "456");
const TREASURY_SEED = Buffer.from("treasury");
const GAME_SEED = Buffer.from("game");
const SIGN_PDA_SEED = Buffer.from("ArciumSignerAccount");

// Bet options in SOL
const BET_OPTIONS = [0.1, 0.3, 0.5, 0.7, 1.0];
const CHEST_OPTIONS = [2, 3, 4, 5];

interface GameResult {
  playerWon: boolean;
  winningChest: number;
  payout: number;
}

export const ChestGame: FC = () => {
  const { connection } = useConnection();
  const wallet = useWallet();

  const [gameStep, setGameStep] = useState<'hero' | 'stake' | 'select' | 'reveal' | 'result'>('hero');
  const [numChests, setNumChests] = useState(3);
  const [selectedChest, setSelectedChest] = useState<number | null>(null);
  const [betAmount, setBetAmount] = useState(0.1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [gameResult, setGameResult] = useState<GameResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [txSignature, setTxSignature] = useState<string | null>(null);
  const [solBalance, setSolBalance] = useState<number | null>(null);

  useEffect(() => {
    if (!wallet.publicKey) { setSolBalance(null); return; }
    let subscriptionId: number | null = null;
    const fetchBalance = async () => {
      const lamports = await connection.getBalance(wallet.publicKey!);
      setSolBalance(lamports / LAMPORTS_PER_SOL);
    };
    fetchBalance();
    subscriptionId = connection.onAccountChange(wallet.publicKey, (info) => {
      setSolBalance(info.lamports / LAMPORTS_PER_SOL);
    });
    return () => {
      if (subscriptionId !== null) connection.removeAccountChangeListener(subscriptionId);
    };
  }, [wallet.publicKey, connection]);

  // Auto-advance from reveal animation to result screen
  useEffect(() => {
    if (gameStep !== 'reveal') return;
    const t = setTimeout(() => setGameStep('result'), 3800);
    return () => clearTimeout(t);
  }, [gameStep]);

  const getProvider = useCallback(() => {
    if (!wallet.publicKey || !wallet.signTransaction || !wallet.signAllTransactions) {
      throw new Error("Wallet not connected");
    }
    return new AnchorProvider(
      connection,
      {
        publicKey: wallet.publicKey,
        signTransaction: wallet.signTransaction,
        signAllTransactions: wallet.signAllTransactions,
      },
      { commitment: "confirmed" }
    );
  }, [connection, wallet]);

  const playGame = useCallback(async () => {
    if (!wallet.publicKey || selectedChest === null) {
      setError("Please connect wallet and select a chest");
      return;
    }

    setIsPlaying(true);
    setError(null);
    setGameResult(null);
    setTxSignature(null);

    try {
      // Dynamically import arcium client to avoid SSR issues
      const arcium = await import("@arcium-hq/client");
      const {
        RescueCipher,
        getClusterAccAddress,
        getMXEAccAddress,
        getMempoolAccAddress,
        getExecutingPoolAccAddress,
        getComputationAccAddress,
        getCompDefAccAddress,
        getCompDefAccOffset,
        getMXEPublicKey,
        getArciumProgramId,
        getFeePoolAccAddress,
        getClockAccAddress,
        deserializeLE,
      } = arcium;

      const provider = getProvider();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const program = new Program<VeiledChests>(IDL as any, provider);

      // Helper: cancel stale pending game (pending >60s)
      const cancelStaleGameIfAny = async () => {
        const [gamePda] = PublicKey.findProgramAddressSync(
          [GAME_SEED, wallet.publicKey!.toBuffer()],
          PROGRAM_ID
        );
        try {
          const game = await program.account.gameAccount.fetchNullable(gamePda);
          if (!game) return false;
          const status = game.status as number; // 0 None, 1 Pending, 2 Completed, 3 Cancelled
          if (status !== 1) return false;
          const createdAt = Number(game.createdAt);
          const now = Math.floor(Date.now() / 1000);
          if (now - createdAt <= 60) return false; // not timed out yet

          console.log("Cancelling stale pending game...", gamePda.toBase58());
          const cancelTx = await program.methods
            .cancelGame()
            .accountsPartial({ player: wallet.publicKey!, gameAccount: gamePda })
            .rpc();
          console.log("Cancelled stale game:", cancelTx);
          return true;
        } catch (e) {
          console.warn("Cancel check/attempt failed:", e);
          return false;
        }
      };

      // Get MXE public key for encryption (may take time on devnet as keygen needs to complete)
      console.log("Fetching MXE public key for program:", PROGRAM_ID.toBase58());
      let mxePubkey = await getMXEPublicKey(provider, PROGRAM_ID);
      console.log("MXE public key fetched:", mxePubkey ? Array.from(mxePubkey) : "null");
      if (!mxePubkey) {
        throw new Error(
          "MXE public key not available yet. The Arcium network is still processing keygen for this MXE. " +
          "This can take several minutes on devnet. Please try again later."
        );
      }

      // Generate client keypair and compute shared secret using x25519
      const privateKey = x25519.utils.randomPrivateKey();
      const clientPubkey = x25519.getPublicKey(privateKey);
      const sharedSecret = x25519.getSharedSecret(privateKey, mxePubkey);
      
      // Create cipher with shared secret
      const cipher = new RescueCipher(sharedSecret);
      
      // Generate nonce and encrypt
      const nonce = crypto.getRandomValues(new Uint8Array(16));
      const ciphertext = cipher.encrypt([BigInt(selectedChest)], nonce);
      
      // The ciphertext[0] is already in the correct format for [u8; 32]
      // Use Array.from() as shown in Arcium examples
      console.log("Player choice (plaintext):", selectedChest);
      console.log("Encrypted choice:", ciphertext[0]);

      // Generate computation offset (use random bytes like the examples)
      const computationOffset = new BN(Date.now());

      // Derive PDAs
      const [treasuryPda] = PublicKey.findProgramAddressSync(
        [TREASURY_SEED],
        PROGRAM_ID
      );
      const [gamePda] = PublicKey.findProgramAddressSync(
        [GAME_SEED, wallet.publicKey.toBuffer()],
        PROGRAM_ID
      );
      const [signPda] = PublicKey.findProgramAddressSync(
        [SIGN_PDA_SEED],
        PROGRAM_ID
      );

      const compDefOffset = Buffer.from(getCompDefAccOffset("play_chest_game")).readUInt32LE();
      const mxeAccount = getMXEAccAddress(PROGRAM_ID);

      // Deserialize nonce to BigInt for the transaction
      const nonceValue = deserializeLE(nonce);
      console.log("Nonce value:", nonceValue.toString());

      // Build transaction
      const txBuilder = program.methods
        .playChestGame(
          computationOffset,
          numChests,
          new BN(betAmount * LAMPORTS_PER_SOL),
          Array.from(ciphertext[0]) as any,  // Encrypted player choice
          Array.from(clientPubkey) as any,
          new BN(nonceValue.toString())
        )
        .accountsPartial({
          player: wallet.publicKey!,
          gameAccount: gamePda,
          treasury: treasuryPda,
          signPdaAccount: signPda,
          mxeAccount: mxeAccount,
          mempoolAccount: getMempoolAccAddress(CLUSTER_OFFSET),
          executingPool: getExecutingPoolAccAddress(CLUSTER_OFFSET),
          computationAccount: getComputationAccAddress(
            CLUSTER_OFFSET,
            computationOffset
          ),
          compDefAccount: getCompDefAccAddress(PROGRAM_ID, compDefOffset),
          clusterAccount: getClusterAccAddress(CLUSTER_OFFSET),
          poolAccount: getFeePoolAccAddress(),
          clockAccount: getClockAccAddress(),
          systemProgram: SystemProgram.programId,
          arciumProgram: getArciumProgramId(),
        });
      
      // Log the transaction for debugging
      const txInstr = await txBuilder.instruction();
      console.log("Transaction instruction keys:", txInstr.keys.map(k => ({ pubkey: k.pubkey.toBase58(), isSigner: k.isSigner, isWritable: k.isWritable })));
      console.log("Program ID in instruction:", txInstr.programId.toBase58());
      
      // Build transaction with priority fees for better landing rate on devnet
      const priorityFeeIx = ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 200000 });
      const computeUnitsIx = ComputeBudgetProgram.setComputeUnitLimit({ units: 400000 });
      
      // Retry blockhash fetch (Codespaces port forwarding can drop connections)
      let blockhash: string;
      let lastValidBlockHeight: number;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const result = await connection.getLatestBlockhash("confirmed");
          blockhash = result.blockhash;
          lastValidBlockHeight = result.lastValidBlockHeight;
          break;
        } catch (fetchErr) {
          if (attempt === 3) throw fetchErr;
          console.warn(`Blockhash fetch attempt ${attempt} failed, retrying...`);
          await new Promise(r => setTimeout(r, 1000));
        }
      }
      
      const builtTx = new Transaction({
        blockhash: blockhash!,
        lastValidBlockHeight: lastValidBlockHeight!,
        feePayer: wallet.publicKey!,
      });
      
      builtTx.add(priorityFeeIx, computeUnitsIx, txInstr);
      
      // Simulate with auto-retry for transient errors (RPC lag / Arcium slot issues).
      // 6004 = GameAlreadyActive (game PDA status lag), 6603 = InvalidSlot (Arcium clock lag)
      const RETRYABLE_CODES = new Set([6004, 6603]);
      const MAX_SIM_RETRIES = 5;
      const SIM_RETRY_DELAY = 2500; // ms

      for (let simRetry = 1; simRetry <= MAX_SIM_RETRIES; simRetry++) {
        const simResult = await connection.simulateTransaction(builtTx);
        console.log(`Simulation attempt ${simRetry}/${MAX_SIM_RETRIES}:`, simResult.value.err ?? "OK");

        if (!simResult.value.err) {
          console.log("Simulation passed! Sending transaction...");
          break;
        }

        const errObj = simResult.value.err as { InstructionError?: [number, { Custom: number }] } | null;
        const customCode = errObj?.InstructionError?.[1] && (errObj.InstructionError[1] as any).Custom;

        if (customCode !== undefined && RETRYABLE_CODES.has(customCode)) {
          if (simRetry < MAX_SIM_RETRIES) {
            console.log(`Retryable error ${customCode}, waiting ${SIM_RETRY_DELAY}ms before retry...`);
            await new Promise(r => setTimeout(r, SIM_RETRY_DELAY));

            // Refresh blockhash so the tx doesn't expire during retries
            const fresh = await connection.getLatestBlockhash("confirmed");
            builtTx.recentBlockhash = fresh.blockhash;
            builtTx.lastValidBlockHeight = fresh.lastValidBlockHeight;
            continue;
          }
          // All retries exhausted — give a friendly message
          if (customCode === 6004) {
            throw new Error("Previous game is still settling on-chain. Please wait a few seconds and try again.");
          } else {
            throw new Error("Arcium network is briefly busy. Please wait a few seconds and try again.");
          }
        }

        // Non-retryable error
        console.error("Simulation error:", simResult.value.err);
        console.error("Simulation logs:", simResult.value.logs);
        throw new Error(`Simulation failed: ${JSON.stringify(simResult.value.err)}\nLogs: ${simResult.value.logs?.join('\n')}`);
      }
      
      // Sign and send with retry mechanism for devnet congestion
      const signedTx = await wallet.signTransaction!(builtTx);
      const rawTx = signedTx.serialize();
      
      let tx: string | null = null;
      let confirmed = false;
      const maxAttempts = 3;
      
      for (let attempt = 1; attempt <= maxAttempts && !confirmed; attempt++) {
        try {
          tx = await connection.sendRawTransaction(rawTx, {
            skipPreflight: true,
            maxRetries: 3,
          });
          
          console.log(`Transaction sent (attempt ${attempt}/${maxAttempts}):`, tx);
          
          // Use a polling approach for confirmation with timeout
          const startTime = Date.now();
          const timeout = 45000; // 45 seconds
          
          while (Date.now() - startTime < timeout) {
            const status = await connection.getSignatureStatus(tx);
            if (status.value?.confirmationStatus === "confirmed" || status.value?.confirmationStatus === "finalized") {
              if (status.value.err) {
                throw new Error(`Transaction failed on-chain: ${JSON.stringify(status.value.err)}`);
              }
              confirmed = true;
              console.log("Transaction confirmed!");
              break;
            }
            // Wait before next poll
            await new Promise(r => setTimeout(r, 2000));
          }
          
          if (!confirmed && attempt < maxAttempts) {
            console.log("Transaction not confirmed, retrying...");
          }
        } catch (err: unknown) {
          const errMsg = err instanceof Error ? err.message : String(err);
          if (attempt === maxAttempts) {
            throw new Error(`Failed after ${maxAttempts} attempts: ${errMsg}`);
          }
          console.warn(`Attempt ${attempt} failed:`, errMsg);
        }
      }
      
      if (!confirmed || !tx) {
        throw new Error("Transaction failed to confirm after multiple attempts. Please try again.");
      }

      setTxSignature(tx);
      console.log("Game queued with signature:", tx);

      // Wait for MPC computation using HTTP polling (WebSocket often fails through port-forwarding)
      console.log("Polling game account for MPC result...");
      const pollStartTime = Date.now();
      const pollTimeout = 120000; // 2 minutes
      let callbackTxSig: string | null = null;

      while (Date.now() - pollStartTime < pollTimeout) {
        try {
          const gameInfo = await program.account.gameAccount.fetch(gamePda);
          const status = gameInfo.status as number;
          if (status === 2) { // Completed
            console.log("Game completed! Finding callback transaction...");
            // Use `until: tx` so we only get signatures that arrived AFTER the current
            // play tx. Without this, we can accidentally match a callback from a
            // previous game (same PDA is reused each round) and show the wrong result.
            // Retry the scan because the RPC signature index often lags behind account state.
            for (let scanAttempt = 0; scanAttempt < 5 && !callbackTxSig; scanAttempt++) {
              if (scanAttempt > 0) {
                console.log(`Callback tx not indexed yet, retrying scan (${scanAttempt + 1}/5)...`);
                await new Promise(r => setTimeout(r, 2000));
              }
              const sigs = await connection.getSignaturesForAddress(gamePda, { limit: 10, until: tx }, "confirmed");
              for (const sig of sigs) {
                const candidate = await connection.getTransaction(sig.signature, {
                  commitment: "confirmed",
                  maxSupportedTransactionVersion: 0,
                });
                if (candidate?.meta?.logMessages) {
                  const hasCallbackLog = candidate.meta.logMessages.some(
                    l => l.includes("Player WON") || l.includes("Player lost") || l.includes("Game cancelled")
                  );
                  if (hasCallbackLog) {
                    callbackTxSig = sig.signature;
                    console.log("Found callback tx:", sig.signature.slice(0, 20), "with", candidate.meta.logMessages.length, "logs");
                    break;
                  }
                }
              }
            }
            break;
          } else if (status === 3) { // Cancelled
            throw new Error("Game was cancelled by the network.");
          } else if (status === 1) {
            // Still pending — check if a callback already failed (AbortedComputation)
            const elapsed = Date.now() - pollStartTime;
            if (elapsed > 30000) {
              // After 30s, check for failed callback transactions
              const sigs = await connection.getSignaturesForAddress(gamePda, { limit: 5 }, "confirmed");
              const hasFailed = sigs.some(s => s.signature !== tx && s.err !== null);
              if (hasFailed) {
                console.warn("Callback failed (AbortedComputation). Attempting to cancel game...");
                try {
                  await cancelStaleGameIfAny();
                } catch { /* ignore */ }
                throw new Error("MPC computation failed (AbortedComputation). This can happen if the circuit was updated but localnet wasn't restarted. Please restart localnet and re-initialize.");
              }
            }
          }
        } catch (pollErr: unknown) {
          // Rethrow known terminal errors
          if (pollErr instanceof Error && (
            pollErr.message.includes("cancelled") || pollErr.message.includes("Cancelled") ||
            pollErr.message.includes("AbortedComputation") || pollErr.message.includes("MPC computation failed")
          )) {
            throw pollErr;
          }
          console.warn("Poll fetch error (retrying):", pollErr);
        }
        await new Promise(r => setTimeout(r, 3000));
      }

      if (!callbackTxSig) {
        // Even without the callback tx, the game may have completed
        // Try one final check on game status
        try {
          const finalGame = await program.account.gameAccount.fetch(gamePda);
          if ((finalGame.status as number) !== 2) {
            throw new Error("Timed out waiting for MPC computation result. The game may still complete - check your wallet balance.");
          }
        } catch {
          throw new Error("Timed out waiting for MPC computation result.");
        }
      }

      console.log("Computation finalized:", callbackTxSig);

      // Parse the result from callback transaction using Anchor event decoding
      if (callbackTxSig) {
        const txDetails = await connection.getTransaction(callbackTxSig, {
          commitment: "confirmed",
          maxSupportedTransactionVersion: 0,
        });

        if (txDetails?.meta?.logMessages) {
          console.log("Callback tx logs:", txDetails.meta.logMessages);

          // Decode Anchor events from logs (more reliable than regex)
          const eventParser = new anchor.EventParser(program.programId, program.coder);
          const events: { name: string; data: Record<string, unknown> }[] = [];
          for (const event of eventParser.parseLogs(txDetails.meta.logMessages)) {
            events.push(event as { name: string; data: Record<string, unknown> });
          }

          console.log("Decoded events:", events);
          const resultEvent = events.find(
            e => e.name === "gameResultEvent" || e.name === "GameResultEvent"
          );

          if (resultEvent) {
            const data = resultEvent.data as {
              playerWon: boolean;
              winningChest: number;
              payout: { toNumber?: () => number } | number;
            };

            const playerWon = data.playerWon;
            const winningChestRaw = Number(data.winningChest ?? 0);

            const payoutLamports =
              typeof data.payout === 'object' && data.payout !== null && typeof (data.payout as { toNumber?: () => number }).toNumber === 'function'
                ? (data.payout as { toNumber: () => number }).toNumber()
                : Number(data.payout);

            // Clamp winningChest to valid range (safety for MPC RNG edge cases)
            const safeWinningChest = winningChestRaw < numChests ? winningChestRaw : winningChestRaw % numChests;

            setGameResult({
              playerWon,
              winningChest: safeWinningChest,
              payout: payoutLamports / LAMPORTS_PER_SOL,
            });
            setGameStep('reveal');
          } else {
            // Fallback: try regex on logs
            console.warn("No GameResultEvent found in logs, falling back to regex");
            const logs = txDetails.meta.logMessages.join("\n");
            const wonMatch = logs.match(/Player (WON|lost)/i);
            const chestMatch = logs.match(/Winning chest was (\d+)|Chest (\d+) was correct/);

            const playerWon = wonMatch?.[1]?.toUpperCase() === "WON";
            const rawChest = parseInt(chestMatch?.[1] || chestMatch?.[2] || "0");
            const winningChest = rawChest < numChests ? rawChest : rawChest % numChests;
            const payout = playerWon ? betAmount * numChests : 0;

            setGameResult({ playerWon, winningChest, payout });
            setGameStep('reveal');
          }
        } else {
          console.warn("No logs found in callback tx");
          setGameResult({ playerWon: false, winningChest: 0, payout: 0 });
          setGameStep('reveal');
        }
      } else {
        // Callback tx not found but game completed — cannot determine result reliably.
        // Don't fake a loss; tell the user to check on-chain.
        throw new Error(
          "Game completed but could not retrieve the result transaction. " +
          "Check your wallet balance — if it increased, you won! " +
          "You can also verify on Solana Explorer."
        );
      }
    } catch (err: unknown) {
      console.error("Game error:", err);
      // Log transaction logs if available
      if (err && typeof err === 'object' && 'transactionLogs' in err) {
        console.error("Transaction logs:", (err as { transactionLogs: string[] }).transactionLogs);
      }
      if (err && typeof err === 'object' && 'logs' in err) {
        console.error("Logs:", (err as { logs: string[] }).logs);
      }
      setError(err instanceof Error ? err.message : "Failed to play game");
    } finally {
      setIsPlaying(false);
    }
  }, [wallet, selectedChest, numChests, betAmount, connection, getProvider]);

  const resetGame = () => {
    setGameStep('hero');
    setSelectedChest(null);
    setGameResult(null);
    setError(null);
    setTxSignature(null);
  };

  // ─── UI ───────────────────────────────────────────────────────────────────

  /** Shared step-progress indicator */
  const StepBar = ({ active }: { active: 0 | 1 | 2 }) => (
    <div className="flex items-center justify-center gap-1.5 mb-8">
      {(['Stake', 'Select', 'Reveal'] as const).map((label, i) => {
        const done    = i < active;
        const current = i === active;
        return (
          <div key={label} className="flex items-center gap-1.5">
            <div
              className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold transition-all"
              style={{
                background: current ? 'rgba(168,85,247,0.18)' : done ? 'rgba(168,85,247,0.08)' : 'transparent',
                border: `1px solid ${current ? 'rgba(168,85,247,0.45)' : done ? 'rgba(168,85,247,0.25)' : 'rgba(255,255,255,0.05)'}`,
                color: current ? '#c084fc' : done ? '#7c3aed' : '#374151',
              }}
            >
              <span
                className="w-4 h-4 rounded-full text-[10px] flex items-center justify-center font-bold"
                style={{
                  background: current ? '#7c3aed' : done ? '#4c1d95' : '#111827',
                  color: current ? '#fff' : done ? '#a78bfa' : '#374151',
                }}
              >
                {done ? '✓' : i + 1}
              </span>
              {label}
            </div>
            {i < 2 && (
              <div
                className="w-6 h-px"
                style={{ background: i < active ? 'rgba(124,58,237,0.5)' : 'rgba(255,255,255,0.06)' }}
              />
            )}
          </div>
        );
      })}
    </div>
  );

  return (
    <div className="min-h-screen relative overflow-hidden" style={{ background: '#050810' }}>
      {/* ── Layered background ── */}
      <div
        className="absolute inset-0 bg-cover bg-center bg-no-repeat transition-all duration-1000"
        style={{
          backgroundImage: gameStep === 'select' ? "url('/bg2.png')" : "url('/bg.png')",
          opacity: 0.35,
        }}
      />
      {/* dark vignette */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            'radial-gradient(ellipse 80% 60% at 50% 0%, rgba(88,28,135,0.22) 0%, rgba(5,8,16,0.92) 70%)',
        }}
      />
      {/* subtle grid */}
      <div
        className="absolute inset-0 pointer-events-none opacity-[0.04]"
        style={{
          backgroundImage:
            'linear-gradient(rgba(168,85,247,0.6) 1px, transparent 1px), linear-gradient(90deg, rgba(168,85,247,0.6) 1px, transparent 1px)',
          backgroundSize: '48px 48px',
        }}
      />

      {/* ── Page shell ── */}
      <div className="relative z-10 flex flex-col min-h-screen">

        {/* ════════════════════ HEADER ════════════════════ */}
        <header className="flex-shrink-0 px-5 pt-5">
          <div
            className="max-w-6xl mx-auto flex items-center justify-between px-5 py-3 rounded-xl"
            style={{
              background: 'rgba(8,10,22,0.82)',
              backdropFilter: 'blur(14px)',
              border: '1px solid rgba(168,85,247,0.18)',
            }}
          >
            {/* Logo */}
            <div className="flex items-center gap-2.5">
              <div
                className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                style={{ background: 'rgba(88,28,135,0.55)', border: '1px solid rgba(168,85,247,0.35)' }}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
                  <path d="M3 7h18v12H3z" stroke="#a855f7" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M3 7l9-4 9 4" stroke="#a855f7" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M9 11h6" stroke="#a855f7" strokeWidth="2" strokeLinecap="round"/>
                </svg>
              </div>
              <span className="text-base font-bold tracking-wide" style={{ color: '#a855f7' }}>
                VeiledChests
              </span>
            </div>

            {/* Nav */}
            <nav className="hidden md:flex gap-7 text-sm font-medium">
              {['Game', 'About', 'How to Play'].map((item) => (
                <a
                  key={item}
                  href="#"
                  className="text-gray-500 hover:text-purple-300 transition-colors duration-200"
                >
                  {item}
                </a>
              ))}
            </nav>

            {/* Wallet area */}
            <div className="flex items-center gap-2.5">
              {solBalance !== null && (
                <div
                  className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold"
                  style={{
                    background: 'rgba(168,85,247,0.1)',
                    border: '1px solid rgba(168,85,247,0.2)',
                    color: '#c084fc',
                  }}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="9" stroke="#c084fc" strokeWidth="2"/>
                    <path d="M12 7v5l3 3" stroke="#c084fc" strokeWidth="2" strokeLinecap="round"/>
                  </svg>
                  {solBalance.toFixed(3)} SOL
                </div>
              )}
              <WalletMultiButton />
            </div>
          </div>
        </header>

        {/* ════════════════════ HERO ════════════════════ */}
        {gameStep === 'hero' && (
          <main className="flex-1 flex flex-col items-center justify-center px-6 py-16">
            <div className="text-center max-w-2xl mx-auto anim-fade-up">

              {/* Arcium badge */}
              <div
                className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full mb-8 text-xs font-semibold tracking-widest uppercase"
                style={{
                  background: 'rgba(168,85,247,0.13)',
                  border: '1px solid rgba(168,85,247,0.3)',
                  color: '#c084fc',
                }}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-pulse" />
                Powered by Arcium MPC · Solana
              </div>

              {/* Headline */}
              <h1 className="text-6xl md:text-7xl font-black mb-6 leading-[1.05] tracking-tight">
                <span className="text-white">CHOOSE</span>
                <br />
                <span className="shimmer-text">YOUR FATE</span>
              </h1>

              <p className="text-gray-400 text-base md:text-lg mb-10 leading-relaxed max-w-lg mx-auto">
                One chest hides the reward. Your pick is{' '}
                <span className="text-purple-300 font-semibold">encrypted by Arcium's MPC network</span>
                {' '}— nobody can see your choice until the reveal.
              </p>

              {/* CTA */}
              {!wallet.publicKey ? (
                <div className="flex flex-col items-center gap-3">
                  <p className="text-gray-600 text-sm">Connect your wallet to start playing</p>
                  <WalletMultiButton />
                </div>
              ) : (
                <button
                  onClick={() => setGameStep('stake')}
                  className="anim-glow-pulse relative px-12 py-4 text-base font-bold rounded-xl transition-all duration-300 hover:scale-105 active:scale-95"
                  style={{
                    background: 'linear-gradient(135deg, rgba(88,28,135,0.9) 0%, rgba(107,33,168,0.9) 100%)',
                    border: '2px solid rgba(168,85,247,0.55)',
                    color: '#ede9fe',
                  }}
                >
                  Open the Veil &nbsp;→
                </button>
              )}
            </div>

            {/* Decorative floating chests */}
            <div className="mt-16 flex items-end justify-center gap-8 select-none pointer-events-none">
              {[80, 116, 80].map((size, i) => (
                <img
                  key={i}
                  src="/chest.png"
                  alt=""
                  className="object-contain anim-float"
                  style={{
                    width: size,
                    height: size,
                    opacity: i === 1 ? 0.35 : 0.18,
                    filter: 'drop-shadow(0 0 16px rgba(168,85,247,0.5))',
                    animationDuration: `${3 + i * 0.5}s`,
                    animationDelay: `${i * 0.4}s`,
                  }}
                />
              ))}
            </div>

            {/* Footer */}
            <footer className="absolute bottom-5 w-full text-center">
              <p className="text-gray-700 text-xs">
                Built by{' '}
                <a
                  href="https://x.com/EtherPhantasm"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-gray-500 hover:text-purple-400 transition-colors"
                >
                  EtherPhantasm
                </a>
              </p>
            </footer>
          </main>
        )}

        {/* ════════════════════ STAKE ════════════════════ */}
        {gameStep === 'stake' && (
          <main className="flex-1 flex items-center justify-center px-6 py-12">
            <div className="w-full max-w-md anim-reveal">
              <StepBar active={0} />

              <div
                className="rounded-2xl p-7"
                style={{
                  background: 'rgba(8,10,24,0.92)',
                  border: '1px solid rgba(168,85,247,0.22)',
                  backdropFilter: 'blur(18px)',
                  boxShadow: '0 0 60px rgba(88,28,135,0.18), 0 24px 48px rgba(0,0,0,0.55)',
                }}
              >
                <h2 className="text-2xl font-black text-white mb-1">Set Your Stake</h2>
                <p className="text-gray-500 text-sm mb-7">
                  Choose how much to bet and how many chests to play
                </p>

                {/* Bet amount */}
                <div className="mb-6">
                  <label className="text-[11px] font-bold text-gray-500 uppercase tracking-widest mb-3 block">
                    Bet Amount (SOL)
                  </label>
                  <div className="grid grid-cols-5 gap-2">
                    {BET_OPTIONS.map((amount) => {
                      const active = betAmount === amount;
                      return (
                        <button
                          key={amount}
                          onClick={() => setBetAmount(amount)}
                          className="py-3 rounded-xl text-sm font-bold transition-all duration-200"
                          style={{
                            background: active ? 'rgba(88,28,135,0.85)' : 'rgba(88,28,135,0.12)',
                            border: `1px solid ${active ? 'rgba(168,85,247,0.75)' : 'rgba(88,28,135,0.28)'}`,
                            color: active ? '#ede9fe' : '#6b21a8',
                            transform: active ? 'scale(1.06)' : 'scale(1)',
                            boxShadow: active ? '0 0 18px rgba(168,85,247,0.22)' : 'none',
                          }}
                        >
                          {amount}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Chest count */}
                <div className="mb-7">
                  <label className="text-[11px] font-bold text-gray-500 uppercase tracking-widest mb-3 block">
                    Number of Chests
                  </label>
                  <div className="grid grid-cols-4 gap-2">
                    {CHEST_OPTIONS.map((num) => {
                      const active = numChests === num;
                      return (
                        <button
                          key={num}
                          onClick={() => {
                            setNumChests(num);
                            if (selectedChest !== null && selectedChest >= num) setSelectedChest(null);
                          }}
                          className="py-3 rounded-xl font-black transition-all duration-200 flex flex-col items-center gap-0.5"
                          style={{
                            background: active ? 'rgba(34,197,94,0.14)' : 'rgba(34,197,94,0.05)',
                            border: `1px solid ${active ? 'rgba(34,197,94,0.55)' : 'rgba(34,197,94,0.12)'}`,
                            color: active ? '#4ade80' : '#14532d',
                            transform: active ? 'scale(1.06)' : 'scale(1)',
                            boxShadow: active ? '0 0 16px rgba(34,197,94,0.14)' : 'none',
                          }}
                        >
                          <span className="text-xl">{num}</span>
                          <span className="text-[9px] font-semibold opacity-60">CHESTS</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Odds summary */}
                <div
                  className="flex items-center justify-between px-4 py-3 rounded-xl mb-6 text-sm"
                  style={{
                    background: 'rgba(168,85,247,0.05)',
                    border: '1px solid rgba(168,85,247,0.1)',
                  }}
                >
                  <span className="text-gray-500">
                    Win chance:{' '}
                    <span className="text-gray-300 font-semibold">1 in {numChests}</span>
                  </span>
                  <span className="text-gray-500">
                    Payout:{' '}
                    <span className="text-green-400 font-semibold">
                      +{(betAmount * numChests).toFixed(2)} SOL
                    </span>
                  </span>
                </div>

                {/* Next */}
                <button
                  onClick={() => setGameStep('select')}
                  className="w-full py-3.5 rounded-xl font-bold text-sm transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]"
                  style={{
                    background: 'linear-gradient(135deg, rgba(88,28,135,0.9), rgba(107,33,168,0.9))',
                    border: '1px solid rgba(168,85,247,0.45)',
                    color: '#ede9fe',
                    boxShadow: '0 0 22px rgba(88,28,135,0.28)',
                  }}
                >
                  Choose a Chest →
                </button>

                <button
                  onClick={() => setGameStep('hero')}
                  className="w-full py-2 mt-3 text-gray-600 hover:text-gray-400 text-xs transition-colors"
                >
                  ← Back
                </button>
              </div>
            </div>
          </main>
        )}

        {/* ════════════════════ CHEST SELECT ════════════════════ */}
        {gameStep === 'select' && (
          <main className="flex-1 flex flex-col items-center justify-center px-6 py-12">
            <StepBar active={1} />

            {/* Headline */}
            <div className="text-center mb-10">
              <h2 className="text-3xl font-black text-white mb-2">
                Which chest holds the treasure?
              </h2>
              <p className="text-gray-500 text-sm">
                Betting{' '}
                <span className="text-purple-300 font-semibold">{betAmount} SOL</span>
                {' '}across{' '}
                <span className="text-green-400 font-semibold">{numChests} chests</span>
              </p>
            </div>

            {/* Chests row */}
            <div className="flex gap-5 mb-8 flex-wrap justify-center">
              {Array.from({ length: numChests }, (_, i) => {
                const chosen = selectedChest === i;
                return (
                  <button
                    key={i}
                    onClick={() => !isPlaying && setSelectedChest(i)}
                    disabled={isPlaying}
                    className={`flex flex-col items-center group transition-all duration-300 ${
                      isPlaying ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'
                    }`}
                  >
                    <div
                      className="relative rounded-2xl p-5 transition-all duration-300"
                      style={{
                        background: chosen
                          ? 'rgba(245,158,11,0.14)'
                          : 'rgba(8,10,24,0.7)',
                        border: `2px solid ${chosen ? 'rgba(245,158,11,0.65)' : 'rgba(168,85,247,0.14)'}`,
                        boxShadow: chosen
                          ? '0 0 44px rgba(245,158,11,0.28), 0 0 80px rgba(245,158,11,0.1)'
                          : '0 0 16px rgba(0,0,0,0.3)',
                        transform: chosen
                          ? 'translateY(-10px) scale(1.07)'
                          : 'translateY(0) scale(1)',
                      }}
                    >
                      <img
                        src="/chest.png"
                        alt={`Chest ${i + 1}`}
                        className={`w-28 h-28 object-contain ${chosen ? 'anim-float-slow' : 'anim-float'}`}
                        style={{
                          filter: chosen
                            ? 'drop-shadow(0 0 22px rgba(245,158,11,0.85)) brightness(1.12)'
                            : 'drop-shadow(0 0 8px rgba(168,85,247,0.28))',
                          animationDuration: `${2.8 + i * 0.35}s`,
                        }}
                      />

                      {/* Checkmark badge */}
                      {chosen && (
                        <span
                          className="absolute top-2 right-2 w-5 h-5 rounded-full bg-yellow-400 flex items-center justify-center"
                          style={{ boxShadow: '0 0 8px rgba(245,158,11,0.6)' }}
                        >
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none">
                            <path
                              d="M5 13l4 4L19 7"
                              stroke="#000"
                              strokeWidth="3"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                        </span>
                      )}

                      {/* Hover ring (non-selected) */}
                      {!chosen && !isPlaying && (
                        <div
                          className="absolute inset-0 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"
                          style={{ border: '2px solid rgba(168,85,247,0.4)' }}
                        />
                      )}
                    </div>

                    {/* Label */}
                    <div
                      className="mt-2.5 px-4 py-1 rounded-full text-xs font-bold transition-all duration-300"
                      style={{
                        background: chosen ? 'rgba(245,158,11,0.18)' : 'rgba(88,28,135,0.18)',
                        color: chosen ? '#fbbf24' : '#6b21a8',
                        border: `1px solid ${chosen ? 'rgba(245,158,11,0.35)' : 'rgba(88,28,135,0.28)'}`,
                      }}
                    >
                      #{i + 1}
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Selection hint */}
            <div className="h-7 flex items-center justify-center mb-6">
              {selectedChest !== null ? (
                <p className="text-gray-300 text-sm anim-fade-up">
                  Chest{' '}
                  <span className="text-yellow-400 font-bold">#{selectedChest + 1}</span>
                  {' '}selected — potential win{' '}
                  <span className="text-green-400 font-bold">
                    +{(betAmount * numChests).toFixed(2)} SOL
                  </span>
                </p>
              ) : (
                <p className="text-gray-600 text-sm">Click a chest to make your choice</p>
              )}
            </div>

            {/* MPC loading state */}
            {isPlaying && (
              <div className="mb-7 flex flex-col items-center gap-4">
                <div className="relative w-14 h-14">
                  <div
                    className="absolute inset-0 rounded-full border-2"
                    style={{ borderColor: 'rgba(88,28,135,0.4)' }}
                  />
                  <div
                    className="absolute inset-0 rounded-full border-2 border-transparent border-t-purple-400"
                    style={{ animation: 'spin-cw 1s linear infinite' }}
                  />
                  <div
                    className="absolute inset-2 rounded-full border-2 border-transparent border-t-yellow-400"
                    style={{ animation: 'spin-ccw 1.6s linear infinite' }}
                  />
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="w-2 h-2 rounded-full bg-purple-400 animate-pulse" />
                  </div>
                </div>
                <div className="text-center">
                  <p className="text-purple-300 text-sm font-semibold">
                    Arcium MPC computing result…
                  </p>
                  <p className="text-gray-600 text-xs mt-1">
                    Your encrypted choice is being processed on-chain
                  </p>
                </div>
              </div>
            )}

            {/* Error */}
            {error && !isPlaying && (
              <div
                className="mb-6 px-5 py-3 rounded-xl text-sm max-w-sm text-center"
                style={{
                  background: 'rgba(239,68,68,0.09)',
                  border: '1px solid rgba(239,68,68,0.28)',
                  color: '#fca5a5',
                }}
              >
                {error}
              </div>
            )}

            {/* Confirm */}
            <button
              onClick={playGame}
              disabled={selectedChest === null || isPlaying}
              className="px-14 py-4 rounded-xl font-bold text-sm transition-all duration-300 hover:scale-105 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100"
              style={{
                background:
                  selectedChest !== null && !isPlaying
                    ? 'linear-gradient(135deg, rgba(180,90,0,0.9), rgba(217,119,6,0.95))'
                    : 'rgba(88,28,135,0.28)',
                border: `2px solid ${
                  selectedChest !== null && !isPlaying
                    ? 'rgba(245,158,11,0.65)'
                    : 'rgba(88,28,135,0.28)'
                }`,
                color: selectedChest !== null && !isPlaying ? '#fff7ed' : '#6b21a8',
                boxShadow:
                  selectedChest !== null && !isPlaying
                    ? '0 0 28px rgba(245,158,11,0.28)'
                    : 'none',
              }}
            >
              {isPlaying ? 'Processing…' : 'Reveal the Truth'}
            </button>

            <button
              onClick={() => { setSelectedChest(null); setGameStep('stake'); }}
              disabled={isPlaying}
              className="mt-3 text-gray-600 hover:text-gray-400 text-xs transition-colors disabled:opacity-30"
            >
              ← Adjust stake
            </button>
          </main>
        )}

        {/* ════════════════════ REVEAL ════════════════════ */}
        {gameStep === 'reveal' && gameResult && (
          <main className="flex-1 flex flex-col items-center justify-center px-6 py-12">
            {/* Headline */}
            <div className="text-center mb-10">
              <h2 className="text-3xl font-black mb-2 shimmer-text">The Veil Lifts…</h2>
              <p className="text-gray-600 text-sm">Revealing the winning chest</p>
            </div>

            {/* Chest row */}
            <div className="flex gap-5 mb-10 flex-wrap justify-center">
              {Array.from({ length: numChests }, (_, i) => {
                const isWinner = i === gameResult.winningChest;
                return (
                  <div key={i} className="relative flex flex-col items-center">
                    {/* Burst ring — only on winner */}
                    {isWinner && (
                      <div
                        className="absolute anim-burst pointer-events-none"
                        style={{
                          width: '112px',
                          height: '112px',
                          top: 0,
                          borderRadius: '50%',
                          background: 'radial-gradient(circle, rgba(245,158,11,0.55), transparent 70%)',
                        }}
                      />
                    )}

                    {/* Chest image */}
                    <img
                      src="/chest.png"
                      alt={`Chest ${i + 1}`}
                      className={`w-28 h-28 object-contain ${isWinner ? 'anim-chest-win' : 'anim-chest-lose'}`}
                      style={{
                        filter: isWinner
                          ? 'drop-shadow(0 0 10px rgba(245,158,11,0.5))'
                          : 'drop-shadow(0 0 6px rgba(168,85,247,0.2))',
                      }}
                    />

                    {/* "You" badge on player's choice */}
                    {i === selectedChest && (
                      <span
                        className="absolute top-1 right-1 text-[9px] font-bold px-1.5 py-0.5 rounded-full"
                        style={{
                          background: 'rgba(245,158,11,0.25)',
                          color: '#fbbf24',
                          border: '1px solid rgba(245,158,11,0.4)',
                        }}
                      >
                        You
                      </span>
                    )}

                    {/* Label fades in at 2.5s */}
                    <div
                      className="mt-2.5 text-xs font-bold anim-reveal-label"
                      style={{ color: isWinner ? '#fbbf24' : '#4b5563' }}
                    >
                      {isWinner ? '★ Winner' : `#${i + 1}`}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Big result text — fades in at 2.6s */}
            <div
              className="anim-reveal-label text-center mb-8"
              style={{ animationDelay: '2.6s' }}
            >
              <p
                className="text-4xl font-black"
                style={{
                  color: gameResult.playerWon ? '#4ade80' : '#f87171',
                  textShadow: `0 0 32px ${gameResult.playerWon ? 'rgba(34,197,94,0.5)' : 'rgba(239,68,68,0.4)'}`,
                }}
              >
                {gameResult.playerWon ? 'YOU WON!' : 'YOU LOST'}
              </p>
              {gameResult.playerWon && (
                <p className="text-green-400 text-xl font-semibold mt-1">
                  +{gameResult.payout.toFixed(2)} SOL
                </p>
              )}
            </div>

            {/* Skip button — appears after 1s */}
            <button
              onClick={() => setGameStep('result')}
              className="text-gray-600 hover:text-gray-400 text-xs transition-colors"
              style={{ opacity: 0, animation: 'fade-in-up 0.4s ease 1s forwards' }}
            >
              Skip →
            </button>
          </main>
        )}

        {/* ════════════════════ RESULT ════════════════════ */}
        {gameStep === 'result' && gameResult && (
          <main className="flex-1 flex flex-col items-center justify-center px-6 py-12">
            <div className="w-full max-w-sm anim-reveal">
              <div
                className="rounded-2xl overflow-hidden"
                style={{
                  background: 'rgba(8,10,24,0.96)',
                  border: `1px solid ${
                    gameResult.playerWon ? 'rgba(34,197,94,0.38)' : 'rgba(239,68,68,0.28)'
                  }`,
                  boxShadow: gameResult.playerWon
                    ? '0 0 60px rgba(34,197,94,0.18), 0 24px 48px rgba(0,0,0,0.55)'
                    : '0 0 40px rgba(239,68,68,0.1), 0 24px 48px rgba(0,0,0,0.55)',
                  backdropFilter: 'blur(18px)',
                }}
              >
                {/* Top banner */}
                <div
                  className="px-8 pt-8 pb-6 text-center"
                  style={{
                    background: gameResult.playerWon
                      ? 'linear-gradient(180deg, rgba(34,197,94,0.12) 0%, transparent 100%)'
                      : 'linear-gradient(180deg, rgba(239,68,68,0.08) 0%, transparent 100%)',
                  }}
                >
                  <h2
                    className="text-4xl font-black mb-1.5"
                    style={{
                      color: gameResult.playerWon ? '#4ade80' : '#f87171',
                      textShadow: `0 0 32px ${
                        gameResult.playerWon ? 'rgba(34,197,94,0.45)' : 'rgba(239,68,68,0.35)'
                      }`,
                    }}
                  >
                    {gameResult.playerWon ? 'YOU WON!' : 'YOU LOST'}
                  </h2>

                  <p className="text-gray-500 text-sm">
                    {gameResult.playerWon
                      ? 'The veil has lifted. Fortune favors you.'
                      : 'The veil reveals your fate. Better luck next time.'}
                  </p>
                </div>

                {/* Detail cards */}
                <div className="px-6 pb-7">
                  <div className="grid grid-cols-2 gap-3 mb-5">
                    <div
                      className="p-3 rounded-xl text-center"
                      style={{
                        background: 'rgba(168,85,247,0.07)',
                        border: '1px solid rgba(168,85,247,0.14)',
                      }}
                    >
                      <p className="text-[11px] text-gray-600 mb-1 uppercase tracking-wider">
                        You Chose
                      </p>
                      <p className="text-base font-bold text-white">
                        Chest #{(selectedChest ?? 0) + 1}
                      </p>
                    </div>
                    <div
                      className="p-3 rounded-xl text-center"
                      style={{
                        background: 'rgba(245,158,11,0.07)',
                        border: '1px solid rgba(245,158,11,0.18)',
                      }}
                    >
                      <p className="text-[11px] text-gray-600 mb-1 uppercase tracking-wider">
                        Winning Chest
                      </p>
                      <p className="text-base font-bold text-yellow-400">
                        Chest #{gameResult.winningChest + 1}
                      </p>
                    </div>
                  </div>

                  {/* Payout */}
                  <div
                    className="px-4 py-4 rounded-xl mb-5 text-center"
                    style={{
                      background: gameResult.playerWon
                        ? 'rgba(34,197,94,0.08)'
                        : 'rgba(239,68,68,0.05)',
                      border: `1px solid ${
                        gameResult.playerWon ? 'rgba(34,197,94,0.22)' : 'rgba(239,68,68,0.14)'
                      }`,
                    }}
                  >
                    <p className="text-[11px] text-gray-600 mb-1 uppercase tracking-wider">
                      {gameResult.playerWon ? 'Payout' : 'Amount Lost'}
                    </p>
                    <p
                      className="text-3xl font-black"
                      style={{ color: gameResult.playerWon ? '#4ade80' : '#f87171' }}
                    >
                      {gameResult.playerWon ? '+' : '-'}
                      {(gameResult.playerWon
                        ? gameResult.payout
                        : betAmount
                      ).toFixed(2)}{' '}
                      SOL
                    </p>
                  </div>

                  {/* Explorer link */}
                  {txSignature && (
                    <a
                      href={`https://explorer.solana.com/tx/${txSignature}?cluster=devnet`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center justify-center gap-1.5 w-full py-2 rounded-lg mb-4 text-xs font-medium text-gray-600 hover:text-gray-300 transition-colors"
                      style={{ border: '1px solid rgba(255,255,255,0.06)' }}
                    >
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none">
                        <path
                          d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                      View on Solana Explorer
                    </a>
                  )}

                  {/* Play Again */}
                  <button
                    onClick={resetGame}
                    className="w-full py-3.5 rounded-xl font-bold text-sm transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]"
                    style={{
                      background: 'linear-gradient(135deg, rgba(88,28,135,0.9), rgba(107,33,168,0.9))',
                      border: '1px solid rgba(168,85,247,0.45)',
                      color: '#ede9fe',
                      boxShadow: '0 0 20px rgba(88,28,135,0.28)',
                    }}
                  >
                    Play Again
                  </button>
                </div>
              </div>
            </div>
          </main>
        )}
      </div>
    </div>
  );
};
