import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Keypair, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { VeiledChests } from "../target/types/veiled_chests";
import fs from "fs";
import path from "path";

async function main() {
  // Load keypair
  const keypairPath = path.join(process.env.HOME || "", ".config", "solana", "id.json");
  const keypairData = JSON.parse(fs.readFileSync(keypairPath, "utf-8"));
  const payer = Keypair.fromSecretKey(new Uint8Array(keypairData));

  // Load IDL and derive program ID
  const idl = require("../target/idl/veiled_chests.json");
  const PROGRAM_ID = new PublicKey(idl.address);

  // Connect — Helius devnet RPC
  const rpcUrl = "https://devnet.helius-rpc.com/?api-key=0c8dfde7-5739-4d2b-8063-d8e8af79bd0e";
  const connection = new anchor.web3.Connection(rpcUrl, "confirmed");

  const wallet = new anchor.Wallet(payer);
  const provider = new anchor.AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });
  anchor.setProvider(provider);

  const program = new Program(idl, provider) as Program<VeiledChests>;

  // Derive treasury PDA
  const [treasuryPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("treasury")],
    PROGRAM_ID
  );

  console.log("Treasury PDA:", treasuryPda.toBase58());
  console.log("Authority:", wallet.publicKey.toBase58());

  // Check if treasury already exists
  const treasuryInfo = await connection.getAccountInfo(treasuryPda);
  if (treasuryInfo) {
    console.log("Treasury already initialized!");
    console.log("Balance:", treasuryInfo.lamports / LAMPORTS_PER_SOL, "SOL");
    return;
  }

  // Initialize treasury
  console.log("\nInitializing treasury...");
  const tx = await program.methods
    .initTreasury()
    .accountsPartial({
      authority: wallet.publicKey,
    })
    .rpc();

  console.log("✅ Treasury initialized!");
  console.log("Transaction:", tx);
  console.log("\nTo fund the treasury, send SOL to:");
  console.log(treasuryPda.toBase58());
}

main().catch(console.error);
