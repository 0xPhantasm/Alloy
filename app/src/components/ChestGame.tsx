"use client";

import { FC, useState, useCallback } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { PublicKey, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { Program, AnchorProvider, BN } from "@coral-xyz/anchor";
import { x25519 } from "@noble/curves/ed25519";
import {
  RescueCipher,
  getClusterAccAddress,
  getMXEAccAddress,
  getMempoolAccAddress,
  getExecutingPoolAccAddress,
  getComputationAccAddress,
  getCompDefAccAddress,
  getCompDefAccOffset,
  getMXEPublicKey,
  awaitComputationFinalization,
  getArciumProgramId,
  getFeePoolAccAddress,
  getClockAccAddress,
} from "@arcium-hq/client";
import IDL from "@/idl/veiled_chests.json";

// Constants
const PROGRAM_ID = new PublicKey(process.env.NEXT_PUBLIC_PROGRAM_ID || "DDA1LfvE1kM8h4CcyqX4278oCYyB7QAg693QREjfNsZS");
const CLUSTER_OFFSET = parseInt(process.env.NEXT_PUBLIC_ARCIUM_CLUSTER_OFFSET || "0");
const TREASURY_SEED = Buffer.from("treasury");
const GAME_SEED = Buffer.from("game");
const SIGN_PDA_SEED = Buffer.from("sign");

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

  const [numChests, setNumChests] = useState(3);
  const [selectedChest, setSelectedChest] = useState<number | null>(null);
  const [betAmount, setBetAmount] = useState(0.1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [gameResult, setGameResult] = useState<GameResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [txSignature, setTxSignature] = useState<string | null>(null);

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
      const provider = getProvider();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const program = new Program(IDL as any, provider);

      // Get MXE public key for encryption
      const mxePubkey = await getMXEPublicKey(provider, PROGRAM_ID);
      if (!mxePubkey) {
        throw new Error("Failed to get MXE public key");
      }

      // Generate client keypair and compute shared secret using x25519
      const privateKey = x25519.utils.randomPrivateKey();
      const clientPubkey = x25519.getPublicKey(privateKey);
      const sharedSecret = x25519.getSharedSecret(privateKey, mxePubkey);
      
      // Create cipher with shared secret
      const cipher = new RescueCipher(sharedSecret);
      
      // Generate nonce and encrypt
      const nonce = crypto.getRandomValues(new Uint8Array(16));
      const encryptedChoice = cipher.encrypt([BigInt(selectedChest)], nonce);

      // Generate computation offset
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
      const { deserializeLE } = await import("@arcium-hq/client");
      const nonceValue = deserializeLE(nonce);

      // Build transaction
      const tx = await program.methods
        .playChestGame(
          computationOffset,
          numChests,
          new BN(betAmount * LAMPORTS_PER_SOL),
          encryptedChoice[0] as any,  // First encrypted value (player choice)
          Array.from(clientPubkey) as any,
          new BN(nonceValue.toString())
        )
        .accountsPartial({
          player: wallet.publicKey,
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
        })
        .rpc({ skipPreflight: true, commitment: "confirmed" });

      setTxSignature(tx);
      console.log("Game queued with signature:", tx);

      // Wait for MPC computation
      const resultSig = await awaitComputationFinalization(
        provider,
        computationOffset,
        PROGRAM_ID,
        "confirmed"
      );

      console.log("Computation finalized:", resultSig);

      // Parse the result from logs or events
      // The callback will emit a GameResultEvent
      const txDetails = await connection.getTransaction(resultSig, {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0,
      });

      if (txDetails?.meta?.logMessages) {
        const logs = txDetails.meta.logMessages.join("\n");
        const wonMatch = logs.match(/Player (WON|lost)/);
        const chestMatch = logs.match(/Chest (\d+)|Winning chest was (\d+)/);
        
        const playerWon = wonMatch?.[1] === "WON";
        const winningChest = parseInt(chestMatch?.[1] || chestMatch?.[2] || "0");
        const payout = playerWon ? betAmount * numChests : 0;

        setGameResult({
          playerWon,
          winningChest,
          payout,
        });
      }
    } catch (err: unknown) {
      console.error("Game error:", err);
      setError(err instanceof Error ? err.message : "Failed to play game");
    } finally {
      setIsPlaying(false);
    }
  }, [wallet, selectedChest, numChests, betAmount, connection, getProvider]);

  const resetGame = () => {
    setSelectedChest(null);
    setGameResult(null);
    setError(null);
    setTxSignature(null);
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-900 via-purple-900 to-gray-900 text-white">
      <div className="container mx-auto px-4 py-8 max-w-4xl">
        {/* Header */}
        <div className="flex justify-between items-center mb-12">
          <h1 className="text-4xl font-bold bg-gradient-to-r from-purple-400 to-pink-500 bg-clip-text text-transparent">
            🎁 Veiled Chests
          </h1>
          <WalletMultiButton />
        </div>

        {/* Game Description */}
        <div className="text-center mb-8">
          <p className="text-gray-300 text-lg">
            Pick a chest and test your luck! Win{" "}
            <span className="text-yellow-400 font-bold">{numChests}x</span> your bet!
          </p>
          <p className="text-gray-500 text-sm mt-2">
            🔒 Your choice is encrypted using Arcium MPC - provably fair!
          </p>
        </div>

        {!wallet.publicKey ? (
          <div className="text-center py-20">
            <p className="text-xl text-gray-400 mb-4">Connect your wallet to play</p>
            <WalletMultiButton />
          </div>
        ) : gameResult ? (
          /* Result Screen */
          <div className="text-center py-12">
            <div
              className={`text-6xl mb-6 ${
                gameResult.playerWon ? "animate-bounce" : ""
              }`}
            >
              {gameResult.playerWon ? "🎉" : "😢"}
            </div>
            <h2
              className={`text-4xl font-bold mb-4 ${
                gameResult.playerWon ? "text-green-400" : "text-red-400"
              }`}
            >
              {gameResult.playerWon ? "YOU WON!" : "YOU LOST"}
            </h2>
            <p className="text-xl text-gray-300 mb-2">
              Winning chest: <span className="font-bold">#{gameResult.winningChest + 1}</span>
            </p>
            {gameResult.playerWon && (
              <p className="text-2xl text-yellow-400 font-bold mb-6">
                +{gameResult.payout.toFixed(2)} SOL
              </p>
            )}
            {txSignature && (
              <a
                href={`https://explorer.solana.com/tx/${txSignature}?cluster=devnet`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-purple-400 hover:text-purple-300 text-sm underline mb-6 block"
              >
                View on Explorer
              </a>
            )}
            <button
              onClick={resetGame}
              className="px-8 py-3 bg-purple-600 hover:bg-purple-700 rounded-lg font-bold text-lg transition-colors"
            >
              Play Again
            </button>
          </div>
        ) : (
          /* Game Screen */
          <div className="space-y-8">
            {/* Chest Count Selection */}
            <div className="bg-gray-800/50 rounded-xl p-6 backdrop-blur-sm">
              <h3 className="text-lg font-semibold mb-4 text-gray-300">
                Number of Chests (Multiplier)
              </h3>
              <div className="flex gap-3 justify-center">
                {CHEST_OPTIONS.map((num) => (
                  <button
                    key={num}
                    onClick={() => {
                      setNumChests(num);
                      if (selectedChest !== null && selectedChest >= num) {
                        setSelectedChest(null);
                      }
                    }}
                    className={`w-16 h-16 rounded-lg font-bold text-lg transition-all ${
                      numChests === num
                        ? "bg-purple-600 text-white scale-105 ring-2 ring-purple-400"
                        : "bg-gray-700 text-gray-300 hover:bg-gray-600"
                    }`}
                  >
                    {num}x
                  </button>
                ))}
              </div>
            </div>

            {/* Chest Selection */}
            <div className="bg-gray-800/50 rounded-xl p-6 backdrop-blur-sm">
              <h3 className="text-lg font-semibold mb-4 text-gray-300">
                Choose Your Chest
              </h3>
              <div className="flex gap-4 justify-center flex-wrap">
                {Array.from({ length: numChests }, (_, i) => (
                  <button
                    key={i}
                    onClick={() => setSelectedChest(i)}
                    disabled={isPlaying}
                    className={`w-20 h-20 rounded-xl text-4xl transition-all transform hover:scale-105 ${
                      selectedChest === i
                        ? "bg-gradient-to-br from-yellow-500 to-orange-600 scale-110 ring-4 ring-yellow-400"
                        : "bg-gradient-to-br from-gray-600 to-gray-700 hover:from-gray-500 hover:to-gray-600"
                    } ${isPlaying ? "opacity-50 cursor-not-allowed" : ""}`}
                  >
                    🎁
                  </button>
                ))}
              </div>
              {selectedChest !== null && (
                <p className="text-center mt-4 text-purple-400">
                  Selected: Chest #{selectedChest + 1}
                </p>
              )}
            </div>

            {/* Bet Selection */}
            <div className="bg-gray-800/50 rounded-xl p-6 backdrop-blur-sm">
              <h3 className="text-lg font-semibold mb-4 text-gray-300">
                Bet Amount
              </h3>
              <div className="flex gap-3 justify-center flex-wrap">
                {BET_OPTIONS.map((amount) => (
                  <button
                    key={amount}
                    onClick={() => setBetAmount(amount)}
                    disabled={isPlaying}
                    className={`px-6 py-3 rounded-lg font-bold transition-all ${
                      betAmount === amount
                        ? "bg-green-600 text-white ring-2 ring-green-400"
                        : "bg-gray-700 text-gray-300 hover:bg-gray-600"
                    } ${isPlaying ? "opacity-50 cursor-not-allowed" : ""}`}
                  >
                    {amount} SOL
                  </button>
                ))}
              </div>
              <p className="text-center mt-4 text-gray-400">
                Potential win:{" "}
                <span className="text-yellow-400 font-bold">
                  {(betAmount * numChests).toFixed(2)} SOL
                </span>
              </p>
            </div>

            {/* Play Button */}
            <div className="text-center">
              <button
                onClick={playGame}
                disabled={isPlaying || selectedChest === null}
                className={`px-12 py-4 rounded-xl font-bold text-xl transition-all transform ${
                  isPlaying || selectedChest === null
                    ? "bg-gray-600 text-gray-400 cursor-not-allowed"
                    : "bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 hover:scale-105 shadow-lg shadow-purple-500/50"
                }`}
              >
                {isPlaying ? (
                  <span className="flex items-center gap-2">
                    <svg
                      className="animate-spin h-6 w-6"
                      viewBox="0 0 24 24"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                        fill="none"
                      />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                      />
                    </svg>
                    Revealing...
                  </span>
                ) : (
                  "🎲 Open Chest"
                )}
              </button>
            </div>

            {/* Error Display */}
            {error && (
              <div className="bg-red-900/50 border border-red-500 rounded-lg p-4 text-center">
                <p className="text-red-300">{error}</p>
              </div>
            )}
          </div>
        )}

        {/* Footer */}
        <div className="mt-16 text-center text-gray-500 text-sm">
          <p>Powered by Arcium Confidential Computing</p>
          <p className="mt-1">🔐 Provably fair • 🎲 On-chain randomness</p>
        </div>
      </div>
    </div>
  );
};
