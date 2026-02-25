"use client";

import { FC, useState, useCallback, useEffect, useMemo } from "react";
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

// ─── Small UI Sub-Components ────────────────────────────────────────────────

/** Floating ambient particles rendered behind content */
const AmbientParticles: FC = () => {
  const particles = useMemo(
    () =>
      Array.from({ length: 18 }, (_, i) => ({
        id: i,
        left: `${Math.random() * 100}%`,
        delay: `${Math.random() * 6}s`,
        duration: `${6 + Math.random() * 6}s`,
        size: 2 + Math.random() * 3,
      })),
    [],
  );
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden>
      {particles.map((p) => (
        <span
          key={p.id}
          className="particle"
          style={{
            left: p.left,
            bottom: "-10px",
            animationDelay: p.delay,
            animationDuration: p.duration,
            width: p.size,
            height: p.size,
          }}
        />
      ))}
    </div>
  );
};

/** Spinning loader used during MPC computation */
const ComputeSpinner: FC<{ label?: string }> = ({ label = "Computing..." }) => (
  <div className="flex flex-col items-center gap-6 animate-fade-in">
    {/* Outer orbiting ring */}
    <div className="relative w-28 h-28">
      <svg className="w-28 h-28 animate-spin-slow" viewBox="0 0 100 100">
        <circle
          cx="50" cy="50" r="45"
          fill="none"
          stroke="url(#ringGrad)"
          strokeWidth="2"
          strokeDasharray="8 12"
          opacity="0.5"
        />
        <defs>
          <linearGradient id="ringGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="var(--purple)" />
            <stop offset="100%" stopColor="var(--gold)" />
          </linearGradient>
        </defs>
      </svg>
      {/* Inner progress ring */}
      <svg className="absolute inset-0 w-28 h-28 -rotate-90" viewBox="0 0 100 100">
        <circle
          cx="50" cy="50" r="38"
          fill="none"
          stroke="var(--purple)"
          strokeWidth="3"
          strokeLinecap="round"
          className="progress-ring-circle"
        />
      </svg>
      {/* Center icon */}
      <div className="absolute inset-0 flex items-center justify-center">
        <div
          className="w-12 h-12 rounded-full flex items-center justify-center"
          style={{ background: "rgba(139,92,246,0.15)" }}
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--purple-light)" strokeWidth="2">
            <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" strokeLinecap="round" />
          </svg>
        </div>
      </div>
    </div>
    <div className="text-center">
      <p className="text-purple-300 font-medium text-lg">{label}</p>
      <p className="text-slate-500 text-sm mt-1">Arcium MPC network is processing</p>
    </div>
  </div>
);

/** Multiplier badge */
const MultiplierBadge: FC<{ numChests: number }> = ({ numChests }) => (
  <span
    className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-sm font-semibold"
    style={{
      background: "rgba(245, 166, 35, 0.12)",
      color: "var(--gold-light)",
      border: "1px solid rgba(245, 166, 35, 0.25)",
    }}
  >
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
    {numChests}x
  </span>
);

// ─── Main Component ─────────────────────────────────────────────────────────

