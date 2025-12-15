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

// Constants - Program ID derived from IDL
const PROGRAM_ID = new PublicKey(IDL.address);
const CLUSTER_OFFSET = parseInt(process.env.NEXT_PUBLIC_ARCIUM_CLUSTER_OFFSET || "123");
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

  const [gameStep, setGameStep] = useState<'hero' | 'stake' | 'select' | 'result'>('hero');
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

      // Get MXE public key for encryption (may take time on devnet as keygen needs to complete)
      let mxePubkey = await getMXEPublicKey(provider, PROGRAM_ID);
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
            <div>
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
      </div>
    </div>
  );
};
