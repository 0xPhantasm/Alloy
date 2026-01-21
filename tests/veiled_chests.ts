import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { VeiledChests } from "../target/types/veiled_chests";
import { randomBytes } from "crypto";
import {
  awaitComputationFinalization,
  getArciumEnv,
  getCompDefAccOffset,
  getArciumAccountBaseSeed,
  getArciumProgramId,
  uploadCircuit,
  buildFinalizeCompDefTx,
  RescueCipher,
  deserializeLE,
  getMXEPublicKey,
  getMXEAccAddress,
  getMempoolAccAddress,
  getCompDefAccAddress,
  getExecutingPoolAccAddress,
  getComputationAccAddress,
  getClusterAccAddress,
  x25519,
} from "@arcium-hq/client";
import * as fs from "fs";
import * as os from "os";
import { expect } from "chai";

// Seeds for PDAs (must match program)
const TREASURY_SEED = Buffer.from("treasury");
const GAME_SEED = Buffer.from("game");

describe("VeiledChests", () => {
  // Configure the client to use the local cluster.
  anchor.setProvider(anchor.AnchorProvider.env());
  const program = anchor.workspace.VeiledChests as Program<VeiledChests>;
  const provider = anchor.getProvider() as anchor.AnchorProvider;
  const arciumEnv = getArciumEnv();

  type Event = anchor.IdlEvents<(typeof program)["idl"]>;
  const awaitEvent = async <E extends keyof Event>(
    eventName: E
  ): Promise<Event[E]> => {
    let listenerId: number;
    const event = await new Promise<Event[E]>((res) => {
      listenerId = program.addEventListener(eventName, (event) => {
        res(event);
      });
    });
    await program.removeEventListener(listenerId);
    return event;
  };

  // Helper to get treasury PDA
  function getTreasuryPDA(): PublicKey {
    return PublicKey.findProgramAddressSync(
      [TREASURY_SEED],
      program.programId
    )[0];
  }

  // Helper to get game PDA for a player
  function getGamePDA(player: PublicKey): PublicKey {
    return PublicKey.findProgramAddressSync(
      [GAME_SEED, player.toBuffer()],
      program.programId
    )[0];
  }

  it("Initializes the computation definition", async () => {
    const owner = readKpJson(`${os.homedir()}/.config/solana/id.json`);

    console.log("Initializing play_chest_game computation definition...");
    const sig = await initPlayChestGameCompDef(program, owner);
    console.log("Comp def initialized with signature:", sig);
  });

  it("Initializes the treasury", async () => {
    const owner = readKpJson(`${os.homedir()}/.config/solana/id.json`);
    const treasury = getTreasuryPDA();

    console.log("Initializing treasury at:", treasury.toBase58());
    
    const sig = await program.methods
      .initTreasury()
      .accountsPartial({
        authority: owner.publicKey,
      })
      .signers([owner])
      .rpc({ commitment: "confirmed" });
    
    console.log("Treasury initialized with signature:", sig);
  });

  it("Funds the treasury", async () => {
    const owner = readKpJson(`${os.homedir()}/.config/solana/id.json`);
    const treasury = getTreasuryPDA();
    
    // Fund with 10 SOL
    const fundAmount = new anchor.BN(10 * LAMPORTS_PER_SOL);
    
    const sig = await program.methods
      .fundTreasury(fundAmount)
      .accountsPartial({
        funder: owner.publicKey,
      })
      .signers([owner])
      .rpc({ commitment: "confirmed" });
    
    console.log("Treasury funded with 10 SOL, signature:", sig);
  });

  it("Plays a chest game", async () => {
    const player = readKpJson(`${os.homedir()}/.config/solana/id.json`);
    
    // Get MXE public key for encryption
    const mxePublicKey = await getMXEPublicKeyWithRetry(provider, program.programId);
    console.log("MXE x25519 pubkey is", Buffer.from(mxePublicKey).toString("hex"));

    // Generate keypair for encryption
    const privateKey = x25519.utils.randomSecretKey();
    const publicKey = x25519.getPublicKey(privateKey);
    const sharedSecret = x25519.getSharedSecret(privateKey, mxePublicKey);
    const cipher = new RescueCipher(sharedSecret);

    // Game parameters
    const numChests = 3;  // 3 chests = 3x multiplier
    const betAmount = new anchor.BN(0.1 * LAMPORTS_PER_SOL);  // 0.1 SOL bet
    const playerChoice = BigInt(1);  // Player chooses chest 1 (0-indexed)

    // Encrypt player's choice
    const nonce = randomBytes(16);
    const encryptedChoice = cipher.encrypt([playerChoice], nonce);

    // Generate computation offset
    const computationOffset = new anchor.BN(randomBytes(8), "hex");
    const clusterOffset = arciumEnv.arciumClusterOffset;

    console.log("Playing chest game...");
    console.log(`  - Num chests: ${numChests}`);
    console.log(`  - Bet: ${betAmount.toNumber() / LAMPORTS_PER_SOL} SOL`);
    console.log(`  - Player choice: chest ${playerChoice}`);

    // Listen for the game result event
    const gameResultPromise = awaitEvent("gameResultEvent");

    // Play the game
    const queueSig = await program.methods
      .playChestGame(
        computationOffset,
        numChests,
        betAmount,
        Array.from(encryptedChoice[0]) as any,
        Array.from(publicKey) as any,
        new anchor.BN(deserializeLE(nonce).toString())
      )
      .accountsPartial({
        player: player.publicKey,
        gameAccount: getGamePDA(player.publicKey),
        treasury: getTreasuryPDA(),
        computationAccount: getComputationAccAddress(clusterOffset, computationOffset),
        clusterAccount: getClusterAccAddress(clusterOffset),
        mxeAccount: getMXEAccAddress(program.programId),
        mempoolAccount: getMempoolAccAddress(clusterOffset),
        executingPool: getExecutingPoolAccAddress(clusterOffset),
        compDefAccount: getCompDefAccAddress(
          program.programId,
          Buffer.from(getCompDefAccOffset("play_chest_game")).readUInt32LE()
        ),
      })
      .signers([player])
      .rpc({ skipPreflight: true, commitment: "confirmed" });

    console.log("Game queued with signature:", queueSig);

    // Wait for computation to finalize
    console.log("Waiting for MPC computation...");
    const finalizeSig = await awaitComputationFinalization(
      provider,
      computationOffset,
      program.programId,
      "confirmed"
    );
    console.log("Computation finalized with signature:", finalizeSig);

    // Get the result
    const gameResult = await gameResultPromise;
    console.log("\n🎲 GAME RESULT:");
    console.log(`  - Player won: ${gameResult.playerWon}`);
    console.log(`  - Winning chest: ${gameResult.winningChest}`);
    console.log(`  - Bet amount: ${gameResult.betAmount.toNumber() / LAMPORTS_PER_SOL} SOL`);
    console.log(`  - Payout: ${gameResult.payout.toNumber() / LAMPORTS_PER_SOL} SOL`);

    if (gameResult.playerWon) {
      console.log("🎉 Congratulations! You won!");
      expect(gameResult.payout.toNumber()).to.equal(betAmount.toNumber() * numChests);
    } else {
      console.log("😢 Better luck next time!");
      expect(gameResult.payout.toNumber()).to.equal(0);
    }
  });

  async function initPlayChestGameCompDef(
    program: Program<VeiledChests>,
    owner: anchor.web3.Keypair
  ): Promise<string> {
    const baseSeedCompDefAcc = getArciumAccountBaseSeed("ComputationDefinitionAccount");
    const offset = getCompDefAccOffset("play_chest_game");

    const compDefPDA = PublicKey.findProgramAddressSync(
      [baseSeedCompDefAcc, program.programId.toBuffer(), offset],
      getArciumProgramId()
    )[0];

    console.log("Comp def PDA:", compDefPDA.toBase58());

    // Initialize the comp def
    const sig = await program.methods
      .initPlayChestGameCompDef()
      .accounts({
        compDefAccount: compDefPDA,
        payer: owner.publicKey,
        mxeAccount: getMXEAccAddress(program.programId),
      })
      .signers([owner])
      .rpc({ commitment: "confirmed" });

    console.log("Init comp def transaction:", sig);

    // Finalize the comp def
    const finalizeTx = await buildFinalizeCompDefTx(
      provider,
      Buffer.from(offset).readUInt32LE(),
      program.programId
    );

    const latestBlockhash = await provider.connection.getLatestBlockhash();
    finalizeTx.recentBlockhash = latestBlockhash.blockhash;
    finalizeTx.lastValidBlockHeight = latestBlockhash.lastValidBlockHeight;
    finalizeTx.sign(owner);

    await provider.sendAndConfirm(finalizeTx);
    console.log("Comp def finalized");

    return sig;
  }
});

async function getMXEPublicKeyWithRetry(
  provider: anchor.AnchorProvider,
  programId: PublicKey,
  maxRetries: number = 20,
  retryDelayMs: number = 500
): Promise<Uint8Array> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const mxePublicKey = await getMXEPublicKey(provider, programId);
      if (mxePublicKey) {
        return mxePublicKey;
      }
    } catch (error) {
      console.log(`Attempt ${attempt} failed to fetch MXE public key:`, error);
    }

    if (attempt < maxRetries) {
      console.log(`Retrying in ${retryDelayMs}ms... (attempt ${attempt}/${maxRetries})`);
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
  }

  throw new Error(`Failed to fetch MXE public key after ${maxRetries} attempts`);
}

function readKpJson(path: string): anchor.web3.Keypair {
  const file = fs.readFileSync(path);
  return anchor.web3.Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(file.toString()))
  );
}