export const ChestGame: FC = () => {
  const { connection } = useConnection();
  const wallet = useWallet();

  const [gameStep, setGameStep] = useState<"hero" | "stake" | "select" | "result">("hero");
  const [numChests, setNumChests] = useState(3);
  const [selectedChest, setSelectedChest] = useState<number | null>(null);
  const [betAmount, setBetAmount] = useState(0.1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [gameResult, setGameResult] = useState<GameResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [txSignature, setTxSignature] = useState<string | null>(null);
  const [solBalance, setSolBalance] = useState<number | null>(null);
  const [isAirdropping, setIsAirdropping] = useState(false);

  // ── Balance tracking ────────────────────────────────────────────────────
  useEffect(() => {
    if (!wallet.publicKey) {
      setSolBalance(null);
      return;
    }
    const fetchBalance = async () => {
      try {
        const bal = await connection.getBalance(wallet.publicKey!);
        setSolBalance(bal / LAMPORTS_PER_SOL);
      } catch {
        setSolBalance(null);
      }
    };
    fetchBalance();
    const id = connection.onAccountChange(wallet.publicKey, (info) => {
      setSolBalance(info.lamports / LAMPORTS_PER_SOL);
    });
    return () => {
      connection.removeAccountChangeListener(id);
    };
  }, [wallet.publicKey, connection]);

  // ── Airdrop ─────────────────────────────────────────────────────────────
  const requestAirdrop = useCallback(async () => {
    if (!wallet.publicKey) return;
    setIsAirdropping(true);
    setError(null);
    try {
      let sig: string | null = null;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          sig = await connection.requestAirdrop(wallet.publicKey, 2 * LAMPORTS_PER_SOL);
          break;
        } catch (fetchErr) {
          if (attempt === 3) throw fetchErr;
          console.warn(`Airdrop attempt ${attempt} failed, retrying...`);
          await new Promise((r) => setTimeout(r, 1500));
        }
      }
      if (sig) {
        await connection.confirmTransaction(sig, "confirmed");
      }
      const bal = await connection.getBalance(wallet.publicKey);
      setSolBalance(bal / LAMPORTS_PER_SOL);
    } catch (err) {
      console.error("Airdrop failed:", err);
      setError("Airdrop failed. Make sure you're on localnet/devnet.");
    } finally {
      setIsAirdropping(false);
    }
  }, [wallet.publicKey, connection]);

  // ── Provider helper ─────────────────────────────────────────────────────
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
      { commitment: "confirmed" },
    );
  }, [connection, wallet]);

  // ── Play game (all blockchain + MPC logic) ──────────────────────────────
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

      const cancelStaleGameIfAny = async () => {
        const [gamePda] = PublicKey.findProgramAddressSync(
          [GAME_SEED, wallet.publicKey!.toBuffer()],
          PROGRAM_ID,
        );
        try {
          const game = await program.account.gameAccount.fetchNullable(gamePda);
          if (!game) return false;
          const status = game.status as number;
          if (status !== 1) return false;
          const createdAt = Number(game.createdAt);
          const now = Math.floor(Date.now() / 1000);
          if (now - createdAt <= 60) return false;

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

      console.log("Fetching MXE public key for program:", PROGRAM_ID.toBase58());
      let mxePubkey = await getMXEPublicKey(provider, PROGRAM_ID);
      console.log("MXE public key fetched:", mxePubkey ? Array.from(mxePubkey) : "null");
      if (!mxePubkey) {
        throw new Error(
          "MXE public key not available yet. The Arcium network is still processing keygen for this MXE. " +
            "This can take several minutes on devnet. Please try again later.",
        );
      }

      const privateKey = x25519.utils.randomPrivateKey();
      const clientPubkey = x25519.getPublicKey(privateKey);
      const sharedSecret = x25519.getSharedSecret(privateKey, mxePubkey);

      const cipher = new RescueCipher(sharedSecret);
      const nonce = crypto.getRandomValues(new Uint8Array(16));
      const ciphertext = cipher.encrypt([BigInt(selectedChest)], nonce);

      console.log("Player choice (plaintext):", selectedChest);
      console.log("Encrypted choice:", ciphertext[0]);

      const computationOffset = new BN(Date.now());

      const [treasuryPda] = PublicKey.findProgramAddressSync([TREASURY_SEED], PROGRAM_ID);
      const [gamePda] = PublicKey.findProgramAddressSync(
        [GAME_SEED, wallet.publicKey.toBuffer()],
        PROGRAM_ID,
      );
      const [signPda] = PublicKey.findProgramAddressSync([SIGN_PDA_SEED], PROGRAM_ID);

      const compDefOffset = Buffer.from(getCompDefAccOffset("play_chest_game")).readUInt32LE();
      const mxeAccount = getMXEAccAddress(PROGRAM_ID);

      const nonceValue = deserializeLE(nonce);
      console.log("Nonce value:", nonceValue.toString());

      const txBuilder = program.methods
        .playChestGame(
          computationOffset,
          numChests,
          new BN(betAmount * LAMPORTS_PER_SOL),
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          Array.from(ciphertext[0]) as any,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          Array.from(clientPubkey) as any,
          new BN(nonceValue.toString()),
        )
        .accountsPartial({
          player: wallet.publicKey!,
          gameAccount: gamePda,
          treasury: treasuryPda,
          signPdaAccount: signPda,
          mxeAccount: mxeAccount,
          mempoolAccount: getMempoolAccAddress(CLUSTER_OFFSET),
          executingPool: getExecutingPoolAccAddress(CLUSTER_OFFSET),
          computationAccount: getComputationAccAddress(CLUSTER_OFFSET, computationOffset),
          compDefAccount: getCompDefAccAddress(PROGRAM_ID, compDefOffset),
          clusterAccount: getClusterAccAddress(CLUSTER_OFFSET),
          poolAccount: getFeePoolAccAddress(),
          clockAccount: getClockAccAddress(),
          systemProgram: SystemProgram.programId,
          arciumProgram: getArciumProgramId(),
        });

      const txInstr = await txBuilder.instruction();
      console.log(
        "Transaction instruction keys:",
        txInstr.keys.map((k) => ({
          pubkey: k.pubkey.toBase58(),
          isSigner: k.isSigner,
          isWritable: k.isWritable,
        })),
      );
      console.log("Program ID in instruction:", txInstr.programId.toBase58());

      const priorityFeeIx = ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 200000 });
      const computeUnitsIx = ComputeBudgetProgram.setComputeUnitLimit({ units: 400000 });

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
          await new Promise((r) => setTimeout(r, 1000));
        }
      }

      const builtTx = new Transaction({
        blockhash: blockhash!,
        lastValidBlockHeight: lastValidBlockHeight!,
        feePayer: wallet.publicKey!,
      });

      builtTx.add(priorityFeeIx, computeUnitsIx, txInstr);

      try {
        const simResult = await connection.simulateTransaction(builtTx);
        console.log("Simulation result:", simResult);
        if (simResult.value.err) {
          const errObj = simResult.value.err as {
            InstructionError?: [number, { Custom: number }];
          } | null;
          const customCode =
            errObj?.InstructionError?.[1] &&
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (errObj.InstructionError[1] as any).Custom;
          if (customCode === 6004) {
            const cancelled = await cancelStaleGameIfAny();
            if (cancelled) {
              throw new Error("Previous game was still pending; canceled it. Please retry your move.");
            }
          }
          console.error("Simulation error:", simResult.value.err);
          console.error("Simulation logs:", simResult.value.logs);
          throw new Error(
            `Simulation failed: ${JSON.stringify(simResult.value.err)}\nLogs: ${simResult.value.logs?.join("\n")}`,
          );
        }
        console.log("Simulation passed! Sending transaction...");
      } catch (simErr) {
        console.error("Simulation exception:", simErr);
        throw simErr;
      }

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

          const startTime = Date.now();
          const timeout = 45000;

          while (Date.now() - startTime < timeout) {
            const status = await connection.getSignatureStatus(tx);
            if (
              status.value?.confirmationStatus === "confirmed" ||
              status.value?.confirmationStatus === "finalized"
            ) {
              if (status.value.err) {
                throw new Error(`Transaction failed on-chain: ${JSON.stringify(status.value.err)}`);
              }
              confirmed = true;
              console.log("Transaction confirmed!");
              break;
            }
            await new Promise((r) => setTimeout(r, 2000));
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

      console.log("Polling game account for MPC result...");
      const pollStartTime = Date.now();
      const pollTimeout = 120000;
      let callbackTxSig: string | null = null;

      while (Date.now() - pollStartTime < pollTimeout) {
        try {
          const [pollGamePda] = PublicKey.findProgramAddressSync(
            [GAME_SEED, wallet.publicKey!.toBuffer()],
            PROGRAM_ID,
          );
          const gameInfo = await program.account.gameAccount.fetch(pollGamePda);
          const status = gameInfo.status as number;
          if (status === 2) {
            console.log("Game completed! Finding callback transaction...");
            const sigs = await connection.getSignaturesForAddress(pollGamePda, { limit: 10 }, "confirmed");
            for (const sig of sigs) {
              if (sig.signature === tx) continue;
              const candidate = await connection.getTransaction(sig.signature, {
                commitment: "confirmed",
                maxSupportedTransactionVersion: 0,
              });
              if (candidate?.meta?.logMessages) {
                const hasCallbackLog = candidate.meta.logMessages.some(
                  (l) =>
                    l.includes("Player WON") || l.includes("Player lost") || l.includes("Game cancelled"),
                );
                if (hasCallbackLog) {
                  callbackTxSig = sig.signature;
                  console.log(
                    "Found callback tx:",
                    sig.signature.slice(0, 20),
                    "with",
                    candidate.meta.logMessages.length,
                    "logs",
                  );
                  break;
                }
              }
            }
            break;
          } else if (status === 3) {
            throw new Error("Game was cancelled by the network.");
          } else if (status === 1) {
            const elapsed = Date.now() - pollStartTime;
            if (elapsed > 30000) {
              const [checkPda] = PublicKey.findProgramAddressSync(
                [GAME_SEED, wallet.publicKey!.toBuffer()],
                PROGRAM_ID,
              );
              const sigs = await connection.getSignaturesForAddress(checkPda, { limit: 5 }, "confirmed");
              const hasFailed = sigs.some((s) => s.signature !== tx && s.err !== null);
              if (hasFailed) {
                console.warn("Callback failed (AbortedComputation). Attempting to cancel game...");
                try {
                  await cancelStaleGameIfAny();
                } catch {
                  /* ignore */
                }
                throw new Error(
                  "MPC computation failed (AbortedComputation). This can happen if the circuit was updated but localnet wasn't restarted. Please restart localnet and re-initialize.",
                );
              }
            }
          }
        } catch (pollErr: unknown) {
          if (
            pollErr instanceof Error &&
            (pollErr.message.includes("cancelled") ||
              pollErr.message.includes("Cancelled") ||
              pollErr.message.includes("AbortedComputation") ||
              pollErr.message.includes("MPC computation failed"))
          ) {
            throw pollErr;
          }
          console.warn("Poll fetch error (retrying):", pollErr);
        }
        await new Promise((r) => setTimeout(r, 3000));
      }

      if (!callbackTxSig) {
        try {
          const [finalPda] = PublicKey.findProgramAddressSync(
            [GAME_SEED, wallet.publicKey!.toBuffer()],
            PROGRAM_ID,
          );
          const finalGame = await program.account.gameAccount.fetch(finalPda);
          if ((finalGame.status as number) !== 2) {
            throw new Error(
              "Timed out waiting for MPC computation result. The game may still complete - check your wallet balance.",
            );
          }
        } catch {
          throw new Error("Timed out waiting for MPC computation result.");
        }
      }

      console.log("Computation finalized:", callbackTxSig);

      if (callbackTxSig) {
        const txDetails = await connection.getTransaction(callbackTxSig, {
          commitment: "confirmed",
          maxSupportedTransactionVersion: 0,
        });

        if (txDetails?.meta?.logMessages) {
          console.log("Callback tx logs:", txDetails.meta.logMessages);

          const eventParser = new anchor.EventParser(program.programId, program.coder);
          const events: { name: string; data: Record<string, unknown> }[] = [];
          for (const event of eventParser.parseLogs(txDetails.meta.logMessages)) {
            events.push(event as { name: string; data: Record<string, unknown> });
          }

          console.log("Decoded events:", events);
          const resultEvent = events.find((e) => e.name === "gameResultEvent");

          if (resultEvent) {
            const data = resultEvent.data as {
              playerWon: boolean;
              winningChest: number;
              payout: { toNumber?: () => number };
              betAmount: { toNumber?: () => number };
            };
            const payoutLamports =
              typeof data.payout === "object" && data.payout?.toNumber
                ? data.payout.toNumber()
                : Number(data.payout);

            const safeWinningChest =
              data.winningChest < numChests ? data.winningChest : data.winningChest % numChests;

            setGameResult({
              playerWon: data.playerWon,
              winningChest: safeWinningChest,
              payout: payoutLamports / LAMPORTS_PER_SOL,
            });
            setGameStep("result");
          } else {
            console.warn("No GameResultEvent found in logs, falling back to regex");
            const logs = txDetails.meta.logMessages.join("\n");
            const wonMatch = logs.match(/Player (WON|lost)/i);
            const chestMatch = logs.match(/Chest (\d+)|Winning chest was (\d+)/);

            const playerWon = wonMatch?.[1]?.toUpperCase() === "WON";
            const rawChest = parseInt(chestMatch?.[1] || chestMatch?.[2] || "0");
            const winningChest = rawChest < numChests ? rawChest : rawChest % numChests;
            const payout = playerWon ? betAmount * numChests : 0;

            setGameResult({ playerWon, winningChest, payout });
            setGameStep("result");
          }
        } else {
          console.warn("No logs found in callback tx");
          setGameResult({ playerWon: false, winningChest: 0, payout: 0 });
          setGameStep("result");
        }
      } else {
        setGameResult({
          playerWon: false,
          winningChest: 0,
          payout: 0,
        });
        setGameStep("result");
      }
    } catch (err: unknown) {
      console.error("Game error:", err);
      if (err && typeof err === "object" && "transactionLogs" in err) {
        console.error("Transaction logs:", (err as { transactionLogs: string[] }).transactionLogs);
      }
      if (err && typeof err === "object" && "logs" in err) {
        console.error("Logs:", (err as { logs: string[] }).logs);
      }
      setError(err instanceof Error ? err.message : "Failed to play game");
    } finally {
      setIsPlaying(false);
    }
  }, [wallet, selectedChest, numChests, betAmount, connection, getProvider]);

  const resetGame = () => {
    setGameStep("hero");
    setSelectedChest(null);
    setGameResult(null);
    setError(null);
    setTxSignature(null);
  };

  // ══════════════════════════════════════════════════════════════════════════
  //  RENDER
  // ══════════════════════════════════════════════════════════════════════════

  return (
    <div className="min-h-screen relative overflow-hidden" style={{ background: "var(--background)" }}>
      {/* ── Ambient background ──────────────────────────────────────────── */}
      <div className="absolute inset-0 pointer-events-none" aria-hidden>
        {/* Gradient blobs */}
        <div
          className="absolute -top-48 -left-48 w-[600px] h-[600px] rounded-full opacity-20 blur-[120px]"
          style={{ background: "radial-gradient(circle, var(--purple) 0%, transparent 70%)" }}
        />
        <div
          className="absolute -bottom-32 -right-32 w-[500px] h-[500px] rounded-full opacity-15 blur-[100px]"
          style={{ background: "radial-gradient(circle, var(--gold) 0%, transparent 70%)" }}
        />
        <div
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] rounded-full opacity-[0.07] blur-[140px]"
          style={{ background: "radial-gradient(circle, var(--cyan) 0%, transparent 70%)" }}
        />
      </div>

      {/* Background image */}
      <div
        className="absolute inset-0 bg-cover bg-center bg-no-repeat transition-opacity duration-700 opacity-30"
        style={{
          backgroundImage: gameStep === "select" ? "url('/bg2.png')" : "url('/bg.png')",
          maskImage: "radial-gradient(ellipse 80% 80% at 50% 50%, black 20%, transparent 70%)",
          WebkitMaskImage: "radial-gradient(ellipse 80% 80% at 50% 50%, black 20%, transparent 70%)",
        }}
      />

      <AmbientParticles />

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <header className="relative z-20 px-6 pt-5">
        <div className="max-w-6xl mx-auto flex items-center justify-between px-6 py-3 glass rounded-2xl">
          {/* Logo */}
          <div className="flex items-center gap-2.5">
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center"
              style={{ background: "linear-gradient(135deg, var(--purple), var(--gold))" }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <rect x="2" y="10" width="20" height="12" rx="2" stroke="white" strokeWidth="2" />
                <path d="M12 2L2 10h20L12 2z" stroke="white" strokeWidth="2" strokeLinejoin="round" />
                <circle cx="12" cy="16" r="2" fill="white" />
              </svg>
            </div>
            <span className="text-lg font-bold tracking-tight text-white">VeiledChests</span>
          </div>

          {/* Nav */}
          <nav className="hidden md:flex gap-8 text-sm text-slate-400">
            <button
              onClick={() => setGameStep("hero")}
              className={`hover:text-white transition-colors ${gameStep === "hero" ? "text-white" : ""}`}
            >
              Home
            </button>
            <button
              onClick={() => setGameStep("stake")}
              className={`hover:text-white transition-colors ${gameStep === "stake" ? "text-white" : ""}`}
            >
              Play
            </button>
            <a href="#how-it-works" className="hover:text-white transition-colors">
              How it Works
            </a>
          </nav>

          {/* Wallet area */}
          <div className="flex items-center gap-3">
            {wallet.publicKey && solBalance !== null && (
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-white/5 border border-white/10">
                <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                <span className="text-sm font-medium text-slate-300">
                  {solBalance.toFixed(2)} <span className="text-slate-500">SOL</span>
                </span>
              </div>
            )}
            {wallet.publicKey && (solBalance === null || solBalance < 0.1) && (
              <button
                onClick={requestAirdrop}
                disabled={isAirdropping}
                className="px-3 py-1.5 text-sm font-medium rounded-xl transition-all disabled:opacity-50 border"
                style={{
                  background: "rgba(16, 185, 129, 0.1)",
                  borderColor: "rgba(16, 185, 129, 0.3)",
                  color: "var(--emerald-light)",
                }}
              >
                {isAirdropping ? "Airdropping..." : "Get 2 SOL"}
              </button>
            )}
            <WalletMultiButton />
          </div>
        </div>
      </header>

      {/* ── Content area ────────────────────────────────────────────────── */}
      <main className="relative z-10">
        {/* ═══════ HERO ═══════ */}
        {gameStep === "hero" && (
          <section className="min-h-[calc(100vh-80px)] flex flex-col items-center justify-center px-6">
            <div className="text-center max-w-3xl animate-fade-in">
              {/* Tagline chip */}
              <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full mb-8 text-sm font-medium text-purple-300 bg-purple-500/10 border border-purple-500/20">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                </svg>
                Powered by Arcium MPC
              </div>

              {/* Title */}
              <h1 className="text-5xl sm:text-7xl font-extrabold tracking-tight text-white leading-[1.1] mb-6">
                Choose a Chest.
                <br />
                <span className="shimmer-text">Trust the Veil.</span>
              </h1>

              {/* Subtitle */}
              <p className="text-lg text-slate-400 max-w-xl mx-auto mb-12 leading-relaxed">
                A provably fair on-chain game. Your choice and the winning chest are encrypted inside an MPC
                network — nobody can cheat, not even us.
              </p>

              {/* CTA */}
              <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                <button
                  onClick={() => setGameStep("stake")}
                  className="group relative px-10 py-4 rounded-2xl text-lg font-bold text-white transition-all hover:scale-[1.03] active:scale-[0.98]"
                  style={{
                    background: "linear-gradient(135deg, var(--purple-deep) 0%, var(--purple) 100%)",
                    boxShadow: "0 0 40px rgba(139, 92, 246, 0.3), inset 0 1px 0 rgba(255,255,255,0.1)",
                  }}
                >
                  <span className="relative z-10 flex items-center gap-2">
                    Play Now
                    <svg
                      className="w-5 h-5 transition-transform group-hover:translate-x-1"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                    </svg>
                  </span>
                </button>

                <a
                  href="#how-it-works"
                  className="px-6 py-4 rounded-2xl text-sm font-medium text-slate-400 hover:text-white transition-colors border border-white/10 hover:border-white/20"
                >
                  How does it work?
                </a>
              </div>

              {/* Stats row */}
              <div className="flex items-center justify-center gap-10 mt-16 text-center">
                <div>
                  <div className="text-2xl font-bold text-white">5x</div>
                  <div className="text-xs text-slate-500 mt-1">Max Multiplier</div>
                </div>
                <div className="w-px h-8 bg-white/10" />
                <div>
                  <div className="text-2xl font-bold text-white">MPC</div>
                  <div className="text-xs text-slate-500 mt-1">Encrypted Fairness</div>
                </div>
                <div className="w-px h-8 bg-white/10" />
                <div>
                  <div className="text-2xl font-bold text-white">Solana</div>
                  <div className="text-xs text-slate-500 mt-1">On-chain Settlement</div>
                </div>
              </div>
            </div>

            {/* Scroll hint */}
            <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-1.5 text-slate-600">
              <div className="w-5 h-8 rounded-full border-2 border-slate-600 flex items-start justify-center pt-1.5">
                <div className="w-1 h-2 rounded-full bg-slate-500 animate-bounce" />
              </div>
            </div>
          </section>
        )}

        {/* ═══════ STAKE SELECTION ═══════ */}
        {gameStep === "stake" && (
          <section className="min-h-[calc(100vh-80px)] flex items-center justify-center px-6 py-12">
            <div className="w-full max-w-lg animate-fade-in">
              {/* Card */}
              <div className="glass-strong rounded-3xl p-8 sm:p-10 gradient-border-animated">
                {/* Step indicator */}
                <div className="flex items-center gap-3 mb-8">
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold"
                    style={{ background: "var(--purple)", color: "white" }}
                  >
                    1
                  </div>
                  <div className="text-sm text-slate-400">Configure your bet</div>
                </div>

                {/* Title */}
                <h2 className="text-3xl font-bold text-white mb-1">Place Your Stake</h2>
                <p className="text-slate-500 text-sm mb-8">
                  Pick how much to wager and how many chests to play with.
                </p>

                {/* Bet amount */}
                <div className="mb-8">
                  <label className="text-xs font-semibold uppercase tracking-widest text-slate-500 mb-3 block">
                    Wager Amount
                  </label>
                  <div className="grid grid-cols-5 gap-2">
                    {BET_OPTIONS.map((amount) => (
                      <button
                        key={amount}
                        onClick={() => setBetAmount(amount)}
                        className="relative py-3 rounded-xl text-center font-semibold transition-all hover:scale-[1.04] active:scale-[0.97]"
                        style={{
                          background:
                            betAmount === amount
                              ? "linear-gradient(135deg, var(--purple-deep), var(--purple))"
                              : "rgba(255,255,255,0.04)",
                          color: betAmount === amount ? "white" : "var(--purple-light)",
                          border:
                            betAmount === amount
                              ? "1px solid var(--purple)"
                              : "1px solid rgba(148, 163, 184, 0.1)",
                          boxShadow:
                            betAmount === amount ? "0 0 20px rgba(139, 92, 246, 0.25)" : "none",
                        }}
                      >
                        {amount}
                        <span className="block text-[10px] opacity-60 font-normal mt-0.5">SOL</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Chest count */}
                <div className="mb-8">
                  <label className="text-xs font-semibold uppercase tracking-widest text-slate-500 mb-3 block">
                    Number of Chests
                  </label>
                  <div className="grid grid-cols-4 gap-2">
                    {CHEST_OPTIONS.map((num) => (
                      <button
                        key={num}
                        onClick={() => {
                          setNumChests(num);
                          if (selectedChest !== null && selectedChest >= num) {
                            setSelectedChest(null);
                          }
                        }}
                        className="relative py-3 rounded-xl text-center font-semibold transition-all hover:scale-[1.04] active:scale-[0.97]"
                        style={{
                          background:
                            numChests === num
                              ? "linear-gradient(135deg, var(--purple-deep), var(--purple))"
                              : "rgba(255,255,255,0.04)",
                          color: numChests === num ? "white" : "var(--purple-light)",
                          border:
                            numChests === num
                              ? "1px solid var(--purple)"
                              : "1px solid rgba(148, 163, 184, 0.1)",
                          boxShadow: numChests === num ? "0 0 20px rgba(139, 92, 246, 0.25)" : "none",
                        }}
                      >
                        {num}
                        <span className="block text-[10px] opacity-60 font-normal mt-0.5">chests</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Summary */}
                <div
                  className="rounded-2xl p-4 mb-8 flex items-center justify-between"
                  style={{
                    background: "rgba(245, 166, 35, 0.05)",
                    border: "1px solid rgba(245, 166, 35, 0.12)",
                  }}
                >
                  <div>
                    <div className="text-xs text-slate-500 mb-0.5">Potential Payout</div>
                    <div className="text-xl font-bold text-white">
                      {(betAmount * numChests).toFixed(1)} SOL
                    </div>
                  </div>
                  <MultiplierBadge numChests={numChests} />
                </div>

                {/* Next button */}
                <button
                  onClick={() => setGameStep("select")}
                  className="w-full py-4 rounded-2xl text-base font-bold text-white transition-all hover:scale-[1.02] active:scale-[0.98]"
                  style={{
                    background: "linear-gradient(135deg, var(--purple-deep) 0%, var(--purple) 100%)",
                    boxShadow: "0 0 30px rgba(139, 92, 246, 0.25)",
                  }}
                >
                  Choose Your Chest
                </button>

                {/* Back */}
                <button
                  onClick={() => setGameStep("hero")}
                  className="w-full mt-3 py-2 text-sm text-slate-500 hover:text-slate-300 transition-colors"
                >
                  Back
                </button>
              </div>
            </div>
          </section>
        )}

        {/* ═══════ CHEST SELECTION ═══════ */}
        {gameStep === "select" && (
          <section className="min-h-[calc(100vh-80px)] flex flex-col items-center justify-center px-6 py-12">
            <div className="w-full max-w-3xl animate-fade-in">
              {/* Step indicator */}
              <div className="flex items-center justify-center gap-3 mb-6">
                <div
                  className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold"
                  style={{ background: "var(--gold)", color: "#1a1a2e" }}
                >
                  2
                </div>
                <div className="text-sm text-slate-400">
                  Betting <span className="text-white font-semibold">{betAmount} SOL</span> on{" "}
                  <span className="text-white font-semibold">{numChests} chests</span>
                  <span className="mx-2 text-slate-600">|</span>
                  <MultiplierBadge numChests={numChests} />
                </div>
              </div>

              <h2 className="text-3xl sm:text-4xl font-bold text-white text-center mb-2">
                Pick Your Chest
              </h2>
              <p className="text-slate-500 text-center mb-10">
                Choose wisely — your selection is encrypted before being sent on-chain.
              </p>

              {/* Computing overlay */}
              {isPlaying ? (
                <div className="flex flex-col items-center justify-center py-16">
                  <ComputeSpinner label="Revealing the truth..." />
                  <p className="text-slate-600 text-sm mt-6 max-w-sm text-center">
                    Your encrypted choice is being compared with the winning chest inside a secure MPC
                    computation. This may take a moment.
                  </p>
                </div>
              ) : (
                <>
                  {/* Chests grid */}
                  <div
                    className="grid gap-4 mb-10 justify-items-center"
                    style={{
                      gridTemplateColumns: `repeat(${Math.min(numChests, 5)}, minmax(0, 1fr))`,
                    }}
                  >
                    {Array.from({ length: numChests }, (_, i) => {
                      const isSelected = selectedChest === i;
                      return (
                        <button
                          key={i}
                          onClick={() => setSelectedChest(i)}
                          className="group relative flex flex-col items-center transition-all duration-300"
                          style={{ transform: isSelected ? "translateY(-8px)" : "translateY(0)" }}
                        >
                          {/* Glow ring behind chest */}
                          <div
                            className="absolute top-4 w-32 h-32 rounded-full transition-all duration-300"
                            style={{
                              background: isSelected
                                ? "radial-gradient(circle, rgba(245, 166, 35, 0.25) 0%, transparent 70%)"
                                : "radial-gradient(circle, rgba(139, 92, 246, 0.08) 0%, transparent 70%)",
                              transform: isSelected ? "scale(1.3)" : "scale(1)",
                            }}
                          />

                          {/* Chest card */}
                          <div
                            className="relative z-10 w-36 sm:w-40 aspect-square rounded-2xl flex items-center justify-center transition-all duration-300"
                            style={{
                              background: isSelected
                                ? "linear-gradient(180deg, rgba(245, 166, 35, 0.12) 0%, rgba(245, 166, 35, 0.04) 100%)"
                                : "rgba(255,255,255,0.03)",
                              border: isSelected
                                ? "2px solid rgba(245, 166, 35, 0.5)"
                                : "1px solid rgba(148, 163, 184, 0.08)",
                              boxShadow: isSelected
                                ? "0 0 30px rgba(245, 166, 35, 0.2), 0 8px 32px rgba(0,0,0,0.3)"
                                : "0 4px 16px rgba(0,0,0,0.2)",
                            }}
                          >
                            <img
                              src="/chest.png"
                              alt={`Chest ${i + 1}`}
                              className="w-24 h-24 sm:w-28 sm:h-28 object-contain transition-all duration-300"
                              style={{
                                filter: isSelected
                                  ? "drop-shadow(0 0 20px rgba(245, 166, 35, 0.6))"
                                  : "drop-shadow(0 0 8px rgba(245, 166, 35, 0.15))",
                                transform: isSelected ? "scale(1.08)" : "scale(1)",
                              }}
                            />
                          </div>

                          {/* Label */}
                          <div
                            className="mt-3 px-4 py-1.5 rounded-full text-sm font-bold transition-all duration-300"
                            style={{
                              background: isSelected ? "var(--gold)" : "rgba(255,255,255,0.06)",
                              color: isSelected ? "#1a1a2e" : "var(--purple-light)",
                              boxShadow: isSelected ? "0 0 15px rgba(245, 166, 35, 0.3)" : "none",
                            }}
                          >
                            #{i + 1}
                          </div>
                        </button>
                      );
                    })}
                  </div>

                  {/* Confirm button */}
                  <div className="flex flex-col items-center">
                    <button
                      onClick={playGame}
                      disabled={selectedChest === null}
                      className="px-12 py-4 rounded-2xl text-base font-bold text-white transition-all hover:scale-[1.03] active:scale-[0.98] disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:scale-100"
                      style={{
                        background:
                          selectedChest !== null
                            ? "linear-gradient(135deg, var(--purple-deep) 0%, var(--purple) 100%)"
                            : "rgba(255,255,255,0.05)",
                        boxShadow:
                          selectedChest !== null ? "0 0 30px rgba(139, 92, 246, 0.3)" : "none",
                      }}
                    >
                      {selectedChest !== null
                        ? `Confirm Chest #${selectedChest + 1}`
                        : "Select a Chest"}
                    </button>

                    <button
                      onClick={() => {
                        setSelectedChest(null);
                        setGameStep("stake");
                      }}
                      className="mt-4 text-sm text-slate-500 hover:text-slate-300 transition-colors flex items-center gap-1"
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M19 12H5M12 19l-7-7 7-7" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                      Back to stake
                    </button>
                  </div>
                </>
              )}

              {/* Error */}
              {error && (
                <div
                  className="mt-8 mx-auto max-w-md rounded-2xl p-4 animate-fade-in"
                  style={{
                    background: "rgba(239, 68, 68, 0.08)",
                    border: "1px solid rgba(239, 68, 68, 0.2)",
                  }}
                >
                  <div className="flex items-start gap-3">
                    <svg
                      className="w-5 h-5 text-red-400 mt-0.5 flex-shrink-0"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <circle cx="12" cy="12" r="10" strokeWidth="2" />
                      <path d="M12 8v4m0 4h.01" strokeWidth="2" strokeLinecap="round" />
                    </svg>
                    <p className="text-red-300 text-sm">{error}</p>
                  </div>
                </div>
              )}
            </div>
          </section>
        )}

        {/* ═══════ RESULT ═══════ */}
        {gameStep === "result" && gameResult && (
          <section className="min-h-[calc(100vh-80px)] flex items-center justify-center px-6 py-12">
            <div className="w-full max-w-lg animate-fade-in-scale">
              {/* Win glow */}
              {gameResult.playerWon && (
                <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[500px] h-[500px] rounded-full pointer-events-none opacity-20 blur-[100px]" style={{ background: "var(--emerald)" }} />
              )}

              <div className="glass-strong rounded-3xl p-8 sm:p-10 text-center gradient-border-animated overflow-hidden relative">
                {/* Top accent line */}
                <div
                  className="absolute top-0 left-0 right-0 h-1"
                  style={{
                    background: gameResult.playerWon
                      ? "linear-gradient(90deg, transparent, var(--emerald), transparent)"
                      : "linear-gradient(90deg, transparent, var(--red), transparent)",
                  }}
                />

                {/* Result icon */}
                <div
                  className="w-20 h-20 rounded-full mx-auto mb-6 flex items-center justify-center animate-fade-in-scale"
                  style={{
                    background: gameResult.playerWon
                      ? "rgba(16, 185, 129, 0.12)"
                      : "rgba(239, 68, 68, 0.12)",
                    border: `2px solid ${gameResult.playerWon ? "rgba(16, 185, 129, 0.3)" : "rgba(239, 68, 68, 0.3)"}`,
                  }}
                >
                  {gameResult.playerWon ? (
                    <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="var(--emerald)" strokeWidth="2">
                      <path d="M8 12.5l3 3 5-6" strokeLinecap="round" strokeLinejoin="round" />
                      <circle cx="12" cy="12" r="10" />
                    </svg>
                  ) : (
                    <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="var(--red)" strokeWidth="2">
                      <path d="M15 9l-6 6M9 9l6 6" strokeLinecap="round" strokeLinejoin="round" />
                      <circle cx="12" cy="12" r="10" />
                    </svg>
                  )}
                </div>

                {/* Title */}
                <h2
                  className="text-4xl font-extrabold mb-2"
                  style={{
                    color: gameResult.playerWon ? "var(--emerald-light)" : "var(--red-light)",
                  }}
                >
                  {gameResult.playerWon ? "You Won!" : "You Lost"}
                </h2>

                {/* Amount */}
                <div
                  className="text-3xl font-bold mb-6"
                  style={{
                    color: gameResult.playerWon ? "var(--emerald)" : "var(--red)",
                  }}
                >
                  {gameResult.playerWon ? "+" : "-"}
                  {(gameResult.playerWon ? gameResult.payout : betAmount).toFixed(2)} SOL
                </div>

                {/* Chest reveal */}
                <div
                  className="rounded-2xl p-5 mb-6 space-y-3"
                  style={{
                    background: "rgba(255,255,255,0.03)",
                    border: "1px solid rgba(148, 163, 184, 0.08)",
                  }}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-slate-500">Winning Chest</span>
                    <span className="text-sm font-bold text-gold" style={{ color: "var(--gold)" }}>
                      #{gameResult.winningChest + 1}
                    </span>
                  </div>
                  <div className="w-full h-px bg-white/5" />
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-slate-500">Your Choice</span>
                    <span className="text-sm font-bold text-white">
                      #{(selectedChest ?? 0) + 1}
                    </span>
                  </div>
                  <div className="w-full h-px bg-white/5" />
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-slate-500">Multiplier</span>
                    <MultiplierBadge numChests={numChests} />
                  </div>
                </div>

                {/* TX Signature */}
                {txSignature && (
                  <p className="text-slate-600 text-xs mb-6 font-mono break-all">
                    {txSignature.slice(0, 24)}...{txSignature.slice(-12)}
                  </p>
                )}

                {/* Actions */}
                <div className="flex gap-3">
                  <button
                    onClick={() => {
                      setSelectedChest(null);
                      setGameResult(null);
                      setError(null);
                      setTxSignature(null);
                      setGameStep("stake");
                    }}
                    className="flex-1 py-4 rounded-2xl text-base font-bold text-white transition-all hover:scale-[1.02] active:scale-[0.98]"
                    style={{
                      background: "linear-gradient(135deg, var(--purple-deep) 0%, var(--purple) 100%)",
                      boxShadow: "0 0 30px rgba(139, 92, 246, 0.25)",
                    }}
                  >
                    Play Again
                  </button>
                  <button
                    onClick={resetGame}
                    className="px-6 py-4 rounded-2xl text-sm font-medium text-slate-400 hover:text-white transition-colors border border-white/10 hover:border-white/20"
                  >
                    Home
                  </button>
                </div>
              </div>
            </div>
          </section>
        )}
      </main>
    </div>
  );
};
