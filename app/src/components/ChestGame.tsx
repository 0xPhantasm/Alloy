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

  const [gameStep, setGameStep] = useState<'hero' | 'stake' | 'select' | 'result'>('hero');
  const [numChests, setNumChests] = useState(3);
  const [selectedChest, setSelectedChest] = useState<number | null>(null);
  const [betAmount, setBetAmount] = useState(0.1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [gameResult, setGameResult] = useState<GameResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [txSignature, setTxSignature] = useState<string | null>(null);
  const [solBalance, setSolBalance] = useState<number | null>(null);
  const [isAirdropping, setIsAirdropping] = useState(false);

  // Fetch wallet balance on connect and after airdrop
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
    return () => { connection.removeAccountChangeListener(id); };
  }, [wallet.publicKey, connection]);

  const requestAirdrop = useCallback(async () => {
    if (!wallet.publicKey) return;
    setIsAirdropping(true);
    setError(null);
    try {
      // Retry logic for Codespaces port forwarding drops
      let sig: string | null = null;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          sig = await connection.requestAirdrop(wallet.publicKey, 2 * LAMPORTS_PER_SOL);
          break;
        } catch (fetchErr) {
          if (attempt === 3) throw fetchErr;
          console.warn(`Airdrop attempt ${attempt} failed, retrying...`);
          await new Promise(r => setTimeout(r, 1500));
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
      
      try {
        const simResult = await connection.simulateTransaction(builtTx);
        console.log("Simulation result:", simResult);
        if (simResult.value.err) {
          // If GameAlreadyActive (6004), try to cancel stale game then ask user to retry
          const errObj = simResult.value.err as { InstructionError?: [number, { Custom: number }] } | null;
          const customCode = errObj?.InstructionError?.[1] && (errObj.InstructionError[1] as any).Custom;
          if (customCode === 6004) {
            const cancelled = await cancelStaleGameIfAny();
            if (cancelled) {
              throw new Error("Previous game was still pending; canceled it. Please retry your move.");
            }
          }
          console.error("Simulation error:", simResult.value.err);
          console.error("Simulation logs:", simResult.value.logs);
          throw new Error(`Simulation failed: ${JSON.stringify(simResult.value.err)}\nLogs: ${simResult.value.logs?.join('\n')}`);
        }
        console.log("Simulation passed! Sending transaction...");
      } catch (simErr) {
        console.error("Simulation exception:", simErr);
        throw simErr;
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
            // Find the callback tx by scanning recent signatures for the game PDA.
            // We need the tx that contains our program's callback logs (not an Arcium internal tx).
            const sigs = await connection.getSignaturesForAddress(gamePda, { limit: 10 }, "confirmed");
            for (const sig of sigs) {
              if (sig.signature === tx) continue; // skip the player's own tx
              const candidate = await connection.getTransaction(sig.signature, {
                commitment: "confirmed",
                maxSupportedTransactionVersion: 0,
              });
              if (candidate?.meta?.logMessages) {
                // Look for our program's callback by checking for game result log messages
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
          const resultEvent = events.find(e => e.name === "gameResultEvent");

          if (resultEvent) {
            const data = resultEvent.data as {
              playerWon: boolean;
              winningChest: number;
              payout: { toNumber?: () => number };
              betAmount: { toNumber?: () => number };
            };
            const payoutLamports = typeof data.payout === 'object' && data.payout?.toNumber
              ? data.payout.toNumber()
              : Number(data.payout);

            // Clamp winningChest to valid range (safety for MPC RNG edge cases)
            const safeWinningChest = data.winningChest < numChests ? data.winningChest : data.winningChest % numChests;

            setGameResult({
              playerWon: data.playerWon,
              winningChest: safeWinningChest,
              payout: payoutLamports / LAMPORTS_PER_SOL,
            });
            setGameStep('result');
          } else {
            // Fallback: try regex on logs
            console.warn("No GameResultEvent found in logs, falling back to regex");
            const logs = txDetails.meta.logMessages.join("\n");
            const wonMatch = logs.match(/Player (WON|lost)/i);
            const chestMatch = logs.match(/Chest (\d+)|Winning chest was (\d+)/);
            
            const playerWon = wonMatch?.[1]?.toUpperCase() === "WON";
            const rawChest = parseInt(chestMatch?.[1] || chestMatch?.[2] || "0");
            const winningChest = rawChest < numChests ? rawChest : rawChest % numChests;
            const payout = playerWon ? betAmount * numChests : 0;

            setGameResult({ playerWon, winningChest, payout });
            setGameStep('result');
          }
        } else {
          console.warn("No logs found in callback tx");
          setGameResult({ playerWon: false, winningChest: 0, payout: 0 });
          setGameStep('result');
        }
      } else {
        // Callback tx not found but game completed — infer result from balance change
        setGameResult({
          playerWon: false,
          winningChest: 0,
          payout: 0,
        });
        setGameStep('result');
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

  // Stripped UI - ready for new design
  return (
    <div className="min-h-screen bg-black relative overflow-hidden">
      {/* Background image - changes based on game step */}
      <div 
        className="absolute inset-0 bg-cover bg-center bg-no-repeat transition-all duration-500"
        style={{ backgroundImage: gameStep === 'select' ? "url('/bg2.png')" : "url('/bg.png')" }}
      />
      
      {/* Border frame */}
      <div className="absolute inset-4 border-2 border-gray-700 rounded-3xl pointer-events-none" />
      
      {/* Content */}
      <div className="relative z-10">
        {/* Header/Navigation */}
        <header className="mx-8 mt-6">
          <div className="flex items-center justify-between px-8 py-4 bg-gray-900/80 backdrop-blur-sm rounded-xl border border-gray-700/50">
            {/* Logo */}
            <div className="text-2xl font-bold" style={{ color: '#6b21a8' }}>
              VeiledChests
            </div>
            
            {/* Center Navigation */}
            <nav className="flex gap-10 text-gray-300 text-base">
              <a href="#game" className="hover:text-white transition-colors">Game</a>
              <a href="#about" className="hover:text-white transition-colors">About</a>
              <a href="#how-to-play" className="hover:text-white transition-colors">How to Play</a>
            </nav>
            
            {/* Wallet */}
            <div className="flex items-center gap-3">
              {wallet.publicKey && solBalance !== null && (
                <span className="text-gray-400 text-sm">{solBalance.toFixed(2)} SOL</span>
              )}
              {wallet.publicKey && (solBalance === null || solBalance < 0.1) && (
                <button
                  onClick={requestAirdrop}
                  disabled={isAirdropping}
                  className="px-3 py-1.5 text-sm font-medium rounded-lg border transition-all disabled:opacity-50"
                  style={{
                    background: 'rgba(34, 197, 94, 0.15)',
                    borderColor: '#22c55e',
                    color: '#4ade80',
                  }}
                >
                  {isAirdropping ? "Airdropping..." : "Airdrop 2 SOL"}
                </button>
              )}
              <WalletMultiButton />
            </div>
          </div>
        </header>

        {/* Hero Section */}
        {gameStep === 'hero' && (
          <div className="flex flex-col items-center justify-center min-h-[calc(100vh-120px)] px-8">
            <div className="text-center max-w-4xl">
              <h1 className="text-6xl font-bold text-white mb-8 tracking-wider" style={{ fontFamily: 'monospace' }}>
                MYSTERIOUS CHESTS: A<br />
                CHOICE BEFORE THE UNVEIL
              </h1>
              
              <p className="text-gray-400 text-lg mb-12 max-w-2xl mx-auto">
                Provably fair game where the player's<br />
                choice and winning chest is encrypted<br />
                until reveal
              </p>
              
              <button 
                onClick={() => setGameStep('stake')}
                className="relative px-16 py-4 text-xl font-bold transition-all hover:scale-105 border-2 rounded-lg"
                style={{
                  background: 'rgba(59, 7, 100, 0.6)',
                  borderColor: '#6b21a8',
                  color: '#a855f7',
                }}
              >
                PLAY GAME
              </button>
            </div>

            {/* Scroll indicator */}
            <div className="absolute bottom-12 left-1/2 transform -translate-x-1/2 flex flex-col items-center gap-2 text-gray-400">
              <svg className="w-6 h-6 animate-bounce" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
              <span className="text-sm tracking-wider">SCROLL DOWN</span>
            </div>
          </div>
        )}

        {/* Stake Selection Section */}
        {gameStep === 'stake' && (
          <section className="min-h-[calc(100vh-120px)] flex items-center justify-center px-8">
            {/* Bordered Card */}
            <div 
              className="relative p-1 rounded-lg"
              style={{
                background: 'linear-gradient(135deg, #22d3ee 0%, #0891b2 50%, #22d3ee 100%)',
              }}
            >
              {/* Inner card */}
              <div 
                className="px-16 py-12 rounded-lg"
                style={{
                  background: 'linear-gradient(180deg, rgba(15, 23, 42, 0.95) 0%, rgba(5, 15, 25, 0.98) 100%)',
                  minWidth: '500px',
                }}
              >
                {/* Title */}
                <h2 
                  className="text-4xl font-bold mb-10 tracking-wide"
                  style={{ 
                    background: 'linear-gradient(90deg, #22c55e 0%, #4ade80 100%)',
                    WebkitBackgroundClip: 'text',
                    WebkitTextFillColor: 'transparent',
                  }}
                >
                  CHOOSE YOUR STAKE
                </h2>

                {/* Bet Amount Section */}
                <div className="mb-8">
                  <label className="text-gray-400 text-sm mb-4 block">Bet Amount (SOL)</label>
                  <div className="flex gap-3">
                    {BET_OPTIONS.map((amount) => (
                      <button
                        key={amount}
                        onClick={() => setBetAmount(amount)}
                        className="px-5 py-2.5 rounded-md font-medium transition-all border-2"
                        style={{
                          background: betAmount === amount 
                            ? 'rgba(88, 28, 135, 0.8)' 
                            : 'rgba(59, 7, 100, 0.4)',
                          borderColor: betAmount === amount ? '#a855f7' : '#6b21a8',
                          color: betAmount === amount ? '#e9d5ff' : '#a855f7',
                        }}
                      >
                        {amount}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Number of Chests Section */}
                <div className="mb-10">
                  <label className="text-gray-400 text-sm mb-4 block">No of Chests</label>
                  <div className="relative inline-block">
                    <select
                      value={numChests}
                      onChange={(e) => {
                        const newNum = parseInt(e.target.value);
                        setNumChests(newNum);
                        if (selectedChest !== null && selectedChest >= newNum) {
                          setSelectedChest(null);
                        }
                      }}
                      className="appearance-none px-6 py-2.5 pr-10 rounded-md font-medium cursor-pointer border-2"
                      style={{
                        background: 'rgba(59, 7, 100, 0.4)',
                        borderColor: '#6b21a8',
                        color: '#a855f7',
                      }}
                    >
                      {CHEST_OPTIONS.map((num) => (
                        <option key={num} value={num} className="bg-gray-900 text-white">
                          {num}
                        </option>
                      ))}
                    </select>
                    <svg 
                      className="absolute right-3 top-1/2 transform -translate-y-1/2 w-4 h-4 pointer-events-none" 
                      fill="none" 
                      stroke="#a855f7" 
                      viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </div>
                </div>

                {/* Next Button */}
                <button 
                  onClick={() => setGameStep('select')}
                  className="w-full py-3 text-lg font-bold transition-all hover:scale-[1.02] border-2 rounded-lg"
                  style={{
                    background: 'rgba(59, 7, 100, 0.6)',
                    borderColor: '#6b21a8',
                    color: '#a855f7',
                  }}
                >
                  NEXT
                </button>
              </div>
            </div>
          </section>
        )}

        {/* Chest Selection Section */}
        {gameStep === 'select' && (
          <section className="min-h-[calc(100vh-120px)] flex flex-col items-center justify-center px-8">
            {/* Title */}
            <h2 
              className="text-4xl font-bold mb-12 tracking-wide text-center"
              style={{ 
                background: 'linear-gradient(90deg, #f59e0b 0%, #fbbf24 100%)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
              }}
            >
              SELECT YOUR CHEST
            </h2>

            {/* Chests Grid */}
            <div className="flex gap-8 mb-12 flex-wrap justify-center">
              {Array.from({ length: numChests }, (_, i) => (
                <button
                  key={i}
                  onClick={() => setSelectedChest(i)}
                  disabled={isPlaying}
                  className={`relative transition-all duration-300 transform hover:scale-110 ${
                    selectedChest === i ? 'scale-110' : ''
                  } ${isPlaying ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                >
                  {/* Chest Image */}
                  <img 
                    src="/chest.png" 
                    alt={`Chest ${i + 1}`}
                    className="w-40 h-40 object-contain"
                    style={{
                      filter: selectedChest === i 
                        ? 'drop-shadow(0 0 30px rgba(251, 191, 36, 0.8))' 
                        : 'drop-shadow(0 0 10px rgba(251, 191, 36, 0.3))',
                    }}
                  />
                  {/* Chest Number */}
                  <div 
                    className={`absolute -bottom-2 left-1/2 transform -translate-x-1/2 px-4 py-1 rounded-full text-sm font-bold ${
                      selectedChest === i 
                        ? 'bg-yellow-500 text-black' 
                        : 'bg-gray-800 text-gray-300'
                    }`}
                  >
                    #{i + 1}
                  </div>
                </button>
              ))}
            </div>

            {/* Selected Info */}
            {selectedChest !== null && (
              <p className="text-gray-400 text-lg mb-8">
                You selected <span className="text-yellow-400 font-bold">Chest #{selectedChest + 1}</span>
              </p>
            )}

            {/* Confirm Button */}
            <button 
              onClick={playGame}
              disabled={selectedChest === null || isPlaying}
              className="px-16 py-4 text-xl font-bold transition-all hover:scale-105 border-2 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
              style={{
                background: 'rgba(59, 7, 100, 0.6)',
                borderColor: '#6b21a8',
                color: '#a855f7',
              }}
            >
              {isPlaying ? (
                <span className="flex items-center gap-3">
                  <svg className="animate-spin h-6 w-6" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  REVEALING...
                </span>
              ) : (
                'CONFIRM SELECTION'
              )}
            </button>

            {/* Back Button */}
            <button 
              onClick={() => {
                setSelectedChest(null);
                setGameStep('stake');
              }}
              className="mt-4 text-gray-500 hover:text-gray-300 transition-colors"
            >
              ← Back to stake selection
            </button>

            {/* Error Display */}
            {error && (
              <div className="mt-6 bg-red-900/50 border border-red-500 rounded-lg p-4 max-w-md">
                <p className="text-red-300 text-center">{error}</p>
              </div>
            )}
          </section>
        )}

        {/* Result Section */}
        {gameStep === 'result' && gameResult && (
          <section className="min-h-[calc(100vh-120px)] flex flex-col items-center justify-center px-8">
            <div
              className="relative p-1 rounded-lg"
              style={{
                background: gameResult.playerWon
                  ? 'linear-gradient(135deg, #22c55e 0%, #16a34a 50%, #22c55e 100%)'
                  : 'linear-gradient(135deg, #ef4444 0%, #dc2626 50%, #ef4444 100%)',
              }}
            >
              <div
                className="px-16 py-12 rounded-lg text-center"
                style={{
                  background: 'linear-gradient(180deg, rgba(15, 23, 42, 0.95) 0%, rgba(5, 15, 25, 0.98) 100%)',
                  minWidth: '500px',
                }}
              >
                {/* Result Icon */}
                <div className="text-8xl mb-6">
                  {gameResult.playerWon ? '🎉' : '💀'}
                </div>

                {/* Result Title */}
                <h2
                  className="text-5xl font-bold mb-4 tracking-wide"
                  style={{
                    background: gameResult.playerWon
                      ? 'linear-gradient(90deg, #22c55e 0%, #4ade80 100%)'
                      : 'linear-gradient(90deg, #ef4444 0%, #f87171 100%)',
                    WebkitBackgroundClip: 'text',
                    WebkitTextFillColor: 'transparent',
                  }}
                >
                  {gameResult.playerWon ? 'YOU WON!' : 'YOU LOST'}
                </h2>

                {/* Winning Chest */}
                <p className="text-gray-400 text-lg mb-2">
                  The winning chest was{' '}
                  <span className="text-yellow-400 font-bold">#{gameResult.winningChest + 1}</span>
                </p>

                {/* Your Choice */}
                <p className="text-gray-500 text-base mb-6">
                  You chose{' '}
                  <span className="text-gray-300 font-bold">Chest #{(selectedChest ?? 0) + 1}</span>
                </p>

                {/* Payout */}
                {gameResult.playerWon && (
                  <p className="text-green-400 text-2xl font-bold mb-8">
                    +{gameResult.payout.toFixed(2)} SOL
                  </p>
                )}
                {!gameResult.playerWon && (
                  <p className="text-red-400 text-2xl font-bold mb-8">
                    -{betAmount.toFixed(2)} SOL
                  </p>
                )}

                {/* Transaction Link */}
                {txSignature && (
                  <p className="text-gray-500 text-xs mb-8 break-all">
                    TX: {txSignature.slice(0, 20)}...{txSignature.slice(-20)}
                  </p>
                )}

                {/* Play Again */}
                <button
                  onClick={resetGame}
                  className="w-full py-3 text-lg font-bold transition-all hover:scale-[1.02] border-2 rounded-lg"
                  style={{
                    background: 'rgba(59, 7, 100, 0.6)',
                    borderColor: '#6b21a8',
                    color: '#a855f7',
                  }}
                >
                  PLAY AGAIN
                </button>
              </div>
            </div>
          </section>
        )}
      </div>
    </div>
  );
};
